import { User } from 'firebase/auth';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  BOOTSTRAPPED_ADMIN_EMAIL,
  OperationType,
  db,
  handleFirestoreError,
} from '../firebase';
import { GradeLevel, Question, QuizAttempt, Topic, UserAccount } from '../types';

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]+$/;
const VALID_GRADES: ReadonlySet<string> = new Set(['Giỏi', 'Khá', 'Đạt', 'Yếu']);

export function sanitizeFirestoreId(raw: string, prefix: string): string {
  const cleaned = (raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
  if (cleaned && VALID_ID_REGEX.test(cleaned)) {
    return cleaned;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function clampString(val: string | undefined | null, maxLen: number, fallback = ''): string {
  const trimmed = (val ?? '').trim();
  const base = trimmed.length > 0 ? trimmed : fallback;
  return base.slice(0, maxLen);
}

function clampNumber(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.min(max, Math.max(min, val));
}

function sanitizeOptions(
  opts: [string, string, string, string]
): [string, string, string, string] {
  return [
    clampString(opts[0], 1000, 'Đáp án A'),
    clampString(opts[1], 1000, 'Đáp án B'),
    clampString(opts[2], 1000, 'Đáp án C'),
    clampString(opts[3], 1000, 'Đáp án D'),
  ];
}

function sanitizeAnswers(answers: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  const entries = Object.entries(answers || {}).slice(0, 500);
  for (const [k, v] of entries) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      result[k.slice(0, 128)] = clampNumber(Math.trunc(v), 0, 3);
    }
  }
  return result;
}

function sanitizeGrade(grade: string): GradeLevel {
  return VALID_GRADES.has(grade) ? (grade as GradeLevel) : 'Yếu';
}

function timestampToIso(val: unknown, fallbackIso?: string): string {
  if (typeof fallbackIso === 'string' && fallbackIso.length > 0) {
    return fallbackIso;
  }
  if (val && typeof val === 'object' && 'toDate' in val && typeof (val as Timestamp).toDate === 'function') {
    return (val as Timestamp).toDate().toISOString();
  }
  return new Date().toISOString();
}

export async function checkIsCloudAdmin(user: User | null): Promise<boolean> {
  if (!user || !user.emailVerified) return false;
  if (user.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()) {
    return true;
  }
  const path = `admins/${user.uid}`;
  try {
    const snap = await getDoc(doc(db, 'admins', user.uid));
    return snap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export interface CloudSnapshotTracker {
  accountIds: Set<string>;
  topicIds: Set<string>;
  questionIdsByTopic: Map<string, Set<string>>;
  attemptIds: Set<string>;
  honorEntryIds: Set<string>;
}

export function createEmptyCloudTracker(): CloudSnapshotTracker {
  return {
    accountIds: new Set(),
    topicIds: new Set(),
    questionIdsByTopic: new Map(),
    attemptIds: new Set(),
    honorEntryIds: new Set(),
  };
}

export interface SubscribeCloudHandlers {
  user: User;
  isCloudAdmin: boolean;
  tracker: CloudSnapshotTracker;
  onAccounts: (accounts: UserAccount[]) => void;
  onTopics: (topics: Topic[]) => void;
  onAttempts: (attempts: QuizAttempt[]) => void;
  onHonorEntries: (entries: QuizAttempt[]) => void;
  onSyncReady: () => void;
  onError: (message: string) => void;
}

export function subscribeToCloudData(handlers: SubscribeCloudHandlers): () => void {
  const {
    user,
    isCloudAdmin,
    tracker,
    onAccounts,
    onTopics,
    onAttempts,
    onHonorEntries,
    onSyncReady,
    onError,
  } = handlers;

  const unsubscribers: Array<() => void> = [];
  const questionUnsubs = new Map<string, () => void>();
  const topicMetaMap = new Map<string, Omit<Topic, 'questions'>>();
  const topicQuestionsMap = new Map<string, Question[]>();

  let topicsLoaded = false;
  let attemptsLoaded = false;
  let accountsLoaded = !isCloudAdmin;
  let readyFired = false;

  const checkReady = () => {
    if (!readyFired && topicsLoaded && attemptsLoaded && accountsLoaded) {
      readyFired = true;
      onSyncReady();
    }
  };

  const emitTopics = () => {
    const assembled: Topic[] = Array.from(topicMetaMap.values())
      .map((meta) => ({
        ...meta,
        questions: topicQuestionsMap.get(meta.id) || [],
      }))
      .sort((a, b) => a.code.localeCompare(b.code));
    onTopics(assembled);
  };

  const reportSnapshotError = (error: unknown, operationType: OperationType, path: string) => {
    try {
      handleFirestoreError(error, operationType, path);
    } catch (wrapped) {
      const msg = wrapped instanceof Error ? wrapped.message : String(wrapped);
      onError(msg);
    }
  };

  // 1. Subscribe to public Topics + per-topic Questions subcollection
  const topicsQuery = query(collection(db, 'topics'), where('visibility', '==', 'public'));
  const unsubTopics = onSnapshot(
    topicsQuery,
    (snapshot) => {
      const activeIds = new Set<string>();
      tracker.topicIds = new Set<string>();
      topicMetaMap.clear();

      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        const id = docSnap.id;
        activeIds.add(id);
        tracker.topicIds.add(id);

        topicMetaMap.set(id, {
          id,
          code: String(d.code || 'CD-01'),
          title: String(d.title || 'Chuyên đề'),
          description: String(d.description || ''),
          timeLimitMinutes: Number(d.timeLimitMinutes || 15),
          createdAt: timestampToIso(d.createdAt, d.createdAtIso),
          updatedAt: timestampToIso(d.updatedAt, d.updatedAtIso),
        });

        if (!questionUnsubs.has(id)) {
          const qPath = `topics/${id}/questions`;
          const qQuery = query(
            collection(db, 'topics', id, 'questions'),
            where('visibility', '==', 'public')
          );
          const unsubQ = onSnapshot(
            qQuery,
            (qSnap) => {
              const qIds = new Set<string>();
              const list: Array<Question & { _order: number }> = [];
              qSnap.forEach((qDoc) => {
                const qd = qDoc.data();
                qIds.add(qDoc.id);
                const opts = Array.isArray(qd.options) && qd.options.length === 4
                  ? ([
                      String(qd.options[0] ?? ''),
                      String(qd.options[1] ?? ''),
                      String(qd.options[2] ?? ''),
                      String(qd.options[3] ?? ''),
                    ] as [string, string, string, string])
                  : (['', '', '', ''] as [string, string, string, string]);
                list.push({
                  id: qDoc.id,
                  text: String(qd.text || ''),
                  options: opts,
                  correctIndex: clampNumber(Number(qd.correctIndex ?? 0), 0, 3),
                  explanation: String(qd.explanation || ''),
                  _order: Number(qd.orderIndex ?? 0),
                });
              });
              list.sort((a, b) => a._order - b._order);
              tracker.questionIdsByTopic.set(id, qIds);
              topicQuestionsMap.set(
                id,
                list.map(({ _order: _unused, ...rest }) => rest)
              );
              emitTopics();
            },
            (err) => reportSnapshotError(err, OperationType.LIST, qPath)
          );
          questionUnsubs.set(id, unsubQ);
        }
      });

      // Clean up question listeners for deleted topics
      for (const [tid, unsub] of questionUnsubs.entries()) {
        if (!activeIds.has(tid)) {
          unsub();
          questionUnsubs.delete(tid);
          topicQuestionsMap.delete(tid);
          tracker.questionIdsByTopic.delete(tid);
        }
      }

      topicsLoaded = true;
      emitTopics();
      checkReady();
    },
    (err) => reportSnapshotError(err, OperationType.LIST, 'topics')
  );
  unsubscribers.push(unsubTopics);

  // 2. Subscribe to Managed Accounts (Cloud Admin only)
  if (isCloudAdmin) {
    const accountsQuery = query(
      collection(db, 'managed_accounts'),
      where('scope', '==', 'unit_490')
    );
    const unsubAccounts = onSnapshot(
      accountsQuery,
      (snapshot) => {
        const nextIds = new Set<string>();
        const list: UserAccount[] = [];
        snapshot.forEach((docSnap) => {
          const d = docSnap.data();
          nextIds.add(docSnap.id);
          list.push({
            id: docSnap.id,
            username: String(d.username || ''),
            password: String(d.password || ''),
            fullName: String(d.fullName || ''),
            defaultUnit: String(d.defaultUnit || ''),
            role: d.role === 'admin' ? 'admin' : 'student',
            active: Boolean(d.active),
            createdAt: timestampToIso(d.createdAt, d.createdAtIso),
            updatedAt: timestampToIso(d.updatedAt, d.updatedAtIso),
          });
        });
        tracker.accountIds = nextIds;
        accountsLoaded = true;
        onAccounts(list);
        checkReady();
      },
      (err) => reportSnapshotError(err, OperationType.LIST, 'managed_accounts')
    );
    unsubscribers.push(unsubAccounts);
  }

  // 3. Subscribe to Attempts (All unit attempts for Admin, own attempts for regular verified user)
  const attemptsQuery = isCloudAdmin
    ? query(collection(db, 'attempts'), where('scope', '==', 'unit_490'))
    : query(collection(db, 'attempts'), where('ownerUid', '==', user.uid));

  const unsubAttempts = onSnapshot(
    attemptsQuery,
    (snapshot) => {
      const nextIds = new Set<string>();
      const list: QuizAttempt[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        nextIds.add(docSnap.id);
        list.push({
          id: docSnap.id,
          accountUsername: String(d.accountUsername || ''),
          candidateName: String(d.candidateName || ''),
          unitName: String(d.unitName || ''),
          topicId: String(d.topicId || ''),
          topicTitle: String(d.topicTitle || ''),
          answers:
            d.answers && typeof d.answers === 'object'
              ? (d.answers as Record<string, number>)
              : {},
          correctCount: Number(d.correctCount || 0),
          totalCount: Number(d.totalCount || 0),
          score10: Number(d.score10 || 0),
          grade: sanitizeGrade(String(d.grade || 'Yếu')),
          durationSeconds: Number(d.durationSeconds || 0),
          startedAt: timestampToIso(d.createdAt, d.startedAtIso),
          submittedAt: timestampToIso(d.createdAt, d.submittedAtIso),
        });
      });
      list.sort(
        (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
      );
      tracker.attemptIds = nextIds;
      attemptsLoaded = true;
      onAttempts(list);
      checkReady();
    },
    (err) => reportSnapshotError(err, OperationType.LIST, 'attempts')
  );
  unsubscribers.push(unsubAttempts);

  // 4. Subscribe to Public Honor Entries (for Honor Board across devices)
  const honorQuery = query(
    collection(db, 'honor_entries'),
    where('visibility', '==', 'public')
  );
  const unsubHonor = onSnapshot(
    honorQuery,
    (snapshot) => {
      const nextIds = new Set<string>();
      const list: QuizAttempt[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        nextIds.add(docSnap.id);
        list.push({
          id: docSnap.id,
          accountUsername: String(d.accountUsername || ''),
          candidateName: String(d.candidateName || ''),
          unitName: String(d.unitName || ''),
          topicId: String(d.topicId || ''),
          topicTitle: String(d.topicTitle || ''),
          answers: {},
          correctCount: Number(d.correctCount || 0),
          totalCount: Number(d.totalCount || 0),
          score10: Number(d.score10 || 0),
          grade: sanitizeGrade(String(d.grade || 'Yếu')),
          durationSeconds: Number(d.durationSeconds || 0),
          startedAt: timestampToIso(d.createdAt, d.startedAtIso),
          submittedAt: timestampToIso(d.createdAt, d.submittedAtIso),
        });
      });
      list.sort(
        (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
      );
      tracker.honorEntryIds = nextIds;
      onHonorEntries(list);
    },
    (err) => reportSnapshotError(err, OperationType.LIST, 'honor_entries')
  );
  unsubscribers.push(unsubHonor);

  return () => {
    for (const unsub of unsubscribers) unsub();
    for (const unsub of questionUnsubs.values()) unsub();
    questionUnsubs.clear();
  };
}

function buildAccountCreatePayload(acc: UserAccount, docId: string) {
  return {
    id: docId,
    scope: 'unit_490' as const,
    username: clampString(acc.username, 64, 'user'),
    password: clampString(acc.password, 128, '123456'),
    fullName: clampString(acc.fullName, 150, ''),
    defaultUnit: clampString(acc.defaultUnit, 200, ''),
    role: acc.role === 'admin' ? 'admin' : 'student',
    active: Boolean(acc.active),
    createdAtIso: clampString(acc.createdAt, 40, new Date().toISOString()),
    updatedAtIso: clampString(acc.updatedAt, 40, new Date().toISOString()),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function buildAccountUpdatePayload(acc: UserAccount) {
  return {
    username: clampString(acc.username, 64, 'user'),
    password: clampString(acc.password, 128, '123456'),
    fullName: clampString(acc.fullName, 150, ''),
    defaultUnit: clampString(acc.defaultUnit, 200, ''),
    role: acc.role === 'admin' ? 'admin' : 'student',
    active: Boolean(acc.active),
    updatedAtIso: clampString(acc.updatedAt, 40, new Date().toISOString()),
    updatedAt: serverTimestamp(),
  };
}

function buildTopicCreatePayload(topic: Topic, docId: string) {
  return {
    id: docId,
    code: clampString(topic.code, 32, 'CD-01'),
    title: clampString(topic.title, 250, 'Chuyên đề'),
    description: clampString(topic.description, 1500, ''),
    timeLimitMinutes: clampNumber(Math.round(topic.timeLimitMinutes || 15), 1, 240),
    questionCount: clampNumber(topic.questions.length, 0, 5000),
    visibility: 'public' as const,
    createdAtIso: clampString(topic.createdAt, 40, new Date().toISOString()),
    updatedAtIso: clampString(topic.updatedAt, 40, new Date().toISOString()),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function buildTopicUpdatePayload(topic: Topic) {
  return {
    code: clampString(topic.code, 32, 'CD-01'),
    title: clampString(topic.title, 250, 'Chuyên đề'),
    description: clampString(topic.description, 1500, ''),
    timeLimitMinutes: clampNumber(Math.round(topic.timeLimitMinutes || 15), 1, 240),
    questionCount: clampNumber(topic.questions.length, 0, 5000),
    visibility: 'public' as const,
    updatedAtIso: clampString(topic.updatedAt, 40, new Date().toISOString()),
    updatedAt: serverTimestamp(),
  };
}

function buildQuestionCreatePayload(q: Question, topicId: string, qId: string, orderIndex: number) {
  return {
    id: qId,
    topicId,
    orderIndex: clampNumber(orderIndex, 0, 5000),
    text: clampString(q.text, 2000, 'Câu hỏi'),
    options: sanitizeOptions(q.options),
    correctIndex: clampNumber(Math.trunc(q.correctIndex), 0, 3),
    explanation: clampString(q.explanation, 3000, ''),
    visibility: 'public' as const,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function buildQuestionUpdatePayload(q: Question, orderIndex: number) {
  return {
    orderIndex: clampNumber(orderIndex, 0, 5000),
    text: clampString(q.text, 2000, 'Câu hỏi'),
    options: sanitizeOptions(q.options),
    correctIndex: clampNumber(Math.trunc(q.correctIndex), 0, 3),
    explanation: clampString(q.explanation, 3000, ''),
    visibility: 'public' as const,
    updatedAt: serverTimestamp(),
  };
}

function buildAttemptCreatePayload(attempt: QuizAttempt, docId: string, ownerUid: string) {
  const totalCount = clampNumber(Math.trunc(attempt.totalCount || 0), 0, 5000);
  const correctCount = clampNumber(Math.trunc(attempt.correctCount || 0), 0, totalCount);
  return {
    id: docId,
    scope: 'unit_490' as const,
    ownerUid,
    accountUsername: clampString(attempt.accountUsername, 64, 'hocvien'),
    candidateName: clampString(attempt.candidateName, 150, 'Thí sinh'),
    unitName: clampString(attempt.unitName, 200, 'Tiểu đoàn 3'),
    topicId: sanitizeFirestoreId(attempt.topicId, 'topic'),
    topicTitle: clampString(attempt.topicTitle, 250, 'Chuyên đề'),
    answers: sanitizeAnswers(attempt.answers),
    correctCount,
    totalCount,
    score10: clampNumber(Number(attempt.score10 || 0), 0, 10),
    grade: sanitizeGrade(attempt.grade),
    durationSeconds: clampNumber(Math.trunc(attempt.durationSeconds || 0), 0, 86400),
    startedAtIso: clampString(attempt.startedAt, 40, new Date().toISOString()),
    submittedAtIso: clampString(attempt.submittedAt, 40, new Date().toISOString()),
    status: 'submitted' as const,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function buildHonorCreatePayload(attempt: QuizAttempt, docId: string, ownerUid: string) {
  const totalCount = clampNumber(Math.trunc(attempt.totalCount || 0), 0, 5000);
  const correctCount = clampNumber(Math.trunc(attempt.correctCount || 0), 0, totalCount);
  return {
    id: docId,
    attemptId: docId,
    ownerUid,
    visibility: 'public' as const,
    accountUsername: clampString(attempt.accountUsername, 64, 'hocvien'),
    candidateName: clampString(attempt.candidateName, 150, 'Thí sinh'),
    unitName: clampString(attempt.unitName, 200, 'Tiểu đoàn 3'),
    topicId: sanitizeFirestoreId(attempt.topicId, 'topic'),
    topicTitle: clampString(attempt.topicTitle, 250, 'Chuyên đề'),
    correctCount,
    totalCount,
    score10: clampNumber(Number(attempt.score10 || 0), 0, 10),
    grade: sanitizeGrade(attempt.grade),
    durationSeconds: clampNumber(Math.trunc(attempt.durationSeconds || 0), 0, 86400),
    startedAtIso: clampString(attempt.startedAt, 40, new Date().toISOString()),
    submittedAtIso: clampString(attempt.submittedAt, 40, new Date().toISOString()),
    createdAt: serverTimestamp(),
  };
}

export async function syncAccountsToFirestore(
  prevAccounts: UserAccount[],
  nextAccounts: UserAccount[],
  tracker: CloudSnapshotTracker
): Promise<void> {
  const prevMap = new Map(prevAccounts.map((a) => [a.id, a]));
  const nextIds = new Set(nextAccounts.map((a) => sanitizeFirestoreId(a.id, 'acc')));

  for (const acc of nextAccounts) {
    const docId = sanitizeFirestoreId(acc.id, 'acc');
    const prev = prevMap.get(acc.id);
    const existsInCloud = tracker.accountIds.has(docId);

    if (!existsInCloud) {
      const path = `managed_accounts/${docId}`;
      try {
        await setDoc(doc(db, 'managed_accounts', docId), buildAccountCreatePayload(acc, docId));
        tracker.accountIds.add(docId);
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, path);
      }
    } else if (!prev || JSON.stringify(prev) !== JSON.stringify(acc)) {
      const path = `managed_accounts/${docId}`;
      try {
        await updateDoc(doc(db, 'managed_accounts', docId), buildAccountUpdatePayload(acc));
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, path);
      }
    }
  }

  // Delete removed accounts
  for (const existingId of Array.from(tracker.accountIds)) {
    if (!nextIds.has(existingId)) {
      const path = `managed_accounts/${existingId}`;
      try {
        await deleteDoc(doc(db, 'managed_accounts', existingId));
        tracker.accountIds.delete(existingId);
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, path);
      }
    }
  }
}

export async function syncTopicsToFirestore(
  prevTopics: Topic[],
  nextTopics: Topic[],
  tracker: CloudSnapshotTracker
): Promise<void> {
  const prevMap = new Map(prevTopics.map((t) => [t.id, t]));
  const nextTopicIds = new Set(nextTopics.map((t) => sanitizeFirestoreId(t.id, 'topic')));

  for (const topic of nextTopics) {
    const topicId = sanitizeFirestoreId(topic.id, 'topic');
    const prev = prevMap.get(topic.id);
    const topicExists = tracker.topicIds.has(topicId);
    const existingQIds = tracker.questionIdsByTopic.get(topicId) || new Set<string>();

    // Ensure parent topic exists or is updated first
    if (!topicExists) {
      const path = `topics/${topicId}`;
      try {
        await setDoc(doc(db, 'topics', topicId), buildTopicCreatePayload(topic, topicId));
        tracker.topicIds.add(topicId);
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, path);
      }
    } else if (
      !prev ||
      prev.code !== topic.code ||
      prev.title !== topic.title ||
      prev.description !== topic.description ||
      prev.timeLimitMinutes !== topic.timeLimitMinutes ||
      prev.questions.length !== topic.questions.length
    ) {
      const path = `topics/${topicId}`;
      try {
        await updateDoc(doc(db, 'topics', topicId), buildTopicUpdatePayload(topic));
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, path);
      }
    }

    // Sync questions subcollection in batches of 350
    const prevQMap = new Map((prev?.questions || []).map((q, idx) => [q.id, { q, idx }]));
    const nextQIds = new Set<string>();
    const ops: Array<() => Promise<void>> = [];

    let batch = writeBatch(db);
    let batchCount = 0;
    const flushBatch = async (pathHint: string) => {
      if (batchCount === 0) return;
      const currentBatch = batch;
      batch = writeBatch(db);
      batchCount = 0;
      try {
        await currentBatch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, pathHint);
      }
    };

    for (let i = 0; i < topic.questions.length; i++) {
      const q = topic.questions[i];
      const qId = sanitizeFirestoreId(q.id, 'q');
      nextQIds.add(qId);
      const prevEntry = prevQMap.get(q.id);
      const qRef = doc(db, 'topics', topicId, 'questions', qId);

      if (!existingQIds.has(qId)) {
        batch.set(qRef, buildQuestionCreatePayload(q, topicId, qId, i));
        existingQIds.add(qId);
        batchCount++;
      } else if (
        !prevEntry ||
        prevEntry.idx !== i ||
        JSON.stringify(prevEntry.q) !== JSON.stringify(q)
      ) {
        batch.update(qRef, buildQuestionUpdatePayload(q, i));
        batchCount++;
      }

      if (batchCount >= 350) {
        await flushBatch(`topics/${topicId}/questions`);
      }
    }

    for (const oldQId of Array.from(existingQIds)) {
      if (!nextQIds.has(oldQId)) {
        batch.delete(doc(db, 'topics', topicId, 'questions', oldQId));
        existingQIds.delete(oldQId);
        batchCount++;
        if (batchCount >= 350) {
          await flushBatch(`topics/${topicId}/questions`);
        }
      }
    }

    await flushBatch(`topics/${topicId}/questions`);
    tracker.questionIdsByTopic.set(topicId, existingQIds);
    for (const op of ops) await op();
  }

  // Delete removed topics & their subcollection questions
  for (const existingTopicId of Array.from(tracker.topicIds)) {
    if (!nextTopicIds.has(existingTopicId)) {
      const qIds = tracker.questionIdsByTopic.get(existingTopicId) || new Set<string>();
      let batch = writeBatch(db);
      let count = 0;
      for (const qId of qIds) {
        batch.delete(doc(db, 'topics', existingTopicId, 'questions', qId));
        count++;
        if (count >= 350) {
          try {
            await batch.commit();
          } catch (error) {
            handleFirestoreError(error, OperationType.DELETE, `topics/${existingTopicId}/questions`);
          }
          batch = writeBatch(db);
          count = 0;
        }
      }
      batch.delete(doc(db, 'topics', existingTopicId));
      try {
        await batch.commit();
        tracker.topicIds.delete(existingTopicId);
        tracker.questionIdsByTopic.delete(existingTopicId);
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `topics/${existingTopicId}`);
      }
    }
  }
}

export async function saveSingleAttemptToFirestore(
  attempt: QuizAttempt,
  ownerUid: string,
  tracker: CloudSnapshotTracker
): Promise<boolean> {
  const attemptId = sanitizeFirestoreId(attempt.id, 'att');
  const topicId = sanitizeFirestoreId(attempt.topicId, 'topic');

  // Verify parent topic exists in cloud before writing to avoid orphaned attempt rejection
  if (!tracker.topicIds.has(topicId)) {
    return false;
  }
  if (tracker.attemptIds.has(attemptId)) {
    return true;
  }

  const batch = writeBatch(db);
  batch.set(
    doc(db, 'attempts', attemptId),
    buildAttemptCreatePayload(attempt, attemptId, ownerUid)
  );
  batch.set(
    doc(db, 'honor_entries', attemptId),
    buildHonorCreatePayload(attempt, attemptId, ownerUid)
  );

  try {
    await batch.commit();
    tracker.attemptIds.add(attemptId);
    tracker.honorEntryIds.add(attemptId);
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `attempts/${attemptId}`);
  }
}

export async function syncAttemptsDiffToFirestore(
  nextAttempts: QuizAttempt[],
  ownerUid: string,
  isCloudAdmin: boolean,
  tracker: CloudSnapshotTracker
): Promise<void> {
  const nextIds = new Set(nextAttempts.map((a) => sanitizeFirestoreId(a.id, 'att')));

  // Create any newly added attempts whose parent topic exists in cloud
  for (const att of nextAttempts) {
    const attId = sanitizeFirestoreId(att.id, 'att');
    if (!tracker.attemptIds.has(attId)) {
      await saveSingleAttemptToFirestore(att, ownerUid, tracker);
    }
  }

  // Delete removed attempts & paired honor entries (Admin only)
  if (isCloudAdmin) {
    const toDelete = Array.from(tracker.attemptIds).filter((id) => !nextIds.has(id));
    let batch = writeBatch(db);
    let count = 0;

    for (const delId of toDelete) {
      batch.delete(doc(db, 'attempts', delId));
      batch.delete(doc(db, 'honor_entries', delId));
      count += 2;
      if (count >= 350) {
        try {
          await batch.commit();
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `attempts/${delId}`);
        }
        batch = writeBatch(db);
        count = 0;
      }
    }

    if (count > 0) {
      try {
        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, 'attempts');
      }
    }

    for (const delId of toDelete) {
      tracker.attemptIds.delete(delId);
      tracker.honorEntryIds.delete(delId);
    }
  }
}

export async function pushAllLocalDataToFirestore(params: {
  accounts: UserAccount[];
  topics: Topic[];
  attempts: QuizAttempt[];
  ownerUid: string;
  isCloudAdmin: boolean;
  tracker: CloudSnapshotTracker;
}): Promise<{ accountsSynced: number; topicsSynced: number; attemptsSynced: number }> {
  const { accounts, topics, attempts, ownerUid, isCloudAdmin, tracker } = params;

  let accountsSynced = 0;
  let topicsSynced = 0;
  let attemptsSynced = 0;

  if (isCloudAdmin) {
    await syncAccountsToFirestore([], accounts, tracker);
    accountsSynced = accounts.length;

    await syncTopicsToFirestore([], topics, tracker);
    topicsSynced = topics.length;
  }

  for (const att of attempts) {
    const ok = await saveSingleAttemptToFirestore(att, ownerUid, tracker);
    if (ok) attemptsSynced++;
  }

  return { accountsSynced, topicsSynced, attemptsSynced };
}
