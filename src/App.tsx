import { useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { AdminPanel } from './components/AdminPanel';
import { HistoryView } from './components/HistoryView';
import { HonorBoardView } from './components/HonorBoardView';
import { LoginScreen } from './components/LoginScreen';
import { Navbar } from './components/Navbar';
import { QuizFlow } from './components/QuizFlow';
import { TopicsView } from './components/TopicsView';
import { MainTab, QuizAttempt, Topic, UserAccount } from './types';
import {
  loadAccounts,
  loadAttempts,
  loadSessionUserId,
  loadTopics,
  saveAccounts,
  saveAttempts,
  saveSessionUserId,
  saveTopics,
} from './utils/storage';

const EASE_SMOOTH = [0.16, 1, 0.3, 1] as const;

export default function App() {
  const [accounts, setAccounts] = useState<UserAccount[]>(() => loadAccounts());
  const [topics, setTopics] = useState<Topic[]>(() => loadTopics());
  const [attempts, setAttempts] = useState<QuizAttempt[]>(() => loadAttempts());

  const [currentUserId, setCurrentUserId] = useState<string | null>(() => loadSessionUserId());
  const [activeTab, setActiveTab] = useState<MainTab>('topics');
  const [activeQuizTopic, setActiveQuizTopic] = useState<Topic | null>(null);

  const currentUser =
    accounts.find((a) => a.id === currentUserId && a.active) || null;

  useEffect(() => {
    const handleStorageSync = (e: StorageEvent) => {
      if (e.key === 'tinhoc490_accounts_v1') setAccounts(loadAccounts());
      if (e.key === 'tinhoc490_topics_v1') setTopics(loadTopics());
      if (e.key === 'tinhoc490_attempts_v1') setAttempts(loadAttempts());
    };
    window.addEventListener('storage', handleStorageSync);
    return () => window.removeEventListener('storage', handleStorageSync);
  }, []);

  const handleLogin = (username: string, password: string): string | null => {
    const matched = accounts.find(
      (a) => a.username.toLowerCase() === username.toLowerCase()
    );
    if (!matched) {
      return 'Tên đăng nhập không tồn tại trong hệ thống.';
    }
    if (matched.password !== password) {
      return 'Mật khẩu chưa chính xác. Vui lòng kiểm tra lại.';
    }
    if (!matched.active) {
      return 'Tài khoản này đang bị khóa. Vui lòng liên hệ Quản trị viên.';
    }

    setCurrentUserId(matched.id);
    saveSessionUserId(matched.id);
    setActiveTab('topics');
    setActiveQuizTopic(null);
    return null;
  };

  const handleLogout = () => {
    setCurrentUserId(null);
    saveSessionUserId(null);
    setActiveQuizTopic(null);
    setActiveTab('topics');
  };

  const handleUpdateAccounts = (nextAccounts: UserAccount[]) => {
    setAccounts(nextAccounts);
    saveAccounts(nextAccounts);
  };

  const handleUpdateTopics = (nextTopics: Topic[]) => {
    setTopics(nextTopics);
    saveTopics(nextTopics);
  };

  const handleUpdateAttempts = (nextAttempts: QuizAttempt[]) => {
    setAttempts(nextAttempts);
    saveAttempts(nextAttempts);
  };

  const handleCompleteAttempt = (newAttempt: QuizAttempt) => {
    const next = [newAttempt, ...attempts];
    handleUpdateAttempts(next);
  };

  const viewKey = activeQuizTopic ? `quiz-${activeQuizTopic.id}` : `tab-${activeTab}`;

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence mode="wait">
        {!currentUser ? (
          <motion.div
            key="login-screen"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: EASE_SMOOTH }}
          >
            <LoginScreen onLogin={handleLogin} />
          </motion.div>
        ) : (
          <motion.div
            key="app-shell"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: EASE_SMOOTH }}
            className="min-h-screen flex flex-col bg-[#F4F6F4] text-[#152019]"
          >
            <Navbar
              currentUser={currentUser}
              activeTab={activeTab}
              onSelectTab={(tab) => {
                setActiveQuizTopic(null);
                setActiveTab(tab);
              }}
              onLogout={handleLogout}
            />

            <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-8">
              <AnimatePresence mode="wait">
                <motion.div
                  key={viewKey}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: EASE_SMOOTH }}
                >
                  {activeQuizTopic ? (
                    <QuizFlow
                      topic={activeQuizTopic}
                      currentUser={currentUser}
                      onCompleteAttempt={handleCompleteAttempt}
                      onExit={() => setActiveQuizTopic(null)}
                    />
                  ) : (
                    <>
                      {activeTab === 'topics' && (
                        <TopicsView
                          topics={topics}
                          onStartTopic={(topic) => setActiveQuizTopic(topic)}
                        />
                      )}
                      {activeTab === 'history' && (
                        <HistoryView
                          currentUser={currentUser}
                          attempts={attempts}
                          topics={topics}
                        />
                      )}
                      {activeTab === 'honor' && (
                        <HonorBoardView
                          currentUser={currentUser}
                          attempts={attempts}
                          accounts={accounts}
                          topics={topics}
                        />
                      )}
                      {activeTab === 'admin' && currentUser.role === 'admin' && (
                        <AdminPanel
                          currentUser={currentUser}
                          accounts={accounts}
                          topics={topics}
                          attempts={attempts}
                          onUpdateAccounts={handleUpdateAccounts}
                          onUpdateTopics={handleUpdateTopics}
                          onUpdateAttempts={handleUpdateAttempts}
                        />
                      )}
                    </>
                  )}
                </motion.div>
              </AnimatePresence>
            </main>

            <footer className="border-t border-[#DDE3DC] bg-white py-4 px-6">
              <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-[#64756A]">
                <span>Tin Học Số Lữ Đoàn Tên Lửa 490 · Tiểu Đoàn 3</span>
                <span>Tích cực, chủ động, tiến bộ toàn diện</span>
              </div>
            </footer>
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}
