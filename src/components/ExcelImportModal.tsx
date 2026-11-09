import React, { useState, useRef, useEffect } from 'react';
import { Booking, Room } from '../types';
import {
  parseMultipleExcelBookingFiles,
  commitExcelBookings,
  downloadSampleExcel,
  MultiExcelImportSummary,
  ParsedExcelBookingRow,
} from '../lib/excelImporter';
import { getSavedSupabaseConfig, saveSupabaseConfig, getSupabaseClient } from '../lib/supabase';

interface ExcelImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingRooms: Room[];
  existingBookings: Booking[];
  currentUser: { username: string; fullname: string; role?: string };
  onSuccess: (message: string) => void;
}

interface UploadedFileItem {
  id: string;
  name: string;
  size: string;
  buffer: ArrayBuffer;
}

export const ExcelImportModal: React.FC<ExcelImportModalProps> = ({
  isOpen,
  onClose,
  existingRooms,
  existingBookings,
  currentUser,
  onSuccess,
}) => {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFileItem[]>([]);
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [summary, setSummary] = useState<MultiExcelImportSummary | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'all' | 'valid' | 'conflict' | 'skipped'>('all');
  const [selectedFileFilter, setSelectedFileFilter] = useState<string>('all');
  const [roomTypeFilter, setRoomTypeFilter] = useState<'all' | 'chinh_khoa' | 'chuc_nang'>('all');
  const [skipConflicts, setSkipConflicts] = useState<boolean>(true);
  const [overwriteMode, setOverwriteMode] = useState<boolean>(false);
  const [autoCreateRooms, setAutoCreateRooms] = useState<boolean>(true);
  const [isCommitting, setIsCommitting] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const PAGE_SIZE = 8;

  // Supabase connection state inside modal
  const [dbConfig, setDbConfig] = useState(() => getSavedSupabaseConfig());
  const [showConfigBox, setShowConfigBox] = useState<boolean>(false);
  const [inputUrl, setInputUrl] = useState<string>('');
  const [inputKey, setInputKey] = useState<string>('');
  const [configSaveMsg, setConfigSaveMsg] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const appendFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      const cfg = getSavedSupabaseConfig();
      setDbConfig(cfg);
      setInputUrl(cfg.url || '');
      setInputKey(cfg.anonKey || '');
      setShowConfigBox(false);
      setConfigSaveMsg('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSaveDbConfig = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputUrl.trim() || !inputKey.trim()) {
      alert('Vui lòng điền đầy đủ Supabase URL và Anon Key!');
      return;
    }
    const updated = saveSupabaseConfig(inputUrl.trim(), inputKey.trim());
    setDbConfig(updated);
    setConfigSaveMsg('Đã lưu cấu hình kết nối Supabase thành công!');
    setTimeout(() => {
      setShowConfigBox(false);
      setConfigSaveMsg('');
    }, 1500);
  };

  const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
  const MAX_FILE_COUNT = 60; // Hỗ trợ tải lên hơn 40 file cùng lúc
  const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

  const processFiles = async (fileList: File[], append: boolean = false) => {
    if (!fileList || fileList.length === 0) return;

    setErrorMsg('');

    // 1. Kiểm tra số lượng file tối đa
    const currentCount = append ? uploadedFiles.length : 0;
    if (currentCount + fileList.length > MAX_FILE_COUNT) {
      setErrorMsg(`Hệ thống giới hạn tối đa ${MAX_FILE_COUNT} file trong một lần nhập để đảm bảo an toàn bộ nhớ. Bạn đang chọn ${currentCount + fileList.length} file.`);
      return;
    }

    // 2. Kiểm tra định dạng đuôi file và dung lượng an toàn (tối đa 10MB/file)
    for (const f of fileList) {
      const lowerName = f.name.toLowerCase();
      const isValidExt = ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
      if (!isValidExt) {
        setErrorMsg(`File "${f.name}" không đúng định dạng. Chỉ hỗ trợ file Excel (.xlsx, .xls) hoặc .csv!`);
        return;
      }

      if (f.size > MAX_FILE_SIZE_BYTES) {
        const sizeMb = (f.size / (1024 * 1024)).toFixed(1);
        setErrorMsg(`File "${f.name}" có dung lượng ${sizeMb} MB, vượt quá giới hạn an toàn 10 MB/file! Vui lòng chọn file nhỏ hơn để tránh làm treo trình duyệt.`);
        return;
      }
    }

    setIsParsing(true);
    setPage(1);

    try {
      const readPromises = fileList.map(async (f) => {
        const buffer = await f.arrayBuffer();
        return {
          id: `${f.name}_${f.size}_${Date.now()}_${Math.random()}`,
          name: f.name,
          size: (f.size / 1024).toFixed(1) + ' KB',
          buffer,
        };
      });

      const newItems = await Promise.all(readPromises);

      let combined: UploadedFileItem[];
      if (append) {
        const existingNames = new Set(uploadedFiles.map((f) => f.name));
        const filteredNew = newItems.filter((f) => !existingNames.has(f.name));
        combined = [...uploadedFiles, ...filteredNew];
      } else {
        combined = newItems;
      }

      setUploadedFiles(combined);

      const result = await parseMultipleExcelBookingFiles(
        combined.map((f) => ({ name: f.name, size: f.size, buffer: f.buffer })),
        existingRooms,
        existingBookings
      );

      setSummary(result);
      if (result.validRows.length === 0 && result.conflictingRows.length > 0) {
        setActiveTab('conflict');
      } else {
        setActiveTab('all');
      }
    } catch (err: any) {
      console.error('Lỗi phân tích các file Excel:', err);
      setErrorMsg(err?.message || 'Không thể đọc file Excel. Vui lòng kiểm tra định dạng!');
    } finally {
      setIsParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (appendFileInputRef.current) appendFileInputRef.current.value = '';
    }
  };

  const handleRemoveFile = async (fileNameToRemove: string) => {
    const remaining = uploadedFiles.filter((f) => f.name !== fileNameToRemove);
    setUploadedFiles(remaining);

    if (selectedFileFilter === fileNameToRemove) {
      setSelectedFileFilter('all');
    }

    if (remaining.length === 0) {
      handleReset();
      return;
    }

    setIsParsing(true);
    try {
      const result = await parseMultipleExcelBookingFiles(
        remaining.map((f) => ({ name: f.name, size: f.size, buffer: f.buffer })),
        existingRooms,
        existingBookings
      );
      setSummary(result);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Lỗi khi cập nhật danh sách file');
    } finally {
      setIsParsing(false);
    }
  };

  const handleReset = () => {
    setUploadedFiles([]);
    setSummary(null);
    setErrorMsg('');
    setSelectedFileFilter('all');
    setOverwriteMode(false);
    setSkipConflicts(true);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (appendFileInputRef.current) {
      appendFileInputRef.current.value = '';
    }
  };

  const handleCommit = async () => {
    if (!summary) return;

    const rowsToBook: ParsedExcelBookingRow[] = skipConflicts
      ? summary.validRows
      : [...summary.validRows, ...summary.conflictingRows];

    if (rowsToBook.length === 0) {
      if (summary.conflictingRows.length > 0) {
        alert(
          `Tất cả ${summary.conflictingRows.length} slot trong các file đều trùng với lịch đã có trong hệ thống.\n\nĐể tiếp tục ghi đè hoặc đặt lại các slot này, vui lòng bỏ chọn "Tự động bỏ qua các slot đã trùng" hoặc bật tùy chọn "Ghi đè / Cập nhật lịch cũ"!`
        );
      } else {
        alert('Không có slot nào hợp lệ để đặt! Vui lòng chọn hoặc kiểm tra lại file.');
      }
      return;
    }

    const roomsToCreate = autoCreateRooms ? summary.newRoomsToCreate : [];

    setIsCommitting(true);
    setErrorMsg('');

    try {
      const res = await commitExcelBookings(rowsToBook, roomsToCreate, currentUser, overwriteMode);
      if (res.success) {
        onSuccess(res.message);
        onClose();
        handleReset();
      } else {
        setErrorMsg(res.message);
        alert(res.message);
      }
    } catch (err: any) {
      const msg = 'Lỗi đặt phòng: ' + (err?.message || err);
      setErrorMsg(msg);
      alert(msg);
    } finally {
      setIsCommitting(false);
    }
  };

  // Filtered rows for preview
  const allRows = summary
    ? [...summary.validRows, ...summary.conflictingRows].filter((r) => {
        if (selectedFileFilter === 'all') return true;
        return r.sourceFileName === selectedFileFilter;
      })
    : [];

  const allSkipped = (summary?.skippedRows || []).filter((r) => {
    if (selectedFileFilter === 'all') return true;
    return r.sourceFileName === selectedFileFilter;
  });

  const tabFiltered = activeTab === 'skipped'
    ? []
    : allRows.filter((r) => {
        if (activeTab === 'valid') return !r.hasConflict;
        if (activeTab === 'conflict') return r.hasConflict;
        return true;
      });

  const searchFiltered = activeTab === 'skipped'
    ? []
    : tabFiltered.filter((r) => {
        if (roomTypeFilter !== 'all' && r.roomType !== roomTypeFilter) {
          return false;
        }
        if (!searchTerm) return true;
        const s = searchTerm.toLowerCase();
        return (
          (r.roomName || '').toLowerCase().includes(s) ||
          (r.roomId || '').toLowerCase().includes(s) ||
          (r.teacher || '').toLowerCase().includes(s) ||
          (r.subjectCode || '').toLowerCase().includes(s) ||
          (r.className || '').toLowerCase().includes(s) ||
          (r.dateStr || '').includes(s) ||
          (r.sourceFileName || '').toLowerCase().includes(s)
        );
      });

  const totalPages = activeTab === 'skipped'
    ? Math.ceil(allSkipped.length / PAGE_SIZE) || 1
    : Math.ceil(searchFiltered.length / PAGE_SIZE) || 1;

  const paginatedRows = searchFiltered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const paginatedSkipped = allSkipped.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Statistics for room types in uploaded files
  const chinhKhoaRowsCount = allRows.filter((r) => r.roomType === 'chinh_khoa').length;
  const chucNangRowsCount = allRows.filter((r) => r.roomType === 'chuc_nang').length;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(3px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isCommitting) {
          onClose();
        }
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '14px',
          width: '100%',
          maxWidth: '960px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
          overflow: 'hidden',
          animation: 'fadeIn 0.2s ease-out',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                backgroundColor: '#107c41',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
                fontSize: '20px',
              }}
            >
              <i className="fa-solid fa-file-excel"></i>
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#1e293b' }}>
                Nhập Lịch Book Phòng Học từ File Excel
              </h3>
              <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
                Tự động book ngay các slot học và lưu vào Database hệ thống
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isCommitting}
            style={{
              border: 'none',
              background: 'transparent',
              fontSize: '20px',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '6px',
            }}
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        {/* Database Connection Status Bar */}
        <div
          style={{
            padding: '10px 24px',
            background: dbConfig.isConnected ? '#f0fdf4' : '#fffbeb',
            borderBottom: '1px solid',
            borderColor: dbConfig.isConnected ? '#bbf7d0' : '#fef3c7',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '12.5px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {dbConfig.isConnected ? (
              <>
                <i className="fa-solid fa-circle-check" style={{ color: '#16a34a', fontSize: '14px' }}></i>
                <span style={{ color: '#15803d', fontWeight: 500 }}>
                  CSDL Supabase: <b>Đã kết nối</b> ({dbConfig.url}) — Dữ liệu sẽ được lưu trực tiếp vào Supabase.
                </span>
              </>
            ) : (
              <>
                <i className="fa-solid fa-triangle-exclamation" style={{ color: '#d97706', fontSize: '14px' }}></i>
                <span style={{ color: '#b45309', fontWeight: 500 }}>
                  CSDL Supabase: <b>Chưa cấu hình</b> (Dữ liệu sẽ lưu tạm vào bộ nhớ máy).
                </span>
              </>
            )}
          </div>
          <button
            type="button"
            className="btn"
            style={{
              fontSize: '11.5px',
              padding: '4px 10px',
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              color: '#334155',
            }}
            onClick={() => setShowConfigBox(!showConfigBox)}
          >
            <i className="fa-solid fa-gear"></i> {showConfigBox ? 'Ẩn cấu hình' : 'Cấu hình Supabase'}
          </button>
        </div>

        {/* Expandable Supabase Config Box */}
        {showConfigBox && (
          <form
            onSubmit={handleSaveDbConfig}
            style={{
              padding: '16px 24px',
              background: '#f8fafc',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>
              Cài đặt thông tin kết nối Supabase:
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', color: '#475569', display: 'block', marginBottom: '4px' }}>
                  Supabase Project URL
                </label>
                <input
                  type="url"
                  placeholder="https://xyzcompany.supabase.co"
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  className="form-control"
                  style={{ fontSize: '13px', width: '100%' }}
                  required
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', color: '#475569', display: 'block', marginBottom: '4px' }}>
                  Supabase Anon Key
                </label>
                <input
                  type="password"
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                  value={inputKey}
                  onChange={(e) => setInputKey(e.target.value)}
                  className="form-control"
                  style={{ fontSize: '13px', width: '100%' }}
                  required
                />
              </div>
            </div>
            {configSaveMsg && (
              <div style={{ fontSize: '12px', color: '#16a34a', fontWeight: 500 }}>
                {configSaveMsg}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                className="btn"
                style={{ fontSize: '12px', padding: '6px 12px' }}
                onClick={() => setShowConfigBox(false)}
              >
                Hủy
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                style={{ fontSize: '12px', padding: '6px 14px' }}
              >
                Lưu & Kết nối ngay
              </button>
            </div>
          </form>
        )}

        {/* Body Content */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          {/* File Upload Zone */}
          {!summary && (
            <div>
              <div
                style={{
                  border: '2px dashed #107c41',
                  borderRadius: '12px',
                  padding: '36px 20px',
                  textAlign: 'center',
                  backgroundColor: '#f8fafc',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    processFiles(Array.from(e.dataTransfer.files), false);
                  }
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".xlsx, .xls, .csv"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      processFiles(Array.from(e.target.files), false);
                    }
                  }}
                />
                <i
                  className="fa-solid fa-cloud-arrow-up"
                  style={{ fontSize: '48px', color: '#107c41', marginBottom: '14px' }}
                ></i>
                <h4 style={{ margin: '0 0 6px 0', fontSize: '17px', color: '#1e293b', fontWeight: 600 }}>
                  Nhấp để chọn một hoặc nhiều file Excel hoặc kéo thả vào đây
                </h4>
                <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#64748b' }}>
                  Hỗ trợ tải lên <b>hàng loạt đến 60 file cùng lúc</b> (định dạng <b>.xlsx</b>, <b>.xls</b> hoặc <b>.csv</b> &bull; Giới hạn an toàn: <b>&le; 10 MB/file</b>)
                </p>
                <div style={{ display: 'inline-flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ background: '#107c41', borderColor: '#107c41', padding: '9px 20px', fontWeight: 500 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                  >
                    <i className="fa-solid fa-folder-open"></i> Chọn các file từ máy tính
                  </button>
                  <button
                    type="button"
                    className="btn"
                    style={{
                      background: '#ffffff',
                      border: '1px solid #cbd5e1',
                      color: '#334155',
                      padding: '9px 16px',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      downloadSampleExcel();
                    }}
                  >
                    <i className="fa-solid fa-download" style={{ color: '#107c41' }}></i> Tải file mẫu Excel
                  </button>
                </div>
              </div>

              {/* Format description */}
              <div
                style={{
                  marginTop: '20px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '16px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                  <i className="fa-solid fa-circle-info" style={{ color: '#2563eb' }}></i>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>
                    Quy chuẩn cấu trúc các cột trong file Excel (theo mẫu hệ thống):
                  </span>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: '10px',
                    fontSize: '12px',
                    color: '#475569',
                  }}
                >
                  <div style={{ background: '#f0fdf4', padding: '8px 10px', borderRadius: '6px', border: '1px solid #bbf7d0' }}>
                    <b style={{ color: '#166534' }}>Multi-campus & term:</b> 2 cột đầu file (nhận dạng mẫu template)
                  </div>
                  <div style={{ background: '#ffffff', padding: '8px 10px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                    <b>Day / Month / Year:</b> Ngày, tháng, năm (VD: 17 / 8 / 2026)
                  </div>
                  <div style={{ background: '#ffffff', padding: '8px 10px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                    <b>Slot:</b> Ca học (1 đến 14, tự map giờ chuẩn)
                  </div>
                  <div style={{ background: '#ffffff', padding: '8px 10px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                    <b>Room:</b> Phòng học (VD: 302, 303, R101...)
                  </div>
                  <div style={{ background: '#ffffff', padding: '8px 10px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                    <b>Teacher:</b> Mã giảng viên / Người mượn
                  </div>
                  <div style={{ background: '#ffffff', padding: '8px 10px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                    <b>subjectcode / classname:</b> Mã môn & Lớp học
                  </div>
                  <div style={{ background: '#ffffff', padding: '8px 10px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                    <b>Academic Start / End Year:</b> Năm học (VD: 2026 - 2027)
                  </div>
                  <div style={{ background: '#f0fdf4', padding: '8px 10px', borderRadius: '6px', border: '1px solid #bbf7d0' }}>
                    <b style={{ color: '#166534' }}>Có trả phí:</b> Cột cuối file (nhận dạng mẫu template)
                  </div>
                </div>
              </div>

              {isParsing && (
                <div style={{ textAlign: 'center', padding: '20px' }}>
                  <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: '28px', color: '#107c41' }}></i>
                  <p style={{ marginTop: '10px', color: '#64748b' }}>Đang phân tích các file Excel tải lên...</p>
                </div>
              )}

              {errorMsg && (
                <div
                  style={{
                    marginTop: '16px',
                    padding: '12px 16px',
                    backgroundColor: '#fee2e2',
                    border: '1px solid #fca5a5',
                    borderRadius: '8px',
                    color: '#b91c1c',
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                  }}
                >
                  <i className="fa-solid fa-triangle-exclamation"></i>
                  <span>{errorMsg}</span>
                </div>
              )}
            </div>
          )}

          {/* Parsed Summary & Preview */}
          {summary && (
            <div>
              {/* Multi-Files Management Bar */}
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '14px 16px',
                  marginBottom: '16px',
                }}
              >
                <input
                  ref={appendFileInputRef}
                  type="file"
                  multiple
                  accept=".xlsx, .xls, .csv"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      processFiles(Array.from(e.target.files), true);
                    }
                  }}
                />
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '10px',
                    marginBottom: '12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <i className="fa-solid fa-layer-group" style={{ color: '#107c41', fontSize: '18px' }}></i>
                    <strong style={{ fontSize: '14px', color: '#1e293b' }}>
                      Các file đã chọn ({uploadedFiles.length} file Excel)
                    </strong>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn"
                      style={{ fontSize: '12px', padding: '5px 12px', background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }}
                      onClick={() => appendFileInputRef.current?.click()}
                      disabled={isCommitting}
                    >
                      <i className="fa-solid fa-plus"></i> Thêm file Excel khác
                    </button>
                    <button
                      type="button"
                      className="btn"
                      style={{ fontSize: '12px', padding: '5px 12px', background: '#f1f5f9', color: '#475569' }}
                      onClick={handleReset}
                      disabled={isCommitting}
                    >
                      <i className="fa-solid fa-arrow-rotate-left"></i> Xóa tất cả & Chọn lại
                    </button>
                  </div>
                </div>

                {/* File chips */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {uploadedFiles.map((f) => {
                    const fileStat = summary.files.find((s) => s.fileName === f.name);
                    return (
                      <div
                        key={f.name}
                        style={{
                          background: '#ffffff',
                          border: '1px solid #cbd5e1',
                          borderRadius: '8px',
                          padding: '6px 10px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          fontSize: '12px',
                        }}
                      >
                        <i className="fa-solid fa-file-excel" style={{ color: '#107c41' }}></i>
                        <span style={{ fontWeight: 600, color: '#1e293b', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.name}>
                          {f.name}
                        </span>
                        <span style={{ color: '#64748b', fontSize: '11px' }}>({f.size})</span>
                        {fileStat && (
                          <span
                            style={{
                              background: fileStat.status === 'error' ? '#fee2e2' : fileStat.conflictCount > 0 ? '#fef3c7' : '#dcfce7',
                              color: fileStat.status === 'error' ? '#b91c1c' : fileStat.conflictCount > 0 ? '#92400e' : '#15803d',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: 600,
                            }}
                          >
                            {fileStat.validCount} hợp lệ{fileStat.conflictCount > 0 ? `, ${fileStat.conflictCount} trùng` : ''}
                          </span>
                        )}
                        {!isCommitting && (
                          <button
                            type="button"
                            onClick={() => handleRemoveFile(f.name)}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: '#94a3b8',
                              cursor: 'pointer',
                              padding: '2px 4px',
                              display: 'flex',
                              alignItems: 'center',
                              fontSize: '13px',
                            }}
                            title={`Xóa file ${f.name}`}
                          >
                            <i className="fa-solid fa-xmark"></i>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Stats Cards */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                  gap: '12px',
                  marginBottom: '16px',
                }}
              >
                <div
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    padding: '12px 14px',
                  }}
                >
                  <div style={{ fontSize: '12px', color: '#475569' }}>Tổng số File tải lên</div>
                  <div style={{ fontSize: '22px', fontWeight: 700, color: '#1e293b', marginTop: '2px' }}>
                    {uploadedFiles.length} file
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                    {summary.teachersCount} giảng viên/người mượn
                  </div>
                </div>

                <div
                  style={{
                    background: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    borderRadius: '10px',
                    padding: '12px 14px',
                  }}
                >
                  <div style={{ fontSize: '12px', color: '#1d4ed8' }}>Tổng số slot đọc được</div>
                  <div style={{ fontSize: '22px', fontWeight: 700, color: '#1e40af', marginTop: '2px' }}>
                    {summary.totalRows}
                  </div>
                  <div style={{ fontSize: '11px', color: '#60a5fa', marginTop: '2px' }}>
                    Từ {summary.dateRange.min || '---'} đến {summary.dateRange.max || '---'}
                  </div>
                </div>

                <div
                  style={{
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: '10px',
                    padding: '12px 14px',
                  }}
                >
                  <div style={{ fontSize: '12px', color: '#15803d' }}>Sẵn sàng book trực tiếp</div>
                  <div style={{ fontSize: '22px', fontWeight: 700, color: '#166534', marginTop: '2px' }}>
                    {summary.validRows.length}
                  </div>
                  <div style={{ fontSize: '11px', color: '#4ade80', marginTop: '2px' }}>
                    Không có xung đột
                  </div>
                </div>

                <div
                  style={{
                    background: summary.conflictingRows.length > 0 ? '#fffbeb' : '#f8fafc',
                    border: `1px solid ${summary.conflictingRows.length > 0 ? '#fde68a' : '#e2e8f0'}`,
                    borderRadius: '10px',
                    padding: '12px 14px',
                  }}
                >
                  <div style={{ fontSize: '12px', color: summary.conflictingRows.length > 0 ? '#b45309' : '#64748b' }}>
                    Slot trùng lặp / Conflict
                  </div>
                  <div
                    style={{
                      fontSize: '22px',
                      fontWeight: 700,
                      color: summary.conflictingRows.length > 0 ? '#92400e' : '#475569',
                      marginTop: '2px',
                    }}
                  >
                    {summary.conflictingRows.length}
                  </div>
                  <div style={{ fontSize: '11px', color: '#f59e0b', marginTop: '2px' }}>
                    {skipConflicts ? 'Sẽ tự động bỏ qua' : 'Sẽ cố gắng book'}
                  </div>
                </div>

                <div
                  style={{
                    background: '#f5f3ff',
                    border: '1px solid #ddd6fe',
                    borderRadius: '10px',
                    padding: '12px 14px',
                  }}
                >
                  <div style={{ fontSize: '12px', color: '#6d28d9' }}>Phòng sẽ tự động tạo</div>
                  <div style={{ fontSize: '22px', fontWeight: 700, color: '#5b21b6', marginTop: '2px' }}>
                    {summary.newRoomsToCreate.length}
                  </div>
                  <div style={{ fontSize: '11px', color: '#8b5cf6', marginTop: '2px' }}>
                    {summary.newRoomsToCreate.map((r) => r.roomId).join(', ') || 'Đã có sẵn đủ phòng'}
                  </div>
                </div>

                <div
                  style={{
                    background: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    borderRadius: '10px',
                    padding: '12px 14px',
                  }}
                >
                  <div style={{ fontSize: '12px', color: '#1e40af', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <i className="fa-solid fa-chalkboard-user"></i> Phòng chính khóa
                  </div>
                  <div style={{ fontSize: '22px', fontWeight: 700, color: '#1d4ed8', marginTop: '2px' }}>
                    {chinhKhoaRowsCount} <span style={{ fontSize: '13px', fontWeight: 500 }}>ca</span>
                  </div>
                  <div style={{ fontSize: '11px', color: '#3b82f6', marginTop: '2px' }}>
                    Giảng dạy lý thuyết / chính khóa
                  </div>
                </div>

                <div
                  style={{
                    background: '#fdf2f8',
                    border: '1px solid #fbcfe8',
                    borderRadius: '10px',
                    padding: '12px 14px',
                  }}
                >
                  <div style={{ fontSize: '12px', color: '#9d174d', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <i className="fa-solid fa-flask"></i> Phòng chức năng
                  </div>
                  <div style={{ fontSize: '22px', fontWeight: 700, color: '#be185d', marginTop: '2px' }}>
                    {chucNangRowsCount} <span style={{ fontSize: '13px', fontWeight: 500 }}>ca</span>
                  </div>
                  <div style={{ fontSize: '11px', color: '#ec4899', marginTop: '2px' }}>
                    Máy tính / Lab / Hội trường...
                  </div>
                </div>
              </div>

              {/* CẢNH BÁO TẤT CẢ SLOT ĐÃ TRÙNG (KHI UP LẠI FILE CŨ) */}
              {summary.validRows.length === 0 && summary.conflictingRows.length > 0 && (
                <div
                  style={{
                    background: '#fffbeb',
                    border: '1px solid #fde68a',
                    borderRadius: '10px',
                    padding: '14px 18px',
                    marginBottom: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <i className="fa-solid fa-triangle-exclamation" style={{ color: '#d97706', fontSize: '22px' }}></i>
                    <div>
                      <strong style={{ color: '#92400e', fontSize: '13.5px' }}>
                        Tất cả {summary.conflictingRows.length} slot trong file này ĐÃ TỒN TẠI trong CSDL (do đã book ở lần trước)!
                      </strong>
                      <p style={{ margin: '3px 0 0 0', color: '#b45309', fontSize: '12px' }}>
                        Hệ thống mặc định bảo vệ dữ liệu để không ghi đè. Nếu bạn đang tải lại file để <b>cập nhật</b> hoặc <b>ghi đè lịch mới</b>, hãy nhấn nút bên phải.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn"
                    style={{
                      background: '#d97706',
                      color: '#ffffff',
                      border: 'none',
                      padding: '8px 16px',
                      fontSize: '12.5px',
                      fontWeight: 600,
                      borderRadius: '6px',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                    onClick={() => {
                      setSkipConflicts(false);
                      setOverwriteMode(true);
                      setActiveTab('all');
                    }}
                  >
                    <i className="fa-solid fa-arrows-rotate"></i> Cho phép Ghi đè & Đặt lại ({summary.conflictingRows.length} Slot)
                  </button>
                </div>
              )}

              {/* Options */}
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '12px 16px',
                  marginBottom: '16px',
                  display: 'flex',
                  gap: '20px',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: '#334155' }}>
                  <input
                    type="checkbox"
                    checked={skipConflicts}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setSkipConflicts(checked);
                      if (checked) {
                        setOverwriteMode(false);
                      }
                    }}
                    disabled={isCommitting}
                  />
                  <span>Tự động bỏ qua các slot đã trùng (khuyên dùng khi import thêm mới)</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: '#334155' }}>
                  <input
                    type="checkbox"
                    checked={overwriteMode}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setOverwriteMode(checked);
                      if (checked) {
                        setSkipConflicts(false);
                      }
                    }}
                    disabled={isCommitting}
                  />
                  <span style={{ color: overwriteMode ? '#b45309' : '#334155', fontWeight: overwriteMode ? 600 : 400 }}>
                    <i className="fa-solid fa-arrows-rotate" style={{ marginRight: '4px', color: '#d97706' }}></i>
                    Ghi đè / Cập nhật lịch cũ (khuyên dùng khi up lại file lịch cũ hoặc đã sửa)
                  </span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: '#334155' }}>
                  <input
                    type="checkbox"
                    checked={autoCreateRooms}
                    onChange={(e) => setAutoCreateRooms(e.target.checked)}
                    disabled={isCommitting}
                  />
                  <span>Tự động tạo phòng mới nếu mã phòng chưa có trong CSDL</span>
                </label>
              </div>

              {/* Error Message Notice */}
              {errorMsg && (
                <div
                  style={{
                    marginBottom: '16px',
                    padding: '12px 16px',
                    backgroundColor: '#fee2e2',
                    border: '1px solid #fca5a5',
                    borderRadius: '8px',
                    color: '#b91c1c',
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                  }}
                >
                  <i className="fa-solid fa-triangle-exclamation"></i>
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Filter Tabs & Search */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  marginBottom: '12px',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    className="btn"
                    style={{
                      padding: '6px 14px',
                      fontSize: '13px',
                      background: activeTab === 'all' ? '#107c41' : '#f1f5f9',
                      color: activeTab === 'all' ? '#ffffff' : '#475569',
                      borderRadius: '6px',
                    }}
                    onClick={() => {
                      setActiveTab('all');
                      setPage(1);
                    }}
                  >
                    Tất cả ({allRows.length})
                  </button>
                  <button
                    className="btn"
                    style={{
                      padding: '6px 14px',
                      fontSize: '13px',
                      background: activeTab === 'valid' ? '#107c41' : '#f1f5f9',
                      color: activeTab === 'valid' ? '#ffffff' : '#475569',
                      borderRadius: '6px',
                    }}
                    onClick={() => {
                      setActiveTab('valid');
                      setPage(1);
                    }}
                  >
                    Hợp lệ ({summary.validRows.filter(r => selectedFileFilter === 'all' || r.sourceFileName === selectedFileFilter).length})
                  </button>
                  {summary.conflictingRows.length > 0 && (
                    <button
                      className="btn"
                      style={{
                        padding: '6px 14px',
                        fontSize: '13px',
                        background: activeTab === 'conflict' ? '#d97706' : '#f1f5f9',
                        color: activeTab === 'conflict' ? '#ffffff' : '#475569',
                        borderRadius: '6px',
                      }}
                      onClick={() => {
                        setActiveTab('conflict');
                        setPage(1);
                      }}
                    >
                      Trùng lặp ({summary.conflictingRows.filter(r => selectedFileFilter === 'all' || r.sourceFileName === selectedFileFilter).length})
                    </button>
                  )}
                  {summary.skippedRows && summary.skippedRows.length > 0 && (
                    <button
                      className="btn"
                      style={{
                        padding: '6px 14px',
                        fontSize: '13px',
                        background: activeTab === 'skipped' ? '#dc2626' : '#f1f5f9',
                        color: activeTab === 'skipped' ? '#ffffff' : '#b91c1c',
                        borderRadius: '6px',
                      }}
                      onClick={() => {
                        setActiveTab('skipped');
                        setPage(1);
                      }}
                    >
                      Bị bỏ qua ({allSkipped.length})
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>
                      <i className="fa-solid fa-layer-group" style={{ marginRight: '4px' }}></i> Loại phòng:
                    </span>
                    <select
                      className="form-control"
                      value={roomTypeFilter}
                      onChange={(e) => {
                        setRoomTypeFilter(e.target.value as any);
                        setPage(1);
                      }}
                      style={{ fontSize: '12px', padding: '4px 8px', height: '34px', minWidth: '150px' }}
                    >
                      <option value="all">Tất cả loại phòng</option>
                      <option value="chinh_khoa">🏛️ Chính khóa ({chinhKhoaRowsCount})</option>
                      <option value="chuc_nang">🔬 Chức năng ({chucNangRowsCount})</option>
                    </select>
                  </div>

                  {uploadedFiles.length > 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>
                        <i className="fa-solid fa-filter" style={{ marginRight: '4px' }}></i> Lọc file:
                      </span>
                      <select
                        className="form-control"
                        value={selectedFileFilter}
                        onChange={(e) => {
                          setSelectedFileFilter(e.target.value);
                          setPage(1);
                        }}
                        style={{ fontSize: '12px', padding: '4px 8px', height: '34px', minWidth: '150px' }}
                      >
                        <option value="all">Tất cả ({uploadedFiles.length} file)</option>
                        {uploadedFiles.map((f) => (
                          <option key={f.name} value={f.name}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      placeholder="Tìm theo phòng, GV, môn..."
                      value={searchTerm}
                      onChange={(e) => {
                        setSearchTerm(e.target.value);
                        setPage(1);
                      }}
                      className="form-control"
                      style={{ padding: '6px 12px 6px 30px', fontSize: '13px', width: '200px' }}
                    />
                    <i
                      className="fa-solid fa-magnifying-glass"
                      style={{
                        position: 'absolute',
                        left: '10px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: '#94a3b8',
                        fontSize: '12px',
                      }}
                    ></i>
                  </div>
                </div>
              </div>

              {/* Preview Table */}
              <div
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  overflow: 'hidden',
                  background: '#ffffff',
                }}
              >
                <div style={{ overflowX: 'auto', maxHeight: '280px' }}>
                  {activeTab === 'skipped' ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                      <thead>
                        <tr style={{ background: '#fef2f2', borderBottom: '1px solid #fecaca', textAlign: 'left', color: '#991b1b' }}>
                          <th style={{ padding: '10px 12px' }}>STT</th>
                          {uploadedFiles.length > 1 && <th style={{ padding: '10px 12px' }}>File</th>}
                          <th style={{ padding: '10px 12px' }}>Dòng trong File</th>
                          <th style={{ padding: '10px 12px' }}>Lý do không đọc được</th>
                          <th style={{ padding: '10px 12px' }}>Dữ liệu thô</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedSkipped.length === 0 ? (
                          <tr>
                            <td colSpan={uploadedFiles.length > 1 ? 5 : 4} style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>
                              Không có dòng nào bị bỏ qua.
                            </td>
                          </tr>
                        ) : (
                          paginatedSkipped.map((sr, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid #fecaca', background: '#fff5f5' }}>
                              <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{(page - 1) * PAGE_SIZE + idx + 1}</td>
                              {uploadedFiles.length > 1 && (
                                <td style={{ padding: '8px 12px' }}>
                                  <span style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
                                    {sr.sourceFileName || 'File'}
                                  </span>
                                </td>
                              )}
                              <td style={{ padding: '8px 12px', fontWeight: 600, color: '#dc2626' }}>Dòng #{sr.rowIndex}</td>
                              <td style={{ padding: '8px 12px', color: '#b91c1c' }}>{sr.reason}</td>
                              <td style={{ padding: '8px 12px', color: '#64748b', fontSize: '11px', fontFamily: 'monospace' }}>
                                {JSON.stringify(sr.rawRow).slice(0, 80)}...
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#475569' }}>
                          <th style={{ padding: '10px 12px' }}>STT</th>
                          {uploadedFiles.length > 1 && <th style={{ padding: '10px 12px' }}>File Nguồn</th>}
                          <th style={{ padding: '10px 12px' }}>Ngày</th>
                          <th style={{ padding: '10px 12px' }}>Slot / Khung Giờ</th>
                          <th style={{ padding: '10px 12px' }}>Phòng</th>
                          <th style={{ padding: '10px 12px' }}>Giảng Viên / Người Mượn</th>
                          <th style={{ padding: '10px 12px' }}>Môn / Lớp</th>
                          <th style={{ padding: '10px 12px' }}>Trạng Thái Slot</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedRows.length === 0 ? (
                          <tr>
                            <td colSpan={uploadedFiles.length > 1 ? 8 : 7} style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>
                              Không tìm thấy dòng dữ liệu nào phù hợp.
                            </td>
                          </tr>
                        ) : (
                          paginatedRows.map((r, idx) => {
                            const rowNum = (page - 1) * PAGE_SIZE + idx + 1;
                            return (
                              <tr
                                key={idx}
                                style={{
                                  borderBottom: '1px solid #f1f5f9',
                                  backgroundColor: r.hasConflict ? '#fffdf5' : 'transparent',
                                }}
                              >
                                <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{rowNum}</td>
                                {uploadedFiles.length > 1 && (
                                  <td style={{ padding: '8px 12px' }}>
                                    <span
                                      style={{
                                        background: '#f1f5f9',
                                        color: '#334155',
                                        border: '1px solid #cbd5e1',
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                        fontSize: '11px',
                                        fontWeight: 500,
                                        maxWidth: '130px',
                                        display: 'inline-block',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                      }}
                                      title={r.sourceFileName}
                                    >
                                      {r.sourceFileName || 'File'}
                                    </span>
                                  </td>
                                )}
                                <td style={{ padding: '8px 12px', fontWeight: 500, color: '#1e293b' }}>
                                  {r.dateStr}
                                </td>
                                <td style={{ padding: '8px 12px' }}>
                                  <span
                                    style={{
                                      background: '#e0f2fe',
                                      color: '#0369a1',
                                      padding: '2px 8px',
                                      borderRadius: '4px',
                                      fontWeight: 600,
                                      fontSize: '11.5px',
                                    }}
                                  >
                                    Slot {r.slot}
                                  </span>
                                  <span style={{ marginLeft: '6px', color: '#64748b', fontSize: '11.5px' }}>
                                    ({r.slotTimeRange})
                                  </span>
                                </td>
                                <td style={{ padding: '8px 12px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                    <b style={{ color: '#0f172a' }}>{r.roomName}</b>
                                    {r.roomType === 'chuc_nang' ? (
                                      <span
                                        style={{
                                          background: '#fdf2f8',
                                          color: '#be185d',
                                          border: '1px solid #fbcfe8',
                                          padding: '2px 7px',
                                          borderRadius: '4px',
                                          fontSize: '11px',
                                          fontWeight: 700,
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '3px',
                                        }}
                                        title="Phòng chức năng (Tin học, Lab, Hội trường...)"
                                      >
                                        <i className="fa-solid fa-flask" style={{ fontSize: '10px' }}></i> Chức năng
                                      </span>
                                    ) : (
                                      <span
                                        style={{
                                          background: '#eff6ff',
                                          color: '#1d4ed8',
                                          border: '1px solid #bfdbfe',
                                          padding: '2px 7px',
                                          borderRadius: '4px',
                                          fontSize: '11px',
                                          fontWeight: 700,
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '3px',
                                        }}
                                        title="Phòng học lý thuyết chính khóa tiêu chuẩn"
                                      >
                                        <i className="fa-solid fa-chalkboard-user" style={{ fontSize: '10px' }}></i> Chính khóa
                                      </span>
                                    )}
                                    {r.isNewRoom && (
                                      <span
                                        style={{
                                          background: '#f3e8ff',
                                          color: '#7e22ce',
                                          padding: '1px 6px',
                                          borderRadius: '4px',
                                          fontSize: '10px',
                                        }}
                                      >
                                        Tạo mới
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td style={{ padding: '8px 12px', color: '#334155' }}>
                                  <i className="fa-solid fa-user-tag" style={{ color: '#2563eb', marginRight: '6px' }}></i>
                                  <span style={{ fontWeight: 600 }}>{r.teacher}</span>
                                </td>
                                <td style={{ padding: '8px 12px' }}>
                                  <span style={{ fontWeight: 500, color: '#1e293b' }}>{r.subjectCode || '---'}</span>
                                  {r.className && (
                                    <span
                                      style={{
                                        marginLeft: '6px',
                                        background: '#f1f5f9',
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                        color: '#475569',
                                        fontSize: '11px',
                                      }}
                                    >
                                      {r.className}
                                    </span>
                                  )}
                                </td>
                                <td style={{ padding: '8px 12px' }}>
                                  {r.hasConflict ? (
                                    <span
                                      style={{
                                        background: '#fef3c7',
                                        color: '#b45309',
                                        padding: '2px 8px',
                                        borderRadius: '4px',
                                        fontSize: '11.5px',
                                        fontWeight: 500,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                      }}
                                      title={r.conflictReason}
                                    >
                                      <i className="fa-solid fa-triangle-exclamation"></i>
                                      Trùng slot
                                    </span>
                                  ) : (
                                    <span
                                      style={{
                                        background: '#dcfce7',
                                        color: '#15803d',
                                        padding: '2px 8px',
                                        borderRadius: '4px',
                                        fontSize: '11.5px',
                                        fontWeight: 500,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                      }}
                                    >
                                      <i className="fa-solid fa-check"></i>
                                      Sẵn sàng book
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div
                    style={{
                      padding: '8px 14px',
                      borderTop: '1px solid #f1f5f9',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: '#f8fafc',
                      fontSize: '12px',
                    }}
                  >
                    <span style={{ color: '#64748b' }}>
                      Hiển thị {activeTab === 'skipped' ? paginatedSkipped.length : paginatedRows.length}/
                      {activeTab === 'skipped' ? (summary.skippedRows?.length || 0) : searchFiltered.length} dòng
                    </span>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <button
                        className="btn"
                        style={{ padding: '4px 8px', fontSize: '11px' }}
                        disabled={page === 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                      >
                        <i className="fa-solid fa-chevron-left"></i>
                      </button>
                      <span style={{ color: '#475569', fontWeight: 500 }}>
                        Trang {page} / {totalPages}
                      </span>
                      <button
                        className="btn"
                        style={{ padding: '4px 8px', fontSize: '11px' }}
                        disabled={page === totalPages}
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      >
                        <i className="fa-solid fa-chevron-right"></i>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid #e2e8f0',
            background: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              className="btn"
              style={{
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#334155',
                fontSize: '13px',
              }}
              onClick={downloadSampleExcel}
            >
              <i className="fa-solid fa-file-arrow-down" style={{ color: '#107c41' }}></i> Tải file mẫu Excel
            </button>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              className="btn"
              style={{
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#475569',
              }}
              onClick={onClose}
              disabled={isCommitting}
            >
              Đóng
            </button>

            {summary && (
              <button
                type="button"
                className="btn btn-primary"
                style={{
                  background:
                    skipConflicts && summary.validRows.length === 0 && summary.conflictingRows.length > 0
                      ? '#d97706'
                      : '#107c41',
                  borderColor:
                    skipConflicts && summary.validRows.length === 0 && summary.conflictingRows.length > 0
                      ? '#d97706'
                      : '#107c41',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
                onClick={() => {
                  if (skipConflicts && summary.validRows.length === 0 && summary.conflictingRows.length > 0) {
                    setSkipConflicts(false);
                    setOverwriteMode(true);
                    return;
                  }
                  handleCommit();
                }}
                disabled={isCommitting || summary.totalRows === 0}
              >
                {isCommitting ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin"></i> Đang ghi vào Database...
                  </>
                ) : skipConflicts && summary.validRows.length === 0 && summary.conflictingRows.length > 0 ? (
                  <>
                    <i className="fa-solid fa-arrows-rotate"></i>
                    Bấm để Cho Phép Ghi Đè ({summary.conflictingRows.length} Slot)
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-database"></i>
                    Xác nhận & Lưu Database ({skipConflicts ? summary.validRows.length : summary.totalRows} Slot từ {uploadedFiles.length} file)
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
