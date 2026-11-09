import * as XLSX from 'xlsx';
import { Booking, Room, TimeSlotOption, RoomType } from '../types';
import { DEFAULT_TIME_SLOTS } from './initialData';
import { getSupabaseClient, fetchBookings, fetchRooms, apiCreateRoom, inferRoomType, normalizeRoomType } from './supabase';

export interface ParsedExcelBookingRow {
  sourceFileName?: string; // Tên file nguồn khi tải lên nhiều file
  academicStartYear?: string | number;
  academicEndYear?: string | number;
  day: number;
  month: number;
  year: number;
  dateStr: string; // YYYY-MM-DD
  slot: number | string;
  slotTimeRange: string;
  roomRaw: string;
  roomId: string;
  roomName: string;
  roomType: RoomType; // 'chinh_khoa' | 'chuc_nang'
  isNewRoom: boolean;
  teacher: string;
  subjectCode: string;
  className: string;
  style?: string;
  purpose: string;
  status: 'Approved' | 'Pending';
  hasConflict: boolean;
  conflictReason?: string;
  rawRow: any;
}

export interface ExcelImportSummary {
  totalRows: number;
  validRows: ParsedExcelBookingRow[];
  conflictingRows: ParsedExcelBookingRow[];
  skippedRows: { rowIndex: number; reason: string; rawRow: any; sourceFileName?: string }[];
  newRoomsToCreate: { roomId: string; roomName: string }[];
  dateRange: { min: string; max: string };
  roomsCount: number;
  teachersCount: number;
}

export interface FileImportBreakdown {
  fileName: string;
  fileSize: string;
  totalRows: number;
  validCount: number;
  conflictCount: number;
  skippedCount: number;
  status: 'success' | 'warning' | 'error';
  errorMessage?: string;
}

export interface MultiExcelImportSummary extends ExcelImportSummary {
  files: FileImportBreakdown[];
  totalFiles: number;
}

/**
 * Chuẩn hóa chuỗi để so sánh tên cột (bỏ dấu tiếng Việt, chữ hoa, khoảng trắng, dấu gạch)
 */
export function normalizeKey(str: string): string {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[\s_\-\.\:\(\)\[\]\/\\#]/g, '');
}

/**
 * Tìm phòng tương ứng trong CSDL từ chuỗi phòng trong Excel
 * Hỗ trợ linh hoạt: "314", "B314", "Phòng 314", "R314",...
 * Đảm bảo lấy đúng thuộc tính room_type ('chuc_nang' hoặc 'chinh_khoa') đã lưu trong CSDL
 */
export function findMatchingRoom(roomRaw: string, existingRooms: Room[]): Room | undefined {
  if (!roomRaw || !existingRooms || existingRooms.length === 0) return undefined;
  const rawTrimmed = String(roomRaw).trim();
  const rawUpper = rawTrimmed.toUpperCase();
  const rawNorm = normalizeKey(rawTrimmed);
  const rawDigits = rawTrimmed.replace(/\D/g, '');

  // 1. Khớp chính xác tuyệt đối theo room_id (không phân biệt hoa thường)
  const exactId = existingRooms.find(r => (r.room_id || '').trim().toUpperCase() === rawUpper);
  if (exactId) return exactId;

  // 2. Khớp chính xác tuyệt đối theo room_name
  const exactName = existingRooms.find(r => (r.room_name || '').trim().toLowerCase() === rawTrimmed.toLowerCase());
  if (exactName) return exactName;

  // 3. Khớp sau khi chuẩn hóa bỏ dấu và khoảng trắng
  const normMatch = existingRooms.find(r => {
    const rIdNorm = normalizeKey(r.room_id || '');
    const rNameNorm = normalizeKey(r.room_name || '');
    return (
      rIdNorm === rawNorm ||
      rNameNorm === rawNorm ||
      rNameNorm === `phong${rawNorm}` ||
      rawNorm === `phong${rIdNorm}`
    );
  });
  if (normMatch) return normMatch;

  // 4. Khớp theo tiền tố chữ cái + số phòng (Ví dụ: Excel ghi "314", CSDL có "B314", "R314", "A314"...)
  if (rawDigits && rawDigits.length >= 2) {
    const prefixMatch = existingRooms.find(r => {
      const rIdUpper = (r.room_id || '').trim().toUpperCase();
      const strippedRId = rIdUpper.replace(/^[A-Z]+/, '');
      return strippedRId === rawUpper || strippedRId === rawDigits;
    });
    if (prefixMatch) return prefixMatch;

    // Khớp tên phòng có số duy nhất tương ứng (VD: "Phòng B314" -> "314")
    const digitMatches = existingRooms.filter(r => {
      const rDigits = (r.room_id || '').replace(/\D/g, '') || (r.room_name || '').replace(/\D/g, '');
      return rDigits === rawDigits;
    });
    if (digitMatches.length === 1) {
      return digitMatches[0];
    }
  }

  // 5. Khớp chuỗi con an toàn (>= 3 ký tự)
  if (rawNorm.length >= 3) {
    const subMatch = existingRooms.find(r => {
      const rIdNorm = normalizeKey(r.room_id || '');
      const rNameNorm = normalizeKey(r.room_name || '');
      return (
        rIdNorm.includes(rawNorm) ||
        rNameNorm.includes(rawNorm) ||
        (rIdNorm.length >= 3 && rawNorm.includes(rIdNorm))
      );
    });
    if (subMatch) return subMatch;
  }

  return undefined;
}

/**
 * Tìm giá trị cột trong row theo danh sách từ khóa linh hoạt (hỗ trợ có dấu và không dấu)
 */
export function getVal(row: any, ...keys: string[]): any {
  if (!row || typeof row !== 'object') return '';
  const rowKeys = Object.keys(row);
  const cleanTargetKeys = keys.map(k => normalizeKey(k));

  for (const cleanTarget of cleanTargetKeys) {
    const foundKey = rowKeys.find(rk => normalizeKey(rk) === cleanTarget);
    if (foundKey && row[foundKey] !== undefined && row[foundKey] !== null) {
      const val = row[foundKey];
      if (typeof val === 'string' && val.trim() === '') continue;
      return val;
    }
  }
  return '';
}

/**
 * Chuyển đổi mã ngày sê-ri của Excel (Excel Serial Date, ví dụ: 46251) thành Date chuẩn
 */
export function parseExcelSerialDate(serial: number): { y: number; m: number; d: number; dateStr: string } | null {
  if (isNaN(serial) || serial < 1000 || serial > 100000) return null;
  // Mốc Excel bắt đầu từ 30/12/1899 (do lỗi nhuận 1900 của Lotus 1-2-3)
  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * 86400;
  const dateInfo = new Date(utcValue * 1000);
  const y = dateInfo.getUTCFullYear();
  const m = dateInfo.getUTCMonth() + 1;
  const d = dateInfo.getUTCDate();
  if (y < 2000 || y > 2100) return null;
  const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { y, m, d, dateStr };
}

/**
 * Đọc ngày đặt phòng từ hàng Excel với mọi định dạng:
 * 1. Cột đơn: Date / Ngày / Ngày học / Thời gian (dạng Date object, sê-ri Excel, DD/MM/YYYY, YYYY-MM-DD...)
 * 2. 3 cột riêng lẻ: Day / Month / Year (hoặc Ngày / Tháng / Năm)
 */
export function parseBookingDateFromRow(row: any, academicStart?: any): { dateStr: string; valid: boolean; d: number; m: number; y: number } {
  // 1. Thử đọc cột ngày gộp (Date / Ngày / Thời gian / Ngày học)
  const rawDate = getVal(row, 'Date', 'Ngay', 'NgayHoc', 'ThoiGian', 'Time', 'NgayDat', 'NgayGiangDay');
  
  if (rawDate instanceof Date && !isNaN(rawDate.getTime())) {
    const y = rawDate.getFullYear();
    const m = rawDate.getMonth() + 1;
    const d = rawDate.getDate();
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return { dateStr, valid: true, d, m, y };
  }

  if (typeof rawDate === 'number') {
    const serialRes = parseExcelSerialDate(rawDate);
    if (serialRes) {
      return { ...serialRes, valid: true };
    }
  }

  const rawDateStr = String(rawDate || '').trim();

  // Chuỗi ISO: YYYY-MM-DD hoặc YYYY/MM/DD
  const isoMatch = rawDateStr.match(/^(\d{4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10);
    const d = parseInt(isoMatch[3], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      return { dateStr, valid: true, d, m, y };
    }
  }

  // Chuỗi Việt Nam: DD/MM/YYYY hoặc DD-MM-YYYY hoặc DD.MM.YYYY
  const dmyMatch = rawDateStr.match(/^(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{2,4})/);
  if (dmyMatch) {
    const d = parseInt(dmyMatch[1], 10);
    const m = parseInt(dmyMatch[2], 10);
    let y = parseInt(dmyMatch[3], 10);
    if (y < 100) y += 2000;
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      return { dateStr, valid: true, d, m, y };
    }
  }

  // 2. Thử đọc 3 cột riêng lẻ: Day / Month / Year hoặc Ngày / Tháng / Năm
  const dayVal = getVal(row, 'Day', 'Ngay', 'D', 'DayOfMonth', 'NgayTrongThang');
  const monthVal = getVal(row, 'Month', 'Thang', 'M', 'ThangTrongNam');
  const yearVal = getVal(row, 'Year', 'Nam', 'Y', 'NamHoc');

  // Trường hợp cột Day lại chứa chuỗi full date "17/08/2026"
  if (typeof dayVal === 'string' && (dayVal.includes('/') || dayVal.includes('-') || dayVal.includes('.'))) {
    const innerDmy = dayVal.match(/^(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{2,4})/);
    if (innerDmy) {
      const d = parseInt(innerDmy[1], 10);
      const m = parseInt(innerDmy[2], 10);
      let y = parseInt(innerDmy[3], 10);
      if (y < 100) y += 2000;
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        return { dateStr, valid: true, d, m, y };
      }
    }
  }

  let d = parseInt(String(dayVal || '').trim(), 10);
  let m = parseInt(String(monthVal || '').trim(), 10);
  let y = parseInt(String(yearVal || academicStart || '').trim(), 10);

  if (!isNaN(y) && y < 100) y += 2000;
  if (isNaN(y) || y < 2000 || y > 2100) y = new Date().getFullYear();

  if (!isNaN(d) && d >= 1 && d <= 31 && !isNaN(m) && m >= 1 && m <= 12) {
    const paddedM = String(m).padStart(2, '0');
    const paddedD = String(d).padStart(2, '0');
    return { dateStr: `${y}-${paddedM}-${paddedD}`, valid: true, d, m, y };
  }

  return { dateStr: '', valid: false, d: 0, m: 0, y: 0 };
}

// Convert slot number (1-14, 'trua') or string to time range from DEFAULT_TIME_SLOTS
export function mapSlotToTimeRange(slotInput: any): { slotNum: number | string; timeRange: string } {
  if (slotInput === undefined || slotInput === null || String(slotInput).trim() === '') {
    return { slotNum: 1, timeRange: DEFAULT_TIME_SLOTS[0]?.timeRange || '07:15 - 08:00' };
  }

  const str = String(slotInput).trim();
  const lowerStr = str.toLowerCase();

  const truaSlot = DEFAULT_TIME_SLOTS.find((s) => s.slotNumber === 'trua');
  const truaTimeRange = truaSlot ? truaSlot.timeRange : '11:30 - 13:00';

  // If slot specifies "trua" / "slot trua" / "ca trua" / "trưa"
  if (lowerStr.includes('trua') || lowerStr.includes('trưa')) {
    return { slotNum: 'trua', timeRange: truaTimeRange };
  }

  // If slot already contains time
  if (str.includes('-')) {
    if (str.includes(truaTimeRange) || lowerStr.includes('trua') || lowerStr.includes('trưa')) {
      return { slotNum: 'trua', timeRange: truaTimeRange };
    }
    return { slotNum: 0, timeRange: str };
  }

  // Extract number if formatted as "Slot 1", "Ca 1", "Tiết 1", "1", etc.
  const numMatch = str.match(/\d+/);
  const num = numMatch ? parseInt(numMatch[0], 10) : NaN;

  if (!isNaN(num)) {
    const matchedSlot = DEFAULT_TIME_SLOTS.find(s => s.slotNumber === num);
    if (matchedSlot) {
      return { slotNum: num, timeRange: matchedSlot.timeRange };
    }
    return { slotNum: num, timeRange: `Ca ${num}` };
  }

  return { slotNum: 1, timeRange: DEFAULT_TIME_SLOTS[0]?.timeRange || '07:15 - 08:00' };
}

/**
 * Parse an Excel file (ArrayBuffer or File) and map against existing rooms and bookings
 */
export async function parseExcelBookingFile(
  fileData: ArrayBuffer,
  existingRooms: Room[],
  existingBookings: Booking[]
): Promise<ExcelImportSummary> {
  const multi = await parseMultipleExcelBookingFiles(
    [{ name: 'Lịch_đặt_phòng.xlsx', size: '', buffer: fileData }],
    existingRooms,
    existingBookings
  );
  return {
    totalRows: multi.totalRows,
    validRows: multi.validRows,
    conflictingRows: multi.conflictingRows,
    skippedRows: multi.skippedRows,
    newRoomsToCreate: multi.newRoomsToCreate,
    dateRange: multi.dateRange,
    roomsCount: multi.roomsCount,
    teachersCount: multi.teachersCount,
  };
}

/**
 * Xử lý tải lên và phân tích hàng loạt file Excel cùng một lúc (Batch Multi-File Import)
 * Tự động gom nhóm, kiểm tra trùng lặp giữa các file và với CSDL
 */
export async function parseMultipleExcelBookingFiles(
  files: { name: string; size?: string; buffer: ArrayBuffer }[],
  existingRooms: Room[],
  existingBookings: Booking[]
): Promise<MultiExcelImportSummary> {
  if (!files || files.length === 0) {
    throw new Error('Chưa có file Excel nào được chọn để xử lý!');
  }

  const allValidRows: ParsedExcelBookingRow[] = [];
  const allConflictingRows: ParsedExcelBookingRow[] = [];
  const allSkippedRows: { rowIndex: number; reason: string; rawRow: any; sourceFileName?: string }[] = [];
  const newRoomsMap = new Map<string, { roomId: string; roomName: string }>();
  const teacherSet = new Set<string>();
  const dateSet = new Set<string>();

  // Map to detect intra-batch duplicates across all uploaded files
  // Key: roomId_dateStr_slot -> sourceFileName
  const internalSlotKeys = new Map<string, string>();

  const filesBreakdown: FileImportBreakdown[] = [];

  for (const f of files) {
    let fileValidCount = 0;
    let fileConflictCount = 0;
    let fileSkippedCount = 0;
    let fileTotalRows = 0;
    let fileError = '';

    try {
      const workbook = XLSX.read(f.buffer, { type: 'array', cellDates: true });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        throw new Error(`File "${f.name}" không có sheet dữ liệu nào!`);
      }

      const sheet = workbook.Sheets[sheetName];

      // Auto-detect header row
      const rawRows2D: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      let headerRowIndex = 0;
      const headerKeywords = ['day', 'ngay', 'date', 'slot', 'ca', 'tiet', 'room', 'phong', 'teacher', 'giangvien', 'monhoc', 'subject'];
      for (let r = 0; r < Math.min(rawRows2D.length, 15); r++) {
        const rowCells = rawRows2D[r] || [];
        const normalizedCells = rowCells.map(c => normalizeKey(String(c)));
        const matchCount = headerKeywords.filter(kw => normalizedCells.some(cell => cell.includes(kw))).length;
        if (matchCount >= 2) {
          headerRowIndex = r;
          break;
        }
      }

      const rawRows: any[] = XLSX.utils.sheet_to_json(sheet, {
        range: headerRowIndex,
        defval: '',
      });

      const MAX_ROWS_PER_FILE = 5000;
      if (rawRows.length > MAX_ROWS_PER_FILE) {
        throw new Error(
          `File "${f.name}" có ${rawRows.length} dòng dữ liệu, vượt quá giới hạn an toàn ${MAX_ROWS_PER_FILE} dòng/file! Vui lòng chia nhỏ file để tránh quá tải bộ nhớ.`
        );
      }

      for (let idx = 0; idx < rawRows.length; idx++) {
        const row = rawRows[idx];
        const actualFileRowNum = idx + 1 + headerRowIndex + 1;

        const hasAnyValue = Object.values(row).some(v => v !== null && v !== undefined && String(v).trim() !== '');
        if (!hasAnyValue) {
          continue;
        }

        fileTotalRows++;

        const academicStart = getVal(row, 'Academic Start Year', 'AcademicStartYear', 'StartYear', 'NamBatDau', 'NamHoc');
        const academicEnd = getVal(row, 'Academic End Year', 'AcademicEndYear', 'EndYear', 'NamKetThuc');

        const { dateStr, valid, d, m, y } = parseBookingDateFromRow(row, academicStart);
        if (!valid || !dateStr) {
          fileSkippedCount++;
          allSkippedRows.push({
            rowIndex: actualFileRowNum,
            reason: `Không nhận diện được ngày tháng ở file "${f.name}"`,
            rawRow: row,
            sourceFileName: f.name,
          });
          continue;
        }

        const slotRaw = getVal(row, 'Slot', 'Ca', 'Tiet', 'TimeSlot', 'KhungGio', 'Gio');
        const { slotNum, timeRange } = mapSlotToTimeRange(slotRaw);

        const roomRaw = String(getVal(row, 'Room', 'Phong', 'PhongHoc', 'RoomId', 'RoomName', 'TenPhong', 'MaPhong') || '').trim();
        if (!roomRaw) {
          fileSkippedCount++;
          allSkippedRows.push({
            rowIndex: actualFileRowNum,
            reason: `Thiếu tên phòng ở file "${f.name}"`,
            rawRow: row,
            sourceFileName: f.name,
          });
          continue;
        }

        const teacher = String(getVal(row, 'Teacher', 'GiangVien', 'GiaoVien', 'GV', 'NguoiDay') || 'Giảng viên').trim();
        const subjectCode = String(getVal(row, 'subjectcode', 'SubjectCode', 'MonHoc', 'MaMon', 'Subject', 'Mon') || '').trim();
        const className = String(getVal(row, 'classname', 'ClassName', 'Lop', 'LopHoc', 'Class', 'MaLop') || '').trim();
        const style = String(getVal(row, 'style', 'Style', 'HinhThuc', 'LoaiLop') || '').trim();

        const cleanRoomId = roomRaw.trim().toUpperCase();

        // Tìm phòng trong CSDL hiện có (khớp cả "314" với "314", "B314", "Phòng 314"...)
        const matchedRoom = findMatchingRoom(roomRaw, existingRooms);

        const roomId = matchedRoom ? matchedRoom.room_id : cleanRoomId;
        const roomName = matchedRoom
          ? matchedRoom.room_name
          : isNaN(Number(roomRaw))
          ? roomRaw
          : `Phòng ${roomRaw}`;
        const isNewRoom = !matchedRoom;

        const loaiPhongCol = String(getVal(row, 'LoaiPhong', 'RoomType', 'Type', 'PhanLoai', 'ChucNang') || '').toLowerCase();
        // Ưu tiên cao nhất: thuộc tính room_type đã cài đặt trong CSDL (bảng rooms) hoặc cột trong file
        let roomType: RoomType = normalizeRoomType(loaiPhongCol || matchedRoom?.room_type, roomName, roomId);

        if (isNewRoom) {
          newRoomsMap.set(roomId.toLowerCase(), { roomId, roomName, roomType } as any);
        }

        const purposeParts: string[] = [];
        if (subjectCode) purposeParts.push(`Môn: ${subjectCode}`);
        if (className) purposeParts.push(`Lớp: ${className}`);
        if (teacher) purposeParts.push(`GV: ${teacher}`);
        if (style) purposeParts.push(`HT: ${style}`);
        const purpose = purposeParts.length > 0 ? purposeParts.join(' | ') : 'Lịch giảng dạy theo thời khóa biểu';

        // Conflict check with DB
        const cleanSlotCheck = (timeRange || '').split(' (')[0].trim().toLowerCase();
        const hasDbConflict = existingBookings.some(b => {
          if (!b) return false;
          if (b.status === 'Rejected' || b.status === 'Cancelled') return false;
          const bRoom = String(b.room_id || '').toLowerCase();
          const currentRoom = String(roomId || '').toLowerCase();
          if (bRoom !== currentRoom) return false;
          if (b.date !== dateStr) return false;
          const bSlots = String(b.time_slot || '').toLowerCase();
          const isNumSlot = typeof slotNum === 'number' && slotNum > 0;
          return (
            bSlots.includes(cleanSlotCheck) ||
            (isNumSlot && bSlots.includes(`slot ${slotNum}`)) ||
            (slotNum === 'trua' && (bSlots.includes('slot trua') || bSlots.includes('11:30 - 13:00') || bSlots.includes('trưa')))
          );
        });

        // Intra-batch and cross-file check
        const intraKey = `${String(roomId || '').toLowerCase()}_${dateStr}_${slotNum || cleanSlotCheck}`;
        const prevClaimedFile = internalSlotKeys.get(intraKey);
        const hasIntraConflict = !!prevClaimedFile;

        if (!hasIntraConflict) {
          internalSlotKeys.set(intraKey, f.name);
        }

        const hasConflict = hasDbConflict || hasIntraConflict;
        const conflictReason = hasDbConflict
          ? 'Đã có lịch book trước trong CSDL'
          : hasIntraConflict
          ? prevClaimedFile === f.name
            ? 'Trùng lặp với hàng khác trong cùng file'
            : `Trùng lặp với lịch từ file "${prevClaimedFile}"`
          : undefined;

        const parsedRow: ParsedExcelBookingRow = {
          sourceFileName: f.name,
          academicStartYear: academicStart,
          academicEndYear: academicEnd,
          day: d,
          month: m,
          year: y,
          dateStr,
          slot: slotNum || slotRaw,
          slotTimeRange: timeRange,
          roomRaw,
          roomId,
          roomName,
          roomType,
          isNewRoom,
          teacher,
          subjectCode,
          className,
          style,
          purpose,
          status: 'Approved',
          hasConflict,
          conflictReason,
          rawRow: row,
        };

        if (hasConflict) {
          fileConflictCount++;
          allConflictingRows.push(parsedRow);
        } else {
          fileValidCount++;
          allValidRows.push(parsedRow);
        }

        teacherSet.add(teacher);
        dateSet.add(dateStr);
      }

      filesBreakdown.push({
        fileName: f.name,
        fileSize: f.size || '',
        totalRows: fileTotalRows,
        validCount: fileValidCount,
        conflictCount: fileConflictCount,
        skippedCount: fileSkippedCount,
        status: fileConflictCount > 0 ? 'warning' : 'success',
      });
    } catch (err: any) {
      console.error(`Lỗi phân tích file "${f.name}":`, err);
      fileError = err.message || 'Lỗi không xác định khi đọc file';
      filesBreakdown.push({
        fileName: f.name,
        fileSize: f.size || '',
        totalRows: 0,
        validCount: 0,
        conflictCount: 0,
        skippedCount: 0,
        status: 'error',
        errorMessage: fileError,
      });
    }
  }

  const sortedDates = Array.from(dateSet).sort();
  const dateRange = {
    min: sortedDates[0] || '',
    max: sortedDates[sortedDates.length - 1] || '',
  };

  const uniqueRooms = new Set([
    ...allValidRows.map(r => r.roomId),
    ...allConflictingRows.map(r => r.roomId),
  ]);

  return {
    files: filesBreakdown,
    totalFiles: files.length,
    totalRows: allValidRows.length + allConflictingRows.length,
    validRows: allValidRows,
    conflictingRows: allConflictingRows,
    skippedRows: allSkippedRows,
    newRoomsToCreate: Array.from(newRoomsMap.values()),
    dateRange,
    roomsCount: uniqueRooms.size,
    teachersCount: teacherSet.size,
  };
}

/**
 * Execute booking creation from parsed rows with direct Supabase persistence
 * Có tùy chọn overwriteExisting để ghi đè lịch cũ khi tải lại file
 */
export async function commitExcelBookings(
  rowsToBook: ParsedExcelBookingRow[],
  newRoomsToCreate: { roomId: string; roomName: string }[],
  currentSessionUser: { username: string; fullname: string },
  overwriteExisting: boolean = false
): Promise<{
  success: boolean;
  bookedCount: number;
  roomsCreatedCount: number;
  message: string;
  isSupabase: boolean;
}> {
  if (rowsToBook.length === 0) {
    return {
      success: false,
      bookedCount: 0,
      roomsCreatedCount: 0,
      message: 'Không có dữ liệu hợp lệ để đặt phòng!',
      isSupabase: false,
    };
  }

  const client = getSupabaseClient();
  let roomsCreatedCount = 0;

  // 1. Map all rooms that will be referenced by bookings
  const allRoomsMap = new Map<string, { name: string; type: RoomType }>();
  for (const r of rowsToBook) {
    const cleanRId = (r.roomId || '').trim().toUpperCase();
    const cleanRName = (r.roomName || `Phòng ${cleanRId}`).trim();
    allRoomsMap.set(cleanRId, { name: cleanRName, type: r.roomType || 'chinh_khoa' });
  }

  // 2. Prepare Booking items
  const now = new Date();
  const bookingsToInsert: Booking[] = rowsToBook.map((row, idx) => {
    const bookingId = `BK_EXCEL_${Date.now()}_${idx + 1}`;
    const cleanRoomId = (row.roomId || '').trim().toUpperCase();
    const teacherName = (row.teacher || '').trim();
    return {
      booking_id: bookingId,
      room_id: cleanRoomId,
      room_name: row.roomName || `Phòng ${cleanRoomId}`,
      room_type: row.roomType || 'chinh_khoa',
      username: teacherName || currentSessionUser.username || 'admin',
      fullname: teacherName || currentSessionUser.fullname || 'Giảng viên',
      borrower_name: teacherName || currentSessionUser.fullname || 'Giảng viên',
      date: row.dateStr,
      time_slot: row.slotTimeRange,
      purpose: row.purpose,
      created_at: new Date(now.getTime() + idx * 5).toISOString(),
      status: 'Approved',
    };
  });

  // 3. Save to Supabase (if connected)
  if (client) {
    try {
      // Step A: Chỉ chèn các phòng MỚI chưa có trong CSDL (không ghi đè phòng đã có để giữ nguyên loại phòng bạn đã sửa trong database)
      if (newRoomsToCreate && newRoomsToCreate.length > 0) {
        const newRoomsPayload = newRoomsToCreate.map(nr => {
          const cleanId = (nr.roomId || '').trim().toUpperCase();
          const rdata = allRoomsMap.get(cleanId);
          return {
            room_id: cleanId,
            room_name: nr.roomName || `Phòng ${nr.roomId}`,
            capacity: 40,
            status: 'Active',
            room_type: rdata?.type || 'chinh_khoa',
          };
        });

        try {
          const { error: roomErr } = await client.from('rooms').upsert(newRoomsPayload, { onConflict: 'room_id' });
          if (roomErr) {
            console.warn('Supabase rooms upsert notice:', roomErr.message);
            try {
              await client.from('rooms').insert(newRoomsPayload);
            } catch {}
          }
        } catch (rErr) {
          console.warn('Room upsert exception:', rErr);
        }
      }
      roomsCreatedCount = newRoomsToCreate ? newRoomsToCreate.length : 0;

      // Step B: Ensure teachers exist in Supabase `users` table
      const uniqueTeachers = new Set<string>();
      for (const r of rowsToBook) {
        const t = (r.teacher || '').trim();
        if (t) uniqueTeachers.add(t);
      }

      if (uniqueTeachers.size > 0) {
        const teachersPayload = Array.from(uniqueTeachers).map(tName => ({
          username: tName,
          password: '123456',
          fullname: tName,
          role: 'user',
          email: `${tName.toLowerCase().replace(/[^a-z0-9]/g, '')}@fpt.edu.vn`,
        }));
        try {
          const { error: uErr } = await client.from('users').upsert(teachersPayload, { onConflict: 'username' });
          if (uErr) {
            console.warn('Supabase teachers upsert notice:', uErr.message);
          }
        } catch (err) {
          console.warn('Teacher upsert exception:', err);
        }
      }

      // Step C: Insert bookings into Supabase in batches of 50
      const chunkSize = 50;
      for (let i = 0; i < bookingsToInsert.length; i += chunkSize) {
        let chunk: any[] = bookingsToInsert.slice(i, i + chunkSize);
        let { error: insertErr } = await client.from('bookings').insert(chunk);

        // If insert failed due to borrower_name column missing in table (code 42703), retry without borrower_name
        if (insertErr && (insertErr.message?.includes('borrower_name') || (insertErr as any).code === '42703')) {
          console.warn('Supabase bookings table lacks borrower_name column, retrying without borrower_name...');
          chunk = chunk.map(b => {
            const { borrower_name, ...rest } = b;
            return rest;
          });
          const retryRes = await client.from('bookings').insert(chunk);
          insertErr = retryRes.error;
        }

        // If insert failed due to foreign key constraint on users table, fallback username to currentSessionUser
        if (insertErr && (insertErr.message?.includes('users') || insertErr.message?.includes('foreign key'))) {
          console.warn('Foreign key violation on users table, retrying with fallback username:', currentSessionUser.username);
          const sanitizedChunk = chunk.map(b => ({
            ...b,
            username: currentSessionUser.username || 'admin',
          }));
          const retryRes = await client.from('bookings').insert(sanitizedChunk);
          insertErr = retryRes.error;
        }

        if (insertErr) {
          console.error('Supabase bookings insert error:', insertErr);
          saveToLocalStorage(bookingsToInsert, allRoomsMap, overwriteExisting);
          return {
            success: true,
            bookedCount: bookingsToInsert.length,
            roomsCreatedCount,
            message: `Đã lưu thành công ${bookingsToInsert.length} slot vào bộ nhớ máy! (LƯU Ý Supabase: ${insertErr.message})`,
            isSupabase: false,
          };
        }
      }
    } catch (e: any) {
      console.error('Lỗi ngoại lệ khi ghi Supabase:', e);
      saveToLocalStorage(bookingsToInsert, allRoomsMap, overwriteExisting);
      return {
        success: true,
        bookedCount: bookingsToInsert.length,
        roomsCreatedCount,
        message: `Đã lưu ${bookingsToInsert.length} slot vào bộ nhớ máy (LƯU Ý: Lỗi kết nối CSDL Supabase: ${e?.message || e})`,
        isSupabase: false,
      };
    }
  }

  // 4. Always sync to LocalStorage
  saveToLocalStorage(bookingsToInsert, allRoomsMap, overwriteExisting);

  if (client) {
    return {
      success: true,
      bookedCount: bookingsToInsert.length,
      roomsCreatedCount,
      message: `Đã book thành công ${bookingsToInsert.length} slot phòng học và LƯU TRỰC TIẾP VÀO CSDL SUPABASE (bảng bookings & rooms)!`,
      isSupabase: true,
    };
  }

  return {
    success: true,
    bookedCount: bookingsToInsert.length,
    roomsCreatedCount,
    message: `Đã lưu ${bookingsToInsert.length} slot vào bộ nhớ hệ thống thành công!`,
    isSupabase: false,
  };
}

function saveToLocalStorage(bookingsToInsert: Booking[], allRoomsMap: Map<string, { name: string; type: RoomType }>, overwriteExisting: boolean = false) {
  try {
    const BOOKINGS_KEY = 'vuth_booking_bookings';
    const raw = localStorage.getItem(BOOKINGS_KEY);
    const existing: Booking[] = raw ? JSON.parse(raw) : [];

    let updated: Booking[];
    if (overwriteExisting) {
      // Bỏ qua các booking cũ cùng ngày, cùng phòng, cùng khung giờ để tránh trùng lặp
      const newKeys = new Set(
        bookingsToInsert.map(b => `${String(b.room_id || '').toLowerCase()}_${b.date}_${String(b.time_slot || '').toLowerCase()}`)
      );
      const remainingExisting = existing.filter(
        b => b && !newKeys.has(`${String(b.room_id || '').toLowerCase()}_${b.date}_${String(b.time_slot || '').toLowerCase()}`)
      );
      updated = [...bookingsToInsert, ...remainingExisting];
    } else {
      updated = [...bookingsToInsert, ...existing];
    }
    localStorage.setItem(BOOKINGS_KEY, JSON.stringify(updated));

    const ROOMS_KEY = 'vuth_booking_rooms';
    const rawRooms = localStorage.getItem(ROOMS_KEY);
    const existingRooms: Room[] = rawRooms ? JSON.parse(rawRooms) : [];
    const newRoomsToAdd: Room[] = [];
    allRoomsMap.forEach((rinfo, rid) => {
      const existingIdx = existingRooms.findIndex(er => er && String(er.room_id || '').toUpperCase() === String(rid || '').toUpperCase());
      if (existingIdx === -1) {
        newRoomsToAdd.push({
          room_id: rid,
          room_name: rinfo.name,
          capacity: 40,
          status: 'Active',
          room_type: rinfo.type,
        });
      } else if (!existingRooms[existingIdx].room_type) {
        existingRooms[existingIdx].room_type = rinfo.type;
      }
    });
    if (newRoomsToAdd.length > 0 || allRoomsMap.size > 0) {
      localStorage.setItem(ROOMS_KEY, JSON.stringify([...existingRooms, ...newRoomsToAdd]));
    }
  } catch (e) {
    console.warn('LocalStorage save warning:', e);
  }
}

/**
 * Generate and download a sample Excel file matching user's exact format
 */
export function downloadSampleExcel() {
  const sampleData = [
    {
      'Multi-campus': 'FSCCT',
      'term': 'Fall 2026',
      'Academic Start Year': 2026,
      'Academic End Year': 2027,
      'Day': 17,
      'Month': 8,
      'Year': 2026,
      'Slot': 1,
      'Room': '302',
      'Teacher': 'PhuongTM30',
      'subjectcode': 'CC',
      'classname': '11T1',
      'style': 'LT',
      'Có trả phí': 'Không',
    },
    {
      'Multi-campus': 'FSCCT',
      'term': 'Fall 2026',
      'Academic Start Year': 2026,
      'Academic End Year': 2027,
      'Day': 17,
      'Month': 8,
      'Year': 2026,
      'Slot': 2,
      'Room': '302',
      'Teacher': 'PhuongTM30',
      'subjectcode': 'CC',
      'classname': '11T1',
      'style': 'LT',
      'Có trả phí': 'Không',
    },
    {
      'Multi-campus': 'FSCCT',
      'term': 'Fall 2026',
      'Academic Start Year': 2026,
      'Academic End Year': 2027,
      'Day': 17,
      'Month': 8,
      'Year': 2026,
      'Slot': 3,
      'Room': '302',
      'Teacher': 'PhuongTM30',
      'subjectcode': 'CC',
      'classname': '11T1',
      'style': 'LT',
      'Có trả phí': 'Không',
    },
    {
      'Multi-campus': 'FSCCT',
      'term': 'Fall 2026',
      'Academic Start Year': 2026,
      'Academic End Year': 2027,
      'Day': 17,
      'Month': 8,
      'Year': 2026,
      'Slot': 4,
      'Room': '302',
      'Teacher': 'PhuongTM30',
      'subjectcode': 'CC',
      'classname': '11T1',
      'style': 'LT',
      'Có trả phí': 'Không',
    },
    {
      'Multi-campus': 'FSCCT',
      'term': 'Fall 2026',
      'Academic Start Year': 2026,
      'Academic End Year': 2027,
      'Day': 18,
      'Month': 8,
      'Year': 2026,
      'Slot': 1,
      'Room': '302',
      'Teacher': 'PhuongTM30',
      'subjectcode': 'CC',
      'classname': '11T1',
      'style': 'LT',
      'Có trả phí': 'Không',
    },
    {
      'Multi-campus': 'FSCCT',
      'term': 'Fall 2026',
      'Academic Start Year': 2026,
      'Academic End Year': 2027,
      'Day': 18,
      'Month': 8,
      'Year': 2026,
      'Slot': 2,
      'Room': '302',
      'Teacher': 'PhuongTM30',
      'subjectcode': 'CC',
      'classname': '11T1',
      'style': 'LT',
      'Có trả phí': 'Không',
    },
    {
      'Multi-campus': 'FSCCT',
      'term': 'Fall 2026',
      'Academic Start Year': 2026,
      'Academic End Year': 2027,
      'Day': 17,
      'Month': 8,
      'Year': 2026,
      'Slot': 1,
      'Room': '303',
      'Teacher': 'HienNP4',
      'subjectcode': 'CC',
      'classname': '11T2',
      'style': 'LT',
      'Có trả phí': 'Không',
    },
    {
      'Multi-campus': 'FSCCT',
      'term': 'Fall 2026',
      'Academic Start Year': 2026,
      'Academic End Year': 2027,
      'Day': 17,
      'Month': 8,
      'Year': 2026,
      'Slot': 2,
      'Room': '303',
      'Teacher': 'HienNP4',
      'subjectcode': 'CC',
      'classname': '11T2',
      'style': 'LT',
      'Có trả phí': 'Không',
    },
    {
      'Multi-campus': 'FSCCT',
      'term': 'Fall 2026',
      'Academic Start Year': 2026,
      'Academic End Year': 2027,
      'Day': 17,
      'Month': 8,
      'Year': 2026,
      'Slot': 3,
      'Room': '303',
      'Teacher': 'HienNP4',
      'subjectcode': 'CC',
      'classname': '11T2',
      'style': 'LT',
      'Có trả phí': 'Không',
    },
    {
      'Multi-campus': 'FSCCT',
      'term': 'Fall 2026',
      'Academic Start Year': 2026,
      'Academic End Year': 2027,
      'Day': 17,
      'Month': 8,
      'Year': 2026,
      'Slot': 4,
      'Room': '303',
      'Teacher': 'HienNP4',
      'subjectcode': 'CC',
      'classname': '11T2',
      'style': 'LT',
      'Có trả phí': 'Không',
    },
  ];

  const ws = XLSX.utils.json_to_sheet(sampleData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ThoiKhoaBieu');
  XLSX.writeFile(wb, 'Mau_Lich_Book_Phong_FSCCT.xlsx');
}
