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
  onTestWrite?: () => Promise<void>;
  onCreateTestTopic?: () => Promise<void>;
  onReadTestTopic?: () => Promise<void>;
  onDeleteTestTopic?: () => Promise<void>;
  onCreateTestAccount?: () => Promise<void>;
  onReadTestAccount?: () => Promise<void>;
  onDeleteTestAccount?: () => Promise<void>;
  disableBulkSync?: boolean;
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
  onTestWrite,
  onCreateTestTopic,
  onReadTestTopic,
  onDeleteTestTopic,
  onCreateTestAccount,
  onReadTestAccount,
  onDeleteTestAccount,
  disableBulkSync = false,
  onClose,
}) => {
  const [testStatus, setTestStatus] = React.useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = React.useState('');

  const handleTestWrite = async () => {
    if (!onTestWrite) return;
    setTestStatus('running');
    setTestMessage('');
    try {
      await onTestWrite();
      setTestStatus('success');
      setTestMessage('Thành công: Firebase cho phép Admin ghi, đọc lại và xóa dữ liệu thử. Không tải tài khoản hoặc kết quả thi lên đám mây.');
    } catch (error) {
      setTestStatus('error');
      const detail = error instanceof Error ? error.message : String(error);
      setTestMessage(`Kiểm thử chưa thành công: ${detail}`);
    }
  };

  const [topicTestBusy, setTopicTestBusy] = React.useState(false);
  const [topicTestMessage, setTopicTestMessage] = React.useState('');
  const [topicTestError, setTopicTestError] = React.useState(false);
  const handleTopicTest = async (fn: () => Promise<void>, success: string) => {
    setTopicTestBusy(true);
    setTopicTestError(false);
    setTopicTestMessage('');
    try {
      await fn();
      setTopicTestMessage(success);
    } catch (error) {
      setTopicTestError(true);
      setTopicTestMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setTopicTestBusy(false);
    }
  };

  const [accountTestBusy, setAccountTestBusy] = React.useState(false);
  const [accountTestMessage, setAccountTestMessage] = React.useState('');
  const [accountTestError, setAccountTestError] = React.useState(false);
  const handleAccountTest = async (fn: () => Promise<void>, success: string) => {
    setAccountTestBusy(true);
    setAccountTestError(false);
    setAccountTestMessage('');
    try {
      await fn();
      setAccountTestMessage(success);
    } catch (error) {
      setAccountTestError(true);
      setAccountTestMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAccountTestBusy(false);
    }
  };

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
        className="bg-white border border-[#DDE3DC] rounded-xl w-full max-w-lg max-h-[90vh] shadow-xl overflow-y-auto"
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
                  {disableBulkSync
                    ? 'Đây là phiên bản thử nghiệm. Chỉ sử dụng dữ liệu giả để kiểm tra Firebase; đồng bộ tài khoản học viên thật đang bị khóa.'
                    : 'Tài khoản học viên/khách có thể nhận bộ đề công khai từ Firebase. Quản trị viên cần đăng nhập Google để quản lý dữ liệu.'}
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
                    {disableBulkSync
                      ? 'Đang kiểm thử trên Firebase staging. Đồng bộ tài khoản, bộ đề và kết quả thật đang bị khóa để bảo vệ dữ liệu.'
                      : 'Mọi thay đổi tài khoản, bộ đề và câu hỏi sẽ tự động đồng bộ trực tiếp sang thiết bị học viên.'}
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

              {onTestWrite && cloud.isCloudAdmin && (
                <div className="space-y-2 border border-[#DDE3DC] bg-[#FAFBF9] p-3 rounded-lg">
                  <button
                    type="button"
                    disabled={testStatus === 'running' || cloud.syncing}
                    onClick={() => void handleTestWrite()}
                    className="w-full py-2.5 px-3 rounded-md border border-[#1F4D36] text-[#1F4D36] disabled:opacity-60 text-sm font-semibold hover:bg-[#EAF2EC] transition-colors"
                  >
                    {testStatus === 'running' ? 'Đang kiểm tra quyền ghi Firebase...' : 'Kiểm tra quyền ghi Firebase (dữ liệu giả)'}
                  </button>
                  <p className="text-xs text-[#4B5B50]">
                    Chỉ thử ghi, đọc và xóa một bản ghi kỹ thuật. Không đồng bộ chuyên đề, tài khoản hay bài thi đang có.
                  </p>
                  {testStatus !== 'idle' && testStatus !== 'running' && (
                    <p role="status" className={`text-xs ${testStatus === 'success' ? 'text-[#166534]' : 'text-[#B91C1C]'}`}>
                      {testMessage}
                    </p>
                  )}
                </div>
              )}

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={cloud.syncing || disableBulkSync}
                  onClick={() => void onSyncNow()}
                  className="flex-1 py-2.5 px-4 bg-[#1F4D36] hover:bg-[#173B29] disabled:opacity-60 text-white text-xs sm:text-sm font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <RefreshCw className={`w-4 h-4 ${cloud.syncing ? 'animate-spin' : ''}`} />
                  <span>{disableBulkSync ? 'Đồng bộ toàn bộ đang khóa trên staging' : cloud.syncing ? 'Đang đồng bộ...' : 'Đồng bộ ngay lên đám mây'}</span>
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
          {onReadTestTopic && (
            <div className="space-y-2 rounded-xl border border-[#DDE3DC] bg-[#FAFBF9] p-3">
              <p className="text-sm font-bold text-[#152019]">Kiểm tra đồng bộ chuyên đề giả</p>
              <p className="text-xs leading-relaxed text-[#4B5B50]">
                Chỉ tạo một chuyên đề giả trên Firebase staging, không đưa dữ liệu tài khoản,
                kết quả thi hay chuyên đề đang lưu trên máy lên đám mây.
              </p>
              {onCreateTestTopic && (
                <button
                  type="button"
                  disabled={topicTestBusy || cloud.syncing}
                  onClick={() => void handleTopicTest(onCreateTestTopic, 'Đã tạo và đọc lại 1 chuyên đề giả trên Firebase. Hãy kiểm tra collection topics trong Firestore Data.')}
                  className="w-full rounded-md border border-[#1F4D36] px-3 py-2 text-sm font-semibold text-[#1F4D36] disabled:opacity-60"
                >
                  Tạo 1 chuyên đề giả trên Firebase
                </button>
              )}
              <button
                type="button"
                disabled={topicTestBusy}
                onClick={() => void handleTopicTest(onReadTestTopic, 'Đọc thành công chuyên đề giả và câu hỏi từ Firebase.')}
                className="w-full rounded-md border border-[#1F4D36] px-3 py-2 text-sm font-semibold text-[#1F4D36] disabled:opacity-60"
              >
                Đọc chuyên đề giả từ Firebase
              </button>
              {onDeleteTestTopic && (
                <button
                  type="button"
                  disabled={topicTestBusy || cloud.syncing}
                  onClick={() => void handleTopicTest(onDeleteTestTopic, 'Đã xóa chuyên đề giả khỏi Firebase.')}
                  className="w-full rounded-md border border-[#B91C1C] px-3 py-2 text-sm font-semibold text-[#B91C1C] disabled:opacity-60"
                >
                  Xóa chuyên đề giả sau khi kiểm thử
                </button>
              )}
              {!!topicTestMessage && (
                <p role="status" className={`text-xs ${topicTestError ? 'text-[#B91C1C]' : 'text-[#166534]'}`}>
                  {topicTestMessage}
                </p>
              )}
            </div>
          )}

          {onReadTestAccount && (
            <div className="space-y-2 rounded-xl border border-[#DDE3DC] bg-[#FAFBF9] p-3">
              <p className="text-sm font-bold text-[#152019]">Kiểm thử dữ liệu tài khoản giả</p>
              <p className="text-xs leading-relaxed text-[#4B5B50]">
                Bản ghi thử chỉ chứa tên đăng nhập giả, vai trò và trạng thái.
                Không chứa mật khẩu, tên học viên hay dữ liệu thực tế.
                Đây chưa phải phép thử đăng nhập hoặc đồng bộ tài khoản học viên thật.
              </p>
              {onCreateTestAccount && (
                <button
                  type="button"
                  disabled={accountTestBusy || cloud.syncing}
                  onClick={() => void handleAccountTest(onCreateTestAccount, 'Admin đã tạo và đọc lại dữ liệu tài khoản giả trên Firestore.')}
                  className="w-full rounded-md border border-[#1F4D36] px-3 py-2 text-sm font-semibold text-[#1F4D36] disabled:opacity-60"
                >
                  Tạo tài khoản giả trên Firebase
                </button>
              )}
              <button
                type="button"
                disabled={accountTestBusy}
                onClick={() => void handleAccountTest(onReadTestAccount, 'Đọc thành công dữ liệu tài khoản giả từ Firebase.')}
                className="w-full rounded-md border border-[#1F4D36] px-3 py-2 text-sm font-semibold text-[#1F4D36] disabled:opacity-60"
              >
                Đọc tài khoản giả từ Firebase
              </button>
              {onDeleteTestAccount && (
                <button
                  type="button"
                  disabled={accountTestBusy || cloud.syncing}
                  onClick={() => void handleAccountTest(onDeleteTestAccount, 'Đã xóa dữ liệu tài khoản giả khỏi Firebase.')}
                  className="w-full rounded-md border border-[#B91C1C] px-3 py-2 text-sm font-semibold text-[#B91C1C] disabled:opacity-60"
                >
                  Xóa tài khoản giả sau khi kiểm thử
                </button>
              )}
              {!!accountTestMessage && (
                <p role="status" className={`text-xs ${accountTestError ? 'text-[#B91C1C]' : 'text-[#166534]'}`}>
                  {accountTestMessage}
                </p>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};
