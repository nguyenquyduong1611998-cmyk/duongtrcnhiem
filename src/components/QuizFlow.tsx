import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  FileCheck2,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { QuizAttempt, Topic, UserAccount } from '../types';
import {
  calculateScore10,
  formatDateTime,
  formatDuration,
  formatScore10,
  getGradeBadgeStyle,
  getGradeLevel,
} from '../utils/grading';

interface QuizFlowProps {
  topic: Topic;
  currentUser: UserAccount;
  onCompleteAttempt: (attempt: QuizAttempt) => void;
  onExit: () => void;
}

type QuizStage = 'candidate_info' | 'taking' | 'result';

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;
const EASE_SMOOTH = [0.16, 1, 0.3, 1] as const;

export const QuizFlow: React.FC<QuizFlowProps> = ({
  topic,
  currentUser,
  onCompleteAttempt,
  onExit,
}) => {
  const [stage, setStage] = useState<QuizStage>('candidate_info');
  const [candidateName, setCandidateName] = useState('');
  const [unitName, setUnitName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [startedAtIso, setStartedAtIso] = useState<string>('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showConfirmFinish, setShowConfirmFinish] = useState(false);
  const [completedAttempt, setCompletedAttempt] = useState<QuizAttempt | null>(null);

  const totalTimeSeconds = Math.max(60, (topic.timeLimitMinutes || 10) * 60);

  useEffect(() => {
    if (stage !== 'taking') return;
    const timer = window.setInterval(() => {
      setElapsedSeconds((prev) => {
        const next = prev + 1;
        if (next >= totalTimeSeconds) {
          window.clearInterval(timer);
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [stage, totalTimeSeconds]);

  useEffect(() => {
    if (stage === 'taking' && elapsedSeconds >= totalTimeSeconds) {
      finalizeQuiz();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsedSeconds, stage, totalTimeSeconds]);

  const answeredCount = useMemo(
    () => topic.questions.filter((q) => answers[q.id] !== undefined).length,
    [topic.questions, answers]
  );

  const handleStartQuiz = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = candidateName.trim().replace(/\s+/g, ' ');
    const cleanUnit = unitName.trim().replace(/\s+/g, ' ');

    if (!cleanName) {
      setFormError('Vui lòng điền Họ và tên thí sinh trước khi vào làm bài.');
      return;
    }
    if (!cleanUnit) {
      setFormError('Vui lòng điền Đơn vị công tác trước khi vào làm bài.');
      return;
    }

    setCandidateName(cleanName);
    setUnitName(cleanUnit);
    setFormError(null);
    setStartedAtIso(new Date().toISOString());
    setElapsedSeconds(0);
    setAnswers({});
    setCurrentIdx(0);
    setStage('taking');
  };

  const finalizeQuiz = () => {
    if (completedAttempt) return;
    let correctCount = 0;
    for (const q of topic.questions) {
      if (answers[q.id] === q.correctIndex) {
        correctCount += 1;
      }
    }
    const totalCount = topic.questions.length;
    const score10 = calculateScore10(correctCount, totalCount);
    const grade = getGradeLevel(score10);
    const submittedAt = new Date().toISOString();

    const attempt: QuizAttempt = {
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      accountId: currentUser.id,
      accountUsername: currentUser.username,
      candidateName: candidateName.trim(),
      unitName: unitName.trim(),
      topicId: topic.id,
      topicTitle: topic.title,
      answers: { ...answers },
      correctCount,
      totalCount,
      score10,
      grade,
      durationSeconds: Math.max(1, elapsedSeconds),
      startedAt: startedAtIso || submittedAt,
      submittedAt,
    };

    setCompletedAttempt(attempt);
    setShowConfirmFinish(false);
    setStage('result');
    onCompleteAttempt(attempt);
  };

  const remainingSeconds = Math.max(0, totalTimeSeconds - elapsedSeconds);
  const remMin = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
  const remSec = String(remainingSeconds % 60).padStart(2, '0');
  const progressRatio =
    topic.questions.length > 0 ? answeredCount / topic.questions.length : 0;

  return (
    <AnimatePresence mode="wait">
      {stage === 'candidate_info' && (
        <motion.section
          key="stage-candidate-info"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.22, ease: EASE_SMOOTH }}
          className="max-w-2xl mx-auto"
        >
          <button
            type="button"
            onClick={onExit}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#4B5B50] hover:text-[#152019] mb-5 cursor-pointer transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Quay lại Mục Chuyên Đề</span>
          </button>

          <div className="bg-white border border-[#DDE3DC] rounded-xl p-6 sm:p-8 shadow-sm">
            <div className="border-b border-[#EDF1EC] pb-5 mb-6">
              <p className="text-xs font-semibold tracking-wider uppercase text-[#8C6516] mb-1">
                {topic.code} · {topic.questions.length} câu hỏi · {topic.timeLimitMinutes} phút
              </p>
              <h2 className="text-2xl font-bold text-[#152019]">{topic.title}</h2>
              <p className="text-sm text-[#4B5B50] mt-2">{topic.description}</p>
            </div>

            <form onSubmit={handleStartQuiz} className="space-y-5" noValidate>
              <div>
                <label
                  htmlFor="candidate-fullname"
                  className="block text-sm font-semibold text-[#243329] mb-1.5"
                >
                  Họ và tên thí sinh <span className="text-[#B91C1C]">*</span>
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#64756A]">
                    <UserCheck className="w-4 h-4" />
                  </span>
                  <input
                    id="candidate-fullname"
                    type="text"
                    required
                    value={candidateName}
                    onChange={(e) => {
                      setCandidateName(e.target.value);
                      if (formError) setFormError(null);
                    }}
                    placeholder="Ví dụ: Nguyễn Văn Phong"
                    className="w-full pl-10 pr-4 py-2.5 bg-[#FAFBF9] border border-[#CFD8CE] rounded-lg text-sm text-[#152019] placeholder:text-[#8A9A8F] focus:outline-none focus:ring-2 focus:ring-[#1F4D36]/25 focus:border-[#1F4D36] transition-all"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="candidate-unit"
                  className="block text-sm font-semibold text-[#243329] mb-1.5"
                >
                  Đơn vị công tác <span className="text-[#B91C1C]">*</span>
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#64756A]">
                    <Building2 className="w-4 h-4" />
                  </span>
                  <input
                    id="candidate-unit"
                    type="text"
                    required
                    value={unitName}
                    onChange={(e) => {
                      setUnitName(e.target.value);
                      if (formError) setFormError(null);
                    }}
                    placeholder="Ví dụ: Đại đội 7 - Tiểu đoàn 3"
                    className="w-full pl-10 pr-4 py-2.5 bg-[#FAFBF9] border border-[#CFD8CE] rounded-lg text-sm text-[#152019] placeholder:text-[#8A9A8F] focus:outline-none focus:ring-2 focus:ring-[#1F4D36]/25 focus:border-[#1F4D36] transition-all"
                  />
                </div>
              </div>

              <AnimatePresence>
                {formError && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.16, ease: EASE_SMOOTH }}
                    role="alert"
                    className="flex items-start gap-2.5 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] text-sm"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{formError}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="pt-2 flex flex-col sm:flex-row items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={onExit}
                  className="w-full sm:w-auto px-5 py-2.5 text-sm font-semibold text-[#4B5B50] bg-[#F4F6F4] hover:bg-[#E7ECE7] rounded-lg transition-colors cursor-pointer"
                >
                  Hủy bỏ
                </button>
                <motion.button
                  type="submit"
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  className="w-full sm:w-auto px-6 py-2.5 text-sm font-semibold text-white bg-[#1F4D36] hover:bg-[#173B29] rounded-lg transition-colors cursor-pointer"
                >
                  Bắt đầu làm bài
                </motion.button>
              </div>
            </form>
          </div>
        </motion.section>
      )}

      {stage === 'taking' && (
        <motion.section
          key="stage-taking"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.22, ease: EASE_SMOOTH }}
          className="space-y-6"
        >
          {/* Quiz top status bar + animated progress */}
          <div className="bg-white border border-[#DDE3DC] rounded-xl overflow-hidden">
            <div className="px-5 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-[#152019]">{topic.title}</h2>
                <p className="text-xs sm:text-sm text-[#4B5B50] mt-0.5">
                  Thí sinh: <span className="font-semibold text-[#152019]">{candidateName}</span>
                  <span className="mx-2" aria-hidden="true">·</span>
                  Đơn vị: <span className="font-semibold text-[#152019]">{unitName}</span>
                </p>
              </div>

              <div className="flex items-center gap-5 shrink-0">
                <div className="text-right">
                  <span className="block text-xs text-[#64756A]">Đã trả lời</span>
                  <span className="font-mono-num text-sm font-bold text-[#152019]">
                    {answeredCount} / {topic.questions.length}
                  </span>
                </div>
                <div
                  className={`px-3.5 py-2 rounded-lg border flex items-center gap-2 transition-colors ${
                    remainingSeconds <= 60
                      ? 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
                      : 'bg-[#F4F6F4] border-[#DDE3DC] text-[#1F4D36]'
                  }`}
                >
                  <Clock className="w-4 h-4" />
                  <span className="font-mono-num text-base font-bold">
                    {remMin}:{remSec}
                  </span>
                </div>
              </div>
            </div>

            {/* Smooth GPU-composited progress bar */}
            <div className="h-1.5 w-full bg-[#EDF1EC] overflow-hidden">
              <motion.div
                className="h-full bg-[#1F4D36] origin-left"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: progressRatio }}
                transition={{ duration: 0.25, ease: EASE_SMOOTH }}
              />
            </div>
          </div>

          {/* Two-column quiz workspace */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Question Card - NO correctness alert or explanation shown during test */}
            <div className="lg:col-span-8 bg-white border border-[#DDE3DC] rounded-xl p-6 sm:p-8 overflow-hidden">
              {(() => {
                const currentQ = topic.questions[currentIdx];
                const selectedOption = answers[currentQ.id];
                return (
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={currentQ.id}
                      initial={{ opacity: 0, x: 16 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -16 }}
                      transition={{ duration: 0.18, ease: EASE_SMOOTH }}
                    >
                      <div className="flex items-center justify-between gap-4 pb-4 mb-5 border-b border-[#EDF1EC]">
                        <span className="font-mono-num text-sm font-bold text-[#1F4D36]">
                          Câu {currentIdx + 1} / {topic.questions.length}
                        </span>
                        <span className="text-xs text-[#64756A]">Chọn 1 đáp án đúng nhất</span>
                      </div>

                      <h3 className="text-lg sm:text-xl font-semibold text-[#152019] leading-relaxed mb-6">
                        {currentQ.text}
                      </h3>

                      <div className="space-y-3">
                        {currentQ.options.map((optText, optIdx) => {
                          const isSelected = selectedOption === optIdx;
                          return (
                            <motion.button
                              key={optIdx}
                              type="button"
                              whileHover={{ x: 2 }}
                              whileTap={{ scale: 0.99 }}
                              transition={{ duration: 0.12 }}
                              onClick={() =>
                                setAnswers((prev) => ({
                                  ...prev,
                                  [currentQ.id]: optIdx,
                                }))
                              }
                              className={`w-full text-left p-4 rounded-xl border transition-colors duration-150 flex items-start gap-3.5 cursor-pointer ${
                                isSelected
                                  ? 'bg-[#EEF5F0] border-[#1F4D36] text-[#152019] shadow-xs'
                                  : 'bg-[#FAFBF9] border-[#DDE3DC] hover:border-[#9FB0A5] hover:bg-white text-[#243329]'
                              }`}
                            >
                              <span
                                className={`w-7 h-7 rounded-md font-mono-num text-xs font-bold flex items-center justify-center shrink-0 mt-0.5 transition-colors duration-150 ${
                                  isSelected
                                    ? 'bg-[#1F4D36] text-white'
                                    : 'bg-white border border-[#CFD8CE] text-[#4B5B50]'
                                }`}
                              >
                                {OPTION_LETTERS[optIdx]}
                              </span>
                              <span className="text-sm sm:text-base leading-relaxed font-medium">
                                {optText}
                              </span>
                            </motion.button>
                          );
                        })}
                      </div>
                    </motion.div>
                  </AnimatePresence>
                );
              })()}

              <div className="mt-8 pt-5 border-t border-[#EDF1EC] flex items-center justify-between gap-3">
                <motion.button
                  type="button"
                  disabled={currentIdx === 0}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-[#243329] bg-[#F4F6F4] hover:bg-[#E7ECE7] disabled:opacity-40 rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Câu trước</span>
                </motion.button>

                {currentIdx < topic.questions.length - 1 ? (
                  <motion.button
                    type="button"
                    whileHover={{ y: -0.5 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() =>
                      setCurrentIdx((i) => Math.min(topic.questions.length - 1, i + 1))
                    }
                    className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-semibold text-white bg-[#1F4D36] hover:bg-[#173B29] rounded-lg transition-colors cursor-pointer"
                  >
                    <span>Câu tiếp theo</span>
                    <ArrowRight className="w-4 h-4" />
                  </motion.button>
                ) : (
                  <motion.button
                    type="button"
                    whileHover={{ y: -0.5 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setShowConfirmFinish(true)}
                    className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-[#8C6516] hover:bg-[#745210] rounded-lg transition-colors cursor-pointer"
                  >
                    <FileCheck2 className="w-4 h-4" />
                    <span>Hoàn thành bài kiểm tra</span>
                  </motion.button>
                )}
              </div>
            </div>

            {/* Question Navigator Sidebar */}
            <aside className="lg:col-span-4 bg-white border border-[#DDE3DC] rounded-xl p-5 space-y-5">
              <div>
                <h4 className="text-sm font-bold text-[#152019] mb-3">Danh sách câu hỏi</h4>
                <div className="grid grid-cols-5 gap-2">
                  {topic.questions.map((q, idx) => {
                    const isAnswered = answers[q.id] !== undefined;
                    const isCurrent = idx === currentIdx;
                    return (
                      <motion.button
                        key={q.id}
                        type="button"
                        whileTap={{ scale: 0.92 }}
                        onClick={() => setCurrentIdx(idx)}
                        className={`h-10 rounded-lg font-mono-num text-xs font-bold border transition-colors duration-150 cursor-pointer ${
                          isCurrent
                            ? 'bg-[#1F4D36] text-white border-[#1F4D36] shadow-xs'
                            : isAnswered
                            ? 'bg-[#EEF5F0] text-[#1F4D36] border-[#A7C4B2]'
                            : 'bg-[#FAFBF9] text-[#4B5B50] border-[#DDE3DC] hover:border-[#9FB0A5]'
                        }`}
                      >
                        {idx + 1}
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              <div className="pt-4 border-t border-[#EDF1EC] space-y-3">
                <div className="flex items-center justify-between text-xs text-[#4B5B50]">
                  <span>Đã chọn đáp án</span>
                  <span className="font-mono-num font-bold text-[#152019]">
                    {answeredCount}/{topic.questions.length}
                  </span>
                </div>
                <motion.button
                  type="button"
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setShowConfirmFinish(true)}
                  className="w-full py-2.5 px-4 bg-[#1F4D36] hover:bg-[#173B29] text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <FileCheck2 className="w-4 h-4" />
                  <span>Hoàn thành bài kiểm tra</span>
                </motion.button>
              </div>
            </aside>
          </div>

          {/* Confirm Finish Modal */}
          <AnimatePresence>
            {showConfirmFinish && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] flex items-center justify-center p-4"
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 8 }}
                  transition={{ duration: 0.2, ease: EASE_SMOOTH }}
                  className="bg-white border border-[#DDE3DC] rounded-xl max-w-md w-full p-6 shadow-xl"
                >
                  <h3 className="text-lg font-bold text-[#152019] mb-2">
                    Xác nhận nộp bài kiểm tra
                  </h3>
                  <p className="text-sm text-[#4B5B50] leading-relaxed">
                    Bạn đã trả lời{' '}
                    <span className="font-semibold text-[#152019]">
                      {answeredCount}/{topic.questions.length}
                    </span>{' '}
                    câu hỏi.{' '}
                    {answeredCount < topic.questions.length
                      ? `Vẫn còn ${topic.questions.length - answeredCount} câu chưa chọn đáp án. `
                      : ''}
                    Sau khi nhấn xác nhận, hệ thống sẽ chấm điểm thang 10 và hiển thị đáp án đúng cùng lời giải thích chi tiết.
                  </p>
                  <div className="mt-6 flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setShowConfirmFinish(false)}
                      className="px-4 py-2 text-sm font-semibold text-[#4B5B50] bg-[#F4F6F4] hover:bg-[#E7ECE7] rounded-lg cursor-pointer"
                    >
                      Làm tiếp
                    </button>
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.97 }}
                      onClick={finalizeQuiz}
                      className="px-5 py-2 text-sm font-semibold text-white bg-[#1F4D36] hover:bg-[#173B29] rounded-lg cursor-pointer"
                    >
                      Nộp bài ngay
                    </motion.button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>
      )}

      {stage === 'result' && completedAttempt && (
        <motion.section
          key="stage-result"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.26, ease: EASE_SMOOTH }}
          className="space-y-6"
        >
          {(() => {
            const gradeStyle = getGradeBadgeStyle(completedAttempt.grade);
            return (
              <div className="bg-white border border-[#DDE3DC] rounded-xl p-6 sm:p-8 shadow-sm">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-[#EDF1EC] pb-6">
                  <div>
                    <p className="text-xs font-semibold tracking-wider uppercase text-[#8C6516] mb-1">
                      Kết quả bài kiểm tra
                    </p>
                    <h2 className="text-2xl font-bold text-[#152019]">
                      {completedAttempt.topicTitle}
                    </h2>
                    <p className="text-sm text-[#4B5B50] mt-1.5">
                      Thí sinh:{' '}
                      <span className="font-semibold text-[#152019]">
                        {completedAttempt.candidateName}
                      </span>
                      <span className="mx-2" aria-hidden="true">·</span>
                      Đơn vị:{' '}
                      <span className="font-semibold text-[#152019]">
                        {completedAttempt.unitName}
                      </span>
                    </p>
                  </div>

                  <motion.div
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3, delay: 0.08, ease: EASE_SMOOTH }}
                    className="flex items-center gap-4 shrink-0"
                  >
                    <div className="text-right">
                      <span className="block text-xs font-semibold uppercase tracking-wider text-[#64756A]">
                        ĐIỂM SỐ
                      </span>
                      <span className="font-mono-num text-3xl font-bold text-[#1F4D36]">
                        {formatScore10(completedAttempt.score10)}
                      </span>
                    </div>
                    <div
                      className={`px-4 py-2 rounded-lg border text-sm font-bold ${gradeStyle.bg} ${gradeStyle.border} ${gradeStyle.text}`}
                    >
                      Xếp loại: {completedAttempt.grade}
                    </div>
                  </motion.div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-5 text-sm">
                  <div className="p-3.5 rounded-lg bg-[#FAFBF9] border border-[#EDF1EC]">
                    <span className="block text-xs text-[#64756A] mb-1">Số câu trả lời đúng</span>
                    <span className="font-mono-num font-bold text-[#152019]">
                      {completedAttempt.correctCount} / {completedAttempt.totalCount} câu
                    </span>
                  </div>
                  <div className="p-3.5 rounded-lg bg-[#FAFBF9] border border-[#EDF1EC]">
                    <span className="block text-xs text-[#64756A] mb-1">Thời gian đã làm</span>
                    <span className="font-mono-num font-bold text-[#152019]">
                      {formatDuration(completedAttempt.durationSeconds)}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-lg bg-[#FAFBF9] border border-[#EDF1EC]">
                    <span className="block text-xs text-[#64756A] mb-1">Thời gian nộp bài</span>
                    <span className="font-mono-num font-bold text-[#152019]">
                      {formatDateTime(completedAttempt.submittedAt)}
                    </span>
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.97 }}
                    onClick={onExit}
                    className="px-5 py-2.5 text-sm font-semibold text-white bg-[#1F4D36] hover:bg-[#173B29] rounded-lg transition-colors cursor-pointer"
                  >
                    Về Mục Chuyên Đề
                  </motion.button>
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.97 }}
                    onClick={() => {
                      setCompletedAttempt(null);
                      setAnswers({});
                      setCurrentIdx(0);
                      setElapsedSeconds(0);
                      setStage('candidate_info');
                    }}
                    className="px-5 py-2.5 text-sm font-semibold text-[#243329] bg-[#F4F6F4] hover:bg-[#E7ECE7] border border-[#DDE3DC] rounded-lg transition-colors cursor-pointer"
                  >
                    Làm lại chuyên đề này
                  </motion.button>
                </div>
              </div>
            );
          })()}

          {/* Detailed per-question review with Correct/Incorrect box and Explanation */}
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-[#152019]">
              Chi tiết đáp án & giải thích từng câu
            </h3>

            {topic.questions.map((q, idx) => {
              const userAns = completedAttempt.answers[q.id];
              const isCorrect = userAns === q.correctIndex;
              const isUnanswered = userAns === undefined;

              return (
                <motion.article
                  key={q.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.22,
                    delay: Math.min(idx * 0.03, 0.25),
                    ease: EASE_SMOOTH,
                  }}
                  className="bg-white border border-[#DDE3DC] rounded-xl p-6 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="font-mono-num text-sm font-bold text-[#152019]">
                      Câu {idx + 1}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold border ${
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
                          <span>
                            {isUnanswered
                              ? 'Chưa trả lời (Chưa chính xác!)'
                              : 'Chưa chính xác!'}
                          </span>
                        </>
                      )}
                    </span>
                  </div>

                  <p className="text-base font-semibold text-[#152019]">{q.text}</p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {q.options.map((optText, optIdx) => {
                      const isCorrectOpt = optIdx === q.correctIndex;
                      const isUserOpt = optIdx === userAns;
                      let boxClass = 'bg-[#FAFBF9] border-[#E4EAE3] text-[#4B5B50]';
                      if (isCorrectOpt) {
                        boxClass =
                          'bg-[#ECFDF5] border-[#86EFAC] text-[#166534] font-semibold';
                      } else if (isUserOpt && !isCorrect) {
                        boxClass =
                          'bg-[#FEF2F2] border-[#FCA5A5] text-[#B91C1C] font-semibold';
                      }

                      return (
                        <div
                          key={optIdx}
                          className={`p-3 rounded-lg border text-sm flex items-start gap-2.5 ${boxClass}`}
                        >
                          <span className="font-mono-num font-bold shrink-0">
                            {OPTION_LETTERS[optIdx]}.
                          </span>
                          <span>{optText}</span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="p-3.5 rounded-lg bg-[#F4F6F4] border border-[#DDE3DC] text-sm text-[#243329]">
                    <span className="font-bold text-[#1F4D36]">Giải thích: </span>
                    <span>
                      {q.explanation ||
                        `Đáp án đúng là ${OPTION_LETTERS[q.correctIndex]}. ${q.options[q.correctIndex]}`}
                    </span>
                  </div>
                </motion.article>
              );
            })}
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
};
