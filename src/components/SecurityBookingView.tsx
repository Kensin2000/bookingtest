import React, { useState, useEffect, useMemo } from 'react';
import { Booking, Room, RoomType, UserRole } from '../types';
import { inferRoomType, normalizeRoomType } from '../lib/supabase';
import { findMatchingRoom } from '../lib/excelImporter';
import { isOffHoursSlot } from '../lib/slotValidation';

interface SecurityBookingViewProps {
  bookings: Booking[];
  rooms?: Room[];
  session: {
    username: string;
    fullname: string;
    role: UserRole;
  };
  onRefresh: () => void;
  onLogout: () => void;
  onChangePassword: () => void;
  isLoading: boolean;
}

export const SecurityBookingView: React.FC<SecurityBookingViewProps> = ({
  bookings,
  rooms = [],
  session,
  onRefresh,
  onLogout,
  onChangePassword,
  isLoading,
}) => {
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [searchKey, setSearchKey] = useState<string>('');
  const [securityTab, setSecurityTab] = useState<'chinh_khoa' | 'chuc_nang' | 'ngoai_gio' | 'all'>('chinh_khoa');
  const [currentTime, setCurrentTime] = useState<string>('');

  // Map of rooms to look up room_type
  const roomMap = useMemo(() => {
    const map = new Map<string, Room>();
    rooms.forEach((r) => {
      const rId = String(r.room_id || (r as any).id || '').trim().toUpperCase();
      const rName = String(r.room_name || (r as any).name || '').trim().toLowerCase();
      if (rId) map.set(rId, r);
      if (rName) map.set(rName, r);
    });
    return map;
  }, [rooms]);

  // Helper to determine whether a booking is standard (chính khóa) or functional (chức năng)
  // Ưu tiên số 1: Lấy trực tiếp thuộc tính room_type từ bảng rooms trong CSDL (hỗ trợ cả mã 216, R216, tên Phòng FLAB...)
  const getBookingRoomType = (b: Booking): RoomType => {
    const cleanBId = String(b.room_id || (b as any).id || '').trim();
    const cleanBName = String(b.room_name || '').trim();

    // 1. Khớp trực tiếp trong danh sách rooms từ CSDL
    const exactRoom = rooms.find((r) => {
      const rId = String(r.room_id || (r as any).id || '').trim();
      const rName = String(r.room_name || (r as any).name || '').trim();
      return (
        (cleanBId && rId.toUpperCase() === cleanBId.toUpperCase()) ||
        (cleanBName && rName.toLowerCase() === cleanBName.toLowerCase())
      );
    });
    if (exactRoom?.room_type) {
      return normalizeRoomType(exactRoom.room_type, exactRoom.room_name, exactRoom.room_id);
    }

    // 2. Tìm kiếm mở rộng qua findMatchingRoom (hỗ trợ số phòng, tên phòng không dấu)
    const matchedRoom = findMatchingRoom(cleanBId, rooms) || findMatchingRoom(cleanBName, rooms);
    if (matchedRoom?.room_type) {
      return normalizeRoomType(matchedRoom.room_type, matchedRoom.room_name, matchedRoom.room_id);
    }

    // 3. Nếu tên phòng hoặc mã phòng mang dấu hiệu phòng chức năng (FLAB, LAB, PC, Họp, Beta...)
    const inferred = inferRoomType(cleanBName, cleanBId);
    if (inferred === 'chuc_nang') {
      return 'chuc_nang';
    }

    return normalizeRoomType(b.room_type, cleanBName, cleanBId);
  };

  // Đồng hồ thời gian thực
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      );
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatDateVN = (dateStr: string) => {
    if (!dateStr) return '';
    try {
      const [y, m, d] = dateStr.split('-');
      return `${d}/${m}/${y}`;
    } catch {
      return dateStr;
    }
  };

  const tomorrowStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }, []);

  // Tất cả các ca đã duyệt trong ngày (trước khi lọc theo tab loại phòng)
  const approvedBookingsInDate = useMemo(() => {
    return bookings.filter((b) => {
      if (selectedDate && b.date !== selectedDate) return false;
      const sLower = (b.status || '').toLowerCase();
      return sLower === 'approved' || sLower.includes('duyệt') || sLower.includes('duyet');
    });
  }, [bookings, selectedDate]);

  // Đếm số ca chính khóa (trong giờ), chức năng và phòng ngoài giờ trong ngày
  const chinhKhoaDayCount = useMemo(() => {
    return approvedBookingsInDate.filter(
      (b) => getBookingRoomType(b) === 'chinh_khoa' && !isOffHoursSlot(b.time_slot)
    ).length;
  }, [approvedBookingsInDate, roomMap]);

  const chucNangDayCount = useMemo(() => {
    return approvedBookingsInDate.filter((b) => getBookingRoomType(b) === 'chuc_nang').length;
  }, [approvedBookingsInDate, roomMap]);

  // Phòng ngoài giờ: tất cả các phòng có room_type là 'chinh_khoa' và được book các slot ngoài giờ (Slot 5, Slot trưa, Slot 10-14)
  const ngoaiGioDayCount = useMemo(() => {
    return approvedBookingsInDate.filter(
      (b) => getBookingRoomType(b) === 'chinh_khoa' && isOffHoursSlot(b.time_slot)
    ).length;
  }, [approvedBookingsInDate, roomMap]);

  // Lọc danh sách phòng cho bảo vệ hiển thị theo tab và từ khóa tìm kiếm
  const filteredBookings = useMemo(() => {
    return approvedBookingsInDate.filter((b) => {
      // 1. Lọc theo tab loại phòng (Phòng chính khóa trong giờ, Phòng ngoài giờ, Phòng chức năng)
      if (securityTab === 'chinh_khoa') {
        const type = getBookingRoomType(b);
        if (type !== 'chinh_khoa' || isOffHoursSlot(b.time_slot)) {
          return false;
        }
      } else if (securityTab === 'chuc_nang') {
        const type = getBookingRoomType(b);
        if (type !== 'chuc_nang') {
          return false;
        }
      } else if (securityTab === 'ngoai_gio') {
        // Tab "Phòng Ngoài Giờ": phòng có room_type là 'chinh_khoa' và book slot ngoài giờ (Slot 5, Slot trưa, Slot 10-14)
        const type = getBookingRoomType(b);
        if (type !== 'chinh_khoa' || !isOffHoursSlot(b.time_slot)) {
          return false;
        }
      }

      // 2. Tìm kiếm nhanh số phòng, giảng viên, nội dung môn học, khung giờ
      if (searchKey.trim()) {
        const query = searchKey.toLowerCase().trim();
        const matchRoom =
          (b.room_name || '').toLowerCase().includes(query) ||
          (b.room_id || '').toLowerCase().includes(query);
        const matchTeacher =
          (b.borrower_name || '').toLowerCase().includes(query) ||
          (b.fullname || '').toLowerCase().includes(query) ||
          (b.username || '').toLowerCase().includes(query);
        const matchPurpose = (b.purpose || '').toLowerCase().includes(query);
        const matchNote = (b.note || '').toLowerCase().includes(query);
        const matchTime = (b.time_slot || '').toLowerCase().includes(query);
        if (!matchRoom && !matchTeacher && !matchPurpose && !matchNote && !matchTime) {
          return false;
        }
      }

      return true;
    });
  }, [approvedBookingsInDate, securityTab, searchKey, roomMap]);

  return (
    <div
      style={{
        width: '100%',
        height: '100vh',
        minHeight: '100dvh',
        maxHeight: '100vh',
        backgroundColor: '#f8fafc',
        color: '#0f172a',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {/* Header sáng sủa, chữ to rõ */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #cbd5e1',
          padding: '14px 16px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
        }}
      >
        <div
          style={{
            maxWidth: '1100px',
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          {/* Logo & Thông tin ca trực */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
            <div
              style={{
                width: '46px',
                height: '46px',
                minWidth: '46px',
                borderRadius: '12px',
                backgroundColor: '#16a34a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '22px',
                color: '#ffffff',
                boxShadow: '0 2px 6px rgba(22, 163, 74, 0.25)',
              }}
            >
              <i className="fa-solid fa-shield-halved"></i>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <h1
                  style={{
                    margin: 0,
                    fontSize: '21px',
                    fontWeight: 800,
                    color: '#0f172a',
                    letterSpacing: '-0.3px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Lịch Mở Phòng Trực Ban
                </h1>
                <span
                  style={{
                    backgroundColor: '#dcfce7',
                    color: '#15803d',
                    fontSize: '12.5px',
                    fontWeight: 800,
                    padding: '3px 9px',
                    borderRadius: '20px',
                    border: '1px solid #bbf7d0',
                    whiteSpace: 'nowrap',
                  }}
                >
                  BẢO VỆ
                </span>
              </div>
              <div style={{ fontSize: '15px', color: '#475569', marginTop: '3px' }}>
                Trực ban: <strong style={{ color: '#0f172a' }}>{session.fullname || session.username}</strong>
                {currentTime ? ` • Giờ: ${currentTime}` : ''}
              </div>
            </div>
          </div>

          {/* Các nút thao tác tinh gọn, nút to dễ bấm */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <button
              onClick={onRefresh}
              disabled={isLoading}
              style={{
                background: '#f1f5f9',
                border: '1px solid #cbd5e1',
                color: '#1e293b',
                borderRadius: '9px',
                padding: '9px 14px',
                fontSize: '14.5px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
              }}
              title="Cập nhật danh sách phòng mới nhất"
            >
              <i className={`fa-solid fa-rotate ${isLoading ? 'fa-spin' : ''}`} style={{ color: '#2563eb', fontSize: '16px' }}></i>
              <span className="hidden sm:inline">Làm mới</span>
            </button>

            <button
              onClick={onChangePassword}
              style={{
                background: '#f1f5f9',
                border: '1px solid #cbd5e1',
                color: '#1e293b',
                borderRadius: '9px',
                padding: '9px 12px',
                fontSize: '14.5px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              title="Đổi mật khẩu"
            >
              <i className="fa-solid fa-key" style={{ color: '#d97706', fontSize: '15px' }}></i>
              <span className="hidden sm:inline">Đổi MK</span>
            </button>

            <button
              onClick={onLogout}
              style={{
                background: '#fee2e2',
                border: '1px solid #fca5a5',
                color: '#b91c1c',
                borderRadius: '9px',
                padding: '9px 14px',
                fontSize: '14.5px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
              }}
              title="Đăng xuất"
            >
              <i className="fa-solid fa-right-from-bracket" style={{ fontSize: '15px' }}></i>
              <span className="hidden sm:inline">Thoát</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main
        style={{
          flex: 1,
          padding: '18px 16px 50px 16px',
          maxWidth: '1100px',
          margin: '0 auto',
          width: '100%',
        }}
      >
        {/* Hàng chọn ngày trực quan, chữ to rõ */}
        <section style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button
              onClick={() => setSelectedDate(todayStr)}
              style={{
                flex: '1 1 130px',
                padding: '12px 14px',
                borderRadius: '12px',
                border: selectedDate === todayStr ? '2.5px solid #16a34a' : '1px solid #cbd5e1',
                background: selectedDate === todayStr ? '#f0fdf4' : '#ffffff',
                color: selectedDate === todayStr ? '#15803d' : '#334155',
                fontWeight: 800,
                cursor: 'pointer',
                textAlign: 'center',
                boxShadow: selectedDate === todayStr ? '0 2px 6px rgba(22,163,74,0.18)' : '0 1px 2px rgba(0,0,0,0.03)',
              }}
            >
              <div style={{ fontSize: '16.5px' }}>☀️ Hôm Nay</div>
              <div style={{ fontSize: '14px', fontWeight: 600, marginTop: '3px', color: '#64748b' }}>
                {formatDateVN(todayStr)}
              </div>
            </button>

            <button
              onClick={() => setSelectedDate(tomorrowStr)}
              style={{
                flex: '1 1 130px',
                padding: '12px 14px',
                borderRadius: '12px',
                border: selectedDate === tomorrowStr ? '2.5px solid #2563eb' : '1px solid #cbd5e1',
                background: selectedDate === tomorrowStr ? '#eff6ff' : '#ffffff',
                color: selectedDate === tomorrowStr ? '#1d4ed8' : '#334155',
                fontWeight: 800,
                cursor: 'pointer',
                textAlign: 'center',
                boxShadow: selectedDate === tomorrowStr ? '0 2px 6px rgba(37,99,235,0.18)' : '0 1px 2px rgba(0,0,0,0.03)',
              }}
            >
              <div style={{ fontSize: '16.5px' }}>🗓️ Ngày Mai</div>
              <div style={{ fontSize: '14px', fontWeight: 600, marginTop: '3px', color: '#64748b' }}>
                {formatDateVN(tomorrowStr)}
              </div>
            </button>

            {/* Nút xem Tất Cả Các Ngày */}
            <button
              onClick={() => setSelectedDate('')}
              style={{
                flex: '1 1 130px',
                padding: '12px 14px',
                borderRadius: '12px',
                border: selectedDate === '' ? '2.5px solid #7c3aed' : '1px solid #cbd5e1',
                background: selectedDate === '' ? '#f5f3ff' : '#ffffff',
                color: selectedDate === '' ? '#6d28d9' : '#334155',
                fontWeight: 800,
                cursor: 'pointer',
                textAlign: 'center',
                boxShadow: selectedDate === '' ? '0 2px 6px rgba(124,58,237,0.18)' : '0 1px 2px rgba(0,0,0,0.03)',
              }}
              title="Xem tất cả các ca đã duyệt trên toàn hệ thống không lọc ngày"
            >
              <div style={{ fontSize: '16.5px' }}>📅 Tất Cả Ngày</div>
              <div style={{ fontSize: '13px', fontWeight: 600, marginTop: '3px', color: '#64748b' }}>
                Xem toàn bộ lịch
              </div>
            </button>

            {/* Chọn ngày tùy ý */}
            <div
              style={{
                flex: '1 1 200px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                background: '#ffffff',
                padding: '10px 14px',
                borderRadius: '12px',
                border: '1px solid #cbd5e1',
                boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
              }}
            >
              <span style={{ fontSize: '15px', fontWeight: 600, color: '#475569', whiteSpace: 'nowrap' }}>
                <i className="fa-regular fa-calendar" style={{ marginRight: '6px', color: '#2563eb' }}></i>Ngày khác:
              </span>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#0f172a',
                  fontSize: '15.5px',
                  fontWeight: 700,
                  flex: 1,
                  outline: 'none',
                  cursor: 'pointer',
                }}
              />
            </div>
          </div>

          {/* Gợi ý thông báo quy định nghiệp vụ trực ban */}
          <div
            style={{
              marginTop: '10px',
              padding: '8px 14px',
              backgroundColor: '#eff6ff',
              borderRadius: '8px',
              border: '1px solid #bfdbfe',
              fontSize: '13.5px',
              color: '#1e40af',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap',
            }}
          >
            <i className="fa-solid fa-circle-info" style={{ color: '#2563eb' }}></i>
            <span>
              <strong>Ghi chú bảo vệ:</strong> Màn hình trực ban <strong>chỉ hiển thị những ca ĐÃ DUYỆT (Approved)</strong> để mở phòng. Các đơn còn đang chờ duyệt sẽ không hiển thị.
              {selectedDate ? (
                <span> Đang xem ngày: <strong>{formatDateVN(selectedDate)}</strong>.</span>
              ) : (
                <span> Đang hiển thị <strong>tất cả các ngày</strong>.</span>
              )}
            </span>
          </div>
        </section>

        {/* 4 TAB CHUYÊN BIỆT CHO BẢO VỆ: CHÍNH KHÓA, NGOÀI GIỜ (SLOT 1-4 & 6-9), CHỨC NĂNG, TẤT CẢ PHÒNG */}
        <section style={{ marginBottom: '16px' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '12px',
            }}
          >
            {/* Tab 1: Phòng Chính Khóa */}
            <button
              type="button"
              onClick={() => setSecurityTab('chinh_khoa')}
              style={{
                padding: '16px 18px',
                borderRadius: '14px',
                border: securityTab === 'chinh_khoa' ? '3px solid #2563eb' : '1.5px solid #cbd5e1',
                background: securityTab === 'chinh_khoa' ? '#eff6ff' : '#ffffff',
                color: securityTab === 'chinh_khoa' ? '#1d4ed8' : '#334155',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                boxShadow: securityTab === 'chinh_khoa' ? '0 4px 14px rgba(37,99,235,0.2)' : '0 1px 3px rgba(0,0,0,0.03)',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', textAlign: 'left' }}>
                <span
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '10px',
                    background: securityTab === 'chinh_khoa' ? '#2563eb' : '#f1f5f9',
                    color: securityTab === 'chinh_khoa' ? '#ffffff' : '#2563eb',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '20px',
                  }}
                >
                  <i className="fa-solid fa-chalkboard-user"></i>
                </span>
                <div>
                  <div style={{ fontSize: '16.5px', fontWeight: 900 }}>Phòng Chính Khóa</div>
                  <div style={{ fontSize: '12.5px', color: '#64748b' }}>Trong giờ (Slot 1-4 & 6-9)</div>
                </div>
              </div>
              <span
                style={{
                  background: securityTab === 'chinh_khoa' ? '#2563eb' : '#e2e8f0',
                  color: securityTab === 'chinh_khoa' ? '#ffffff' : '#334155',
                  padding: '4px 12px',
                  borderRadius: '16px',
                  fontSize: '15px',
                  fontWeight: 900,
                  minWidth: '32px',
                  textAlign: 'center',
                }}
              >
                {chinhKhoaDayCount}
              </span>
            </button>

            {/* Tab 2: Phòng Ngoài Giờ (Các phòng chính khóa được book Slot 5, Trưa, Slot 10-14) */}
            <button
              type="button"
              onClick={() => setSecurityTab('ngoai_gio')}
              style={{
                padding: '16px 18px',
                borderRadius: '14px',
                border: securityTab === 'ngoai_gio' ? '3px solid #d97706' : '1.5px solid #cbd5e1',
                background: securityTab === 'ngoai_gio' ? '#fffbeb' : '#ffffff',
                color: securityTab === 'ngoai_gio' ? '#b45309' : '#334155',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                boxShadow: securityTab === 'ngoai_gio' ? '0 4px 14px rgba(217,119,6,0.2)' : '0 1px 3px rgba(0,0,0,0.03)',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', textAlign: 'left' }}>
                <span
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '10px',
                    background: securityTab === 'ngoai_gio' ? '#d97706' : '#f1f5f9',
                    color: securityTab === 'ngoai_gio' ? '#ffffff' : '#d97706',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '20px',
                  }}
                >
                  <i className="fa-solid fa-clock-rotate-left"></i>
                </span>
                <div>
                  <div style={{ fontSize: '16.5px', fontWeight: 900 }}>Phòng Ngoài Giờ</div>
                  <div style={{ fontSize: '12.5px', color: '#64748b' }}>Slot 5, Trưa, Slot 10-14</div>
                </div>
              </div>
              <span
                style={{
                  background: securityTab === 'ngoai_gio' ? '#d97706' : '#e2e8f0',
                  color: securityTab === 'ngoai_gio' ? '#ffffff' : '#334155',
                  padding: '4px 12px',
                  borderRadius: '16px',
                  fontSize: '15px',
                  fontWeight: 900,
                  minWidth: '32px',
                  textAlign: 'center',
                }}
              >
                {ngoaiGioDayCount}
              </span>
            </button>

            {/* Tab 3: Phòng Chức Năng */}
            <button
              type="button"
              onClick={() => setSecurityTab('chuc_nang')}
              style={{
                padding: '16px 18px',
                borderRadius: '14px',
                border: securityTab === 'chuc_nang' ? '3px solid #be185d' : '1.5px solid #cbd5e1',
                background: securityTab === 'chuc_nang' ? '#fdf2f8' : '#ffffff',
                color: securityTab === 'chuc_nang' ? '#be185d' : '#334155',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                boxShadow: securityTab === 'chuc_nang' ? '0 4px 14px rgba(190,24,93,0.2)' : '0 1px 3px rgba(0,0,0,0.03)',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', textAlign: 'left' }}>
                <span
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '10px',
                    background: securityTab === 'chuc_nang' ? '#be185d' : '#f1f5f9',
                    color: securityTab === 'chuc_nang' ? '#ffffff' : '#be185d',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '20px',
                  }}
                >
                  <i className="fa-solid fa-flask"></i>
                </span>
                <div>
                  <div style={{ fontSize: '16.5px', fontWeight: 900 }}>Phòng Chức Năng</div>
                  <div style={{ fontSize: '12.5px', color: '#64748b' }}>Máy tính, Lab, Hội trường</div>
                </div>
              </div>
              <span
                style={{
                  background: securityTab === 'chuc_nang' ? '#be185d' : '#e2e8f0',
                  color: securityTab === 'chuc_nang' ? '#ffffff' : '#334155',
                  padding: '4px 12px',
                  borderRadius: '16px',
                  fontSize: '15px',
                  fontWeight: 900,
                  minWidth: '32px',
                  textAlign: 'center',
                }}
              >
                {chucNangDayCount}
              </span>
            </button>

            {/* Tab 3: Tất cả phòng */}
            <button
              type="button"
              onClick={() => setSecurityTab('all')}
              style={{
                padding: '16px 18px',
                borderRadius: '14px',
                border: securityTab === 'all' ? '3px solid #0f172a' : '1.5px solid #cbd5e1',
                background: securityTab === 'all' ? '#0f172a' : '#ffffff',
                color: securityTab === 'all' ? '#ffffff' : '#64748b',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                boxShadow: securityTab === 'all' ? '0 4px 14px rgba(15,23,42,0.2)' : '0 1px 3px rgba(0,0,0,0.03)',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '10px',
                    background: securityTab === 'all' ? 'rgba(255,255,255,0.15)' : '#f1f5f9',
                    color: securityTab === 'all' ? '#ffffff' : '#475569',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '18px',
                  }}
                >
                  <i className="fa-solid fa-border-all"></i>
                </span>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: '16px', fontWeight: 800 }}>Tất Cả Phòng</div>
                  <div style={{ fontSize: '12px', color: securityTab === 'all' ? '#cbd5e1' : '#64748b' }}>Toàn bộ các ca</div>
                </div>
              </div>
              <span
                style={{
                  background: securityTab === 'all' ? 'rgba(255,255,255,0.2)' : '#e2e8f0',
                  color: securityTab === 'all' ? '#ffffff' : '#334155',
                  padding: '4px 12px',
                  borderRadius: '16px',
                  fontSize: '15px',
                  fontWeight: 900,
                  minWidth: '32px',
                  textAlign: 'center',
                }}
              >
                {approvedBookingsInDate.length}
              </span>
            </button>
          </div>
        </section>

        {/* Ô Tìm Kiếm Số Phòng Nhanh (chữ to, dễ gõ trên điện thoại) */}
        <section style={{ marginBottom: '16px' }}>
          <div style={{ position: 'relative' }}>
            <i
              className="fa-solid fa-magnifying-glass"
              style={{
                position: 'absolute',
                left: '16px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#64748b',
                fontSize: '18px',
              }}
            ></i>
            <input
              type="text"
              placeholder="Gõ số phòng hoặc tên GV để tìm nhanh (302, R101, Nguyễn Văn A)..."
              value={searchKey}
              onChange={(e) => setSearchKey(e.target.value)}
              style={{
                width: '100%',
                padding: '14px 44px 14px 48px',
                borderRadius: '12px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#0f172a',
                fontSize: '17px',
                fontWeight: 600,
                outline: 'none',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}
            />
            {searchKey && (
              <button
                onClick={() => setSearchKey('')}
                style={{
                  position: 'absolute',
                  right: '14px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: '#e2e8f0',
                  border: 'none',
                  color: '#475569',
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  fontWeight: 700,
                }}
              >
                ✕
              </button>
            )}
          </div>
        </section>

        {/* Danh sách thẻ phòng: Thiết kế sáng, chữ lớn, tương phản cao */}
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))',
            gap: '16px',
          }}
        >
          {filteredBookings.length === 0 ? (
            <div
              style={{
                gridColumn: '1 / -1',
                backgroundColor: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '14px',
                padding: '48px 20px',
                textAlign: 'center',
                color: '#64748b',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}
            >
              <i
                className="fa-solid fa-clipboard-check"
                style={{ fontSize: '48px', color: '#94a3b8', marginBottom: '14px' }}
              ></i>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '19px', fontWeight: 800, color: '#1e293b' }}>
                {securityTab === 'chinh_khoa'
                  ? 'Không có ca học nào thuộc Phòng Chính Khóa trong giờ cần mở'
                  : securityTab === 'ngoai_gio'
                  ? 'Không có phòng chính khóa nào được book Slot ngoài giờ (Slot 5, Trưa, 10-14)'
                  : securityTab === 'chuc_nang'
                  ? 'Không có ca học nào thuộc Phòng Chức Năng cần mở'
                  : 'Không có ca học nào cần mở'}
              </h3>
              <p style={{ margin: '0 0 12px 0', fontSize: '15.5px', color: '#64748b' }}>
                {selectedDate
                  ? `Ngày ${formatDateVN(selectedDate)} không có lịch học nào đã duyệt cho tab này (hoặc không khớp với từ khóa tìm kiếm).`
                  : 'Không có dữ liệu ca học đã duyệt.'}
              </p>

              {approvedBookingsInDate.length > 0 && securityTab !== 'all' && (
                <div style={{ marginTop: '14px' }}>
                  <button
                    onClick={() => setSecurityTab('all')}
                    style={{
                      background: '#eff6ff',
                      border: '1.5px solid #93c5fd',
                      color: '#1d4ed8',
                      padding: '8px 16px',
                      borderRadius: '8px',
                      fontWeight: 700,
                      fontSize: '14px',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <i className="fa-solid fa-list-check"></i>
                    Bấm để chuyển sang tab "Tất Cả Phòng" ({approvedBookingsInDate.length} ca)
                  </button>
                </div>
              )}
            </div>
          ) : (
            filteredBookings.map((b, idx) => {
              const bType = getBookingRoomType(b);
              return (
                <div
                  key={b.booking_id || idx}
                  style={{
                    backgroundColor: '#ffffff',
                    border: bType === 'chuc_nang' ? '1.5px solid #fbcfe8' : '1.5px solid #bfdbfe',
                    borderRadius: '14px',
                    padding: '18px',
                    boxShadow: '0 2px 5px rgba(0, 0, 0, 0.05)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '14px',
                  }}
                >
                  {/* Hàng Tiêu Đề: Tên Phòng Cực To & Tag Đã Duyệt + Loại Phòng */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      borderBottom: '1px solid #e2e8f0',
                      paddingBottom: '12px',
                      gap: '10px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                      <div
                        style={{
                          width: '48px',
                          height: '48px',
                          minWidth: '48px',
                          borderRadius: '12px',
                          backgroundColor: bType === 'chuc_nang' ? '#fdf2f8' : '#eff6ff',
                          color: bType === 'chuc_nang' ? '#be185d' : '#2563eb',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '22px',
                          fontWeight: 800,
                          border: bType === 'chuc_nang' ? '1px solid #fbcfe8' : '1px solid #bfdbfe',
                        }}
                      >
                        <i className={`fa-solid ${bType === 'chuc_nang' ? 'fa-flask' : 'fa-door-closed'}`}></i>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: '24px',
                            fontWeight: 900,
                            color: '#0f172a',
                            letterSpacing: '-0.3px',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            lineHeight: 1.2,
                          }}
                        >
                          {b.room_name || b.room_id}
                        </div>
                        <div style={{ fontSize: '14.5px', color: '#64748b', marginTop: '2px' }}>
                          Mã phòng: <b style={{ color: '#1e293b' }}>{b.room_id}</b>
                        </div>
                      </div>
                    </div>

                    {/* Tag Loại Phòng & Tag Trạng Thái Đã Duyệt */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '5px', flexShrink: 0 }}>
                      <span
                        style={{
                          backgroundColor: '#dcfce7',
                          color: '#15803d',
                          padding: '4px 10px',
                          borderRadius: '8px',
                          fontSize: '12.5px',
                          fontWeight: 800,
                          border: '1px solid #bbf7d0',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <i className="fa-solid fa-check"></i>
                        ĐÃ DUYỆT
                      </span>

                      {bType === 'chuc_nang' ? (
                        <span
                          style={{
                            backgroundColor: '#fdf2f8',
                            color: '#be185d',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            fontSize: '11.5px',
                            fontWeight: 800,
                            border: '1px solid #fbcfe8',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <i className="fa-solid fa-flask"></i> Chức năng
                        </span>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <span
                            style={{
                              backgroundColor: '#eff6ff',
                              color: '#1d4ed8',
                              padding: '3px 8px',
                              borderRadius: '6px',
                              fontSize: '11.5px',
                              fontWeight: 800,
                              border: '1px solid #bfdbfe',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <i className="fa-solid fa-chalkboard-user"></i> Chính khóa
                          </span>
                          {isOffHoursSlot(b.time_slot) && (
                            <span
                              style={{
                                backgroundColor: '#fffbeb',
                                color: '#b45309',
                                padding: '3px 8px',
                                borderRadius: '6px',
                                fontSize: '11.5px',
                                fontWeight: 800,
                                border: '1px solid #fde68a',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <i className="fa-solid fa-clock-rotate-left"></i> Ngoài giờ
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Hộp Khung Giờ (Chữ to, màu xanh đậm nổi bật) */}
                  <div
                    style={{
                      backgroundColor: '#eff6ff',
                      borderRadius: '10px',
                      padding: '12px 14px',
                      border: '1.5px solid #bfdbfe',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: '12.5px',
                          color: '#1e40af',
                          fontWeight: 800,
                          textTransform: 'uppercase',
                          letterSpacing: '0.3px',
                        }}
                      >
                        Khung giờ học
                      </div>
                      <div
                        style={{
                          fontSize: '21px',
                          fontWeight: 900,
                          color: '#1d4ed8',
                          marginTop: '3px',
                          letterSpacing: '-0.2px',
                        }}
                      >
                        {b.time_slot}
                      </div>
                    </div>
                    <span
                      style={{
                        background: '#dbeafe',
                        color: '#1e40af',
                        fontSize: '13.5px',
                        fontWeight: 800,
                        padding: '4px 9px',
                        borderRadius: '6px',
                        flexShrink: 0,
                        border: '1px solid #bfdbfe',
                      }}
                    >
                      {formatDateVN(b.date)}
                    </span>
                  </div>

                  {/* Giảng viên & Nội dung môn học (Chữ to, rõ ràng) */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#1e293b' }}>
                      <i
                        className="fa-solid fa-user-tag"
                        style={{ color: '#2563eb', fontSize: '18px', width: '22px' }}
                      ></i>
                      <div style={{ fontSize: '16.5px' }}>
                        <span style={{ color: '#64748b' }}>Người mượn: </span>
                        <strong style={{ color: '#0f172a', fontSize: '18px' }}>
                          {b.borrower_name || b.fullname || b.username}
                        </strong>
                        {b.borrower_name && b.fullname && b.borrower_name !== b.fullname && (
                          <span style={{ color: '#64748b', fontSize: '13.5px', marginLeft: '6px' }}>
                            (Đăng ký: {b.fullname})
                          </span>
                        )}
                      </div>
                    </div>

                    {b.purpose && (
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', color: '#1e293b' }}>
                        <i
                          className="fa-solid fa-book-open"
                          style={{ color: '#7c3aed', fontSize: '17px', width: '22px', marginTop: '3px' }}
                        ></i>
                        <div style={{ wordBreak: 'break-word', fontSize: '16px' }}>
                          <span style={{ color: '#64748b' }}>Nội dung: </span>
                          <strong style={{ color: '#0f172a' }}>{b.purpose}</strong>
                        </div>
                      </div>
                    )}

                    {b.note && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '10px',
                          color: '#b45309',
                          backgroundColor: '#fffbeb',
                          border: '1.5px solid #fde68a',
                          padding: '10px 14px',
                          borderRadius: '10px',
                          fontSize: '15px',
                        }}
                      >
                        <i
                          className="fa-solid fa-box-open"
                          style={{ color: '#d97706', fontSize: '18px', width: '22px', marginTop: '2px' }}
                        ></i>
                        <div style={{ wordBreak: 'break-word' }}>
                          <span style={{ fontWeight: 800 }}>Ghi chú / Mượn đồ: </span>
                          <span style={{ fontWeight: 700, color: '#92400e' }}>{b.note}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </section>
      </main>

      {/* Footer gọn nhẹ */}
      <footer
        style={{
          textAlign: 'center',
          padding: '14px 10px',
          fontSize: '13px',
          fontWeight: 600,
          color: '#64748b',
          borderTop: '1px solid #cbd5e1',
          background: '#ffffff',
          marginTop: 'auto',
        }}
      >
        HỆ THỐNG QUẢN LÝ PHÒNG HỌC FSCCT • BẢO VỆ TRỰC BAN
      </footer>
    </div>
  );
};
