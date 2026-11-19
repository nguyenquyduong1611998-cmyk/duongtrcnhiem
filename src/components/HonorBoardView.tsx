import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Award, Layers, Search, Trophy, User, Users } from 'lucide-react';
import {
  AccountGroupSummary,
  CandidateSummary,
  QuizAttempt,
  Topic,
  UserAccount,
} from '../types';
import {
  formatScore10,
  groupAttemptsByAccount,
  groupAttemptsByCandidate,
} from '../utils/grading';
import { CandidateDetailModal } from './CandidateDetailModal';

interface HonorBoardViewProps {
  currentUser: UserAccount;
  attempts: QuizAttempt[];
  accounts: UserAccount[];
  topics: Topic[];
}

const EASE_SMOOTH = [0.16, 1, 0.3, 1] as const;

export const HonorBoardView: React.FC<HonorBoardViewProps> = ({
  currentUser,
  attempts,
  accounts,
  topics,
}) => {
  const isAdmin = currentUser.role === 'admin';

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAccountFilter, setSelectedAccountFilter] = useState<string>('ALL');
  const [adminViewMode, setAdminViewMode] = useState<'individual' | 'by_account'>('individual');

  const [detailModalState, setDetailModalState] = useState<{
    title: string;
    subtitle?: string;
    attempts: QuizAttempt[];
    showAccountColumn?: boolean;
  } | null>(null);

  const accountOptions = useMemo(() => {
    const usernames = new Set<string>();
    for (const acc of accounts) {
      usernames.add(acc.username);
    }
    for (const att of attempts) {
      if (att.accountUsername) usernames.add(att.accountUsername);
    }
    return Array.from(usernames).sort((a, b) => a.localeCompare(b));
  }, [accounts, attempts]);

  const filteredAttempts = useMemo(() => {
    let list = attempts;
    if (isAdmin && selectedAccountFilter !== 'ALL') {
      list = list.filter(
        (a) => a.accountUsername.toLowerCase() === selectedAccountFilter.toLowerCase()
      );
    }
    return list;
  }, [attempts, isAdmin, selectedAccountFilter]);

  const candidateSummaries = useMemo(() => {
    const grouped = groupAttemptsByCandidate(filteredAttempts);
    const q = searchQuery.trim().toLowerCase();
    if (!q) return grouped;
    return grouped.filter(
      (c) =>
        c.candidateName.toLowerCase().includes(q) ||
        c.unitNames.some((u) => u.toLowerCase().includes(q)) ||
        c.accountUsernames.some((acc) => acc.toLowerCase().includes(q))
    );
  }, [filteredAttempts, searchQuery]);

  const accountGroupSummaries = useMemo(() => {
    if (!isAdmin) return [];
    const grouped = groupAttemptsByAccount(filteredAttempts, accounts);
    const q = searchQuery.trim().toLowerCase();
    if (!q) return grouped;
    return grouped.filter(
      (g) =>
        g.accountUsername.toLowerCase().includes(q) ||
        g.accountLabel.toLowerCase().includes(q) ||
        g.candidateNames.some((n) => n.toLowerCase().includes(q))
    );
  }, [isAdmin, filteredAttempts, accounts, searchQuery]);

  const openCandidateModal = (candidate: CandidateSummary) => {
    setDetailModalState({
      title: candidate.candidateName,
      subtitle: candidate.unitNames.join(' · ') || undefined,
      attempts: candidate.attempts,
      showAccountColumn: isAdmin,
    });
  };

  const openAccountGroupModal = (group: AccountGroupSummary) => {
    setDetailModalState({
      title: `Nhóm tài khoản: ${group.accountUsername}`,
      subtitle: `Thí sinh: ${group.candidateNames.join(', ')}`,
      attempts: group.attempts,
      showAccountColumn: true,
    });
  };

  const openSpecificCandidateFromGroup = (group: AccountGroupSummary, candidateName: string) => {
    const matched = group.attempts.filter(
      (a) => a.candidateName.trim().toLowerCase() === candidateName.trim().toLowerCase()
    );
    setDetailModalState({
      title: candidateName,
      subtitle: `Tài khoản: ${group.accountUsername}`,
      attempts: matched,
      showAccountColumn: true,
    });
  };

  return (
    <section className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-[#DDE3DC] pb-5">
        <div>
          <p className="text-xs font-semibold tracking-wider uppercase text-[#8C6516] mb-1">
            Bảng Tổng Hợp Thành Tích Thi Đua
          </p>
          <h2 className="text-2xl sm:text-3xl font-bold text-[#152019] tracking-tight flex items-center gap-2.5">
            <Trophy className="w-7 h-7 text-[#B4831D] shrink-0" />
            <span>Bảng Tuyên Dương</span>
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Search input */}
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-[#64756A] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm tên thí sinh, đơn vị..."
              className="w-full pl-9 pr-4 py-2 bg-white border border-[#CFD8CE] rounded-lg text-sm text-[#152019] placeholder:text-[#8A9A8F] focus:outline-none focus:ring-2 focus:ring-[#1F4D36]/25 focus:border-[#1F4D36] transition-all"
            />
          </div>

          {/* Admin-only filters: "Tất cả tài khoản" + "Gộp theo TK" */}
          {isAdmin && (
            <>
              <select
                aria-label="Lọc theo tài khoản"
                value={selectedAccountFilter}
                onChange={(e) => setSelectedAccountFilter(e.target.value)}
                className="px-3.5 py-2 bg-white border border-[#CFD8CE] rounded-lg text-sm font-medium text-[#152019] focus:outline-none focus:ring-2 focus:ring-[#1F4D36]/25 focus:border-[#1F4D36] cursor-pointer"
              >
                <option value="ALL">Tất cả tài khoản</option>
                {accountOptions.map((uname) => (
                  <option key={uname} value={uname}>
                    {uname}
                  </option>
                ))}
              </select>

              <div className="inline-flex items-center p-1 bg-[#E7ECE7] rounded-lg">
                <button
                  type="button"
                  onClick={() => setAdminViewMode('individual')}
                  className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    adminViewMode === 'individual'
                      ? 'text-[#1F4D36]'
                      : 'text-[#4B5B50] hover:text-[#152019]'
                  }`}
                >
                  {adminViewMode === 'individual' && (
                    <motion.span
                      layoutId="honor-mode-pill"
                      transition={{ duration: 0.2, ease: EASE_SMOOTH }}
                      className="absolute inset-0 bg-white rounded-md shadow-sm"
                    />
                  )}
                  <User className="w-3.5 h-3.5 relative z-10" />
                  <span className="relative z-10">Cá nhân</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAdminViewMode('by_account')}
                  className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    adminViewMode === 'by_account'
                      ? 'text-[#1F4D36]'
                      : 'text-[#4B5B50] hover:text-[#152019]'
                  }`}
                >
                  {adminViewMode === 'by_account' && (
                    <motion.span
                      layoutId="honor-mode-pill"
                      transition={{ duration: 0.2, ease: EASE_SMOOTH }}
                      className="absolute inset-0 bg-white rounded-md shadow-sm"
                    />
                  )}
                  <Layers className="w-3.5 h-3.5 relative z-10" />
                  <span className="relative z-10">Gộp theo TK</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {/* Mode 1: Bảng Tổng Hợp Cá Nhân */}
        {(!isAdmin || adminViewMode === 'individual') && (
          <motion.div
            key="mode-individual"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: EASE_SMOOTH }}
            className="space-y-3"
          >
            {candidateSummaries.length === 0 ? (
              <div className="bg-white border border-[#DDE3DC] rounded-xl p-10 text-center">
                <Award className="w-10 h-10 text-[#8A9A8F] mx-auto mb-3" />
                <p className="text-base font-semibold text-[#152019]">
                  Chưa có dữ liệu trong Bảng Tổng Hợp
                </p>
              </div>
            ) : (
              <div className="bg-white border border-[#DDE3DC] rounded-xl divide-y divide-[#EDF1EC] overflow-hidden">
                {candidateSummaries.map((person, index) => (
                  <motion.article
                    key={person.key}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.22,
                      delay: Math.min(index * 0.03, 0.24),
                      ease: EASE_SMOOTH,
                    }}
                    className="p-5 sm:px-6 sm:py-5 hover:bg-[#FAFBF9] transition-colors"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-start sm:items-center gap-3.5">
                        <span className="font-mono-num text-sm font-bold w-10 h-10 rounded-lg bg-[#F4F6F4] border border-[#DDE3DC] text-[#1F4D36] flex items-center justify-center shrink-0">
                          #{index + 1}
                        </span>
                        <div>
                          <button
                            type="button"
                            onClick={() => openCandidateModal(person)}
                            className="text-left text-base sm:text-lg font-bold text-[#152019] hover:text-[#1F4D36] hover:underline underline-offset-4 cursor-pointer transition-colors"
                          >
                            {person.candidateName}
                          </button>
                          <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-[#4B5B50] mt-0.5">
                            <span>{person.unitNames.join(' · ') || 'Chưa rõ đơn vị'}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono-num">
                              Tổng số:{' '}
                              <strong className="text-[#152019]">{person.totalAttempts} lần</strong>
                            </span>
                            {isAdmin && person.accountUsernames.length > 0 && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-[#64756A]">
                                  TK: {person.accountUsernames.join(', ')}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 shrink-0 pl-13 sm:pl-0">
                        <div className="text-left sm:text-right">
                          <span className="block text-[11px] font-semibold uppercase tracking-wider text-[#64756A]">
                            ĐIỂM SỐ CAO NHẤT
                          </span>
                          <span className="font-mono-num text-base font-bold text-[#1F4D36]">
                            {formatScore10(person.bestScore10)}
                          </span>
                        </div>
                        <motion.button
                          type="button"
                          whileTap={{ scale: 0.96 }}
                          onClick={() => openCandidateModal(person)}
                          className="px-3.5 py-2 text-xs font-semibold text-[#1F4D36] bg-[#EEF5F0] hover:bg-[#DCECE1] border border-[#BFD8C7] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                        >
                          Hồ sơ chi tiết
                        </motion.button>
                      </div>
                    </div>

                    <div className="mt-4 pt-3.5 border-t border-[#EDF1EC] pl-0 sm:pl-13 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs sm:text-sm">
                      <span className="font-bold uppercase tracking-wider text-[#4B5B50] mr-1">
                        KẾT QUẢ:
                      </span>
                      <span className="font-semibold text-[#166534] tabular-nums">
                        Giỏi: <strong className="font-mono-num">{person.gioiCount} lần</strong>
                      </span>
                      <span className="text-[#CBD5CE]" aria-hidden="true">
                        |
                      </span>
                      <span className="font-semibold text-[#1D4ED8] tabular-nums">
                        Khá: <strong className="font-mono-num">{person.khaCount} lần</strong>
                      </span>
                      <span className="text-[#CBD5CE]" aria-hidden="true">
                        |
                      </span>
                      <span className="font-semibold text-[#9A5B06] tabular-nums">
                        Đạt: <strong className="font-mono-num">{person.datCount} lần</strong>
                      </span>
                      <span className="text-[#CBD5CE]" aria-hidden="true">
                        |
                      </span>
                      <span className="font-semibold text-[#B91C1C] tabular-nums">
                        Yếu: <strong className="font-mono-num">{person.yeuCount} lần</strong>
                      </span>
                    </div>
                  </motion.article>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {/* Mode 2 (Admin Only): Gộp dữ liệu lần thi theo từng Tài khoản */}
        {isAdmin && adminViewMode === 'by_account' && (
          <motion.div
            key="mode-by-account"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: EASE_SMOOTH }}
            className="space-y-3"
          >
            {accountGroupSummaries.length === 0 ? (
              <div className="bg-white border border-[#DDE3DC] rounded-xl p-10 text-center">
                <Users className="w-10 h-10 text-[#8A9A8F] mx-auto mb-3" />
                <p className="text-base font-semibold text-[#152019]">
                  Không tìm thấy nhóm tài khoản nào có dữ liệu thi
                </p>
              </div>
            ) : (
              <div className="bg-white border border-[#DDE3DC] rounded-xl divide-y divide-[#EDF1EC] overflow-hidden">
                {accountGroupSummaries.map((group, index) => (
                  <motion.article
                    key={group.accountUsername}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.22,
                      delay: Math.min(index * 0.03, 0.24),
                      ease: EASE_SMOOTH,
                    }}
                    className="p-5 sm:px-6 sm:py-5 hover:bg-[#FAFBF9] transition-colors"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-start gap-3.5">
                        <span className="font-mono-num text-sm font-bold w-10 h-10 rounded-lg bg-[#1F4D36] text-white flex items-center justify-center shrink-0">
                          #{index + 1}
                        </span>
                        <div>
                          <button
                            type="button"
                            onClick={() => openAccountGroupModal(group)}
                            className="text-left text-base sm:text-lg font-bold text-[#152019] hover:text-[#1F4D36] hover:underline underline-offset-4 cursor-pointer transition-colors"
                          >
                            {group.accountLabel}
                          </button>
                          <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-[#4B5B50] mt-1">
                            <span className="font-mono-num">
                              Tổng lượt thi:{' '}
                              <strong className="text-[#152019]">{group.totalAttempts} lần</strong>
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>
                              Số thí sinh:{' '}
                              <strong className="text-[#152019]">
                                {group.candidateNames.length} người
                              </strong>
                            </span>
                          </div>

                          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-sm">
                            <span className="text-[#64756A]">Thí sinh trong nhóm:</span>
                            {group.candidateNames.map((cName, cIdx) => (
                              <React.Fragment key={cName}>
                                <button
                                  type="button"
                                  onClick={() => openSpecificCandidateFromGroup(group, cName)}
                                  className="font-semibold text-[#1F4D36] hover:underline cursor-pointer"
                                >
                                  {cName}
                                </button>
                                {cIdx < group.candidateNames.length - 1 && (
                                  <span className="text-[#9FB0A5]" aria-hidden="true">
                                    ,
                                  </span>
                                )}
                              </React.Fragment>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 shrink-0 pl-13 sm:pl-0">
                        <div className="text-left sm:text-right">
                          <span className="block text-[11px] font-semibold uppercase tracking-wider text-[#64756A]">
                            ĐIỂM TB NHÓM
                          </span>
                          <span className="font-mono-num text-base font-bold text-[#1F4D36]">
                            {formatScore10(group.avgScore10)}
                          </span>
                        </div>
                        <motion.button
                          type="button"
                          whileTap={{ scale: 0.96 }}
                          onClick={() => openAccountGroupModal(group)}
                          className="px-3.5 py-2 text-xs font-semibold text-[#1F4D36] bg-[#EEF5F0] hover:bg-[#DCECE1] border border-[#BFD8C7] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                        >
                          Xem tất cả ({group.totalAttempts})
                        </motion.button>
                      </div>
                    </div>

                    <div className="mt-4 pt-3.5 border-t border-[#EDF1EC] pl-0 sm:pl-13 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs sm:text-sm">
                      <span className="font-bold uppercase tracking-wider text-[#4B5B50] mr-1">
                        KẾT QUẢ:
                      </span>
                      <span className="font-semibold text-[#166534] tabular-nums">
                        Giỏi: <strong className="font-mono-num">{group.gioiCount} lần</strong>
                      </span>
                      <span className="text-[#CBD5CE]" aria-hidden="true">
                        |
                      </span>
                      <span className="font-semibold text-[#1D4ED8] tabular-nums">
                        Khá: <strong className="font-mono-num">{group.khaCount} lần</strong>
                      </span>
                      <span className="text-[#CBD5CE]" aria-hidden="true">
                        |
                      </span>
                      <span className="font-semibold text-[#9A5B06] tabular-nums">
                        Đạt: <strong className="font-mono-num">{group.datCount} lần</strong>
                      </span>
                      <span className="text-[#CBD5CE]" aria-hidden="true">
                        |
                      </span>
                      <span className="font-semibold text-[#B91C1C] tabular-nums">
                        Yếu: <strong className="font-mono-num">{group.yeuCount} lần</strong>
                      </span>
                    </div>
                  </motion.article>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hồ Sơ Chi Tiết Modal */}
      <AnimatePresence>
        {detailModalState && (
          <CandidateDetailModal
            title={detailModalState.title}
            subtitle={detailModalState.subtitle}
            attempts={detailModalState.attempts}
            topics={topics}
            showAccountColumn={detailModalState.showAccountColumn}
            onClose={() => setDetailModalState(null)}
          />
        )}
      </AnimatePresence>
    </section>
  );
};
