import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CheckCircle2,
  ChevronRight,
  Clock,
  Eye,
  History,
  Search,
  X,
  XCircle,
} from 'lucide-react';
import { CandidateSummary, QuizAttempt, Topic, UserAccount } from '../types';
import {
  formatDateTime,
  formatScore10,
  groupAttemptsByCandidate,
} from '../utils/grading';
import { CandidateDetailModal } from './CandidateDetailModal';

interface HistoryViewProps {
  currentUser: UserAccount;
  attempts: QuizAttempt[];
  topics: Topic[];
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;
const EASE_SMOOTH = [0.16, 1, 0.3, 1] as const;

export const HistoryView: React.FC<HistoryViewProps> = ({
  currentUser,
  attempts,
  topics,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<string | null>(null);
  const [reviewAttempt, setReviewAttempt] = useState<QuizAttempt | null>(null);

  const visibleAttempts = useMemo(() => {
    const base =
      currentUser.role === 'admin'
        ? attempts
        : attempts.filter(
            (a) => a.accountUsername.toLowerCase() === currentUser.username.toLowerCase()
          );

    const q = searchTerm.trim().toLowerCase();
    const filtered = q
      ? base.filter(
          (a) =>
            a.candidateName.toLowerCase().includes(q) ||
            a.unitName.toLowerCase().includes(q) ||
            a.topicTitle.toLowerCase().includes(q)
        )
      : base;

    return [...filtered].sort(
      (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );
  }, [attempts, currentUser, searchTerm]);

  const groupedCandidates = useMemo(() => {
    return groupAttemptsByCandidate(visibleAttempts).sort(
      (a, b) =>
        new Date(b.latestSubmittedAt).getTime() - new Date(a.latestSubmittedAt).getTime()
    );
  }, [visibleAttempts]);

  const selectedCandidate: CandidateSummary | null = useMemo(() => {
    if (!selectedCandidateKey) return null;
    return groupedCandidates.find((c) => c.key === selectedCandidateKey) || null;
  }, [groupedCandidates, selectedCandidateKey]);

  const stats = useMemo(() => {
    const total = visibleAttempts.length;
    const gioi = visibleAttempts.filter((a) => a.grade === 'Giỏi').length;
    const kha = visibleAttempts.filter((a) => a.grade === 'Khá').length;
    const dat = visibleAttempts.filter((a) => a.grade === 'Đạt').length;
    const yeu = visibleAttempts.filter((a) => a.grade === 'Yếu').length;
    const avg =
      total > 0
        ? Math.round(
            (visibleAttempts.reduce((acc, item) => acc + item.score10, 0) / total) * 10
          ) / 10
        : 0;
    return { total, gioi, kha, dat, yeu, avg };
  }, [visibleAttempts]);

  const reviewTopic = useMemo(() => {
    if (!reviewAttempt) return null;
    return topics.find((t) => t.id === reviewAttempt.topicId) || null;
  }, [reviewAttempt, topics]);

  return (
    <section className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[#DDE3DC] pb-5">
        <div>
          <p className="text-xs font-semibold tracking-wider uppercase text-[#8C6516] mb-1">
            Tài khoản: {currentUser.username}
          </p>
          <h2 className="text-2xl sm:text-3xl font-bold text-[#152019] tracking-tight">
            Hồ Sơ & Lịch Sử Làm Bài
          </h2>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-[#64756A] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Tìm theo tên, đơn vị, chuyên đề..."
            className="w-full pl-9 pr-4 py-2 bg-white border border-[#CFD8CE] rounded-lg text-sm text-[#152019] placeholder:text-[#8A9A8F] focus:outline-none focus:ring-2 focus:ring-[#1F4D36]/25 focus:border-[#1F4D36]"
          />
        </div>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        {[
          {
            label: 'Tổng lượt thi',
            value: `${stats.total} lần`,
            cls: 'text-[#152019]',
            lblCls: 'text-[#64756A]',
          },
          {
            label: 'Điểm trung bình',
            value: formatScore10(stats.avg),
            cls: 'text-[#1F4D36]',
            lblCls: 'text-[#64756A]',
          },
          {
            label: 'Giỏi',
            value: `${stats.gioi} lần`,
            cls: 'text-[#166534]',
            lblCls: 'text-[#166534] font-semibold',
          },
          {
            label: 'Khá',
            value: `${stats.kha} lần`,
            cls: 'text-[#1D4ED8]',
            lblCls: 'text-[#1D4ED8] font-semibold',
          },
          {
            label: 'Đạt',
            value: `${stats.dat} lần`,
            cls: 'text-[#9A5B06]',
            lblCls: 'text-[#9A5B06] font-semibold',
          },
          {
            label: 'Yếu',
            value: `${stats.yeu} lần`,
            cls: 'text-[#B91C1C]',
            lblCls: 'text-[#B91C1C] font-semibold',
          },
        ].map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: i * 0.03, ease: EASE_SMOOTH }}
            whileHover={{ y: -2 }}
            className="bg-white border border-[#DDE3DC] rounded-xl p-3 sm:p-4 transition-shadow hover:shadow-sm"
          >
            <span className={`text-xs block ${card.lblCls}`}>{card.label}</span>
            <span className={`font-mono-num text-lg sm:text-xl font-bold mt-0.5 sm:mt-1 block ${card.cls}`}>
              {card.value}
            </span>
          </motion.div>
        ))}
      </div>

      {groupedCandidates.length === 0 ? (
        <div className="bg-white border border-[#DDE3DC] rounded-xl p-10 text-center">
          <History className="w-10 h-10 text-[#8A9A8F] mx-auto mb-3" />
          <p className="text-base font-semibold text-[#152019]">Chưa có dữ liệu lịch sử thi</p>
          <p className="text-sm text-[#64756A] mt-1">
            Hãy vào Mục Chuyên Đề để thực hiện bài kiểm tra đầu tiên.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-[#DDE3DC] rounded-xl overflow-hidden">
          {/* Mobile Compact Card Layout */}
          <div className="md:hidden divide-y divide-[#EDF1EC]">
            {groupedCandidates.map((person, index) => (
              <motion.div
                key={person.key}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.2,
                  delay: Math.min(index * 0.03, 0.24),
                  ease: EASE_SMOOTH,
                }}
                onClick={() => setSelectedCandidateKey(person.key)}
                className="p-3.5 active:bg-[#FAFBF9] transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="font-mono-num text-xs font-bold w-7 h-7 rounded-md bg-[#F4F6F4] border border-[#DDE3DC] text-[#1F4D36] flex items-center justify-center shrink-0">
                      #{index + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="font-bold text-sm text-[#152019] truncate">
                        {person.candidateName}
                      </div>
                      <div className="text-xs text-[#64756A] truncate">
                        {person.unitNames.join(' · ') || 'Chưa rõ đơn vị'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono-num text-xs font-bold text-[#1F4D36] whitespace-nowrap">
                      {person.totalAttempts} lần
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedCandidateKey(person.key);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#1F4D36] bg-[#EEF5F0] border border-[#BFD8C7] rounded-lg whitespace-nowrap cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Xem</span>
                    </button>
                  </div>
                </div>

                <div className="mt-2.5 pt-2 border-t border-[#EDF1EC] flex items-center justify-between gap-2 text-xs font-semibold tabular-nums">
                  <span className="text-[#166534] whitespace-nowrap">
                    Giỏi: {person.gioiCount}
                  </span>
                  <span className="text-[#CBD5CE]" aria-hidden="true">·</span>
                  <span className="text-[#1D4ED8] whitespace-nowrap">
                    Khá: {person.khaCount}
                  </span>
                  <span className="text-[#CBD5CE]" aria-hidden="true">·</span>
                  <span className="text-[#9A5B06] whitespace-nowrap">
                    Đạt: {person.datCount}
                  </span>
                  <span className="text-[#CBD5CE]" aria-hidden="true">·</span>
                  <span className="text-[#B91C1C] whitespace-nowrap">
                    Yếu: {person.yeuCount}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Desktop Table Layout */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#DDE3DC] bg-[#FAFBF9] text-xs font-bold uppercase tracking-wider text-[#4B5B50]">
                  <th className="py-3.5 px-4">Thí sinh & Đơn vị</th>
                  <th className="py-3.5 px-4">Số lần làm đề</th>
                  <th className="py-3.5 px-4">Kết quả 4 mức</th>
                  <th className="py-3.5 px-4 text-right">Chi tiết</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EDF1EC] text-sm">
                {groupedCandidates.map((person, index) => (
                  <motion.tr
                    key={person.key}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.2,
                      delay: Math.min(index * 0.03, 0.24),
                      ease: EASE_SMOOTH,
                    }}
                    onClick={() => setSelectedCandidateKey(person.key)}
                    className="hover:bg-[#FAFBF9] transition-colors cursor-pointer group"
                  >
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-3">
                        <span className="font-mono-num text-xs font-bold w-8 h-8 rounded-md bg-[#F4F6F4] border border-[#DDE3DC] text-[#1F4D36] flex items-center justify-center shrink-0">
                          #{index + 1}
                        </span>
                        <div>
                          <div className="font-bold text-[#152019] group-hover:text-[#1F4D36] group-hover:underline underline-offset-4 transition-colors">
                            {person.candidateName}
                          </div>
                          <div className="text-xs text-[#64756A]">
                            {person.unitNames.join(' · ') || 'Chưa rõ đơn vị'}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="py-4 px-4">
                      <span className="font-mono-num font-bold text-[#1F4D36] whitespace-nowrap">
                        {person.totalAttempts} lần
                      </span>
                    </td>

                    <td className="py-4 px-4">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-semibold tabular-nums">
                        <span className="text-[#166534] whitespace-nowrap">
                          Giỏi: {person.gioiCount}
                        </span>
                        <span className="text-[#CBD5CE]" aria-hidden="true">|</span>
                        <span className="text-[#1D4ED8] whitespace-nowrap">
                          Khá: {person.khaCount}
                        </span>
                        <span className="text-[#CBD5CE]" aria-hidden="true">|</span>
                        <span className="text-[#9A5B06] whitespace-nowrap">
                          Đạt: {person.datCount}
                        </span>
                        <span className="text-[#CBD5CE]" aria-hidden="true">|</span>
                        <span className="text-[#B91C1C] whitespace-nowrap">
                          Yếu: {person.yeuCount}
                        </span>
                      </div>
                    </td>

                    <td className="py-4 px-4 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedCandidateKey(person.key);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#1F4D36] bg-[#EEF5F0] hover:bg-[#DCECE1] border border-[#BFD8C7] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Xem chi tiết</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Candidate Detail Modal (shows all individual attempts for the grouped person) */}
      <AnimatePresence>
        {selectedCandidate && (
          <CandidateDetailModal
            title={selectedCandidate.candidateName}
            subtitle={selectedCandidate.unitNames.join(' · ') || undefined}
            attempts={selectedCandidate.attempts}
            topics={topics}
            showAccountColumn={currentUser.role === 'admin'}
            onClose={() => setSelectedCandidateKey(null)}
            onReviewAttempt={(attempt) => setReviewAttempt(attempt)}
          />
        )}
      </AnimatePresence>

      {/* Answer Review Modal (stacked above CandidateDetailModal when clicking "Xem bài") */}
      <AnimatePresence>
        {reviewAttempt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setReviewAttempt(null)}
            className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-[2px] flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ duration: 0.22, ease: EASE_SMOOTH }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white border border-[#DDE3DC] rounded-xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-xl overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-[#DDE3DC] flex items-center justify-between bg-[#FAFBF9]">
                <div>
                  <h3 className="text-lg font-bold text-[#152019]">
                    Chi tiết bài làm · {reviewAttempt.candidateName}
                  </h3>
                  <p className="text-xs text-[#4B5B50] mt-0.5 flex flex-wrap items-center gap-2">
                    <span>{reviewAttempt.topicTitle}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      ĐIỂM SỐ:{' '}
                      <strong className="text-[#1F4D36]">
                        {formatScore10(reviewAttempt.score10)}
                      </strong>{' '}
                      ({reviewAttempt.grade})
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDateTime(reviewAttempt.submittedAt)}
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReviewAttempt(null)}
                  className="p-2 rounded-lg text-[#4B5B50] hover:bg-[#E7ECE7] cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-[#F4F6F4]">
                {!reviewTopic ? (
                  <p className="text-sm text-[#64756A]">
                    Bộ đề của lượt thi này đã được chỉnh sửa hoặc xóa khỏi hệ thống.
                  </p>
                ) : (
                  reviewTopic.questions.map((q, idx) => {
                    const userAns = reviewAttempt.answers[q.id];
                    const isCorrect = userAns === q.correctIndex;
                    return (
                      <div
                        key={q.id}
                        className="bg-white border border-[#DDE3DC] rounded-xl p-5 space-y-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono-num text-xs font-bold text-[#152019]">
                            Câu {idx + 1}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded border text-xs font-bold ${
                              isCorrect
                                ? 'bg-[#ECFDF5] border-[#BBF7D0] text-[#166534]'
                                : 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
                            }`}
                          >
                            {isCorrect ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Chính xác!</span>
                              </>
                            ) : (
                              <>
                                <XCircle className="w-3.5 h-3.5" />
                                <span>Chưa chính xác!</span>
                              </>
                            )}
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-[#152019]">{q.text}</p>
                        <div className="space-y-1.5 text-xs">
                          {q.options.map((opt, oIdx) => {
                            const isRight = oIdx === q.correctIndex;
                            const isPicked = oIdx === userAns;
                            return (
                              <div
                                key={oIdx}
                                className={`p-2.5 rounded-lg border ${
                                  isRight
                                    ? 'bg-[#ECFDF5] border-[#86EFAC] text-[#166534] font-semibold'
                                    : isPicked
                                    ? 'bg-[#FEF2F2] border-[#FCA5A5] text-[#B91C1C] font-semibold'
                                    : 'bg-[#FAFBF9] border-[#E4EAE3] text-[#4B5B50]'
                                }`}
                              >
                                {OPTION_LETTERS[oIdx]}. {opt}
                              </div>
                            );
                          })}
                        </div>
                        <div className="p-3 rounded-lg bg-[#F4F6F4] text-xs text-[#243329]">
                          <strong className="text-[#1F4D36]">Giải thích: </strong>
                          {q.explanation ||
                            `Đáp án đúng là ${OPTION_LETTERS[q.correctIndex]}. ${q.options[q.correctIndex]}`}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};
