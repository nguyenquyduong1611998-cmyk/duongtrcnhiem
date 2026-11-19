import React from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  CloudOff,
  Database,
  LogOut,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { CloudStorageState } from '../types';
import { formatDateTime } from '../utils/grading';

interface CloudStorageModalProps {
  cloud: CloudStorageState;
  localCounts: {
    accounts: number;
    topics: number;
    attempts: number;
  };
  onConnect: () => Promise<void>;
  onCancelConnect: () => void;
  onDisconnect: () => Promise<void>;
  onSyncNow: () => Promise<void>;
  onClose: () => void;
}

const EASE_SMOOTH = [0.16, 1, 0.3, 1] as const;

export const CloudStorageModal: React.FC<CloudStorageModalProps> = ({
  cloud,
  localCounts,
  onConnect,
  onCancelConnect,
  onDisconnect,
  onSyncNow,
  onClose,
}) => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cloud-storage-modal-title"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.22, ease: EASE_SMOOTH }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white border border-[#DDE3DC] rounded-xl w-full max-w-lg shadow-xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#DDE3DC] bg-[#FAFBF9] flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-[#1F4D36] text-[#F5E1A4] flex items-center justify-center shrink-0">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <h3
                id="cloud-storage-modal-title"
                className="text-base font-bold text-[#152019]"
              >
                Lưu trữ dữ liệu đám mây
              </h3>
              <p className="text-xs text-[#64756A]">
                Đồng bộ dữ liệu học tập & kết quả thi qua Firebase Firestore
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng cửa sổ"
            className="p-1.5 rounded-lg text-[#4B5B50] hover:bg-[#E7ECE7] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {cloud.error && (() => {
            const urlMatch = cloud.error.match(/https:\/\/console\.firebase\.google\.com\/[^\s)]+/);
            return (
              <div
                role="alert"
                className="flex items-start gap-2.5 p-3.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] text-xs leading-relaxed"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-2 min-w-0">
                  <p className="break-words">{cloud.error}</p>
                  {urlMatch && (
                    <a
                      href={urlMatch[0]}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white border border-[#FECACA] text-[#B91C1C] font-semibold hover:bg-[#FEE2E2] transition-colors"
                    >
                      Mở cài đặt Firebase Console
                    </a>
                  )}
                </div>
              </div>
            );
          })()}

          {!cloud.connected ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-[#FAFBF9] border border-[#DDE3DC] space-y-2">
                <div className="flex items-center gap-2 text-sm font-bold text-[#152019]">
                  <CloudOff className="w-4 h-4 text-[#64756A]" />
                  <span>Chưa đăng nhập Quản trị đám mây</span>
                </div>
                <p className="text-xs text-[#4B5B50] leading-relaxed">
                  Tài khoản học viên/khách luôn tự động nhận bộ đề và danh sách tài khoản mới nhất từ
                  Firebase Firestore mà không cần đăng nhập Google. Quản trị viên hãy kết nối Google
                  để đẩy mọi chỉnh sửa lên đám mây cho tất cả thiết bị khác.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3 rounded-lg bg-[#F4F6F4] border border-[#DDE3DC]">
                  <div className="font-mono-num text-lg font-bold text-[#152019]">
                    {localCounts.topics}
                  </div>
                  <div className="text-xs text-[#64756A]">Chuyên đề</div>
                </div>
                <div className="p-3 rounded-lg bg-[#F4F6F4] border border-[#DDE3DC]">
                  <div className="font-mono-num text-lg font-bold text-[#152019]">
                    {localCounts.attempts}
                  </div>
                  <div className="text-xs text-[#64756A]">Lượt thi</div>
                </div>
                <div className="p-3 rounded-lg bg-[#F4F6F4] border border-[#DDE3DC]">
                  <div className="font-mono-num text-lg font-bold text-[#152019]">
                    {localCounts.accounts}
                  </div>
                  <div className="text-xs text-[#64756A]">Tài khoản</div>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  disabled={cloud.syncing}
                  onClick={() => void onConnect()}
                  className="flex-1 py-2.5 px-4 bg-[#1F4D36] hover:bg-[#173B29] disabled:opacity-60 text-white text-sm font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <Cloud className="w-4 h-4" />
                  <span>
                    {cloud.syncing
                      ? 'Đang chờ xác thực Google...'
                      : 'Kết nối lưu trữ đám mây (Đăng nhập Google)'}
                  </span>
                </button>
                {cloud.syncing && (
                  <button
                    type="button"
                    onClick={onCancelConnect}
                    className="py-2.5 px-3.5 bg-[#FEF2F2] hover:bg-[#FEE2E2] text-[#B91C1C] border border-[#FECACA] text-sm font-semibold rounded-lg shrink-0 transition-colors cursor-pointer"
                  >
                    Hủy
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-[#ECFDF5] border border-[#BBF7D0] space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-bold text-[#166534]">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Đã kết nối Firebase Firestore</span>
                  </div>
                  {cloud.isCloudAdmin && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#166534] bg-white/80 border border-[#BBF7D0] px-2 py-0.5 rounded">
                      <ShieldCheck className="w-3 h-3" />
                      Quản trị đám mây
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#166534]/90">
                  Tài khoản Google: <strong>{cloud.userEmail}</strong>
                </p>
                {cloud.isCloudAdmin && (
                  <p className="text-xs text-[#166534]/85">
                    Mọi thay đổi tài khoản, bộ đề và câu hỏi sẽ tự động đồng bộ trực tiếp sang thiết bị học viên.
                  </p>
                )}
                {cloud.lastSyncedAt && (
                  <p className="text-xs text-[#166534]/80 font-mono-num">
                    Cập nhật gần nhất: {formatDateTime(cloud.lastSyncedAt)}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3 rounded-lg bg-[#FAFBF9] border border-[#DDE3DC]">
                  <div className="font-mono-num text-lg font-bold text-[#1F4D36]">
                    {cloud.cloudTopicCount}
                  </div>
                  <div className="text-xs text-[#64756A]">Chuyên đề</div>
                </div>
                <div className="p-3 rounded-lg bg-[#FAFBF9] border border-[#DDE3DC]">
                  <div className="font-mono-num text-lg font-bold text-[#1F4D36]">
                    {cloud.cloudAttemptCount}
                  </div>
                  <div className="text-xs text-[#64756A]">Lượt thi</div>
                </div>
                <div className="p-3 rounded-lg bg-[#FAFBF9] border border-[#DDE3DC]">
                  <div className="font-mono-num text-lg font-bold text-[#1F4D36]">
                    {cloud.isCloudAdmin ? cloud.cloudAccountCount : '—'}
                  </div>
                  <div className="text-xs text-[#64756A]">Tài khoản</div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={cloud.syncing}
                  onClick={() => void onSyncNow()}
                  className="flex-1 py-2.5 px-4 bg-[#1F4D36] hover:bg-[#173B29] disabled:opacity-60 text-white text-xs sm:text-sm font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <RefreshCw className={`w-4 h-4 ${cloud.syncing ? 'animate-spin' : ''}`} />
                  <span>{cloud.syncing ? 'Đang đồng bộ...' : 'Đồng bộ ngay lên đám mây'}</span>
                </button>

                <button
                  type="button"
                  disabled={cloud.syncing}
                  onClick={() => void onDisconnect()}
                  className="py-2.5 px-4 bg-[#FEF2F2] hover:bg-[#FEE2E2] text-[#B91C1C] border border-[#FECACA] text-xs sm:text-sm font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Ngắt kết nối</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};
