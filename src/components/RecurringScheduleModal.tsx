import React, { useState, useEffect, useMemo } from 'react';
import { Room, Booking } from '../types';
import { DEFAULT_TIME_SLOTS } from '../lib/initialData';
import {
  RecurringTemplate,
  DEFAULT_RECURRING_TEMPLATES,
  fetchRecurringTemplates,
  saveRecurringTemplates,
  applyRecurringSchedule,
  deleteRecurringBookings,
  calculateTargetDates,
  resolveTargetRooms,
  formatLocalDate,
  parseLocalDate,
} from '../lib/recurringSchedule';

interface RecurringScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  rooms: Room[];
  bookings: Booking[];
  currentSession: { username: string; fullname: string; role: string };
  onSuccess: (msg: string, newBookings?: Booking[], targetDates?: string[]) => void;
  onRefreshData: () => Promise<void>;
  onNavigateDate?: (date: string) => void;
}

export const RecurringScheduleModal: React.FC<RecurringScheduleModalProps> = ({
  isOpen,
  onClose,
  rooms,
  bookings,
  currentSession,
  onSuccess,
  onRefreshData,
  onNavigateDate,
}) => {
  const [activeTab, setActiveTab] = useState<'apply' | 'templates' | 'rollback'>('apply');
  const [templates, setTemplates] = useState<RecurringTemplate[]>(DEFAULT_RECURRING_TEMPLATES);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('tpl_main_study');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [notification, setNotification] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
    firstDate?: string;
  } | null>(null);

  // Chế độ áp dụng
  const [applyMode, setApplyMode] = useState<'week' | 'range'>('week');
  const [selectedWeekDate, setSelectedWeekDate] = useState<string>(() => {
    const d = new Date();
    // Nếu hôm nay là Thứ 7 (6) hoặc Chủ Nhật (0), người dùng thường lên lịch cho tuần học kế tiếp
    if (d.getDay() === 6) d.setDate(d.getDate() + 2);
    else if (d.getDay() === 0) d.setDate(d.getDate() + 1);
    return formatLocalDate(d);
  });
  const [rangeStartDate, setRangeStartDate] = useState<string>(() => {
    const d = new Date();
    if (d.getDay() === 6) d.setDate(d.getDate() + 2);
    else if (d.getDay() === 0) d.setDate(d.getDate() + 1);
    return formatLocalDate(d);
  });
  const [rangeEndDate, setRangeEndDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 28); // 4 tuần
    return formatLocalDate(d);
  });
  const [skipConflicts, setSkipConflicts] = useState<boolean>(true);

  // Chỉnh sửa Template (Tab 'templates')
  const [editingTemplate, setEditingTemplate] = useState<RecurringTemplate | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState<boolean>(false);

  // Chế độ Thu hồi (Tab 'rollback')
  const [rollbackStartDate, setRollbackStartDate] = useState<string>(() => formatLocalDate(new Date()));
  const [rollbackEndDate, setRollbackEndDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 6);
    return formatLocalDate(d);
  });
  const [rollbackRoomId, setRollbackRoomId] = useState<string>('ALL');
  const [rollbackConfirmed, setRollbackConfirmed] = useState<boolean>(false);

  // Tự động tải templates khi mở modal
  useEffect(() => {
    if (isOpen) {
      loadTemplates();
      setNotification(null);
    }
  }, [isOpen]);

  const loadTemplates = async () => {
    setIsLoading(true);
    try {
      const list = await fetchRecurringTemplates();
      setTemplates(list);
      if (list.length > 0 && !list.find((t) => t.id === selectedTemplateId)) {
        setSelectedTemplateId(list[0].id);
      }
    } catch (e) {
      console.warn('Lỗi tải templates:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const currentTemplate = useMemo(() => {
    return templates.find((t) => t.id === selectedTemplateId) || templates[0];
  }, [templates, selectedTemplateId]);

  // Tính toán phòng áp dụng dựa vào template và danh sách phòng
  const resolvedRooms = useMemo(() => {
    if (!currentTemplate) return [];
    return resolveTargetRooms(currentTemplate, rooms);
  }, [currentTemplate, rooms]);

  // Tính toán khoảng ngày trong tuần của selectedWeekDate
  const weekInfo = useMemo(() => {
    if (!selectedWeekDate) return { mondayStr: '', sundayStr: '', mondayDisplay: '', sundayDisplay: '' };
    const base = parseLocalDate(selectedWeekDate);
    if (isNaN(base.getTime())) return { mondayStr: '', sundayStr: '', mondayDisplay: '', sundayDisplay: '' };

    const day = base.getDay();
    const diffToMon = day === 0 ? -6 : 1 - day;
    const mon = new Date(base);
    mon.setDate(base.getDate() + diffToMon);

    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);

    const monStr = formatLocalDate(mon);
    const sunStr = formatLocalDate(sun);

    return {
      mondayStr: monStr,
      sundayStr: sunStr,
      mondayDisplay: `${mon.getDate()}/${mon.getMonth() + 1}/${mon.getFullYear()}`,
      sundayDisplay: `${sun.getDate()}/${sun.getMonth() + 1}/${sun.getFullYear()}`,
    };
  }, [selectedWeekDate]);

  // Điều hướng tuần
  const handleShiftWeek = (weeks: number) => {
    const base = parseLocalDate(selectedWeekDate);
    base.setDate(base.getDate() + weeks * 7);
    setSelectedWeekDate(formatLocalDate(base));
  };

  // Dự toán số lượng slot sẽ được sinh
  const previewCalculation = useMemo(() => {
    if (!currentTemplate) return { roomsCount: 0, daysCount: 0, slotsCount: 0, totalSlots: 0 };
    const roomsCount = resolvedRooms.length;

    const targetDates = calculateTargetDates(
      applyMode === 'week'
        ? { mode: 'week', weekDate: selectedWeekDate }
        : { mode: 'range', startDate: rangeStartDate, endDate: rangeEndDate },
      currentTemplate.daysOfWeek && currentTemplate.daysOfWeek.length > 0 ? currentTemplate.daysOfWeek : [1, 2, 3, 4, 5]
    );

    const slotsCount = (currentTemplate.slotNumbers || []).length;
    const totalSlots = roomsCount * targetDates.length * slotsCount;
    const totalRecords = roomsCount * targetDates.length; // Số record tối ưu được lưu trong DB

    return {
      roomsCount,
      daysCount: targetDates.length,
      slotsCount,
      totalSlots,
      totalRecords,
    };
  }, [currentTemplate, resolvedRooms, applyMode, selectedWeekDate, rangeStartDate, rangeEndDate]);

  // Thực hiện áp dụng sinh lịch (KHÔNG DÙNG window.confirm/alert vì bị chặn trong iframe)
  const handleApplySchedule = async () => {
    setNotification(null);

    if (!currentTemplate) {
      setNotification({ type: 'error', message: 'Vui lòng chọn một mẫu lịch định kỳ.' });
      return;
    }

    if (previewCalculation.totalSlots === 0) {
      setNotification({
        type: 'error',
        message: 'Chưa có slot nào được tính toán. Vui lòng kiểm tra lại phòng học hoặc ngày áp dụng.',
      });
      return;
    }

    setIsLoading(true);
    setStatusMessage(`Đang tự động khởi tạo và khóa ${previewCalculation.totalSlots} slot vào CSDL...`);

    try {
      const res = await applyRecurringSchedule(
        currentTemplate,
        {
          mode: applyMode,
          weekDate: selectedWeekDate,
          startDate: rangeStartDate,
          endDate: rangeEndDate,
          skipConflicts,
        },
        rooms,
        bookings,
        currentSession
      );

      if (res.success) {
        const firstD = res.targetDates && res.targetDates.length > 0 ? res.targetDates[0] : undefined;
        setNotification({ type: 'success', message: res.message, firstDate: firstD });
        await onRefreshData();
        onSuccess(res.message, res.newBookings, res.targetDates);
        if (firstD && onNavigateDate) {
          onNavigateDate(firstD);
        }
        // Tự động đóng modal sau 2.8s để người dùng kịp đọc thông báo
        setTimeout(() => {
          onClose();
        }, 2800);
      } else {
        setNotification({ type: 'error', message: res.message || 'Có lỗi xảy ra khi áp dụng lịch định kỳ.' });
      }
    } catch (e: any) {
      setNotification({ type: 'error', message: `Lỗi hệ thống: ${e?.message || e}` });
    } finally {
      setIsLoading(false);
      setStatusMessage('');
    }
  };

  // Mở form chỉnh sửa template
  const handleStartEditTemplate = (tpl: RecurringTemplate) => {
    setEditingTemplate(JSON.parse(JSON.stringify(tpl)));
    setIsCreatingNew(false);
    setNotification(null);
  };

  const handleStartCreateTemplate = () => {
    const newTpl: RecurringTemplate = {
      id: `tpl_${Date.now()}`,
      name: 'Mẫu lịch mới',
      description: '',
      roomIds: rooms.map((r) => r.room_id),
      daysOfWeek: [1, 2, 3, 4, 5],
      slotNumbers: [1, 2, 3, 4, 6, 7, 8, 9],
      purpose: 'Lịch học chính khóa cố định',
      borrowerName: 'Phòng Đào Tạo',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setEditingTemplate(newTpl);
    setIsCreatingNew(true);
    setNotification(null);
  };

  const handleSaveEditingTemplate = async () => {
    if (!editingTemplate || !editingTemplate.name.trim()) {
      setNotification({ type: 'error', message: 'Vui lòng nhập tên mẫu lịch.' });
      return;
    }
    if (editingTemplate.daysOfWeek.length === 0) {
      setNotification({ type: 'error', message: 'Vui lòng chọn ít nhất 1 ngày trong tuần.' });
      return;
    }
    if (editingTemplate.slotNumbers.length === 0) {
      setNotification({ type: 'error', message: 'Vui lòng chọn ít nhất 1 khung giờ slot.' });
      return;
    }

    setIsLoading(true);
    try {
      let updatedList: RecurringTemplate[];
      if (isCreatingNew) {
        updatedList = [...templates, { ...editingTemplate, updatedAt: new Date().toISOString() }];
      } else {
        updatedList = templates.map((t) =>
          t.id === editingTemplate.id ? { ...editingTemplate, updatedAt: new Date().toISOString() } : t
        );
      }

      await saveRecurringTemplates(updatedList);
      setTemplates(updatedList);
      setSelectedTemplateId(editingTemplate.id);
      setEditingTemplate(null);
      setIsCreatingNew(false);
      setNotification({ type: 'success', message: 'Đã lưu cấu hình mẫu thành công!' });
    } catch (e: any) {
      setNotification({ type: 'error', message: `Lỗi khi lưu mẫu: ${e?.message || e}` });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    if (templates.length <= 1) {
      setNotification({ type: 'error', message: 'Hệ thống cần giữ lại ít nhất 1 mẫu lịch định kỳ.' });
      return;
    }

    const remaining = templates.filter((t) => t.id !== id);
    setIsLoading(true);
    try {
      await saveRecurringTemplates(remaining);
      setTemplates(remaining);
      setSelectedTemplateId(remaining[0].id);
      if (editingTemplate?.id === id) {
        setEditingTemplate(null);
      }
      setNotification({ type: 'success', message: 'Đã xóa mẫu lịch thành công!' });
    } catch (e: any) {
      setNotification({ type: 'error', message: `Lỗi khi xóa mẫu: ${e?.message || e}` });
    } finally {
      setIsLoading(false);
    }
  };

  // Thực hiện thu hồi / xóa đơn định kỳ
  const handleExecuteRollback = async () => {
    if (!rollbackStartDate || !rollbackEndDate) {
      setNotification({ type: 'error', message: 'Vui lòng chọn khoảng ngày cần thu hồi.' });
      return;
    }

    if (!rollbackConfirmed) {
      setNotification({
        type: 'error',
        message: 'Vui lòng tích vào ô "Xác nhận chắc chắn muốn xóa" ở bên dưới trước khi thực hiện.',
      });
      return;
    }

    setIsLoading(true);
    setStatusMessage('Đang thu hồi và xóa các slot định kỳ...');
    try {
      const res = await deleteRecurringBookings(rollbackStartDate, rollbackEndDate, rollbackRoomId);
      await onRefreshData();
      setNotification({ type: 'success', message: res.message });
      setRollbackConfirmed(false);
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (e: any) {
      setNotification({ type: 'error', message: `Lỗi khi thu hồi lịch: ${e?.message || e}` });
    } finally {
      setIsLoading(false);
      setStatusMessage('');
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '16px',
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '920px',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid #e2e8f0',
            background: 'linear-gradient(135deg, #4c1d95 0%, #6d28d9 50%, #4338ca 100%)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '10px',
                background: 'rgba(255, 255, 255, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '20px',
              }}
            >
              <i className="fa-solid fa-repeat"></i>
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#ffffff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                Lịch Định Kỳ Cố Định (Recurring Schedule)
                <span style={{ fontSize: '11px', background: '#eab308', color: '#78350f', padding: '2px 8px', borderRadius: '12px', fontWeight: 800 }}>
                  SUPERADMIN
                </span>
              </h3>
              <p style={{ margin: '3px 0 0', fontSize: '12.5px', color: '#e9d5ff' }}>
                Khóa nhanh các slot theo mẫu có sẵn cho cả tuần hoặc cả kỳ học mà không cần file Excel
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isLoading}
            style={{
              background: 'rgba(255, 255, 255, 0.15)',
              border: 'none',
              color: '#ffffff',
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '16px',
            }}
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        {/* Tab Navigation */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid #e2e8f0',
            background: '#f8fafc',
            padding: '0 24px',
            gap: '8px',
          }}
        >
          <button
            type="button"
            onClick={() => {
              setActiveTab('apply');
              setEditingTemplate(null);
              setNotification(null);
            }}
            style={{
              padding: '12px 18px',
              border: 'none',
              background: 'transparent',
              fontSize: '13.5px',
              fontWeight: 600,
              color: activeTab === 'apply' ? '#6d28d9' : '#64748b',
              borderBottom: activeTab === 'apply' ? '3px solid #6d28d9' : '3px solid transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <i className="fa-solid fa-bolt"></i>
            Áp Dụng Lịch Cố Định
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('templates');
              setNotification(null);
            }}
            style={{
              padding: '12px 18px',
              border: 'none',
              background: 'transparent',
              fontSize: '13.5px',
              fontWeight: 600,
              color: activeTab === 'templates' ? '#6d28d9' : '#64748b',
              borderBottom: activeTab === 'templates' ? '3px solid #6d28d9' : '3px solid transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <i className="fa-solid fa-sliders"></i>
            Thiết Lập Mẫu (Templates)
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('rollback');
              setEditingTemplate(null);
              setNotification(null);
            }}
            style={{
              padding: '12px 18px',
              border: 'none',
              background: 'transparent',
              fontSize: '13.5px',
              fontWeight: 600,
              color: activeTab === 'rollback' ? '#dc2626' : '#64748b',
              borderBottom: activeTab === 'rollback' ? '3px solid #dc2626' : '3px solid transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <i className="fa-solid fa-rotate-left"></i>
            Thu Hồi / Xóa Lịch Tuần
          </button>
        </div>

        {/* Content Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          {/* Thông báo Notification Banner (Thay thế window.alert) */}
          {notification && (
            <div
              style={{
                marginBottom: '16px',
                padding: '12px 16px',
                borderRadius: '8px',
                background: notification.type === 'success' ? '#dcfce7' : notification.type === 'error' ? '#fee2e2' : '#eff6ff',
                border: notification.type === 'success' ? '1px solid #86efac' : notification.type === 'error' ? '1px solid #fca5a5' : '1px solid #bfdbfe',
                color: notification.type === 'success' ? '#15803d' : notification.type === 'error' ? '#b91c1c' : '#1d4ed8',
                fontSize: '13.5px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <i
                    className={`fa-solid ${
                      notification.type === 'success'
                        ? 'fa-circle-check'
                        : notification.type === 'error'
                        ? 'fa-circle-exclamation'
                        : 'fa-circle-info'
                    }`}
                  ></i>
                  <span>{notification.message}</span>
                </div>
                {notification.type === 'success' && notification.firstDate && onNavigateDate && (
                  <button
                    type="button"
                    onClick={() => {
                      onNavigateDate(notification.firstDate!);
                      onClose();
                    }}
                    style={{
                      marginLeft: '8px',
                      background: '#15803d',
                      color: '#ffffff',
                      border: 'none',
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    👉 Xem lịch ngày {notification.firstDate}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setNotification(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: '14px' }}
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
          )}

          {statusMessage && (
            <div
              style={{
                marginBottom: '16px',
                padding: '14px 18px',
                borderRadius: '8px',
                background: '#eff6ff',
                border: '1px solid #bfdbfe',
                color: '#1d4ed8',
                fontSize: '13.5px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <i className="fa-solid fa-circle-notch fa-spin" style={{ fontSize: '18px' }}></i>
              <span>{statusMessage}</span>
            </div>
          )}

          {/* TAB 1: ÁP DỤNG LỊCH */}
          {activeTab === 'apply' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* 1. Chọn Mẫu */}
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '16px 20px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <label style={{ fontSize: '13.5px', fontWeight: 700, color: '#334155', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <i className="fa-solid fa-bookmark" style={{ color: '#6d28d9' }}></i>
                    1. Chọn Mẫu Cấu Hình:
                  </label>
                  <button
                    type="button"
                    onClick={() => setActiveTab('templates')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#6d28d9',
                      fontSize: '12.5px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <i className="fa-solid fa-pen-to-square"></i> Chỉnh sửa mẫu
                  </button>
                </div>

                <select
                  value={selectedTemplateId}
                  onChange={(e) => {
                    setSelectedTemplateId(e.target.value);
                    setNotification(null);
                  }}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '14px',
                    fontWeight: 600,
                    background: '#ffffff',
                    color: '#0f172a',
                  }}
                >
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </option>
                  ))}
                </select>

                {currentTemplate && (
                  <div style={{ marginTop: '10px', fontSize: '12.5px', color: '#64748b', display: 'flex', flexWrap: 'wrap', gap: '14px' }}>
                    <span>
                      <strong style={{ color: '#334155' }}>Số phòng áp dụng:</strong>{' '}
                      <span style={{ color: '#16a34a', fontWeight: 700 }}>{resolvedRooms.length} phòng</span>
                    </span>
                    <span>
                      <strong style={{ color: '#334155' }}>Ngày áp dụng:</strong>{' '}
                      {(currentTemplate.daysOfWeek || []).map((d) => (d === 0 ? 'CN' : `T${d + 1}`)).join(', ')}
                    </span>
                    <span>
                      <strong style={{ color: '#334155' }}>Khung giờ:</strong>{' '}
                      {(currentTemplate.slotNumbers || []).map((s) => (s === 'trua' ? 'Slot Trưa' : `Slot ${s}`)).join(', ')}
                    </span>
                  </div>
                )}
              </div>

              {/* 2. Chọn Phạm Vi Thời Gian */}
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '16px 20px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                  <label style={{ fontSize: '13.5px', fontWeight: 700, color: '#334155', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <i className="fa-solid fa-calendar-days" style={{ color: '#2563eb' }}></i>
                    2. Chọn Thời Gian Áp Dụng:
                  </label>
                  <div style={{ display: 'flex', background: '#e2e8f0', padding: '3px', borderRadius: '8px', gap: '4px' }}>
                    <button
                      type="button"
                      onClick={() => setApplyMode('week')}
                      style={{
                        padding: '4px 12px',
                        borderRadius: '6px',
                        border: 'none',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        background: applyMode === 'week' ? '#ffffff' : 'transparent',
                        color: applyMode === 'week' ? '#1e293b' : '#64748b',
                        boxShadow: applyMode === 'week' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                      }}
                    >
                      Theo Từng Tuần (Khuyên dùng)
                    </button>
                    <button
                      type="button"
                      onClick={() => setApplyMode('range')}
                      style={{
                        padding: '4px 12px',
                        borderRadius: '6px',
                        border: 'none',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        background: applyMode === 'range' ? '#ffffff' : 'transparent',
                        color: applyMode === 'range' ? '#1e293b' : '#64748b',
                        boxShadow: applyMode === 'range' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                      }}
                    >
                      Theo Dải Ngày (Cả tháng/kỳ)
                    </button>
                  </div>
                </div>

                {applyMode === 'week' ? (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => handleShiftWeek(-1)}
                        style={{
                          background: '#ffffff',
                          border: '1px solid #cbd5e1',
                          padding: '8px 12px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          fontSize: '13px',
                          fontWeight: 600,
                        }}
                      >
                        <i className="fa-solid fa-chevron-left"></i> Tuần trước
                      </button>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '220px' }}>
                        <input
                          type="date"
                          value={selectedWeekDate}
                          onChange={(e) => setSelectedWeekDate(e.target.value)}
                          style={{
                            padding: '8px 12px',
                            borderRadius: '8px',
                            border: '1px solid #cbd5e1',
                            fontSize: '13.5px',
                            fontWeight: 600,
                            flex: 1,
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => setSelectedWeekDate(formatLocalDate(new Date()))}
                          style={{
                            background: '#eff6ff',
                            border: '1px solid #bfdbfe',
                            color: '#1d4ed8',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontSize: '12.5px',
                            fontWeight: 600,
                          }}
                        >
                          Tuần này
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleShiftWeek(1)}
                        style={{
                          background: '#ffffff',
                          border: '1px solid #cbd5e1',
                          padding: '8px 12px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          fontSize: '13px',
                          fontWeight: 600,
                        }}
                      >
                        Tuần sau <i className="fa-solid fa-chevron-right"></i>
                      </button>
                    </div>

                    <div
                      style={{
                        marginTop: '12px',
                        padding: '10px 14px',
                        borderRadius: '8px',
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        fontSize: '13px',
                        color: '#334155',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span>
                        <i className="fa-solid fa-calendar-check" style={{ color: '#16a34a', marginRight: '6px' }}></i>
                        Khoảng tuần: <strong>Thứ 2 ({weekInfo.mondayDisplay})</strong> đến <strong>Chủ nhật ({weekInfo.sundayDisplay})</strong>
                      </span>
                      <span style={{ fontSize: '12px', color: '#64748b' }}>
                        (Áp dụng vào: {(currentTemplate.daysOfWeek || []).map((d) => (d === 0 ? 'CN' : `T${d + 1}`)).join(', ')})
                      </span>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ flex: 1, minWidth: '180px' }}>
                      <label style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '4px' }}>Từ ngày:</label>
                      <input
                        type="date"
                        value={rangeStartDate}
                        onChange={(e) => setRangeStartDate(e.target.value)}
                        style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: '180px' }}>
                      <label style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '4px' }}>Đến ngày:</label>
                      <input
                        type="date"
                        value={rangeEndDate}
                        onChange={(e) => setRangeEndDate(e.target.value)}
                        style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* 3. Thống Kê & Xem Trước */}
              <div
                style={{
                  background: 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)',
                  border: '1px solid #ddd6fe',
                  borderRadius: '12px',
                  padding: '16px 20px',
                }}
              >
                <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#5b21b6', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <i className="fa-solid fa-chart-pie"></i> Thống Kê Dự Kiến:
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>
                  <div style={{ background: '#ffffff', borderRadius: '8px', padding: '10px 14px', border: '1px solid #e9d5ff' }}>
                    <div style={{ fontSize: '11px', color: '#7c3aed', fontWeight: 600 }}>PHÒNG ÁP DỤNG</div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#4c1d95', marginTop: '2px' }}>
                      {previewCalculation.roomsCount}
                    </div>
                  </div>
                  <div style={{ background: '#ffffff', borderRadius: '8px', padding: '10px 14px', border: '1px solid #e9d5ff' }}>
                    <div style={{ fontSize: '11px', color: '#7c3aed', fontWeight: 600 }}>SỐ NGÀY TÍNH TOÁN</div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#4c1d95', marginTop: '2px' }}>
                      {previewCalculation.daysCount}
                    </div>
                  </div>
                  <div style={{ background: '#ffffff', borderRadius: '8px', padding: '10px 14px', border: '1px solid #bbf7d0' }}>
                    <div style={{ fontSize: '11px', color: '#16a34a', fontWeight: 600 }}>TỔNG SLOT KHÓA</div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#15803d', marginTop: '2px' }}>
                      {previewCalculation.totalSlots}
                    </div>
                  </div>
                  <div style={{ background: '#ffffff', borderRadius: '8px', padding: '10px 14px', border: '1px solid #bfdbfe', position: 'relative' }}>
                    <div style={{ fontSize: '11px', color: '#2563eb', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span>RECORD DB (TỐI ƯU)</span>
                      <span style={{ fontSize: '9.5px', background: '#dbeafe', color: '#1d4ed8', padding: '1px 5px', borderRadius: '4px', fontWeight: 700 }}>
                        Giảm ~87%
                      </span>
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#1e40af', marginTop: '2px' }}>
                      {previewCalculation.totalRecords}
                      <span style={{ fontSize: '11px', fontWeight: 500, color: '#64748b', marginLeft: '4px' }}>dòng</span>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="checkbox"
                    id="chkSkipConflicts"
                    checked={skipConflicts}
                    onChange={(e) => setSkipConflicts(e.target.checked)}
                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  <label htmlFor="chkSkipConflicts" style={{ fontSize: '13px', color: '#4c1d95', fontWeight: 600, cursor: 'pointer' }}>
                    Tự động bỏ qua các slot đã có người đặt trước (bảo vệ lịch đã book, không ghi đè)
                  </label>
                </div>
              </div>

              {/* Nút Áp Dụng */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isLoading}
                  style={{
                    padding: '10px 20px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    color: '#475569',
                    fontSize: '13.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Đóng
                </button>
                <button
                  type="button"
                  onClick={handleApplySchedule}
                  disabled={isLoading || previewCalculation.totalSlots === 0}
                  style={{
                    padding: '10px 24px',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)',
                    color: '#ffffff',
                    fontSize: '14px',
                    fontWeight: 700,
                    cursor: isLoading || previewCalculation.totalSlots === 0 ? 'not-allowed' : 'pointer',
                    boxShadow: '0 4px 12px rgba(124, 58, 237, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    opacity: isLoading || previewCalculation.totalSlots === 0 ? 0.7 : 1,
                  }}
                >
                  {isLoading ? (
                    <>
                      <i className="fa-solid fa-spinner fa-spin"></i> Đang khởi tạo...
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-bolt"></i> Áp Dụng & Khóa Lịch Ngay ({previewCalculation.totalSlots} slot)
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: THIẾT LẬP MẪU TEMPLATE */}
          {activeTab === 'templates' && (
            <div>
              {!editingTemplate ? (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#1e293b' }}>
                        Danh Sách Mẫu Cấu Hình ({templates.length} mẫu)
                      </h4>
                      <p style={{ margin: '3px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                        Các mẫu lưu sẵn giúp bạn áp dụng ngay mà không phải thiết lập lại từ đầu
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleStartCreateTemplate}
                      style={{
                        background: '#6d28d9',
                        color: '#ffffff',
                        border: 'none',
                        padding: '8px 16px',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <i className="fa-solid fa-plus"></i> Tạo Mẫu Mới
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {templates.map((tpl) => (
                      <div
                        key={tpl.id}
                        style={{
                          border: '1px solid #e2e8f0',
                          borderRadius: '10px',
                          padding: '16px 20px',
                          background: '#ffffff',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '12px',
                          flexWrap: 'wrap',
                        }}
                      >
                        <div style={{ flex: 1, minWidth: '260px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <strong style={{ fontSize: '14.5px', color: '#0f172a' }}>{tpl.name}</strong>
                            <span style={{ fontSize: '11px', background: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                              {tpl.roomIds && tpl.roomIds.length > 0 ? `${tpl.roomIds.length} phòng` : 'Tất cả chính khóa'}
                            </span>
                          </div>
                          {tpl.description && (
                            <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#64748b' }}>{tpl.description}</p>
                          )}
                          <div style={{ display: 'flex', gap: '12px', marginTop: '8px', fontSize: '12px', color: '#475569' }}>
                            <span>
                              <strong>Ngày:</strong> {(tpl.daysOfWeek || []).map((d) => (d === 0 ? 'CN' : `T${d + 1}`)).join(', ')}
                            </span>
                            <span>•</span>
                            <span>
                              <strong>Slot:</strong> {(tpl.slotNumbers || []).map((s) => (s === 'trua' ? 'Trưa' : `Slot ${s}`)).join(', ')}
                            </span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            type="button"
                            onClick={() => handleStartEditTemplate(tpl)}
                            style={{
                              background: '#eff6ff',
                              color: '#2563eb',
                              border: '1px solid #bfdbfe',
                              padding: '6px 12px',
                              borderRadius: '6px',
                              fontSize: '12.5px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            <i className="fa-solid fa-pen"></i> Sửa
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteTemplate(tpl.id)}
                            style={{
                              background: '#fee2e2',
                              color: '#dc2626',
                              border: '1px solid #fecaca',
                              padding: '6px 12px',
                              borderRadius: '6px',
                              fontSize: '12.5px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            <i className="fa-solid fa-trash-can"></i> Xóa
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                /* Form Chỉnh sửa Mẫu */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#1e293b' }}>
                      {isCreatingNew ? 'Tạo Mẫu Lịch Định Kỳ Mới' : `Chỉnh Sửa Mẫu: ${editingTemplate.name}`}
                    </h4>
                    <button
                      type="button"
                      onClick={() => setEditingTemplate(null)}
                      style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '13px', cursor: 'pointer' }}
                    >
                      <i className="fa-solid fa-arrow-left"></i> Quay lại danh sách
                    </button>
                  </div>

                  {/* Tên & Mô tả */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
                    <div>
                      <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '4px' }}>
                        Tên Mẫu Lịch: <span style={{ color: '#dc2626' }}>*</span>
                      </label>
                      <input
                        type="text"
                        value={editingTemplate.name}
                        onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                        placeholder="VD: Lịch học kỳ Fall 2026 (T2 - T6)"
                        style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '4px' }}>
                        Người Mượn / Bộ Môn:
                      </label>
                      <input
                        type="text"
                        value={editingTemplate.borrowerName}
                        onChange={(e) => setEditingTemplate({ ...editingTemplate, borrowerName: e.target.value })}
                        placeholder="VD: Phòng Đào Tạo / Bộ môn"
                        style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px' }}
                      />
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '4px' }}>
                      Mục Đích / Ghi Chú Đơn:
                    </label>
                    <input
                      type="text"
                      value={editingTemplate.purpose}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, purpose: e.target.value })}
                      placeholder="VD: Lịch học chính khóa cố định"
                      style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13.5px' }}
                    />
                  </div>

                  {/* Chọn Ngày trong tuần */}
                  <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#334155' }}>
                        Chọn Các Ngày Trong Tuần:
                      </span>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => setEditingTemplate({ ...editingTemplate, daysOfWeek: [1, 2, 3, 4, 5] })}
                          style={{ background: '#ffffff', border: '1px solid #cbd5e1', padding: '3px 8px', borderRadius: '6px', fontSize: '11.5px', cursor: 'pointer' }}
                        >
                          Thứ 2 - Thứ 6
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingTemplate({ ...editingTemplate, daysOfWeek: [1, 2, 3, 4, 5, 6] })}
                          style={{ background: '#ffffff', border: '1px solid #cbd5e1', padding: '3px 8px', borderRadius: '6px', fontSize: '11.5px', cursor: 'pointer' }}
                        >
                          Thứ 2 - Thứ 7
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingTemplate({ ...editingTemplate, daysOfWeek: [1, 2, 3, 4, 5, 6, 0] })}
                          style={{ background: '#ffffff', border: '1px solid #cbd5e1', padding: '3px 8px', borderRadius: '6px', fontSize: '11.5px', cursor: 'pointer' }}
                        >
                          Cả tuần
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {[
                        { label: 'Thứ 2', val: 1 },
                        { label: 'Thứ 3', val: 2 },
                        { label: 'Thứ 4', val: 3 },
                        { label: 'Thứ 5', val: 4 },
                        { label: 'Thứ 6', val: 5 },
                        { label: 'Thứ 7', val: 6 },
                        { label: 'Chủ nhật', val: 0 },
                      ].map((d) => {
                        const isChecked = editingTemplate.daysOfWeek.includes(d.val);
                        return (
                          <label
                            key={d.val}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '6px 12px',
                              borderRadius: '8px',
                              background: isChecked ? '#ede9fe' : '#ffffff',
                              border: isChecked ? '1px solid #8b5cf6' : '1px solid #cbd5e1',
                              color: isChecked ? '#5b21b6' : '#334155',
                              fontWeight: isChecked ? 700 : 500,
                              cursor: 'pointer',
                              fontSize: '13px',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                const nextDays = e.target.checked
                                  ? [...editingTemplate.daysOfWeek, d.val]
                                  : editingTemplate.daysOfWeek.filter((x) => x !== d.val);
                                setEditingTemplate({ ...editingTemplate, daysOfWeek: nextDays });
                              }}
                              style={{ display: 'none' }}
                            />
                            <i className={`fa-solid ${isChecked ? 'fa-square-check' : 'fa-square'}`}></i>
                            {d.label}
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Chọn Slot */}
                  <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '6px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#334155' }}>
                        Chọn Các Khung Giờ Slot ({editingTemplate.slotNumbers.length} slot đã chọn):
                      </span>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => setEditingTemplate({ ...editingTemplate, slotNumbers: [1, 2, 3, 4] })}
                          style={{ background: '#ffffff', border: '1px solid #cbd5e1', padding: '3px 8px', borderRadius: '6px', fontSize: '11.5px', cursor: 'pointer' }}
                        >
                          Slot Sáng (1-4)
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingTemplate({ ...editingTemplate, slotNumbers: [6, 7, 8, 9] })}
                          style={{ background: '#ffffff', border: '1px solid #cbd5e1', padding: '3px 8px', borderRadius: '6px', fontSize: '11.5px', cursor: 'pointer' }}
                        >
                          Slot Chiều (6-9)
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingTemplate({ ...editingTemplate, slotNumbers: [1, 2, 3, 4, 6, 7, 8, 9] })}
                          style={{ background: '#ede9fe', border: '1px solid #8b5cf6', color: '#5b21b6', padding: '3px 8px', borderRadius: '6px', fontSize: '11.5px', cursor: 'pointer', fontWeight: 600 }}
                        >
                          Sáng + Chiều (1-4 & 6-9)
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingTemplate({ ...editingTemplate, slotNumbers: [10, 11, 12, 13, 14] })}
                          style={{ background: '#ffffff', border: '1px solid #cbd5e1', padding: '3px 8px', borderRadius: '6px', fontSize: '11.5px', cursor: 'pointer' }}
                        >
                          Slot Tối (10-14)
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingTemplate({ ...editingTemplate, slotNumbers: DEFAULT_TIME_SLOTS.map((s) => s.slotNumber) })}
                          style={{ background: '#ffffff', border: '1px solid #cbd5e1', padding: '3px 8px', borderRadius: '6px', fontSize: '11.5px', cursor: 'pointer' }}
                        >
                          Tất cả
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingTemplate({ ...editingTemplate, slotNumbers: [] })}
                          style={{ background: '#ffffff', border: '1px solid #cbd5e1', padding: '3px 8px', borderRadius: '6px', fontSize: '11.5px', cursor: 'pointer' }}
                        >
                          Bỏ chọn
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px' }}>
                      {DEFAULT_TIME_SLOTS.map((slot) => {
                        const isChecked = editingTemplate.slotNumbers.includes(slot.slotNumber);
                        return (
                          <label
                            key={slot.label}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '6px 10px',
                              borderRadius: '6px',
                              background: isChecked ? '#dcfce7' : '#ffffff',
                              border: isChecked ? '1px solid #86efac' : '1px solid #e2e8f0',
                              color: isChecked ? '#166534' : '#334155',
                              cursor: 'pointer',
                              fontSize: '12px',
                              fontWeight: isChecked ? 600 : 400,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                const nextSlots = e.target.checked
                                  ? [...editingTemplate.slotNumbers, slot.slotNumber]
                                  : editingTemplate.slotNumbers.filter((x) => x !== slot.slotNumber);
                                setEditingTemplate({ ...editingTemplate, slotNumbers: nextSlots });
                              }}
                              style={{ width: '14px', height: '14px', cursor: 'pointer' }}
                            />
                            <span>{slot.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Chọn Phòng */}
                  <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '6px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#334155' }}>
                        Phòng Học Áp Dụng ({editingTemplate.roomIds.length} / {rooms.length} phòng):
                      </span>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => setEditingTemplate({ ...editingTemplate, roomIds: rooms.map((r) => r.room_id) })}
                          style={{ background: '#ffffff', border: '1px solid #cbd5e1', padding: '3px 8px', borderRadius: '6px', fontSize: '11.5px', cursor: 'pointer' }}
                        >
                          Tất cả phòng
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setEditingTemplate({
                              ...editingTemplate,
                              roomIds: rooms.filter((r) => (r.room_type || 'chinh_khoa') === 'chinh_khoa').map((r) => r.room_id),
                            })
                          }
                          style={{ background: '#ffffff', border: '1px solid #cbd5e1', padding: '3px 8px', borderRadius: '6px', fontSize: '11.5px', cursor: 'pointer' }}
                        >
                          Chính khóa
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setEditingTemplate({
                              ...editingTemplate,
                              roomIds: rooms.filter((r) => (r.room_type || 'chinh_khoa') === 'chuc_nang').map((r) => r.room_id),
                            })
                          }
                          style={{ background: '#ffffff', border: '1px solid #cbd5e1', padding: '3px 8px', borderRadius: '6px', fontSize: '11.5px', cursor: 'pointer' }}
                        >
                          Phòng chức năng
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingTemplate({ ...editingTemplate, roomIds: [] })}
                          style={{ background: '#ffffff', border: '1px solid #cbd5e1', padding: '3px 8px', borderRadius: '6px', fontSize: '11.5px', cursor: 'pointer' }}
                        >
                          Bỏ chọn hết
                        </button>
                      </div>
                    </div>

                    <div
                      style={{
                        maxHeight: '180px',
                        overflowY: 'auto',
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                        gap: '6px',
                        background: '#ffffff',
                        padding: '8px',
                        borderRadius: '8px',
                        border: '1px solid #e2e8f0',
                      }}
                    >
                      {rooms
                        .filter((r) => {
                          const st = (r.status || '').toLowerCase();
                          return st !== 'inactive' && st !== 'maintenance';
                        })
                        .map((r) => {
                          const isChecked = editingTemplate.roomIds.includes(r.room_id);
                          return (
                            <label
                              key={r.room_id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '4px 8px',
                                borderRadius: '4px',
                                background: isChecked ? '#eff6ff' : 'transparent',
                                color: isChecked ? '#1d4ed8' : '#334155',
                                fontSize: '12px',
                                cursor: 'pointer',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  const nextRooms = e.target.checked
                                    ? [...editingTemplate.roomIds, r.room_id]
                                    : editingTemplate.roomIds.filter((x) => x !== r.room_id);
                                  setEditingTemplate({ ...editingTemplate, roomIds: nextRooms });
                                }}
                                style={{ width: '13px', height: '13px', cursor: 'pointer' }}
                              />
                              <span style={{ fontWeight: isChecked ? 600 : 400 }}>{r.room_name}</span>
                            </label>
                          );
                        })}
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                    <button
                      type="button"
                      onClick={() => setEditingTemplate(null)}
                      style={{
                        padding: '8px 16px',
                        borderRadius: '8px',
                        border: '1px solid #cbd5e1',
                        background: '#ffffff',
                        fontSize: '13px',
                        cursor: 'pointer',
                      }}
                    >
                      Hủy bỏ
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveEditingTemplate}
                      style={{
                        padding: '8px 20px',
                        borderRadius: '8px',
                        border: 'none',
                        background: '#16a34a',
                        color: '#ffffff',
                        fontSize: '13.5px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <i className="fa-solid fa-floppy-disk"></i> Lưu Cấu Hình Mẫu
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: THU HỒI / XÓA LỊCH ĐỊNH KỲ */}
          {activeTab === 'rollback' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '12px',
                  padding: '16px 20px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#991b1b', marginBottom: '8px' }}>
                  <i className="fa-solid fa-triangle-exclamation" style={{ fontSize: '18px' }}></i>
                  <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>
                    Thu Hồi & Giải Phóng Slot Lịch Định Kỳ
                  </h4>
                </div>
                <p style={{ margin: 0, fontSize: '12.5px', color: '#7f1d1d', lineHeight: 1.5 }}>
                  Tính năng này chỉ xóa các slot do <strong>Lịch định kỳ tạo ra (mã tiền tố BK_RECUR_)</strong> trong khoảng thời gian được chỉ định. Toàn bộ các đơn đặt phòng thủ công khác của giảng viên sẽ được giữ an toàn tuyệt đối.
                </p>
              </div>

              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '16px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                  <div>
                    <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '4px' }}>
                      Từ ngày:
                    </label>
                    <input
                      type="date"
                      value={rollbackStartDate}
                      onChange={(e) => setRollbackStartDate(e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '4px' }}>
                      Đến ngày:
                    </label>
                    <input
                      type="date"
                      value={rollbackEndDate}
                      onChange={(e) => setRollbackEndDate(e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '4px' }}>
                      Áp dụng phòng:
                    </label>
                    <select
                      value={rollbackRoomId}
                      onChange={(e) => setRollbackRoomId(e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                    >
                      <option value="ALL">Tất cả các phòng</option>
                      {rooms.map((r) => (
                        <option key={r.room_id} value={r.room_id}>
                          {r.room_name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="checkbox"
                    id="chkRollbackConfirm"
                    checked={rollbackConfirmed}
                    onChange={(e) => setRollbackConfirmed(e.target.checked)}
                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  <label htmlFor="chkRollbackConfirm" style={{ fontSize: '13px', color: '#b91c1c', fontWeight: 700, cursor: 'pointer' }}>
                    Xác nhận chắc chắn muốn xóa toàn bộ slot lịch định kỳ (BK_RECUR_) trong khoảng ngày này
                  </label>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                  <button
                    type="button"
                    onClick={handleExecuteRollback}
                    disabled={isLoading || !rollbackConfirmed}
                    style={{
                      background: rollbackConfirmed ? '#dc2626' : '#94a3b8',
                      color: '#ffffff',
                      border: 'none',
                      padding: '10px 20px',
                      borderRadius: '8px',
                      fontSize: '13.5px',
                      fontWeight: 700,
                      cursor: isLoading || !rollbackConfirmed ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      boxShadow: rollbackConfirmed ? '0 2px 8px rgba(220, 38, 38, 0.25)' : 'none',
                    }}
                  >
                    <i className="fa-solid fa-trash-can"></i>
                    Thu Hồi & Xóa Lịch Định Kỳ Khoảng Này
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
