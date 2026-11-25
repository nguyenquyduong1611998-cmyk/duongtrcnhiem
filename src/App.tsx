import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { Cloud, X } from 'lucide-react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { AdminPanel } from './components/AdminPanel';
import { Phase6AdminDraftsPanel } from './components/Phase6AdminDraftsPanel';
import { CloudStorageModal } from './components/CloudStorageModal';
import { HistoryView } from './components/HistoryView';
import { HonorBoardView } from './components/HonorBoardView';
import { LoginScreen } from './components/LoginScreen';
import { loginWithStagingUsername, provisionDemoStudent, deleteDemoStudent, listSyntheticD1Accounts, createSyntheticD1Account, changeSyntheticD1AccountStatus, deleteSyntheticD1Account, resetSyntheticD1AccountPassword, verifySyntheticD1TemporaryPassword, changeSyntheticD1Password, SYNTHETIC_RESET_REQUIRED } from './utils/serverlessAuth';
import { createDemoResultProbe, readDemoResultProbe, deleteDemoResultProbe, assertOtherDemoStudentDenied } from './utils/stagingResultProbe';
import {getSyntheticQuizQuestion,submitSyntheticQuiz,readOwnSyntheticQuiz,listSyntheticQuizAttempts} from './utils/syntheticGradedQuiz';
import {isPhase5DemoPreviewHostname,listPhase5DemoTopics,readPhase5DemoTopic} from './utils/phase5DemoTopics';
import {listPhase5AdminScores} from './utils/phase5AdminResults';
import {isPhase6AdminDraftsUiEnabled} from './utils/phase6AdminDrafts';
import {isPhase5SyntheticSubmitUiEnabled,submitPhase5SyntheticAttempt,readOwnPhase5SyntheticAttempt} from './utils/phase5SyntheticSubmission';
import type {Phase5DemoAnswerMap} from './utils/phase5SyntheticSubmission';
import {readStagingD1Preflight} from './utils/stagingD1Preflight';
import { Navbar } from './components/Navbar';
import { QuizFlow } from './components/QuizFlow';
import { TopicsView } from './components/TopicsView';
import { DEFAULT_ACCOUNTS } from './data/defaultData';
import {
  BOOTSTRAPPED_ADMIN_EMAIL,
  BOOTSTRAPPED_ADMIN_UID,
  FIREBASE_PROJECT_ID,
  FIRESTORE_DATABASE_ID,
  IS_FIREBASE_STAGING,
  auth,
  signInWithGoogleCloud,
  signOutGoogleCloud,
} from './firebase';
import { CloudStorageState, MainTab, QuizAttempt, Topic, UserAccount } from './types';
import {
  checkIsCloudAdmin,
  createEmptyCloudTracker,
  createStagingTestTopic,
  createStagingAccountProbe,
  deleteStagingAccountProbe,
  deleteStagingTestTopic,
  hashUnitPassword,
  mergeAndSyncOnConnect,
  pushAllLocalDataToFirestore,
  readStagingTestTopic,
  readStagingAccountProbe,
  STAGING_TEST_TOPIC_ID,
  saveSingleAttemptToFirestore,
  subscribeToCloudData,
  subscribeToPublicUnitData,
  syncAccountsToFirestore,
  syncAttemptsDiffToFirestore,
  syncTopicsToFirestore,
  testStagingAdminWrite,
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
const CONNECT_POPUP_TIMEOUT_MS = 25000;

function extractFirebaseCode(raw: unknown): string {
  if (
    raw &&
    typeof raw === 'object' &&
    'code' in raw &&
    typeof (raw as { code?: unknown }).code === 'string'
  ) {
    return (raw as { code: string }).code;
  }
  const msg = raw instanceof Error ? raw.message : String(raw);
  const match = msg.match(/\((auth\/[a-z0-9-]+|[a-z-]+\/[a-z0-9-]+)\)/i);
  return match ? match[1] : '';
}

function formatCloudErrorMessage(raw: unknown): string {
  const msg = raw instanceof Error ? raw.message : String(raw);
  const code = extractFirebaseCode(raw);

  if (code === 'auth/popup-timeout' || msg.includes('auth/popup-timeout')) {
    return 'Cửa sổ đăng nhập Google phản hồi quá lâu hoặc đã bị đóng mà trình duyệt không gửi tín hiệu về. Vui lòng bấm kết nối lại, kiểm tra trình duyệt không chặn cửa sổ bật lên (popup), hoặc mở trang bằng trình duyệt độc lập.';
  }
  if (msg.includes("Free daily read units per project (free tier database)")) {
    return `Đã vượt hạn mức đọc miễn phí hôm nay. Bạn có thể xem hoặc nâng cấp tại: https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/firestore/databases/${FIRESTORE_DATABASE_ID}/data?openUpgradeDialog=true`;
  }
  if (msg.includes('Quota exceeded') || code.includes('resource-exhausted')) {
    return 'Hạn mức sử dụng cơ sở dữ liệu hôm nay đã hết và sẽ tự đặt lại vào ngày mai.';
  }
  if (code === 'auth/unauthorized-domain' || msg.includes('auth/unauthorized-domain')) {
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
    return `Tài khoản Google này chưa đủ quyền ghi vào mục quản trị dữ liệu này (permission-denied). Để đồng bộ Tài khoản & Bộ đề, hãy đăng nhập bằng tài khoản Quản trị (${BOOTSTRAPPED_ADMIN_EMAIL}).`;
  }
  if (msg.includes('failed-precondition') || msg.includes('requires an index')) {
    return 'Truy vấn cơ sở dữ liệu cần chỉ mục (index) hoặc cấu hình bổ sung trên Firestore.';
  }

  const detail = code || (msg.length <= 160 ? msg : msg.slice(0, 160) + '...');
  return `Không thể kết nối hoặc đồng bộ với đám mây (${detail}). Dữ liệu vẫn được lưu an toàn trên thiết bị.`;
}

// On staging, a partial cloud snapshot must never erase topics already on the device.
// Only the exact synthetic test topic is hidden; real cloud changes merge by document ID.
function mergeTopicsSafely(local: Topic[], cloud: Topic[]): Topic[] {
  if (!IS_FIREBASE_STAGING) return cloud;
  const byId = new Map<string, Topic>();
  for (const topic of local) {
    if (topic.id !== STAGING_TEST_TOPIC_ID) byId.set(topic.id, topic);
  }
  for (const topic of cloud) {
    if (topic.id !== STAGING_TEST_TOPIC_ID) byId.set(topic.id, topic);
  }
  return Array.from(byId.values()).sort((a, b) => a.code.localeCompare(b.code));
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
  const [dismissedCloudBanner, setDismissedCloudBanner] = useState(false);

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
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const activeWriteCountRef = useRef(0);
  const connectAttemptRef = useRef(0);
  const connectTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    accountsRef.current = accounts;
  }, [accounts]);

  useEffect(() => {
    topicsRef.current = topics;
  }, [topics]);

  useEffect(() => {
    attemptsRef.current = attempts;
  }, [attempts]);

  useEffect(() => {
    return () => {
      if (connectTimeoutRef.current !== null) {
        window.clearTimeout(connectTimeoutRef.current);
      }
    };
  }, []);

  const currentUser =
    accounts.find((a) => a.id === currentUserId && a.active) || null;

  // A browser-local 'admin' role alone cannot grant Admin panel access on staging.
  // Sensitive operations continue to be enforced by Firebase Security Rules.
  const adminAccessAllowed = !IS_FIREBASE_STAGING || (
    currentUser?.role === 'admin' &&
    cloudState.connected &&
    cloudState.isCloudAdmin &&
    firebaseUser?.uid === BOOTSTRAPPED_ADMIN_UID
  );

  // Serialize all Firestore writes in strict FIFO order so topics always finish before attempts
  const enqueueCloudWrite = useCallback((task: () => Promise<void>) => {
    activeWriteCountRef.current += 1;
    setCloudState((prev) => ({ ...prev, syncing: true, error: null }));

    const next = writeQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          await task();
          setCloudState((prev) => ({
            ...prev,
            cloudAccountCount: trackerRef.current.accountIds.size,
            cloudTopicCount: trackerRef.current.topicIds.size,
            cloudAttemptCount: trackerRef.current.attemptIds.size,
            lastSyncedAt: new Date().toISOString(),
            error: null,
          }));
        } catch (err) {
          console.error('Auto-sync write failed:', err);
          setCloudState((prev) => ({
            ...prev,
            error: formatCloudErrorMessage(err),
          }));
        } finally {
          activeWriteCountRef.current = Math.max(0, activeWriteCountRef.current - 1);
          if (activeWriteCountRef.current === 0) {
            setCloudState((prev) => ({ ...prev, syncing: false }));
          }
        }
      });

    writeQueueRef.current = next;
    return next;
  }, []);

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
      console.info('[Firebase Auth]', {
  hasUser: Boolean(user),
  hasEmail: Boolean(user?.email),
  emailVerified: user?.emailVerified,
  providers: user?.providerData.map(p => p.providerId),
});
      if (connectTimeoutRef.current !== null) {
        window.clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }

      if (!user) {
        setFirebaseUser(null);
        trackerRef.current = createEmptyCloudTracker();
        setCloudState((prev) => ({
          ...prev,
          authReady: true,
          connected: false,
          userEmail: null,
          userDisplayName: null,
          isCloudAdmin: false,
          syncing: false,
          lastSyncedAt: null,
          error: null,
        }));
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

  // Public real-time Firestore subscription on ALL student/guest devices (NO Google Sign-In required!)
  // Automatically pulls live Topics, Questions, Hashed Account Directory, and Honor Entries from Firestore.
  useEffect(() => {
    if (cloudState.connected) {
      return;
    }

    let cancelled = false;
    const publicTracker = createEmptyCloudTracker();
    trackerRef.current = publicTracker;

    const unsubscribePublic = subscribeToPublicUnitData({
      tracker: publicTracker,
      onTopics: (cloudTopics) => {
        if (cancelled || cloudTopics.length === 0) return;
        const nextTopics = mergeTopicsSafely(topicsRef.current, cloudTopics);
        setTopics(nextTopics);
        saveTopics(nextTopics);
        setCloudState((prev) => ({
          ...prev,
          cloudTopicCount: cloudTopics.filter((t) => !IS_FIREBASE_STAGING || t.id !== STAGING_TEST_TOPIC_ID).length,
        }));
      },
      onDirectoryAccounts: (dirAccounts) => {
        if (cancelled || dirAccounts.length === 0) return;
        void (async () => {
          const prevList = accountsRef.current;
          const prevById = new Map(prevList.map((a) => [a.id, a]));
          const prevByLower = new Map(prevList.map((a) => [a.username.toLowerCase(), a]));

          const nextAccounts: UserAccount[] = [];
          for (const dir of dirAccounts) {
            const localMatch = prevById.get(dir.id) || prevByLower.get(dir.usernameLower);
            let preservedPassword = '';
            if (localMatch && localMatch.password) {
              const localHash = await hashUnitPassword(dir.username, localMatch.password);
              if (localHash === dir.passwordHash) {
                preservedPassword = localMatch.password;
              }
            }
            nextAccounts.push({
              id: dir.id,
              username: dir.username,
              password: preservedPassword,
              passwordHash: dir.passwordHash,
              fullName: dir.fullName,
              defaultUnit: dir.defaultUnit,
              role: dir.role,
              active: dir.active,
              createdAt: dir.createdAt,
              updatedAt: dir.updatedAt,
            });
          }

          if (cancelled) return;

          const hasRootAdmin = nextAccounts.some((a) => a.username.toLowerCase() === 'admin');
          const finalAccounts = hasRootAdmin
            ? nextAccounts
            : [DEFAULT_ACCOUNTS[0], ...nextAccounts];

          setAccounts(finalAccounts);
          saveAccounts(finalAccounts);
          setCloudState((prev) => ({
            ...prev,
            cloudAccountCount: finalAccounts.length,
          }));
        })();
      },
      onHonorEntries: (entries) => {
        if (cancelled) return;
        setHonorEntries(entries);
        setCloudState((prev) => ({
          ...prev,
          cloudAttemptCount: entries.length,
        }));
      },
      onError: (errMsg) => {
        console.warn('Public unit sync listener:', errMsg);
      },
    });

    return () => {
      cancelled = true;
      unsubscribePublic();
    };
  }, [cloudState.connected]);

  // Connect to cloud. On staging, read-only initialization requires an internal admin session.
  useEffect(() => {
    if (!cloudState.authReady || !cloudState.connected || !firebaseUser) {
      return;
    }
    // A Google admin token must never import data from a student/guest local session.
    if (IS_FIREBASE_STAGING && currentUser?.role !== 'admin') {
      setCloudState((prev) => ({
        ...prev,
        syncing: false,
        error: 'Bản thử nghiệm chỉ cho phép quản trị viên nội bộ kết nối dữ liệu đám mây. Học viên tạm thời chưa đồng bộ trên staging.',
      }));
      return;
    }

    let cancelled = false;
    let unsubscribeListeners: (() => void) | null = null;
    const tracker = createEmptyCloudTracker();
    trackerRef.current = tracker;
    const isAdmin = cloudState.isCloudAdmin;

    const initializeSync = async () => {
      setCloudState((prev) => ({ ...prev, syncing: true, error: null }));
      try {
        const merged = await mergeAndSyncOnConnect({
          user: firebaseUser,
          isCloudAdmin: isAdmin,
          localAccounts: accountsRef.current,
          localTopics: topicsRef.current,
          localAttempts: attemptsRef.current,
          defaultAdminAccount: DEFAULT_ACCOUNTS[0],
          tracker,
          allowUploads: !IS_FIREBASE_STAGING,
        });

        if (cancelled) return;

        if (isAdmin) {
          setAccounts(merged.accounts);
          saveAccounts(merged.accounts);
        }
        if (merged.topics.length > 0) {
          setTopics(merged.topics);
          saveTopics(merged.topics);
        }
        setAttempts(merged.attempts);
        saveAttempts(merged.attempts);

        setCloudState((prev) => ({
          ...prev,
          syncing: false,
          cloudAccountCount: merged.counts.accounts,
          cloudTopicCount: merged.counts.topics,
          cloudAttemptCount: merged.counts.attempts,
          lastSyncedAt: new Date().toISOString(),
          error: null,
        }));

        // Attach real-time Firestore listeners AFTER initial merge completes
        unsubscribeListeners = subscribeToCloudData({
          user: firebaseUser,
          isCloudAdmin: isAdmin,
          tracker,
          onAccounts: (cloudAccounts) => {
            if (activeWriteCountRef.current > 0 || cloudAccounts.length === 0) return;
            const hasRootAdmin = cloudAccounts.some(
              (a) => a.username.toLowerCase() === 'admin'
            );
            const nextList = hasRootAdmin
              ? cloudAccounts
              : [DEFAULT_ACCOUNTS[0], ...cloudAccounts];
            setAccounts(nextList);
            saveAccounts(nextList);
            setCloudState((prev) => ({
              ...prev,
              cloudAccountCount: nextList.length,
              lastSyncedAt: new Date().toISOString(),
            }));
          },
          onTopics: (cloudTopics) => {
            if (activeWriteCountRef.current > 0 || cloudTopics.length === 0) return;
            const nextTopics = mergeTopicsSafely(topicsRef.current, cloudTopics);
            setTopics(nextTopics);
            saveTopics(nextTopics);
            setCloudState((prev) => ({
              ...prev,
              cloudTopicCount: cloudTopics.filter((t) => !IS_FIREBASE_STAGING || t.id !== STAGING_TEST_TOPIC_ID).length,
              lastSyncedAt: new Date().toISOString(),
            }));
          },
          onAttempts: (cloudAttempts) => {
            if (activeWriteCountRef.current > 0) return;
            if (isAdmin) {
              setAttempts(cloudAttempts);
              saveAttempts(cloudAttempts);
              setCloudState((prev) => ({
                ...prev,
                cloudAttemptCount: cloudAttempts.length,
                lastSyncedAt: new Date().toISOString(),
              }));
            } else {
              const byId = new Map<string, QuizAttempt>();
              for (const localAtt of attemptsRef.current) byId.set(localAtt.id, localAtt);
              for (const cloudAtt of cloudAttempts) byId.set(cloudAtt.id, cloudAtt);
              const nextMerged = Array.from(byId.values()).sort(
                (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
              );
              setAttempts(nextMerged);
              saveAttempts(nextMerged);
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
          onError: (errMsg) => {
            console.error('Firestore listener error:', errMsg);
            setCloudState((prev) => ({
              ...prev,
              syncing: false,
              error: formatCloudErrorMessage(errMsg),
            }));
          },
        });
      } catch (err) {
        if (cancelled) return;
        console.error('Initial cloud merge & sync failed:', err);
        setCloudState((prev) => ({
          ...prev,
          syncing: false,
          error: formatCloudErrorMessage(err),
        }));
      }
    };

    void initializeSync();

    return () => {
      cancelled = true;
      if (unsubscribeListeners) unsubscribeListeners();
    };
  }, [cloudState.authReady, cloudState.connected, cloudState.isCloudAdmin, firebaseUser, currentUser?.id, currentUser?.role]);

  // Auto re-sync when network connection comes back online
  useEffect(() => {
    if (!cloudState.connected || !firebaseUser || IS_FIREBASE_STAGING) return;
    const handleOnline = () => {
      void enqueueCloudWrite(async () => {
        await pushAllLocalDataToFirestore({
          accounts: accountsRef.current,
          topics: topicsRef.current,
          attempts: attemptsRef.current,
          ownerUid: firebaseUser.uid,
          isCloudAdmin: cloudState.isCloudAdmin,
          tracker: trackerRef.current,
        });
      });
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [cloudState.connected, cloudState.isCloudAdmin, firebaseUser, enqueueCloudWrite]);

  const handleCancelConnectCloud = useCallback(() => {
    connectAttemptRef.current += 1;
    if (connectTimeoutRef.current !== null) {
      window.clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
    setCloudState((prev) => ({
      ...prev,
      syncing: false,
      error: null,
    }));
  }, []);

  const handleConnectCloud = useCallback(async () => {
    if (IS_FIREBASE_STAGING && currentUser?.role !== 'admin') {
      setCloudState((prev) => ({
        ...prev,
        syncing: false,
        error: 'Chỉ tài khoản Admin nội bộ được kết nối Firebase staging. Học viên chưa được bật chức năng đồng bộ.',
      }));
      return;
    }
    const attemptId = ++connectAttemptRef.current;
    if (connectTimeoutRef.current !== null) {
      window.clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }

    setCloudState((prev) => ({ ...prev, syncing: true, error: null }));

    const timeoutPromise = new Promise<never>((_, reject) => {
      connectTimeoutRef.current = window.setTimeout(() => {
        reject(new Error('auth/popup-timeout'));
      }, CONNECT_POPUP_TIMEOUT_MS);
    });

    try {
      const cred = await Promise.race([signInWithGoogleCloud(), timeoutPromise]);

      if (connectTimeoutRef.current !== null) {
        window.clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }

      if (connectAttemptRef.current !== attemptId) return;

      const signedInUser = cred?.user;
      if (!signedInUser) {
        setCloudState((prev) => ({
          ...prev,
          syncing: false,
          error: 'Không nhận được thông tin tài khoản Google sau khi đăng nhập. Vui lòng thử lại.',
        }));
        return;
      }

     

// Guard against rare cases where onAuthStateChanged does not re-emit for an existing session
const isAdmin = await checkIsCloudAdmin(signedInUser).catch(() => false);
      if (connectAttemptRef.current !== attemptId) return;
      setFirebaseUser(signedInUser);
      setCloudState((prev) => ({
        ...prev,
        authReady: true,
        connected: true,
        userEmail: signedInUser.email,
        userDisplayName: signedInUser.displayName,
        isCloudAdmin: isAdmin,
        error: null,
      }));
    } catch (err) {
      if (connectTimeoutRef.current !== null) {
        window.clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }
      if (connectAttemptRef.current !== attemptId) return;
      console.error('Google cloud sign-in failed:', err);
      setCloudState((prev) => ({
        ...prev,
        syncing: false,
        error: formatCloudErrorMessage(err),
      }));
    }
  }, [currentUser?.role]);

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

  const handleTestStagingWrite = useCallback(async () => {
    if (!IS_FIREBASE_STAGING || !firebaseUser || !cloudState.connected ||
        !cloudState.isCloudAdmin || currentUser?.role !== 'admin') {
      throw new Error('Cần đăng nhập cả Admin nội bộ và Google Admin trên Firebase staging.');
    }
    await testStagingAdminWrite(firebaseUser);
  }, [firebaseUser, cloudState.connected, cloudState.isCloudAdmin, currentUser?.role]);

  const handleCreateStagingTestTopic = useCallback(async () => {
    if (!IS_FIREBASE_STAGING || !firebaseUser || !cloudState.connected ||
        !cloudState.isCloudAdmin || currentUser?.role !== 'admin') {
      throw new Error('Chỉ Admin đã kết nối Google staging được tạo chuyên đề giả.');
    }
    await createStagingTestTopic(firebaseUser);
  }, [firebaseUser, cloudState.connected, cloudState.isCloudAdmin, currentUser?.role]);

  const handleDeleteStagingTestTopic = useCallback(async () => {
    if (!IS_FIREBASE_STAGING || !firebaseUser || !cloudState.connected ||
        !cloudState.isCloudAdmin || currentUser?.role !== 'admin') {
      throw new Error('Chỉ Admin đã kết nối Google staging được xóa chuyên đề giả.');
    }
    await deleteStagingTestTopic(firebaseUser);
  }, [firebaseUser, cloudState.connected, cloudState.isCloudAdmin, currentUser?.role]);

  const handleCreateStagingAccountProbe = useCallback(async () => {
    if (!IS_FIREBASE_STAGING || !firebaseUser || !cloudState.connected ||
        !cloudState.isCloudAdmin || currentUser?.role !== 'admin') {
      throw new Error('Chỉ tài khoản Admin của Firebase staging được tạo bản ghi giả.');
    }
    await createStagingAccountProbe(firebaseUser);
  }, [firebaseUser, cloudState.connected, cloudState.isCloudAdmin, currentUser?.role]);

  const handleDeleteStagingAccountProbe = useCallback(async () => {
    if (!IS_FIREBASE_STAGING || !firebaseUser || !cloudState.connected ||
        !cloudState.isCloudAdmin || currentUser?.role !== 'admin') {
      throw new Error('Chỉ tài khoản Admin của Firebase staging được xóa bản ghi giả.');
    }
    await deleteStagingAccountProbe(firebaseUser);
  }, [firebaseUser, cloudState.connected, cloudState.isCloudAdmin, currentUser?.role]);

  const requireCurrentDemoStudent = useCallback((): User => {
    if (!IS_FIREBASE_STAGING || !firebaseUser || !cloudState.connected ||
        currentUser?.role !== 'student' || currentUser.id !== firebaseUser.uid ||
        !/^student_[a-f0-9]{32}$/.test(firebaseUser.uid)) {
      throw new Error('Hãy đăng nhập đúng học viên DEMO bằng Cloudflare Functions.');
    }
    return firebaseUser;
  }, [firebaseUser, cloudState.connected, currentUser?.role, currentUser?.id]);

  const handleGetSyntheticQuizQuestion = useCallback(() => {
    return getSyntheticQuizQuestion(requireCurrentDemoStudent());
  }, [requireCurrentDemoStudent]);
  const handleSubmitSyntheticQuiz = useCallback((answerIndex: number) => {
    return submitSyntheticQuiz(requireCurrentDemoStudent(),answerIndex);
  }, [requireCurrentDemoStudent]);
  const handleReadOwnSyntheticQuiz = useCallback(() => {
    return readOwnSyntheticQuiz(requireCurrentDemoStudent());
  }, [requireCurrentDemoStudent]);
  const handleListPhase5DemoTopics = useCallback(() => {
    return listPhase5DemoTopics(requireCurrentDemoStudent());
  }, [requireCurrentDemoStudent]);
  const handleReadPhase5DemoTopic = useCallback((topicId:string,revision:number) => {
    return readPhase5DemoTopic(requireCurrentDemoStudent(),topicId,revision);
  }, [requireCurrentDemoStudent]);
  const handleSubmitPhase5Demo = useCallback((answers:Phase5DemoAnswerMap,questionIds:readonly string[])=>{
    return submitPhase5SyntheticAttempt(requireCurrentDemoStudent(),answers,questionIds);
  },[requireCurrentDemoStudent]);
  const handleReadOwnPhase5Demo = useCallback(()=>{
    return readOwnPhase5SyntheticAttempt(requireCurrentDemoStudent());
  },[requireCurrentDemoStudent]);
  const handleCreateDemoResultProbe = useCallback(async () => {
    await createDemoResultProbe(requireCurrentDemoStudent());
  }, [requireCurrentDemoStudent]);
  const handleReadDemoResultProbe = useCallback(async () => {
    await readDemoResultProbe(requireCurrentDemoStudent());
  }, [requireCurrentDemoStudent]);
  const handleDeleteDemoResultProbe = useCallback(async () => {
    await deleteDemoResultProbe(requireCurrentDemoStudent());
  }, [requireCurrentDemoStudent]);

  const handleCheckOtherDemoStudentIsolation = useCallback(async (otherUid: string) => {
    await assertOtherDemoStudentDenied(requireCurrentDemoStudent(), otherUid);
  }, [requireCurrentDemoStudent]);

  const getVerifiedStagingAdminIdToken = useCallback(async (): Promise<string> => {
    if (!IS_FIREBASE_STAGING || !adminAccessAllowed || !firebaseUser ||
        firebaseUser.uid !== BOOTSTRAPPED_ADMIN_UID) {
      throw new Error('Cần đăng nhập Google Admin staging trước khi quản lý tài khoản giả trong D1.');
    }
    return firebaseUser.getIdToken();
  }, [adminAccessAllowed, firebaseUser]);

  const handleListSyntheticQuizResults = useCallback(async () => {
    if (!IS_FIREBASE_STAGING || !adminAccessAllowed || !firebaseUser ||
      firebaseUser.uid !== BOOTSTRAPPED_ADMIN_UID) {
      throw new Error('Chỉ Google Admin staging đã xác minh được xem kết quả DEMO.');
    }
    return listSyntheticQuizAttempts(firebaseUser);
  }, [adminAccessAllowed,firebaseUser]);
  const handleListPhase5AdminScores = useCallback(async () => {
    if (!IS_FIREBASE_STAGING || !adminAccessAllowed || !firebaseUser ||
      firebaseUser.uid !== BOOTSTRAPPED_ADMIN_UID ||
      typeof window === 'undefined' ||
      !isPhase5DemoPreviewHostname(window.location.hostname)) {
      throw new Error('Chỉ Google Admin staging trên Preview được xem điểm Phase 5.');
    }
    return listPhase5AdminScores(firebaseUser);
  }, [adminAccessAllowed,firebaseUser]);

  const handleReadStagingD1Preflight = useCallback(async () => {
    if (!IS_FIREBASE_STAGING || !adminAccessAllowed || !firebaseUser ||
      firebaseUser.uid !== BOOTSTRAPPED_ADMIN_UID) {
      throw new Error('Cần xác thực Google Admin staging trước khi xem tình trạng D1.');
    }
    return readStagingD1Preflight(firebaseUser);
  }, [adminAccessAllowed, firebaseUser]);

  const handleListSyntheticD1Accounts = useCallback(async () => {
    return listSyntheticD1Accounts(await getVerifiedStagingAdminIdToken());
  }, [getVerifiedStagingAdminIdToken]);

  const handleCreateSyntheticD1Account = useCallback(async () => {
    return createSyntheticD1Account(await getVerifiedStagingAdminIdToken());
  }, [getVerifiedStagingAdminIdToken]);

  const handleSetSyntheticD1AccountStatus = useCallback(async (username: string, active: boolean) => {
    await changeSyntheticD1AccountStatus(await getVerifiedStagingAdminIdToken(), username, active);
  }, [getVerifiedStagingAdminIdToken]);

  const handleDeleteSyntheticD1Account = useCallback(async (username: string) => {
    await deleteSyntheticD1Account(await getVerifiedStagingAdminIdToken(), username);
  }, [getVerifiedStagingAdminIdToken]);

  const handleResetSyntheticD1AccountPassword = useCallback(async (username: string) => {
    return resetSyntheticD1AccountPassword(await getVerifiedStagingAdminIdToken(), username);
  }, [getVerifiedStagingAdminIdToken]);

  const handleProvisionDemoStudent = useCallback(async () => {
    if (!IS_FIREBASE_STAGING || currentUser?.role !== 'admin' || !cloudState.isCloudAdmin || !firebaseUser) {
      throw new Error('Cần đăng nhập Admin nội bộ và Google Admin trên staging.');
    }
    return provisionDemoStudent(await firebaseUser.getIdToken());
  }, [currentUser?.role, cloudState.isCloudAdmin, firebaseUser]);
  const handleDeleteDemoStudent = useCallback(async (username: string) => {
    if (!IS_FIREBASE_STAGING || currentUser?.role !== 'admin' || !cloudState.isCloudAdmin || !firebaseUser) {
      throw new Error('Cần đăng nhập Admin nội bộ và Google Admin trên staging.');
    }
    await deleteDemoStudent(await firebaseUser.getIdToken(), username);
  }, [currentUser?.role, cloudState.isCloudAdmin, firebaseUser]);

  const handleSyncCloudNow = useCallback(async () => {
    if (!firebaseUser || !cloudState.connected) return;
    if (IS_FIREBASE_STAGING) {
      setCloudState((prev) => ({
        ...prev,
        error: 'Đồng bộ toàn bộ đang tắt trên staging để không tải tài khoản hoặc kết quả thi thật. Hãy dùng chức năng kiểm thử dữ liệu giả.',
      }));
      return;
    }
    await enqueueCloudWrite(async () => {
      await pushAllLocalDataToFirestore({
        accounts: accountsRef.current,
        topics: topicsRef.current,
        attempts: attemptsRef.current,
        ownerUid: firebaseUser.uid,
        isCloudAdmin: cloudState.isCloudAdmin,
        tracker: trackerRef.current,
      });
    });
  }, [firebaseUser, cloudState.connected, cloudState.isCloudAdmin, currentUser?.role, enqueueCloudWrite]);

  const handleChangeSyntheticPassword = async (
    username: string, temporaryPassword: string, newPassword: string,
  ): Promise<string | null> => {
    if (!IS_FIREBASE_STAGING || cloudState.isCloudAdmin) {
      return 'Chỉ có thể đổi mật khẩu tài khoản GIẢ trên website thử nghiệm khi không kết nối Google Admin.';
    }
    try {
      await changeSyntheticD1Password(username, temporaryPassword, newPassword);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'Không thể đổi mật khẩu tài khoản thử nghiệm.';
    }
  };

  const handleLogin = async (username: string, password: string): Promise<string | null> => {
    // Preflight of synthetic D1 accounts is server-side only. Even a correct
    // temporary password never grants app or Firebase access at this stage.
    if (IS_FIREBASE_STAGING && username.trim().toLowerCase().startsWith('test_unit_')) {
      if (cloudState.isCloudAdmin) return 'Ngắt kết nối Google Admin trước khi kiểm tra mật khẩu tài khoản giả.';
      try {
        await verifySyntheticD1TemporaryPassword(username, password);
        return 'Đăng nhập tài khoản tập trung chưa được kích hoạt trên staging.';
      } catch (error) {
        if (error instanceof Error && error.message === SYNTHETIC_RESET_REQUIRED) {
          return SYNTHETIC_RESET_REQUIRED;
        }
        return error instanceof Error ? error.message : 'Không thể xác minh mật khẩu thử nghiệm.';
      }
    }
    // Controlled migration: only demo students use Cloudflare's server-side
    // password verifier. Never fall back to local passwords for demo users.
    if (IS_FIREBASE_STAGING && username.trim().toLowerCase().startsWith('test_hv_')) {
      if (cloudState.isCloudAdmin) return 'Hãy ngắt kết nối Google Admin trước khi thử đăng nhập học viên.';
      try {
        const serverAccount = await loginWithStagingUsername(username, password);
        const now = new Date().toISOString();
        const account: UserAccount = {
          id: serverAccount.id,
          username: serverAccount.username,
          password: '', // no password or hash in the browser's local account directory
          fullName: 'Học viên GIẢ LẬP',
          defaultUnit: 'Đơn vị GIẢ LẬP',
          role: 'student',
          active: true,
          createdAt: now,
          updatedAt: now,
        };
        const next = [...accountsRef.current.filter(a => a.id !== account.id), account];
        setAccounts(next);
        saveAccounts(next);
        setCurrentUserId(account.id);
        saveSessionUserId(account.id);
        setActiveTab('topics');
        setActiveQuizTopic(null);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : 'Không thể xác thực học viên thử nghiệm.';
      }
    }
    const matched = accountsRef.current.find(
      (a) => a.username.toLowerCase() === username.toLowerCase()
    );
    if (!matched) {
      return 'Tên đăng nhập không tồn tại trong hệ thống.';
    }

    let passwordValid = false;
    if (matched.passwordHash && /^[a-f0-9]{64}$/.test(matched.passwordHash)) {
      const inputHash = await hashUnitPassword(matched.username, password);
      passwordValid = inputHash === matched.passwordHash;
    } else {
      passwordValid = matched.password === password;
    }

    if (!passwordValid) {
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
    // Do not leave a privileged staging Google session active after internal logout.
    if (IS_FIREBASE_STAGING) {
      void signOutGoogleCloud().catch((error) => console.error('Staging Google sign-out failed:', error));
    }
    setCurrentUserId(null);
    saveSessionUserId(null);
    setActiveQuizTopic(null);
    setActiveTab('topics');
  };

  const handleUpdateAccounts = (nextAccounts: UserAccount[]) => {
    if (IS_FIREBASE_STAGING && !adminAccessAllowed) {
      setCloudState((prev) => ({
        ...prev,
        error: 'Cần kết nối Google Admin staging được Firebase xác nhận trước khi sửa dữ liệu quản trị.',
      }));
      return;
    }
    const prevAccounts = accountsRef.current;
    setAccounts(nextAccounts);
    saveAccounts(nextAccounts);

    if (!IS_FIREBASE_STAGING && cloudState.connected && firebaseUser) {
      if (!cloudState.isCloudAdmin) {
        setCloudState((prev) => ({
          ...prev,
          error: `Tài khoản Google "${cloudState.userEmail}" không có quyền Quản trị đám mây để đồng bộ danh sách tài khoản. Vui lòng kết nối bằng ${BOOTSTRAPPED_ADMIN_EMAIL}.`,
        }));
        return;
      }
      void enqueueCloudWrite(async () => {
        await syncAccountsToFirestore(prevAccounts, nextAccounts, trackerRef.current, true);
      });
    }
  };

  const handleUpdateTopics = (nextTopics: Topic[]) => {
    if (IS_FIREBASE_STAGING && !adminAccessAllowed) {
      setCloudState((prev) => ({
        ...prev,
        error: 'Cần kết nối Google Admin staging được Firebase xác nhận trước khi sửa dữ liệu quản trị.',
      }));
      return;
    }
    const prevTopics = topicsRef.current;
    setTopics(nextTopics);
    saveTopics(nextTopics);

    if (!IS_FIREBASE_STAGING && cloudState.connected && firebaseUser) {
      if (!cloudState.isCloudAdmin) {
        setCloudState((prev) => ({
          ...prev,
          error: `Tài khoản Google "${cloudState.userEmail}" không có quyền Quản trị đám mây để đồng bộ bộ đề. Vui lòng kết nối bằng ${BOOTSTRAPPED_ADMIN_EMAIL}.`,
        }));
        return;
      }
      void enqueueCloudWrite(async () => {
        await syncTopicsToFirestore(prevTopics, nextTopics, trackerRef.current, true);
      });
    }
  };

  const handleUpdateAttempts = (nextAttempts: QuizAttempt[]) => {
    if (IS_FIREBASE_STAGING && !adminAccessAllowed) {
      setCloudState((prev) => ({
        ...prev,
        error: 'Cần kết nối Google Admin staging được Firebase xác nhận trước khi sửa dữ liệu quản trị.',
      }));
      return;
    }
    setAttempts(nextAttempts);
    saveAttempts(nextAttempts);

    if (!IS_FIREBASE_STAGING && cloudState.connected && firebaseUser) {
      const uid = firebaseUser.uid;
      const isAdmin = cloudState.isCloudAdmin;
      void enqueueCloudWrite(async () => {
        await syncAttemptsDiffToFirestore(
          nextAttempts,
          uid,
          isAdmin,
          trackerRef.current,
          topicsRef.current,
          accountsRef.current
        );
      });
    }
  };

  
const handleCompleteAttempt = (newAttempt: QuizAttempt) => {
  const enrichedAttempt: QuizAttempt = {
    ...newAttempt,
    accountId: newAttempt.accountId || currentUser?.id,
  };

  const next = [enrichedAttempt, ...attemptsRef.current];

  setAttempts(next);
  saveAttempts(next);

  // Staging student submissions stay local until identity mapping is implemented.
  if (!IS_FIREBASE_STAGING && cloudState.connected && firebaseUser) {
    const uid = firebaseUser.uid;
    const isAdmin = cloudState.isCloudAdmin;

    void enqueueCloudWrite(async () => {
      const saved = await saveSingleAttemptToFirestore(
        enrichedAttempt,
        uid,
        trackerRef.current,
        {
          accountId: enrichedAttempt.accountId,
          accounts: accountsRef.current,
          isCloudAdmin: isAdmin,
          localTopics: topicsRef.current,
        }
      );

      if (!saved) {
        throw new Error(
          'Chuyên đề của bài thi này chưa tồn tại trên Firebase Firestore. Quản trị viên cần kết nối đám mây và đồng bộ bộ đề trước.'
        );
      }
    });
  }
};

    

  // Honor Board combines shared public cloud honor entries with local/own attempts (even without Google Sign-In!)
  const honorBoardAttempts = useMemo(() => {
    if (cloudState.isCloudAdmin || honorEntries.length === 0) {
      return attempts;
    }
    const byId = new Map<string, QuizAttempt>();
    for (const entry of honorEntries) byId.set(entry.id, entry);
    for (const own of attempts) byId.set(own.id, own);
    return Array.from(byId.values()).sort(
      (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );
  }, [attempts, honorEntries, cloudState.isCloudAdmin]);

  // History view merges synced cloud entries for the logged-in unit account so results appear across devices
  const historyAttempts = useMemo(() => {
    if (cloudState.isCloudAdmin || !currentUser || honorEntries.length === 0) {
      return attempts;
    }
    const byId = new Map<string, QuizAttempt>();
    for (const entry of honorEntries) {
      if (
        currentUser.role === 'admin' ||
        entry.accountUsername.toLowerCase() === currentUser.username.toLowerCase()
      ) {
        byId.set(entry.id, entry);
      }
    }
    for (const own of attempts) {
      byId.set(own.id, own);
    }
    return Array.from(byId.values()).sort(
      (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );
  }, [attempts, honorEntries, cloudState.isCloudAdmin, currentUser]);

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
            <LoginScreen onLogin={handleLogin}
              onChangeSyntheticPassword={IS_FIREBASE_STAGING ? handleChangeSyntheticPassword : undefined} />
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
              adminAccessAllowed={adminAccessAllowed}
              onSelectTab={(tab) => {
                if (tab === 'admin' && !adminAccessAllowed) {
                  setShowCloudModal(true);
                  return;
                }
                setActiveQuizTopic(null);
                setActiveTab(tab);
              }}
              onOpenCloudStorage={() => setShowCloudModal(true)}
              onLogout={handleLogout}
            />

            {/* Prompt Admin to connect Google Cloud Storage so Admin edits push live to all student/guest devices */}
            {currentUser.role === 'admin' &&
              cloudState.authReady &&
              !cloudState.connected &&
              !dismissedCloudBanner && (
                <div className="bg-[#EEF5F0] border-b border-[#BFD8C7]">
                  <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2 text-[#1F4D36] font-medium">
                      <Cloud className="w-4 h-4 shrink-0" />
                      <span>
                        Kết nối Google Quản trị để mọi thay đổi tài khoản & bộ đề tự động chuyển
                        sang các thiết bị học viên qua Firebase Firestore.
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setShowCloudModal(true)}
                        className="px-3 py-1.5 rounded-md bg-[#1F4D36] hover:bg-[#173B29] text-white font-semibold transition-colors cursor-pointer"
                      >
                        Kết nối & Đồng bộ ngay
                      </button>
                      <button
                        type="button"
                        onClick={() => setDismissedCloudBanner(true)}
                        aria-label="Ẩn thông báo"
                        className="p-1 text-[#4B5B50] hover:text-[#152019] cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

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
                          topics={IS_FIREBASE_STAGING ? topics.filter((t) => t.id !== STAGING_TEST_TOPIC_ID) : topics}
                          onStartTopic={(topic) => setActiveQuizTopic(topic)}
                        />
                      )}
                      {activeTab === 'history' && (
                        <HistoryView
                          currentUser={currentUser}
                          attempts={historyAttempts}
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
                      {activeTab === 'admin' && currentUser.role === 'admin' && adminAccessAllowed && (
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
                          onCancelConnectCloud={handleCancelConnectCloud}
                          onDisconnectCloud={handleDisconnectCloud}
                          onSyncCloudNow={handleSyncCloudNow}
                        />
                      )}
                      {activeTab === 'admin' && currentUser.role === 'admin' &&
                        adminAccessAllowed && firebaseUser &&
                        isPhase6AdminDraftsUiEnabled(
                          typeof window !== 'undefined' ? window.location.hostname : '',
                          import.meta.env.VITE_PHASE6_ADMIN_DRAFTS_UI,
                        ) && (
                          <Phase6AdminDraftsPanel user={firebaseUser}/>
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
                  onCancelConnect={handleCancelConnectCloud}
                  onDisconnect={handleDisconnectCloud}
                  onSyncNow={handleSyncCloudNow}
                  onTestWrite={IS_FIREBASE_STAGING ? handleTestStagingWrite : undefined}
                  onCreateTestTopic={IS_FIREBASE_STAGING && cloudState.connected && cloudState.isCloudAdmin && currentUser?.role === 'admin' ? handleCreateStagingTestTopic : undefined}
                  onReadTestTopic={IS_FIREBASE_STAGING ? readStagingTestTopic : undefined}
                  onDeleteTestTopic={IS_FIREBASE_STAGING && cloudState.connected && cloudState.isCloudAdmin && currentUser?.role === 'admin' ? handleDeleteStagingTestTopic : undefined}
                  onCreateTestAccount={IS_FIREBASE_STAGING && cloudState.connected && cloudState.isCloudAdmin && currentUser?.role === 'admin' ? handleCreateStagingAccountProbe : undefined}
                  onReadTestAccount={IS_FIREBASE_STAGING ? readStagingAccountProbe : undefined}
                  onDeleteTestAccount={IS_FIREBASE_STAGING && cloudState.connected && cloudState.isCloudAdmin && currentUser?.role === 'admin' ? handleDeleteStagingAccountProbe : undefined}
                  disableBulkSync={IS_FIREBASE_STAGING}
                  onCreateDemoResultProbe={IS_FIREBASE_STAGING && currentUser?.role === 'student' && currentUser.id === firebaseUser?.uid && /^student_[a-f0-9]{32}$/.test(firebaseUser.uid) ? handleCreateDemoResultProbe : undefined}
                  onReadDemoResultProbe={IS_FIREBASE_STAGING && currentUser?.role === 'student' && currentUser.id === firebaseUser?.uid && /^student_[a-f0-9]{32}$/.test(firebaseUser.uid) ? handleReadDemoResultProbe : undefined}
                  onDeleteDemoResultProbe={IS_FIREBASE_STAGING && currentUser?.role === 'student' && currentUser.id === firebaseUser?.uid && /^student_[a-f0-9]{32}$/.test(firebaseUser.uid) ? handleDeleteDemoResultProbe : undefined}
                  demoStudentUid={IS_FIREBASE_STAGING && currentUser?.role === 'student' && currentUser.id === firebaseUser?.uid && /^student_[a-f0-9]{32}$/.test(firebaseUser.uid) ? firebaseUser.uid : undefined}
                  onCheckOtherDemoStudentIsolation={IS_FIREBASE_STAGING && currentUser?.role === 'student' && currentUser.id === firebaseUser?.uid && /^student_[a-f0-9]{32}$/.test(firebaseUser.uid) ? handleCheckOtherDemoStudentIsolation : undefined}
                  onGetSyntheticQuizQuestion={IS_FIREBASE_STAGING && currentUser?.role === 'student' && !!firebaseUser && currentUser.id === firebaseUser.uid && cloudState.connected ? handleGetSyntheticQuizQuestion : undefined}
                  onSubmitSyntheticQuiz={IS_FIREBASE_STAGING && currentUser?.role === 'student' && !!firebaseUser && currentUser.id === firebaseUser.uid && cloudState.connected ? handleSubmitSyntheticQuiz : undefined}
                  onReadOwnSyntheticQuiz={IS_FIREBASE_STAGING && currentUser?.role === 'student' && !!firebaseUser && currentUser.id === firebaseUser.uid && cloudState.connected ? handleReadOwnSyntheticQuiz : undefined}
                  onListPhase5DemoTopics={IS_FIREBASE_STAGING && typeof window!=='undefined' && isPhase5DemoPreviewHostname(window.location.hostname) && currentUser?.role==='student' && !!firebaseUser && /^student_[a-f0-9]{32}$/.test(firebaseUser.uid) && currentUser.id===firebaseUser.uid && cloudState.connected ? handleListPhase5DemoTopics : undefined}
                  onReadPhase5DemoTopic={IS_FIREBASE_STAGING && typeof window!=='undefined' && isPhase5DemoPreviewHostname(window.location.hostname) && currentUser?.role==='student' && !!firebaseUser && /^student_[a-f0-9]{32}$/.test(firebaseUser.uid) && currentUser.id===firebaseUser.uid && cloudState.connected ? handleReadPhase5DemoTopic : undefined}
                  onSubmitPhase5Demo={IS_FIREBASE_STAGING && typeof window!=='undefined' && isPhase5SyntheticSubmitUiEnabled(window.location.hostname,import.meta.env.VITE_PHASE5_SYNTHETIC_SUBMIT_UI) && currentUser?.role==='student' && !!firebaseUser && /^student_[a-f0-9]{32}$/.test(firebaseUser.uid) && currentUser.id===firebaseUser.uid && cloudState.connected ? handleSubmitPhase5Demo : undefined}
                  onReadOwnPhase5Demo={IS_FIREBASE_STAGING && typeof window!=='undefined' && isPhase5SyntheticSubmitUiEnabled(window.location.hostname,import.meta.env.VITE_PHASE5_SYNTHETIC_SUBMIT_UI) && currentUser?.role==='student' && !!firebaseUser && /^student_[a-f0-9]{32}$/.test(firebaseUser.uid) && currentUser.id===firebaseUser.uid && cloudState.connected ? handleReadOwnPhase5Demo : undefined}
                  onListSyntheticQuizResults={IS_FIREBASE_STAGING && adminAccessAllowed ? handleListSyntheticQuizResults : undefined}
                  onListPhase5AdminScores={IS_FIREBASE_STAGING && adminAccessAllowed && typeof window!=='undefined' && isPhase5DemoPreviewHostname(window.location.hostname) ? handleListPhase5AdminScores : undefined}
                  onReadStagingD1Preflight={IS_FIREBASE_STAGING && adminAccessAllowed ? handleReadStagingD1Preflight : undefined}
                  onListSyntheticD1Accounts={IS_FIREBASE_STAGING && adminAccessAllowed ? handleListSyntheticD1Accounts : undefined}
                  onCreateSyntheticD1Account={IS_FIREBASE_STAGING && adminAccessAllowed ? handleCreateSyntheticD1Account : undefined}
                  onSetSyntheticD1AccountStatus={IS_FIREBASE_STAGING && adminAccessAllowed ? handleSetSyntheticD1AccountStatus : undefined}
                  onDeleteSyntheticD1Account={IS_FIREBASE_STAGING && adminAccessAllowed ? handleDeleteSyntheticD1Account : undefined}
                  onResetSyntheticD1AccountPassword={IS_FIREBASE_STAGING && adminAccessAllowed ? handleResetSyntheticD1AccountPassword : undefined}
                  onProvisionDemoStudent={IS_FIREBASE_STAGING && cloudState.isCloudAdmin && currentUser?.role === 'admin' ? handleProvisionDemoStudent : undefined}
                  onDeleteDemoStudent={IS_FIREBASE_STAGING && cloudState.isCloudAdmin && currentUser?.role === 'admin' ? handleDeleteDemoStudent : undefined}
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
