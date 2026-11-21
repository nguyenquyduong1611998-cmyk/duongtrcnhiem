import React from 'react';
import { motion } from 'motion/react';
import { Cloud, LogOut, Shield, Settings } from 'lucide-react';
import { MainTab, UserAccount } from '../types';

interface NavbarProps {
  currentUser: UserAccount;
  activeTab: MainTab;
  cloudConnected: boolean;
  adminAccessAllowed: boolean;
  onSelectTab: (tab: MainTab) => void;
  onOpenCloudStorage: () => void;
  onLogout: () => void;
}

const EASE_SMOOTH = [0.16, 1, 0.3, 1] as const;

export const Navbar: React.FC<NavbarProps> = ({
  currentUser,
  activeTab,
  cloudConnected,
  adminAccessAllowed,
  onSelectTab,
  onOpenCloudStorage,
  onLogout,
}) => {
  const navItems: { id: MainTab; label: string }[] = [
    { id: 'topics', label: 'Mục Chuyên Đề' },
    { id: 'history', label: 'Hồ Sơ & Lịch Sử' },
    { id: 'honor', label: 'Bảng Tuyên Dương' },
  ];

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-[#DDE3DC]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4 sm:gap-8">
        {/* Zone 1: Brand mark */}
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={() => onSelectTab('topics')}
          className="flex items-center gap-2.5 text-left whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none group"
        >
          <div className="w-8 h-8 rounded-md bg-[#1F4D36] text-[#F5E1A4] flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105">
            <Shield className="w-4 h-4" />
          </div>
          <span className="font-display text-base sm:text-lg font-bold tracking-wide text-[#1F4D36] whitespace-nowrap">
            TIỂU ĐOÀN 3
          </span>
        </motion.button>

        {/* Zone 2: Single-line 3-item navigation with gliding underline */}
        <nav
          aria-label="Điều hướng chính"
          className="hidden md:flex items-center gap-6 overflow-x-auto"
        >
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`relative py-2 text-sm font-semibold whitespace-nowrap shrink-0 transition-colors duration-150 cursor-pointer ${
                  isActive
                    ? 'text-[#1F4D36]'
                    : 'text-[#4B5B50] hover:text-[#152019]'
                }`}
              >
                {item.label}
                {isActive && (
                  <motion.span
                    layoutId="desktop-nav-underline"
                    transition={{ duration: 0.22, ease: EASE_SMOOTH }}
                    className="absolute inset-x-0 bottom-0 h-0.5 bg-[#1F4D36] rounded-full"
                  />
                )}
              </button>
            );
          })}
          {currentUser.role === 'admin' && adminAccessAllowed && (
            <button
              type="button"
              onClick={() => onSelectTab('admin')}
              className={`relative py-2 text-sm font-semibold whitespace-nowrap shrink-0 flex items-center gap-1.5 transition-colors duration-150 cursor-pointer ${
                activeTab === 'admin'
                  ? 'text-[#1F4D36]'
                  : 'text-[#4B5B50] hover:text-[#152019]'
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Quản Trị</span>
              {activeTab === 'admin' && (
                <motion.span
                  layoutId="desktop-nav-underline"
                  transition={{ duration: 0.22, ease: EASE_SMOOTH }}
                  className="absolute inset-x-0 bottom-0 h-0.5 bg-[#1F4D36] rounded-full"
                />
              )}
            </button>
          )}
        </nav>

        {/* Zone 3: User action */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <span className="hidden lg:inline text-xs text-[#4B5B50] whitespace-nowrap">
            {currentUser.username}
          </span>
          <motion.button
            type="button"
            whileHover={{ y: -0.5 }}
            whileTap={{ scale: 0.96 }}
            transition={{ duration: 0.14 }}
            onClick={onOpenCloudStorage}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              cloudConnected
                ? 'text-[#166534] bg-[#ECFDF5] hover:bg-[#DCFCE7] border-[#BBF7D0]'
                : 'text-[#1F4D36] bg-[#EEF5F0] hover:bg-[#DCECE1] border-[#BFD8C7]'
            }`}
          >
            <Cloud className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">
              {cloudConnected ? 'Đã lưu đám mây' : 'Lưu đám mây'}
            </span>
          </motion.button>
          <motion.button
            type="button"
            whileHover={{ y: -0.5 }}
            whileTap={{ scale: 0.96 }}
            transition={{ duration: 0.14 }}
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-2 text-xs font-semibold text-[#243329] bg-[#F4F6F4] hover:bg-[#E7ECE7] border border-[#DDE3DC] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Đăng xuất</span>
          </motion.button>
        </div>
      </div>

      {/* Mobile single-line scrollable nav */}
      <nav
        aria-label="Điều hướng di động"
        className="md:hidden border-t border-[#EDF1EC] px-4 flex items-center gap-5 overflow-x-auto"
      >
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`relative py-2.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                isActive ? 'text-[#1F4D36]' : 'text-[#4B5B50]'
              }`}
            >
              {item.label}
              {isActive && (
                <motion.span
                  layoutId="mobile-nav-underline"
                  transition={{ duration: 0.2, ease: EASE_SMOOTH }}
                  className="absolute inset-x-0 bottom-0 h-0.5 bg-[#1F4D36]"
                />
              )}
            </button>
          );
        })}
        {currentUser.role === 'admin' && adminAccessAllowed && (
          <button
            type="button"
            onClick={() => onSelectTab('admin')}
            className={`relative py-2.5 text-xs font-semibold whitespace-nowrap shrink-0 flex items-center gap-1 transition-colors ${
              activeTab === 'admin' ? 'text-[#1F4D36]' : 'text-[#4B5B50]'
            }`}
          >
            <Settings className="w-3 h-3" />
            <span>Quản Trị</span>
            {activeTab === 'admin' && (
              <motion.span
                layoutId="mobile-nav-underline"
                transition={{ duration: 0.2, ease: EASE_SMOOTH }}
                className="absolute inset-x-0 bottom-0 h-0.5 bg-[#1F4D36]"
              />
            )}
          </button>
        )}
      </nav>
    </header>
  );
};
