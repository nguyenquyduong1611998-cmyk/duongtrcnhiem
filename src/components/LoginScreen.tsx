import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Eye, EyeOff, Lock, User, AlertCircle, Shield } from 'lucide-react';
import { SYNTHETIC_RESET_REQUIRED } from '../utils/serverlessAuth';

interface LoginScreenProps {
  onLogin: (username: string, password: string) => Promise<string | null> | string | null;
  onChangeSyntheticPassword?: (username: string, temporaryPassword: string, newPassword: string) => Promise<string | null>;
}

const EASE_SMOOTH = [0.16, 1, 0.3, 1] as const;

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin, onChangeSyntheticPassword }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resetRequired, setResetRequired] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const trimmedUser = username.trim();
    if (!trimmedUser || !password) {
      setError('Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.');
      return;
    }
    setSubmitting(true);
    setSuccessMessage('');
    try {
      if (resetRequired && onChangeSyntheticPassword) {
        if (newPassword !== confirmPassword) {
          setError('Mật khẩu mới và xác nhận không khớp.');
          return;
        }
        if (newPassword.length < 12 || newPassword.length > 128 ||
            !/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) ||
            !/[0-9]/.test(newPassword) || !/[^a-zA-Z0-9]/.test(newPassword) ||
            /\s/.test(newPassword) || newPassword === password) {
          setError('Mật khẩu mới cần 12–128 ký tự, có chữ hoa, chữ thường, số, ký tự đặc biệt, không có khoảng trắng và khác mật khẩu tạm.');
          return;
        }
        const err = await onChangeSyntheticPassword(trimmedUser, password, newPassword);
        if (err) {
          setError(err);
        } else {
          setResetRequired(false);
          setPassword('');
          setNewPassword('');
          setConfirmPassword('');
          setShowPassword(false);
          setError(null);
          setSuccessMessage('Đã đổi mật khẩu của tài khoản GIẢ trên Cloudflare D1. Chưa cấp quyền đăng nhập Firebase.');
        }
        return;
      }
      const err = await onLogin(trimmedUser, password);
      if (err === SYNTHETIC_RESET_REQUIRED && onChangeSyntheticPassword) {
        setResetRequired(true);
        setNewPassword('');
        setConfirmPassword('');
        setError(null);
      } else {
        setError(err);
      }
    } catch {
      setError('Không thể xác minh tài khoản trên máy chủ thử nghiệm. Vui lòng kiểm tra kết nối.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#1A3D28] military-grid-bg text-white">
      {/* Top institutional bar */}
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE_SMOOTH }}
        className="w-full border-b border-white/20 bg-[#10281A]/95 backdrop-blur-sm"
      >
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 shrink-0">
            <motion.div
              whileHover={{ scale: 1.05 }}
              transition={{ duration: 0.18, ease: EASE_SMOOTH }}
              className="w-10 h-10 rounded-lg bg-[#EAB308] text-[#10281A] flex items-center justify-center shrink-0 shadow-sm"
            >
              <Shield className="w-5 h-5" />
            </motion.div>
            <span className="font-display text-lg sm:text-xl font-bold tracking-wide text-white whitespace-nowrap drop-shadow-sm">
              TIỂU ĐOÀN 3
            </span>
          </div>

          <p className="text-sm sm:text-base font-semibold text-[#FDE68A] tracking-tight text-right drop-shadow-sm">
            Tích cực, chủ động, tiến bộ toàn diện
          </p>
        </div>
      </motion.header>

      {/* Main focal login container */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-10 sm:py-14">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: EASE_SMOOTH }}
          className="w-full max-w-xl text-center mb-8"
        >
          <p className="text-xs sm:text-sm font-bold tracking-widest uppercase text-[#FCD34D] mb-2.5 drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
            Tin Học Số Lữ Đoàn Tên Lửa 490
          </p>
          <h1
            className="font-display text-3xl sm:text-5xl font-bold text-white tracking-tight leading-tight mb-3 drop-shadow-[0_2px_6px_rgba(0,0,0,0.45)]"
            style={{ textWrap: 'balance' }}
          >
            HỌC, HỌC NỮA, HỌC MÃI
          </h1>
          <p className="text-base sm:text-lg text-[#F0F7F2] font-medium drop-shadow-[0_1px_3px_rgba(0,0,0,0.4)]">
            Hệ thống học tập, ôn luyện kiến thức cho quân nhân
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.35, delay: 0.06, ease: EASE_SMOOTH }}
          className="w-full max-w-md bg-white text-[#152019] border border-white/20 rounded-xl shadow-xl p-6 sm:p-8"
        >
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div>
              <label
                htmlFor="login-username"
                className="block text-sm font-semibold text-[#243329] mb-1.5"
              >
                Tên đăng nhập
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#64756A]">
                  <User className="w-4 h-4" />
                </span>
                <input
                  id="login-username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    setResetRequired(false);
                    setNewPassword('');
                    setConfirmPassword('');
                    setSuccessMessage('');
                    if (error) setError(null);
                  }}
                  placeholder="Nhập tên tài khoản"
                  className="w-full pl-10 pr-4 py-2.5 bg-[#FAFBF9] border border-[#CFD8CE] rounded-lg text-sm text-[#152019] placeholder:text-[#8A9A8F] focus:outline-none focus:ring-2 focus:ring-[#1F4D36]/25 focus:border-[#1F4D36] transition-all duration-150"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-sm font-semibold text-[#243329] mb-1.5"
              >
                Mật khẩu
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#64756A]">
                  <Lock className="w-4 h-4" />
                </span>
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="Nhập mật khẩu"
                  className="w-full pl-10 pr-11 py-2.5 bg-[#FAFBF9] border border-[#CFD8CE] rounded-lg text-sm text-[#152019] placeholder:text-[#8A9A8F] focus:outline-none focus:ring-2 focus:ring-[#1F4D36]/25 focus:border-[#1F4D36] transition-all duration-150"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  className="absolute inset-y-0 right-0 px-3.5 flex items-center text-[#64756A] hover:text-[#152019] focus-visible:outline-none transition-colors cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {resetRequired && onChangeSyntheticPassword && (
              <div className="space-y-3 rounded-lg border border-[#DDE3DC] bg-[#F3F8F4] p-3">
                <p role="status" className="text-xs font-semibold text-[#166534]">
                  Mật khẩu tạm đã được Cloudflare D1 xác minh. Tài khoản GIẢ bắt buộc đổi mật khẩu trước khi tiếp tục.
                </p>
                <p className="text-xs text-[#526357]">
                  Chỉ thử trên staging. Đổi xong vẫn chưa thể đăng nhập; không dùng mật khẩu học viên thật.
                </p>
                <label htmlFor="synthetic-new-password" className="block text-xs font-semibold">Mật khẩu mới (GIẢ)</label>
                <input id="synthetic-new-password" type="password" autoComplete="new-password"
                  value={newPassword} onChange={(e) => {setNewPassword(e.target.value);setError(null);}}
                  placeholder="Ít nhất 12 ký tự, chữ hoa/thường, số và ký tự đặc biệt"
                  className="w-full rounded-lg border border-[#CFD8CE] bg-white px-3 py-2 text-sm"
                />
                <label htmlFor="synthetic-confirm-password" className="block text-xs font-semibold">Nhập lại mật khẩu mới</label>
                <input id="synthetic-confirm-password" type="password" autoComplete="new-password"
                  value={confirmPassword} onChange={(e) => {setConfirmPassword(e.target.value);setError(null);}}
                  className="w-full rounded-lg border border-[#CFD8CE] bg-white px-3 py-2 text-sm"
                />
                <button type="button" disabled={submitting}
                  onClick={() => {
                    setResetRequired(false);setNewPassword('');setConfirmPassword('');setPassword('');setError(null);
                  }}
                  className="text-xs text-[#4B5B50] underline disabled:opacity-50"
                >Hủy đổi mật khẩu</button>
              </div>
            )}
            {!!successMessage && (
              <p role="status" className="rounded-lg border border-[#A7D7B3] bg-[#F0FFF3] p-3 text-xs text-[#166534]">
                {successMessage}
              </p>
            )}

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18, ease: EASE_SMOOTH }}
                  role="alert"
                  className="flex items-start gap-2.5 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] text-sm"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.button
              type="submit"
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.985 }}
              transition={{ duration: 0.15, ease: EASE_SMOOTH }}
              disabled={submitting}
              className="w-full py-2.5 px-4 bg-[#1F4D36] hover:bg-[#173B29] active:bg-[#122E20] text-white font-semibold text-sm rounded-lg shadow-sm hover:shadow transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F4D36] focus-visible:ring-offset-2 cursor-pointer"
            >
              {resetRequired ? 'Đổi mật khẩu thử nghiệm' : 'Đăng nhập'}
            </motion.button>
          </form>
        </motion.div>
      </main>

      <footer className="py-4 text-center text-xs text-[#C5D4CA] border-t border-white/15 bg-[#132B1C]/90">
        Tin Học Số Lữ Đoàn Tên Lửa 490 · Tiểu Đoàn 3
      </footer>
    </div>
  );
};
