import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { AdminPanel } from './components/AdminPanel';
import { CloudStorageModal } from './components/CloudStorageModal';
import { HistoryView } from './components/HistoryView';
import { HonorBoardView } from './components/HonorBoardView';
import { LoginScreen } from './components/LoginScreen';
import { Navbar } from './components/Navbar';
import { QuizFlow } from './components/QuizFlow';
import { TopicsView } from './components/TopicsView';
import { DEFAULT_ACCOUNTS } from './data/defaultData';
import {
  FIREBASE_PROJECT_ID,
  FIRESTORE_DATABASE_ID,
  auth,
  signInWithGoogleCloud,
  signOutGoogleCloud,
} from './firebase';
import { CloudStorageState, MainTab, QuizAttempt, Topic, UserAccount } from './types';
import {
  checkIsCloudAdmin,
  createEmptyCloudTracker,
  pushAllLocalDataToFirestore,
  saveSingleAttemptToFirestore,
  subscribeToCloudData,
  syncAccountsToFirestore,
  syncAttemptsDiffToFirestore,
  syncTopicsToFirestore,
} from './utils/firebaseSync';
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

function extractFirebaseCode(raw: unknown): string {
  if (raw && typeof raw === 'object' && 'code' in raw && typeof (raw as { code?: unknown }).code === 'string') {
    return (raw as { code: string }).code;
  }
  const msg = raw instanceof Error ? raw.message : String(raw);
  const match = msg.match(/\((auth\/[a-z0-9-]+|[a-z-]+\/[a-z0-9-]+)\)/i);
  return match ? match[1] : '';
}

function formatCloudErrorMessage(raw: unknown): string {
  const msg = raw instanceof Error ? raw.message : String(raw);
  const code = extractFirebaseCode(raw);

  if (msg.includes("Free daily read units per project (free tier database)")) {
    return `Đã vượt hạn mức đọc miễn phí hôm nay. Bạn có thể xem hoặc nâng cấp tại: https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/firestore/databases/${FIRESTORE_DATABASE_ID}/data?openUpgradeDialog=true`;
  }
  if (msg.includes('Quota exceeded') || code.includes('resource-exhausted')) {
    return 'Hạn mức sử dụng cơ sở dữ liệu hôm nay đã hết và sẽ tự đặt lại vào ngày mai.';
  }
  if (
    code === 'auth/unauthorized-domain' ||
    msg.includes('auth/unauthorized-domain')
  ) {
    const host = typeof window !== 'undefined' ? window.location.hostname : '';
    return `Tên miền "${host}" chưa được cấp phép đăng nhập Google trong Firebase. Hãy mở Firebase Console (https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/authentication/settings) -> Authorized domains -> thêm tên miền "${host}" rồi thử lại.`;
  }
  if (
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request' ||
    msg.includes('popup-closed-by-user') ||
    msg.includes('cancelled-popup-request')
  ) {
    return 'Bạn đã đóng cửa sổ đăng nhập Google trước khi hoàn tất.';
  }
  if (code === 'auth/popup-blocked' || msg.includes('popup-blocked')) {
    return 'Trình duyệt đang chặn cửa sổ bật lên (popup) đăng nhập Google. Vui lòng cho phép popup cho trang này rồi thử lại.';
  }
  if (code === 'auth/operation-not-allowed' || msg.includes('operation-not-allowed')) {
    return 'Phương thức đăng nhập Google chưa được bật trong Firebase Authentication. Hãy bật Google Sign-In trong Firebase Console.';
  }
  if (
    code === 'auth/network-request-failed' ||
    msg.includes('network-request-failed') ||
    msg.includes('the client is offline')
  ) {
    return 'Không thể kết nối tới máy chủ Google/Firebase. Vui lòng kiểm tra kết nối Internet rồi thử lại.';
  }
  if (
    code === 'auth/web-storage-unsupported' ||
    code === 'auth/internal-error' ||
    msg.includes('web-storage-unsupported') ||
    msg.includes('auth/internal-error')
  ) {
    return 'Trình duyệt đang hạn chế cookie bên thứ ba hoặc bộ nhớ phiên cho đăng nhập Google. Hãy mở trang ở cửa sổ trình duyệt độc lập (không ẩn danh) và thử lại.';
  }
  if (
    msg.includes('Missing or insufficient permissions') ||
    code.includes('permission-denied')
  ) {
    return 'Tài khoản Google này chưa đủ quyền ghi vào mục quản trị dữ liệu này (permission-denied).';
  }
  if (msg.includes('failed-precondition') || msg.includes('requires an index')) {
    return 'Truy vấn cơ sở dữ liệu cần chỉ mục (index) hoặc cấu hình bổ sung trên Firestore.';
  }

  const detail = code || (msg.length <= 160 ? msg : msg.slice(0, 160) + '...');
  return `Không thể kết nối hoặc đồng bộ với đám mây (${detail}). Dữ liệu vẫn được lưu an toàn trên thiết bị.`;
}

export default function App() {
  const [accounts, setAccounts] = useState<UserAccount[]>(() => loadAccounts());
  const [topics, setTopics] = useState<Topic[]>(() => loadTopics());
  const [attempts, setAttempts] = useState<QuizAttempt[]>(() => loadAttempts());
  const [honorEntries, setHonorEntries] = useState<QuizAttempt[]>([]);

  const [currentUserId, setCurrentUserId] = useState<string | null>(() => loadSessionUserId());
  const [activeTab, setActiveTab] = useState<MainTab>('topics');
  const [activeQuizTopic, setActiveQuizTopic] = useState<Topic | null>(null);
  const [showCloudModal, setShowCloudModal] = useState(false);

  // Firebase Auth & Firestore Cloud Sync state
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [cloudState, setCloudState] = useState<CloudStorageState>({
    authReady: false,
    connected: false,
    userEmail: null,
    userDisplayName: null,
    isCloudAdmin: false,
    syncing: false,
    lastSyncedAt: null,
    error: null,
    cloudAccountCount: 0,
    cloudTopicCount: 0,
    cloudAttemptCount: 0,
  });

  const trackerRef = useRef(createEmptyCloudTracker());
  const accountsRef = useRef(accounts);
  const topicsRef = useRef(topics);
  const attemptsRef = useRef(attempts);
  const seededRef = useRef({ accounts: false, topics: false, attempts: false });
  const isSeedingRef = useRef(false);

  useEffect(() => {
    accountsRef.current = accounts;
  }, [accounts]);

  useEffect(() => {
    topicsRef.current = topics;
  }, [topics]);

  useEffect(() => {
    attemptsRef.current = attempts;
  }, [attempts]);

  const currentUser =
    accounts.find((a) => a.id === currentUserId && a.active) || null;

  // Cross-tab localStorage sync
  useEffect(() => {
    const handleStorageSync = (e: StorageEvent) => {
      if (e.key === 'tinhoc490_accounts_v1') setAccounts(loadAccounts());
      if (e.key === 'tinhoc490_topics_v1') setTopics(loadTopics());
      if (e.key === 'tinhoc490_attempts_v1') setAttempts(loadAttempts());
    };
    window.addEventListener('storage', handleStorageSync);
    return () => window.removeEventListener('storage', handleStorageSync);
  }, []);

  // Listen to Firebase Auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user || !user.emailVerified) {
        setFirebaseUser(null);
        trackerRef.current = createEmptyCloudTracker();
        seededRef.current = { accounts: false, topics: false, attempts: false };
        isSeedingRef.current = false;
        setHonorEntries([]);
        setCloudState({
          authReady: true,
          connected: false,
          userEmail: null,
          userDisplayName: null,
          isCloudAdmin: false,
          syncing: false,
          lastSyncedAt: null,
          error: null,
          cloudAccountCount: 0,
          cloudTopicCount: 0,
          cloudAttemptCount: 0,
        });
        return;
      }

      setFirebaseUser(user);
      let isAdmin = false;
      try {
        isAdmin = await checkIsCloudAdmin(user);
      } catch (err) {
        console.error('Admin check failed:', err);
      }

      setCloudState((prev) => ({
        ...prev,
        authReady: true,
        connected: true,
        userEmail: user.email,
        userDisplayName: user.displayName,
        isCloudAdmin: isAdmin,
        syncing: true,
        error: null,
      }));
    });

    return () => unsubscribe();
  }, []);

  // Attach Firestore onSnapshot listeners ONLY when Firebase Auth is ready & user is authenticated
  useEffect(() => {
    if (!cloudState.authReady || !cloudState.connected || !firebaseUser) {
      return;
    }

    const tracker = createEmptyCloudTracker();
    trackerRef.current = tracker;
    seededRef.current = { accounts: false, topics: false, attempts: false };
    isSeedingRef.current = false;
    const isAdmin = cloudState.isCloudAdmin;

    const unsubscribe = subscribeToCloudData({
      user: firebaseUser,
      isCloudAdmin: isAdmin,
      tracker,
      onAccounts: (cloudAccounts) => {
        if (isSeedingRef.current) return;
        if (cloudAccounts.length > 0) {
          seededRef.current.accounts = true;
          const hasRootAdmin = cloudAccounts.some(
            (a) => a.username.toLowerCase() === 'admin'
          );
          const merged = hasRootAdmin
            ? cloudAccounts
            : [DEFAULT_ACCOUNTS[0], ...cloudAccounts];
          setAccounts(merged);
          saveAccounts(merged);
          setCloudState((prev) => ({
            ...prev,
            cloudAccountCount: merged.length,
            lastSyncedAt: new Date().toISOString(),
          }));
        }
      },
      onTopics: (cloudTopics) => {
        if (isSeedingRef.current) return;
        if (cloudTopics.length > 0) {
          seededRef.current.topics = true;
          setTopics(cloudTopics);
          saveTopics(cloudTopics);
          setCloudState((prev) => ({
            ...prev,
            cloudTopicCount: cloudTopics.length,
            lastSyncedAt: new Date().toISOString(),
          }));
        }
      },
      onAttempts: (cloudAttempts) => {
        if (isSeedingRef.current) return;
        if (isAdmin) {
          if (cloudAttempts.length > 0) {
            seededRef.current.attempts = true;
            setAttempts(cloudAttempts);
            saveAttempts(cloudAttempts);
          } else if (seededRef.current.attempts) {
            setAttempts([]);
            saveAttempts([]);
          }
          setCloudState((prev) => ({
            ...prev,
            cloudAttemptCount: cloudAttempts.length,
            lastSyncedAt: new Date().toISOString(),
          }));
        } else {
          const byId = new Map<string, QuizAttempt>();
          for (const localAtt of attemptsRef.current) byId.set(localAtt.id, localAtt);
          for (const cloudAtt of cloudAttempts) byId.set(cloudAtt.id, cloudAtt);
          const merged = Array.from(byId.values()).sort(
            (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
          );
          setAttempts(merged);
          saveAttempts(merged);
          setCloudState((prev) => ({
            ...prev,
            cloudAttemptCount: cloudAttempts.length,
            lastSyncedAt: new Date().toISOString(),
          }));
        }
      },
      onHonorEntries: (entries) => {
        setHonorEntries(entries);
      },
      onSyncReady: () => {
        // Sequential, race-free initial seed when Cloud Admin connects to an empty Firestore DB
        if (
          isAdmin &&
          !isSeedingRef.current &&
          ((!seededRef.current.accounts && tracker.accountIds.size === 0 && accountsRef.current.length > 0) ||
            (!seededRef.current.topics && tracker.topicIds.size === 0 && topicsRef.current.length > 0) ||
            (!seededRef.current.attempts && tracker.attemptIds.size === 0 && attemptsRef.current.length > 0))
        ) {
          isSeedingRef.current = true;
          void (async () => {
            try {
              if (!seededRef.current.accounts && tracker.accountIds.size === 0 && accountsRef.current.length > 0) {
                seededRef.current.accounts = true;
                await syncAccountsToFirestore([], accountsRef.current, tracker);
              }
              if (!seededRef.current.topics && tracker.topicIds.size === 0 && topicsRef.current.length > 0) {
                seededRef.current.topics = true;
                await syncTopicsToFirestore([], topicsRef.current, tracker);
              }
              if (!seededRef.current.attempts && tracker.attemptIds.size === 0 && attemptsRef.current.length > 0) {
                seededRef.current.attempts = true;
                for (const att of attemptsRef.current) {
                  await saveSingleAttemptToFirestore(att, firebaseUser.uid, tracker);
                }
              }
              setCloudState((prev) => ({
                ...prev,
                syncing: false,
                cloudAccountCount: tracker.accountIds.size,
                cloudTopicCount: tracker.topicIds.size,
                cloudAttemptCount: tracker.attemptIds.size,
                lastSyncedAt: new Date().toISOString(),
                error: null,
              }));
            } catch (err) {
              console.error('Initial cloud seed error:', err);
              setCloudState((prev) => ({
                ...prev,
                syncing: false,
                error: formatCloudErrorMessage(err),
              }));
            } finally {
              isSeedingRef.current = false;
            }
          })();
          return;
        }

        setCloudState((prev) => ({
          ...prev,
          syncing: false,
          cloudAccountCount: tracker.accountIds.size,
          cloudTopicCount: tracker.topicIds.size,
          cloudAttemptCount: tracker.attemptIds.size,
          lastSyncedAt: new Date().toISOString(),
        }));
      },
      onError: (errMsg) => {
        console.error('Firestore listener error:', errMsg);
        setCloudState((prev) => ({
          ...prev,
          syncing: false,
          error: formatCloudErrorMessage(errMsg),
        }));
      },
    });

    return () => {
      unsubscribe();
    };
  }, [cloudState.authReady, cloudState.connected, cloudState.isCloudAdmin, firebaseUser]);

  
const handleConnectCloud = useCallback(async () => {
  console.info('[Firebase] Bắt đầu đăng nhập Google');

  setCloudState((prev) => ({
    ...prev,
    syncing: true,
    error: null,
  }));

  try {
    const result = await signInWithGoogleCloud();

    console.info('[Firebase] Google đăng nhập thành công', {
      hasUser: Boolean(result.user),
      emailVerified: result.user.emailVerified,
    });

    console.info('[Firebase] Đang chờ kiểm tra quyền và đồng bộ Firestore');
  } catch (err) {
    console.error('[Firebase] Google đăng nhập thất bại:', err);

    setCloudState((prev) => ({
      ...prev,
      syncing: false,
      error: formatCloudErrorMessage(err),
    }));
  }
}, []);


  const handleDisconnectCloud = useCallback(async () => {
    setCloudState((prev) => ({ ...prev, syncing: true, error: null }));
    try {
      await signOutGoogleCloud();
    } catch (err) {
      setCloudState((prev) => ({
        ...prev,
        syncing: false,
        error: formatCloudErrorMessage(err),
      }));
    }
  }, []);

  const handleSyncCloudNow = useCallback(async () => {
    if (!firebaseUser || !cloudState.connected) return;
    setCloudState((prev) => ({ ...prev, syncing: true, error: null }));
    try {
      await pushAllLocalDataToFirestore({
        accounts: accountsRef.current,
        topics: topicsRef.current,
        attempts: attemptsRef.current,
        ownerUid: firebaseUser.uid,
        isCloudAdmin: cloudState.isCloudAdmin,
        tracker: trackerRef.current,
      });
      setCloudState((prev) => ({
        ...prev,
        syncing: false,
        lastSyncedAt: new Date().toISOString(),
        error: null,
      }));
    } catch (err) {
      setCloudState((prev) => ({
        ...prev,
        syncing: false,
        error: formatCloudErrorMessage(err),
      }));
    }
  }, [firebaseUser, cloudState.connected, cloudState.isCloudAdmin]);

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
    const prevAccounts = accountsRef.current;
    setAccounts(nextAccounts);
    saveAccounts(nextAccounts);

    if (cloudState.connected && cloudState.isCloudAdmin) {
      seededRef.current.accounts = true;
      void syncAccountsToFirestore(prevAccounts, nextAccounts, trackerRef.current)
        .then(() => {
          setCloudState((prev) => ({
            ...prev,
            lastSyncedAt: new Date().toISOString(),
            error: null,
          }));
        })
        .catch((err) => {
          setCloudState((prev) => ({ ...prev, error: formatCloudErrorMessage(err) }));
        });
    }
  };

  const handleUpdateTopics = (nextTopics: Topic[]) => {
    const prevTopics = topicsRef.current;
    setTopics(nextTopics);
    saveTopics(nextTopics);

    if (cloudState.connected && cloudState.isCloudAdmin) {
      seededRef.current.topics = true;
      void syncTopicsToFirestore(prevTopics, nextTopics, trackerRef.current)
        .then(() => {
          setCloudState((prev) => ({
            ...prev,
            lastSyncedAt: new Date().toISOString(),
            error: null,
          }));
        })
        .catch((err) => {
          setCloudState((prev) => ({ ...prev, error: formatCloudErrorMessage(err) }));
        });
    }
  };

  const handleUpdateAttempts = (nextAttempts: QuizAttempt[]) => {
    setAttempts(nextAttempts);
    saveAttempts(nextAttempts);

    if (cloudState.connected && firebaseUser) {
      seededRef.current.attempts = true;
      void syncAttemptsDiffToFirestore(
        nextAttempts,
        firebaseUser.uid,
        cloudState.isCloudAdmin,
        trackerRef.current
      )
        .then(() => {
          setCloudState((prev) => ({
            ...prev,
            lastSyncedAt: new Date().toISOString(),
            error: null,
          }));
        })
        .catch((err) => {
          setCloudState((prev) => ({ ...prev, error: formatCloudErrorMessage(err) }));
        });
    }
  };

  const handleCompleteAttempt = (newAttempt: QuizAttempt) => {
    const next = [newAttempt, ...attemptsRef.current];
    setAttempts(next);
    saveAttempts(next);

    if (cloudState.connected && firebaseUser) {
      seededRef.current.attempts = true;
      void saveSingleAttemptToFirestore(newAttempt, firebaseUser.uid, trackerRef.current)
        .then(() => {
          setCloudState((prev) => ({
            ...prev,
            lastSyncedAt: new Date().toISOString(),
            error: null,
          }));
        })
        .catch((err) => {
          setCloudState((prev) => ({ ...prev, error: formatCloudErrorMessage(err) }));
        });
    }
  };

  // Honor Board combines shared public cloud honor entries with local/own attempts
  const honorBoardAttempts = useMemo(() => {
    if (!cloudState.connected || cloudState.isCloudAdmin || honorEntries.length === 0) {
      return attempts;
    }
    const byId = new Map<string, QuizAttempt>();
    for (const entry of honorEntries) byId.set(entry.id, entry);
    for (const own of attempts) byId.set(own.id, own);
    return Array.from(byId.values()).sort(
      (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );
  }, [attempts, honorEntries, cloudState.connected, cloudState.isCloudAdmin]);

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
              cloudConnected={cloudState.connected}
              onSelectTab={(tab) => {
                setActiveQuizTopic(null);
                setActiveTab(tab);
              }}
              onOpenCloudStorage={() => setShowCloudModal(true)}
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
                          attempts={honorBoardAttempts}
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
                          cloud={cloudState}
                          onUpdateAccounts={handleUpdateAccounts}
                          onUpdateTopics={handleUpdateTopics}
                          onUpdateAttempts={handleUpdateAttempts}
                          onConnectCloud={handleConnectCloud}
                          onDisconnectCloud={handleDisconnectCloud}
                          onSyncCloudNow={handleSyncCloudNow}
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

            <AnimatePresence>
              {showCloudModal && (
                <CloudStorageModal
                  cloud={cloudState}
                  localCounts={{
                    accounts: accounts.length,
                    topics: topics.length,
                    attempts: attempts.length,
                  }}
                  onConnect={handleConnectCloud}
                  onDisconnect={handleDisconnectCloud}
                  onSyncNow={handleSyncCloudNow}
                  onClose={() => setShowCloudModal(false)}
                />
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}
