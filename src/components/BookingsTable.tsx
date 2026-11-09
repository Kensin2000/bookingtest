import React, { useState } from 'react';
import {
  Check,
  X,
  Download,
  Filter,
  CheckCircle,
  XCircle,
  Clock,
  User,
  Calendar,
  Building,
  AlertCircle,
  Trash2,
} from 'lucide-react';
import { Booking, BookingStatus, UserAccount } from '../types';

interface BookingsTableProps {
  bookings: Booking[];
  onUpdateStatus: (bookingId: string, status: BookingStatus, rejectReason?: string) => Promise<void>;
  searchQuery: string;
  currentUser: UserAccount;
}

export const BookingsTable: React.FC<BookingsTableProps> = ({
  bookings,
  onUpdateStatus,
  searchQuery,
  currentUser,
}) => {
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [rejectModalBookingId, setRejectModalBookingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('');

  const filteredBookings = bookings.filter((b) => {
    const bId = String(b.booking_id || (b as any).id || '').toUpperCase();
    if (
      bId.startsWith('BK_EXCEL_') ||
      bId.includes('BK_EXCEL_') ||
      bId.startsWith('BK_RECUR_') ||
      bId.includes('BK_RECUR_')
    ) return false;

    if (selectedStatus !== 'all' && b.status !== selectedStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchPurpose = (b.purpose || '').toLowerCase().includes(q);
      const matchUser = (b.borrower_name || '').toLowerCase().includes(q) || (b.fullname || b.username || '').toLowerCase().includes(q);
      const matchRoom = (b.room_name || b.room_id || '').toLowerCase().includes(q);
      const matchId = (b.booking_id || '').toLowerCase().includes(q);
      return matchPurpose || matchUser || matchRoom || matchId;
    }
    return true;
  });

  const handleConfirmReject = async () => {
    if (!rejectModalBookingId) return;
    await onUpdateStatus(rejectModalBookingId, 'Rejected', rejectReason);
    setRejectModalBookingId(null);
    setRejectReason('');
  };

  const exportToCSV = () => {
    const headers = ['Mã Đơn', 'Nội Dung / Lý Do', 'Mã Phòng', 'Tên Phòng', 'Người Mượn', 'Tài Khoản Đặt', 'Ngày', 'Khung Giờ', 'Trạng Thái'];
    const rows = filteredBookings.map(b => [
      b.booking_id,
      `"${(b.purpose || '').replace(/"/g, '""')}"`,
      b.room_id,
      `"${(b.room_name || '').replace(/"/g, '""')}"`,
      `"${b.borrower_name || b.fullname || ''}"`,
      `${b.fullname || ''} (@${b.username})`,
      b.date,
      `"${b.time_slot}"`,
      b.status
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `danh_sach_dat_phong_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Filter and Export Toolbar */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-gray-200 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Status Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0 scrollbar-none">
          <button
            onClick={() => setSelectedStatus('all')}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
              selectedStatus === 'all'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Tất cả ({bookings.length})
          </button>
          <button
            onClick={() => setSelectedStatus('Pending')}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
              selectedStatus === 'Pending'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
            }`}
          >
            Chờ duyệt ({bookings.filter((b) => b.status === 'Pending').length})
          </button>
          <button
            onClick={() => setSelectedStatus('Approved')}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
              selectedStatus === 'Approved'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
            }`}
          >
            Đã duyệt ({bookings.filter((b) => b.status === 'Approved').length})
          </button>
          <button
            onClick={() => setSelectedStatus('Rejected')}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
              selectedStatus === 'Rejected'
                ? 'bg-red-600 text-white shadow-xs'
                : 'bg-red-50 text-red-800 hover:bg-red-100'
            }`}
          >
            Từ chối ({bookings.filter((b) => b.status === 'Rejected').length})
          </button>
        </div>

        {/* CSV Export Button */}
        <button
          onClick={exportToCSV}
          className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-semibold px-4 py-2 rounded-xl transition-all border border-gray-200 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          Xuất Báo Cáo CSV
        </button>
      </div>

      {/* Bookings Table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-xs font-bold text-gray-600 uppercase tracking-wider">
                <th className="p-4">Mã Đơn & Nội Dung</th>
                <th className="p-4">Phòng Học</th>
                <th className="p-4">Người Mượn</th>
                <th className="p-4">Ngày & Khung Giờ</th>
                <th className="p-4">Trạng Thái</th>
                <th className="p-4 text-right">Duyệt Đơn</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 text-sm">
              {filteredBookings.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-gray-500">
                    Chưa có đơn đặt phòng nào phù hợp.
                  </td>
                </tr>
              ) : (
                filteredBookings.map((b) => (
                  <tr key={b.booking_id} className="hover:bg-gray-50/50 transition-colors">
                    {/* Purpose & ID */}
                    <td className="p-4">
                      <div className="font-bold text-gray-900">{b.purpose}</div>
                      <div className="text-xs text-gray-500 font-mono mt-0.5">
                        Mã: <span className="font-semibold text-gray-700">{b.booking_id}</span>
                      </div>
                    </td>

                    {/* Room */}
                    <td className="p-4 font-semibold text-blue-700">
                      <div>{b.room_name}</div>
                      <div className="text-xs text-gray-500 font-mono font-normal">Mã: {b.room_id}</div>
                    </td>

                    {/* Organizer / Borrower */}
                    <td className="p-4">
                      <div className="font-semibold text-gray-900">{b.borrower_name || b.fullname || b.username}</div>
                      {b.borrower_name && b.fullname && b.borrower_name !== b.fullname ? (
                        <div className="text-xs text-gray-500">Đăng ký: {b.fullname} (@{b.username})</div>
                      ) : (
                        <div className="text-xs text-gray-500">@{b.username}</div>
                      )}
                    </td>

                    {/* Time & Slot */}
                    <td className="p-4 text-xs font-medium">
                      <div className="text-gray-900 font-bold">{b.date}</div>
                      <div className="text-blue-700 font-mono mt-0.5 max-w-[200px] truncate" title={b.time_slot}>
                        {b.time_slot}
                      </div>
                    </td>

                    {/* Status */}
                    <td className="p-4">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
                          b.status === 'Approved'
                            ? 'bg-emerald-100 text-emerald-800'
                            : b.status === 'Pending'
                            ? 'bg-amber-100 text-amber-800'
                            : b.status === 'Rejected'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {b.status === 'Approved' && '✅ Đã Duyệt'}
                        {b.status === 'Pending' && '⏳ Chờ Duyệt'}
                        {b.status === 'Rejected' && '❌ Từ Chối'}
                        {b.status === 'Cancelled' && '🚫 Đã Hủy'}
                      </span>
                      {b.reject_reason && (
                        <div className="text-[11px] text-red-600 mt-1 max-w-[150px] truncate" title={b.reject_reason}>
                          Lý do: {b.reject_reason}
                        </div>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {(currentUser.role === 'admin' || currentUser.role === 'superadmin') && b.status === 'Pending' && (
                          <>
                            <button
                              onClick={() => onUpdateStatus(b.booking_id, 'Approved')}
                              className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg transition-colors border border-emerald-200 cursor-pointer"
                              title="Phê duyệt đơn này"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setRejectModalBookingId(b.booking_id)}
                              className="p-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg transition-colors border border-red-200 cursor-pointer"
                              title="Từ chối đơn này"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        {(currentUser.role === 'admin' || currentUser.role === 'superadmin' || currentUser.username === b.username) &&
                          (b.status === 'Approved' || b.status === 'Pending') && (
                            <button
                              onClick={() => onUpdateStatus(b.booking_id, 'Cancelled')}
                              className="text-xs text-gray-600 hover:text-red-600 px-2.5 py-1 rounded-lg border border-gray-200 hover:border-red-200 transition-colors cursor-pointer"
                            >
                              Hủy đơn
                            </button>
                          )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reject Modal */}
      {rejectModalBookingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-gray-200">
            <h3 className="text-base font-bold text-gray-900">Nhập lý do từ chối đơn đặt phòng</h3>
            <textarea
              rows={3}
              placeholder="Ví dụ: Phòng trùng lịch thi cử đột xuất hoặc cần bảo trì thiết bị..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 font-medium"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setRejectModalBookingId(null)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl text-sm font-medium cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                onClick={handleConfirmReject}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold cursor-pointer"
              >
                Xác Nhận Từ Chối
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
