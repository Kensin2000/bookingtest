import { Booking, Room } from '../types';
import { getSupabaseClient } from './supabase';
import { DEFAULT_TIME_SLOTS } from './initialData';

export interface RecurringTemplate {
  id: string;
  name: string;
  description?: string;
  roomIds: string[]; // Danh sách mã phòng áp dụng (VD: ["201", "202", "305"])
  daysOfWeek: number[]; // 1: Thứ 2, 2: Thứ 3, ..., 6: Thứ 7, 0: Chủ nhật
  slotNumbers: (number | string)[]; // [1, 2, 3, 4, 6, 7, 8, 9] hoặc "trua"
  purpose: string; // Mặc định: "Lịch học chính khóa cố định"
  borrowerName: string; // Mặc định: "Phòng Đào Tạo"
  createdAt: string;
  updatedAt: string;
}

export interface ApplyRecurringOptions {
  mode: 'week' | 'range';
  // Chế độ 'week': Chọn ngày bất kỳ trong tuần (hoặc Thứ 2), hệ thống tính ra cả tuần
  weekDate?: string;
  // Chế độ 'range': Áp dụng từ ngày bắt đầu đến ngày kết thúc
  startDate?: string;
  endDate?: string;
  // Bỏ qua các slot đã có người đặt trước để tránh xung đột (mặc định: true)
  skipConflicts?: boolean;
}

export interface ApplyRecurringResult {
  success: boolean;
  totalGenerated: number;
  insertedCount: number;
  skippedConflictCount: number;
  message: string;
  error?: string;
  newBookings?: Booking[];
  targetDates?: string[];
}

const STORAGE_KEY = 'vuth_recurring_schedule_templates';
const SETTING_KEY = 'recurring_schedule_templates';

// Mẫu lịch mặc định ban đầu
export const DEFAULT_RECURRING_TEMPLATES: RecurringTemplate[] = [
  {
    id: 'tpl_main_study',
    name: 'Lịch học chính khóa (T2 - T6: Slot 1-4 & 6-9)',
    description: 'Áp dụng cho các phòng chính khóa vào các ngày trong tuần từ Thứ 2 đến Thứ 6',
    roomIds: [], // Sẽ tự động điền các phòng chính khóa nếu trống
    daysOfWeek: [1, 2, 3, 4, 5], // T2 -> T6
    slotNumbers: [1, 2, 3, 4, 6, 7, 8, 9], // Slot sáng & chiều
    purpose: 'Lịch học chính khóa cố định',
    borrowerName: 'Phòng Đào Tạo',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'tpl_morning_only',
    name: 'Lịch học Ca Sáng (T2 - T7: Slot 1-4)',
    description: 'Chỉ khóa các slot buổi sáng từ Thứ 2 đến Thứ 7',
    roomIds: [],
    daysOfWeek: [1, 2, 3, 4, 5, 6],
    slotNumbers: [1, 2, 3, 4],
    purpose: 'Lịch học ca sáng',
    borrowerName: 'Phòng Đào Tạo',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

/**
 * Tải danh sách templates từ Supabase settings (hoặc localStorage)
 */
export async function fetchRecurringTemplates(): Promise<RecurringTemplate[]> {
  const client = getSupabaseClient();
  if (client) {
    try {
      const { data, error } = await client
        .from('settings')
        .select('value')
        .eq('key', SETTING_KEY)
        .maybeSingle();

      if (!error && data?.value) {
        const parsed = JSON.parse(data.value);
        if (Array.isArray(parsed) && parsed.length > 0) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Lỗi đọc recurring templates từ Supabase settings:', e);
    }
  }

  // Fallback sang localStorage
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {}

  return DEFAULT_RECURRING_TEMPLATES;
}

/**
 * Lưu danh sách templates vào Supabase settings và localStorage
 */
export async function saveRecurringTemplates(templates: RecurringTemplate[]): Promise<boolean> {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  } catch {}

  const client = getSupabaseClient();
  if (client) {
    try {
      const { error } = await client
        .from('settings')
        .upsert({ key: SETTING_KEY, value: JSON.stringify(templates) }, { onConflict: 'key' });
      if (!error) return true;
      console.warn('Supabase upsert recurring templates error:', error);
    } catch (e) {
      console.warn('Exception upserting recurring templates to Supabase:', e);
    }
  }
  return true;
}

/**
 * Helper định dạng ngày địa phương chuẩn YYYY-MM-DD không bị lệch múi giờ
 */
export function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseLocalDate(str: string): Date {
  const parts = str.split('-').map(Number);
  if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
  }
  return new Date();
}

/**
 * Xác định danh sách phòng áp dụng cho template (đảm bảo không bị rỗng)
 */
export function resolveTargetRooms(template: RecurringTemplate, allRooms: Room[]): Room[] {
  const validRooms = allRooms.filter((r) => {
    const st = (r.status || '').toLowerCase();
    return st !== 'inactive' && st !== 'maintenance';
  });

  if (template.roomIds && template.roomIds.length > 0) {
    const idSet = new Set(template.roomIds.map((id) => String(id).toUpperCase().trim()));
    const matched = validRooms.filter((r) => idSet.has(String(r.room_id).toUpperCase().trim()));
    if (matched.length > 0) return matched;
  }

  // Nếu template chưa chỉ định phòng cụ thể, ưu tiên các phòng chính khóa
  const chinhKhoa = validRooms.filter((r) => {
    const t = (r.room_type || '').toLowerCase();
    return t === 'chinh_khoa' || t.includes('chính') || t === '';
  });

  return chinhKhoa.length > 0 ? chinhKhoa : validRooms;
}

/**
 * Tính toán danh sách ngày (YYYY-MM-DD) cần sinh theo cấu hình tuần hoặc khoảng ngày
 */
export function calculateTargetDates(options: ApplyRecurringOptions, targetDaysOfWeek: number[]): string[] {
  const dates: string[] = [];

  if (options.mode === 'week' && options.weekDate) {
    const base = parseLocalDate(options.weekDate);
    if (isNaN(base.getTime())) return [];
    const currentDay = base.getDay(); // 0 (CN) -> 6 (T7)
    // Khoảng cách tới Thứ 2 (1):
    const diffToMon = currentDay === 0 ? -6 : 1 - currentDay;
    const monday = new Date(base);
    monday.setDate(base.getDate() + diffToMon);

    // Duyệt từ T2 (i=0) đến CN (i=6)
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dayOfWeek = d.getDay();
      if (targetDaysOfWeek.includes(dayOfWeek)) {
        dates.push(formatLocalDate(d));
      }
    }
  } else if (options.mode === 'range' && options.startDate && options.endDate) {
    const start = parseLocalDate(options.startDate);
    const end = parseLocalDate(options.endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return [];

    const curr = new Date(start);
    let count = 0;
    while (curr <= end && count < 180) {
      count++;
      const dayOfWeek = curr.getDay();
      if (targetDaysOfWeek.includes(dayOfWeek)) {
        dates.push(formatLocalDate(curr));
      }
      curr.setDate(curr.getDate() + 1);
    }
  }

  return dates;
}

/**
 * Áp dụng template: Sinh ra các booking và chèn trực tiếp vào CSDL Supabase
 */
export async function applyRecurringSchedule(
  template: RecurringTemplate,
  options: ApplyRecurringOptions,
  rooms: Room[],
  existingBookings: Booking[],
  currentSession: { username: string; fullname: string }
): Promise<ApplyRecurringResult> {
  const targetDays = template.daysOfWeek && template.daysOfWeek.length > 0 ? template.daysOfWeek : [1, 2, 3, 4, 5];
  const targetDates = calculateTargetDates(options, targetDays);

  if (targetDates.length === 0) {
    return {
      success: false,
      totalGenerated: 0,
      insertedCount: 0,
      skippedConflictCount: 0,
      message: 'Không tìm thấy ngày nào phù hợp trong tuần hoặc khoảng ngày đã chọn.',
    };
  }

  // Danh sách phòng cần áp dụng
  const targetRooms = resolveTargetRooms(template, rooms);
  const targetRoomIds = targetRooms.map((r) => r.room_id);

  if (targetRoomIds.length === 0) {
    return {
      success: false,
      totalGenerated: 0,
      insertedCount: 0,
      skippedConflictCount: 0,
      message: 'Không tìm thấy phòng học khả dụng để áp dụng lịch.',
    };
  }

  // Danh sách slot được chọn
  const targetSlotNumbers = template.slotNumbers || [1, 2, 3, 4, 6, 7, 8, 9];
  const matchedSlots = DEFAULT_TIME_SLOTS.filter((s) => targetSlotNumbers.includes(s.slotNumber));

  if (matchedSlots.length === 0) {
    return {
      success: false,
      totalGenerated: 0,
      insertedCount: 0,
      skippedConflictCount: 0,
      message: 'Vui lòng chọn ít nhất 1 khung giờ slot để áp dụng lịch.',
    };
  }

  // Lập Set các slot đã có người đặt trước để kiểm tra trùng
  const busyKeySet = new Set<string>();
  existingBookings.forEach((b) => {
    if (b.status !== 'Rejected' && b.status !== 'Cancelled') {
      const rId = String(b.room_id || '').toUpperCase().trim();
      const d = String(b.date || '').trim();
      if (rId && d && b.time_slot) {
        // Tách các slot nếu đơn cũ lưu nhiều slot cách nhau bằng dấu phẩy
        const parts = b.time_slot.split(',').map((p) => p.trim());
        parts.forEach((p) => {
          if (!p) return;
          busyKeySet.add(`${rId}__${d}__${p}`);
          const timeOnly = p.split('(')[0].trim();
          if (timeOnly) busyKeySet.add(`${rId}__${d}__${timeOnly}`);
        });
      }
    }
  });

  const now = new Date();
  const bookingsToInsert: Booking[] = [];
  let skippedConflictCount = 0;
  let totalGenerated = 0;

  const roomMap = new Map<string, Room>();
  rooms.forEach((r) => roomMap.set(r.room_id.toUpperCase(), r));

  targetRoomIds.forEach((rawRId) => {
    const cleanRId = rawRId.toUpperCase().trim();
    const rInfo = roomMap.get(cleanRId);
    const roomName = rInfo?.room_name || `Phòng ${cleanRId}`;
    const roomType = rInfo?.room_type || 'chinh_khoa';

    targetDates.forEach((dateStr) => {
      const availableSlotRanges: string[] = [];

      matchedSlots.forEach((slot) => {
        totalGenerated++;
        const busyKey1 = `${cleanRId}__${dateStr}__${slot.timeRange}`;
        const busyKey2 = `${cleanRId}__${dateStr}__${slot.label}`;

        if (options.skipConflicts !== false && (busyKeySet.has(busyKey1) || busyKeySet.has(busyKey2))) {
          skippedConflictCount++;
          return;
        }

        availableSlotRanges.push(slot.timeRange);
      });

      // Nếu có ít nhất 1 slot trống trong ngày, tạo 1 record DUY NHẤT gom toàn bộ slot của phòng trong ngày đó
      if (availableSlotRanges.length > 0) {
        const bId = `BK_RECUR_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

        bookingsToInsert.push({
          booking_id: bId,
          room_id: cleanRId,
          room_name: roomName,
          room_type: roomType,
          username: currentSession.username || 'admin',
          fullname: template.borrowerName || 'Lịch Chính Khóa',
          borrower_name: template.borrowerName || 'Lịch Chính Khóa',
          date: dateStr,
          time_slot: availableSlotRanges.join(', '), // Gộp các slot cách nhau bằng dấu phẩy
          purpose: template.purpose || 'Lịch học cố định chính khóa',
          created_at: new Date(now.getTime() + bookingsToInsert.length).toISOString(),
          status: 'Approved',
        });
      }
    });
  });

  const lockedSlotsCount = totalGenerated - skippedConflictCount;

  if (bookingsToInsert.length === 0) {
    return {
      success: true,
      totalGenerated,
      insertedCount: 0,
      skippedConflictCount,
      message: `Tất cả ${totalGenerated} slot trong đợt này đã có lịch đặt trước. Không có slot trống mới cần tạo!`,
    };
  }

  // Chèn vào CSDL Supabase
  const client = getSupabaseClient();
  let insertedCount = 0;

  if (client) {
    try {
      const chunkSize = 50;
      for (let i = 0; i < bookingsToInsert.length; i += chunkSize) {
        let chunk: any[] = bookingsToInsert.slice(i, i + chunkSize);
        let { error: insertErr } = await client.from('bookings').insert(chunk);

        // Retry nếu Supabase thiếu cột borrower_name
        if (insertErr && (insertErr.message?.includes('borrower_name') || (insertErr as any).code === '42703')) {
          chunk = chunk.map((b) => {
            const { borrower_name, ...rest } = b;
            return rest;
          });
          const retry = await client.from('bookings').insert(chunk);
          insertErr = retry.error;
        }

        if (insertErr) {
          console.error('Lỗi insert recurring bookings vào Supabase:', insertErr);
          throw new Error(insertErr.message);
        }
        insertedCount += chunk.length;
      }
    } catch (e: any) {
      console.warn('Lỗi Supabase khi sinh lịch định kỳ, lưu fallback sang localStorage:', e);
      // Fallback lưu LocalStorage
      saveBookingsToLocalStorage(bookingsToInsert);
      return {
        success: true,
        totalGenerated,
        insertedCount: lockedSlotsCount,
        skippedConflictCount,
        message: `Đã sinh thành công ${lockedSlotsCount} slot (${bookingsToInsert.length} bản ghi tối ưu) vào bộ nhớ máy! (Lưu ý Supabase: ${e?.message || e})`,
      };
    }
  } else {
    // Chế độ Offline
    saveBookingsToLocalStorage(bookingsToInsert);
    insertedCount = bookingsToInsert.length;
  }

  // Cập nhật cả LocalStorage để đồng bộ ngay lập tức
  saveBookingsToLocalStorage(bookingsToInsert);

  return {
    success: true,
    totalGenerated,
    insertedCount: lockedSlotsCount,
    skippedConflictCount,
    message: `Đã tự động khóa ${lockedSlotsCount} slot thành công (${bookingsToInsert.length} bản ghi tối ưu) cho ${targetDates.length} ngày!${
      skippedConflictCount > 0 ? ` (Đã bỏ qua ${skippedConflictCount} slot do đã có người đặt trước để tránh xung đột).` : ''
    }`,
    newBookings: bookingsToInsert,
    targetDates,
  };
}

/**
 * Xóa/Thu hồi các đơn định kỳ BK_RECUR_ trong một khoảng ngày
 */
export async function deleteRecurringBookings(
  startDate: string,
  endDate: string,
  specificRoomId?: string
): Promise<{ success: boolean; deletedCount: number; message: string }> {
  if (!startDate || !endDate) {
    return { success: false, deletedCount: 0, message: 'Vui lòng chọn khoảng ngày cần xóa.' };
  }

  let deletedCount = 0;
  const client = getSupabaseClient();

  if (client) {
    try {
      let query = client
        .from('bookings')
        .delete()
        .gte('date', startDate)
        .lte('date', endDate)
        .ilike('booking_id', 'BK_RECUR_%');

      if (specificRoomId && specificRoomId !== 'ALL') {
        query = query.eq('room_id', specificRoomId);
      }

      const { error } = await query;
      if (error) {
        console.warn('Supabase delete recurring error:', error);
      }
    } catch (e) {
      console.warn('Exception deleting recurring bookings from Supabase:', e);
    }
  }

  // Xóa trên LocalStorage
  try {
    const raw = localStorage.getItem('vuth_booking_bookings');
    if (raw) {
      const all: Booking[] = JSON.parse(raw);
      const remaining = all.filter((b) => {
        const isRecur = (b.booking_id || '').startsWith('BK_RECUR_');
        const inRange = b.date >= startDate && b.date <= endDate;
        const matchRoom = !specificRoomId || specificRoomId === 'ALL' || b.room_id === specificRoomId;
        if (isRecur && inRange && matchRoom) {
          deletedCount++;
          return false;
        }
        return true;
      });
      localStorage.setItem('vuth_booking_bookings', JSON.stringify(remaining));
    }
  } catch {}

  return {
    success: true,
    deletedCount,
    message: `Đã thu hồi và giải phóng toàn bộ các slot lịch định kỳ từ ngày ${startDate} đến ${endDate}.`,
  };
}

function saveBookingsToLocalStorage(newBookings: Booking[]) {
  try {
    const raw = localStorage.getItem('vuth_booking_bookings');
    const existing: Booking[] = raw ? JSON.parse(raw) : [];
    const merged = [...existing, ...newBookings];
    localStorage.setItem('vuth_booking_bookings', JSON.stringify(merged));
  } catch (e) {
    console.warn('Save bookings to localStorage warning:', e);
  }
}
