import React, { useState, useEffect, useRef } from 'react';
import { Booking } from '../types';
import {
  playNotificationBell,
  isBellSoundEnabled,
  setBellSoundEnabled,
} from '../lib/notificationSound';

interface NotificationBellProps {
  bookings: Booking[];
  onSelectBooking?: (bookingId: string) => void;
  style?: React.CSSProperties;
  buttonClassName?: string;
  isSecurityView?: boolean;
}

const SEEN_BOOKINGS_STORAGE_KEY = 'vuth_seen_booking_ids';
const READ_BOOKINGS_STORAGE_KEY = 'vuth_read_booking_ids';

export const NotificationBell: React.FC<NotificationBellProps> = ({
  bookings,
  onSelectBooking,
  style,
  buttonClassName = 'btn',
  isSecurityView = false,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => isBellSoundEnabled());
  const [readIds, setReadIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(READ_BOOKINGS_STORAGE_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  });

  const dropdownRef = useRef<HTMLDivElement>(null);
  const isFirstRenderRef = useRef<boolean>(true);
  const knownIdsRef = useRef<Set<string>>(new Set());

  // Lưu danh sách ID đã đọc vào localStorage
  const persistReadIds = (newSet: Set<string>) => {
    try {
      localStorage.setItem(READ_BOOKINGS_STORAGE_KEY, JSON.stringify(Array.from(newSet)));
    } catch (e) {
      console.warn('Lỗi lưu readIds:', e);
    }
  };

  // Khởi tạo và phát hiện đơn mượn phòng mới để rung chuông
  useEffect(() => {
    const currentIds = new Set(bookings.map((b) => String(b.booking_id)));

    if (isFirstRenderRef.current) {
      // Lần đầu tải trang: nạp danh sách ID đã biết từ localStorage
      try {
        const raw = localStorage.getItem(SEEN_BOOKINGS_STORAGE_KEY);
        const stored = raw ? (JSON.parse(raw) as string[]) : [];
        if (stored.length > 0) {
          knownIdsRef.current = new Set(stored);
        } else {
          knownIdsRef.current = currentIds;
          localStorage.setItem(
            SEEN_BOOKINGS_STORAGE_KEY,
            JSON.stringify(Array.from(currentIds))
          );
        }
      } catch {
        knownIdsRef.current = currentIds;
      }
      isFirstRenderRef.current = false;
      return;
    }

    // Kiểm tra xem có đơn nào mới xuất hiện mà chưa từng có trong knownIds
    const newBookings = bookings.filter((b) => !knownIdsRef.current.has(String(b.booking_id)));

    if (newBookings.length > 0) {
      // Có đơn mượn phòng mới -> Rung chuông thông báo!
      playNotificationBell();

      // Cập nhật danh sách đã biết
      newBookings.forEach((b) => knownIdsRef.current.add(String(b.booking_id)));
      try {
        localStorage.setItem(
          SEEN_BOOKINGS_STORAGE_KEY,
          JSON.stringify(Array.from(knownIdsRef.current))
        );
      } catch {}
    }
  }, [bookings]);

  // Đóng dropdown khi click ra ngoài
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Sắp xếp các đơn mượn phòng: Mới nhất lên đầu
  const sortedBookings = [...bookings].sort((a, b) => {
    const tA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tB = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (tA !== tB && !isNaN(tA) && !isNaN(tB)) return tB - tA;
    if (a.date !== b.date) return (b.date || '').localeCompare(a.date || '');
    return (b.booking_id || '').localeCompare(a.booking_id || '');
  });

  // Đếm số thông báo chưa đọc (những đơn chưa có trong readIds)
  const unreadCount = sortedBookings.filter((b) => !readIds.has(String(b.booking_id))).length;

  const toggleSound = () => {
    const nextState = !soundEnabled;
    setSoundEnabled(nextState);
    setBellSoundEnabled(nextState);
    if (nextState) {
      playNotificationBell();
    }
  };

  const handleTestSound = () => {
    playNotificationBell();
  };

  const handleMarkAllAsRead = () => {
    const newRead = new Set<string>(readIds);
    sortedBookings.forEach((b) => newRead.add(String(b.booking_id)));
    setReadIds(newRead);
    persistReadIds(newRead);
  };

  const handleClickItem = (b: Booking) => {
    const bId = String(b.booking_id);
    const newRead = new Set<string>(readIds);
    newRead.add(bId);
    setReadIds(newRead);
    persistReadIds(newRead);
    setIsOpen(false);

    if (onSelectBooking) {
      onSelectBooking(bId);
    }
  };

  // Helper tính thời gian tương đối
  const formatTimeAgo = (dateStr?: string) => {
    if (!dateStr) return '';
    try {
      const diffMs = Date.now() - new Date(dateStr).getTime();
      const diffSec = Math.floor(diffMs / 1000);
      if (diffSec < 60) return 'Vừa xong';
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `${diffMin} phút trước`;
      const diffHours = Math.floor(diffMin / 60);
      if (diffHours < 24) return `${diffHours} giờ trước`;
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays < 7) return `${diffDays} ngày trước`;
      return new Date(dateStr).toLocaleDateString('vi-VN');
    } catch {
      return '';
    }
  };

  return (
    <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-block', ...style }}>
      {/* Nút Chuông Thông Báo */}
      <button
        type="button"
        className={buttonClassName}
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: isSecurityView ? '#f1f5f9' : '#f8fafc',
          border: '1px solid #cbd5e1',
          color: unreadCount > 0 ? '#1e293b' : '#64748b',
          borderRadius: '9px',
          padding: '8px 12px',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
          boxShadow: unreadCount > 0 ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
        }}
        title={`Chuông thông báo đặt phòng (${unreadCount} đơn mới)`}
      >
        <i
          className={`fa-solid fa-bell ${unreadCount > 0 ? 'fa-shake' : ''}`}
          style={{
            fontSize: '17px',
            color: unreadCount > 0 ? '#ea580c' : '#64748b',
          }}
        ></i>

        {/* Huy hiệu số lượng thông báo chưa đọc */}
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: '-6px',
              right: '-6px',
              background: '#ef4444',
              color: '#ffffff',
              fontSize: '11px',
              fontWeight: 800,
              minWidth: '20px',
              height: '20px',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
              boxShadow: '0 2px 4px rgba(239, 68, 68, 0.4)',
              border: '2px solid #ffffff',
              animation: 'pulse 2s infinite',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Menu Danh Sách Thông Báo */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: '360px',
            maxWidth: '92vw',
            backgroundColor: '#ffffff',
            borderRadius: '14px',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
            border: '1px solid #cbd5e1',
            zIndex: 9999,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            animation: 'fadeIn 0.15s ease-out',
          }}
        >
          {/* Header Dropdown */}
          <div
            style={{
              padding: '12px 14px',
              backgroundColor: '#f8fafc',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div
                style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '8px',
                  backgroundColor: '#ffedd5',
                  color: '#ea580c',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                }}
              >
                <i className="fa-solid fa-bell"></i>
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: '14px', color: '#0f172a' }}>
                  Thông báo mượn phòng
                </div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>
                  {unreadCount > 0 ? `${unreadCount} đơn mới chưa xem` : 'Không có đơn mới'}
                </div>
              </div>
            </div>

            {/* Các nút công cụ chuông: Bật/Tắt âm thanh, Thử chuông, Đã đọc */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button
                type="button"
                onClick={toggleSound}
                style={{
                  background: soundEnabled ? '#eff6ff' : '#f1f5f9',
                  border: soundEnabled ? '1px solid #bfdbfe' : '1px solid #cbd5e1',
                  color: soundEnabled ? '#2563eb' : '#64748b',
                  borderRadius: '6px',
                  padding: '4px 7px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
                title={soundEnabled ? 'Chuông đang BẬT. Nhấn để TẮT chuông' : 'Chuông đang TẮT. Nhấn để BẬT chuông'}
              >
                <i className={`fa-solid ${soundEnabled ? 'fa-volume-high' : 'fa-volume-xmark'}`}></i>
              </button>

              <button
                type="button"
                onClick={handleTestSound}
                style={{
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  color: '#475569',
                  borderRadius: '6px',
                  padding: '4px 7px',
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
                title="Bấm để thử nghe tiếng chuông"
              >
                <i className="fa-solid fa-music"></i>
              </button>

              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllAsRead}
                  style={{
                    background: '#f1f5f9',
                    border: '1px solid #cbd5e1',
                    color: '#0f172a',
                    borderRadius: '6px',
                    padding: '4px 8px',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                  title="Đánh dấu tất cả đơn là đã đọc"
                >
                  ✓ Đã đọc hết
                </button>
              )}
            </div>
          </div>

          {/* Danh Sách Đơn Mới (Hiện những ticket vừa book lên trước) */}
          <div style={{ maxHeight: '380px', overflowY: 'auto' }}>
            {sortedBookings.length === 0 ? (
              <div style={{ padding: '36px 16px', textAlign: 'center', color: '#94a3b8' }}>
                <i className="fa-regular fa-bell-slash" style={{ fontSize: '32px', marginBottom: '8px', display: 'block' }}></i>
                <div style={{ fontSize: '13.5px', fontWeight: 600 }}>Chưa có đơn đặt phòng nào</div>
              </div>
            ) : (
              sortedBookings.slice(0, 20).map((b) => {
                const bId = String(b.booking_id);
                const isUnread = !readIds.has(bId);
                const isApproved = (b.status || '').toLowerCase().includes('approved') || (b.status || '').toLowerCase().includes('duyệt');
                const isRejected = (b.status || '').toLowerCase().includes('rejected') || (b.status || '').toLowerCase().includes('từ chối');

                return (
                  <div
                    key={bId}
                    onClick={() => handleClickItem(b)}
                    style={{
                      padding: '11px 14px',
                      borderBottom: '1px solid #f1f5f9',
                      backgroundColor: isUnread ? '#fffbeb' : '#ffffff',
                      cursor: 'pointer',
                      transition: 'background-color 0.15s ease',
                      display: 'flex',
                      gap: '10px',
                      alignItems: 'flex-start',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = isUnread ? '#fef3c7' : '#f8fafc';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = isUnread ? '#fffbeb' : '#ffffff';
                    }}
                  >
                    {/* Icon trạng thái */}
                    <div
                      style={{
                        width: '36px',
                        height: '36px',
                        minWidth: '36px',
                        borderRadius: '9px',
                        backgroundColor: isUnread ? '#fde68a' : '#eff6ff',
                        color: isUnread ? '#b45309' : '#2563eb',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '15px',
                        marginTop: '2px',
                      }}
                    >
                      <i className="fa-solid fa-door-open"></i>
                    </div>

                    {/* Nội dung chi tiết đơn */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                        <div
                          style={{
                            fontWeight: 800,
                            fontSize: '13.5px',
                            color: '#0f172a',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {b.room_name || b.room_id}
                        </div>
                        {isUnread && (
                          <span
                            style={{
                              backgroundColor: '#f59e0b',
                              color: '#ffffff',
                              fontSize: '10px',
                              fontWeight: 800,
                              padding: '1px 5px',
                              borderRadius: '4px',
                              letterSpacing: '0.3px',
                            }}
                          >
                            MỚI
                          </span>
                        )}
                      </div>

                      <div style={{ fontSize: '12.5px', color: '#334155', marginTop: '2px' }}>
                        <i className="fa-solid fa-user-tag" style={{ color: '#2563eb', marginRight: '4px', fontSize: '11px' }}></i>
                        <strong>{b.borrower_name || b.fullname || b.username}</strong>
                      </div>

                      <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <span>
                          <i className="fa-regular fa-calendar" style={{ marginRight: '3px' }}></i>
                          {b.date}
                        </span>
                        <span>•</span>
                        <span style={{ color: '#1d4ed8', fontWeight: 600 }}>
                          {b.time_slot}
                        </span>
                      </div>

                      {b.purpose && (
                        <div
                          style={{
                            fontSize: '11.5px',
                            color: '#64748b',
                            marginTop: '2px',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          Mục đích: {b.purpose}
                        </div>
                      )}

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                        <span
                          style={{
                            fontSize: '10.5px',
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: '4px',
                            backgroundColor: isApproved
                              ? '#dcfce7'
                              : isRejected
                              ? '#fee2e2'
                              : '#fef3c7',
                            color: isApproved
                              ? '#15803d'
                              : isRejected
                              ? '#b91c1c'
                              : '#b45309',
                          }}
                        >
                          {isApproved ? 'Đã duyệt' : isRejected ? 'Từ chối' : 'Chờ duyệt'}
                        </span>
                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                          {formatTimeAgo(b.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer Dropdown */}
          <div
            style={{
              padding: '10px 14px',
              backgroundColor: '#f8fafc',
              borderTop: '1px solid #e2e8f0',
              textAlign: 'center',
              fontSize: '12.5px',
            }}
          >
            <span style={{ color: '#64748b' }}>
              Âm thanh chuông báo tự động reo khi có đơn mượn phòng mới
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
