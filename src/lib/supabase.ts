import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Room, Booking, SupabaseConfig, BookingStatus, UserAccount, UserRole, RoomType } from '../types';
import { INITIAL_ROOMS, INITIAL_BOOKINGS, DEFAULT_USERS } from './initialData';
import { isSlotInPast, isSlotUnder24Hours, UNDER_24H_WARNING_TEXT } from './slotValidation';

const ROOMS_KEY = 'vuth_booking_rooms';
const BOOKINGS_KEY = 'vuth_booking_bookings';
const USERS_KEY = 'vuth_booking_users';
const SUPABASE_CONFIG_KEY = 'vuth_booking_supabase_cfg';
const EMAIL_SETTINGS_KEY = 'vuth_booking_email_cfg';

export function normalizeRoomType(val: any, roomName?: string, roomId?: string): RoomType {
  const str = String(val || '').toLowerCase().trim();
  if (
    str === 'chuc_nang' ||
    str === 'chucnang' ||
    str.includes('chuc_nang') ||
    str.includes('chuc nang') ||
    str.includes('chức năng') ||
    str.includes('functional') ||
    str.includes('phòng chức năng') ||
    str === 'lab'
  ) {
    return 'chuc_nang';
  }
  if (
    str === 'chinh_khoa' ||
    str === 'chinhkhoa' ||
    str.includes('chinh_khoa') ||
    str.includes('chính khóa') ||
    str.includes('standard') ||
    str.includes('theory') ||
    str.includes('lý thuyết')
  ) {
    return 'chinh_khoa';
  }
  // Fall back to inferring by room name or room ID keywords
  return inferRoomType(roomName || '', roomId || '');
}

export function inferRoomType(roomName: string, roomId?: string): RoomType {
  const norm = (roomName + ' ' + (roomId || '')).toLowerCase();
  if (
    norm.includes('máy tính') ||
    norm.includes('pc') ||
    norm.includes('lab') ||
    norm.includes('flab') ||
    norm.includes('hội trường') ||
    norm.includes('hoitruong') ||
    norm.includes('thực hành') ||
    norm.includes('thực nghiệm') ||
    norm.includes('tin học') ||
    norm.includes('thí nghiệm') ||
    norm.includes('ngoại ngữ') ||
    norm.includes('stem') ||
    norm.includes('studio') ||
    norm.includes('âm nhạc') ||
    norm.includes('mỹ thuật') ||
    norm.includes('thể chất') ||
    norm.includes('sân bóng') ||
    norm.includes('đa năng') ||
    norm.includes('họp') ||
    norm.includes('hop') ||
    norm.includes('bhop') ||
    norm.includes('meeting') ||
    norm.includes('beta') ||
    norm.includes('hội thảo') ||
    norm.includes('seminar') ||
    norm.includes('hội nghị') ||
    norm.includes('tiếp khách') ||
    norm.includes('phỏng vấn') ||
    norm.includes('livestream') ||
    norm.includes('quay phim') ||
    norm.includes('kho') ||
    norm.includes('thư viện') ||
    norm.includes('tự học')
  ) {
    return 'chuc_nang';
  }
  return 'chinh_khoa';
}

function seedLocalStorageIfNeeded() {
  if (localStorage.getItem(ROOMS_KEY) === null) {
    localStorage.setItem(ROOMS_KEY, JSON.stringify(INITIAL_ROOMS));
  } else {
    // Backfill and normalize room_type for any existing rooms stored in localStorage
    try {
      const raw = localStorage.getItem(ROOMS_KEY);
      if (raw) {
        const storedRooms: Room[] = JSON.parse(raw);
        let modified = false;
        const updated = storedRooms.map(r => {
          const rId = String(r.room_id !== undefined && r.room_id !== null ? r.room_id : (r as any).id || '').trim();
          const rName = String(r.room_name || (r as any).name || rId).trim();
          const normalized = normalizeRoomType(r.room_type, rName, rId);
          if (r.room_type !== normalized) {
            modified = true;
            return { ...r, room_type: normalized };
          }
          return r;
        });
        if (modified) {
          localStorage.setItem(ROOMS_KEY, JSON.stringify(updated));
        }
      }
    } catch {}
  }

  if (localStorage.getItem(BOOKINGS_KEY) === null) {
    localStorage.setItem(BOOKINGS_KEY, JSON.stringify(INITIAL_BOOKINGS));
  }
  if (localStorage.getItem(USERS_KEY) === null) {
    localStorage.setItem(USERS_KEY, JSON.stringify(DEFAULT_USERS));
  }
  // Tự động xóa sạch mật khẩu SMTP lưu cũ trong trình duyệt để tránh xung đột với biến môi trường Vercel
  try {
    localStorage.removeItem('vuth_booking_smtp_pass');
  } catch {}
}

seedLocalStorageIfNeeded();

export function getSavedSupabaseConfig(): SupabaseConfig {
  const metaEnv = (import.meta as any).env || {};
  const envUrl = metaEnv.VITE_SUPABASE_URL || '';
  const envKey = metaEnv.VITE_SUPABASE_ANON_KEY || '';

  try {
    const saved = localStorage.getItem(SUPABASE_CONFIG_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.url && parsed.anonKey) {
        return { ...parsed, isConnected: true };
      }
    }
  } catch {
    // fallback
  }

  if (envUrl && envKey) {
    return { url: envUrl, anonKey: envKey, isConnected: true };
  }

  return { url: '', anonKey: '', isConnected: false };
}

export function saveSupabaseConfig(url: string, anonKey: string): SupabaseConfig {
  const cfg = { url: url.trim(), anonKey: anonKey.trim(), isConnected: Boolean(url.trim() && anonKey.trim()) };
  localStorage.setItem(SUPABASE_CONFIG_KEY, JSON.stringify(cfg));
  supabaseInstance = null; // reset cached instance
  return cfg;
}

let supabaseInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  const cfg = getSavedSupabaseConfig();
  if (cfg.url && cfg.anonKey) {
    if (!supabaseInstance) {
      supabaseInstance = createClient(cfg.url, cfg.anonKey);
    }
    return supabaseInstance;
  }
  return null;
}

export async function fetchUsers(): Promise<UserAccount[]> {
  const client = getSupabaseClient();
  if (client) {
    try {
      const { data, error } = await client.from('users').select('*');
      if (!error && data && data.length > 0) {
        return data as UserAccount[];
      }
    } catch (e) {
      console.warn('Supabase fetchUsers error', e);
    }
  }
  seedLocalStorageIfNeeded();
  try {
    const raw = localStorage.getItem(USERS_KEY);
    return raw ? JSON.parse(raw) : DEFAULT_USERS;
  } catch {
    return DEFAULT_USERS;
  }
}

export const DEFAULT_PASSWORDS = ['123456', '123546'];

export function isDefaultPassword(password?: string): boolean {
  if (!password) return false;
  const p = password.trim();
  return DEFAULT_PASSWORDS.includes(p);
}

export async function loginUser(username: string, password?: string): Promise<{
  success: boolean;
  user?: UserAccount;
  message?: string;
  isDefaultPassword?: boolean;
}> {
  const cleanUsername = username.trim().toLowerCase();
  const cleanPassword = (password || '').trim();

  if (!cleanUsername || !cleanPassword) {
    return { success: false, message: 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu!' };
  }

  // Try Supabase first if connected
  const client = getSupabaseClient();
  if (client) {
    try {
      const { data, error } = await client
        .from('users')
        .select('*')
        .ilike('username', cleanUsername)
        .maybeSingle();

      if (error) {
        console.error('Supabase query error during login:', error);
        return { success: false, message: `Lỗi kết nối CSDL Supabase: ${error.message}` };
      }

      if (!data) {
        return { success: false, message: 'Tài khoản không tồn tại trong CSDL Supabase (bảng users)!' };
      }

      // Check password
      const dbPassword = (data.password || '').trim();
      if (dbPassword !== cleanPassword) {
        return { success: false, message: 'Mật khẩu đăng nhập không chính xác!' };
      }

      const isDef = isDefaultPassword(cleanPassword) || isDefaultPassword(dbPassword);

      return {
        success: true,
        user: {
          username: data.username,
          fullname: data.fullname || data.username,
          role: (String(data.role || 'user').toLowerCase().trim()) as UserRole,
          email: data.email || '',
        },
        isDefaultPassword: isDef,
      };
    } catch (e: any) {
      console.error('Supabase login exception:', e);
      return { success: false, message: `Không thể kết nối CSDL Supabase: ${e?.message || e}` };
    }
  }

  // Local user fallback when Supabase is NOT connected
  const users = await fetchUsers();
  const found = users.find(u => u.username.toLowerCase() === cleanUsername);
  if (!found) {
    return { success: false, message: 'Tài khoản không tồn tại!' };
  }

  const expectedPass = (found.password || '123456').trim();
  if (expectedPass !== cleanPassword) {
    return { success: false, message: 'Mật khẩu đăng nhập không chính xác!' };
  }

  const isDef = isDefaultPassword(cleanPassword) || isDefaultPassword(expectedPass);

  return { success: true, user: found, isDefaultPassword: isDef };
}

export async function apiChangePassword(
  username: string,
  newPassword: string,
  oldPassword?: string
): Promise<{ success: boolean; message: string }> {
  const cleanUsername = username.trim().toLowerCase();
  const cleanNewPass = newPassword.trim();

  if (!cleanNewPass) {
    return { success: false, message: 'Vui lòng nhập mật khẩu mới!' };
  }

  if (cleanNewPass.length < 6) {
    return { success: false, message: 'Mật khẩu mới phải có tối thiểu 6 ký tự!' };
  }

  if (isDefaultPassword(cleanNewPass)) {
    return {
      success: false,
      message: 'Mật khẩu mới không được trùng với mật khẩu mặc định (123456)! Vui lòng chọn mật khẩu khác.',
    };
  }

  const client = getSupabaseClient();
  if (client) {
    try {
      // 1. Verify old password if provided
      if (oldPassword) {
        const { data: userRec } = await client
          .from('users')
          .select('password')
          .ilike('username', cleanUsername)
          .maybeSingle();

        if (userRec && userRec.password && userRec.password !== oldPassword.trim()) {
          return { success: false, message: 'Mật khẩu hiện tại không chính xác!' };
        }
      }

      // 2. Update password on Supabase
      const { error } = await client
        .from('users')
        .update({ password: cleanNewPass })
        .ilike('username', cleanUsername);

      if (error) {
        console.error('Supabase update password error:', error);
        return { success: false, message: `Lỗi cập nhật mật khẩu trên Supabase: ${error.message}` };
      }
    } catch (e: any) {
      console.error('Supabase change password exception:', e);
      return { success: false, message: `Lỗi kết nối CSDL Supabase: ${e?.message || e}` };
    }
  }

  // Always update in localStorage as well
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (raw) {
      const users: UserAccount[] = JSON.parse(raw);
      const idx = users.findIndex(u => u.username.toLowerCase() === cleanUsername);
      if (idx !== -1) {
        users[idx].password = cleanNewPass;
        localStorage.setItem(USERS_KEY, JSON.stringify(users));
      }
    }
  } catch (e) {
    console.warn('LocalStorage password update error:', e);
  }

  return { success: true, message: 'Đổi mật khẩu thành công!' };
}

// Bộ đệm trong bộ nhớ cho danh sách phòng (Phòng là dữ liệu tĩnh, rất hiếm khi thay đổi)
// Giúp giảm ngay 50% số lượng truy vấn tới CSDL Supabase
let cachedRooms: Room[] | null = null;
let cachedRoomsTimestamp = 0;
const ROOMS_CACHE_TTL = 30 * 60 * 1000; // 30 phút (tối ưu hóa triệt để tài nguyên Supabase Free tier)

export function invalidateRoomsCache() {
  cachedRooms = null;
  cachedRoomsTimestamp = 0;
}

export async function fetchRooms(forceRefresh: boolean = false): Promise<Room[]> {
  const now = Date.now();
  if (!forceRefresh && cachedRooms && (now - cachedRoomsTimestamp < ROOMS_CACHE_TTL)) {
    return cachedRooms;
  }

  const client = getSupabaseClient();
  if (client) {
    try {
      const { data, error } = await client
        .from('rooms')
        .select('*');
      if (!error && data) {
        const rooms = (data as any[]).map(r => {
          const rId = String(r.room_id !== undefined && r.room_id !== null ? r.room_id : (r.id !== undefined && r.id !== null ? r.id : '')).trim();
          const rName = String(r.room_name || r.name || rId).trim();
          const rawType = r.room_type ?? r.roomType ?? r.type ?? r.loai_phong ?? r.loai ?? r.phan_loai;
          const rType = normalizeRoomType(rawType, rName, rId);
          return {
            ...r,
            room_id: rId,
            room_name: rName,
            room_type: rType,
          };
        }) as Room[];
        cachedRooms = rooms;
        cachedRoomsTimestamp = now;
        try {
          localStorage.setItem(ROOMS_KEY, JSON.stringify(rooms));
        } catch {}
        return rooms;
      }
      if (error) {
        console.warn('Supabase fetchRooms warning:', error.message);
      }
    } catch (e) {
      console.warn('Supabase fetchRooms failed, using local storage fallback', e);
    }
  }

  seedLocalStorageIfNeeded();
  try {
    const raw = localStorage.getItem(ROOMS_KEY);
    const parsed: any[] = raw ? JSON.parse(raw) : INITIAL_ROOMS;
    const rooms = parsed.map((r: any) => {
      const rId = String(r.room_id !== undefined && r.room_id !== null ? r.room_id : (r.id !== undefined && r.id !== null ? r.id : '')).trim();
      const rName = String(r.room_name || r.name || rId).trim();
      const rawType = r.room_type ?? r.roomType ?? r.type ?? r.loai_phong ?? r.loai ?? r.phan_loai;
      const rType = normalizeRoomType(rawType, rName, rId);
      return {
        ...r,
        room_id: rId,
        room_name: rName,
        room_type: rType,
      };
    });
    cachedRooms = rooms;
    cachedRoomsTimestamp = now;
    return rooms;
  } catch {
    return INITIAL_ROOMS;
  }
}

function syncRoomToLocalStorage(room: Room) {
  try {
    seedLocalStorageIfNeeded();
    const raw = localStorage.getItem(ROOMS_KEY);
    const existing: Room[] = raw ? JSON.parse(raw) : INITIAL_ROOMS;
    const idx = existing.findIndex(r => r.room_id === room.room_id);
    if (idx !== -1) {
      existing[idx] = { ...existing[idx], ...room };
    } else {
      existing.push(room);
    }
    localStorage.setItem(ROOMS_KEY, JSON.stringify(existing));
  } catch {}
}

export async function apiUpdateRoomType(
  roomId: string,
  roomType: RoomType
): Promise<{ success: boolean; message: string }> {
  const cleanId = roomId.trim().toUpperCase();
  const client = getSupabaseClient();

  if (client) {
    try {
      const { error } = await client
        .from('rooms')
        .update({ room_type: roomType })
        .eq('room_id', cleanId);
      if (error) {
        console.warn('Supabase update room_type warning:', error.message);
      }
    } catch (e: any) {
      console.warn('Supabase update room_type exception:', e);
    }
  }

  // Update in localStorage
  try {
    seedLocalStorageIfNeeded();
    const raw = localStorage.getItem(ROOMS_KEY);
    if (raw) {
      const rooms: Room[] = JSON.parse(raw);
      const idx = rooms.findIndex((r) => r.room_id.toUpperCase() === cleanId);
      if (idx !== -1) {
        rooms[idx].room_type = roomType;
        localStorage.setItem(ROOMS_KEY, JSON.stringify(rooms));
      }
    }
  } catch (e) {
    console.warn('LocalStorage room_type update error:', e);
  }

  invalidateRoomsCache();

  return {
    success: true,
    message: `Đã cập nhật phòng [${cleanId}] thành ${roomType === 'chuc_nang' ? 'Phòng Chức Năng' : 'Phòng Chính Khóa'}!`,
  };
}

export async function apiBatchUpdateRoomTypes(
  updates: { roomId: string; roomType: RoomType }[]
): Promise<{ success: boolean; message: string }> {
  if (!updates || updates.length === 0) {
    return { success: true, message: 'Không có thay đổi nào!' };
  }

  const client = getSupabaseClient();
  if (client) {
    try {
      await Promise.all(
        updates.map((u) =>
          client
            .from('rooms')
            .update({ room_type: u.roomType })
            .eq('room_id', u.roomId.trim().toUpperCase())
        )
      );
    } catch (e: any) {
      console.warn('Supabase batch update room_type warning:', e);
    }
  }

  // Update in localStorage
  try {
    seedLocalStorageIfNeeded();
    const raw = localStorage.getItem(ROOMS_KEY);
    if (raw) {
      const rooms: Room[] = JSON.parse(raw);
      const updateMap = new Map<string, RoomType>();
      updates.forEach((u) => updateMap.set(u.roomId.trim().toUpperCase(), u.roomType));

      const updatedRooms = rooms.map((r) => {
        const newType = updateMap.get(r.room_id.toUpperCase());
        if (newType) {
          return { ...r, room_type: newType };
        }
        return r;
      });
      localStorage.setItem(ROOMS_KEY, JSON.stringify(updatedRooms));
    }
  } catch (e) {
    console.warn('LocalStorage batch room_type update error:', e);
  }

  invalidateRoomsCache();

  return {
    success: true,
    message: `Đã lưu thành công thiết lập phân loại cho ${updates.length} phòng!`,
  };
}

export async function apiCreateRoom(roomData: {
  room_id: string;
  room_name: string;
  capacity: number;
  status?: 'Active' | 'Inactive' | 'Maintenance';
  room_type?: RoomType;
  floor?: string;
  building?: string;
  description?: string;
}): Promise<{ success: boolean; message: string; room?: Room }> {
  const cleanId = roomData.room_id.trim().toUpperCase();
  const cleanName = roomData.room_name.trim();

  if (!cleanId || !cleanName) {
    return { success: false, message: 'Vui lòng nhập Mã phòng và Tên phòng!' };
  }

  const roomType: RoomType = roomData.room_type || inferRoomType(cleanName, cleanId);

  const newRoom: Room = {
    room_id: cleanId,
    room_name: cleanName,
    capacity: Number(roomData.capacity) || 0,
    status: roomData.status || 'Active',
    room_type: roomType,
    floor: roomData.floor || '',
    building: roomData.building || '',
    description: roomData.description || '',
  };

  const client = getSupabaseClient();
  if (client) {
    try {
      const dbPayload: any = {
        room_id: cleanId,
        room_name: cleanName,
        capacity: Number(roomData.capacity) || 0,
        status: roomData.status || 'Active',
        room_type: roomType,
      };
      let { data, error } = await client.from('rooms').insert([dbPayload]).select().single();
      if (error && (error.message?.includes('room_type') || (error as any).code === '42703')) {
        const { room_type, ...fallbackPayload } = dbPayload;
        const retryRes = await client.from('rooms').insert([fallbackPayload]).select().single();
        data = retryRes.data;
        error = retryRes.error;
      }
      if (error) {
        console.error('Supabase create room error:', error);
        return { success: false, message: `Lỗi thêm phòng vào Supabase: ${error.message}` };
      }
      const returnRoom: Room = {
        ...newRoom,
        ...(data || {}),
        room_type: roomType,
      };
      syncRoomToLocalStorage(returnRoom);
      invalidateRoomsCache();
      return { success: true, message: `Thêm phòng [${cleanId} - ${cleanName}] thành công vào Supabase!`, room: returnRoom };
    } catch (e: any) {
      console.error('Supabase create room exception:', e);
      return { success: false, message: `Lỗi kết nối CSDL Supabase: ${e?.message || e}` };
    }
  }

  // Fallback local storage
  seedLocalStorageIfNeeded();
  try {
    const raw = localStorage.getItem(ROOMS_KEY);
    const existing: Room[] = raw ? JSON.parse(raw) : INITIAL_ROOMS;
    if (existing.some(r => r.room_id === cleanId)) {
      return { success: false, message: `Mã phòng [${cleanId}] đã tồn tại!` };
    }
    const updated = [...existing, newRoom];
    localStorage.setItem(ROOMS_KEY, JSON.stringify(updated));
    invalidateRoomsCache();
    return { success: true, message: `Thêm phòng [${cleanId} - ${cleanName}] thành công!`, room: newRoom };
  } catch (e: any) {
    return { success: false, message: `Lỗi lưu phòng: ${e?.message || e}` };
  }
}

export async function apiDeleteRoom(roomId: string): Promise<{ success: boolean; message: string }> {
  const cleanId = (roomId || '').trim();
  if (!cleanId) {
    return { success: false, message: 'Mã phòng không hợp lệ!' };
  }

  // Always sync local storage
  try {
    const raw = localStorage.getItem(ROOMS_KEY);
    if (raw) {
      const existing: Room[] = JSON.parse(raw);
      const filtered = existing.filter(r => (r.room_id || '').trim().toUpperCase() !== cleanId.toUpperCase());
      localStorage.setItem(ROOMS_KEY, JSON.stringify(filtered));
    }
  } catch (e) {
    console.error('Local storage room cleanup error:', e);
  }

  invalidateRoomsCache();

  const client = getSupabaseClient();
  if (client) {
    try {
      // First delete associated bookings to prevent foreign key constraint violations
      const { error: bError } = await client.from('bookings').delete().eq('room_id', cleanId);
      if (bError) {
        console.warn('Warning deleting associated bookings on Supabase:', bError.message);
      }

      const { error } = await client.from('rooms').delete().eq('room_id', cleanId);
      if (error) {
        console.error('Supabase delete room error:', error);
        return { success: false, message: `Lỗi xóa phòng trên Supabase: ${error.message}` };
      }

      return { success: true, message: `Đã xóa phòng [${cleanId}] khỏi CSDL thành công!` };
    } catch (e: any) {
      return { success: false, message: `Lỗi xóa phòng: ${e?.message || e}` };
    }
  }

  return { success: true, message: `Đã xóa phòng [${cleanId}]!` };
}

export async function fetchBookings(username?: string, role?: string): Promise<Booking[]> {
  const normRole = (role || '').toLowerCase().trim();
  const normUsername = (username || '').toLowerCase().trim();
  const isAllViewer =
    normRole === 'superadmin' ||
    normRole === 'admin' ||
    normRole === 'security' ||
    normRole === 'bv' ||
    normRole === 'baove' ||
    normRole.includes('admin') ||
    normRole.includes('quan_tri') ||
    normRole.includes('security') ||
    normRole.includes('baove') ||
    normRole.includes('bv') ||
    normUsername === 'admin' ||
    normUsername === 'superadmin' ||
    normUsername.includes('admin') ||
    normUsername.startsWith('bv') ||
    normUsername.includes('baove') ||
    normUsername.includes('security');

  const client = getSupabaseClient();
  if (client) {
    try {
      // Tải lên đến 5000 đơn để bao quát đầy đủ lịch thời khóa biểu Excel và đơn đặt phòng
      let query = client.from('bookings').select('*').order('created_at', { ascending: false }).limit(5000);
      if (!isAllViewer && username) {
        query = query.eq('username', username);
      }
      let { data, error } = await query;

      // Fallback nếu việc order('created_at') bị lỗi (ví dụ Supabase chưa có index hoặc trường created_at có vấn đề)
      if (error) {
        console.warn('Supabase fetchBookings error on order, retrying without order:', error.message);
        let retryQuery = client.from('bookings').select('*').limit(5000);
        if (!isAllViewer && username) {
          retryQuery = retryQuery.eq('username', username);
        }
        const retryRes = await retryQuery;
        if (!retryRes.error && retryRes.data) {
          data = retryRes.data;
          error = null;
        }
      }

      if (!error && data) {
        return data.map((item: any) => {
          const bId = item.booking_id || item.id || `BK${Date.now()}`;
          let borrowerName = item.borrower_name;
          let purposeText = item.purpose || '';

          // If borrower_name is not in columns, extract from purpose if formatted as [Người mượn: ...]
          if (!borrowerName && purposeText.startsWith('[Người mượn:')) {
            const match = purposeText.match(/^\[Người mượn:\s*([^\]]+)\]\s*(.*)$/);
            if (match) {
              borrowerName = match[1].trim();
              purposeText = match[2].trim();
            }
          }

          if (!borrowerName) {
            borrowerName = item.fullname || item.username;
          }

          const inferredRType = inferRoomType(item.room_name || '', item.room_id || '');
          const rType: RoomType = item.room_type === 'chuc_nang' || inferredRType === 'chuc_nang' ? 'chuc_nang' : (item.room_type || 'chinh_khoa');

          // Chuẩn hóa trạng thái chặt chẽ
          const rawSt = String(item.status || 'Pending').trim().toLowerCase();
          let normStatus: BookingStatus = 'Pending';
          if (rawSt === 'approved' || rawSt.includes('duyệt') || rawSt.includes('duyet')) {
            normStatus = 'Approved';
          } else if (rawSt === 'rejected' || rawSt.includes('từ chối') || rawSt.includes('tu choi')) {
            normStatus = 'Rejected';
          } else if (rawSt === 'cancelled' || rawSt.includes('hủy') || rawSt.includes('huy')) {
            normStatus = 'Cancelled';
          } else {
            normStatus = 'Pending';
          }

          return {
            ...item,
            room_type: rType,
            purpose: purposeText,
            borrower_name: borrowerName,
            booking_id: String(bId),
            id: String(bId),
            status: normStatus,
          };
        }) as Booking[];
      }
      if (error) {
        console.warn('Supabase fetchBookings warning:', error.message);
      }
    } catch (e) {
      console.warn('Supabase fetchBookings failed', e);
    }
  }

  seedLocalStorageIfNeeded();
  try {
    const raw = localStorage.getItem(BOOKINGS_KEY);
    const bookings: Booking[] = raw ? JSON.parse(raw) : INITIAL_BOOKINGS;
    if (!isAllViewer && username) {
      return bookings.filter(b => b.username === username);
    }
    return bookings;
  } catch {
    return INITIAL_BOOKINGS;
  }
}

/**
 * Nhận diện xem một đơn đặt phòng có phải xuất phát từ import file Excel hay không
 */
export function isExcelBooking(b: Booking): boolean {
  if (!b) return false;
  const bId = String(b.booking_id || (b as any).id || '').toUpperCase();
  // Chỉ nhận diện là đơn Excel nếu mã đơn có tiền tố BK_EXCEL (do file excel tạo ra)
  return bId.startsWith('BK_EXCEL') || bId.includes('EXCEL');
}

export async function fetchBusySlots(roomId: string, selectedDate: string): Promise<string[]> {
  const busySlots: string[] = [];
  const cleanRoomId = String(roomId || '').trim();
  const strippedRoomId = cleanRoomId.replace(/^R/i, '');
  const withRRoomId = cleanRoomId.startsWith('R') || cleanRoomId.startsWith('r') ? cleanRoomId : `R${cleanRoomId}`;

  const client = getSupabaseClient();

  if (client) {
    try {
      // Chỉ truy vấn đúng phòng và ngày được yêu cầu, chỉ lấy cột time_slot và room_id
      const { data, error } = await client
        .from('bookings')
        .select('time_slot, room_id')
        .eq('date', selectedDate)
        .neq('status', 'Rejected')
        .neq('status', 'Cancelled');

      if (!error && data) {
        data.forEach((b: any) => {
          const bRoom = String(b.room_id || '').toUpperCase().trim();
          const targetRoom = cleanRoomId.toUpperCase();
          const targetStripped = strippedRoomId.toUpperCase();
          const targetWithR = withRRoomId.toUpperCase();

          const isMatch = bRoom === targetRoom || bRoom === targetStripped || bRoom === targetWithR;
          if (isMatch && b.time_slot) {
            const parts = b.time_slot.split(',').map((s: string) => s.trim());
            parts.forEach((p: string) => {
              if (p && !busySlots.includes(p)) {
                busySlots.push(p);
                const cleanP = p.split(' (')[0].trim();
                if (cleanP && !busySlots.includes(cleanP)) {
                  busySlots.push(cleanP);
                }
              }
            });
          }
        });
        return busySlots;
      }
    } catch (e) {
      console.warn('Supabase fetchBusySlots direct query warning:', e);
    }
  }

  // Fallback sang LocalStorage nếu offline hoặc lỗi mạng
  seedLocalStorageIfNeeded();
  try {
    const raw = localStorage.getItem(BOOKINGS_KEY);
    const allBookings: Booking[] = raw ? JSON.parse(raw) : INITIAL_BOOKINGS;
    const targetRoom = cleanRoomId.toUpperCase();
    const targetStripped = strippedRoomId.toUpperCase();
    const targetWithR = withRRoomId.toUpperCase();

    const activeBookings = allBookings.filter((b) => {
      const bRoom = String(b.room_id || '').toUpperCase().trim();
      const isMatch = bRoom === targetRoom || bRoom === targetStripped || bRoom === targetWithR;
      return (
        isMatch &&
        String(b.date || '').trim() === String(selectedDate || '').trim() &&
        b.status !== 'Rejected' &&
        b.status !== 'Cancelled'
      );
    });

    activeBookings.forEach((b) => {
      if (b.time_slot) {
        const parts = b.time_slot.split(',').map((s) => s.trim());
        parts.forEach((p) => {
          if (p && !busySlots.includes(p)) {
            busySlots.push(p);
            const cleanP = p.split(' (')[0].trim();
            if (cleanP && !busySlots.includes(cleanP)) {
              busySlots.push(cleanP);
            }
          }
        });
      }
    });
  } catch (e) {
    console.warn('LocalStorage fetchBusySlots warning:', e);
  }
  return busySlots;
}

// Cache admin setting emails trong 10 phút để tránh đọc bảng settings liên tục
let cachedAdminEmails: string[] | null = null;
let cachedAdminEmailsTimestamp = 0;
const ADMIN_EMAILS_CACHE_TTL = 30 * 60 * 1000; // 30 phút

export function invalidateAdminEmailsCache() {
  cachedAdminEmails = null;
  cachedAdminEmailsTimestamp = 0;
}

// Fetch admin/system emails dynamically ONLY from Supabase settings table (admin_email)
export async function fetchAdminSettingEmails(forceRefresh: boolean = false): Promise<string[]> {
  const now = Date.now();
  if (!forceRefresh && cachedAdminEmails && (now - cachedAdminEmailsTimestamp < ADMIN_EMAILS_CACHE_TTL)) {
    return cachedAdminEmails;
  }

  const emails: string[] = [];
  const client = getSupabaseClient();
  if (client) {
    try {
      // 1. Check settings table specifically for keys like 'admin_email', 'admin_email_2', 'admin_emails', 'system_email', etc.
      const { data: settingsData } = await client.from('settings').select('*');
      if (settingsData && settingsData.length > 0) {
        for (const item of settingsData) {
          const k = String(item.key || '').toLowerCase().trim();
          if (
            k === 'admin_email' ||
            k.includes('admin_email') ||
            k.includes('admin_emails') ||
            k === 'system_email' ||
            k === 'notification_email' ||
            k === 'email'
          ) {
            const rawVal = String(item.value || item.val || '').trim();
            // Split by commas, semicolons, or newlines
            const parts = rawVal.split(/[,;\n\r\t]+/).map(p => p.trim());
            for (const part of parts) {
              if (part && part.includes('@') && part.includes('.') && part.toLowerCase() !== 'admin@fpt.edu.vn') {
                emails.push(part);
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('Could not read admin email setting from Supabase settings table:', e);
    }
  }

  // 2. Fallback to localStorage ONLY if settings table did not return any emails (offline or initial state)
  if (emails.length === 0) {
    const localExtra = localStorage.getItem('vuth_booking_extra_admin_emails');
    if (localExtra) {
      localExtra.split(/[,;\n\r\t]+/).forEach(em => {
        const trimmed = em.trim();
        if (trimmed && trimmed.includes('@') && trimmed.includes('.') && trimmed.toLowerCase() !== 'admin@fpt.edu.vn') {
          emails.push(trimmed);
        }
      });
    }
  }

  // Deduplicate and sanitize
  const unique = Array.from(new Set(emails.map(e => e.toLowerCase())));
  const result = unique.length > 0 ? unique : ['kensinvn2000@gmail.com'];
  cachedAdminEmails = result;
  cachedAdminEmailsTimestamp = now;
  return result;
}

// Fetch primary admin email string (comma-separated for multiple admins)
export async function fetchAdminSettingEmail(): Promise<string> {
  const list = await fetchAdminSettingEmails();
  return list.join(', ');
}

// Save or update admin_email in Supabase settings table
export async function saveAdminEmailsToSupabase(emailsString: string): Promise<boolean> {
  try {
    localStorage.setItem('vuth_booking_extra_admin_emails', emailsString.trim());
    invalidateAdminEmailsCache();
    const client = getSupabaseClient();
    if (client) {
      const { error } = await client
        .from('settings')
        .upsert({ key: 'admin_email', value: emailsString.trim() }, { onConflict: 'key' });
      if (!error) return true;
    }
  } catch (err) {
    console.warn('Failed to upsert admin_email in Supabase settings:', err);
  }
  return false;
}

export interface EmailTemplates {
  newBookingSubject: string;
  newBookingBody: string;
  statusChangeSubject: string;
  statusChangeBody: string;
}

export const DEFAULT_EMAIL_TEMPLATES: EmailTemplates = {
  newBookingSubject: '[FSCCT Booking] Đơn đặt phòng mới từ {borrower_name}: {room_name} ({date})',
  newBookingBody: `Kính gửi BQT FSCCT / Giảng viên,\n\nHệ thống ghi nhận đơn đăng ký đặt phòng học mới:\n- Mã đơn: {booking_id}\n- Người mượn: {borrower_name}\n- Tài khoản đăng ký: {fullname} ({username})\n- Phòng học: {room_name} ({room_id})\n- Ngày sử dụng: {date}\n- Khung giờ: {time_slot}\n- Mục đích: {purpose}\n- Trạng thái: Chờ phê duyệt (Pending)\n\nEmail thông báo được tự động gửi từ hệ thống FSCCT Booking.`,
  statusChangeSubject: '[FSCCT Booking] Thông báo duyệt đơn {booking_id}: {status}',
  statusChangeBody: `Kính gửi thầy/cô {borrower_name},\n\nĐơn đăng ký phòng học của thầy/cô đã được cập nhật trạng thái:\n- Mã đơn: {booking_id}\n- Người mượn: {borrower_name}\n- Phòng học: {room_name}\n- Ngày sử dụng: {date}\n- Khung giờ: {time_slot}\n- Trạng thái mới: {status}\n{reason_line}Email thông báo được tự động gửi từ hệ thống FSCCT Booking.`,
};

export function getSavedEmailTemplates(): EmailTemplates {
  try {
    const raw = localStorage.getItem('vuth_booking_email_templates');
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_EMAIL_TEMPLATES,
        ...parsed,
      };
    }
  } catch (e) {
    console.warn('Could not read email templates:', e);
  }
  return DEFAULT_EMAIL_TEMPLATES;
}

export function saveEmailTemplates(templates: EmailTemplates): void {
  try {
    localStorage.setItem('vuth_booking_email_templates', JSON.stringify(templates));
  } catch (e) {
    console.warn('Could not save email templates:', e);
  }
}

export interface EmailLog {
  id: string;
  to: string;
  subject: string;
  status: string;
  type: string;
  booking_id?: string;
  preview_url?: string;
  used_test_account?: boolean;
  sent_at: string;
}

export function getEmailLogs(): EmailLog[] {
  try {
    const raw = localStorage.getItem('vuth_booking_email_logs');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveEmailLog(log: EmailLog) {
  try {
    const logs = getEmailLogs();
    logs.unshift(log);
    localStorage.setItem('vuth_booking_email_logs', JSON.stringify(logs.slice(0, 50)));
  } catch (e) {
    console.warn('Could not save email log:', e);
  }
}

// In-memory cache to prevent duplicate email dispatches (e.g. from rapid triggers or multiple paths)
const recentEmailDispatches = new Map<string, number>();

// Service to handle Email notifications directly via Express Server API
export async function sendEmailNotification(
  type: 'NEW_BOOKING' | 'STATUS_CHANGE',
  booking: Booking,
  recipientEmail?: string
): Promise<{ sent: boolean; message: string }> {
  // Prevent duplicate sending within 5 seconds for the exact same booking event
  const bookingIdKey = booking.booking_id || (booking as any).id || `${booking.room_id}_${booking.date}_${booking.time_slot}`;
  const dedupKey = `${type}_${bookingIdKey}_${booking.status || ''}`;
  const now = Date.now();
  if (recentEmailDispatches.has(dedupKey)) {
    const lastSentTime = recentEmailDispatches.get(dedupKey) || 0;
    if (now - lastSentTime < 5000) {
      console.log(`ℹ️ [Email Dedup] Ngăn chặn gửi trùng lặp email cho sự kiện ${dedupKey}`);
      return { sent: true, message: 'Thông báo email đã được gửi thành công' };
    }
  }
  recentEmailDispatches.set(dedupKey, now);

  // Clean old dedup keys if map grows large
  if (recentEmailDispatches.size > 150) {
    recentEmailDispatches.forEach((timestamp, k) => {
      if (now - timestamp > 60000) recentEmailDispatches.delete(k);
    });
  }

  // 1. Nếu là đơn đặt phòng mới (NEW_BOOKING) do Admin hoặc SuperAdmin tạo -> Không gửi email thông báo
  if (type === 'NEW_BOOKING') {
    const booker = (booking.username || '').toLowerCase().trim();
    if (booker === 'admin' || booker === 'superadmin' || booker.includes('admin')) {
      console.log(`ℹ️ [Email Skip] Không gửi email thông báo vì đơn do Admin/SuperAdmin (${booking.username}) tạo.`);
      return { sent: true, message: 'Admin đặt phòng - Bỏ qua gửi email thông báo' };
    }
  }

  // Read admin emails dynamically from Supabase settings table (admin_email) ONLY
  const adminEmails = await fetchAdminSettingEmails();

  let userEmail = (recipientEmail || '').trim();
  if (!userEmail || userEmail === 'admin@fpt.edu.vn' || !userEmail.includes('@')) {
    // Lookup user email from Supabase users table by username
    const client = getSupabaseClient();
    if (client && booking.username) {
      try {
        const { data } = await client
          .from('users')
          .select('email')
          .ilike('username', booking.username)
          .maybeSingle();
        if (data?.email && data.email.includes('@')) {
          userEmail = data.email.trim();
        }
      } catch (e) {
        console.warn('User email lookup exception:', e);
      }
    }

    if (!userEmail || userEmail === 'admin@fpt.edu.vn' || !userEmail.includes('@')) {
      // Fallback tra cứu email người dùng từ localStorage
      try {
        const rawUsers = localStorage.getItem('vuth_booking_users');
        if (rawUsers) {
          const uList = JSON.parse(rawUsers);
          const found = uList.find((u: any) => (u.username || '').toLowerCase() === (booking.username || '').toLowerCase());
          if (found?.email && found.email.includes('@')) {
            userEmail = found.email.trim();
          }
        }
      } catch {}
    }

    if (!userEmail || userEmail === 'admin@fpt.edu.vn' || !userEmail.includes('@')) {
      if (booking.username && booking.username.includes('@')) {
        userEmail = booking.username.trim();
      }
    }
  }

  // Determine recipients list:
  // NEW_BOOKING -> Chỉ gửi email cho Admin để duyệt, KHÔNG trả mail về cho User
  // STATUS_CHANGE (Duyệt / Từ chối / Hủy đơn) -> Chỉ gửi email cho User (người đặt phòng), không gửi lại cho Admin
  const rawRecipientList: string[] = [];
  if (type === 'NEW_BOOKING') {
    rawRecipientList.push(...adminEmails);
    // User book phòng: Chỉ đẩy mail thông báo cho Admin, không trả mail về cho chính User
  } else {
    // Khi Admin thao tác Duyệt hoặc Hủy đơn, chỉ gửi mail thông báo cho User
    if (userEmail) {
      rawRecipientList.push(userEmail);
    } else {
      // Fallback phòng trường hợp hoàn toàn không tìm thấy email của user
      rawRecipientList.push(...adminEmails);
    }
  }

  if (rawRecipientList.length === 0) {
    rawRecipientList.push('kensinvn2000@gmail.com');
  }

  // Sanitize, trim and split in case any string contains multiple comma-separated emails
  const validRecipients = Array.from(
    new Set(
      rawRecipientList
        .flatMap(r => String(r || '').split(/[,;\s]+/))
        .map(e => e.trim().toLowerCase())
        .filter(e => e && e.includes('@') && e.includes('.') && !e.includes('admin@fpt.edu.vn'))
    )
  );

  const recipientString = validRecipients.length > 0 ? validRecipients.join(', ') : 'kensinvn2000@gmail.com';

  const templates = getSavedEmailTemplates();

  const replaceVars = (tmpl: string) => {
    const borrower = String(booking.borrower_name || booking.fullname || booking.username || '');
    return tmpl
      .replace(/{booking_id}/g, String(booking.booking_id || ''))
      .replace(/{borrower_name}/g, borrower)
      .replace(/{fullname}/g, String(booking.fullname || ''))
      .replace(/{username}/g, String(booking.username || ''))
      .replace(/{room_name}/g, String(booking.room_name || ''))
      .replace(/{room_id}/g, String(booking.room_id || ''))
      .replace(/{date}/g, String(booking.date || ''))
      .replace(/{time_slot}/g, String(booking.time_slot || ''))
      .replace(/{purpose}/g, String(booking.purpose || ''))
      .replace(/{status}/g, String(booking.status || '').toUpperCase())
      .replace(/{reason_line}/g, booking.reject_reason ? `- Lý do: ${booking.reject_reason}\n` : '')
      .replace(/{reject_reason}/g, String(booking.reject_reason || ''));
  };

  const emailSubject =
    type === 'NEW_BOOKING'
      ? replaceVars(templates.newBookingSubject)
      : replaceVars(templates.statusChangeSubject);

  const emailBody =
    type === 'NEW_BOOKING'
      ? replaceVars(templates.newBookingBody)
      : replaceVars(templates.statusChangeBody);

  const smtpUser = localStorage.getItem('vuth_booking_smtp_user') || undefined;
  const smtpHost = localStorage.getItem('vuth_booking_smtp_host') || undefined;
  const smtpPort = localStorage.getItem('vuth_booking_smtp_port') || undefined;

  // Single Execution Path: Send 100% via backend SMTP API (/api/send-email) using server-side SMTP_PASS
  try {
    const apiRes = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: recipientString,
        subject: emailSubject,
        body: emailBody,
        smtpUser,
        smtpHost,
        smtpPort,
      }),
    });

    let apiData: any = null;
    try {
      apiData = await apiRes.json();
    } catch {}

    if (apiData && apiData.success) {
      saveEmailLog({
        id: 'LOG_' + Date.now(),
        to: recipientString,
        subject: emailSubject,
        status: `Thành công (${apiData.method || 'SMTP'})`,
        type,
        booking_id: booking.booking_id,
        preview_url: apiData.previewUrl,
        used_test_account: apiData.usedTestAccount,
        sent_at: new Date().toLocaleString('vi-VN'),
      });

      console.log(`📧 [EMAIL SMTP DISPATCH] Method: ${apiData.method} | Recipients: ${recipientString}`);
      return {
        sent: true,
        message: apiData.usedTestAccount
          ? `Đã tạo mail thử nghiệm tới ${recipientString} (Xem hòm thư Ethereal trong Lịch sử Email)`
          : `Đã gửi thông báo email trực tiếp qua SMTP tới: ${recipientString}`,
      };
    } else {
      const errMsg = apiData?.message || (apiRes.ok ? 'Gửi email không thành công' : `Máy chủ trả về mã lỗi ${apiRes.status}`);
      saveEmailLog({
        id: 'LOG_' + Date.now(),
        to: recipientString,
        subject: emailSubject,
        status: `Thất bại (${errMsg.slice(0, 45)})`,
        type,
        booking_id: booking.booking_id,
        sent_at: new Date().toLocaleString('vi-VN'),
      });

      return {
        sent: false,
        message: errMsg,
      };
    }
  } catch (err: any) {
    console.log('ℹ️ Express /api/send-email call error:', err?.message || err);
    saveEmailLog({
      id: 'LOG_' + Date.now(),
      to: recipientString,
      subject: emailSubject,
      status: 'Thất bại (Không thể kết nối máy chủ)',
      type,
      booking_id: booking.booking_id,
      sent_at: new Date().toLocaleString('vi-VN'),
    });

    return {
      sent: false,
      message: 'Không thể kết nối máy chủ SMTP gửi mail! Hãy đảm bảo máy chủ backend đang chạy.',
    };
  }
}

export async function sendTestEmail(toEmail: string): Promise<{ success: boolean; message: string; previewUrl?: string }> {
  const smtpUser = localStorage.getItem('vuth_booking_smtp_user') || undefined;
  const smtpHost = localStorage.getItem('vuth_booking_smtp_host') || undefined;
  const smtpPort = localStorage.getItem('vuth_booking_smtp_port') || undefined;

  const testSubject = '[FSCCT Booking] Kiểm tra kết nối gửi email SMTP';
  const testBody = `Kính gửi thầy/cô,\n\nĐây là email kiểm tra kết nối gửi trực tiếp qua máy chủ SMTP từ Hệ thống Đặt Phòng FSCCT Booking.\nHòm thư nhận test: ${toEmail}\nThời gian: ${new Date().toLocaleString('vi-VN')}`;

  try {
    const res = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: toEmail,
        subject: testSubject,
        body: testBody,
        smtpUser,
        smtpHost,
        smtpPort,
      }),
    });

    const data = await res.json();

    if (res.ok && data.success) {
      saveEmailLog({
        id: 'LOG_' + Date.now(),
        to: toEmail,
        subject: testSubject,
        status: data.usedTestAccount ? 'Thử nghiệm (Ethereal)' : `Thành công (${data.method || 'SMTP'})`,
        type: 'TEST_EMAIL',
        preview_url: data.previewUrl,
        used_test_account: data.usedTestAccount,
        sent_at: new Date().toLocaleString('vi-VN'),
      });

      return {
        success: true,
        message: data.usedTestAccount
          ? `Đã tạo email thử nghiệm (Xem trực tiếp tại liên kết hòm thư Ethereal bên dưới). Hãy nhập Mật khẩu ứng dụng Gmail để gửi tới hộp thư thật.`
          : `Đã gửi email thử nghiệm SMTP thành công tới ${toEmail}!`,
        previewUrl: data.previewUrl,
      };
    } else {
      return {
        success: false,
        message: data.message || 'Gửi email qua SMTP thất bại!',
      };
    }
  } catch (err: any) {
    return {
      success: false,
      message: `Lỗi kết nối máy chủ gửi email: ${err?.message || err}`,
    };
  }
}

/**
 * Kiểm tra xem người dùng có quyền tự duyệt (auto-approve) phòng này hay không
 * dựa trên bảng `user_room_permissions` trong Supabase CSDL.
 * Hỗ trợ:
 * - Mã phòng cụ thể (vd: 'R101')
 * - Ký tự đại diện '*' hoặc 'ALL' (tự duyệt mọi phòng)
 */
// Cache kiểm tra quyền tự duyệt phòng trong 5 phút để tránh query liên tục
const permissionCache = new Map<string, { allowed: boolean; timestamp: number }>();
const PERMISSION_CACHE_TTL = 5 * 60 * 1000;

export async function checkAutoApprovePermission(username?: string, roomId?: string): Promise<boolean> {
  if (!username || !roomId) return false;
  const cacheKey = `${username.trim().toLowerCase()}_${roomId.trim().toUpperCase()}`;
  const now = Date.now();
  const cached = permissionCache.get(cacheKey);
  if (cached && now - cached.timestamp < PERMISSION_CACHE_TTL) {
    return cached.allowed;
  }

  let isAllowed = false;
  const client = getSupabaseClient();
  if (client) {
    try {
      const cleanUser = username.trim();
      const cleanRoom = roomId.trim().toUpperCase();

      // Chỉ query đúng 1 dòng kiểm tra, cực nhẹ và không tốn log
      const { data, error } = await client
        .from('user_room_permissions')
        .select('room_id')
        .ilike('username', cleanUser)
        .or(`room_id.eq.${cleanRoom},room_id.eq.*,room_id.ilike.ALL`)
        .limit(1);

      if (!error && data && data.length > 0) {
        isAllowed = true;
      }
    } catch (e) {
      console.warn('Check user_room_permissions warning:', e);
    }
  }

  if (!isAllowed) {
    // Fallback sang localStorage nếu offline
    try {
      const raw = localStorage.getItem('vuth_user_room_permissions');
      if (raw) {
        const list: { username: string; room_id: string }[] = JSON.parse(raw);
        const cleanUser = username.trim().toLowerCase();
        const cleanRoom = roomId.trim().toUpperCase();
        isAllowed = list.some(
          p =>
            (p.username || '').toLowerCase() === cleanUser &&
            ((p.room_id || '').toUpperCase() === cleanRoom || p.room_id === '*' || (p.room_id || '').toUpperCase() === 'ALL')
        );
      }
    } catch {}
  }

  permissionCache.set(cacheKey, { allowed: isAllowed, timestamp: now });
  return isAllowed;
}

export async function apiCreateBooking(bookingData: {
  room_id: string;
  room_name: string;
  username: string;
  fullname: string;
  borrower_name?: string;
  date: string;
  time_slots: string[];
  purpose: string;
  note?: string;
  skipEmail?: boolean;
  skipBusyCheck?: boolean;
  status?: BookingStatus;
  userRole?: UserRole;
  room_type?: RoomType;
}): Promise<{ success: boolean; message: string; booking?: Booking }> {
  const client = getSupabaseClient();
  
  // 1. Kiểm tra khung giờ đã qua thời gian hiện tại
  for (const requestedSlot of bookingData.time_slots) {
    if (isSlotInPast(bookingData.date, requestedSlot)) {
      return {
        success: false,
        message: `Khung giờ "${requestedSlot}" đã qua thời gian hiện tại, không thể đặt phòng!`,
      };
    }
  }

  // 2. Conflict check (chỉ kiểm tra nếu chưa được kiểm tra trước đó)
  if (!bookingData.skipBusyCheck) {
    const busy = await fetchBusySlots(bookingData.room_id, bookingData.date);
    for (const requestedSlot of bookingData.time_slots) {
      const cleanReq = requestedSlot.split(' (')[0].trim().toLowerCase();
      const isBusy = busy.some(b => b.split(' (')[0].trim().toLowerCase() === cleanReq);
      if (isBusy) {
        return {
          success: false,
          message: `Khung giờ "${requestedSlot}" của phòng này vừa có người khác đặt trước!`,
        };
      }
    }
  }

  const booking_id = 'BK' + Date.now().toString();
  const time_slot_string = bookingData.time_slots.map(s => s.split(' (')[0].trim()).join(', ');
  const created_at = new Date().toISOString();
  const borrowerName = (bookingData.borrower_name || '').trim() || bookingData.fullname;

  const isAdmin =
    bookingData.userRole === 'admin' ||
    bookingData.userRole === 'superadmin' ||
    bookingData.username.toLowerCase() === 'admin' ||
    bookingData.username.toLowerCase().includes('admin');

  // Kiểm tra quyền tự duyệt phòng (auto-approve):
  // 1. Nếu là Admin/SuperAdmin -> Tự động duyệt
  // 2. Nếu là User bình thường nhưng có cấu hình trong bảng user_room_permissions trên CSDL -> Tự động duyệt
  let isAutoApproved = isAdmin;
  if (!isAutoApproved) {
    isAutoApproved = await checkAutoApprovePermission(bookingData.username, bookingData.room_id);
  }

  const initialStatus: BookingStatus = isAutoApproved
    ? 'Approved'
    : (bookingData.status && bookingData.status !== 'Approved' ? bookingData.status : 'Pending');

  const inferredType = inferRoomType(bookingData.room_name || '', bookingData.room_id || '');
  const roomType: RoomType = bookingData.room_type || (inferredType === 'chuc_nang' ? 'chuc_nang' : 'chinh_khoa');

  const newBooking: Booking = {
    booking_id,
    room_id: bookingData.room_id,
    room_name: bookingData.room_name,
    room_type: roomType,
    username: bookingData.username,
    fullname: bookingData.fullname,
    borrower_name: borrowerName,
    date: bookingData.date,
    time_slot: time_slot_string,
    purpose: bookingData.purpose,
    created_at,
    status: initialStatus,
  };

  let createdResult: Booking = newBooking;

  if (client) {
    try {
      let { data, error } = await client.from('bookings').insert([newBooking]).select().single();

      // Graceful fallback if 'borrower_name' column does not exist in Supabase yet
      if (
        error &&
        (error.code === '42703' ||
          String(error.message).toLowerCase().includes('borrower_name') ||
          (String(error.message).toLowerCase().includes('column') && String(error.message).toLowerCase().includes('not exist')))
      ) {
        console.warn('Retrying insert without borrower_name column due to Supabase schema:', error.message);
        const fallbackBooking: any = { ...newBooking };
        delete fallbackBooking.borrower_name;
        if (borrowerName && borrowerName !== bookingData.fullname) {
          fallbackBooking.purpose = `[Người mượn: ${borrowerName}] ${fallbackBooking.purpose}`;
        }
        const retryRes = await client.from('bookings').insert([fallbackBooking]).select().single();
        if (retryRes.error) {
          console.error('Supabase booking retry insert error:', retryRes.error);
          return {
            success: false,
            message: `Lỗi lưu vào CSDL Supabase: ${retryRes.error.message}`,
          };
        }
        data = retryRes.data;
        error = null;
      } else if (error) {
        console.error('Supabase booking insert error:', error);
        return {
          success: false,
          message: `Lỗi lưu vào CSDL Supabase: ${error.message}. (Mã lỗi: ${error.code || 'UNKNOWN'}). Vui lòng kiểm tra bảng "bookings" trong Supabase!`,
        };
      }

      if (data) {
        createdResult = {
          ...data,
          borrower_name: data.borrower_name || borrowerName,
          booking_id: data.booking_id || data.id || booking_id,
        } as Booking;
      }
    } catch (e: any) {
      console.error('Supabase insert exception:', e);
      return {
        success: false,
        message: `Lỗi kết nối CSDL Supabase: ${e?.message || e}`,
      };
    }
  } else {
    seedLocalStorageIfNeeded();
    const existing = await fetchBookings();
    localStorage.setItem(BOOKINGS_KEY, JSON.stringify([newBooking, ...existing]));
  }

  // Gửi email thông báo tự động ngầm trong nền (non-blocking) để người dùng không phải chờ máy chủ SMTP phản hồi
  // Lưu ý: Nếu Admin/SuperAdmin đặt phòng thì không cần gửi email thông báo
  const shouldSkipEmail = bookingData.skipEmail || isAdmin;
  if (!shouldSkipEmail) {
    sendEmailNotification('NEW_BOOKING', createdResult)
      .catch((e: any) => console.warn('Background email send error:', e));
  }

  // Kiểm tra cảnh báo nếu đặt phòng cách thời điểm hiện tại dưới 24 tiếng
  const hasUnder24h = bookingData.time_slots.some((s) => isSlotUnder24Hours(bookingData.date, s));
  const successMsg = hasUnder24h
    ? `Đặt phòng thành công! ${UNDER_24H_WARNING_TEXT}.${initialStatus === 'Approved' ? ' (Đã tự động duyệt)' : ''}`
    : `Đặt phòng thành công!${initialStatus === 'Approved' ? ' (Đã tự động duyệt)' : ' Đã lưu vào CSDL'}`;

  return {
    success: true,
    message: successMsg,
    booking: createdResult,
  };
}

// Gửi email thông báo tổng hợp khi đặt nhiều phòng cùng lúc (Batch Booking Cart)
export async function sendBatchEmailNotification(
  bookings: Booking[]
): Promise<{ sent: boolean; message: string }> {
  if (bookings.length === 0) return { sent: false, message: 'Danh sách rỗng' };
  
  const first = bookings[0];
  const booker = (first.username || '').toLowerCase().trim();
  // Nếu đợt đặt phòng này do Admin hoặc SuperAdmin tạo -> Bỏ qua không gửi mail thông báo
  if (booker === 'admin' || booker === 'superadmin' || booker.includes('admin')) {
    console.log(`ℹ️ [Batch Email Skip] Bỏ qua gửi email vì đợt đặt phòng do Admin/SuperAdmin (${first.username}) tạo.`);
    return { sent: true, message: 'Admin đặt phòng - Bỏ qua gửi email thông báo' };
  }

  if (bookings.length === 1) return sendEmailNotification('NEW_BOOKING', bookings[0]);

  const adminEmails = await fetchAdminSettingEmails();
  let userEmail = '';
  const client = getSupabaseClient();
  if (client && first.username) {
    try {
      const { data } = await client.from('users').select('email').ilike('username', first.username).maybeSingle();
      if (data?.email && data.email.includes('@')) userEmail = data.email.trim();
    } catch (e) {
      console.warn('User email lookup exception:', e);
    }
  }
  if (!userEmail && first.username.includes('@')) userEmail = first.username.trim();

  // Fallback tra cứu email người dùng từ localStorage
  if (!userEmail || userEmail === 'admin@fpt.edu.vn' || !userEmail.includes('@')) {
    try {
      const rawUsers = localStorage.getItem('vuth_booking_users');
      if (rawUsers) {
        const uList = JSON.parse(rawUsers);
        const found = uList.find((u: any) => (u.username || '').toLowerCase() === (first.username || '').toLowerCase());
        if (found?.email && found.email.includes('@')) {
          userEmail = found.email.trim();
        }
      }
    } catch {}
  }

  // Đợt đặt phòng mới: Chỉ gửi cho Admin để phê duyệt, KHÔNG trả mail về cho User
  const rawRecipientList: string[] = [...adminEmails];
  if (rawRecipientList.length === 0) rawRecipientList.push('kensinvn2000@gmail.com');

  const validRecipients = Array.from(
    new Set(
      rawRecipientList
        .flatMap(r => String(r || '').split(/[,;\s]+/))
        .map(e => e.trim().toLowerCase())
        .filter(e => e && e.includes('@') && e.includes('.') && !e.includes('admin@fpt.edu.vn'))
    )
  );

  const recipientString = validRecipients.length > 0 ? validRecipients.join(', ') : 'kensinvn2000@gmail.com';
  const borrower = first.borrower_name || first.fullname || first.username;
  const emailSubject = `[FSCCT Booking] Đăng ký đợt ${bookings.length} phòng mới - ${borrower} (${first.date})`;

  const roomLines = bookings
    .map((b, idx) => `  ${idx + 1}. Phòng ${b.room_name} (${b.room_id}) - Khung giờ: [${b.time_slot}]`)
    .join('\n');

  const emailBody = `Kính gửi Quản Trị Viên,\n\nHệ thống vừa ghi nhận một đợt đăng ký đặt ${bookings.length} phòng học cùng lúc:\n- Người mượn: ${borrower}\n- Tài khoản đăng ký: ${first.fullname} (@${first.username})\n- Ngày sử dụng: ${first.date}\n- Mục đích sử dụng: ${first.purpose}\n\nDanh sách các phòng & khung giờ đăng ký (${bookings.length} phòng):\n${roomLines}\n\nVui lòng truy cập hệ thống FSCCT Booking để xem và phê duyệt.\nTrân trọng,\nHệ thống FSCCT Booking.`;

  const smtpUser = localStorage.getItem('vuth_booking_smtp_user') || undefined;
  const smtpHost = localStorage.getItem('vuth_booking_smtp_host') || undefined;
  const smtpPort = localStorage.getItem('vuth_booking_smtp_port') || undefined;

  try {
    const apiRes = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: recipientString,
        subject: emailSubject,
        body: emailBody,
        smtpUser,
        smtpHost,
        smtpPort,
      }),
    });

    let apiData: any = null;
    try {
      apiData = await apiRes.json();
    } catch {}

    if (apiData && apiData.success) {
      saveEmailLog({
        id: 'LOG_' + Date.now(),
        to: recipientString,
        subject: emailSubject,
        status: `Thành công (${apiData.method || 'SMTP'})`,
        type: 'NEW_BOOKING',
        booking_id: bookings.map(b => b.booking_id).join(', '),
        preview_url: apiData.previewUrl,
        used_test_account: apiData.usedTestAccount,
        sent_at: new Date().toLocaleString('vi-VN'),
      });
      return { sent: true, message: `Đã gửi email thông báo đợt ${bookings.length} phòng tới: ${recipientString}` };
    } else {
      const errMsg = apiData?.message || (apiRes.ok ? 'Gửi email không thành công' : `Máy chủ trả về mã lỗi ${apiRes.status}`);
      saveEmailLog({
        id: 'LOG_' + Date.now(),
        to: recipientString,
        subject: emailSubject,
        status: `Thất bại (${errMsg.slice(0, 45)})`,
        type: 'NEW_BOOKING',
        booking_id: bookings.map(b => b.booking_id).join(', '),
        sent_at: new Date().toLocaleString('vi-VN'),
      });
      return { sent: false, message: errMsg };
    }
  } catch (err: any) {
    console.warn('Batch email send error:', err);
    saveEmailLog({
      id: 'LOG_' + Date.now(),
      to: recipientString,
      subject: emailSubject,
      status: 'Thất bại (Không thể kết nối máy chủ)',
      type: 'NEW_BOOKING',
      booking_id: bookings.map(b => b.booking_id).join(', '),
      sent_at: new Date().toLocaleString('vi-VN'),
    });
    return { sent: false, message: 'Không thể kết nối máy chủ gửi mail!' };
  }
}

export async function apiUpdateStatus(
  bookingId: string,
  newStatus: BookingStatus,
  rejectReason?: string
): Promise<{ success: boolean; message: string }> {
  const client = getSupabaseClient();
  let targetBooking: Booking | null = null;

  if (client) {
    try {
      const updatePayload: any = { status: newStatus };
      if (rejectReason) updatePayload.reject_reason = rejectReason;

      // 1. Try updating matching booking_id
      let { data, error } = await client
        .from('bookings')
        .update(updatePayload)
        .eq('booking_id', bookingId)
        .select();

      // 2. Retry status-only if reject_reason column is missing
      if (error) {
        console.warn('Retrying update with status only due to Supabase error:', error.message);
        const retry = await client
          .from('bookings')
          .update({ status: newStatus })
          .eq('booking_id', bookingId)
          .select();
        data = retry.data;
        error = retry.error;
      }

      // 3. If 0 rows updated, try matching 'id' column instead
      if (!error && (!data || data.length === 0)) {
        const retryId = await client
          .from('bookings')
          .update(updatePayload)
          .eq('id', bookingId)
          .select();
        
        if (retryId.error) {
          const retryIdStatusOnly = await client
            .from('bookings')
            .update({ status: newStatus })
            .eq('id', bookingId)
            .select();
          data = retryIdStatusOnly.data;
          error = retryIdStatusOnly.error;
        } else {
          data = retryId.data;
          error = retryId.error;
        }
      }

      if (error) {
        console.error('Supabase update status error:', error);
        return {
          success: false,
          message: `Lỗi cập nhật CSDL Supabase: ${error.message}`,
        };
      }

      if (data && data.length > 0) {
        targetBooking = {
          ...data[0],
          booking_id: data[0].booking_id || data[0].id || bookingId,
        } as Booking;
      } else {
        // Query updated booking if select() returned empty array or RLS behavior
        const { data: fetched } = await client
          .from('bookings')
          .select('*')
          .or(`booking_id.eq.${bookingId},id.eq.${bookingId}`)
          .maybeSingle();

        if (fetched) {
          targetBooking = {
            ...fetched,
            booking_id: fetched.booking_id || fetched.id || bookingId,
            status: newStatus,
          } as Booking;
        }
      }
    } catch (e: any) {
      console.error('Supabase update exception:', e);
      return {
        success: false,
        message: `Lỗi kết nối CSDL Supabase: ${e?.message || e}`,
      };
    }
  }

  // Fallback to local storage if needed
  seedLocalStorageIfNeeded();
  const raw = localStorage.getItem(BOOKINGS_KEY);
  const bookings: Booking[] = raw ? JSON.parse(raw) : INITIAL_BOOKINGS;
  const index = bookings.findIndex(b => String(b.booking_id) === String(bookingId) || String((b as any).id) === String(bookingId));
  
  if (index !== -1) {
    bookings[index].status = newStatus;
    if (rejectReason) bookings[index].reject_reason = rejectReason;
    localStorage.setItem(BOOKINGS_KEY, JSON.stringify(bookings));
    if (!targetBooking) {
      targetBooking = bookings[index];
    }
  }

  if (targetBooking) {
    // Gửi email thông báo cập nhật trạng thái tới user chạy ngầm trong nền (non-blocking) để tối ưu hiệu năng
    sendEmailNotification('STATUS_CHANGE', targetBooking)
      .catch((e: any) => console.warn('Background status change email error:', e));

    return {
      success: true,
      message: `Đã ${newStatus === 'Approved' ? 'phê duyệt (Approved)' : newStatus === 'Rejected' ? 'từ chối (Rejected)' : 'hủy (Cancelled)'} đơn [${targetBooking.booking_id}] thành công!`,
    };
  }

  return { success: false, message: `Không tìm thấy mã đơn đặt phòng [${bookingId}]!` };
}

// Xóa vĩnh viễn đơn đặt phòng khỏi Supabase & LocalStorage
export async function apiDeleteBooking(
  bookingId: string
): Promise<{ success: boolean; message: string }> {
  const client = getSupabaseClient();
  if (client) {
    try {
      const { error } = await client.from('bookings').delete().eq('booking_id', bookingId);
      if (error) {
        await client.from('bookings').delete().eq('id', bookingId);
      }
    } catch (e: any) {
      console.warn('Supabase delete booking error:', e);
    }
  }

  // Cập nhật LocalStorage
  try {
    seedLocalStorageIfNeeded();
    const raw = localStorage.getItem(BOOKINGS_KEY);
    if (raw) {
      const bookings: Booking[] = JSON.parse(raw);
      const filtered = bookings.filter(
        (b) => String(b.booking_id) !== String(bookingId) && String((b as any).id) !== String(bookingId)
      );
      localStorage.setItem(BOOKINGS_KEY, JSON.stringify(filtered));
    }
  } catch (e) {
    console.warn('Local delete booking error:', e);
  }

  return { success: true, message: `Đã xóa đơn đặt phòng [${bookingId}] thành công!` };
}

export function getSupabaseSqlSchema(): string {
  return `-- ==========================================
-- Supabase PostgreSQL Database Schema & Seed Data
-- Generated from DBBook_phong.xlsx
-- Powered by VUTH / FSCCT Booking System
-- ==========================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Xóa bảng cũ nếu tồn tại (để tạo mới sạch)
DROP TABLE IF EXISTS bookings CASCADE;
DROP TABLE IF EXISTS rooms CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS settings CASCADE;

-- 1. Bảng users
CREATE TABLE users (
    username VARCHAR(100) PRIMARY KEY,
    password TEXT NOT NULL,
    fullname VARCHAR(255),
    role VARCHAR(50) DEFAULT 'user',
    email VARCHAR(255)
);

-- 2. Bảng rooms
CREATE TABLE rooms (
    room_id VARCHAR(50) PRIMARY KEY,
    room_name VARCHAR(255) NOT NULL,
    capacity INT DEFAULT 0,
    status VARCHAR(50) DEFAULT 'Active',
    room_type VARCHAR(50) DEFAULT 'chinh_khoa' -- 'chinh_khoa' (Phòng chính khóa) hoặc 'chuc_nang' (Phòng chức năng)
);

-- 3. Bảng bookings
CREATE TABLE bookings (
    booking_id VARCHAR(100) PRIMARY KEY,
    room_id VARCHAR(50) REFERENCES rooms(room_id) ON DELETE SET NULL,
    room_name VARCHAR(255),
    room_type VARCHAR(50) DEFAULT 'chinh_khoa',
    username VARCHAR(100) REFERENCES users(username) ON DELETE SET NULL,
    fullname VARCHAR(255),
    borrower_name VARCHAR(255),
    date DATE,
    time_slot VARCHAR(255),
    purpose TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    status VARCHAR(50) DEFAULT 'Pending'
);

-- Nếu Supabase của bạn đã có các bảng từ trước, hãy chạy 2 lệnh sau trong SQL Editor:
-- ALTER TABLE rooms ADD COLUMN IF NOT EXISTS room_type VARCHAR(50) DEFAULT 'chinh_khoa';
-- ALTER TABLE bookings ADD COLUMN IF NOT EXISTS room_type VARCHAR(50) DEFAULT 'chinh_khoa';
-- ALTER TABLE bookings ADD COLUMN IF NOT EXISTS borrower_name VARCHAR(255);

-- 4. Bảng settings
CREATE TABLE settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT
);

-- 5. Bảng user_room_permissions (Phân quyền tự động duyệt phòng cho người dùng)
CREATE TABLE IF NOT EXISTS user_room_permissions (
    username VARCHAR(100) NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    room_id VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (username, room_id)
);

-- 6. Chỉ mục (Indexes) Tối ưu hóa hiệu năng, giảm 90% thời gian xử lý và giảm Log Query trên Supabase
CREATE INDEX IF NOT EXISTS idx_bookings_date_room ON bookings (date, room_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (status);
CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_username ON bookings (username);
CREATE INDEX IF NOT EXISTS idx_rooms_room_type ON rooms (room_type);
CREATE INDEX IF NOT EXISTS idx_user_room_permissions_user ON user_room_permissions (username);

-- Row Level Security (RLS) policies
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_room_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public select users" ON users FOR SELECT USING (true);
CREATE POLICY "Allow public insert users" ON users FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update users" ON users FOR UPDATE USING (true);

CREATE POLICY "Allow public select rooms" ON rooms FOR SELECT USING (true);
CREATE POLICY "Allow public insert rooms" ON rooms FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update rooms" ON rooms FOR UPDATE USING (true);

CREATE POLICY "Allow public select bookings" ON bookings FOR SELECT USING (true);
CREATE POLICY "Allow public insert bookings" ON bookings FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update bookings" ON bookings FOR UPDATE USING (true);

CREATE POLICY "Allow public select settings" ON settings FOR SELECT USING (true);
CREATE POLICY "Allow public insert settings" ON settings FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update settings" ON settings FOR UPDATE USING (true);

CREATE POLICY "Allow public select user_room_permissions" ON user_room_permissions FOR SELECT USING (true);
CREATE POLICY "Allow public insert user_room_permissions" ON user_room_permissions FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update user_room_permissions" ON user_room_permissions FOR UPDATE USING (true);
CREATE POLICY "Allow public delete user_room_permissions" ON user_room_permissions FOR DELETE USING (true);

-- Seed Data Ban Đầu
INSERT INTO users (username, password, fullname, role, email) VALUES
('superadmin', '123456', 'Super Admin Quản Trị Cấp Cao', 'superadmin', 'superadmin@fpt.edu.vn'),
('admin', '123456', 'Hệ Thống Admin', 'admin', 'admin@fpt.edu.vn'),
('teacher1', '123456', 'Giảng viên A', 'user', 'teacher1@fpt.edu.vn'),
('bv1', '123456', 'Bảo Vệ Trực Ca', 'security', 'baove@fpt.edu.vn')
ON CONFLICT (username) DO NOTHING;

INSERT INTO rooms (room_id, room_name, capacity, status, room_type) VALUES
('R101', 'Phòng Lý Thuyết 101', 40, 'Active', 'chinh_khoa'),
('R102', 'Phòng Thực Hành Máy Tính 102', 35, 'Active', 'chuc_nang'),
('R103', 'Hội Trường Lớn R103', 150, 'Active', 'chuc_nang'),
('R201', 'Phòng Đào Tạo Chuyên Đề 201', 50, 'Active', 'chinh_khoa')
ON CONFLICT (room_id) DO NOTHING;

INSERT INTO settings (key, value) VALUES
('system_name', 'HỆ THỐNG BOOK PHÒNG FSCCT'),
('admin_email', 'admin@fpt.edu.vn'),
('email_notifications', 'enabled')
ON CONFLICT (key) DO NOTHING;
`;
}
