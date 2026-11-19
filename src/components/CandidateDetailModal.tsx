import React from 'react';
import { motion } from 'motion/react';
import { X, Clock, Calendar, Award, BookOpen, Building2, Trash2 } from 'lucide-react';
import { QuizAttempt, Topic } from '../types';
import {
  formatDateTime,
  formatDuration,
  formatScore10,
  getGradeBadgeStyle,
} from '../utils/grading';

interface CandidateDetailModalProps {
  title: string;
  subtitle?: string;
  attempts: QuizAttempt[];
  topics: Topic[];
  showAccountColumn?: boolean;
  onClose: () => void;
  onReviewAttempt?: (attempt: QuizAttempt) => void;
  onDeleteAttempt?: (attemptId: string) => void;
}

const EASE_SMOOTH = [0.16, 1, 0.3, 1] as const;

export const CandidateDetailModal: React.FC<CandidateDetailModalProps> = ({
  title,
  subtitle,
  attempts,
  showAccountColumn = false,
  onClose,
  onReviewAttempt,
  onDeleteAttempt,
}) => {
  const sorted = [...attempts].sort(
    (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
  );

  const gioiCount = sorted.filter((a) => a.grade === 'Giỏi').length;
  const khaCount = sorted.filter((a) => a.grade === 'Khá').length;
  const datCount = sorted.filter((a) => a.grade === 'Đạt').length;
  const yeuCount = sorted.filter((a) => a.grade === 'Yếu').length;

  const avgScore10 =
    sorted.length > 0
      ? Math.round((sorted.reduce((sum, a) => sum + a.score10, 0) / sorted.length) * 10) / 10
      : 0;
  const bestScore10 = sorted.reduce((max, a) => (a.score10 > max ? a.score10 : max), 0);

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
      aria-labelledby="candidate-detail-title"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.22, ease: EASE_SMOOTH }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white border border-[#DDE3DC] rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-xl overflow-hidden"
      >
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-[#DDE3DC] flex items-start justify-between gap-4 bg-[#FAFBF9]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#8C6516] mb-1">
              Hồ Sơ Chi Tiết
            </p>
            <h3 id="candidate-detail-title" className="text-xl font-bold text-[#152019]">
              {title}
            </h3>
            {subtitle && <p className="text-sm text-[#4B5B50] mt-0.5">{subtitle}</p>}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng cửa sổ"
            className="p-2 rounded-lg text-[#4B5B50] hover:text-[#152019] hover:bg-[#E7ECE7] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Summary Metrics */}
        <div className="px-6 py-4 bg-white border-b border-[#EDF1EC] flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-6 text-sm">
            <div>
              <span className="text-xs text-[#64756A] block">Số lần làm bài</span>
              <span className="font-mono-num font-bold text-[#152019]">{sorted.length} lần</span>
            </div>
            <div>
              <span className="text-xs text-[#64756A] block">Điểm cao nhất</span>
              <span className="font-mono-num font-bold text-[#1F4D36]">
                {formatScore10(bestScore10)}
              </span>
            </div>
            <div>
              <span className="text-xs text-[#64756A] block">Điểm trung bình</span>
              <span className="font-mono-num font-bold text-[#152019]">
                {formatScore10(avgScore10)}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs font-semibold">
            <span className="text-[#166534]">Giỏi: {gioiCount} lần</span>
            <span className="text-[#CBD5CE]" aria-hidden="true">|</span>
            <span className="text-[#1D4ED8]">Khá: {khaCount} lần</span>
            <span className="text-[#CBD5CE]" aria-hidden="true">|</span>
            <span className="text-[#9A5B06]">Đạt: {datCount} lần</span>
            <span className="text-[#CBD5CE]" aria-hidden="true">|</span>
            <span className="text-[#B91C1C]">Yếu: {yeuCount} lần</span>
          </div>
        </div>

        {/* Attempt list */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3 bg-[#F4F6F4]">
          {sorted.map((att, index) => {
            const gradeStyle = getGradeBadgeStyle(att.grade);
            const hasRecordedAnswers = Object.keys(att.answers || {}).length > 0;
            return (
              <motion.div
                key={att.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.2,
                  delay: Math.min(index * 0.03, 0.2),
                  ease: EASE_SMOOTH,
                }}
                className="bg-white border border-[#DDE3DC] hover:border-[#BFD8C7] rounded-xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors"
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[#64756A]">
                    <span className="font-mono-num font-bold text-[#1F4D36]">
                      Lần #{sorted.length - index}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-semibold text-[#152019]">{att.candidateName}</span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1">
                      <Building2 className="w-3.5 h-3.5" />
                      {att.unitName}
                    </span>
                    {showAccountColumn && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>TK: {att.accountUsername}</span>
                      </>
                    )}
                  </div>

                  <p className="text-sm sm:text-base font-bold text-[#152019] flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-[#1F4D36] shrink-0" />
                    <span className="truncate">{att.topicTitle}</span>
                  </p>

                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[#4B5B50] pt-0.5">
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-[#64756A]" />
                      <span>
                        Thời gian đã làm:{' '}
                        <strong className="font-mono-num text-[#152019]">
                          {formatDuration(att.durationSeconds)}
                        </strong>
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-[#64756A]" />
                      <span>
                        Thời gian nộp bài:{' '}
                        <strong className="font-mono-num text-[#152019]">
                          {formatDateTime(att.submittedAt)}
                        </strong>
                      </span>
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 self-start md:self-center">
                  <div className="text-right">
                    <div className="font-mono-num text-lg font-bold text-[#152019]">
                      {formatScore10(att.score10)}
                    </div>
                    <div className="text-xs text-[#64756A] font-mono-num">
                      {att.correctCount}/{att.totalCount} câu đúng
                    </div>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md border text-xs font-bold ${gradeStyle.bg} ${gradeStyle.border} ${gradeStyle.text}`}
                  >
                    <Award className="w-3.5 h-3.5" />
                    {att.grade}
                  </span>

                  {onReviewAttempt && hasRecordedAnswers && (
                    <button
                      type="button"
                      onClick={() => onReviewAttempt(att)}
                      className="px-3 py-1.5 text-xs font-semibold text-[#1F4D36] bg-[#EEF5F0] hover:bg-[#DCECE1] border border-[#BFD8C7] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                    >
                      Xem bài
                    </button>
                  )}

                  {onDeleteAttempt && (
                    <button
                      type="button"
                      onClick={() => onDeleteAttempt(att.id)}
                      title="Xóa lượt thi này"
                      className="p-1.5 rounded-md text-[#B91C1C] hover:bg-[#FEF2F2] transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#DDE3DC] bg-white flex justify-end">
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={onClose}
            className="px-5 py-2 text-sm font-semibold text-white bg-[#1F4D36] hover:bg-[#173B29] rounded-lg transition-colors cursor-pointer"
          >
            Đóng hồ sơ
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
};
