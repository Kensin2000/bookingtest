import { DEFAULT_TIME_SLOTS } from './initialData';

/**
 * Tiện ích kiểm tra và xác thực logic đặt phòng (Booking):
 * 1. Khi đã qua thời gian hiện tại thì không thể book được slot có thời gian trước đó nữa (khóa/vô hiệu hóa slot).
 * 2. Thời gian book phải trước 24 tiếng đồng hồ, nếu ít hơn thì hiển thị cảnh báo:
 *    "Lưu ý, lần book phòng sau phải trước 24 tiếng"
 */

/**
 * Trích xuất thời điểm bắt đầu Date của slot từ ngày (YYYY-MM-DD) và chuỗi slot
 * (ví dụ: "07:15 - 08:00" hoặc "07:15 - 08:00 (Slot 1)")
 */
export function getSlotStartDateTime(dateStr: string, slotStr: string): Date | null {
  if (!dateStr || !slotStr) return null;

  // Lấy phần giờ ví dụ "07:15 - 08:00"
  const cleanSlot = slotStr.split(' (')[0].trim();
  const startPart = cleanSlot.split('-')[0]?.trim();
  if (!startPart || !startPart.includes(':')) return null;

  const [hoursStr, minutesStr] = startPart.split(':');
  const hours = parseInt(hoursStr, 10);
  const minutes = parseInt(minutesStr, 10);
  if (isNaN(hours) || isNaN(minutes)) return null;

  const dateParts = dateStr.split('-');
  if (dateParts.length !== 3) return null;
  const year = parseInt(dateParts[0], 10);
  const month = parseInt(dateParts[1], 10) - 1;
  const day = parseInt(dateParts[2], 10);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;

  return new Date(year, month, day, hours, minutes, 0, 0);
}

/**
 * Kiểm tra xem slot đã qua thời gian hiện tại chưa.
 * Slot được xem là đã qua nếu thời điểm bắt đầu slot <= thời điểm hiện tại.
 */
export function isSlotInPast(dateStr: string, slotStr: string): boolean {
  if (!dateStr || !slotStr) return false;
  const slotStartDate = getSlotStartDateTime(dateStr, slotStr);
  if (!slotStartDate) return false;
  return slotStartDate.getTime() <= Date.now();
}

/**
 * Kiểm tra xem thời gian bắt đầu của slot có cách thời điểm hiện tại ít hơn 24 tiếng hay không.
 * Điều kiện: Slot đó chưa qua giờ và (slotStartDate - now) < 24 giờ.
 */
export function isSlotUnder24Hours(dateStr: string, slotStr: string): boolean {
  if (!dateStr || !slotStr) return false;
  const slotStartDate = getSlotStartDateTime(dateStr, slotStr);
  if (!slotStartDate) return false;
  const diffMs = slotStartDate.getTime() - Date.now();
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  return diffMs > 0 && diffMs < TWENTY_FOUR_HOURS_MS;
}

/**
 * Lấy chuỗi ngày YYYY-MM-DD theo giờ địa phương của người dùng
 */
export function getLocalDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const UNDER_24H_WARNING_TEXT = 'Lưu ý, lần book phòng sau phải trước 24 tiếng';

/**
 * Kiểm tra xem lịch đặt phòng có thuộc các slot NGOÀI GIỜ của phòng chính khóa:
 * - Slot 5 (10:40 - 11:25)
 * - Slot trua / trưa (11:30 - 13:00)
 * - Slot 10 (16:36 - 17:59)
 * - Slot 11 (18:00 - 18:59)
 * - Slot 12 (19:00 - 19:30)
 * - Slot 13 (19:30 - 21:00)
 * - Slot 14 (21:00 - 22:00)
 */
export function isOffHoursSlot(slotStr: string): boolean {
  if (!slotStr) return false;
  const str = slotStr.toLowerCase().trim();

  // 1. Kiểm tra từ khóa trưa: "trua", "trưa", "slot trua", "slot trưa", "ca trưa"
  if (str.includes('trua') || str.includes('trưa')) {
    return true;
  }

  // 2. Nếu chuỗi dạng khoảng slot: "Slot X - Y", "Ca X - Y", "Tiết X - Y" hoặc "X - Y"
  const rangeMatch = str.match(/^(?:slot|ca|tiet|tiết)?\s*([0-9]+)\s*(?:[-–]|to|đến)\s*([0-9]+)$/i);
  if (rangeMatch) {
    const s1 = parseInt(rangeMatch[1], 10);
    const s2 = parseInt(rangeMatch[2], 10);
    const minS = Math.min(s1, s2);
    const maxS = Math.max(s1, s2);
    // Nếu dải slot này nằm gọn trong Slot 1-4 hoặc Slot 6-9 -> Không phải ngoài giờ
    if ((minS >= 1 && maxS <= 4) || (minS >= 6 && maxS <= 9)) {
      return false;
    }
    // Nếu chứa Slot 5 hoặc chứa từ Slot 10 đến 14 -> Là ngoài giờ
    for (let s = minS; s <= maxS; s++) {
      if (s === 5 || (s >= 10 && s <= 14)) {
        return true;
      }
    }
    return false;
  }

  // 3. Nếu chuỗi CHỈ chứa duy nhất một số định danh slot (ví dụ "1", "4", "5", "Slot 6", "Ca 10")
  const singleSlotMatch = str.match(/^(?:slot|ca|tiet|tiết)?\s*([0-9]+)\s*$/i);
  if (singleSlotMatch) {
    const sNum = parseInt(singleSlotMatch[1], 10);
    if (sNum === 5 || (sNum >= 10 && sNum <= 14)) {
      return true;
    }
    if ((sNum >= 1 && sNum <= 4) || (sNum >= 6 && sNum <= 9)) {
      return false;
    }
  }

  // 4. Khớp từ khóa cụ thể trong chuỗi: "Slot 5", "Slot 10", "Slot 11", "Slot 12", "Slot 13", "Slot 14"
  // Sử dụng boundary \b để không nhận nhầm số trong giờ (ví dụ "14:05" không bị nhận là Slot 14)
  const explicitOffSlot = /\b(?:slot|ca|tiết|tiet)\s*(5|10|11|12|13|14)\b/i.test(str);
  if (explicitOffSlot) {
    return true;
  }

  // 5. Kiểm tra khoảng thời gian dạng HH:MM - HH:MM
  const timeMatches = Array.from(str.matchAll(/(\d{1,2})[:h](\d{2})\s*[-–]\s*(\d{1,2})[:h](\d{2})/g));
  if (timeMatches.length > 0) {
    // Trích xuất khoảng phút của Slot 5, Slot trưa, và Slot 10-14 trực tiếp từ DEFAULT_TIME_SLOTS
    const getMinutes = (range?: string) => {
      if (!range) return null;
      const parts = range.split('-');
      if (parts.length !== 2) return null;
      const [sH, sM] = parts[0].trim().split(':').map(Number);
      const [eH, eM] = parts[1].trim().split(':').map(Number);
      if (isNaN(sH) || isNaN(sM) || isNaN(eH) || isNaN(eM)) return null;
      return { start: sH * 60 + sM, end: eH * 60 + eM };
    };

    const slot5Range = getMinutes(DEFAULT_TIME_SLOTS.find(s => s.slotNumber === 5)?.timeRange) || { start: 640, end: 685 };
    const truaRange = getMinutes(DEFAULT_TIME_SLOTS.find(s => s.slotNumber === 'trua')?.timeRange) || { start: 690, end: 780 };
    const slot10Range = getMinutes(DEFAULT_TIME_SLOTS.find(s => s.slotNumber === 10)?.timeRange) || { start: 996, end: 1079 };

    for (const match of timeMatches) {
      const sH = parseInt(match[1], 10);
      const sM = parseInt(match[2], 10);
      const eH = parseInt(match[3], 10);
      const eM = parseInt(match[4], 10);
      const startMin = sH * 60 + sM;
      const endMin = eH * 60 + eM;

      // Slot 5
      const overlapsSlot5 = Math.max(startMin, slot5Range.start) < Math.min(endMin, slot5Range.end);
      // Slot trưa
      const overlapsTrua = Math.max(startMin, truaRange.start) < Math.min(endMin, truaRange.end);
      // Slot ngoài giờ tối (từ slot 10 trở đi)
      const overlapsEvening = Math.max(startMin, slot10Range.start) < Math.min(endMin, 1440);

      if (overlapsSlot5 || overlapsTrua || overlapsEvening) {
        return true;
      }
    }
    return false;
  }

  return false;
}

/**
 * Giữ hàm tương thích ngược (nếu cần) hoặc kiểm tra slot trong giờ chính khóa (Slot 1-4 & Slot 6-9)
 */
export function isBookingInSlots1To4Or6To9(slotStr: string): boolean {
  return !isOffHoursSlot(slotStr);
}

/**
 * Kiểm tra xem một mã phòng hoặc tên phòng có phải là Hội trường (.Bhoitruong) hay không
 */
export function isHallRoomId(roomId?: string, roomName?: string): boolean {
  if (!roomId && !roomName) return false;
  const cleanId = (roomId || '').trim().toLowerCase();
  const cleanName = (roomName || '').trim().toLowerCase();
  return (
    cleanId === '.bhoitruong' ||
    cleanId === 'bhoitruong' ||
    cleanId.includes('.bhoitruong') ||
    cleanId.includes('bhoitruong') ||
    cleanName.includes('bhoitruong')
  );
}

export interface HallEquipmentState {
  led: boolean;
  mayLanh: boolean;
  diDoiBanGhe: boolean;
}

/**
 * Đồng bộ chuỗi purpose (Mục đích sử dụng phòng) với trạng thái các checkbox thiết bị hội trường:
 * Led, Máy lạnh, Di dời bàn ghế
 */
export function syncPurposeWithHallEquipment(
  currentPurpose: string,
  equipment: HallEquipmentState
): string {
  // Loại bỏ tag thiết bị cũ dạng [Yêu cầu: ...] hoặc (Yêu cầu: ...)
  const tagRegex = /\s*(?:\[Yêu cầu:[^\]]*\]|\(Yêu cầu:[^)]*\)|\+ Yêu cầu:[^\n]*)/gi;
  const baseText = currentPurpose.replace(tagRegex, '').trim();

  const selectedList: string[] = [];
  if (equipment.led) selectedList.push('Led');
  if (equipment.mayLanh) selectedList.push('Máy lạnh');
  if (equipment.diDoiBanGhe) selectedList.push('Di dời bàn ghế');

  if (selectedList.length === 0) {
    return baseText;
  }

  const tag = `[Yêu cầu: ${selectedList.join(', ')}]`;
  return baseText ? `${baseText} ${tag}` : tag;
}

/**
 * Trích xuất trạng thái checkbox từ chuỗi purpose nếu có
 */
export function parseHallEquipmentFromPurpose(purposeStr?: string): HallEquipmentState {
  if (!purposeStr) return { led: false, mayLanh: false, diDoiBanGhe: false };
  const str = purposeStr.toLowerCase();
  return {
    led: /\bled\b/i.test(str),
    mayLanh: /máy lạnh|may lanh|điều hòa|dieu hoa/i.test(str),
    diDoiBanGhe: /di dời bàn ghế|di doi ban ghe|bàn ghế|ban ghe/i.test(str),
  };
}

/**
 * Trích xuất khoảng thời gian (phút tính từ 00:00) từ chuỗi giờ
 */
export function parseTimeInterval(str: string): { start: number; end: number } | null {
  if (!str) return null;
  const m = str.match(/(\d{1,2})[:h](\d{2})\s*[-–]\s*(\d{1,2})[:h](\d{2})/i);
  if (!m) return null;
  const sH = parseInt(m[1], 10);
  const sM = parseInt(m[2], 10);
  const eH = parseInt(m[3], 10);
  const eM = parseInt(m[4], 10);
  if (isNaN(sH) || isNaN(sM) || isNaN(eH) || isNaN(eM)) return null;
  return { start: sH * 60 + sM, end: eH * 60 + eM };
}

/**
 * Kiểm tra xem 2 khoảng thời gian phút có giao nhau (overlap) không
 */
export function doIntervalsOverlap(
  int1: { start: number; end: number },
  int2: { start: number; end: number }
): boolean {
  return Math.max(int1.start, int2.start) < Math.min(int1.end, int2.end);
}

/**
 * Tìm kiếm cấu hình TimeSlotOption chính xác tương ứng từ chuỗi đầu vào bất kỳ.
 * Ưu tiên:
 * 1. Khớp chính xác timeRange (VD: "16:36 - 17:59")
 * 2. Khớp chính xác label đầy đủ (VD: "16:36 - 17:59 (Slot 10)")
 * 3. Chứa trọn vẹn timeRange (VD: "Phòng 101: 16:36 - 17:59")
 * 4. Khớp số Slot với Word Boundary bắt buộc (\b) để "Slot 10", "Slot 11"... KHÔNG bị nhầm thành "Slot 1"
 */
export function findMatchingTimeSlotOption(slotStr: string) {
  if (!slotStr) return undefined;
  const raw = slotStr.trim().toLowerCase();
  const clean = raw.split(' (')[0].trim();

  // 1. So khớp chính xác timeRange trước tiên
  const exactRangeMatch = DEFAULT_TIME_SLOTS.find(
    (s) => s.timeRange.toLowerCase() === clean || s.timeRange.toLowerCase() === raw
  );
  if (exactRangeMatch) return exactRangeMatch;

  // 2. So khớp chính xác label đầy đủ
  const exactLabelMatch = DEFAULT_TIME_SLOTS.find((s) => s.label.toLowerCase() === raw);
  if (exactLabelMatch) return exactLabelMatch;

  // 3. So khớp nếu chuỗi chứa đúng timeRange hoàn chỉnh (độ dài >= 11 ký tự dạng HH:MM - HH:MM)
  const containsRangeMatch = DEFAULT_TIME_SLOTS.find(
    (s) => s.timeRange.length >= 11 && raw.includes(s.timeRange.toLowerCase())
  );
  if (containsRangeMatch) return containsRangeMatch;

  // 4. So khớp theo số Slot với Word Boundary bắt buộc (\b)
  for (const s of DEFAULT_TIME_SLOTS) {
    if (s.slotNumber === 'trua') {
      if (/\b(?:slot|ca|tiết|tiet)?\s*tr[uư]a\b/i.test(raw)) return s;
    } else {
      const rx = new RegExp(`\\b(?:slot|tiết|tiet)\\s*${s.slotNumber}\\b`, 'i');
      if (rx.test(raw)) return s;
    }
  }

  return undefined;
}

/**
 * Kiểm tra toàn diện xem một khung giờ slot (slot 1-14 hoặc chuỗi giờ) có trùng với danh sách slot bận (busySlots) hay không.
 * Hỗ trợ:
 * 1. Khớp chính xác dải giờ (VD: "09:00 - 09:45" === "09:00 - 09:45")
 * 2. Khớp chuỗi nhãn (VD: "09:00 - 09:45 (Slot 3)")
 * 3. Khớp số Slot chính xác theo word boundary (Slot 1 không bao giờ nhầm sang Slot 10-14)
 * 4. Khớp dải Ca học (Ca 1: Slot 1-2, Ca 2: Slot 3-4, Ca 4: Slot 6-7, Ca 5: Slot 8-9)
 * 5. Khớp giao thoa khoảng thời gian (Time Interval Overlap) nếu ca học kéo dài (VD: 09:00 - 10:35 phủ cả Slot 3 & 4)
 */
export function isSlotOccupiedByAny(slotTarget: string, busySlots: string[]): boolean {
  if (!slotTarget || !busySlots || busySlots.length === 0) return false;

  const targetClean = slotTarget.split(' (')[0].trim().toLowerCase();
  const targetRaw = slotTarget.trim().toLowerCase();

  // Tìm thông tin slot chuẩn xác từ DEFAULT_TIME_SLOTS
  const matchedOption = findMatchingTimeSlotOption(slotTarget);
  const targetInterval = parseTimeInterval(matchedOption ? matchedOption.timeRange : targetClean);
  const targetSlotNum = matchedOption ? matchedOption.slotNumber : null;

  for (const rawBusy of busySlots) {
    if (!rawBusy) continue;
    const bLower = rawBusy.toLowerCase().trim();
    const bClean = bLower.split(' (')[0].trim();

    // 1. So khớp trực tiếp chuỗi
    if (bLower === targetRaw || bLower === targetClean || bClean === targetClean) {
      return true;
    }

    // 2. Chứa chuỗi timeRange hoàn chỉnh (độ dài >= 11 ký tự như "07:15 - 08:00")
    if (targetClean.length >= 11 && bLower.includes(targetClean)) {
      return true;
    }
    if (bClean.length >= 11 && targetClean.includes(bClean)) {
      return true;
    }

    // 3. Khớp số Slot nếu có (với Word Boundary \b)
    if (targetSlotNum !== null && targetSlotNum !== undefined) {
      if (targetSlotNum === 'trua') {
        if (/\b(?:slot|ca|tiết|tiet)?\s*tr[uư]a\b/i.test(bLower)) return true;
      } else {
        const slotRegex = new RegExp(`\\b(?:slot|tiết|tiet)\\s*${targetSlotNum}\\b`, 'i');
        if (slotRegex.test(bLower)) return true;

        // Khớp quy tắc Ca học đại học:
        // Ca 1 = Slot 1, 2
        // Ca 2 = Slot 3, 4
        // Ca 3 = Slot 5, Trưa
        // Ca 4 = Slot 6, 7
        // Ca 5 = Slot 8, 9
        if (/\b(?:ca|shift)\s*1\b/i.test(bLower) && (targetSlotNum === 1 || targetSlotNum === 2)) return true;
        if (/\b(?:ca|shift)\s*2\b/i.test(bLower) && (targetSlotNum === 3 || targetSlotNum === 4)) return true;
        if (/\b(?:ca|shift)\s*3\b/i.test(bLower) && (targetSlotNum === 5 || targetSlotNum === 'trua')) return true;
        if (/\b(?:ca|shift)\s*4\b/i.test(bLower) && (targetSlotNum === 6 || targetSlotNum === 7)) return true;
        if (/\b(?:ca|shift)\s*5\b/i.test(bLower) && (targetSlotNum === 8 || targetSlotNum === 9)) return true;
      }
    }

    // 4. Khớp giao thoa khoảng thời gian (Interval Overlap)
    if (targetInterval) {
      const busyInterval = parseTimeInterval(bClean) || parseTimeInterval(bLower);
      if (busyInterval && doIntervalsOverlap(targetInterval, busyInterval)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Chuẩn hóa mã phòng để so sánh không phân biệt hoa thường và tiền tố 'R'
 * (VD: '101', 'r101', 'R101' đều tương đương nhau)
 */
export function normalizeRoomId(roomId?: string): string {
  if (!roomId) return '';
  return String(roomId).toUpperCase().trim();
}

/**
 * Kiểm tra xem 2 mã phòng có tương đương nhau hay không
 */
export function areRoomIdsMatching(id1?: string, id2?: string): boolean {
  if (!id1 || !id2) return false;
  const n1 = normalizeRoomId(id1);
  const n2 = normalizeRoomId(id2);
  if (n1 === n2) return true;
  // Bỏ tiền tố R nếu có (R101 -> 101)
  const strip1 = n1.replace(/^R/, '');
  const strip2 = n2.replace(/^R/, '');
  return strip1 === strip2 && strip1.length > 0;
}

/**
 * Kiểm tra xem một đơn booking có chiếm dụng slot cụ thể của một phòng trong ngày đã chọn hay không
 */
export function isBookingMatchingSlot(
  booking: {
    room_id?: string;
    room_name?: string;
    date?: string;
    time_slot?: string;
    status?: string;
  },
  roomId: string,
  targetDate: string,
  slotTimeRange: string
): boolean {
  if (!booking || !booking.time_slot) return false;

  // 1. Kiểm tra trạng thái
  const st = String(booking.status || '').toLowerCase().trim();
  if (st === 'rejected' || st === 'cancelled' || st.includes('từ chối') || st.includes('hủy')) {
    return false;
  }

  // 2. Kiểm tra ngày
  if (String(booking.date || '').trim() !== String(targetDate || '').trim()) {
    return false;
  }

  // 3. Kiểm tra phòng
  const matchRoom =
    areRoomIdsMatching(booking.room_id, roomId) ||
    String(booking.room_name || '').toLowerCase().trim() === String(roomId || '').toLowerCase().trim();
  if (!matchRoom) return false;

  // 4. Kiểm tra slot
  const occupiedParts = booking.time_slot.split(',').map((s) => s.trim());
  return isSlotOccupiedByAny(slotTimeRange, occupiedParts);
}



