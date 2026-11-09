import React, { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Clock,
  User,
  Users,
  CheckCircle,
  AlertTriangle,
  PlusCircle,
  Building,
  Info,
  X,
  FileText,
  Tag,
} from 'lucide-react';
import { Room, Booking } from '../types';
import { DEFAULT_TIME_SLOTS } from '../lib/initialData';
import { isBookingMatchingSlot } from '../lib/slotValidation';

interface ScheduleTimelineProps {
  rooms: Room[];
  bookings: Booking[];
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  onSelectSlot: (roomId: string, date: string, timeSlot: string) => void;
  onViewBooking?: (booking: Booking) => void;
  searchQuery?: string;
}

export const ScheduleTimeline: React.FC<ScheduleTimelineProps> = ({
  rooms,
  bookings,
  selectedDate,
  setSelectedDate,
  onSelectSlot,
  onViewBooking,
  searchQuery = '',
}) => {
  const [filterFloor, setFilterFloor] = useState<string>('all');
  const [activeBookingModal, setActiveBookingModal] = useState<Booking | null>(null);

  // Date manipulation helpers
  const handlePrevDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 1);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  const handleNextDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 1);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  const handleToday = () => {
    setSelectedDate(new Date().toISOString().split('T')[0]);
  };

  const formattedDateString = new Date(selectedDate + 'T00:00:00').toLocaleDateString('vi-VN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Extract unique floors
  const floors = Array.from(new Set(rooms.map((r) => r.floor || 'Tầng 1')));

  const filteredRooms = rooms.filter((room) => {
    const matchFloor = filterFloor === 'all' || (room.floor || 'Tầng 1') === filterFloor;
    if (!matchFloor) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      (room.room_name || '').toLowerCase().includes(q) ||
      (room.room_id || '').toLowerCase().includes(q) ||
      (room.building || '').toLowerCase().includes(q) ||
      (room.floor || '').toLowerCase().includes(q) ||
      String(room.capacity).includes(q)
    );
  });

  // Helper to check if a booking occupies a slot
  const getBookingForSlot = (roomId: string, slotTimeRange: string) => {
    return bookings.find((b) => isBookingMatchingSlot(b, roomId, selectedDate, slotTimeRange));
  };

  const handleSlotClick = (booking: Booking) => {
    setActiveBookingModal(booking);
    if (onViewBooking) {
      onViewBooking(booking);
    }
  };

  return (
    <div className="space-y-4">
      {/* Date Header & Floor Filters */}
      <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Date Controls */}
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <button
            onClick={handleToday}
            className="px-3.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-sm font-semibold rounded-full transition-colors border border-blue-200"
          >
            Hôm nay
          </button>
          <div className="flex items-center bg-gray-100 rounded-full p-1 border border-gray-200">
            <button
              onClick={handlePrevDay}
              className="p-1.5 hover:bg-white rounded-full text-gray-700 transition-colors"
              title="Ngày trước"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="px-3 text-sm font-semibold text-gray-900 flex items-center gap-2">
              <CalendarIcon className="w-4 h-4 text-blue-600" />
              <span>{formattedDateString}</span>
            </div>
            <button
              onClick={handleNextDay}
              className="p-1.5 hover:bg-white rounded-full text-gray-700 transition-colors"
              title="Ngày sau"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-1.5 bg-gray-100 border border-gray-200 rounded-xl text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Floor Filter Chips */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
            Khu vực:
          </span>
          <button
            onClick={() => setFilterFloor('all')}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
              filterFloor === 'all'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Tất cả ({rooms.length} phòng)
          </button>
          {floors.map((fl) => (
            <button
              key={fl}
              onClick={() => setFilterFloor(fl)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
                filterFloor === fl
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {fl}
            </button>
          ))}
        </div>
      </div>

      {/* Schedule Matrix Table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1200px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="p-3 text-xs font-bold text-gray-700 uppercase tracking-wider sticky left-0 bg-gray-50 z-20 w-60 shadow-xs">
                  Phòng Học ({filteredRooms.length})
                </th>
                {DEFAULT_TIME_SLOTS.map((slot) => (
                  <th
                    key={slot.slotNumber}
                    className="p-2 text-center text-[11px] font-bold text-gray-700 border-l border-gray-200 min-w-[105px]"
                  >
                    <div className="text-blue-900 font-extrabold">Slot {slot.slotNumber}</div>
                    <div className="text-[10px] text-gray-500 font-mono font-normal">
                      {slot.timeRange}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredRooms.length === 0 ? (
                <tr>
                  <td colSpan={DEFAULT_TIME_SLOTS.length + 1} className="p-10 text-center text-gray-500">
                    <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
                    <p className="font-medium">Không tìm thấy phòng nào phù hợp với bộ lọc hiện tại.</p>
                  </td>
                </tr>
              ) : (
                filteredRooms.map((room) => {
                  const isRoomDisabled = room.status === 'Inactive' || room.status === 'Maintenance';
                  return (
                    <tr key={room.room_id} className="hover:bg-gray-50/50 transition-colors">
                      {/* Room Info Column (Sticky) */}
                      <td className="p-3 sticky left-0 bg-white z-10 border-r border-gray-200 shadow-xs">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`w-2 h-2 rounded-full shrink-0 ${
                                  isRoomDisabled ? 'bg-gray-400' : 'bg-emerald-500'
                                }`}
                              />
                              <h4 className="text-sm font-bold text-gray-900 leading-tight truncate">
                                {room.room_name}
                              </h4>
                            </div>
                            <div className="flex items-center gap-1.5 mt-1 text-xs text-gray-500 flex-wrap">
                              <span className="bg-blue-50 text-blue-700 px-1.5 py-0.2 rounded font-mono font-medium text-[11px]">
                                {room.room_id}
                              </span>
                              <span>• {room.floor || 'Tầng 1'}</span>
                              <span className="flex items-center gap-0.5">
                                <Users className="w-3 h-3 text-gray-400" /> {room.capacity}
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Slot Cells */}
                      {DEFAULT_TIME_SLOTS.map((slot) => {
                        if (isRoomDisabled) {
                          return (
                            <td
                              key={slot.slotNumber}
                              className="p-1 border-l border-gray-200 bg-gray-50/70 text-center align-middle"
                              title={`Phòng ${room.room_name} đang ${room.status || 'Tạm ngưng'}`}
                            >
                              <div className="h-20 flex items-center justify-center text-[11px] text-gray-400 font-medium">
                                Tạm khóa
                              </div>
                            </td>
                          );
                        }

                        const booking = getBookingForSlot(room.room_id, slot.timeRange);

                        if (booking) {
                          const isApproved = booking.status === 'Approved';
                          const isOpened = booking.status === 'Opened';

                          let badgeBg = 'bg-amber-100 text-amber-800 border-amber-300';
                          let badgeText = 'Chờ duyệt';
                          let cardBg = 'bg-amber-50/80 text-amber-950 border-amber-200 hover:bg-amber-100/90';

                          if (isOpened) {
                            badgeBg = 'bg-purple-100 text-purple-800 border-purple-300';
                            badgeText = 'Đã mở phòng';
                            cardBg = 'bg-purple-50/80 text-purple-950 border-purple-200 hover:bg-purple-100/90';
                          } else if (isApproved) {
                            badgeBg = 'bg-emerald-100 text-emerald-800 border-emerald-300';
                            badgeText = 'Đã duyệt';
                            cardBg = 'bg-emerald-50/80 text-emerald-950 border-emerald-200 hover:bg-emerald-100/90';
                          }

                          const borrowerDisp = booking.borrower_name || booking.fullname || booking.username;

                          return (
                            <td
                              key={slot.slotNumber}
                              onClick={() => handleSlotClick(booking)}
                              className="p-1 border-l border-gray-200 align-top cursor-pointer group"
                              title={`Nhấp xem chi tiết: ${room.room_name} - ${slot.timeRange} (${borrowerDisp})`}
                            >
                              <div
                                className={`h-20 rounded-xl p-2 text-xs flex flex-col justify-between transition-all border shadow-xs group-hover:scale-[1.02] ${cardBg}`}
                              >
                                <div>
                                  <div className="flex items-center justify-between gap-1">
                                    <span
                                      className={`inline-block px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase border ${badgeBg}`}
                                    >
                                      {badgeText}
                                    </span>
                                  </div>
                                  <div
                                    className="font-medium text-[11px] leading-tight line-clamp-1 mt-1 text-gray-800"
                                    title={booking.purpose}
                                  >
                                    {booking.purpose}
                                  </div>
                                </div>

                                <div className="mt-1 pt-1 border-t border-black/5">
                                  <div
                                    className="truncate flex items-center gap-1 font-bold text-[10.5px] text-blue-900"
                                    title={`Người mượn: ${borrowerDisp}`}
                                  >
                                    <Tag className="w-2.5 h-2.5 text-blue-600 shrink-0" />
                                    <span className="truncate">{borrowerDisp}</span>
                                  </div>
                                </div>
                              </div>
                            </td>
                          );
                        }

                        // Free Slot
                        return (
                          <td
                            key={slot.slotNumber}
                            onClick={() => onSelectSlot(room.room_id, selectedDate, slot.timeRange)}
                            className="p-1 border-l border-gray-200 align-middle hover:bg-emerald-50/60 cursor-pointer transition-colors group relative"
                            title={`Khung giờ TRỐNG: Nhấp để đặt phòng ${room.room_name} - Slot ${slot.slotNumber} (${slot.timeRange})`}
                          >
                            <div className="h-20 flex flex-col items-center justify-center rounded-xl border border-transparent group-hover:border-emerald-300 transition-all">
                              <span className="text-[10px] text-emerald-600 font-semibold opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-white px-2 py-0.5 rounded-full shadow-xs border border-emerald-200">
                                <PlusCircle className="w-3 h-3 text-emerald-600" />
                                Đặt slot
                              </span>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Color Legend */}
      <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-gray-600 bg-white p-3.5 rounded-xl border border-gray-200">
        <div className="flex items-center gap-4 sm:gap-6 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded bg-emerald-100 border border-emerald-400 inline-block" />
            <span className="font-medium text-gray-800">Đã duyệt (Đang sử dụng)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded bg-amber-100 border border-amber-400 inline-block" />
            <span className="font-medium text-gray-800">Chờ phê duyệt</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded bg-purple-100 border border-purple-400 inline-block" />
            <span className="font-medium text-gray-800">Đã mở cửa</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded bg-white border border-dashed border-gray-400 inline-block" />
            <span className="font-medium text-gray-800">Khung giờ trống (Nhấp trực tiếp vào ô để đặt phòng)</span>
          </div>
        </div>
        <div className="text-gray-500 italic text-[11px]">
          * Bảng lưới thời gian tự động đồng bộ theo ngày được chọn.
        </div>
      </div>

      {/* Booking Detail Modal Popover */}
      {activeBookingModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-xs"
          onClick={() => setActiveBookingModal(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-gray-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Info className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-gray-900 text-sm sm:text-base">
                  Chi tiết mượn phòng học
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveBookingModal(null)}
                className="p-1 rounded-full text-gray-400 hover:text-gray-700 hover:bg-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-3.5 text-sm">
              <div className="bg-blue-50/80 p-3 rounded-xl border border-blue-200">
                <div className="text-xs text-blue-700 font-semibold uppercase tracking-wider flex items-center gap-1">
                  <Tag className="w-3.5 h-3.5" />
                  Người mượn phòng
                </div>
                <div className="text-base font-bold text-blue-950 mt-1">
                  {activeBookingModal.borrower_name || activeBookingModal.fullname || activeBookingModal.username}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-200">
                  <span className="text-xs text-gray-500 block">Phòng học</span>
                  <span className="font-bold text-gray-800">{activeBookingModal.room_name}</span>
                  <span className="text-xs text-gray-400 block font-mono">({activeBookingModal.room_id})</span>
                </div>
                <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-200">
                  <span className="text-xs text-gray-500 block">Trạng thái</span>
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-xs font-bold mt-1 ${
                      activeBookingModal.status === 'Approved'
                        ? 'bg-emerald-100 text-emerald-800'
                        : activeBookingModal.status === 'Opened'
                        ? 'bg-purple-100 text-purple-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {activeBookingModal.status === 'Approved'
                      ? 'Đã duyệt'
                      : activeBookingModal.status === 'Opened'
                      ? 'Đã mở phòng'
                      : 'Chờ duyệt'}
                  </span>
                </div>
              </div>

              <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 space-y-2">
                <div className="flex items-center justify-between text-xs text-gray-600">
                  <span className="flex items-center gap-1">
                    <CalendarIcon className="w-3.5 h-3.5 text-gray-400" />
                    Ngày sử dụng:
                  </span>
                  <span className="font-semibold text-gray-900">{activeBookingModal.date}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-gray-600">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-gray-400" />
                    Khung giờ:
                  </span>
                  <span className="font-semibold text-gray-900">{activeBookingModal.time_slot}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-gray-600">
                  <span className="flex items-center gap-1">
                    <User className="w-3.5 h-3.5 text-gray-400" />
                    Tài khoản đặt:
                  </span>
                  <span className="text-gray-900">
                    {activeBookingModal.fullname} <span className="text-gray-400">(@{activeBookingModal.username})</span>
                  </span>
                </div>
              </div>

              <div>
                <span className="text-xs text-gray-500 block mb-1">Mục đích sử dụng / Môn học:</span>
                <p className="bg-gray-50 p-3 rounded-lg border border-gray-200 text-gray-800 text-xs leading-relaxed">
                  {activeBookingModal.purpose || 'Không có ghi chú thêm'}
                </p>
              </div>

              {activeBookingModal.note && (
                <div>
                  <span className="text-xs text-amber-700 font-semibold block mb-1">Ghi chú / Mượn thêm đồ:</span>
                  <p className="bg-amber-50 p-2.5 rounded-lg border border-amber-200 text-amber-900 text-xs font-medium leading-relaxed flex items-center gap-1.5">
                    <span>📝</span>
                    <span>{activeBookingModal.note}</span>
                  </p>
                </div>
              )}
            </div>

            <div className="p-3.5 bg-gray-50 border-t border-gray-200 flex justify-end">
              <button
                type="button"
                onClick={() => setActiveBookingModal(null)}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white rounded-xl text-xs font-semibold"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
