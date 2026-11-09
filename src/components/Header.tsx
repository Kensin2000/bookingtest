import React from 'react';
import {
  Calendar,
  Building2,
  ListOrdered,
  BarChart3,
  Database,
  Plus,
  Search,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  UserCheck,
  ShieldCheck,
  User,
  LogOut,
  Crown,
} from 'lucide-react';
import { SupabaseConfig, UserAccount } from '../types';

interface HeaderProps {
  activeTab: 'schedule' | 'rooms' | 'bookings' | 'analytics';
  setActiveTab: (tab: 'schedule' | 'rooms' | 'bookings' | 'analytics') => void;
  supabaseConfig: SupabaseConfig;
  onOpenBookingModal: () => void;
  onOpenMigrationModal: () => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  currentUser: UserAccount;
  onSwitchUser: (username: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  supabaseConfig,
  onOpenBookingModal,
  onOpenMigrationModal,
  searchQuery,
  setSearchQuery,
  currentUser,
  onSwitchUser,
}) => {
  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-30 shadow-xs">
      {/* Top Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3 min-w-max">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-gray-900 tracking-tight">
                  VUTH BOOKING
                </h1>
                <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                  Material UI
                </span>
              </div>
              <p className="text-xs text-gray-500 hidden sm:block">
                Hệ Thống Đặt Phòng Học • Tích hợp Supabase
              </p>
            </div>
          </div>

          {/* Search bar */}
          <div className="flex-1 max-w-sm hidden md:block">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Tìm phòng, mã đơn, giảng viên..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-gray-100/80 border border-transparent rounded-full text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
              />
            </div>
          </div>

          {/* User Role Switcher & Database Status */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* User Chip & Role Switcher */}
            <div className="flex items-center gap-2 bg-gray-100 p-1.5 rounded-full border border-gray-200">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-white text-gray-800 shadow-xs">
                {currentUser.role === 'superadmin' ? (
                  <Crown className="w-3.5 h-3.5 text-purple-600" />
                ) : currentUser.role === 'admin' ? (
                  <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                ) : (
                  <User className="w-3.5 h-3.5 text-emerald-600" />
                )}
                <span className="max-w-[120px] truncate">{currentUser.fullname}</span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold ${
                    currentUser.role === 'superadmin'
                      ? 'bg-purple-100 text-purple-800'
                      : currentUser.role === 'admin'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {currentUser.role}
                </span>
              </div>

              {/* Role Switch Dropdown */}
              <select
                value={currentUser.username}
                onChange={(e) => onSwitchUser(e.target.value)}
                className="text-xs font-medium bg-transparent border-none focus:outline-none pr-2 cursor-pointer text-gray-700"
                title="Chuyển đổi tài khoản thử nghiệm"
              >
                <option value="superadmin">Super Admin (superadmin)</option>
                <option value="admin">Quản trị (admin)</option>
                <option value="teacher1">Giảng viên (teacher1)</option>
                <option value="teacher2">Giảng viên (teacher2)</option>
              </select>
            </div>

            {/* Supabase status indicator badge */}
            <button
              onClick={onOpenMigrationModal}
              className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                supabaseConfig.isConnected
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                  : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
              }`}
              title="Nhấn để cấu hình Supabase hoặc chuyển đổi từ Google Sheet"
            >
              <Database className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">
                {supabaseConfig.isConnected ? 'Supabase Connected' : 'Supabase Setup'}
              </span>
              {supabaseConfig.isConnected ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
              )}
            </button>

            {/* Quick new booking FAB/Button */}
            <button
              onClick={onOpenBookingModal}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium text-xs sm:text-sm px-3.5 py-2 rounded-full shadow-md hover:shadow-lg transition-all"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Đăng ký phòng</span>
            </button>
          </div>
        </div>
      </div>

      {/* Navigation Tabs (Material Design 3 Segmented Navigation) */}
      <div className="border-t border-gray-100 bg-gray-50/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-1 sm:space-x-2 py-2 overflow-x-auto scrollbar-none">
            <button
              onClick={() => setActiveTab('schedule')}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === 'schedule'
                  ? 'bg-blue-100 text-blue-800 font-semibold shadow-xs'
                  : 'text-gray-600 hover:bg-gray-200/60 hover:text-gray-900'
              }`}
            >
              <Calendar className="w-4 h-4" />
              Lịch Đặt Phòng
            </button>

            <button
              onClick={() => setActiveTab('rooms')}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === 'rooms'
                  ? 'bg-blue-100 text-blue-800 font-semibold shadow-xs'
                  : 'text-gray-600 hover:bg-gray-200/60 hover:text-gray-900'
              }`}
            >
              <Building2 className="w-4 h-4" />
              Danh Sách Phòng Học
            </button>

            <button
              onClick={() => setActiveTab('bookings')}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === 'bookings'
                  ? 'bg-blue-100 text-blue-800 font-semibold shadow-xs'
                  : 'text-gray-600 hover:bg-gray-200/60 hover:text-gray-900'
              }`}
            >
              <ListOrdered className="w-4 h-4" />
              Nhật Ký Đặt Phòng
            </button>

            <button
              onClick={() => setActiveTab('analytics')}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === 'analytics'
                  ? 'bg-blue-100 text-blue-800 font-semibold shadow-xs'
                  : 'text-gray-600 hover:bg-gray-200/60 hover:text-gray-900'
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              Bảng Điều Khiển
            </button>

            <button
              onClick={onOpenMigrationModal}
              className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ml-auto text-purple-700 hover:bg-purple-50 border border-purple-200"
            >
              <Sparkles className="w-4 h-4 text-purple-600" />
              Cấu Hình Supabase / Code.gs
            </button>
          </nav>
        </div>
      </div>
    </header>
  );
};
