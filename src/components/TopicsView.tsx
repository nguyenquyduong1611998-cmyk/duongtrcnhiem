import React from 'react';
import { motion } from 'motion/react';
import { ArrowRight, BookOpen, Clock, HelpCircle } from 'lucide-react';
import { Topic } from '../types';

interface TopicsViewProps {
  topics: Topic[];
  onStartTopic: (topic: Topic) => void;
}

const EASE_SMOOTH = [0.16, 1, 0.3, 1] as const;

export const TopicsView: React.FC<TopicsViewProps> = ({ topics, onStartTopic }) => {
  return (
    <section className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[#DDE3DC] pb-5">
        <div>
          <p className="text-xs font-semibold tracking-wider uppercase text-[#8C6516] mb-1">
            Ngân hàng chuyên đề huấn luyện
          </p>
          <h2 className="text-2xl sm:text-3xl font-bold text-[#152019] tracking-tight">
            Mục Chuyên Đề Ôn Luyện & Kiểm Tra
          </h2>
        </div>
        <div className="text-sm text-[#4B5B50] tabular-nums whitespace-nowrap">
          Tổng số: <span className="font-semibold text-[#152019]">{topics.length} chuyên đề</span>
        </div>
      </div>

      {topics.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: EASE_SMOOTH }}
          className="bg-white border border-[#DDE3DC] rounded-xl p-10 text-center"
        >
          <BookOpen className="w-10 h-10 text-[#8A9A8F] mx-auto mb-3" />
          <p className="text-base font-semibold text-[#152019]">Chưa có chuyên đề nào</p>
          <p className="text-sm text-[#64756A] mt-1">
            Quản trị viên có thể tạo hoặc đẩy đề mới từ máy tính trong mục Quản Trị.
          </p>
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {topics.map((topic, index) => (
            <motion.article
              key={topic.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.26,
                delay: Math.min(index * 0.04, 0.24),
                ease: EASE_SMOOTH,
              }}
              whileHover={{ y: -3 }}
              className="group bg-white border border-[#DDE3DC] hover:border-[#1F4D36]/55 rounded-xl p-6 flex flex-col justify-between shadow-none hover:shadow-md transition-all duration-200"
            >
              <div>
                <div className="flex items-center gap-2 text-xs text-[#64756A] font-medium mb-2.5">
                  <span className="font-mono-num text-[#1F4D36] font-semibold">
                    {topic.code || `CD-${String(index + 1).padStart(2, '0')}`}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <HelpCircle className="w-3.5 h-3.5" />
                    {topic.questions.length} câu hỏi
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <Clock className="w-3.5 h-3.5" />
                    {topic.timeLimitMinutes} phút
                  </span>
                </div>

                <h3 className="text-lg font-bold text-[#152019] group-hover:text-[#1F4D36] transition-colors leading-snug mb-2">
                  {topic.title}
                </h3>

                <p className="text-sm text-[#4B5B50] leading-relaxed line-clamp-3">
                  {topic.description || 'Chuyên đề trắc nghiệm kiến thức quân nhân Tiểu đoàn 3.'}
                </p>
              </div>

              <div className="mt-6 pt-4 border-t border-[#EDF1EC] flex items-center justify-between gap-3">
                <span className="text-xs text-[#64756A]">Thang điểm 10</span>
                <motion.button
                  type="button"
                  disabled={topic.questions.length === 0}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => onStartTopic(topic)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#1F4D36] hover:bg-[#173B29] disabled:bg-[#9FB0A5] text-white text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed"
                >
                  <span>Vào làm bài</span>
                  <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </motion.button>
              </div>
            </motion.article>
          ))}
        </div>
      )}
    </section>
  );
};
