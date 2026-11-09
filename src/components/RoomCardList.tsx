import React, { useState } from 'react';
import {
  Users,
  Building,
  Plus,
  CheckCircle2,
  AlertCircle,
  MapPin,
  SlidersHorizontal,
} from 'lucide-react';
import { Room } from '../types';

interface RoomCardListProps {
  rooms: Room[];
  onBookRoom: (roomId: string) => void;
}

export const RoomCardList: React.FC<RoomCardListProps> = ({ rooms, onBookRoom }) => {
  const [selectedFloor, setSelectedFloor] = useState<string>('all');
  const [minCapacity, setMinCapacity] = useState<number>(0);

  const floors = Array.from(new Set(rooms.map((r) => r.floor || 'Tầng 1')));

  const filteredRooms = rooms.filter((r) => {
    if (selectedFloor !== 'all' && (r.floor || 'Tầng 1') !== selectedFloor) return false;
    if (minCapacity > 0 && r.capacity < minCapacity) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Filter Toolbar */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-gray-200 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-blue-600" />
            Bộ Lọc Tìm Phòng Khai Thác
          </h3>
          <span className="text-xs font-semibold text-gray-500">
            Hiển thị {filteredRooms.length} / {rooms.length} phòng
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Floor filter */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Vị trí / Tầng</label>
            <select
              value={selectedFloor}
              onChange={(e) => setSelectedFloor(e.target.value)}
              className="w-full bg-gray-100 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
            >
              <option value="all">Tất cả tầng</option>
              {floors.map((fl) => (
                <option key={fl} value={fl}>
                  {fl}
                </option>
              ))}
            </select>
          </div>

          {/* Capacity filter */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Sức chứa tối thiểu (người)
            </label>
            <select
              value={minCapacity}
              onChange={(e) => setMinCapacity(Number(e.target.value))}
              className="w-full bg-gray-100 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
            >
              <option value={0}>Không giới hạn</option>
              <option value={20}>Từ 20 người trở lên</option>
              <option value={35}>Từ 35 người trở lên</option>
              <option value={50}>Từ 50 người trở lên</option>
              <option value={100}>Hội trường (từ 100 người)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Rooms Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredRooms.map((room) => (
          <div
            key={room.room_id}
            className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-xs hover:shadow-md transition-all flex flex-col justify-between group"
          >
            {/* Room Image & Status Badge */}
            <div>
              <div className="relative h-44 overflow-hidden bg-gray-100">
                {room.image_url ? (
                  <img
                    src={room.image_url}
                    alt={room.room_name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <div className="w-full h-full bg-linear-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
                    <Building className="w-12 h-12 text-blue-400" />
                  </div>
                )}

                {/* Status chip */}
                <div className="absolute top-3 right-3">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold backdrop-blur-md shadow-xs ${
                      room.status === 'Active'
                        ? 'bg-emerald-500/90 text-white'
                        : 'bg-amber-500/90 text-white'
                    }`}
                  >
                    {room.status === 'Active' ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" /> Sẵn sàng
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-3.5 h-3.5" /> Bảo trì
                      </>
                    )}
                  </span>
                </div>

                {/* Room code tag */}
                <div className="absolute bottom-3 left-3 bg-gray-900/80 backdrop-blur-md text-white text-xs font-mono font-bold px-2.5 py-1 rounded-lg">
                  {room.room_id}
                </div>
              </div>

              {/* Card Body */}
              <div className="p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-base font-bold text-gray-900 leading-snug">
                    {room.room_name}
                  </h3>
                </div>

                <div className="flex items-center gap-3 text-xs text-gray-600 font-medium">
                  <span className="flex items-center gap-1 bg-gray-100 px-2 py-1 rounded-md">
                    <MapPin className="w-3.5 h-3.5 text-blue-600" />
                    {room.floor || 'Tầng 1'} {room.building ? `(${room.building})` : ''}
                  </span>
                  <span className="flex items-center gap-1 bg-gray-100 px-2 py-1 rounded-md">
                    <Users className="w-3.5 h-3.5 text-emerald-600" />
                    Sức chứa {room.capacity} chỗ
                  </span>
                </div>

                <p className="text-xs text-gray-600 line-clamp-3 leading-relaxed">
                  {room.description || 'Phòng học trang bị đầy đủ máy chiếu, điều hòa, hệ thống âm thanh giảng dạy tiêu chuẩn.'}
                </p>
              </div>
            </div>

            {/* Action Footer */}
            <div className="p-4 bg-gray-50/80 border-t border-gray-100 flex items-center justify-between">
              <span className="text-xs text-gray-500 font-medium">Đặt phòng nhanh</span>
              <button
                onClick={() => onBookRoom(room.room_id)}
                disabled={room.status !== 'Active'}
                className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-xs font-semibold px-3.5 py-2 rounded-xl transition-all shadow-xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Đăng ký phòng
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
