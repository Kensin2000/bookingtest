export type RoomStatus = 'Active' | 'Inactive' | 'Maintenance';

export type BookingStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';

export type UserRole = 'superadmin' | 'admin' | 'user' | 'security' | 'baove' | 'bv';

export interface UserAccount {
  username: string;
  password?: string;
  fullname: string;
  role: UserRole;
  email: string;
}

export type RoomType = 'chinh_khoa' | 'chuc_nang';

export interface Room {
  room_id: string;
  room_name: string;
  capacity: number;
  status: RoomStatus;
  room_type?: RoomType; // 'chinh_khoa' (Phòng chính khóa) hoặc 'chuc_nang' (Phòng chức năng)
  floor?: string;
  building?: string;
  description?: string;
  image_url?: string;
}

export interface Booking {
  booking_id: string;
  room_id: string;
  room_name: string;
  room_type?: RoomType; // 'chinh_khoa' | 'chuc_nang'
  username: string;
  fullname: string;
  borrower_name?: string; // Thông tin / Họ tên người mượn
  date: string; // YYYY-MM-DD
  time_slot: string; // e.g. "07:15 - 08:00, 08:05 - 08:50"
  purpose: string;
  note?: string; // Ghi chú (VD: Mượn ly, dĩa, khay đựng điện thoại...)
  created_at: string;
  status: BookingStatus;
  reject_reason?: string;
}

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  isConnected: boolean;
}

export interface TimeSlotOption {
  slotNumber: number | string;
  timeRange: string;
  label: string;
}

