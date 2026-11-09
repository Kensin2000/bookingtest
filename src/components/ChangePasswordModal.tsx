import React, { useState } from 'react';
import { apiChangePassword, isDefaultPassword } from '../lib/supabase';
import { UserAccount } from '../types';

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: { username: string; fullname: string; role?: string };
  initialOldPassword?: string;
  isForceChange?: boolean;
  onSuccess: (newPassword?: string) => void;
  onCancelForce?: () => void;
}

export const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({
  isOpen,
  onClose,
  user,
  initialOldPassword = '',
  isForceChange = false,
  onSuccess,
  onCancelForce,
}) => {
  const [oldPassword, setOldPassword] = useState<string>(initialOldPassword);
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [showOldPass, setShowOldPass] = useState<boolean>(false);
  const [showNewPass, setShowNewPass] = useState<boolean>(false);
  const [showConfirmPass, setShowConfirmPass] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const cleanNew = newPassword.trim();
    const cleanConfirm = confirmPassword.trim();
    const cleanOld = oldPassword.trim();

    if (!cleanOld) {
      setErrorMsg('Vui lòng nhập mật khẩu hiện tại!');
      return;
    }

    if (!cleanNew) {
      setErrorMsg('Vui lòng nhập mật khẩu mới!');
      return;
    }

    if (cleanNew.length < 6) {
      setErrorMsg('Mật khẩu mới phải có tối thiểu 6 ký tự!');
      return;
    }

    if (cleanNew === cleanOld) {
      setErrorMsg('Mật khẩu mới phải khác với mật khẩu hiện tại!');
      return;
    }

    if (cleanNew !== cleanConfirm) {
      setErrorMsg('Xác nhận mật khẩu mới không trùng khớp!');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiChangePassword(user.username, cleanNew, cleanOld);
      if (res.success) {
        setNewPassword('');
        setConfirmPassword('');
        setErrorMsg('');
        onSuccess(cleanNew);
      } else {
        setErrorMsg(res.message);
      }
    } catch (err: any) {
      setErrorMsg('Lỗi cập nhật mật khẩu: ' + (err?.message || err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(4px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isForceChange && !isSubmitting) {
          onClose();
        }
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '14px',
          width: '100%',
          maxWidth: '480px',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
          overflow: 'hidden',
          animation: 'fadeIn 0.2s ease-out',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: isForceChange
              ? 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)'
              : 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '10px',
                backgroundColor: isForceChange ? '#ea580c' : '#2563eb',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
                fontSize: '20px',
              }}
            >
              <i className={isForceChange ? 'fa-solid fa-shield-halved' : 'fa-solid fa-key'}></i>
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 600, color: '#1e293b' }}>
                {isForceChange ? 'Yêu Cầu Đổi Mật Khẩu Lần Đầu' : 'Đổi Mật Khẩu Tài Khoản'}
              </h3>
              <p style={{ margin: 0, fontSize: '12.5px', color: '#64748b' }}>
                {isForceChange
                  ? 'Phát hiện mật khẩu mặc định (123456)'
                  : 'Cập nhật mật khẩu mới để bảo mật'}
              </p>
            </div>
          </div>
          {!isForceChange && (
            <button
              onClick={onClose}
              disabled={isSubmitting}
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
          )}
        </div>

        {/* Notice for Force Change */}
        {isForceChange && (
          <div
            style={{
              padding: '12px 24px',
              background: '#fffbeb',
              borderBottom: '1px solid #fef3c7',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              fontSize: '12.5px',
              color: '#b45309',
            }}
          >
            <i className="fa-solid fa-triangle-exclamation" style={{ marginTop: '2px', fontSize: '14px' }}></i>
            <div>
              Hệ thống phát hiện bạn đang dùng <b>mật khẩu mặc định (123456)</b> do quản trị viên cấp.
              Vì lý do an toàn bảo mật, bạn <b>bắt buộc phải đổi sang mật khẩu riêng</b> trước khi truy cập hệ thống.
            </div>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ padding: '20px 24px', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {/* User display */}
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '10px 14px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '13px',
            }}
          >
            <div>
              <span style={{ color: '#64748b' }}>Tài khoản: </span>
              <b style={{ color: '#0f172a' }}>{user.fullname}</b>{' '}
              <span style={{ color: '#94a3b8' }}>({user.username})</span>
            </div>
            {user.role && (
              <span
                style={{
                  background:
                    user.role === 'superadmin'
                      ? '#f3e8ff'
                      : user.role === 'admin'
                      ? '#dcfce7'
                      : '#e0f2fe',
                  color:
                    user.role === 'superadmin'
                      ? '#7e22ce'
                      : user.role === 'admin'
                      ? '#166534'
                      : '#0369a1',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                {user.role === 'superadmin' && '👑 '}
                {user.role.toUpperCase()}
              </span>
            )}
          </div>

          {/* Old Password */}
          <div style={{ marginBottom: '14px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: '#334155', display: 'block', marginBottom: '6px' }}>
              Mật khẩu hiện tại / mặc định:
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showOldPass ? 'text' : 'password'}
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                required
                className="form-control"
                placeholder="Nhập mật khẩu hiện tại (ví dụ: 123456)"
                style={{ width: '100%', paddingRight: '40px' }}
                disabled={isSubmitting}
              />
              <button
                type="button"
                onClick={() => setShowOldPass(!showOldPass)}
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: '4px',
                }}
              >
                <i className={showOldPass ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'}></i>
              </button>
            </div>
          </div>

          {/* New Password */}
          <div style={{ marginBottom: '14px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: '#334155', display: 'block', marginBottom: '6px' }}>
              Mật khẩu mới:
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showNewPass ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                className="form-control"
                placeholder="Nhập mật khẩu mới (tối thiểu 6 ký tự)"
                style={{ width: '100%', paddingRight: '40px' }}
                disabled={isSubmitting}
              />
              <button
                type="button"
                onClick={() => setShowNewPass(!showNewPass)}
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: '4px',
                }}
              >
                <i className={showNewPass ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'}></i>
              </button>
            </div>
            <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '4px' }}>
              * Tối thiểu 6 ký tự và không được trùng với mật khẩu mặc định (123456).
            </div>
          </div>

          {/* Confirm Password */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: '#334155', display: 'block', marginBottom: '6px' }}>
              Xác nhận mật khẩu mới:
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showConfirmPass ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="form-control"
                placeholder="Nhập lại mật khẩu mới"
                style={{ width: '100%', paddingRight: '40px' }}
                disabled={isSubmitting}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPass(!showConfirmPass)}
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: '4px',
                }}
              >
                <i className={showConfirmPass ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'}></i>
              </button>
            </div>
          </div>

          {/* Error Message */}
          {errorMsg && (
            <div
              style={{
                marginBottom: '16px',
                padding: '10px 14px',
                backgroundColor: '#fee2e2',
                border: '1px solid #fca5a5',
                borderRadius: '8px',
                color: '#b91c1c',
                fontSize: '12.5px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <i className="fa-solid fa-circle-exclamation"></i>
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', marginTop: '20px', flexWrap: 'wrap' }}>
            {isForceChange && (
              <button
                type="button"
                className="btn"
                style={{
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  color: '#64748b',
                  fontSize: '12px',
                  marginRight: 'auto',
                }}
                onClick={() => onSuccess()}
                disabled={isSubmitting}
                title="Bỏ qua bước đổi mật khẩu và tiếp tục vào hệ thống"
              >
                <i className="fa-solid fa-forward"></i> Bỏ qua lần này & Vào hệ thống
              </button>
            )}

            {isForceChange ? (
              <button
                type="button"
                className="btn"
                style={{
                  background: '#f1f5f9',
                  color: '#475569',
                  fontSize: '13px',
                }}
                onClick={onCancelForce}
                disabled={isSubmitting}
              >
                Quay lại đăng nhập
              </button>
            ) : (
              <button
                type="button"
                className="btn"
                style={{
                  background: '#f1f5f9',
                  color: '#475569',
                  fontSize: '13px',
                }}
                onClick={onClose}
                disabled={isSubmitting}
              >
                Hủy bỏ
              </button>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              style={{
                background: isForceChange ? '#ea580c' : 'var(--primary)',
                borderColor: isForceChange ? '#ea580c' : 'var(--primary)',
                fontWeight: 600,
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <i className="fa-solid fa-spinner fa-spin"></i> Đang lưu mật khẩu...
                </>
              ) : (
                <>
                  <i className="fa-solid fa-check"></i>
                  {isForceChange ? 'Lưu mật khẩu mới & Vào hệ thống' : 'Cập nhật mật khẩu'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
