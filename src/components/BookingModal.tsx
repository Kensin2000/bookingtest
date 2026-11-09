import React, { useState, useEffect } from 'react';
import {
  X,
  Calendar,
  Clock,
  User,
  Building,
  AlertCircle,
  CheckCircle2,
  CheckSquare,
  Square,
  ShieldAlert,
} from 'lucide-react';
import { Room, Booking, UserAccount } from '../types';
import { DEFAULT_TIME_SLOTS } from '../lib/initialData';
import { fetchBusySlots, apiCreateBooking, inferRoomType, normalizeRoomType } from '../lib/supabase';
import {
  isSlotInPast,
  isSlotUnder24Hours,
  isSlotOccupiedByAny,
  UNDER_24H_WARNING_TEXT,
  isHallRoomId,
  syncPurposeWithHallEquipment,
  parseHallEquipmentFromPurpose,
  HallEquipmentState,
} from '../lib/slotValidation';

interface BookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  rooms: Room[];
  currentUser: UserAccount;
  initialRoomId?: string;
  initialDate?: string;
  initialTimeSlot?: string;
  viewingBooking?: Booking | null;
  onSuccess: () => void;
}

export const BookingModal: React.FC<BookingModalProps> = ({
  isOpen,
  onClose,
  rooms,
  currentUser,
  initialRoomId,
  initialDate,
  initialTimeSlot,
  viewingBooking,
  onSuccess,
}) => {
  const todayStr = new Date().toISOString().split('T')[0];

  const [roomId, setRoomId] = useState<string>(initialRoomId || (rooms[0]?.room_id || ''));
  const [bookingDate, setBookingDate] = useState<string>(initialDate || todayStr);
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [purpose, setPurpose] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [fullname, setFullname] = useState<string>(currentUser.fullname || '');
  const [borrowerName, setBorrowerName] = useState<string>(currentUser.fullname || currentUser.username || '');
  const [busySlots, setBusySlots] = useState<string[]>([]);
  const [hallEquipment, setHallEquipment] = useState<HallEquipmentState>({
    led: false,
    mayLanh: false,
    diDoiBanGhe: false,
  });

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [successMessage, setSuccessMessage] = useState<string>('');

  const selectedRoom = rooms.find((r) => r.room_id === roomId);
  const isHallRoom = isHallRoomId(roomId, selectedRoom?.room_name);

  useEffect(() => {
    if (initialRoomId) setRoomId(initialRoomId);
    if (initialDate) setBookingDate(initialDate);
    if (initialTimeSlot) {
      setSelectedSlots([initialTimeSlot]);
    }
  }, [initialRoomId, initialDate, initialTimeSlot]);

  useEffect(() => {
    if (viewingBooking?.purpose) {
      setPurpose(viewingBooking.purpose);
      setHallEquipment(parseHallEquipmentFromPurpose(viewingBooking.purpose));
    }
    if (viewingBooking?.note) {
      setNote(viewingBooking.note);
    }
  }, [viewingBooking]);

  const handleToggleHallEquipment = (key: keyof HallEquipmentState) => {
    const nextState: HallEquipmentState = {
      ...hallEquipment,
      [key]: !hallEquipment[key],
    };
    setHallEquipment(nextState);
    setPurpose((prev) => syncPurposeWithHallEquipment(prev, nextState));
  };

  useEffect(() => {
    if (currentUser) {
      setFullname(currentUser.fullname || currentUser.username);
      setBorrowerName(currentUser.fullname || currentUser.username);
    }
  }, [currentUser]);

  // Fetch busy slots whenever room or date changes
  useEffect(() => {
    if (!isOpen || viewingBooking || !roomId || !bookingDate) return;

    let isMounted = true;
    fetchBusySlots(roomId, bookingDate).then((slots) => {
      if (isMounted) {
        setBusySlots(slots);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [isOpen, roomId, bookingDate, viewingBooking]);

  if (!isOpen) return null;

  const toggleSlot = (timeRangeLabel: string) => {
    if (isSlotInPast(bookingDate, timeRangeLabel)) {
      setErrorMessage('Khung giờ này đã qua thời gian hiện tại, không thể chọn đặt!');
      return;
    }
    if (selectedSlots.includes(timeRangeLabel)) {
      setSelectedSlots(selectedSlots.filter((s) => s !== timeRangeLabel));
    } else {
      setSelectedSlots([...selectedSlots, timeRangeLabel]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (!borrowerName.trim()) {
      setErrorMessage('Vui lòng nhập thông tin người mượn phòng!');
      return;
    }

    if (selectedSlots.length === 0) {
      setErrorMessage('Vui lòng chọn ít nhất 1 khung giờ!');
      return;
    }

    const pastSlot = selectedSlots.find((s) => isSlotInPast(bookingDate, s));
    if (pastSlot) {
      setErrorMessage(`Khung giờ "${pastSlot}" đã qua thời gian hiện tại, không thể đặt phòng!`);
      return;
    }

    if (!purpose.trim()) {
      setErrorMessage('Vui lòng nhập lý do / mục đích sử dụng phòng!');
      return;
    }

    setIsSubmitting(true);
    const isAdmin = currentUser.role === 'admin' || currentUser.role === 'superadmin' || currentUser.username === 'admin';
    try {
      const res = await apiCreateBooking({
        room_id: roomId,
        room_name: selectedRoom?.room_name || roomId,
        username: currentUser.username,
        fullname: fullname || currentUser.fullname,
        borrower_name: borrowerName.trim(),
        date: bookingDate,
        time_slots: selectedSlots,
        purpose: purpose.trim(),
        note: note.trim() || undefined,
        status: isAdmin ? 'Approved' : 'Pending',
        userRole: currentUser.role,
        room_type: normalizeRoomType(selectedRoom?.room_type, selectedRoom?.room_name || roomId, roomId),
      });

      if (res.success) {
        setSuccessMessage(res.message);
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 1200);
      } else {
        setErrorMessage(res.message);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Có lỗi xảy ra khi tạo lịch đặt phòng.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-gray-200 overflow-hidden transition-all my-8">
        {/* Header */}
        <div className="bg-blue-600 px-6 py-5 text-white flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">
              {viewingBooking ? 'Chi Tiết Đơn Đặt Phòng' : 'Đăng Ký Đặt Phòng Học'}
            </h2>
            <p className="text-xs text-blue-100 mt-0.5">
              {viewingBooking
                ? `Mã đơn: ${viewingBooking.booking_id}`
                : 'Chọn khung giờ và nhập mục đích đăng ký'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/20 rounded-full text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* View Mode */}
        {viewingBooking ? (
          <div className="p-6 space-y-6">
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <span className="text-xs text-blue-600 font-semibold uppercase tracking-wider block">
                  Trạng Thái Đơn
                </span>
                <span className="text-sm font-bold text-blue-900 capitalize">
                  {viewingBooking.status === 'Approved' && '✅ Đã Phê Duyệt'}
                  {viewingBooking.status === 'Pending' && '⏳ Chờ Phê Duyệt'}
                  {viewingBooking.status === 'Rejected' && '❌ Đã Từ Chối'}
                  {viewingBooking.status === 'Cancelled' && '🚫 Đã Hủy'}
                </span>
              </div>
              <div className="text-right text-xs text-gray-500">
                Mã đơn: <span className="font-mono font-bold text-gray-700">{viewingBooking.booking_id}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-xs font-semibold text-gray-500 uppercase">Mục Đích / Nội Dung</span>
                <p className="font-bold text-gray-900 mt-1">{viewingBooking.purpose}</p>
                {viewingBooking.note && (
                  <div className="mt-2 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5">
                    <span>📝 Ghi chú:</span>
                    <span>{viewingBooking.note}</span>
                  </div>
                )}
              </div>

              <div>
                <span className="text-xs font-semibold text-gray-500 uppercase">Phòng Học</span>
                <p className="font-bold text-blue-700 mt-1">
                  {viewingBooking.room_name} ({viewingBooking.room_id})
                </p>
              </div>

              <div>
                <span className="text-xs font-semibold text-gray-500 uppercase">Người Đăng Ký</span>
                <p className="text-gray-800 font-semibold mt-1">
                  {viewingBooking.fullname} ({viewingBooking.username})
                </p>
              </div>

              <div>
                <span className="text-xs font-semibold text-gray-500 uppercase">Ngày Đăng Ký</span>
                <p className="text-gray-800 font-semibold mt-1">{viewingBooking.date}</p>
              </div>

              <div className="md:col-span-2">
                <span className="text-xs font-semibold text-gray-500 uppercase">Khung Giờ Đặt</span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {viewingBooking.time_slot.split(',').map((slot, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-1 rounded-full text-xs font-mono font-semibold bg-gray-100 text-gray-800 border border-gray-200"
                    >
                      {slot.trim()}
                    </span>
                  ))}
                </div>
              </div>

              {viewingBooking.reject_reason && (
                <div className="md:col-span-2 bg-red-50 p-3 rounded-xl border border-red-200 text-red-800 text-xs">
                  <span className="font-bold block">Lý do từ chối:</span>
                  {viewingBooking.reject_reason}
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={onClose}
                className="bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium px-5 py-2.5 rounded-xl text-sm"
              >
                Đóng
              </button>
            </div>
          </div>
        ) : (
          /* Create Mode Form */
          <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
            {errorMessage && (
              <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl text-xs font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {successMessage && (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 rounded-xl text-xs font-medium flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                <span>{successMessage}</span>
              </div>
            )}

            {/* Room & User Name */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Chọn Phòng Học *
                </label>
                <select
                  value={roomId}
                  onChange={(e) => {
                    setRoomId(e.target.value);
                    setSelectedSlots([]);
                  }}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                >
                  {rooms.map((r) => (
                    <option key={r.room_id} value={r.room_id}>
                      {r.room_id} - {r.room_name} (Sức chứa: {r.capacity})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Thông Tin Người Mượn Phòng *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Nhập họ tên / thông tin người mượn..."
                  value={borrowerName}
                  onChange={(e) => setBorrowerName(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                />
              </div>
            </div>

            {/* Date */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Ngày Đặt Phòng *
              </label>
              <input
                type="date"
                required
                min={todayStr}
                value={bookingDate}
                onChange={(e) => {
                  setBookingDate(e.target.value);
                  setSelectedSlots([]);
                }}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
              />
            </div>

            {/* Time Slot Multi-Selector */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5 flex items-center justify-between">
                <span>Chọn Khung Giờ (Có thể chọn nhiều slot) *</span>
                <span className="text-blue-600 font-semibold text-[11px]">
                  Đã chọn: {selectedSlots.length} slot
                </span>
              </label>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto p-1 bg-gray-50/50 rounded-2xl border border-gray-200">
                {(() => {
                  const availableSlots = DEFAULT_TIME_SLOTS.filter(
                    (slot) => !isSlotInPast(bookingDate, slot.timeRange)
                  );

                  if (availableSlots.length === 0) {
                    return (
                      <div className="col-span-full py-6 text-center text-xs text-amber-700 bg-amber-50 rounded-xl border border-amber-200 font-medium">
                        ⏰ Tất cả các khung giờ trong ngày này đã qua thời gian hiện tại. Vui lòng chọn ngày tiếp theo!
                      </div>
                    );
                  }

                  return availableSlots.map((slot) => {
                    const cleanTimeRange = slot.timeRange;
                    const isBusy = isSlotOccupiedByAny(cleanTimeRange, busySlots);
                    const isDisabled = isBusy;
                    const isSelected = selectedSlots.includes(cleanTimeRange);

                    return (
                      <button
                        key={slot.slotNumber}
                        type="button"
                        disabled={isDisabled}
                        onClick={() => toggleSlot(cleanTimeRange)}
                        className={`p-2.5 rounded-xl text-left border transition-all text-xs font-medium flex flex-col justify-between ${
                          isDisabled
                            ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed opacity-60'
                            : isSelected
                            ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                            : 'bg-white text-gray-800 border-gray-200 hover:border-blue-300 hover:bg-blue-50/40 cursor-pointer'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold">Slot {slot.slotNumber}</span>
                          {isBusy ? (
                            <span className="text-[10px] text-red-500 font-semibold bg-red-50 px-1.5 py-0.5 rounded">
                              Bận
                            </span>
                          ) : isSelected ? (
                            <CheckSquare className="w-3.5 h-3.5" />
                          ) : (
                            <Square className="w-3.5 h-3.5 text-gray-300" />
                          )}
                        </div>
                        <span className="text-[11px] font-mono mt-1 opacity-90">
                          {slot.timeRange}
                        </span>
                      </button>
                    );
                  });
                })()}
              </div>

              {/* Cảnh báo nếu book dưới 24 tiếng */}
              {selectedSlots.some((s) => isSlotUnder24Hours(bookingDate, s)) && (
                <div className="mt-3 p-3 bg-amber-50 border border-amber-200 border-l-4 border-l-amber-500 rounded-xl text-amber-800 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                  <div>
                    <span className="font-bold">Cảnh báo: </span>
                    {UNDER_24H_WARNING_TEXT}.
                  </div>
                </div>
              )}
            </div>

            {/* Tùy chọn thiết bị Hội trường (.Bhoitruong) */}
            {isHallRoom && (
              <div className="p-3.5 bg-emerald-50/90 border border-emerald-300 rounded-2xl mb-3 shadow-xs">
                <div className="text-xs font-bold text-emerald-900 mb-2 flex items-center gap-1.5">
                  <Building className="w-4 h-4 text-emerald-600" />
                  <span>Tùy chọn thiết bị Hội trường (.Bhoitruong):</span>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="flex items-center gap-2 text-xs font-bold text-gray-800 cursor-pointer select-none bg-white px-3 py-1.5 rounded-xl border border-emerald-200 hover:border-emerald-400 transition-colors">
                    <input
                      type="checkbox"
                      checked={hallEquipment.led}
                      onChange={() => handleToggleHallEquipment('led')}
                      className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 accent-emerald-600 cursor-pointer"
                    />
                    <span>📺 Led</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs font-bold text-gray-800 cursor-pointer select-none bg-white px-3 py-1.5 rounded-xl border border-emerald-200 hover:border-emerald-400 transition-colors">
                    <input
                      type="checkbox"
                      checked={hallEquipment.mayLanh}
                      onChange={() => handleToggleHallEquipment('mayLanh')}
                      className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 accent-emerald-600 cursor-pointer"
                    />
                    <span>❄️ Máy lạnh</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs font-bold text-gray-800 cursor-pointer select-none bg-white px-3 py-1.5 rounded-xl border border-emerald-200 hover:border-emerald-400 transition-colors">
                    <input
                      type="checkbox"
                      checked={hallEquipment.diDoiBanGhe}
                      onChange={() => handleToggleHallEquipment('diDoiBanGhe')}
                      className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 accent-emerald-600 cursor-pointer"
                    />
                    <span>🪑 Di dời bàn ghế</span>
                  </label>
                </div>
                <div className="text-[11.5px] text-emerald-700 mt-2 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Các mục tích chọn sẽ tự động được thêm vào phần Mục đích sử dụng phòng bên dưới.</span>
                </div>
              </div>
            )}

            {/* Purpose */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Lý Do / Nội Dung Sử Dụng Phòng *
              </label>
              <textarea
                rows={3}
                required
                placeholder="Ví dụ: Giảng dạy môn Lập Trình Web, Thực hành Cơ sở dữ liệu..."
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
              />
            </div>

            {/* Ghi chú / Mượn thêm đồ (Tùy chọn) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-gray-700">
                  Ghi Chú / Mượn Thêm Đồ <span className="text-gray-400 font-normal">(Không bắt buộc)</span>
                </label>
                <span className="text-[11px] text-gray-500">Bấm gợi ý để thêm nhanh</span>
              </div>

              {/* Quick suggestion chips */}
              <div className="flex flex-wrap gap-1.5 mb-2">
                {[
                  { label: 'Mượn ly', emoji: '🥛' },
                  { label: 'Dĩa', emoji: '🍽️' },
                  { label: 'Khay đựng điện thoại', emoji: '📱' },
                  { label: 'Bút lông bảng', emoji: '🖊️' },
                  { label: 'Microphone trợ giảng', emoji: '🎤' },
                ].map((item) => {
                  const isIncluded = note.toLowerCase().includes(item.label.toLowerCase());
                  return (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => {
                        if (isIncluded) {
                          const parts = note.split(',').map((p) => p.trim()).filter(Boolean);
                          const filtered = parts.filter((p) => p.toLowerCase() !== item.label.toLowerCase());
                          setNote(filtered.join(', '));
                        } else {
                          const parts = note ? note.split(',').map((p) => p.trim()).filter(Boolean) : [];
                          parts.push(item.label);
                          setNote(parts.join(', '));
                        }
                      }}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-all flex items-center gap-1 cursor-pointer ${
                        isIncluded
                          ? 'bg-blue-600 text-white border-blue-600 font-bold shadow-xs'
                          : 'bg-white text-gray-700 border-gray-200 hover:border-blue-400 hover:bg-blue-50/50'
                      }`}
                    >
                      <span>{item.emoji}</span>
                      <span>{item.label}</span>
                      {isIncluded && <span className="text-[10px] ml-0.5">✓</span>}
                    </button>
                  );
                })}
              </div>

              <textarea
                rows={2}
                placeholder="Ví dụ: Mượn 5 ly uống nước, 2 dĩa, khay đựng điện thoại..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 font-normal"
              />
            </div>

            {/* Submit buttons */}
            <div className="pt-4 border-t border-gray-200 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium px-5 py-2.5 rounded-xl text-sm transition-colors cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="submit"
                disabled={isSubmitting || selectedSlots.length === 0}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold px-6 py-2.5 rounded-xl text-sm shadow-md transition-all flex items-center gap-2 cursor-pointer"
              >
                {isSubmitting ? (
                  <span>Đang ghi dữ liệu...</span>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    {(currentUser.role === 'admin' || currentUser.role === 'superadmin')
                      ? 'Xác Nhận & Tự Động Duyệt'
                      : 'Gửi Yêu Cầu Đặt Phòng'}
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
