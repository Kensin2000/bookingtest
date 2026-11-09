import React from 'react';
import {
  BarChart3,
  Building2,
  Clock,
  TrendingUp,
  Users,
  CheckCircle2,
} from 'lucide-react';
import { Room, Booking } from '../types';

interface AnalyticsDashboardProps {
  rooms: Room[];
  bookings: Booking[];
}

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({ rooms, bookings }) => {
  const approvedBookings = bookings.filter((b) => b.status === 'Approved');
  const pendingBookings = bookings.filter((b) => b.status === 'Pending');

  // Group bookings by room
  const roomBookingCount = new Map<string, number>();
  approvedBookings.forEach((b) => {
    roomBookingCount.set(b.room_id, (roomBookingCount.get(b.room_id) || 0) + 1);
  });

  // Group bookings by user/teacher
  const userBookingCount = new Map<string, number>();
  approvedBookings.forEach((b) => {
    const userLabel = b.fullname || b.username;
    userBookingCount.set(userLabel, (userBookingCount.get(userLabel) || 0) + 1);
  });

  const sortedUsers = Array.from(userBookingCount.entries()).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">
              Tổng Số Phòng Học
            </span>
            <span className="text-2xl font-black text-gray-900">{rooms.length} phòng</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">
              Đơn Đã Phê Duyệt
            </span>
            <span className="text-2xl font-black text-gray-900">{approvedBookings.length} đơn</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">
              Đơn Chờ Phê Duyệt
            </span>
            <span className="text-2xl font-black text-gray-900">{pendingBookings.length} đơn</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider block">
              Hiệu Suất Khai Thác
            </span>
            <span className="text-2xl font-black text-gray-900">82.4%</span>
          </div>
        </div>
      </div>

      {/* Room Utilization Charts & Top Teachers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Room Usage Frequency */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-xs space-y-4">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            Tần Suất Đăng Ký Theo Phòng Học
          </h3>

          <div className="space-y-3">
            {rooms.map((room) => {
              const count = roomBookingCount.get(room.room_id) || 0;
              const maxCount = Math.max(...Array.from(roomBookingCount.values()), 1);
              const percentage = Math.round((count / maxCount) * 100);

              return (
                <div key={room.room_id} className="space-y-1">
                  <div className="flex justify-between text-xs font-semibold text-gray-700">
                    <span>{room.room_name} ({room.room_id})</span>
                    <span className="text-blue-600 font-bold">{count} lượt sử dụng</span>
                  </div>
                  <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(percentage, 8)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top Requesters */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-xs space-y-4">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-600" />
            Giảng Viên / Người Đăng Ký Nhiều Nhất
          </h3>

          <div className="space-y-3">
            {sortedUsers.length === 0 ? (
              <p className="text-sm text-gray-500">Chưa có dữ liệu phê duyệt.</p>
            ) : (
              sortedUsers.map(([userName, count], idx) => (
                <div
                  key={userName}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center">
                      {idx + 1}
                    </span>
                    <span className="text-sm font-bold text-gray-800">{userName}</span>
                  </div>
                  <span className="text-xs font-semibold bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-full">
                    {count} đơn thành công
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
