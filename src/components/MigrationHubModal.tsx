import React, { useState } from 'react';
import {
  X,
  Database,
  Code2,
  Copy,
  Check,
  FileSpreadsheet,
  Terminal,
  Zap,
  ArrowRight,
  Server,
  Upload,
} from 'lucide-react';
import { SupabaseConfig } from '../types';
import { getSupabaseSqlSchema, saveSupabaseConfig } from '../lib/supabase';

interface MigrationHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  supabaseConfig: SupabaseConfig;
  onUpdateConfig: (cfg: SupabaseConfig) => void;
}

export const MigrationHubModal: React.FC<MigrationHubModalProps> = ({
  isOpen,
  onClose,
  supabaseConfig,
  onUpdateConfig,
}) => {
  const [activeTab, setActiveTab] = useState<'credentials' | 'sql' | 'importer' | 'gas'>('credentials');
  const [urlInput, setUrlInput] = useState<string>(supabaseConfig.url || '');
  const [keyInput, setKeyInput] = useState<string>(supabaseConfig.anonKey || '');
  const [copiedSql, setCopiedSql] = useState<boolean>(false);
  const [copiedGas, setCopiedGas] = useState<boolean>(false);
  const [pastedJson, setPastedJson] = useState<string>('');
  const [importStatus, setImportStatus] = useState<string>('');

  if (!isOpen) return null;

  const handleSaveCredentials = () => {
    const updated = saveSupabaseConfig(urlInput, keyInput);
    onUpdateConfig(updated);
  };

  const handleCopySql = () => {
    navigator.clipboard.writeText(getSupabaseSqlSchema());
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2500);
  };

  const sampleGasCode = `// Code.gs - Google Apps Script Proxy sang Supabase API
// Đặt file này trong Google Apps Script để kết nối Google Sheet/Form trực tiếp vào Supabase

const SUPABASE_URL = "${supabaseConfig.url || 'YOUR_SUPABASE_URL'}";
const SUPABASE_KEY = "${supabaseConfig.anonKey || 'YOUR_SUPABASE_ANON_KEY'}";

function doGet(e) {
  // Lấy danh sách lịch đặt phòng từ Supabase
  const url = SUPABASE_URL + "/rest/v1/bookings?select=*";
  const options = {
    "method": "GET",
    "headers": {
      "apikey": SUPABASE_KEY,
      "Authorization": "Bearer " + SUPABASE_KEY
    }
  };
  const response = UrlFetchApp.fetch(url, options);
  return ContentService.createTextOutput(response.getContentText())
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  // Nhận request từ Vercel/Web và lưu vào Supabase
  const data = JSON.parse(e.postData.contents);
  const url = SUPABASE_URL + "/rest/v1/bookings";
  const options = {
    "method": "POST",
    "contentType": "application/json",
    "headers": {
      "apikey": SUPABASE_KEY,
      "Authorization": "Bearer " + SUPABASE_KEY,
      "Prefer": "return=representation"
    },
    "payload": JSON.stringify(data)
  };
  const response = UrlFetchApp.fetch(url, options);
  return ContentService.createTextOutput(response.getContentText())
    .setMimeType(ContentService.MimeType.JSON);
}
`;

  const handleCopyGas = () => {
    navigator.clipboard.writeText(sampleGasCode);
    setCopiedGas(true);
    setTimeout(() => setCopiedGas(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-3xl w-full shadow-2xl border border-gray-200 overflow-hidden my-8">
        {/* Header */}
        <div className="bg-slate-900 px-6 py-5 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-600 flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Chuyển Hạ Tầng sang Supabase</h2>
              <p className="text-xs text-slate-400">
                Thay thế Google Sheet & Code.gs sang PostgreSQL Supabase hiện đại
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-gray-200 bg-gray-50 px-6">
          <button
            onClick={() => setActiveTab('credentials')}
            className={`py-3.5 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'credentials'
                ? 'border-purple-600 text-purple-600'
                : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            <Database className="w-4 h-4" />
            1. Kết Nối Supabase
          </button>

          <button
            onClick={() => setActiveTab('sql')}
            className={`py-3.5 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'sql'
                ? 'border-purple-600 text-purple-600'
                : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            <Terminal className="w-4 h-4" />
            2. Script SQL Tạo Bảng
          </button>

          <button
            onClick={() => setActiveTab('importer')}
            className={`py-3.5 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'importer'
                ? 'border-purple-600 text-purple-600'
                : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            3. Import Google Sheet
          </button>

          <button
            onClick={() => setActiveTab('gas')}
            className={`py-3.5 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'gas'
                ? 'border-purple-600 text-purple-600'
                : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            <Code2 className="w-4 h-4" />
            4. Bridge Code.gs (Nếu cần)
          </button>
        </div>

        {/* Tab 1: Supabase Credentials */}
        {activeTab === 'credentials' && (
          <div className="p-6 space-y-5">
            <div className="p-4 bg-purple-50 border border-purple-200 rounded-2xl text-xs text-purple-900 space-y-1">
              <p className="font-bold">💡 Hướng dẫn lấy Supabase Keys:</p>
              <p>
                1. Đăng nhập <strong>supabase.com</strong> -&gt; Tạo Project mới.
              </p>
              <p>
                2. Vào <strong>Project Settings</strong> -&gt; <strong>API</strong>.
              </p>
              <p>
                3. Copy <strong>Project URL</strong> và <strong>anon public key</strong> rồi dán vào bên dưới.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Supabase Project URL
                </label>
                <input
                  type="text"
                  placeholder="https://xyzcompany.supabase.co"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm font-mono text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Supabase Anon Key (Public Key)
                </label>
                <input
                  type="password"
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm font-mono text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </div>

            <div className="pt-3 flex items-center justify-between border-t border-gray-200">
              <span className="text-xs text-gray-500">
                {supabaseConfig.isConnected ? '✅ Đã kết nối Supabase' : '⚠️ Đang ở chế độ Preview Mock'}
              </span>
              <button
                onClick={handleSaveCredentials}
                className="bg-purple-600 hover:bg-purple-700 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-all shadow-md"
              >
                Lưu Cấu Hình Supabase
              </button>
            </div>
          </div>
        )}

        {/* Tab 2: SQL Script Exporter */}
        {activeTab === 'sql' && (
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-600 font-medium">
                Sao chép mã SQL bên dưới và dán trực tiếp vào tab <strong>SQL Editor</strong> trong Dashboard của Supabase:
              </p>
              <button
                onClick={handleCopySql}
                className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all shadow-xs shrink-0"
              >
                {copiedSql ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copiedSql ? 'Đã sao chép SQL!' : 'Sao chép mã SQL'}
              </button>
            </div>

            <div className="bg-slate-900 text-slate-100 p-4 rounded-2xl font-mono text-xs overflow-x-auto max-h-[350px] leading-relaxed">
              <pre>{getSupabaseSqlSchema()}</pre>
            </div>
          </div>
        )}

        {/* Tab 3: Google Sheet Importer */}
        {activeTab === 'importer' && (
          <div className="p-6 space-y-4">
            <p className="text-xs text-gray-600">
              Dán dữ liệu JSON hoặc danh sách lịch phòng từ Google Sheet hiện tại của bạn vào đây để nhập trực tiếp vào hệ thống:
            </p>

            <textarea
              rows={8}
              placeholder='[{"room_id":"room-101", "title":"Họp Ban Dự Án", "organizer_name":"Nguyễn Văn A", "booking_date":"2026-07-29", "start_time":"09:00", "end_time":"10:30"}]'
              value={pastedJson}
              onChange={(e) => setPastedJson(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs font-mono text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />

            <div className="flex items-center justify-between">
              <span className="text-xs text-emerald-600 font-semibold">{importStatus}</span>
              <button
                onClick={() => {
                  try {
                    const parsed = JSON.parse(pastedJson);
                    if (Array.isArray(parsed)) {
                      setImportStatus(`✅ Nhập thành công ${parsed.length} dòng dữ liệu!`);
                    } else {
                      setImportStatus('⚠️ Dữ liệu phải là mảng JSON hợp lệ.');
                    }
                  } catch {
                    setImportStatus('❌ Định dạng JSON không hợp lệ.');
                  }
                }}
                className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all"
              >
                <Upload className="w-3.5 h-3.5" />
                Nhập dữ liệu vào hệ thống
              </button>
            </div>
          </div>
        )}

        {/* Tab 4: GAS Bridge */}
        {activeTab === 'gas' && (
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-600 font-medium">
                Mẫu mã <code className="bg-gray-100 px-1 py-0.5 rounded font-mono text-purple-700">Code.gs</code> để thay thế logic Google Apps Script cũ:
              </p>
              <button
                onClick={handleCopyGas}
                className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all shrink-0"
              >
                {copiedGas ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copiedGas ? 'Đã chép Code.gs!' : 'Sao chép Code.gs'}
              </button>
            </div>

            <div className="bg-slate-900 text-emerald-400 p-4 rounded-2xl font-mono text-xs overflow-x-auto max-h-[320px] leading-relaxed">
              <pre>{sampleGasCode}</pre>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium px-5 py-2 rounded-xl text-sm"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
