import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Room, Booking, BookingStatus, UserRole, RoomType } from './types';
import {
  fetchRooms,
  fetchBookings,
  fetchBusySlots,
  apiCreateBooking,
  apiUpdateStatus,
  loginUser as localLoginUser,
  getSavedSupabaseConfig,
  saveSupabaseConfig,
  getSupabaseSqlSchema,
  sendEmailNotification,
  sendBatchEmailNotification,
  getEmailLogs,
  EmailLog,
  sendTestEmail,
  apiCreateRoom,
  apiDeleteRoom,
  apiDeleteBooking,
  getSavedEmailTemplates,
  saveEmailTemplates,
  DEFAULT_EMAIL_TEMPLATES,
  EmailTemplates,
  getSupabaseClient,
  fetchAdminSettingEmails,
  saveAdminEmailsToSupabase,
  inferRoomType,
  normalizeRoomType,
} from './lib/supabase';
import { ExcelImportModal } from './components/ExcelImportModal';
import { RecurringScheduleModal } from './components/RecurringScheduleModal';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { SecurityBookingView } from './components/SecurityBookingView';
import { ScheduleTimeline } from './components/ScheduleTimeline';
import { DEFAULT_TIME_SLOTS } from './lib/initialData';
import {
  isSlotInPast,
  isSlotUnder24Hours,
  isSlotOccupiedByAny,
  getLocalDateString,
  UNDER_24H_WARNING_TEXT,
  isHallRoomId,
  syncPurposeWithHallEquipment,
  HallEquipmentState,
} from './lib/slotValidation';

// Lấy danh sách slot trực tiếp từ DEFAULT_TIME_SLOTS (src/lib/initialData.ts) làm nguồn duy nhất
const DEFAULT_SLOTS = DEFAULT_TIME_SLOTS.map((s) => s.label);

interface UserSession {
  username: string;
  role: UserRole;
  fullname: string;
}

// Tiện ích bỏ dấu tiếng Việt để tìm kiếm không dấu / có dấu đều chính xác
function removeVietnameseTones(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase();
}

export default function App() {
  const [session, setSession] = useState<UserSession | null>(() => {
    try {
      const saved = localStorage.getItem("vuth_booking_session");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [activeView, setActiveView] = useState<'rooms' | 'bookings'>('rooms');
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);

  // Login form state
  const [loginUserVal, setLoginUserVal] = useState<string>('');
  const [loginPassVal, setLoginPassVal] = useState<string>('');
  const [loginError, setLoginError] = useState<string>('');
  const [isLoginLoading, setIsLoginLoading] = useState<boolean>(false);

  // Supabase & Email Config Modal State
  const [isConfigModalOpen, setIsConfigModalOpen] = useState<boolean>(false);
  const [configTab, setConfigTab] = useState<'database' | 'email' | 'templates' | 'logs'>('database');
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplates>(() => getSavedEmailTemplates());
  const [templateSavedNotice, setTemplateSavedNotice] = useState<boolean>(false);
  const [supabaseUrl, setSupabaseUrl] = useState<string>('');
  const [supabaseKey, setSupabaseKey] = useState<string>('');
  const [copiedSql, setCopiedSql] = useState<boolean>(false);

  // Direct SMTP State (Mật khẩu được lưu trữ an toàn duy nhất trên biến môi trường Vercel SMTP_PASS)
  const [smtpUser, setSmtpUser] = useState<string>('');
  const [smtpHost, setSmtpHost] = useState<string>('smtp.gmail.com');
  const [smtpPort, setSmtpPort] = useState<string>('587');
  const [adminRecipientsInput, setAdminRecipientsInput] = useState<string>('tranhuyvu3009@gmail.com');
  const [testEmailAddress, setTestEmailAddress] = useState<string>('vuth3009@gmail.com');
  const [isTestingEmail, setIsTestingEmail] = useState<boolean>(false);
  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([]);

  // App Data (Nạp ngay lập tức từ bộ nhớ cache trình duyệt để tránh bị màn hình trắng khi tải trang)
  const [rooms, setRooms] = useState<Room[]>(() => {
    try {
      const raw = localStorage.getItem('vuth_booking_rooms');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [bookings, setBookings] = useState<Booking[]>(() => {
    try {
      const raw = localStorage.getItem('vuth_booking_bookings');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Filters for rooms view
  const [roomSearchKey, setRoomSearchKey] = useState<string>('');

  // Lọc danh sách phòng theo ô tìm kiếm và ưu tiên phòng chức năng (chuc_nang) lên đầu danh sách
  const filteredRooms = useMemo(() => {
    let list = rooms;
    if (roomSearchKey.trim()) {
      const rawTerm = roomSearchKey.trim().toLowerCase();
      const cleanTerm = removeVietnameseTones(rawTerm);

      list = rooms.filter((r) => {
        const textToSearch = `${r.room_name || ''} ${r.room_id || ''} ${r.capacity || ''} ${r.building || ''} ${r.floor || ''} ${r.description || ''} ${r.status || ''}`;
        const rawText = textToSearch.toLowerCase();
        const cleanText = removeVietnameseTones(textToSearch);

        return rawText.includes(rawTerm) || cleanText.includes(cleanTerm);
      });
    }

    // Ưu tiên hiển thị phòng chức năng (chuc_nang) lên trước phòng chính khóa (chinh_khoa)
    return [...list].sort((a, b) => {
      const typeA = normalizeRoomType(a.room_type, a.room_name, a.room_id) === 'chuc_nang' ? 0 : 1;
      const typeB = normalizeRoomType(b.room_type, b.room_name, b.room_id) === 'chuc_nang' ? 0 : 1;
      if (typeA !== typeB) {
        return typeA - typeB;
      }
      return (a.room_id || '').localeCompare(b.room_id || '', undefined, { numeric: true });
    });
  }, [rooms, roomSearchKey]);

  // Filters for bookings view
  const [searchKey, setSearchKey] = useState<string>('');
  const [filterDate, setFilterDate] = useState<string>('');
  const [bookingStatusTab, setBookingStatusTab] = useState<'pending' | 'approved' | 'all'>('pending');
  const [selectedBookingIds, setSelectedBookingIds] = useState<string[]>([]);
  const [isBatchProcessing, setIsBatchProcessing] = useState<boolean>(false);

  // Booking Modal State (Multi-Room Booking Cart - Phương án 2)
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [cartRooms, setCartRooms] = useState<Array<{
    cartItemId: string;
    roomId: string;
    roomName: string;
    selectedSlots: string[];
    busySlots: string[];
    isCheckingSlots?: boolean;
  }>>([]);
  const [bookBorrowerName, setBookBorrowerName] = useState<string>('');
  const [bookDate, setBookDate] = useState<string>('');
  const [bookPurpose, setBookPurpose] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [hallEquipment, setHallEquipment] = useState<HallEquipmentState>({
    led: false,
    mayLanh: false,
    diDoiBanGhe: false,
  });

  // Add Room Modal State
  const [isAddRoomModalOpen, setIsAddRoomModalOpen] = useState<boolean>(false);
  const [newRoomId, setNewRoomId] = useState<string>('');
  const [newRoomName, setNewRoomName] = useState<string>('');
  const [newRoomCapacity, setNewRoomCapacity] = useState<number>(40);
  const [newRoomStatus, setNewRoomStatus] = useState<'Active' | 'Inactive' | 'Maintenance'>('Active');
  const [newRoomType, setNewRoomType] = useState<RoomType>('chinh_khoa');
  const [newRoomFloor, setNewRoomFloor] = useState<string>('');
  const [newRoomBuilding, setNewRoomBuilding] = useState<string>('');
  const [newRoomDescription, setNewRoomDescription] = useState<string>('');
  const [isAddingRoom, setIsAddingRoom] = useState<boolean>(false);

  // Excel Import Modal State
  const [isExcelModalOpen, setIsExcelModalOpen] = useState<boolean>(false);
  // Recurring Schedule Modal State (Lịch cố định định kỳ)
  const [isRecurringModalOpen, setIsRecurringModalOpen] = useState<boolean>(false);

  // Password Change States
  const [forceChangePasswordData, setForceChangePasswordData] = useState<{
    user: { username: string; fullname: string; role: UserRole };
    enteredPass: string;
  } | null>(null);
  const [isChangePasswordModalOpen, setIsChangePasswordModalOpen] = useState<boolean>(false);

  // Cancel Booking Modal State (Popup nhập lý do hủy đơn cho Admin và User)
  const [cancelModalBooking, setCancelModalBooking] = useState<Booking | null>(null);
  const [cancelReasonInput, setCancelReasonInput] = useState<string>('');

  // Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleExcelImportSuccess = async (message: string) => {
    showToast(message);
    await syncAllData();
  };

  const handleAddRoomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (session?.role !== 'admin' && session?.role !== 'superadmin') {
      alert('Chỉ tài khoản Quản trị viên (Admin / SuperAdmin) mới có quyền thêm phòng học!');
      return;
    }

    if (!newRoomId.trim() || !newRoomName.trim()) {
      alert('Vui lòng nhập Mã phòng và Tên phòng!');
      return;
    }

    setIsAddingRoom(true);
    setIsLoading(true);
    try {
      const res = await apiCreateRoom({
        room_id: newRoomId,
        room_name: newRoomName,
        capacity: newRoomCapacity,
        status: newRoomStatus,
        room_type: newRoomType,
        floor: newRoomFloor,
        building: newRoomBuilding,
        description: newRoomDescription,
      });

      if (res.success) {
        showToast(res.message);
        setIsAddRoomModalOpen(false);
        setNewRoomId('');
        setNewRoomName('');
        setNewRoomCapacity(40);
        setNewRoomType('chinh_khoa');
        setNewRoomFloor('');
        setNewRoomBuilding('');
        setNewRoomDescription('');
        await syncAllData();
      } else {
        alert(res.message);
      }
    } catch (err: any) {
      alert('Thêm phòng học thất bại: ' + (err?.message || err));
    } finally {
      setIsAddingRoom(false);
      setIsLoading(false);
    }
  };

  const handleDeleteRoom = async (roomId: string, roomName: string) => {
    if (session?.role !== 'admin' && session?.role !== 'superadmin') {
      alert('Chỉ tài khoản Admin / SuperAdmin mới có quyền xóa phòng học!');
      return;
    }
    if (!confirm(`Bạn có chắc chắn muốn xóa phòng [${roomId} - ${roomName}] không?`)) {
      return;
    }
    setIsLoading(true);
    try {
      const res = await apiDeleteRoom(roomId);
      if (res.success) {
        showToast(res.message);
        setRooms(prev => prev.filter(r => (r.room_id || '').trim().toUpperCase() !== roomId.trim().toUpperCase()));
        await syncAllData();
      } else {
        alert(res.message);
      }
    } catch (err: any) {
      alert('Lỗi xóa phòng học: ' + (err?.message || err));
    } finally {
      setIsLoading(false);
    }
  };

  const todayStr = getLocalDateString();
  const [roomViewMode, setRoomViewMode] = useState<'cards' | 'grid'>('cards');
  const [timelineDate, setTimelineDate] = useState<string>(todayStr);

  // Load session and config from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("vuth_booking_session");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setSession(parsed);
      } catch (e) {
        localStorage.removeItem("vuth_booking_session");
      }
    }

    const cfg = getSavedSupabaseConfig();
    setSupabaseUrl(cfg.url || '');
    setSupabaseKey(cfg.anonKey || '');

    setSmtpUser(localStorage.getItem('vuth_booking_smtp_user') || '');
    localStorage.removeItem('vuth_booking_smtp_pass');
    setSmtpHost(localStorage.getItem('vuth_booking_smtp_host') || 'smtp.gmail.com');
    setSmtpPort(localStorage.getItem('vuth_booking_smtp_port') || '587');
    setEmailLogs(getEmailLogs());

    // Load admin email list from Supabase/localStorage
    fetchAdminSettingEmails().then((list) => {
      if (list && list.length > 0) {
        setAdminRecipientsInput(list.join(', '));
      }
    });
  }, []);

  const lastSyncTimeRef = useRef<number>(0);

  // Đồng bộ dữ liệu với cơ chế cache thông minh
  const syncAllData = async (silent: boolean = false, forceRefreshRooms: boolean = false) => {
    if (!silent) {
      setIsLoading(true);
    }
    try {
      // Chỉ nạp lại bảng rooms khi người dùng ấn nút Làm mới (forceRefreshRooms = true) hoặc chưa có cache
      // Vì bảng rooms rất ít khi thay đổi, giúp cắt giảm ngay 50% số lượng query vào Supabase
      const fetchedRooms = await fetchRooms(forceRefreshRooms);
      const fetchedBookings = await fetchBookings(
        session?.username,
        session?.role
      );
      setRooms(fetchedRooms);
      setBookings(fetchedBookings);
      lastSyncTimeRef.current = Date.now();
    } catch (err) {
      console.error(err);
      if (!silent) {
        showToast("Lỗi nạp và xử lý đồng bộ dữ liệu!");
      }
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    if (session) {
      // Nạp dữ liệu lần đầu khi đăng nhập (làm mới danh sách phòng từ CSDL)
      syncAllData(false, true);

      // 1. Tự động đồng bộ ngầm định kỳ:
      // - Tuyệt đối KHÔNG chạy khi tab đang ẩn (document.hidden = true) -> Tiết kiệm 100% tài nguyên khi người dùng tắt màn hình/rời máy
      // - Khoảng thời gian giãn cách tối ưu: 120 giây (2 phút) thay vì liên tục, kết hợp với Realtime WebSocket tức thời
      // - Bảng rooms đã được lưu trong cache bộ nhớ (30 phút), không query lặp lại
      const interval = setInterval(() => {
        if (!document.hidden) {
          syncAllData(true, false);
        }
      }, 120000);

      // 2. Tự động đồng bộ ngay khi người dùng mở lại tab hoặc mở lại ứng dụng trên điện thoại
      // Throttling: chỉ đồng bộ nếu lần đồng bộ trước đã cách hơn 30 giây để tránh spam query
      const handleVisibilityOrFocus = () => {
        if (!document.hidden) {
          const now = Date.now();
          if (now - lastSyncTimeRef.current > 30000) {
            syncAllData(true, false);
          }
        }
      };
      window.addEventListener('focus', handleVisibilityOrFocus);
      document.addEventListener('visibilitychange', handleVisibilityOrFocus);

      // 3. Supabase Realtime Subscription (khi có kết nối Supabase)
      // Nhận thông báo tức thời qua WebSocket khi có đơn mới mà không cần thăm dò liên tục
      const client = getSupabaseClient();
      let channel: any = null;
      let realtimeDebounceTimer: any = null;

      if (client) {
        try {
          channel = client
            .channel('public:bookings_realtime')
            .on(
              'postgres_changes',
              { event: '*', schema: 'public', table: 'bookings' },
              () => {
                clearTimeout(realtimeDebounceTimer);
                realtimeDebounceTimer = setTimeout(() => {
                  syncAllData(true, false);
                }, 800);
              }
            )
            .subscribe();
        } catch (e) {
          console.warn('Realtime channel error:', e);
        }
      }

      return () => {
        clearInterval(interval);
        clearTimeout(realtimeDebounceTimer);
        window.removeEventListener('focus', handleVisibilityOrFocus);
        document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
        if (channel && client) {
          client.removeChannel(channel);
        }
      };
    }
  }, [session]);

  // Save Supabase & Direct Email Config
  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    saveSupabaseConfig(supabaseUrl, supabaseKey);
    saveEmailTemplates(emailTemplates);
    localStorage.removeItem('vuth_booking_apps_script_url');
    localStorage.removeItem('vuth_booking_smtp_pass');
    localStorage.setItem('vuth_booking_smtp_user', smtpUser.trim());
    localStorage.setItem('vuth_booking_smtp_host', smtpHost.trim() || 'smtp.gmail.com');
    localStorage.setItem('vuth_booking_smtp_port', smtpPort.trim() || '587');
    if (adminRecipientsInput.trim()) {
      saveAdminEmailsToSupabase(adminRecipientsInput.trim());
    }
    showToast("Đã lưu cài đặt CSDL & Cấu hình Gửi Mail thành công!");
    setIsConfigModalOpen(false);
    syncAllData();
  };

  const handleSaveTemplatesOnly = () => {
    saveEmailTemplates(emailTemplates);
    setTemplateSavedNotice(true);
    showToast("Đã lưu mẫu thông báo Email thành công!");
    setTimeout(() => setTemplateSavedNotice(false), 3000);
  };

  const handleResetTemplates = () => {
    setEmailTemplates(DEFAULT_EMAIL_TEMPLATES);
    saveEmailTemplates(DEFAULT_EMAIL_TEMPLATES);
    showToast("Đã khôi phục mẫu thông báo mặc định!");
  };

  // Direct Test Email Handler
  const handleSendTestMail = async () => {
    if (!testEmailAddress || !testEmailAddress.includes('@')) {
      alert('Vui lòng nhập địa chỉ email nhận thử nghiệm hợp lệ!');
      return;
    }
    setIsTestingEmail(true);
    try {
      const res = await sendTestEmail(testEmailAddress.trim());
      if (res.success) {
        showToast(res.message);
        if (res.previewUrl) {
          window.open(res.previewUrl, '_blank');
        }
      } else {
        alert(res.message);
      }
    } catch (err: any) {
      alert('Lỗi gửi mail thử nghiệm: ' + (err?.message || err));
    } finally {
      setIsTestingEmail(false);
      setEmailLogs(getEmailLogs());
    }
  };

  // Copy SQL Schema
  const handleCopySql = () => {
    const sql = getSupabaseSqlSchema();
    navigator.clipboard.writeText(sql);
    setCopiedSql(true);
    showToast("Đã sao chép mã SQL vào khay nhớ tạm (Clipboard)!");
    setTimeout(() => setCopiedSql(false), 3000);
  };

  // Execute Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setIsLoginLoading(true);

    try {
      const res = await localLoginUser(loginUserVal, loginPassVal);
      if (res.success && res.user) {
        // Detect default password (e.g. 123456)
        if (res.isDefaultPassword) {
          setForceChangePasswordData({
            user: {
              username: res.user.username,
              fullname: res.user.fullname,
              role: res.user.role,
            },
            enteredPass: loginPassVal,
          });
          showToast("Phát hiện mật khẩu mặc định (123456). Vui lòng đổi mật khẩu mới để tiếp tục!");
          return;
        }

        const newSession: UserSession = {
          username: res.user.username,
          role: res.user.role,
          fullname: res.user.fullname,
        };
        localStorage.setItem("vuth_booking_session", JSON.stringify(newSession));
        setSession(newSession);
        setLoginUserVal('');
        setLoginPassVal('');
        setActiveView('rooms');
        showToast(`Đăng nhập thành công với quyền ${res.user.role.toUpperCase()}!`);
      } else {
        setLoginError(res.message || 'Đăng nhập thất bại!');
      }
    } catch (err) {
      setLoginError('Lỗi kết nối hệ thống!');
    } finally {
      setIsLoginLoading(false);
    }
  };

  const handleForcePasswordChangeSuccess = () => {
    if (!forceChangePasswordData) return;
    const newSession: UserSession = {
      username: forceChangePasswordData.user.username,
      role: forceChangePasswordData.user.role,
      fullname: forceChangePasswordData.user.fullname,
    };
    localStorage.setItem("vuth_booking_session", JSON.stringify(newSession));
    setSession(newSession);
    setForceChangePasswordData(null);
    setLoginUserVal('');
    setLoginPassVal('');
    setActiveView('rooms');
    showToast("Đổi mật khẩu thành công! Chào mừng bạn vào hệ thống.");
  };

  const handleVoluntaryPasswordChangeSuccess = () => {
    setIsChangePasswordModalOpen(false);
    showToast("Đã cập nhật mật khẩu mới thành công!");
  };

  // Execute Logout
  const handleLogout = () => {
    setIsLoading(true);
    localStorage.removeItem("vuth_booking_session");
    setSession(null);
    setIsLoading(false);
    showToast("Đã đăng xuất khỏi hệ thống!");
  };

  // Open / Close Booking Modal (Multi-Room Cart)
  const openBookingModal = (id: string, name: string, initialDate?: string, initialSlots?: string[]) => {
    const targetDate = initialDate || bookDate || todayStr;
    const initialItem = {
      cartItemId: 'item_' + Date.now(),
      roomId: id,
      roomName: name,
      selectedSlots: initialSlots || [],
      busySlots: [] as string[],
      isCheckingSlots: true,
    };

    setCartRooms([initialItem]);
    setBookBorrowerName(session?.fullname || session?.username || '');
    setBookDate(targetDate);
    setBookPurpose('');
    setHallEquipment({ led: false, mayLanh: false, diDoiBanGhe: false });
    setIsModalOpen(true);

    fetchBusySlots(id, targetDate)
      .then((slots) => {
        setCartRooms((prev) =>
          prev.map((item) =>
            item.cartItemId === initialItem.cartItemId
              ? { ...item, busySlots: slots.map((s) => s.toLowerCase().trim()), isCheckingSlots: false }
              : item
          )
        );
      })
      .catch(() => {
        setCartRooms((prev) =>
          prev.map((item) =>
            item.cartItemId === initialItem.cartItemId
              ? { ...item, busySlots: [], isCheckingSlots: false }
              : item
          )
        );
      });
  };

  const closeBookingModal = () => {
    setIsModalOpen(false);
    setCartRooms([]);
    setBookBorrowerName('');
    setBookDate('');
    setBookPurpose('');
    setHallEquipment({ led: false, mayLanh: false, diDoiBanGhe: false });
  };

  // Kiểm tra xem giỏ đặt phòng có chứa Phòng Hội Trường (.Bhoitruong) hay không
  const hasHallRoomInCart = useMemo(() => {
    return cartRooms.some((item) => isHallRoomId(item.roomId, item.roomName));
  }, [cartRooms]);

  const handleToggleHallEquipment = (key: keyof HallEquipmentState) => {
    const nextState: HallEquipmentState = {
      ...hallEquipment,
      [key]: !hallEquipment[key],
    };
    setHallEquipment(nextState);
    setBookPurpose((prev) => syncPurposeWithHallEquipment(prev, nextState));
  };

  // Add another room to the cart
  const handleAddRoomToCart = () => {
    const selectedRoomIds = new Set(cartRooms.map((r) => r.roomId));
    const availableRooms = rooms.filter(
      (r) => !selectedRoomIds.has(r.room_id) && r.status !== 'Inactive' && r.status !== 'Maintenance'
    );

    if (availableRooms.length === 0) {
      alert("Bạn đã thêm tất cả các phòng khả dụng vào danh sách đặt!");
      return;
    }

    const nextRoom = availableRooms[0];
    const newItem = {
      cartItemId: 'item_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      roomId: nextRoom.room_id,
      roomName: nextRoom.room_name,
      selectedSlots: [] as string[],
      busySlots: [] as string[],
      isCheckingSlots: Boolean(bookDate),
    };

    setCartRooms((prev) => [...prev, newItem]);

    if (bookDate) {
      fetchBusySlots(nextRoom.room_id, bookDate)
        .then((slots) => {
          setCartRooms((prev) =>
            prev.map((item) =>
              item.cartItemId === newItem.cartItemId
                ? { ...item, busySlots: slots.map((s) => s.toLowerCase().trim()), isCheckingSlots: false }
                : item
            )
          );
        })
        .catch(() => {
          setCartRooms((prev) =>
            prev.map((item) =>
              item.cartItemId === newItem.cartItemId
                ? { ...item, busySlots: [], isCheckingSlots: false }
                : item
            )
          );
        });
    }
  };

  // Remove a room from the cart
  const handleRemoveRoomFromCart = (cartItemId: string) => {
    if (cartRooms.length <= 1) {
      alert("Đợt mượn phòng phải có ít nhất 1 phòng học!");
      return;
    }
    setCartRooms((prev) => prev.filter((r) => r.cartItemId !== cartItemId));
  };

  // Switch room in a cart row
  const handleChangeRoomInCart = (cartItemId: string, newRoomId: string) => {
    const targetRoom = rooms.find((r) => r.room_id === newRoomId);
    if (!targetRoom) return;

    const isAlreadyInCart = cartRooms.some((r) => r.cartItemId !== cartItemId && r.roomId === newRoomId);
    if (isAlreadyInCart) {
      alert(`Phòng [${targetRoom.room_name}] đã có trong danh sách đặt rồi! Vui lòng chọn phòng khác.`);
      return;
    }

    setCartRooms((prev) =>
      prev.map((item) =>
        item.cartItemId === cartItemId
          ? {
              ...item,
              roomId: newRoomId,
              roomName: targetRoom.room_name,
              selectedSlots: [],
              busySlots: [],
              isCheckingSlots: Boolean(bookDate),
            }
          : item
      )
    );

    if (bookDate) {
      fetchBusySlots(newRoomId, bookDate)
        .then((slots) => {
          setCartRooms((prev) =>
            prev.map((item) =>
              item.cartItemId === cartItemId
                ? { ...item, busySlots: slots.map((s) => s.toLowerCase().trim()), isCheckingSlots: false }
                : item
            )
          );
        })
        .catch(() => {
          setCartRooms((prev) =>
            prev.map((item) =>
              item.cartItemId === cartItemId
                ? { ...item, busySlots: [], isCheckingSlots: false }
                : item
            )
          );
        });
    }
  };

  // Handle slot toggle for a specific room item in the cart
  const handleCartSlotToggle = (cartItemId: string, slotValue: string) => {
    if (!bookDate) {
      alert("Vui lòng chọn Ngày sử dụng trước!");
      return;
    }
    if (isSlotInPast(bookDate, slotValue)) {
      alert("Khung giờ này đã qua thời gian hiện tại, không thể chọn đặt!");
      return;
    }

    setCartRooms((prev) =>
      prev.map((item) => {
        if (item.cartItemId !== cartItemId) return item;

        const isBusy = isSlotOccupiedByAny(slotValue, item.busySlots);
        if (isBusy) {
          alert(`Khung giờ "${slotValue}" của phòng [${item.roomName}] đã có người đặt trước!`);
          return item;
        }

        const isChecked = item.selectedSlots.includes(slotValue);
        const updatedSlots = isChecked
          ? item.selectedSlots.filter((s) => s !== slotValue)
          : [...item.selectedSlots, slotValue];

        return { ...item, selectedSlots: updatedSlots };
      })
    );
  };

  // Handle date change: re-fetch busy slots for all rooms in cart & filter out past slots
  const handleDateChange = (newDate: string) => {
    setBookDate(newDate);
    if (!newDate) return;

    setCartRooms((prev) =>
      prev.map((item) => ({
        ...item,
        isCheckingSlots: true,
        selectedSlots: item.selectedSlots.filter((s) => !isSlotInPast(newDate, s)),
      }))
    );

    cartRooms.forEach((item) => {
      fetchBusySlots(item.roomId, newDate)
        .then((slots) => {
          setCartRooms((prev) =>
            prev.map((r) =>
              r.cartItemId === item.cartItemId
                ? {
                    ...r,
                    busySlots: slots.map((s) => s.toLowerCase().trim()),
                    isCheckingSlots: false,
                    selectedSlots: r.selectedSlots.filter(
                      (s) => !slots.some((busy) => busy.toLowerCase().trim() === s.toLowerCase().trim())
                    ),
                  }
                : r
            )
          );
        })
        .catch(() => {
          setCartRooms((prev) =>
            prev.map((r) => (r.cartItemId === item.cartItemId ? { ...r, isCheckingSlots: false } : r))
          );
        });
    });
  };

  // Submit Multi-Room Booking Form
  const handleSubmitBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookBorrowerName.trim()) {
      alert("Vui lòng nhập thông tin người mượn phòng!");
      return;
    }

    if (!bookDate) {
      alert("Vui lòng chọn ngày sử dụng!");
      return;
    }

    if (cartRooms.length === 0) {
      alert("Vui lòng chọn ít nhất một phòng học!");
      return;
    }

    // 1. Kiểm tra từng phòng trong giỏ
    for (const roomItem of cartRooms) {
      if (roomItem.selectedSlots.length === 0) {
        alert(`Vui lòng chọn ít nhất một khung giờ (Slot) cho phòng [${roomItem.roomName}]! Hoặc nhấn nút 'Xóa phòng' nếu không muốn đặt phòng này.`);
        return;
      }

      const pastSlot = roomItem.selectedSlots.find((s) => isSlotInPast(bookDate, s));
      if (pastSlot) {
        alert(`Khung giờ "${pastSlot}" của phòng [${roomItem.roomName}] đã qua thời gian hiện tại! Vui lòng chọn lại.`);
        return;
      }

      const busySlot = roomItem.selectedSlots.find((s) => isSlotOccupiedByAny(s, roomItem.busySlots));
      if (busySlot) {
        alert(`Khung giờ "${busySlot}" của phòng [${roomItem.roomName}] đã có người đặt trước! Vui lòng chọn lại.`);
        return;
      }
    }

    if (!bookPurpose.trim()) {
      alert("Vui lòng nhập mục đích sử dụng phòng!");
      return;
    }

    setIsSubmitting(true);
    setIsLoading(true);

    try {
      const isMulti = cartRooms.length > 1;
      const isAdminUser = session?.role === 'admin' || session?.role === 'superadmin' || session?.username?.toLowerCase() === 'admin';

      // 1. Gửi đặt các phòng đồng thời (Promise.all) thay vì tuần tự, giúp giảm thời gian chờ gấp nhiều lần
      const bookingPromises = cartRooms.map(async (roomItem) => {
        const targetRoom = rooms.find(
          (r) =>
            String(r.room_id || (r as any).id || '').trim().toUpperCase() === String(roomItem.roomId || '').trim().toUpperCase() ||
            String(r.room_name || (r as any).name || '').trim().toLowerCase() === String(roomItem.roomName || '').trim().toLowerCase()
        );
        const rType = normalizeRoomType(targetRoom?.room_type, roomItem.roomName, roomItem.roomId);

        const res = await apiCreateBooking({
          room_id: roomItem.roomId,
          room_name: roomItem.roomName,
          username: session?.username || 'user',
          fullname: session?.fullname || 'Giảng viên',
          borrower_name: bookBorrowerName.trim(),
          date: bookDate,
          time_slots: roomItem.selectedSlots,
          purpose: bookPurpose.trim(),
          skipEmail: isMulti || isAdminUser, // Nếu là Admin hoặc đặt nhiều phòng thì bỏ qua gửi email đơn lẻ
          skipBusyCheck: true, // Tiết kiệm 1 vòng query vì giao diện đã xác thực khung giờ bận trước khi gửi
          status: isAdminUser ? 'Approved' : 'Pending',
          userRole: session?.role,
          room_type: rType,
        });

        return { res, roomItem };
      });

      const results = await Promise.all(bookingPromises);
      const createdList: Booking[] = [];
      const errorList: string[] = [];

      for (const { res, roomItem } of results) {
        if (res.success && res.booking) {
          createdList.push(res.booking);
        } else {
          errorList.push(`${roomItem.roomName}: ${res.message}`);
        }
      }

      // 2. Nếu đặt nhiều phòng cùng lúc (và không phải Admin), gửi email tổng hợp ngầm trong nền (non-blocking)
      if (isMulti && createdList.length > 0 && !isAdminUser) {
        sendBatchEmailNotification(createdList)
          .then(() => setEmailLogs(getEmailLogs()))
          .catch((e) => console.warn('Background batch email error:', e));
      }

      // 3. Cập nhật Optimistic UI tức thì vào giao diện & LocalStorage mà không bắt người dùng đợi spinner
      if (createdList.length > 0) {
        setBookings((prev) => {
          const newIds = new Set(createdList.map((b) => b.booking_id));
          const filtered = prev.filter((b) => !newIds.has(b.booking_id));
          const updated = [...createdList, ...filtered];
          try {
            localStorage.setItem('vuth_booking_bookings', JSON.stringify(updated));
          } catch {}
          return updated;
        });
      }

      if (createdList.length === cartRooms.length) {
        const hasUnder24h = cartRooms.some((r) => r.selectedSlots.some((s) => isSlotUnder24Hours(bookDate, s)));
        const warningSuffix = hasUnder24h ? ` (${UNDER_24H_WARNING_TEXT})` : '';
        const adminApprovedNotice = isAdminUser ? ' [Đã Tự Động Phê Duyệt]' : '';
        showToast(`Đã đặt thành công ${createdList.length} phòng cho ngày ${bookDate}!${adminApprovedNotice}${warningSuffix}`);
        closeBookingModal();
        setIsLoading(false);

        // Đồng bộ ngầm trong nền (silent = true) để kiểm tra tính nhất quán dữ liệu mà không che mờ màn hình
        syncAllData(true, false).catch(console.error);
      } else if (createdList.length > 0) {
        alert(`Đã đặt thành công ${createdList.length}/${cartRooms.length} phòng.\nMột số phòng lỗi:\n${errorList.join('\n')}`);
        closeBookingModal();
        setIsLoading(false);
        syncAllData(true, false).catch(console.error);
      } else {
        alert(`Đặt phòng thất bại:\n${errorList.join('\n')}`);
        setIsLoading(false);
      }
    } catch (err: any) {
      alert(`Gửi đơn đặt thất bại: ${err?.message || err}`);
    } finally {
      setIsSubmitting(false);
      setIsLoading(false);
    }
  };

  // Cancel Modal Handlers (Popup nhập lý do hủy đơn cho Admin & User)
  const handleOpenCancelModal = (booking: Booking) => {
    setCancelModalBooking(booking);
    setCancelReasonInput('');
  };

  const handleCloseCancelModal = () => {
    setCancelModalBooking(null);
    setCancelReasonInput('');
  };

  const handleConfirmCancelBooking = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!cancelModalBooking) return;

    const bookingId = cancelModalBooking.booking_id;
    const reason = cancelReasonInput.trim();

    handleCloseCancelModal();
    await handleChangeStatus(bookingId, 'Cancelled', reason || undefined);
  };

  // Change Status (Approve / Reject / Cancel)
  const handleChangeStatus = async (id: string, newStatus: BookingStatus, customReason?: string) => {
    let rejectReason: string | undefined = customReason;
    if (newStatus === 'Rejected' && !customReason) {
      const inputReason = prompt("Nhập lý do từ chối (có thể bỏ qua):");
      if (inputReason === null) return; // User cancelled prompt
      rejectReason = inputReason || undefined;
    }

    // Optimistic UI update so status changes instantly without waiting
    setBookings((prev) =>
      prev.map((b) => {
        if (String(b.booking_id) === String(id) || String((b as any).id) === String(id)) {
          return { ...b, status: newStatus, reject_reason: rejectReason || b.reject_reason };
        }
        return b;
      })
    );

    setIsLoading(true);
    try {
      const res = await apiUpdateStatus(id, newStatus, rejectReason);
      showToast(res.message);
      await syncAllData();
      setEmailLogs(getEmailLogs());
    } catch (err: any) {
      showToast("Đã cập nhật trạng thái!");
    } finally {
      setIsLoading(false);
    }
  };

  // Toggle selection for a single booking row
  const handleToggleSelectBooking = (id: string) => {
    setSelectedBookingIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  // Toggle Select All filtered bookings
  const handleToggleSelectAll = () => {
    const allFilteredIds = filteredBookings.map((b) => b.booking_id);
    if (allFilteredIds.length === 0) return;
    const isAllSelected = allFilteredIds.every((id) => selectedBookingIds.includes(id));
    if (isAllSelected) {
      // Bỏ chọn tất cả các đơn đang hiển thị
      setSelectedBookingIds((prev) => prev.filter((id) => !allFilteredIds.includes(id)));
    } else {
      // Chọn tất cả các đơn đang hiển thị
      setSelectedBookingIds((prev) => Array.from(new Set([...prev, ...allFilteredIds])));
    }
  };

  // Batch Approve selected bookings
  const handleBatchApprove = async () => {
    if (selectedBookingIds.length === 0) return;
    if (
      !confirm(
        `Bạn có chắc chắn muốn PHÊ DUYỆT (Approved) đồng loạt ${selectedBookingIds.length} đơn đặt phòng đã chọn?`
      )
    ) {
      return;
    }

    setIsBatchProcessing(true);
    setIsLoading(true);
    try {
      let successCount = 0;
      for (const id of selectedBookingIds) {
        const res = await apiUpdateStatus(id, 'Approved');
        if (res.success) successCount++;
      }
      showToast(`Đã phê duyệt thành công ${successCount}/${selectedBookingIds.length} đơn đặt phòng!`);
      setSelectedBookingIds([]);
      await syncAllData();
      setEmailLogs(getEmailLogs());
    } catch (e: any) {
      showToast(`Lỗi khi duyệt hàng loạt: ${e?.message || e}`);
    } finally {
      setIsBatchProcessing(false);
      setIsLoading(false);
    }
  };

  // Batch Reject selected bookings
  const handleBatchReject = async () => {
    if (selectedBookingIds.length === 0) return;
    const inputReason = prompt(
      `Nhập lý do từ chối chung cho ${selectedBookingIds.length} đơn đặt phòng đã chọn (có thể để trống):`
    );
    if (inputReason === null) return; // User cancelled prompt

    setIsBatchProcessing(true);
    setIsLoading(true);
    try {
      let successCount = 0;
      for (const id of selectedBookingIds) {
        const res = await apiUpdateStatus(id, 'Rejected', inputReason || undefined);
        if (res.success) successCount++;
      }
      showToast(`Đã từ chối ${successCount}/${selectedBookingIds.length} đơn đặt phòng!`);
      setSelectedBookingIds([]);
      await syncAllData();
      setEmailLogs(getEmailLogs());
    } catch (e: any) {
      showToast(`Lỗi khi từ chối hàng loạt: ${e?.message || e}`);
    } finally {
      setIsBatchProcessing(false);
      setIsLoading(false);
    }
  };

  // Batch Delete selected bookings
  const handleBatchDelete = async () => {
    if (selectedBookingIds.length === 0) return;
    if (
      !confirm(
        `CẢNH BÁO: Bạn có chắc chắn muốn XÓA VĨNH VIỄN ${selectedBookingIds.length} đơn đặt phòng đã chọn khỏi hệ thống CSDL? Thao tác này không thể hoàn tác!`
      )
    ) {
      return;
    }

    setIsBatchProcessing(true);
    setIsLoading(true);
    try {
      let successCount = 0;
      for (const id of selectedBookingIds) {
        const res = await apiDeleteBooking(id);
        if (res.success) successCount++;
      }
      showToast(`Đã xóa vĩnh viễn thành công ${successCount}/${selectedBookingIds.length} đơn đặt phòng!`);
      setSelectedBookingIds([]);
      await syncAllData();
    } catch (e: any) {
      showToast(`Lỗi khi xóa hàng loạt: ${e?.message || e}`);
    } finally {
      setIsBatchProcessing(false);
      setIsLoading(false);
    }
  };

  // Delete a single booking
  const handleDeleteSingleBooking = async (id: string) => {
    if (!confirm(`Bạn có chắc chắn muốn XÓA vĩnh viễn đơn đặt phòng [${id}] khỏi hệ thống CSDL?`)) {
      return;
    }
    setIsLoading(true);
    try {
      const res = await apiDeleteBooking(id);
      showToast(res.message);
      setSelectedBookingIds((prev) => prev.filter((item) => item !== id));
      await syncAllData();
    } catch (e: any) {
      showToast(`Lỗi khi xóa đơn: ${e?.message || e}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Helper kiểm tra đơn sinh tự động hàng loạt (Excel hoặc Lịch định kỳ) để ẩn ở tab Nhật ký đặt phòng
  const isBulkAutoBooking = (b: Booking) => {
    const bId = String(b.booking_id || (b as any).id || '').toUpperCase();
    return (
      bId.startsWith('BK_EXCEL_') ||
      bId.includes('BK_EXCEL_') ||
      bId.startsWith('BK_RECUR_') ||
      bId.includes('BK_RECUR_')
    );
  };

  // Export to CSV
  const exportToCSV = () => {
    const logBookings = bookings.filter((b) => !isBulkAutoBooking(b));

    if (logBookings.length === 0) {
      showToast("Không có dữ liệu để xuất!");
      return;
    }
    let csv = "\uFEFFMã đơn,Phòng học,Người đặt,Ngày đặt,Khung giờ,Mục đích,Ngày tạo,Trạng thái\n";
    logBookings.forEach((b) => {
      csv += [
        b.booking_id,
        `"${b.room_name || ''}"`,
        `"${b.fullname || ''}"`,
        b.date,
        `"${b.time_slot || ''}"`,
        `"${b.purpose || ''}"`,
        b.created_at,
        b.status,
      ].join(",") + "\n";
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const lnk = document.createElement("a");
    lnk.href = URL.createObjectURL(blob);
    lnk.setAttribute("download", "Booking_Export.csv");
    document.body.appendChild(lnk);
    lnk.click();
    document.body.removeChild(lnk);
  };

  // 1. Lọc theo từ khóa tìm kiếm và ngày (Ẩn các đơn upload từ file Excel BK_EXCEL_ và lịch định kỳ BK_RECUR_)
  const searchAndDateFilteredBookings = useMemo(() => {
    return bookings.filter((b) => {
      // Ẩn tất cả các đơn upload bằng file Excel (BK_EXCEL_) hoặc sinh từ lịch định kỳ (BK_RECUR_) khỏi tab Nhật ký đặt phòng
      if (isBulkAutoBooking(b)) {
        return false;
      }

      const s = searchKey.toLowerCase().trim();
      const matchesSearch =
        !s ||
        (b.room_name || '').toLowerCase().includes(s) ||
        (b.fullname || '').toLowerCase().includes(s) ||
        (b.borrower_name || '').toLowerCase().includes(s) ||
        (b.username || '').toLowerCase().includes(s) ||
        (b.purpose || '').toLowerCase().includes(s) ||
        (b.booking_id || '').toLowerCase().includes(s);
      const matchesDate = filterDate ? b.date === filterDate : true;
      return matchesSearch && matchesDate;
    });
  }, [bookings, searchKey, filterDate]);

  // 2. Tính số lượng cho từng Tab
  const pendingCount = useMemo(() => {
    return searchAndDateFilteredBookings.filter((b) => {
      const st = (b.status || '').toLowerCase();
      const isApproved = st === 'approved' || st.includes('duyệt') || st.includes('duyet');
      const isRejectedOrCancelled = st === 'rejected' || st === 'cancelled' || st.includes('từ chối') || st.includes('hủy');
      return !isApproved && !isRejectedOrCancelled;
    }).length;
  }, [searchAndDateFilteredBookings]);

  // Đếm tổng số đơn chưa duyệt để hiển thị số nhỏ (badge) ở sidebar (bỏ qua BK_EXCEL_ và BK_RECUR_)
  const pendingBookingsCount = useMemo(() => {
    return bookings.filter((b) => {
      if (isBulkAutoBooking(b)) {
        return false;
      }
      const st = (b.status || '').toLowerCase();
      const isApproved = st === 'approved' || st.includes('duyệt') || st.includes('duyet');
      const isRejectedOrCancelled = st === 'rejected' || st === 'cancelled' || st.includes('từ chối') || st.includes('hủy');
      return !isApproved && !isRejectedOrCancelled;
    }).length;
  }, [bookings]);

  const approvedCount = useMemo(() => {
    return searchAndDateFilteredBookings.filter((b) => {
      const st = (b.status || '').toLowerCase();
      return st === 'approved' || st.includes('duyệt') || st.includes('duyet');
    }).length;
  }, [searchAndDateFilteredBookings]);

  const totalBookingsCount = searchAndDateFilteredBookings.length;

  // 3. Danh sách đơn hiển thị theo Tab đã chọn (chưa duyệt / đã duyệt / tất cả)
  const filteredBookings = useMemo(() => {
    return searchAndDateFilteredBookings.filter((b) => {
      const st = (b.status || '').toLowerCase();
      const isApproved = st === 'approved' || st.includes('duyệt') || st.includes('duyet');
      const isRejectedOrCancelled = st === 'rejected' || st === 'cancelled' || st.includes('từ chối') || st.includes('hủy');

      if (bookingStatusTab === 'pending') {
        return !isApproved && !isRejectedOrCancelled;
      }
      if (bookingStatusTab === 'approved') {
        return isApproved;
      }
      return true; // 'all'
    });
  }, [searchAndDateFilteredBookings, bookingStatusTab]);

  const allFilteredBookingIds = filteredBookings.map((b) => b.booking_id);
  const isAllFilteredSelected =
    allFilteredBookingIds.length > 0 &&
    allFilteredBookingIds.every((id) => selectedBookingIds.includes(id));
  const isSomeFilteredSelected =
    allFilteredBookingIds.some((id) => selectedBookingIds.includes(id)) && !isAllFilteredSelected;

  const isAdminUser = Boolean(
    session &&
      ((session.role || '').toLowerCase() === 'admin' ||
        (session.role || '').toLowerCase() === 'superadmin' ||
        (session.username || '').toLowerCase() === 'admin' ||
        (session.username || '').toLowerCase() === 'superadmin')
  );



  const savedCfg = getSavedSupabaseConfig();

  const isSecurity = Boolean(
    session &&
      (session.role === 'security' ||
        session.role === 'bv' ||
        session.role === 'baove' ||
        (session.username || '').toLowerCase().startsWith('bv'))
  );

  return (
    <>
      {/* Loading Overlay */}
      <div
        id="loadingOverlay"
        className="loading-overlay"
        style={{ display: isLoading || isLoginLoading ? 'flex' : 'none' }}
      >
        <div className="spinner"></div>
      </div>

      {/* Toast Notification */}
      <div id="toast" className={`toast ${toastMessage ? 'show' : ''}`}>
        {toastMessage}
      </div>

      {/* Login Section */}
      {!session && (
        <div id="loginSection" className="login-container" style={{ display: 'flex' }}>
          <div className="login-card">
            <div className="logo">
              <i className="fa-solid fa-graduation-cap"></i>
            </div>
            <h2 style={{ fontWeight: 500, marginBottom: '6px' }}>
              HỆ THỐNG BOOK PHÒNG FSCCT
            </h2>

            <form id="loginForm" onSubmit={handleLogin}>
              <div className="input-group">
                <i className="fa-solid fa-user"></i>
                <input
                  type="text"
                  id="loginUser"
                  placeholder="Tên đăng nhập"
                  required
                  autoComplete="username"
                  value={loginUserVal}
                  onChange={(e) => setLoginUserVal(e.target.value)}
                />
              </div>
              <div className="input-group">
                <i className="fa-solid fa-lock"></i>
                <input
                  type="password"
                  id="loginPass"
                  placeholder="Mật khẩu"
                  required
                  autoComplete="current-password"
                  value={loginPassVal}
                  onChange={(e) => setLoginPassVal(e.target.value)}
                />
              </div>

              {loginError && (
                <div
                  id="loginError"
                  style={{
                    color: 'var(--danger)',
                    textAlign: 'left',
                    fontSize: '13px',
                    marginTop: '-10px',
                    marginBottom: '15px',
                    display: 'block',
                  }}
                >
                  {loginError}
                </div>
              )}

              <button
                type="submit"
                id="loginBtn"
                className="btn btn-primary"
                style={{ width: '100%', padding: '14px', justifyContent: 'center' }}
                disabled={isLoginLoading}
              >
                Đăng nhập
              </button>
            </form>

            {/* Mục cấu hình CSDL Supabase & File SQL đã được bảo mật, chỉ hiển thị sau khi đăng nhập tài khoản SuperAdmin */}

            <div
              style={{
                marginTop: '20px',
                fontSize: '11px',
                color: '#9aa0a6',
                letterSpacing: '1px',
              }}
            >
              PHÁT TRIỂN BỞI TRẦN HUY VŨ
            </div>
          </div>
        </div>
      )}

      {/* App Section for Security Guards (Mobile-Optimized for Phone Patrol) */}
      {session && isSecurity && (
        <SecurityBookingView
          bookings={bookings}
          rooms={rooms}
          session={session}
          onRefresh={() => syncAllData(false, true)}
          onLogout={handleLogout}
          onChangePassword={() => setIsChangePasswordModalOpen(true)}
          isLoading={isLoading}
        />
      )}

      {/* App Section for Admin and Teachers */}
      {session && !isSecurity && (
        <div id="appSection" style={{ display: 'flex', width: '100vw', height: '100vh' }}>
          {/* Mobile Backdrop */}
          <div
            className={`sidebar-backdrop ${isSidebarOpen ? 'active' : ''}`}
            onClick={() => setIsSidebarOpen(false)}
          />

          {/* Sidebar */}
          <div className={`sidebar ${isSidebarOpen ? 'open' : ''}`} id="sidebar">
            <div className="brand">
              <i className="fa-solid fa-graduation-cap"></i>
              <span>ĐẶT PHÒNG FSCCT</span>
            </div>
            <ul className="menu-list">

              <li
                className={`menu-item ${activeView === 'rooms' ? 'active' : ''}`}
                onClick={() => {
                  setActiveView('rooms');
                  setIsSidebarOpen(false);
                }}
              >
                <i className="fa-solid fa-door-closed"></i> Danh sách phòng học
              </li>
              <li
                className={`menu-item ${activeView === 'bookings' ? 'active' : ''}`}
                onClick={() => {
                  setActiveView('bookings');
                  setIsSidebarOpen(false);
                }}
              >
                <i className="fa-solid fa-list-check"></i>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  <span>Nhật ký đặt phòng</span>
                  {pendingBookingsCount > 0 && (
                    <span
                      style={{
                        backgroundColor: '#ef4444',
                        color: '#ffffff',
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '1px 6px',
                        borderRadius: '10px',
                        lineHeight: '1.3',
                        minWidth: '18px',
                        textAlign: 'center',
                        display: 'inline-block',
                        boxShadow: '0 1px 3px rgba(239, 68, 68, 0.35)',
                      }}
                      title={`${pendingBookingsCount} đơn chưa duyệt`}
                    >
                      {pendingBookingsCount > 99 ? '99+' : pendingBookingsCount}
                    </span>
                  )}
                </span>
              </li>
              {session.role === 'superadmin' && (
                <>
                  <li
                    className="menu-item"
                    style={{
                      background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.08) 0%, rgba(79, 70, 229, 0.08) 100%)',
                      color: '#6d28d9',
                      fontWeight: 600,
                      borderRadius: '8px',
                      margin: '6px 12px',
                      padding: '10px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      border: '1px dashed #c4b5fd',
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      setConfigTab('database');
                      setIsConfigModalOpen(true);
                      setIsSidebarOpen(false);
                    }}
                    title="Cấu hình Kết nối Supabase & Lấy File SQL DB (Quyền SuperAdmin cao nhất)"
                  >
                    <i className="fa-solid fa-crown" style={{ color: '#eab308' }}></i>
                    <i className="fa-solid fa-database" style={{ color: '#7c3aed' }}></i>
                    <span>Cấu hình CSDL & File SQL</span>
                  </li>
                  <li
                    className="menu-item"
                    style={{
                      background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.08) 0%, rgba(79, 70, 229, 0.08) 100%)',
                      color: '#6d28d9',
                      fontWeight: 600,
                      borderRadius: '8px',
                      margin: '6px 12px',
                      padding: '10px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      border: '1px dashed #c4b5fd',
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      setIsRecurringModalOpen(true);
                      setIsSidebarOpen(false);
                    }}
                    title="Thiết lập & khóa nhanh lịch học cố định theo tuần hoặc học kỳ từ Template"
                  >
                    <i className="fa-solid fa-repeat" style={{ color: '#7c3aed' }}></i>
                    <span>Lịch Định Kỳ (Template)</span>
                  </li>
                </>
              )}
            </ul>
            <div className="sidebar-footer">
              <div>
                Xin chào, <strong id="userLabel">{session.fullname}</strong>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  marginTop: '6px',
                }}
                id="roleLabel"
              >
                <span style={{ fontSize: '11px', color: '#a1a1a1', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  Quyền:{' '}
                  {session.role === 'superadmin' ? (
                    <span
                      style={{
                        background: 'linear-gradient(135deg, #7c3aed 0%, #4338ca 100%)',
                        color: '#ffffff',
                        padding: '2px 8px',
                        borderRadius: '6px',
                        fontWeight: 700,
                        fontSize: '11px',
                        letterSpacing: '0.5px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        boxShadow: '0 1px 3px rgba(124, 58, 237, 0.3)',
                      }}
                    >
                      <i className="fa-solid fa-crown" style={{ color: '#fde047', fontSize: '10px' }}></i>
                      SUPERADMIN
                    </span>
                  ) : (
                    <b style={{ color: session.role === 'admin' ? '#27ae60' : '#2980b9' }}>
                      {session.role.toUpperCase()}
                    </b>
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="main-content">
            {/* Top Bar */}
            <div className="top-bar">
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <i
                  className="fa-solid fa-bars menu-toggle"
                  onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                ></i>
                <h3 style={{ fontWeight: 500 }}>LIÊN HỆ VUTH21@FE.EDU.VN NẾU CẦN HỖ TRỢ</h3>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {session.role === 'superadmin' && (
                  <button
                    className="btn"
                    style={{
                      color: '#ffffff',
                      background: 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)',
                      fontSize: '13px',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '7px',
                      padding: '7px 14px',
                      borderRadius: '8px',
                      border: 'none',
                      boxShadow: '0 2px 8px rgba(124, 58, 237, 0.25)',
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      setConfigTab('database');
                      setIsConfigModalOpen(true);
                    }}
                    title="Cấu hình Kết nối Supabase & Lấy File SQL DB (Dành riêng cho SuperAdmin)"
                  >
                    <i className="fa-solid fa-crown" style={{ color: '#fde047' }}></i>
                    <i className="fa-solid fa-database"></i>
                    <span>Cấu hình CSDL & File SQL</span>
                  </button>
                )}
                <button
                  className="btn"
                  style={{
                    color: '#475569',
                    background: '#f1f5f9',
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                  }}
                  onClick={() => setIsChangePasswordModalOpen(true)}
                  title="Đổi mật khẩu tài khoản của bạn"
                >
                  <i className="fa-solid fa-key"></i> Đổi mật khẩu
                </button>
                <button
                  className="btn"
                  style={{ color: 'var(--danger)', background: 'none' }}
                  onClick={handleLogout}
                >
                  <i className="fa-solid fa-right-from-bracket"></i> Đăng xuất
                </button>
              </div>
            </div>



            {/* Rooms View */}
            <div
              id="roomsView"
              className={`view-container ${activeView === 'rooms' ? 'active' : ''}`}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '12px',
                  marginBottom: '18px',
                }}
              >
                {/* Tiêu đề Danh sách phòng & Thanh tìm kiếm ngang hàng */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', flex: '1 1 auto' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <h2 style={{ fontWeight: 600, margin: 0, fontSize: '20px', color: '#1e293b' }}>
                        Danh sách phòng học
                      </h2>
                      <span
                        style={{
                          fontSize: '12px',
                          fontWeight: 700,
                          background: roomSearchKey ? '#e0f2fe' : '#f1f5f9',
                          color: roomSearchKey ? '#0284c7' : '#64748b',
                          padding: '2px 8px',
                          borderRadius: '12px',
                        }}
                      >
                        {roomSearchKey ? `${filteredRooms.length}/${rooms.length}` : `${rooms.length} phòng`}
                      </span>
                    </div>
                  
                  </div>

                  {/* Thanh tìm phòng học đặt ngay ngang hàng */}
                  <div
                    style={{
                      position: 'relative',
                      width: '280px',
                      maxWidth: '100%',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <i
                      className="fa-solid fa-magnifying-glass"
                      style={{
                        position: 'absolute',
                        left: '12px',
                        color: 'var(--text-muted)',
                        fontSize: '13px',
                        pointerEvents: 'none',
                      }}
                    ></i>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="Tìm phòng (tên, mã, tầng, sức chứa)..."
                      value={roomSearchKey}
                      onChange={(e) => setRoomSearchKey(e.target.value)}
                      style={{
                        paddingLeft: '34px',
                        paddingRight: roomSearchKey ? '32px' : '10px',
                        height: '38px',
                        fontSize: '13.5px',
                        borderRadius: '8px',
                        border: '1px solid #cbd5e1',
                        background: '#ffffff',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                      }}
                    />
                    {roomSearchKey && (
                      <button
                        type="button"
                        onClick={() => setRoomSearchKey('')}
                        style={{
                          position: 'absolute',
                          right: '6px',
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                          padding: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '13px',
                        }}
                        title="Xóa tìm kiếm"
                      >
                        <i className="fa-solid fa-xmark"></i>
                      </button>
                    )}
                  </div>
                </div>

                {/* Các nút chuyển chế độ & thao tác */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {/* View Mode Switcher */}
                  <div
                    style={{
                      display: 'inline-flex',
                      background: '#e2e8f0',
                      padding: '3px',
                      borderRadius: '8px',
                      gap: '3px',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setRoomViewMode('cards')}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: 'none',
                        fontWeight: 600,
                        fontSize: '12.5px',
                        cursor: 'pointer',
                        background: roomViewMode === 'cards' ? '#ffffff' : 'transparent',
                        color: roomViewMode === 'cards' ? 'var(--primary)' : '#64748b',
                        boxShadow: roomViewMode === 'cards' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <i className="fa-solid fa-table-cells-large"></i>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRoomViewMode('grid')}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: 'none',
                        fontWeight: 600,
                        fontSize: '12.5px',
                        cursor: 'pointer',
                        background: roomViewMode === 'grid' ? 'var(--primary)' : 'transparent',
                        color: roomViewMode === 'grid' ? '#ffffff' : '#64748b',
                        boxShadow: roomViewMode === 'grid' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <i className="fa-solid fa-calendar-days"></i>
                    </button>
                  </div>

                  
                  <button
                    className="btn"
                    onClick={() => setIsExcelModalOpen(true)}
                    style={{ background: '#107c41', color: '#ffffff', display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 12px', fontSize: '13px' }}
                    title="Tải lên file thời khóa biểu dạng Excel"
                  >
                    <i className="fa-solid fa-file-excel"></i> Nhập lịch Excel
                  </button>

                  {(session?.role === 'admin' || session?.role === 'superadmin') && (
                    <button
                      className="btn"
                      onClick={() => setIsRecurringModalOpen(true)}
                      style={{
                        background: 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)',
                        color: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '7px 13px',
                        fontSize: '13px',
                        fontWeight: 600,
                        border: 'none',
                        boxShadow: '0 2px 6px rgba(124, 58, 237, 0.25)',
                        cursor: 'pointer',
                      }}
                      title="Thiết lập & sinh nhanh lịch học cố định theo tuần hoặc học kỳ từ Template mẫu"
                    >
                      <i className="fa-solid fa-repeat"></i> Lịch Cố Định (Template)
                    </button>
                  )}
                </div>
              </div>

              {/* GRID VIEW: Lưới trạng thái slot phòng học */}
              {roomViewMode === 'grid' ? (
                <div style={{ marginBottom: '30px' }}>
                  <ScheduleTimeline
                    rooms={rooms}
                    bookings={bookings}
                    selectedDate={timelineDate}
                    setSelectedDate={setTimelineDate}
                    searchQuery={roomSearchKey}
                    onSelectSlot={(roomId, date, slotTime) => {
                      const rm = rooms.find((x) => x.room_id === roomId);
                      openBookingModal(roomId, rm?.room_name || roomId, date, [slotTime]);
                    }}
                  />
                </div>
              ) : (
                /* CARD VIEW: Dạng thẻ phòng học truyền thống */
                <div>

                  {filteredRooms.length === 0 ? (
                    <div
                      style={{
                        background: '#ffffff',
                        border: '1px dashed var(--border-color)',
                        borderRadius: '8px',
                        padding: '48px 24px',
                        textAlign: 'center',
                        color: 'var(--text-muted)',
                        margin: '10px 0 30px',
                      }}
                    >
                      <i
                        className="fa-solid fa-magnifying-glass"
                        style={{ fontSize: '38px', color: '#cbd5e1', marginBottom: '14px', display: 'block' }}
                      ></i>
                      <h4 style={{ margin: '0 0 6px 0', color: '#333', fontSize: '16px', fontWeight: 600 }}>
                        Không tìm thấy phòng nào phù hợp
                      </h4>
                      <p style={{ fontSize: '14px', margin: '0 0 16px 0', color: '#64748b' }}>
                        Không có phòng nào khớp với từ khóa "<b>{roomSearchKey}</b>".
                      </p>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => setRoomSearchKey('')}
                        style={{ margin: '0 auto' }}
                      >
                        <i className="fa-solid fa-rotate-left"></i> Xem tất cả phòng
                      </button>
                    </div>
                  ) : (
                    <div className="rooms-grid" id="roomsGrid">
                      {filteredRooms.map((r) => (
                        <div
                          key={r.room_id}
                          className="room-card"
                          style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}
                        >
                          <div>
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'flex-start',
                                marginBottom: '8px',
                              }}
                            >
                              <div style={{ fontSize: '18px', fontWeight: 500 }}>
                                <i
                                  className="fa-solid fa-door-open"
                                  style={{ color: 'var(--primary)', marginRight: '8px' }}
                                ></i>
                                {r.room_name}
                              </div>
                              <span
                                className="badge"
                                style={{
                                  fontSize: '11px',
                                  background: r.status === 'Inactive' ? '#fce8e6' : r.status === 'Maintenance' ? '#fef7e0' : '#e6f4ea',
                                  color: r.status === 'Inactive' ? '#c5221f' : r.status === 'Maintenance' ? '#b06000' : '#137333',
                                  padding: '3px 8px',
                                  borderRadius: '12px',
                                }}
                              >
                                {r.status || 'Active'}
                              </span>
                            </div>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                fontSize: '14px',
                                color: 'var(--text-muted)',
                                marginBottom: '4px',
                                flexWrap: 'wrap',
                              }}
                            >
                              {normalizeRoomType(r.room_type, r.room_name, r.room_id) === 'chuc_nang' ? (
                                <span
                                  style={{
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    backgroundColor: '#f3e8ff',
                                    color: '#7e22ce',
                                    border: '1px solid #d8b4fe',
                                    padding: '2px 8px',
                                    borderRadius: '8px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                  }}
                                  title="Phòng chức năng"
                                >
                                  <i className="fa-solid fa-laptop-code" style={{ fontSize: '10px' }}></i> Chức năng
                                </span>
                              ) : (
                                <span
                                  style={{
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    backgroundColor: '#eff6ff',
                                    color: '#1d4ed8',
                                    border: '1px solid #bfdbfe',
                                    padding: '2px 8px',
                                    borderRadius: '8px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                  }}
                                  title="Phòng chính khóa"
                                >
                                  <i className="fa-solid fa-chalkboard-user" style={{ fontSize: '10px' }}></i> Chính khóa
                                </span>
                              )}
                            </div>
                            {(r.floor || r.building) && (
                              <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                                <i className="fa-solid fa-building" style={{ marginRight: '6px' }}></i>
                                {[r.building, r.floor].filter(Boolean).join(' - ')}
                              </div>
                            )}
                            {r.description && (
                              <div style={{ fontSize: '12px', color: '#666', marginTop: '6px', fontStyle: 'italic' }}>
                                {r.description}
                              </div>
                            )}
                          </div>

                          <div style={{ display: 'flex', gap: '8px', marginTop: '15px' }}>
                            <button
                              className="btn btn-primary"
                              style={{ flex: 1, justifyContent: 'center' }}
                              onClick={() => openBookingModal(r.room_id, r.room_name)}
                            >
                              <i className="fa-solid fa-calendar-plus"></i> Đặt phòng
                            </button>
                            <button
                              className="btn"
                              style={{ background: '#f1f5f9', color: '#475569', fontSize: '12px', padding: '6px 12px' }}
                              onClick={() => setRoomViewMode('grid')}
                              title="Xem lưới lịch ma trận phòng này"
                            >
                              <i className="fa-solid fa-calendar-days"></i>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Bookings View */}
            <div
              id="bookingsView"
              className={`view-container ${activeView === 'bookings' ? 'active' : ''}`}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  marginBottom: '15px',
                  gap: '15px',
                }}
              >
                <h2 style={{ fontWeight: 500 }}>Nhật ký đặt phòng</h2>
                <button className="btn btn-success" onClick={exportToCSV}>
                  <i className="fa-solid fa-file-arrow-down"></i> Xuất dữ liệu CSV
                </button>
              </div>

              {/* Tabs chuyển đổi phân loại: Chưa duyệt vs Đã duyệt */}
              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  marginBottom: '16px',
                  borderBottom: '1px solid #e2e8f0',
                  paddingBottom: '12px',
                  flexWrap: 'wrap',
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setBookingStatusTab('pending');
                    setSelectedBookingIds([]);
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 18px',
                    borderRadius: '10px',
                    fontWeight: 600,
                    fontSize: '13.5px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    border: bookingStatusTab === 'pending' ? '1.5px solid #f59e0b' : '1px solid #e2e8f0',
                    background: bookingStatusTab === 'pending' ? '#fffbeb' : '#ffffff',
                    color: bookingStatusTab === 'pending' ? '#b45309' : '#64748b',
                    boxShadow: bookingStatusTab === 'pending' ? '0 2px 6px rgba(245, 158, 11, 0.15)' : 'none',
                  }}
                >
                  <i className="fa-regular fa-clock" style={{ color: bookingStatusTab === 'pending' ? '#f59e0b' : '#94a3b8' }}></i>
                  <span>Đơn chưa duyệt</span>
                  <span
                    style={{
                      backgroundColor: bookingStatusTab === 'pending' ? '#f59e0b' : '#f1f5f9',
                      color: bookingStatusTab === 'pending' ? '#ffffff' : '#64748b',
                      fontSize: '11.5px',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: '10px',
                    }}
                  >
                    {pendingCount}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setBookingStatusTab('approved');
                    setSelectedBookingIds([]);
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 18px',
                    borderRadius: '10px',
                    fontWeight: 600,
                    fontSize: '13.5px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    border: bookingStatusTab === 'approved' ? '1.5px solid #10b981' : '1px solid #e2e8f0',
                    background: bookingStatusTab === 'approved' ? '#ecfdf5' : '#ffffff',
                    color: bookingStatusTab === 'approved' ? '#047857' : '#64748b',
                    boxShadow: bookingStatusTab === 'approved' ? '0 2px 6px rgba(16, 185, 129, 0.15)' : 'none',
                  }}
                >
                  <i className="fa-solid fa-circle-check" style={{ color: bookingStatusTab === 'approved' ? '#10b981' : '#94a3b8' }}></i>
                  <span>Đơn đã duyệt</span>
                  <span
                    style={{
                      backgroundColor: bookingStatusTab === 'approved' ? '#10b981' : '#f1f5f9',
                      color: bookingStatusTab === 'approved' ? '#ffffff' : '#64748b',
                      fontSize: '11.5px',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: '10px',
                    }}
                  >
                    {approvedCount}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setBookingStatusTab('all');
                    setSelectedBookingIds([]);
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 14px',
                    borderRadius: '10px',
                    fontWeight: 500,
                    fontSize: '13px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    border: bookingStatusTab === 'all' ? '1.5px solid #3b82f6' : '1px solid #e2e8f0',
                    background: bookingStatusTab === 'all' ? '#eff6ff' : '#ffffff',
                    color: bookingStatusTab === 'all' ? '#1d4ed8' : '#64748b',
                    boxShadow: bookingStatusTab === 'all' ? '0 2px 6px rgba(59, 130, 246, 0.12)' : 'none',
                  }}
                >
                  <i className="fa-solid fa-list-ul" style={{ color: bookingStatusTab === 'all' ? '#3b82f6' : '#94a3b8' }}></i>
                  <span>Tất cả</span>
                  <span
                    style={{
                      backgroundColor: bookingStatusTab === 'all' ? '#3b82f6' : '#f1f5f9',
                      color: bookingStatusTab === 'all' ? '#ffffff' : '#64748b',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: '10px',
                    }}
                  >
                    {totalBookingsCount}
                  </span>
                </button>
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: '15px',
                  marginBottom: '15px',
                  flexWrap: 'wrap',
                }}
              >
                <input
                  type="text"
                  id="searchKey"
                  className="form-control"
                  style={{ width: '250px' }}
                  placeholder="Tìm phòng, người đặt, mã..."
                  value={searchKey}
                  onChange={(e) => setSearchKey(e.target.value)}
                />
                <input
                  type="date"
                  id="filterDate"
                  className="form-control"
                  style={{ width: '180px' }}
                  value={filterDate}
                  onChange={(e) => setFilterDate(e.target.value)}
                />
                <button className="btn btn-primary" onClick={() => syncAllData(false, true)}>
                  <i className="fa-solid fa-rotate"></i> Tải lại dữ liệu
                </button>
              </div>

              {/* Batch Actions Toolbar when tickets are selected */}
              {selectedBookingIds.length > 0 ? (
                <div
                  style={{
                    background: 'linear-gradient(135deg, #eff6ff 0%, #e0f2fe 100%)',
                    border: '1px solid #93c5fd',
                    borderRadius: '12px',
                    padding: '12px 18px',
                    marginBottom: '15px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '12px',
                    boxShadow: '0 2px 8px rgba(37, 99, 235, 0.08)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div
                      style={{
                        background: '#2563eb',
                        color: '#fff',
                        minWidth: '32px',
                        height: '32px',
                        padding: '0 8px',
                        borderRadius: '16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 'bold',
                        fontSize: '13px',
                      }}
                    >
                      {selectedBookingIds.length}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, color: '#1e3a8a', fontSize: '14px' }}>
                        Đã tích chọn {selectedBookingIds.length} đơn đặt phòng
                      </div>
                      <div style={{ fontSize: '12px', color: '#2563eb' }}>
                        Thực hiện duyệt hoặc xóa nhanh hàng loạt:
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {isAdminUser && (
                      <button
                        className="btn btn-success"
                        onClick={handleBatchApprove}
                        disabled={isBatchProcessing}
                        style={{
                          padding: '7px 15px',
                          fontWeight: 600,
                          fontSize: '13px',
                          borderRadius: '8px',
                          boxShadow: '0 2px 4px rgba(30, 142, 62, 0.2)',
                          cursor: 'pointer',
                        }}
                        title="Duyệt đồng loạt tất cả các đơn đã tích chọn"
                      >
                        <i className="fa-solid fa-circle-check"></i> Duyệt hàng loạt ({selectedBookingIds.length})
                      </button>
                    )}

                    {isAdminUser && (
                      <button
                        className="btn btn-warning"
                        onClick={handleBatchReject}
                        disabled={isBatchProcessing}
                        style={{
                          background: '#d97706',
                          color: '#fff',
                          border: 'none',
                          padding: '7px 15px',
                          fontWeight: 600,
                          fontSize: '13px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                        }}
                        title="Từ chối đồng loạt các đơn đã tích chọn"
                      >
                        <i className="fa-solid fa-circle-xmark"></i> Từ chối ({selectedBookingIds.length})
                      </button>
                    )}

                    <button
                      className="btn btn-danger"
                      onClick={handleBatchDelete}
                      disabled={isBatchProcessing}
                      style={{
                        padding: '7px 15px',
                        fontWeight: 600,
                        fontSize: '13px',
                        borderRadius: '8px',
                        boxShadow: '0 2px 4px rgba(217, 48, 37, 0.2)',
                        cursor: 'pointer',
                      }}
                      title="Xóa vĩnh viễn các đơn đã tích chọn khỏi CSDL"
                    >
                      <i className="fa-solid fa-trash-can"></i> Xóa hàng loạt ({selectedBookingIds.length})
                    </button>

                    <button
                      onClick={() => setSelectedBookingIds([])}
                      disabled={isBatchProcessing}
                      style={{
                        background: '#fff',
                        color: '#475569',
                        border: '1px solid #cbd5e1',
                        padding: '7px 12px',
                        borderRadius: '8px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        fontSize: '13px',
                      }}
                      title="Bỏ tích chọn tất cả đơn"
                    >
                      <i className="fa-solid fa-xmark"></i> Bỏ chọn
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '9px 15px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    marginBottom: '15px',
                    fontSize: '13px',
                    color: '#64748b',
                    flexWrap: 'wrap',
                    gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <i className="fa-solid fa-square-check" style={{ color: '#2563eb' }}></i>
                    <span>
                      Tích chọn ô vuông ở đầu mỗi đơn hoặc ô <b>Chọn tất cả</b> ở tiêu đề bảng để <b>Duyệt</b> hoặc <b>Xóa</b> nhanh hàng loạt.
                    </span>
                  </div>
                  {filteredBookings.length > 0 && (
                    <button
                      onClick={handleToggleSelectAll}
                      style={{
                        background: 'transparent',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        padding: '4px 10px',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#2563eb',
                        cursor: 'pointer',
                      }}
                    >
                      <i className="fa-solid fa-check-double"></i> Chọn tất cả ({filteredBookings.length} đơn)
                    </button>
                  )}
                </div>
              )}

              <div className="table-responsive">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: '46px', textAlign: 'center', padding: '12px 8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <input
                            type="checkbox"
                            style={{
                              width: '18px',
                              height: '18px',
                              cursor: 'pointer',
                              accentColor: '#1a73e8',
                            }}
                            title="Chọn tất cả / Bỏ chọn tất cả đơn đang hiển thị"
                            checked={isAllFilteredSelected}
                            ref={(el) => {
                              if (el) el.indeterminate = isSomeFilteredSelected;
                            }}
                            onChange={handleToggleSelectAll}
                          />
                        </div>
                      </th>
                      
                      <th>Phòng Học</th>
                      <th>Người Mượn</th>
                      <th>Người Đặt</th>
                      <th>Ngày Đặt</th>
                      <th>Khung Giờ</th>
                      <th>Mục Đích</th>
                      <th>Ngày Tạo</th>
                      <th>Trạng Thái</th>
                      <th>Thao Tác</th>
                    </tr>
                  </thead>
                  <tbody id="bookingTableBody">
                    {filteredBookings.length === 0 ? (
                      <tr>
                        <td colSpan={11} style={{ textAlign: 'center', padding: '40px 16px', color: '#64748b' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                            <i
                              className={
                                bookingStatusTab === 'pending'
                                  ? 'fa-regular fa-clock'
                                  : bookingStatusTab === 'approved'
                                  ? 'fa-regular fa-circle-check'
                                  : 'fa-regular fa-folder-open'
                              }
                              style={{
                                fontSize: '32px',
                                color:
                                  bookingStatusTab === 'pending'
                                    ? '#f59e0b'
                                    : bookingStatusTab === 'approved'
                                    ? '#10b981'
                                    : '#94a3b8',
                              }}
                            ></i>
                            <div style={{ fontSize: '15px', fontWeight: 600, color: '#334155' }}>
                              {bookingStatusTab === 'pending'
                                ? 'Hiện không có đơn nào đang chờ duyệt!'
                                : bookingStatusTab === 'approved'
                                ? 'Chưa có đơn đặt phòng nào được duyệt!'
                                : 'Không tìm thấy đơn đặt phòng nào.'}
                            </div>
                            <div style={{ fontSize: '13px', color: '#94a3b8' }}>
                              {searchKey || filterDate
                                ? 'Thử xóa từ khóa tìm kiếm hoặc chọn ngày khác.'
                                : bookingStatusTab === 'pending'
                                ? 'Tất cả các đơn đặt phòng mới sẽ xuất hiện tại đây để BQT phê duyệt.'
                                : 'Các đơn sau khi được duyệt sẽ hiển thị tại danh sách này.'}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredBookings.map((b) => {
                        const isSelected = selectedBookingIds.includes(b.booking_id);
                        const statusLower = (b.status || '').toLowerCase();
                        const isApproved = statusLower === 'approved' || statusLower.includes('duyệt') || statusLower.includes('duyet');
                        const isRejected = statusLower === 'rejected' || statusLower.includes('từ chối') || statusLower.includes('tu choi');
                        const isCancelled = statusLower === 'cancelled' || statusLower.includes('hủy') || statusLower.includes('huy');

                        const isAdmin =
                          (session.role || '').toLowerCase() === 'admin' ||
                          (session.role || '').toLowerCase() === 'superadmin' ||
                          (session.username || '').toLowerCase() === 'admin' ||
                          (session.username || '').toLowerCase() === 'superadmin';
                        const isOwner =
                          Boolean(session.username && b.username && session.username.toLowerCase() === b.username.toLowerCase());

                        const displaySlots = (b.time_slot || '')
                          .split(', ')
                          .map((s, idx) => (
                            <span
                              key={idx}
                              style={{
                                background: '#e8f0fe',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '12px',
                                display: 'inline-block',
                                margin: '2px 0',
                              }}
                            >
                              {s}
                            </span>
                          ));

                        return (
                          <tr
                            key={b.booking_id}
                            style={{
                              backgroundColor: isSelected ? '#eff6ff' : undefined,
                              transition: 'background-color 0.15s ease',
                            }}
                          >
                            <td style={{ textAlign: 'center', width: '46px', padding: '12px 8px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <input
                                  type="checkbox"
                                  style={{
                                    width: '18px',
                                    height: '18px',
                                    cursor: 'pointer',
                                    accentColor: '#1a73e8',
                                  }}
                                  title={`Tích chọn đơn ${b.booking_id}`}
                                  checked={isSelected}
                                  onChange={() => handleToggleSelectBooking(b.booking_id)}
                                />
                              </div>
                            </td>
                            
                            <td>
                              <div style={{ fontWeight: 600 }}>{b.room_name}</div>
                              <div style={{ marginTop: '2px' }}>
                                {(() => {
                                  const matchedRoom = rooms.find(r => r.room_id === b.room_id || r.room_name === b.room_name);
                                  const bType = normalizeRoomType(b.room_type || matchedRoom?.room_type, b.room_name, b.room_id);
                                  return bType === 'chuc_nang' ? (
                                    <span style={{ fontSize: '10.5px', background: '#f3e8ff', color: '#7e22ce', border: '1px solid #d8b4fe', padding: '1px 6px', borderRadius: '4px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                      <i className="fa-solid fa-laptop-code" style={{ fontSize: '9px' }}></i> Chức năng
                                    </span>
                                  ) : (
                                    <span style={{ fontSize: '10.5px', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '1px 6px', borderRadius: '4px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                      <i className="fa-solid fa-chalkboard-user" style={{ fontSize: '9px' }}></i> Chính khóa
                                    </span>
                                  );
                                })()}
                              </div>
                            </td>
                            <td>
                              <strong style={{ color: '#1d4ed8' }}>{b.borrower_name || b.fullname}</strong>
                            </td>
                            <td>
                              <div style={{ fontWeight: 500 }}>{b.fullname}</div>
                              <small style={{ color: 'var(--text-muted)' }}>@{b.username}</small>
                            </td>
                            <td>{b.date}</td>
                            <td>{displaySlots}</td>
                            <td>{b.purpose}</td>
                            <td>
                              {b.created_at
                                ? new Date(b.created_at).toLocaleString('vi-VN')
                                : ''}
                            </td>
                            <td>
                              <span
                                className={`badge badge-${isApproved ? 'approved' : isRejected ? 'rejected' : isCancelled ? 'cancelled' : 'pending'}`}
                              >
                                {b.status}
                              </span>
                              {b.reject_reason && (
                                <div
                                  style={{
                                    fontSize: '11px',
                                    color: isCancelled ? '#b45309' : '#dc2626',
                                    marginTop: '4px',
                                    maxWidth: '170px',
                                    lineHeight: '1.3',
                                    wordBreak: 'break-word',
                                  }}
                                  title={`Lý do: ${b.reject_reason}`}
                                >
                                  <i className="fa-solid fa-circle-info" style={{ marginRight: '3px' }}></i>
                                  {b.reject_reason}
                                </div>
                              )}
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center' }}>
                                {isAdmin && !isApproved && (
                                  <button
                                    className="btn btn-success btn-sm"
                                    onClick={() =>
                                      handleChangeStatus(b.booking_id, 'Approved')
                                    }
                                    title="Duyệt đơn đặt phòng"
                                  >
                                    <i className="fa-solid fa-check"></i> Duyệt
                                  </button>
                                )}
                                {isAdmin && !isRejected && (
                                  <button
                                    className="btn btn-danger btn-sm"
                                    onClick={() =>
                                      handleChangeStatus(b.booking_id, 'Rejected')
                                    }
                                    title="Từ chối đơn đặt phòng"
                                  >
                                    <i className="fa-solid fa-xmark"></i> Từ chối
                                  </button>
                                )}
                                {(isOwner || isAdmin) && !isCancelled && (
                                  <button
                                    className="btn btn-warning btn-sm"
                                    style={{ background: '#f39c12', color: '#fff', border: 'none' }}
                                    onClick={() => handleOpenCancelModal(b)}
                                    title="Hủy đơn đặt phòng"
                                  >
                                    <i className="fa-solid fa-ban"></i> Hủy
                                  </button>
                                )}
                               
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Multi-Room Booking Cart Modal (Phương án 2) */}
      <div className={`modal-backdrop ${isModalOpen ? 'open' : ''}`} id="bookingModal">
        <div className="modal-box" style={{ maxWidth: '820px', width: '96%', borderRadius: '16px' }}>
          <div
            className="modal-header"
            style={{
              padding: '16px 24px',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#f8fafc',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#ffffff',
                  fontSize: '18px',
                  boxShadow: '0 2px 6px rgba(37, 99, 235, 0.25)',
                }}
              >
                <i className="fa-solid fa-calendar-check"></i>
              </div>
              <div>
                <h3 style={{ margin: 0, fontWeight: 700, fontSize: '16px', color: '#0f172a' }}>
                  ĐẶT PHÒNG
                </h3>
                
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span
                style={{
                  background: '#eff6ff',
                  color: '#1d4ed8',
                  border: '1px solid #bfdbfe',
                  fontWeight: 600,
                  padding: '4px 10px',
                  borderRadius: '20px',
                  fontSize: '12px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                <i className="fa-solid fa-layer-group"></i>
                {cartRooms.length} phòng ({cartRooms.reduce((sum, r) => sum + r.selectedSlots.length, 0)} slot)
              </span>
              <i
                className="fa-solid fa-xmark"
                style={{ cursor: 'pointer', fontSize: '18px', color: '#64748b', padding: '4px' }}
                onClick={closeBookingModal}
              ></i>
            </div>
          </div>

          <form id="bookingForm" onSubmit={handleSubmitBooking}>
            <div style={{ padding: '20px', maxHeight: '72vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
              {/* KHỐI 1: THÔNG TIN CHUNG CỦA ĐỢT MƯỢN */}
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '16px',
                  marginBottom: '18px',
                }}
              >
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                  
                  {(session?.role === 'admin' || session?.role === 'superadmin') && (
                    <span style={{ background: '#dcfce7', color: '#15803d', border: '1px solid #86efac', borderRadius: '12px', padding: '2px 8px', fontSize: '11px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <i className="fa-solid fa-circle-check"></i> Quyền Quản Trị: Tự Động Duyệt Ngay
                    </span>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px', marginBottom: '12px' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px', fontSize: '13px', fontWeight: 600 }}>
                      <span>
                        <i className="fa-solid fa-user-tag" style={{ marginRight: '5px', color: 'var(--primary)' }}></i>
                        Người sử dụng <span style={{ color: 'var(--danger)' }}>*</span>
                      </span>
                     
                    </label>
                    <input
                      type="text"
                      className="form-control"
                      required
                      placeholder="VD: Thầy Nguyễn Văn A - 0912345678..."
                      value={bookBorrowerName}
                      onChange={(e) => setBookBorrowerName(e.target.value)}
                      style={{ fontSize: '13.5px' }}
                    />
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ marginBottom: '5px', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <i className="fa-solid fa-calendar-day" style={{ color: 'var(--primary)' }}></i>
                      Ngày sử dụng <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <input
                      type="date"
                      className="form-control"
                      required
                      min={todayStr}
                      value={bookDate}
                      onChange={(e) => handleDateChange(e.target.value)}
                      style={{ fontSize: '13.5px' }}
                    />
                  </div>
                </div>

                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ marginBottom: '5px', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <i className="fa-solid fa-pen-to-square" style={{ color: 'var(--primary)' }}></i>
                    Mục đích sử dụng/Ghi chú <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <textarea
                    className="form-control"
                    rows={2}
                    placeholder="Nhập Mục đích/Ghi chú"
                    required
                    value={bookPurpose}
                    onChange={(e) => setBookPurpose(e.target.value)}
                    style={{ fontSize: '13.5px', resize: 'vertical' }}
                  ></textarea>
                </div>

                {/* TÙY CHỌN THIẾT BỊ HỘI TRƯỜNG (.Bhoitruong) */}
                {hasHallRoomInCart && (
                  <div
                    style={{
                      marginTop: '14px',
                      background: '#f0fdf4',
                      border: '1.5px solid #86efac',
                      borderRadius: '10px',
                      padding: '12px 14px',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: 700,
                        color: '#166534',
                        marginBottom: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <i className="fa-solid fa-microphone-lines" style={{ color: '#16a34a' }}></i>
                      Có sử dụng:
                    </div>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '13px',
                          fontWeight: 600,
                          color: '#1e293b',
                          cursor: 'pointer',
                          userSelect: 'none',
                          background: '#ffffff',
                          padding: '6px 12px',
                          borderRadius: '8px',
                          border: '1px solid #bbf7d0',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={hallEquipment.led}
                          onChange={() => handleToggleHallEquipment('led')}
                          style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#16a34a' }}
                        />
                        <span>📺 Led</span>
                      </label>

                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '13px',
                          fontWeight: 600,
                          color: '#1e293b',
                          cursor: 'pointer',
                          userSelect: 'none',
                          background: '#ffffff',
                          padding: '6px 12px',
                          borderRadius: '8px',
                          border: '1px solid #bbf7d0',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={hallEquipment.mayLanh}
                          onChange={() => handleToggleHallEquipment('mayLanh')}
                          style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#16a34a' }}
                        />
                        <span>❄️ Máy lạnh</span>
                      </label>

                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '13px',
                          fontWeight: 600,
                          color: '#1e293b',
                          cursor: 'pointer',
                          userSelect: 'none',
                          background: '#ffffff',
                          padding: '6px 12px',
                          borderRadius: '8px',
                          border: '1px solid #bbf7d0',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={hallEquipment.diDoiBanGhe}
                          onChange={() => handleToggleHallEquipment('diDoiBanGhe')}
                          style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#16a34a' }}
                        />
                        <span>🪑 Di dời bàn ghế</span>
                      </label>
                    </div>
                    
                  </div>
                )}
              </div>

              {/* KHỐI 2: DANH SÁCH CÁC PHÒNG & KHUNG GIỜ (GIỎ ĐẶT PHÒNG) */}
              <div style={{ marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: '#334155', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <i className="fa-solid fa-door-open" style={{ color: 'var(--primary)' }}></i>
                     Danh sách phòng:
                  </span>
                 
                </div>

                {cartRooms.map((cartItem, index) => {
                  return (
                    <div
                      key={cartItem.cartItemId}
                      style={{
                        background: '#ffffff',
                        border: '1.5px solid #cbd5e1',
                        borderRadius: '12px',
                        padding: '14px 16px',
                        marginBottom: '12px',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      {/* Room Header inside Card */}
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          paddingBottom: '10px',
                          borderBottom: '1px solid #e2e8f0',
                          marginBottom: '12px',
                          flexWrap: 'wrap',
                          gap: '8px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: '220px' }}>
                          <span
                            style={{
                              background: '#2563eb',
                              color: '#ffffff',
                              width: '24px',
                              height: '24px',
                              borderRadius: '50%',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '12px',
                              fontWeight: 700,
                            }}
                          >
                            {index + 1}
                          </span>

                          <div style={{ flex: 1, maxWidth: '340px' }}>
                            <select
                              className="form-control"
                              value={cartItem.roomId}
                              onChange={(e) => handleChangeRoomInCart(cartItem.cartItemId, e.target.value)}
                              style={{
                                fontWeight: 700,
                                fontSize: '13.5px',
                                color: '#1e293b',
                                padding: '6px 10px',
                                background: '#f8fafc',
                                border: '1px solid #cbd5e1',
                              }}
                            >
                              {rooms
                                .filter((r) => r.status !== 'Inactive' && r.status !== 'Maintenance')
                                .map((r) => (
                                  <option key={r.room_id} value={r.room_id}>
                                    {r.room_name} - Sức chứa: {r.capacity || 40}
                                  </option>
                                ))}
                            </select>
                          </div>

                          {cartItem.isCheckingSlots && (
                            <i className="fa-solid fa-spinner fa-spin" style={{ color: 'var(--primary)', fontSize: '13px' }}></i>
                          )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            style={{
                              fontSize: '12px',
                              padding: '3px 8px',
                              borderRadius: '6px',
                              fontWeight: 600,
                              background: cartItem.selectedSlots.length > 0 ? '#dcfce7' : '#f1f5f9',
                              color: cartItem.selectedSlots.length > 0 ? '#15803d' : '#64748b',
                            }}
                          >
                            {cartItem.selectedSlots.length > 0
                              ? `Đã chọn: ${cartItem.selectedSlots.length} slot`
                              : 'Chưa chọn slot'}
                          </span>

                          {cartRooms.length > 1 && (
                            <button
                              type="button"
                              className="btn btn-sm"
                              style={{
                                color: '#dc2626',
                                background: '#fee2e2',
                                border: '1px solid #fecaca',
                                borderRadius: '6px',
                                padding: '4px 8px',
                                fontSize: '11px',
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                cursor: 'pointer',
                              }}
                              onClick={() => handleRemoveRoomFromCart(cartItem.cartItemId)}
                              title="Xóa phòng này khỏi danh sách mượn"
                            >
                              <i className="fa-solid fa-trash-can"></i> Xóa phòng
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Slots Checkbox Grid for this Room */}
                      <div className="slots-checkbox-container" style={{ maxHeight: '160px', overflowY: 'auto' }}>
                        {!bookDate ? (
                          <div style={{ color: '#64748b', fontSize: '12px', padding: '10px', textAlign: 'center' }}>
                            -- Vui lòng chọn Ngày sử dụng ở trên để xem khung giờ rảnh của phòng này --
                          </div>
                        ) : cartItem.isCheckingSlots ? (
                          <div style={{ color: '#64748b', fontSize: '12px', padding: '10px', textAlign: 'center' }}>
                            <i className="fa-solid fa-spinner fa-spin" style={{ marginRight: '6px' }}></i>
                            Đang kiểm tra lịch trống của phòng {cartItem.roomName}...
                          </div>
                        ) : (
                          DEFAULT_SLOTS.map((slotFullText) => {
                            const slotValue = slotFullText.split(' (')[0].trim();
                            const isBusy = isSlotOccupiedByAny(slotFullText, cartItem.busySlots);
                            const isPast = isSlotInPast(bookDate, slotValue);
                            const isChecked = cartItem.selectedSlots.includes(slotValue);
                            const isDisabled = isBusy || isPast;

                            return (
                              <label
                                key={slotFullText}
                                className={`slot-checkbox-item ${isDisabled ? 'disabled' : ''}`}
                                style={{
                                  display: 'flex',
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  gap: '10px',
                                  cursor: isDisabled ? 'not-allowed' : 'pointer',
                                  backgroundColor: isChecked ? '#eff6ff' : isPast ? '#f8f9fa' : undefined,
                                  border: isChecked ? '1px solid #93c5fd' : undefined,
                                  borderRadius: '6px',
                                  opacity: isPast ? 0.6 : 1,
                                  padding: '6px 8px',
                                  width: '100%',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  value={slotValue}
                                  disabled={isDisabled}
                                  checked={isChecked}
                                  onChange={() => handleCartSlotToggle(cartItem.cartItemId, slotValue)}
                                  style={{
                                    margin: 0,
                                    cursor: isDisabled ? 'not-allowed' : 'pointer',
                                    flexShrink: 0,
                                    width: '16px',
                                    height: '16px',
                                  }}
                                />
                                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '8px', flex: 1, minWidth: 0 }}>
                                  <span style={{ fontSize: '13px', color: '#1e293b', whiteSpace: 'nowrap', fontWeight: isChecked ? 600 : 'normal' }}>
                                    {slotFullText}
                                  </span>
                                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                                    {isPast && (
                                      <strong style={{ color: '#5f6368', background: '#e8eaed', padding: '1px 6px', borderRadius: '4px', fontSize: '10.5px', fontWeight: 600 }}>
                                        [ĐÃ QUA GIỜ]
                                      </strong>
                                    )}
                                    {isBusy && (
                                      <strong style={{ color: '#dc2626', background: '#fee2e2', padding: '1px 6px', borderRadius: '4px', fontSize: '10.5px', fontWeight: 600 }}>
                                        [ĐÃ CÓ NGƯỜI ĐẶT]
                                      </strong>
                                    )}
                                  </span>
                                </span>
                              </label>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* NÚT THÊM PHÒNG KHÁC VÀO ĐỢT MƯỢN NÀY */}
                <button
                  type="button"
                  className="btn"
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: '10px',
                    border: '2px dashed #3b82f6',
                    background: '#eff6ff',
                    color: '#1d4ed8',
                    fontWeight: 700,
                    fontSize: '13.5px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onClick={handleAddRoomToCart}
                >
                  <i className="fa-solid fa-circle-plus" style={{ fontSize: '16px', color: '#2563eb' }}></i>
                  <span>ĐẶT THÊM PHÒNG</span>
                </button>
              </div>

              {/* Cảnh báo khi thời gian book ít hơn 24 tiếng */}
              {cartRooms.some((r) => r.selectedSlots.some((s) => isSlotUnder24Hours(bookDate, s))) && (
                <div
                  style={{
                    marginTop: '12px',
                    padding: '10px 14px',
                    background: '#fef7e0',
                    border: '1px solid #f9ab00',
                    borderLeft: '4px solid #e37400',
                    borderRadius: '6px',
                    color: '#b06000',
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    lineHeight: '1.4',
                  }}
                >
                  <i className="fa-solid fa-triangle-exclamation" style={{ fontSize: '16px', color: '#e37400' }}></i>
                  <div>
                    <strong>Cảnh báo: </strong>{UNDER_24H_WARNING_TEXT}.
                  </div>
                </div>
              )}
            </div>

            <div
              style={{
                padding: '16px 24px',
                borderTop: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: '#f8fafc',
                flexWrap: 'wrap',
                gap: '10px',
              }}
            >
              <div style={{ fontSize: '13px', color: '#475569' }}>
                Tổng cộng: <strong style={{ color: '#1d4ed8' }}>{cartRooms.length} phòng</strong>
                {' | '}
                <strong style={{ color: '#059669' }}>
                  {cartRooms.reduce((sum, r) => sum + r.selectedSlots.length, 0)} khung giờ
                </strong>
                {bookDate && <span> (Ngày: <b>{bookDate}</b>)</span>}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button
                  type="button"
                  className="btn"
                  style={{ background: '#e2e8f0', color: '#334155', fontWeight: 600 }}
                  onClick={closeBookingModal}
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  id="submitBookingBtn"
                  className="btn btn-primary"
                  disabled={isSubmitting}
                  style={{
                    fontWeight: 700,
                    padding: '8px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  {isSubmitting ? (
                    <>
                      <i className="fa-solid fa-spinner fa-spin"></i>
                      Đang xử lý đặt {cartRooms.length} phòng...
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-check"></i>
                      {(session?.role === 'admin' || session?.role === 'superadmin')
                        ? `Xác nhận Đặt & Tự Động Duyệt (${cartRooms.length} phòng)`
                        : `Xác nhận Đặt ${cartRooms.length} phòng`}
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* Modal Thêm Phòng Học Mới */}
      <div className={`modal-backdrop ${isAddRoomModalOpen ? 'open' : ''}`}>
        <div className="modal-box" style={{ maxWidth: '580px', width: '95%' }}>
          <div
            className="modal-header"
            style={{
              padding: '16px 24px',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <h3 style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <i className="fa-solid fa-door-open" style={{ color: 'var(--primary)' }}></i>
              Thêm Phòng Học Mới
            </h3>
            <i
              className="fa-solid fa-xmark"
              style={{ cursor: 'pointer', fontSize: '18px' }}
              onClick={() => setIsAddRoomModalOpen(false)}
            ></i>
          </div>

          <form onSubmit={handleAddRoomSubmit}>
            <div style={{ padding: '20px', maxHeight: '72vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <div className="form-row-2">
                <div className="form-group">
                  <label>Mã phòng học (*)</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Ví dụ: R105, P202, HT01..."
                    required
                    value={newRoomId}
                    onChange={(e) => setNewRoomId(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>Sức chứa (số chỗ ngồi)</label>
                  <input
                    type="number"
                    className="form-control"
                    min={1}
                    required
                    value={newRoomCapacity}
                    onChange={(e) => setNewRoomCapacity(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Tên phòng học (*)</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Ví dụ: Phòng Thực Hành Máy Tính 105"
                  required
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                />
              </div>

              <div className="form-row-3">
                <div className="form-group">
                  <label>Tòa nhà</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Tòa A, Tòa B..."
                    value={newRoomBuilding}
                    onChange={(e) => setNewRoomBuilding(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>Tầng</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Tầng 1, Tầng 2..."
                    value={newRoomFloor}
                    onChange={(e) => setNewRoomFloor(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>Trạng thái</label>
                  <select
                    className="form-control"
                    value={newRoomStatus}
                    onChange={(e) => setNewRoomStatus(e.target.value as any)}
                  >
                    <option value="Active">Hoạt động (Active)</option>
                    <option value="Maintenance">Bảo trì (Maintenance)</option>
                    <option value="Inactive">Tạm ngưng (Inactive)</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                  <i className="fa-solid fa-layer-group" style={{ color: 'var(--primary)' }}></i>
                  Phân loại phòng (*)
                </label>
                <select
                  className="form-control"
                  value={newRoomType}
                  onChange={(e) => setNewRoomType(e.target.value as RoomType)}
                  style={{ fontWeight: 600 }}
                >
                  <option value="chinh_khoa">🏫 Phòng Chính Khóa (Lý thuyết, giảng đường thông thường)</option>
                  <option value="chuc_nang">🔬 Phòng Chức Năng (Phòng máy, Lab, Hội trường, Âm nhạc, Thể thao...)</option>
                </select>
                <small style={{ color: '#64748b', fontSize: '11.5px', marginTop: '4px', display: 'block' }}>
                  Bảo vệ và hệ thống sẽ phân tách hiển thị và nhận biết tự động khi upload lịch từ thời khóa biểu.
                </small>
              </div>

              <div className="form-group">
                <label>Mô tả / Trang thiết bị phòng học</label>
                <textarea
                  className="form-control"
                  rows={3}
                  placeholder="Nhập ghi chú thiết bị (máy chiếu, mic, số máy tính...)"
                  value={newRoomDescription}
                  onChange={(e) => setNewRoomDescription(e.target.value)}
                ></textarea>
              </div>
            </div>

            <div
              style={{
                padding: '16px 24px',
                borderTop: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '10px',
              }}
            >
              <button
                type="button"
                className="btn"
                style={{ background: '#e0e0e0' }}
                onClick={() => setIsAddRoomModalOpen(false)}
              >
                Hủy bỏ
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isAddingRoom}
              >
                <i className="fa-solid fa-floppy-disk"></i> Lưu Phòng Học
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Supabase & Email Configuration Modal */}
      <div className={`modal-backdrop ${isConfigModalOpen ? 'open' : ''}`}>
        <div className="modal-box" style={{ maxWidth: '720px', width: '95%' }}>
          <div
            className="modal-header"
            style={{
              padding: '16px 24px',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <h3 style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', margin: 0, fontSize: '16px' }}>
                <i className="fa-solid fa-crown" style={{ color: '#eab308' }}></i>
                <i className="fa-solid fa-database" style={{ color: 'var(--primary)' }}></i>
                Cấu Hình CSDL Supabase & Hệ Thống (SuperAdmin)
              </h3>
              <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 0 0' }}>
                Khu vực quản trị cấp cao: Kết nối Supabase, Lấy Script SQL và Cấu hình Gửi Email
              </p>
            </div>
            <i
              className="fa-solid fa-xmark"
              style={{ cursor: 'pointer', fontSize: '18px' }}
              onClick={() => setIsConfigModalOpen(false)}
            ></i>
          </div>

          {/* Navigation Tabs */}
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid var(--border-color)',
              background: '#f8f9fa',
              padding: '0 16px',
              gap: '8px',
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              className={`btn ${configTab === 'database' ? 'btn-primary' : 'btn-light'}`}
              style={{ borderRadius: '0', borderBottom: configTab === 'database' ? '2px solid var(--primary)' : 'none', padding: '10px 16px', fontWeight: 600 }}
              onClick={() => setConfigTab('database')}
            >
              <i className="fa-solid fa-database"></i> 1. Kết nối Supabase & File SQL DB
            </button>
            <button
              type="button"
              className={`btn ${configTab === 'email' ? 'btn-primary' : 'btn-light'}`}
              style={{ borderRadius: '0', borderBottom: configTab === 'email' ? '2px solid var(--primary)' : 'none', padding: '10px 16px' }}
              onClick={() => setConfigTab('email')}
            >
              <i className="fa-solid fa-paper-plane"></i> 2. Cấu hình Gửi Email
            </button>
            <button
              type="button"
              className={`btn ${configTab === 'templates' ? 'btn-primary' : 'btn-light'}`}
              style={{ borderRadius: '0', borderBottom: configTab === 'templates' ? '2px solid var(--primary)' : 'none', padding: '10px 16px' }}
              onClick={() => setConfigTab('templates')}
            >
              <i className="fa-solid fa-envelope-open-text"></i> 3. Mẫu Thông Báo Email
            </button>
            <button
              type="button"
              className={`btn ${configTab === 'logs' ? 'btn-primary' : 'btn-light'}`}
              style={{ borderRadius: '0', borderBottom: configTab === 'logs' ? '2px solid var(--primary)' : 'none', padding: '10px 16px' }}
              onClick={() => {
                setConfigTab('logs');
                setEmailLogs(getEmailLogs());
              }}
            >
              <i className="fa-solid fa-clock-rotate-left"></i> 4. Lịch sử gửi Email
            </button>
          </div>

          <form onSubmit={handleSaveConfig}>
            <div style={{ padding: '24px', maxHeight: '68vh', overflowY: 'auto' }}>
              {/* TAB 1: EMAIL CONFIGURATION (GMAIL SMTP & GOOGLE APPS SCRIPT) */}
              {configTab === 'email' && (
                <div>
                  <div
                    style={{
                      padding: '12px 16px',
                      borderRadius: '8px',
                      background: '#e8f0fe',
                      color: '#1a73e8',
                      fontSize: '13px',
                      marginBottom: '20px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      lineHeight: '1.5',
                    }}
                  >
                    <i className="fa-solid fa-circle-info" style={{ fontSize: '18px' }}></i>
                    <div>
                      <strong>Cơ chế Gửi Mail Thông Báo Tự Động:</strong>
                      <br />
                      - Khi có <strong>lượt book phòng mới</strong>: Mail tự động gửi tới duy nhất các email Host/Admin trong bảng <code>settings</code> (<code>admin_email</code>) để duyệt.
                      <br />
                      - Khi Ban quản trị <strong>Duyệt/Từ chối đơn</strong>: Mail tự động gửi tới email Giảng viên/Người dùng trong bảng <code>users</code>.
                    </div>
                  </div>

                  {/* ADMIN RECIPIENTS (HỖ TRỢ THÊM NHIỀU EMAIL ADMIN) */}
                  <div style={{ border: '1.5px solid #16a34a', borderRadius: '8px', padding: '16px', marginBottom: '20px', background: '#f0fdf4' }}>
                    <h4 style={{ fontWeight: 700, fontSize: '14.5px', marginBottom: '6px', color: '#15803d', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <i className="fa-solid fa-user-shield"></i> Danh Sách Email Admin Nhận Thông Báo
                    </h4>
                    <p style={{ fontSize: '12.5px', color: '#334155', marginBottom: '12px', lineHeight: '1.4' }}>
                      Đồng bộ trực tiếp với bảng <code>settings</code> (khóa <code>admin_email</code>) trong Supabase. Khi có người book phòng mới, hệ thống sẽ gửi email tới <strong>duy nhất</strong> các địa chỉ email Admin được cấu hình tại đây (không gửi cho các tài khoản role "admin" trong bảng <code>users</code>).
                    </p>

                    <div className="form-group" style={{ marginBottom: '8px' }}>
                      <label style={{ fontWeight: 600, fontSize: '12.5px', color: '#0f172a' }}>
                        Email các Admin nhận thông báo (phân cách bằng dấu phẩy):
                      </label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="tranhuyvu3009@gmail.com, admin2@gmail.com, ..."
                        value={adminRecipientsInput}
                        onChange={(e) => setAdminRecipientsInput(e.target.value)}
                        style={{ fontSize: '13.5px', background: '#ffffff', border: '1.5px solid #86efac' }}
                      />
                    </div>
                    <div style={{ fontSize: '12px', color: '#166534', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <i className="fa-solid fa-circle-check"></i>
                      <span>
                        <strong>Cách dùng:</strong> Nhập 2 hoặc nhiều email cách nhau bằng dấu phẩy <code>,</code> (Ví dụ: <code>tranhuyvu3009@gmail.com, admin2@gmail.com</code>).
                      </span>
                    </div>
                  </div>

                  {/* CẤU HÌNH MÁY CHỦ GỬI EMAIL SMTP */}
                  <div style={{ border: '1.5px solid #1a73e8', borderRadius: '10px', padding: '18px', marginBottom: '20px', background: '#f8fafd' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                      <h4 style={{ fontWeight: 700, fontSize: '15px', color: '#1a73e8', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                        <i className="fa-solid fa-shield-halved"></i> Cấu Hình Máy Chủ Gửi Email SMTP (Chính thức & Bảo Mật)
                      </h4>
                      <span style={{ fontSize: '11px', background: '#dbeafe', color: '#1e40af', padding: '3px 8px', borderRadius: '12px', fontWeight: 600 }}>
                        100% Trực tiếp qua Gmail SMTP
                      </span>
                    </div>
                    <p style={{ fontSize: '12.5px', color: '#475569', marginBottom: '14px', lineHeight: '1.4' }}>
                      Toàn bộ email thông báo đặt phòng sẽ được máy chủ gửi trực tiếp qua giao thức Gmail SMTP mã hóa TLS (cổng 587). Không sử dụng Webhook trung gian, an toàn tuyệt đối và không lo bị khóa tài khoản.
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px', marginBottom: '14px' }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontWeight: 600, fontSize: '12.5px', color: '#1e293b', marginBottom: '4px', display: 'block' }}>
                          Gmail / Email Host gửi:
                        </label>
                        <input
                          type="email"
                          className="form-control"
                          placeholder="vuthanh3009@gmail.com hoặc kensinvn2000@gmail.com"
                          value={smtpUser}
                          onChange={(e) => setSmtpUser(e.target.value)}
                          style={{ fontSize: '13.5px', background: '#fff' }}
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontWeight: 600, fontSize: '12.5px', color: '#1e293b', marginBottom: '4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span>Mật khẩu ứng dụng Gmail (SMTP_PASS):</span>
                          <span style={{ fontSize: '11px', color: '#15803d', fontWeight: 700 }}>
                            <i className="fa-solid fa-shield-halved" style={{ marginRight: '3px' }}></i> Quản lý bởi Vercel
                          </span>
                        </label>
                        <div
                          style={{
                            background: '#f8fafc',
                            border: '1.5px solid #cbd5e1',
                            borderRadius: '8px',
                            padding: '9px 12px',
                            fontSize: '12.5px',
                            color: '#334155',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                            <i className="fa-solid fa-lock" style={{ color: '#16a34a' }}></i>
                            process.env.SMTP_PASS (Server-only)
                          </span>
                          <span style={{ fontSize: '11px', background: '#dcfce7', color: '#15803d', border: '1px solid #86efac', padding: '2px 8px', borderRadius: '12px', fontWeight: 700 }}>
                            Bảo mật tuyệt đối
                          </span>
                        </div>
                        <small style={{ color: '#64748b', fontSize: '11.5px', marginTop: '4px', display: 'block' }}>
                          Mật khẩu được đọc duy nhất từ Biến Môi Trường Vercel. Trình duyệt không lưu để chống lộ và tránh bị nhảy về pass cũ.
                        </small>
                      </div>
                    </div>

                    {/* Cài đặt kết nối SMTP Host & Port */}
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px', marginBottom: '14px' }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontWeight: 500, fontSize: '12px', color: '#64748b', marginBottom: '3px', display: 'block' }}>
                          SMTP Host:
                        </label>
                        <input
                          type="text"
                          className="form-control"
                          placeholder="smtp.gmail.com"
                          value={smtpHost}
                          onChange={(e) => setSmtpHost(e.target.value)}
                          style={{ fontSize: '12.5px', background: '#fff' }}
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontWeight: 500, fontSize: '12px', color: '#64748b', marginBottom: '3px', display: 'block' }}>
                          Port:
                        </label>
                        <input
                          type="text"
                          className="form-control"
                          placeholder="587"
                          value={smtpPort}
                          onChange={(e) => setSmtpPort(e.target.value)}
                          style={{ fontSize: '12.5px', background: '#fff' }}
                        />
                      </div>
                    </div>

                    <div style={{ fontSize: '12px', color: '#334155', background: '#ffffff', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', lineHeight: '1.5' }}>
                      <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <i className="fa-solid fa-circle-check" style={{ color: '#16a34a' }}></i>
                        Mật khẩu SMTP hiện chạy 100% qua Biến Môi Trường Vercel:
                      </div>
                      - <strong>Khi cần đổi mật khẩu mail:</strong> Bạn chỉ cần vào <strong>Vercel Dashboard ➔ Settings ➔ Environment Variables</strong> ➔ Cập nhật giá trị của biến <code>SMTP_PASS</code> ➔ Bấm <strong>Redeploy</strong>.
                      <br />
                      - Toàn bộ người dùng và quản trị viên sẽ tự động được áp dụng mật khẩu mới ngay lập tức mà không bao giờ bị xung đột pass cũ trong trình duyệt nữa.
                    </div>
                  </div>

                  {/* Test Email Box */}
                  <div style={{ border: '1px dotted var(--primary)', borderRadius: '8px', padding: '16px', background: '#f8fafd' }}>
                    <h4 style={{ fontWeight: 600, fontSize: '14px', marginBottom: '8px' }}>
                      <i className="fa-solid fa-paper-plane" style={{ color: 'var(--primary)' }}></i> Thử nghiệm gửi Email ngay:
                    </h4>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <input
                        type="email"
                        className="form-control"
                        placeholder="Nhập email nhận thử (VD: kensinvn2000@gmail.com)..."
                        value={testEmailAddress}
                        onChange={(e) => setTestEmailAddress(e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleSendTestMail}
                        disabled={isTestingEmail}
                        style={{ whiteSpace: 'nowrap' }}
                      >
                        {isTestingEmail ? (
                          <>
                            <i className="fa-solid fa-spinner fa-spin"></i> Đang gửi...
                          </>
                        ) : (
                          <>
                            <i className="fa-solid fa-paper-plane"></i> Gửi Mail Thử
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: EMAIL TEMPLATES (CUSTOMIZE NOTIFICATION CONTENT & SUBJECT) */}
              {configTab === 'templates' && (
                <div>
                  <div
                    style={{
                      padding: '12px 16px',
                      borderRadius: '8px',
                      background: '#e8f0fe',
                      color: '#1a73e8',
                      fontSize: '13px',
                      marginBottom: '20px',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                      lineHeight: '1.5',
                    }}
                  >
                    <i className="fa-solid fa-pen-to-square" style={{ fontSize: '18px', marginTop: '2px' }}></i>
                    <div>
                      <strong>Tùy Chỉnh Nội Dung & Tiêu Đề Email Thông Báo Tự Động:</strong>
                      <br />
                      Hệ thống sẽ tự động thay thế các từ khóa biến bên dưới khi gửi email:
                      <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '6px', fontSize: '11px' }}>
                        <code style={{ background: '#fff', padding: '2px 6px', borderRadius: '4px', border: '1px solid #c2e7ff' }}>{'{booking_id}'}: Mã đơn</code>
                        <code style={{ background: '#fff', padding: '2px 6px', borderRadius: '4px', border: '1px solid #c2e7ff' }}>{'{fullname}'}: Họ tên người đặt</code>
                        <code style={{ background: '#fff', padding: '2px 6px', borderRadius: '4px', border: '1px solid #c2e7ff' }}>{'{username}'}: Tên đăng nhập</code>
                        <code style={{ background: '#fff', padding: '2px 6px', borderRadius: '4px', border: '1px solid #c2e7ff' }}>{'{room_name}'}: Tên phòng</code>
                        <code style={{ background: '#fff', padding: '2px 6px', borderRadius: '4px', border: '1px solid #c2e7ff' }}>{'{room_id}'}: Mã phòng</code>
                        <code style={{ background: '#fff', padding: '2px 6px', borderRadius: '4px', border: '1px solid #c2e7ff' }}>{'{date}'}: Ngày sử dụng</code>
                        <code style={{ background: '#fff', padding: '2px 6px', borderRadius: '4px', border: '1px solid #c2e7ff' }}>{'{time_slot}'}: Khung giờ / Ca</code>
                        <code style={{ background: '#fff', padding: '2px 6px', borderRadius: '4px', border: '1px solid #c2e7ff' }}>{'{purpose}'}: Mục đích đặt phòng</code>
                        <code style={{ background: '#fff', padding: '2px 6px', borderRadius: '4px', border: '1px solid #c2e7ff' }}>{'{status}'}: Trạng thái duyệt</code>
                        <code style={{ background: '#fff', padding: '2px 6px', borderRadius: '4px', border: '1px solid #c2e7ff' }}>{'{reject_reason}'}: Lý do từ chối</code>
                      </div>
                    </div>
                  </div>

                  {templateSavedNotice && (
                    <div style={{ padding: '10px 14px', background: '#e6f4ea', color: '#137333', borderRadius: '6px', marginBottom: '16px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <i className="fa-solid fa-circle-check"></i>
                      Đã lưu mẫu thông báo thành công! Mọi email thông báo tiếp theo sẽ dùng mẫu này.
                    </div>
                  )}

                  {/* Template 1: New Booking */}
                  <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '16px', marginBottom: '20px', background: '#fff' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <h4 style={{ fontWeight: 600, fontSize: '14px', color: '#1a73e8', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                        <i className="fa-solid fa-paper-plane"></i> Mẫu 1: Thông báo khi có Đơn Đặt Phòng Mới
                      </h4>
                      <span className="badge" style={{ background: '#e8f0fe', color: '#1a73e8', fontSize: '11px' }}>
                        Gửi tới Quản trị viên & Giảng viên
                      </span>
                    </div>

                    <div className="form-group" style={{ marginBottom: '12px' }}>
                      <label style={{ fontWeight: 600, fontSize: '12px' }}>Tiêu đề Email (Subject):</label>
                      <input
                        type="text"
                        className="form-control"
                        value={emailTemplates.newBookingSubject}
                        onChange={(e) => setEmailTemplates({ ...emailTemplates, newBookingSubject: e.target.value })}
                        style={{ fontSize: '13px', fontWeight: 500 }}
                      />
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label style={{ fontWeight: 600, fontSize: '12px' }}>Nội dung Email (Body):</label>
                      <textarea
                        className="form-control"
                        rows={7}
                        value={emailTemplates.newBookingBody}
                        onChange={(e) => setEmailTemplates({ ...emailTemplates, newBookingBody: e.target.value })}
                        style={{ fontSize: '12px', fontFamily: 'monospace', lineHeight: '1.5' }}
                      />
                    </div>
                  </div>

                  {/* Template 2: Status Change */}
                  <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '16px', marginBottom: '20px', background: '#fff' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <h4 style={{ fontWeight: 600, fontSize: '14px', color: '#1a73e8', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                        <i className="fa-solid fa-signature"></i> Mẫu 2: Thông báo Duyệt hoặc Từ Chối Đơn
                      </h4>
                      <span className="badge" style={{ background: '#e6f4ea', color: '#137333', fontSize: '11px' }}>
                        Gửi tới Giảng viên đặt phòng
                      </span>
                    </div>

                    <div className="form-group" style={{ marginBottom: '12px' }}>
                      <label style={{ fontWeight: 600, fontSize: '12px' }}>Tiêu đề Email (Subject):</label>
                      <input
                        type="text"
                        className="form-control"
                        value={emailTemplates.statusChangeSubject}
                        onChange={(e) => setEmailTemplates({ ...emailTemplates, statusChangeSubject: e.target.value })}
                        style={{ fontSize: '13px', fontWeight: 500 }}
                      />
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label style={{ fontWeight: 600, fontSize: '12px' }}>Nội dung Email (Body):</label>
                      <textarea
                        className="form-control"
                        rows={7}
                        value={emailTemplates.statusChangeBody}
                        onChange={(e) => setEmailTemplates({ ...emailTemplates, statusChangeBody: e.target.value })}
                        style={{ fontSize: '12px', fontFamily: 'monospace', lineHeight: '1.5' }}
                      />
                    </div>
                  </div>

                  {/* Template Action Buttons */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{ background: '#f1f3f4', border: '1px solid #dadce0', fontSize: '12px' }}
                      onClick={handleResetTemplates}
                    >
                      <i className="fa-solid fa-arrow-rotate-left"></i> Khôi phục mẫu mặc định
                    </button>

                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      style={{ fontSize: '12px', padding: '6px 16px' }}
                      onClick={handleSaveTemplatesOnly}
                    >
                      <i className="fa-solid fa-floppy-disk"></i> Lưu mẫu thông báo
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 3: EMAIL LOGS */}
              {configTab === 'logs' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h4 style={{ fontWeight: 600, fontSize: '14px' }}>
                      Lịch sử phát Email thông báo gần đây ({emailLogs.length})
                    </h4>
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{ background: '#e0e0e0' }}
                      onClick={() => setEmailLogs(getEmailLogs())}
                    >
                      <i className="fa-solid fa-rotate-right"></i> Làm mới
                    </button>
                  </div>

                  {emailLogs.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                      Chưa có lịch sử gửi email nào. Hãy thử nút "Gửi Mail Thử" ở tab 1!
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
                      <table className="table" style={{ fontSize: '12px', margin: 0 }}>
                        <thead>
                          <tr style={{ background: '#f8f9fa' }}>
                            <th>Thời gian</th>
                            <th>Người nhận</th>
                            <th>Tiêu đề</th>
                            <th>Trạng thái</th>
                            <th>Thao tác</th>
                          </tr>
                        </thead>
                        <tbody>
                          {emailLogs.map((log) => (
                            <tr key={log.id}>
                              <td style={{ whiteSpace: 'nowrap' }}>{log.sent_at}</td>
                              <td style={{ fontWeight: 500 }}>{log.to}</td>
                              <td>{log.subject}</td>
                              <td>
                                <span
                                  className="badge"
                                  style={{
                                    background: log.status === 'Thành công' ? '#e6f4ea' : '#fce8e6',
                                    color: log.status === 'Thành công' ? '#137333' : '#c5221f',
                                  }}
                                >
                                  {log.status}
                                </span>
                              </td>
                              <td>
                                {log.preview_url ? (
                                  <a
                                    href={log.preview_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="btn btn-sm btn-primary"
                                    style={{ fontSize: '11px', padding: '2px 8px' }}
                                  >
                                    Xem Preview
                                  </a>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)' }}>Đã gửi SMTP</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: DATABASE SUPABASE */}
              {configTab === 'database' && (
                <div>
                  <div
                    style={{
                      padding: '12px',
                      borderRadius: '6px',
                      fontSize: '13px',
                      marginBottom: '20px',
                      background: savedCfg.isConnected ? '#e6f4ea' : '#fef7e0',
                      color: savedCfg.isConnected ? '#137333' : '#b06000',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                    }}
                  >
                    <i
                      className={`fa-solid ${
                        savedCfg.isConnected ? 'fa-check-circle' : 'fa-triangle-exclamation'
                      }`}
                    ></i>
                    <span>
                      {savedCfg.isConnected
                        ? 'Đã kết nối với Database Supabase!'
                        : 'Đang dùng bộ nhớ cục bộ (LocalStorage). Hãy nhập URL & Key Supabase để lưu trực tuyến.'}
                    </span>
                  </div>

                  <div style={{ marginBottom: '20px', background: '#f8f9fa', padding: '14px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                    <h4 style={{ fontSize: '14px', fontWeight: 500, marginBottom: '6px' }}>
                      1. Mã SQL tạo bảng trên Supabase (Database Schema):
                    </h4>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '10px' }}>
                      Sao chép mã này và dán vào <strong>SQL Editor</strong> trên Supabase Dashboard để tự động tạo sạch 4 bảng <code>users, rooms, bookings, settings</code>.
                    </p>
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={handleCopySql}
                    >
                      <i className="fa-solid fa-copy"></i> {copiedSql ? 'Đã sao chép SQL!' : 'Sao chép mã SQL Script'}
                    </button>
                  </div>

                  <div className="form-group">
                    <label>Supabase URL</label>
                    <input
                      type="url"
                      className="form-control"
                      placeholder="https://your-project.supabase.co"
                      value={supabaseUrl}
                      onChange={(e) => setSupabaseUrl(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label>Supabase Anon Key</label>
                    <input
                      type="password"
                      className="form-control"
                      placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                      value={supabaseKey}
                      onChange={(e) => setSupabaseKey(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>

            <div
              style={{
                padding: '16px 24px',
                borderTop: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '10px',
              }}
            >
              <button
                type="button"
                className="btn"
                style={{ background: '#e0e0e0' }}
                onClick={() => setIsConfigModalOpen(false)}
              >
                Đóng
              </button>
              <button type="submit" className="btn btn-primary">
                Lưu cấu hình
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Excel Booking Import Modal */}
      <ExcelImportModal
        isOpen={isExcelModalOpen}
        onClose={() => setIsExcelModalOpen(false)}
        existingRooms={rooms}
        existingBookings={bookings}
        currentUser={{
          username: session?.username || 'admin',
          fullname: session?.fullname || 'Hệ Thống Admin',
          role: session?.role,
        }}
        onSuccess={handleExcelImportSuccess}
      />

      {/* Recurring Schedule Modal (Superadmin / Admin) */}
      <RecurringScheduleModal
        isOpen={isRecurringModalOpen}
        onClose={() => setIsRecurringModalOpen(false)}
        rooms={rooms}
        bookings={bookings}
        currentSession={{
          username: session?.username || 'admin',
          fullname: session?.fullname || 'Super Admin',
          role: session?.role || 'superadmin',
        }}
        onSuccess={(msg, newBookings, targetDates) => {
          showToast(msg);
          if (newBookings && newBookings.length > 0) {
            setBookings((prev) => {
              const newIds = new Set(newBookings.map((b) => b.booking_id));
              const filtered = prev.filter((b) => !newIds.has(b.booking_id));
              const updated = [...newBookings, ...filtered];
              try {
                localStorage.setItem('vuth_booking_bookings', JSON.stringify(updated));
              } catch {}
              return updated;
            });
          }
          if (targetDates && targetDates.length > 0) {
            setTimelineDate(targetDates[0]);
            setBookDate(targetDates[0]);
          }
        }}
        onNavigateDate={(date) => {
          setTimelineDate(date);
          setBookDate(date);
          setRoomViewMode('grid');
        }}
        onRefreshData={async () => {
          await syncAllData(false, true);
        }}
      />

      {/* Force Change Password Modal (Triggered on login with default password 123456) */}
      {forceChangePasswordData && (
        <ChangePasswordModal
          isOpen={Boolean(forceChangePasswordData)}
          onClose={() => setForceChangePasswordData(null)}
          user={forceChangePasswordData.user}
          initialOldPassword={forceChangePasswordData.enteredPass}
          isForceChange={true}
          onSuccess={handleForcePasswordChangeSuccess}
          onCancelForce={() => {
            setForceChangePasswordData(null);
            setLoginPassVal('');
          }}
        />
      )}

      {/* Voluntary Change Password Modal (Triggered by user from header) */}
      {session && isChangePasswordModalOpen && (
        <ChangePasswordModal
          isOpen={isChangePasswordModalOpen}
          onClose={() => setIsChangePasswordModalOpen(false)}
          user={{
            username: session.username,
            fullname: session.fullname,
            role: session.role,
          }}
          isForceChange={false}
          onSuccess={handleVoluntaryPasswordChangeSuccess}
        />
      )}

      {/* Popup Nhập Lý Do Hủy Đơn Đặt Phòng (Dành cho Admin & User) */}
      <div className={`modal-backdrop ${cancelModalBooking ? 'open' : ''}`} id="cancelBookingModal">
        <div className="modal-box" style={{ maxWidth: '480px', width: '92%', borderRadius: '16px', overflow: 'hidden' }}>
          <div
            className="modal-header"
            style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#fffbeb',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#ffffff',
                  fontSize: '16px',
                }}
              >
                <i className="fa-solid fa-triangle-exclamation"></i>
              </div>
              <div>
                <h3 style={{ margin: 0, fontWeight: 700, fontSize: '15px', color: '#92400e' }}>
                  Xác Nhận Hủy Đơn Đặt Phòng
                </h3>
                <span style={{ fontSize: '12px', color: '#b45309' }}>
                  Mã đơn: <b>{cancelModalBooking?.booking_id}</b>
                </span>
              </div>
            </div>
            <i
              className="fa-solid fa-xmark"
              style={{ cursor: 'pointer', fontSize: '18px', color: '#94a3b8', padding: '4px' }}
              onClick={handleCloseCancelModal}
            ></i>
          </div>

          <form onSubmit={handleConfirmCancelBooking}>
            <div style={{ padding: '20px' }}>
              {/* Tóm tắt thông tin đơn cần hủy */}
              {cancelModalBooking && (
                <div
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    padding: '12px 14px',
                    marginBottom: '16px',
                    fontSize: '13px',
                    color: '#334155',
                    lineHeight: '1.5',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ color: '#64748b' }}>Phòng học:</span>
                    <strong style={{ color: '#1d4ed8' }}>{cancelModalBooking.room_name}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ color: '#64748b' }}>Ngày sử dụng:</span>
                    <span>{cancelModalBooking.date}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ color: '#64748b' }}>Khung giờ:</span>
                    <span style={{ fontWeight: 600 }}>{cancelModalBooking.time_slot}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#64748b' }}>Người mượn:</span>
                    <span>{cancelModalBooking.borrower_name || cancelModalBooking.fullname}</span>
                  </div>
                </div>
              )}

              {/* Ô nhập lý do hủy */}
              <div className="form-group" style={{ marginBottom: '14px' }}>
                <label style={{ fontSize: '13.5px', fontWeight: 600, color: '#1e293b', marginBottom: '6px', display: 'block' }}>
                  Lý do hủy đơn phòng <span style={{ color: '#ef4444' }}>*</span>:
                </label>
                <textarea
                  className="form-control"
                  style={{
                    width: '100%',
                    minHeight: '80px',
                    padding: '10px 12px',
                    fontSize: '13.5px',
                    borderRadius: '8px',
                    resize: 'vertical',
                    border: '1px solid #cbd5e1',
                  }}
                  placeholder="Nhập lý do hủy (ví dụ: Bận việc đột xuất, đổi lịch dạy, hoãn sự kiện...)"
                  value={cancelReasonInput}
                  onChange={(e) => setCancelReasonInput(e.target.value)}
                  autoFocus
                />
              </div>

              {/* Gợi ý lý do nhanh */}
              <div>
                <div style={{ fontSize: '11.5px', color: '#64748b', marginBottom: '6px', fontWeight: 500 }}>
                  Gợi ý lý do nhanh:
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {[
                    'Bận việc đột xuất',
                    'Đổi sang phòng khác',
                    'Đổi ngày / khung giờ dạy',
                    'Hoãn lịch sự kiện / lớp học',
                    'Đặt nhầm khung giờ',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setCancelReasonInput(preset)}
                      style={{
                        background: cancelReasonInput === preset ? '#fef3c7' : '#f1f5f9',
                        color: cancelReasonInput === preset ? '#92400e' : '#475569',
                        border: cancelReasonInput === preset ? '1px solid #f59e0b' : '1px solid #e2e8f0',
                        borderRadius: '6px',
                        padding: '3px 8px',
                        fontSize: '11.5px',
                        cursor: 'pointer',
                        transition: '0.15s ease',
                      }}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div
              style={{
                padding: '14px 20px',
                borderTop: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '10px',
                background: '#f8fafc',
              }}
            >
              <button
                type="button"
                className="btn"
                style={{ background: '#e2e8f0', color: '#334155', borderRadius: '8px', padding: '8px 16px' }}
                onClick={handleCloseCancelModal}
              >
                Đóng
              </button>
              <button
                type="submit"
                className="btn"
                style={{
                  background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                  color: '#ffffff',
                  borderRadius: '8px',
                  padding: '8px 18px',
                  fontWeight: 600,
                  boxShadow: '0 2px 6px rgba(217, 119, 6, 0.25)',
                }}
              >
                <i className="fa-solid fa-ban"></i> Xác nhận Hủy Đơn
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
