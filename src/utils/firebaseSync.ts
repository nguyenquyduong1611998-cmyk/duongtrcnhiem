import { User } from 'firebase/auth';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  BOOTSTRAPPED_ADMIN_UID,
  IS_FIREBASE_STAGING,
  OperationType,
  db,
  handleFirestoreError,
} from '../firebase';
import {
  AccountDirectoryRecord,
  GradeLevel,
  Question,
  QuizAttempt,
  Topic,
  UserAccount,
} from '../types';

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]+$/;
const VALID_GRADES: ReadonlySet<string> = new Set(['Giỏi', 'Khá', 'Đạt', 'Yếu']);

/**
 * Staging-only Admin permission test.
 * Writes, reads, then deletes one harmless document in a dedicated collection.
 * No passwords, user accounts, quizzes, scores or topics are transmitted.
 */
export async function testStagingAdminWrite(user: User): Promise<void> {
  if (!IS_FIREBASE_STAGING || user.uid !== BOOTSTRAPPED_ADMIN_UID) {
    throw new Error('Phép thử chỉ dành cho tài khoản Admin của Firebase staging.');
  }
  const nonce = `probe_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  const ref = doc(db, 'sync_probes', nonce);
  let written = false;
  try {
    await setDoc(ref, {
      uid: user.uid,
      nonce,
      createdAt: serverTimestamp(),
    });
    written = true;
    const snapshot = await getDoc(ref);
    if (!snapshot.exists() || snapshot.data().nonce !== nonce || snapshot.data().uid !== user.uid) {
      throw new Error('Firebase đã nhận yêu cầu nhưng không đọc lại được dữ liệu kiểm thử.');
    }
    await deleteDoc(ref);
    written = false;
  } catch (error) {
    if (written) {
      try {
        await deleteDoc(ref);
      } catch {
        // Do not hide the original failure. Admin can remove this test document later.
      }
    }
    throw error;
  }
}


// This synthetic topic is read and written solely through the staging test controls.
// Never include it in the ordinary local topic cache or a student test session.
export const STAGING_TEST_TOPIC_ID = 'staging_test_topic_20261121';
export const STAGING_TEST_TOPIC_TITLE = 'CHUYÊN ĐỀ KIỂM THỬ - DỮ LIỆU GIẢ';
const STAGING_TEST_QUESTION_ID = 'staging_test_question_01';

export async function createStagingTestTopic(user: User): Promise<void> {
  if (!IS_FIREBASE_STAGING || user.uid !== BOOTSTRAPPED_ADMIN_UID) {
    throw new Error('Chỉ Google Admin của Firebase staging được tạo chuyên đề thử.');
  }
  const topicRef = doc(db, 'topics', STAGING_TEST_TOPIC_ID);
  const questionRef = doc(db, 'topics', STAGING_TEST_TOPIC_ID, 'questions', STAGING_TEST_QUESTION_ID);
  const existing = await getDoc(topicRef);
  if (existing.exists()) {
    if (existing.data().title !== STAGING_TEST_TOPIC_TITLE) {
      throw new Error('ID chuyên đề kiểm thử đã được sử dụng cho nội dung khác. Không ghi đè dữ liệu.');
    }
    const q = await getDoc(questionRef);
    if (!q.exists()) throw new Error('Chuyên đề thử có nhưng thiếu câu hỏi. Không tự ý sửa dữ liệu.');
    return;
  }
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  batch.set(topicRef, {
    id: STAGING_TEST_TOPIC_ID,
    code: 'TEST-01',
    title: STAGING_TEST_TOPIC_TITLE,
    description: 'Dữ liệu hoàn toàn giả để kiểm tra Firebase giữa hai trình duyệt.',
    timeLimitMinutes: 5,
    questionCount: 1,
    visibility: 'public',
    createdAtIso: now,
    updatedAtIso: now,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(questionRef, {
    id: STAGING_TEST_QUESTION_ID,
    topicId: STAGING_TEST_TOPIC_ID,
    orderIndex: 0,
    text: '2 + 2 bằng bao nhiêu? (câu hỏi giả)',
    options: ['3', '4', '5', '6'],
    correctIndex: 1,
    explanation: '2 + 2 = 4.',
    visibility: 'public',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  await readStagingTestTopic();
}

export async function readStagingTestTopic(): Promise<void> {
  if (!IS_FIREBASE_STAGING) throw new Error('Chỉ kiểm thử trên Firebase staging.');
  const topicRef = doc(db, 'topics', STAGING_TEST_TOPIC_ID);
  const questionRef = doc(db, 'topics', STAGING_TEST_TOPIC_ID, 'questions', STAGING_TEST_QUESTION_ID);
  const [topic, question] = await Promise.all([getDoc(topicRef), getDoc(questionRef)]);
  if (!topic.exists()) throw new Error('Firebase chưa có chuyên đề giả. Hãy tạo từ tài khoản Admin trước.');
  if (!question.exists() || topic.data().title !== STAGING_TEST_TOPIC_TITLE ||
      question.data().text !== '2 + 2 bằng bao nhiêu? (câu hỏi giả)' ||
      question.data().correctIndex !== 1) {
    throw new Error('Dữ liệu chuyên đề thử chưa đầy đủ hoặc không trùng nội dung mong đợi.');
  }
}

export async function deleteStagingTestTopic(user: User): Promise<void> {
  if (!IS_FIREBASE_STAGING || user.uid !== BOOTSTRAPPED_ADMIN_UID) {
    throw new Error('Chỉ Google Admin của Firebase staging được xóa chuyên đề thử.');
  }
  const topicRef = doc(db, 'topics', STAGING_TEST_TOPIC_ID);
  const existing = await getDoc(topicRef);
  if (!existing.exists()) return;
  if (existing.data().title !== STAGING_TEST_TOPIC_TITLE) {
    throw new Error('Không xóa: chuyên đề không phải dữ liệu thử.');
  }
  const batch = writeBatch(db);
  batch.delete(doc(db, 'topics', STAGING_TEST_TOPIC_ID, 'questions', STAGING_TEST_QUESTION_ID));
  batch.delete(topicRef);
  await batch.commit();
}


/**
 * Staging-only cross-browser account metadata probe.
 * This is a fake student record, NOT a real login account.
 * Never carries a password, password hash, person name, or unit information.
 */
export const STAGING_ACCOUNT_PROBE_ID = 'synthetic_student_01';
const STAGING_ACCOUNT_PROBE_USERNAME = 'hocvien_gia_lap_01';
const STAGING_ACCOUNT_PROBE_MARKER = 'SYNTHETIC_ONLY';

export async function createStagingAccountProbe(user: User): Promise<void> {
  if (!IS_FIREBASE_STAGING || user.uid !== BOOTSTRAPPED_ADMIN_UID) {
    throw new Error('Chỉ Google Admin của Firebase staging được tạo tài khoản giả.');
  }
  const ref = doc(db, 'account_sync_probes', STAGING_ACCOUNT_PROBE_ID);
  const current = await getDoc(ref);
  if (current.exists()) {
    await readStagingAccountProbe();
    return;
  }
  await setDoc(ref, {
    id: STAGING_ACCOUNT_PROBE_ID,
    username: STAGING_ACCOUNT_PROBE_USERNAME,
    role: 'student',
    active: true,
    marker: STAGING_ACCOUNT_PROBE_MARKER,
    createdAt: serverTimestamp(),
  });
  await readStagingAccountProbe();
}

export async function readStagingAccountProbe(): Promise<void> {
  if (!IS_FIREBASE_STAGING) {
    throw new Error('Chỉ được kiểm tra tài khoản giả trên Firebase staging.');
  }
  const ref = doc(db, 'account_sync_probes', STAGING_ACCOUNT_PROBE_ID);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    throw new Error('Chưa có tài khoản giả trên Firebase. Admin cần tạo trước.');
  }
  const data = snapshot.data();
  const keys = Object.keys(data).sort();
  const expectedKeys = ['active', 'createdAt', 'id', 'marker', 'role', 'username'];
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys) ||
      data.id !== STAGING_ACCOUNT_PROBE_ID ||
      data.username !== STAGING_ACCOUNT_PROBE_USERNAME ||
      data.role !== 'student' ||
      data.active !== true ||
      data.marker !== STAGING_ACCOUNT_PROBE_MARKER) {
    throw new Error('Bản ghi tài khoản giả không đúng mẫu, đã dừng để bảo vệ dữ liệu.');
  }
}

export async function deleteStagingAccountProbe(user: User): Promise<void> {
  if (!IS_FIREBASE_STAGING || user.uid !== BOOTSTRAPPED_ADMIN_UID) {
    throw new Error('Chỉ Google Admin của Firebase staging được xóa tài khoản giả.');
  }
  const ref = doc(db, 'account_sync_probes', STAGING_ACCOUNT_PROBE_ID);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  if (snap.data().marker !== STAGING_ACCOUNT_PROBE_MARKER ||
      snap.data().username !== STAGING_ACCOUNT_PROBE_USERNAME) {
    throw new Error('Không xóa: đây không phải tài khoản giả của phép thử.');
  }
  await deleteDoc(ref);
}

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

// Compact pure-JS SHA-256 fallback for non-secure LAN HTTP origins where crypto.subtle is unavailable
function sha256FallbackHex(input: string): string {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((v) => v.toString(16).padStart(8, '0'))
    .join('');
}

export async function hashUnitPassword(username: string, password: string): Promise<string> {
  const normalized = `unit490-d3::${username.trim().toLowerCase()}::${password}`;
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const encoded = new TextEncoder().encode(normalized);
      const digest = await crypto.subtle.digest('SHA-256', encoded);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    // Fall back to pure-JS SHA-256 on non-secure contexts
  }
  return sha256FallbackHex(normalized);
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
  if (
    val &&
    typeof val === 'object' &&
    'toDate' in val &&
    typeof (val as Timestamp).toDate === 'function'
  ) {
    return (val as Timestamp).toDate().toISOString();
  }
  return new Date().toISOString();
}

export async function checkIsCloudAdmin(user: User | null): Promise<boolean> {
 if (!user) return false;
  
if (user.uid === BOOTSTRAPPED_ADMIN_UID) {
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
  directoryIds: Set<string>;
  topicIds: Set<string>;
  questionIdsByTopic: Map<string, Set<string>>;
  attemptIds: Set<string>;
  honorEntryIds: Set<string>;
}

export function createEmptyCloudTracker(): CloudSnapshotTracker {
  return {
    accountIds: new Set(),
    directoryIds: new Set(),
    topicIds: new Set(),
    questionIdsByTopic: new Map(),
    attemptIds: new Set(),
    honorEntryIds: new Set(),
  };
}

export interface SubscribePublicUnitHandlers {
  tracker: CloudSnapshotTracker;
  onDirectoryAccounts: (accounts: AccountDirectoryRecord[]) => void;
  onTopics: (topics: Topic[]) => void;
  onHonorEntries: (entries: QuizAttempt[]) => void;
  onError: (message: string) => void;
}

export interface SubscribeCloudHandlers {
  user: User;
  isCloudAdmin: boolean;
  tracker: CloudSnapshotTracker;
  onAccounts: (accounts: UserAccount[]) => void;
  onTopics: (topics: Topic[]) => void;
  onAttempts: (attempts: QuizAttempt[]) => void;
  onHonorEntries: (entries: QuizAttempt[]) => void;
  onError: (message: string) => void;
}

function parseAccountDoc(id: string, d: Record<string, unknown>): UserAccount {
  return {
    id,
    username: String(d.username || ''),
    password: IS_FIREBASE_STAGING ? '' : String(d.password || ''),
    passwordHash: IS_FIREBASE_STAGING ? String(d.passwordHash || '') : undefined,
    fullName: String(d.fullName || ''),
    defaultUnit: String(d.defaultUnit || ''),
    role: d.role === 'admin' ? 'admin' : 'student',
    active: Boolean(d.active),
    createdAt: timestampToIso(d.createdAt, d.createdAtIso as string | undefined),
    updatedAt: timestampToIso(d.updatedAt, d.updatedAtIso as string | undefined),
  };
}

function parseAccountDirectoryDoc(
  id: string,
  d: Record<string, unknown>
): AccountDirectoryRecord {
  const username = String(d.username || '');
  return {
    id,
    username,
    usernameLower: String(d.usernameLower || username.toLowerCase()),
    passwordHash: String(d.passwordHash || ''),
    fullName: String(d.fullName || ''),
    defaultUnit: String(d.defaultUnit || ''),
    role: d.role === 'admin' ? 'admin' : 'student',
    active: Boolean(d.active),
    createdAt: timestampToIso(d.createdAt, d.createdAtIso as string | undefined),
    updatedAt: timestampToIso(d.updatedAt, d.updatedAtIso as string | undefined),
  };
}

function parseQuestionDoc(id: string, qd: Record<string, unknown>): Question & { _order: number } {
  const rawOpts = qd.options;
  const opts: [string, string, string, string] =
    Array.isArray(rawOpts) && rawOpts.length === 4
      ? [
          String(rawOpts[0] ?? ''),
          String(rawOpts[1] ?? ''),
          String(rawOpts[2] ?? ''),
          String(rawOpts[3] ?? ''),
        ]
      : ['', '', '', ''];
  return {
    id,
    text: String(qd.text || ''),
    options: opts,
    correctIndex: clampNumber(Number(qd.correctIndex ?? 0), 0, 3),
    explanation: String(qd.explanation || ''),
    _order: Number(qd.orderIndex ?? 0),
  };
}

function parseAttemptDoc(id: string, d: Record<string, unknown>): QuizAttempt {
  return {
    id,
    accountId: typeof d.accountId === 'string' && d.accountId ? d.accountId : undefined,
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
    startedAt: timestampToIso(d.createdAt, d.startedAtIso as string | undefined),
    submittedAt: timestampToIso(d.createdAt, d.submittedAtIso as string | undefined),
  };
}

function subscribeTopicsTree(
  tracker: CloudSnapshotTracker,
  onTopics: (topics: Topic[]) => void,
  reportSnapshotError: (error: unknown, operationType: OperationType, path: string) => void
): () => void {
  const questionUnsubs = new Map<string, () => void>();
  const topicMetaMap = new Map<string, Omit<Topic, 'questions'>>();
  const topicQuestionsMap = new Map<string, Question[]>();

  const emitTopics = () => {
    const assembled: Topic[] = Array.from(topicMetaMap.values())
      .map((meta) => ({
        ...meta,
        questions: topicQuestionsMap.get(meta.id) || [],
      }))
      .sort((a, b) => a.code.localeCompare(b.code));
    onTopics(assembled);
  };

  const topicsQuery = query(collection(db, 'topics'), where('visibility', '==', 'public'));
  const unsubTopics = onSnapshot(
    topicsQuery,
    (snapshot) => {
      const activeIds = new Set<string>();
      topicMetaMap.clear();

      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        const id = docSnap.id;
        if (IS_FIREBASE_STAGING && id === STAGING_TEST_TOPIC_ID) return;
        activeIds.add(id);

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
                qIds.add(qDoc.id);
                list.push(parseQuestionDoc(qDoc.id, qDoc.data()));
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

      for (const [tid, unsub] of questionUnsubs.entries()) {
        if (!activeIds.has(tid)) {
          unsub();
          questionUnsubs.delete(tid);
          topicQuestionsMap.delete(tid);
          tracker.questionIdsByTopic.delete(tid);
        }
      }

      tracker.topicIds = activeIds;
      emitTopics();
    },
    (err) => reportSnapshotError(err, OperationType.LIST, 'topics')
  );

  return () => {
    unsubTopics();
    for (const unsub of questionUnsubs.values()) unsub();
    questionUnsubs.clear();
  };
}

/**
 * Public real-time subscription that runs automatically on ALL devices
 * (including student/guest devices that do NOT sign in with Google).
 * Streams published Topics & Questions, Hashed Account Directory, and Honor Entries.
 */
export function subscribeToPublicUnitData(handlers: SubscribePublicUnitHandlers): () => void {
  const { tracker, onDirectoryAccounts, onTopics, onHonorEntries, onError } = handlers;
  const unsubscribers: Array<() => void> = [];

  const reportSnapshotError = (error: unknown, operationType: OperationType, path: string) => {
    try {
      handleFirestoreError(error, operationType, path);
    } catch (wrapped) {
      const msg = wrapped instanceof Error ? wrapped.message : String(wrapped);
      onError(msg);
    }
  };

  // 1. Live published topics + questions
  unsubscribers.push(subscribeTopicsTree(tracker, onTopics, reportSnapshotError));

  
  // The staging honor board contains personal names and units.
  // Do not query it before Google authentication.
  if (!IS_FIREBASE_STAGING) {
    // 3. Live public honor board & student attempt summaries
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
          nextIds.add(docSnap.id);
          list.push(parseAttemptDoc(docSnap.id, docSnap.data()));
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

  }

  return () => {
    for (const unsub of unsubscribers) unsub();
  };
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
    onError,
  } = handlers;

  const unsubscribers: Array<() => void> = [];

  const reportSnapshotError = (error: unknown, operationType: OperationType, path: string) => {
    try {
      handleFirestoreError(error, operationType, path);
    } catch (wrapped) {
      const msg = wrapped instanceof Error ? wrapped.message : String(wrapped);
      onError(msg);
    }
  };

  // 1. Subscribe to public Topics + per-topic Questions subcollection
  unsubscribers.push(subscribeTopicsTree(tracker, onTopics, reportSnapshotError));

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
          nextIds.add(docSnap.id);
          list.push(parseAccountDoc(docSnap.id, docSnap.data()));
        });
        tracker.accountIds = nextIds;
        onAccounts(list);
      },
      (err) => reportSnapshotError(err, OperationType.LIST, 'managed_accounts')
    );
    unsubscribers.push(unsubAccounts);
  }

  // 3. Subscribe to Attempts
  const attemptsQuery = isCloudAdmin
    ? query(collection(db, 'attempts'), where('scope', '==', 'unit_490'))
    : query(collection(db, 'attempts'), where('ownerUid', '==', user.uid));

  const unsubAttempts = onSnapshot(
    attemptsQuery,
    (snapshot) => {
      const nextIds = new Set<string>();
      const list: QuizAttempt[] = [];
      snapshot.forEach((docSnap) => {
        nextIds.add(docSnap.id);
        list.push(parseAttemptDoc(docSnap.id, docSnap.data()));
      });
      list.sort(
        (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
      );
      tracker.attemptIds = nextIds;
      onAttempts(list);
    },
    (err) => reportSnapshotError(err, OperationType.LIST, 'attempts')
  );
  unsubscribers.push(unsubAttempts);

  // On staging, non-admin Google users can only subscribe to their own results.
  const honorQuery = IS_FIREBASE_STAGING && !isCloudAdmin
    ? query(collection(db, 'honor_entries'), where('ownerUid', '==', user.uid))
    : query(collection(db, 'honor_entries'), where('visibility', '==', 'public'));
  const unsubHonor = onSnapshot(
    honorQuery,
    (snapshot) => {
      const nextIds = new Set<string>();
      const list: QuizAttempt[] = [];
      snapshot.forEach((docSnap) => {
        nextIds.add(docSnap.id);
        list.push(parseAttemptDoc(docSnap.id, docSnap.data()));
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
  };
}

function buildAccountCreatePayload(acc: UserAccount, docId: string, passwordHash: string) {
  return {
    id: docId,
    scope: 'unit_490' as const,
    username: clampString(acc.username, 64, 'user'),
    ...(IS_FIREBASE_STAGING
      ? { passwordHash }
      : { password: clampString(acc.password, 128, '123456') }),
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

function buildAccountUpdatePayload(acc: UserAccount, passwordHash: string) {
  return {
    username: clampString(acc.username, 64, 'user'),
    ...(IS_FIREBASE_STAGING
      ? { passwordHash }
      : { password: clampString(acc.password, 128, '123456') }),
    fullName: clampString(acc.fullName, 150, ''),
    defaultUnit: clampString(acc.defaultUnit, 200, ''),
    role: acc.role === 'admin' ? 'admin' : 'student',
    active: Boolean(acc.active),
    updatedAtIso: clampString(acc.updatedAt, 40, new Date().toISOString()),
    updatedAt: serverTimestamp(),
  };
}

function buildAccountDirectoryCreatePayload(
  acc: UserAccount,
  docId: string,
  passwordHash: string
) {
  const cleanUsername = clampString(acc.username, 64, 'user');
  return {
    id: docId,
    username: cleanUsername,
    usernameLower: cleanUsername.toLowerCase(),
    passwordHash,
    fullName: clampString(acc.fullName, 150, ''),
    defaultUnit: clampString(acc.defaultUnit, 200, ''),
    role: acc.role === 'admin' ? 'admin' : 'student',
    active: Boolean(acc.active),
    visibility: 'public' as const,
    createdAtIso: clampString(acc.createdAt, 40, new Date().toISOString()),
    updatedAtIso: clampString(acc.updatedAt, 40, new Date().toISOString()),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function buildAccountDirectoryUpdatePayload(acc: UserAccount, passwordHash: string) {
  const cleanUsername = clampString(acc.username, 64, 'user');
  return {
    username: cleanUsername,
    usernameLower: cleanUsername.toLowerCase(),
    passwordHash,
    fullName: clampString(acc.fullName, 150, ''),
    defaultUnit: clampString(acc.defaultUnit, 200, ''),
    role: acc.role === 'admin' ? 'admin' : 'student',
    active: Boolean(acc.active),
    visibility: 'public' as const,
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

function buildQuestionCreatePayload(
  q: Question,
  topicId: string,
  qId: string,
  orderIndex: number
) {
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

function resolveAttemptAccountId(
  attempt: QuizAttempt,
  accounts?: UserAccount[],
  explicitAccountId?: string
): string {
  if (explicitAccountId && explicitAccountId.trim()) {
    return sanitizeFirestoreId(explicitAccountId, 'acc');
  }
  if (attempt.accountId && attempt.accountId.trim()) {
    return sanitizeFirestoreId(attempt.accountId, 'acc');
  }
  if (accounts && accounts.length > 0 && attempt.accountUsername) {
    const matched = accounts.find(
      (a) => a.username.toLowerCase() === attempt.accountUsername.toLowerCase()
    );
    if (matched) {
      return sanitizeFirestoreId(matched.id, 'acc');
    }
  }
  return 'acc-admin-01';
}

function buildAttemptCreatePayload(
  attempt: QuizAttempt,
  docId: string,
  ownerUid: string,
  accountId: string
) {
  const totalCount = clampNumber(Math.trunc(attempt.totalCount || 0), 0, 5000);
  const correctCount = clampNumber(Math.trunc(attempt.correctCount || 0), 0, totalCount);
  return {
    id: docId,
    scope: 'unit_490' as const,
    ownerUid,
    accountId,
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

function buildHonorCreatePayload(
  attempt: QuizAttempt,
  docId: string,
  ownerUid: string,
  accountId: string
) {
  const totalCount = clampNumber(Math.trunc(attempt.totalCount || 0), 0, 5000);
  const correctCount = clampNumber(Math.trunc(attempt.correctCount || 0), 0, totalCount);
  return {
    id: docId,
    attemptId: docId,
    ownerUid,
    accountId,
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
  tracker: CloudSnapshotTracker,
  allowDeletes = true
): Promise<void> {
  const prevMap = new Map(prevAccounts.map((a) => [a.id, a]));
  const nextIds = new Set(nextAccounts.map((a) => sanitizeFirestoreId(a.id, 'acc')));

  for (const acc of nextAccounts) {
    const docId = sanitizeFirestoreId(acc.id, 'acc');
    const prev = prevMap.get(acc.id);
    const hasChanged = !prev || JSON.stringify(prev) !== JSON.stringify(acc);
    // Never invent a default password for staging cloud accounts.
    if (IS_FIREBASE_STAGING && !acc.password &&
        !(acc.passwordHash && /^[a-f0-9]{64}$/.test(acc.passwordHash))) {
      throw new Error(`Tài khoản "${acc.username}" chưa có mật khẩu hoặc mã băm hợp lệ; đã hủy đồng bộ để bảo vệ dữ liệu.`);
    }
    const passwordHash = acc.password
      ? await hashUnitPassword(acc.username, acc.password)
      : acc.passwordHash && /^[a-f0-9]{64}$/.test(acc.passwordHash)
      ? acc.passwordHash
      : await hashUnitPassword(acc.username, '123456');

    // 1. Sync Admin-only /managed_accounts/{docId}
    const ref = doc(db, 'managed_accounts', docId);
    const path = `managed_accounts/${docId}`;
    let existsInCloud = tracker.accountIds.has(docId);
    if (!existsInCloud) {
      try {
        const snap = await getDoc(ref);
        existsInCloud = snap.exists();
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, path);
      }
    }

    if (!existsInCloud) {
      try {
        await setDoc(ref, buildAccountCreatePayload(acc, docId, passwordHash));
        tracker.accountIds.add(docId);
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, path);
      }
    } else if (hasChanged) {
      try {
        await updateDoc(ref, buildAccountUpdatePayload(acc, passwordHash));
        tracker.accountIds.add(docId);
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, path);
      }
    }

    // 2. Sync split-collection hashed /account_directory/{docId} so student/guest devices receive updates live
    const dirRef = doc(db, 'account_directory', docId);
    const dirPath = `account_directory/${docId}`;
    let existsInDir = tracker.directoryIds.has(docId);
    if (!existsInDir) {
      try {
        const dirSnap = await getDoc(dirRef);
        existsInDir = dirSnap.exists();
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, dirPath);
      }
    }

    if (!existsInDir) {
      try {
        await setDoc(dirRef, buildAccountDirectoryCreatePayload(acc, docId, passwordHash));
        tracker.directoryIds.add(docId);
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, dirPath);
      }
    } else if (hasChanged) {
      try {
        await updateDoc(dirRef, buildAccountDirectoryUpdatePayload(acc, passwordHash));
        tracker.directoryIds.add(docId);
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, dirPath);
      }
    }
  }

  if (allowDeletes) {
    const deleteIds = new Set<string>([
      ...Array.from(tracker.accountIds),
      ...Array.from(tracker.directoryIds),
    ]);
    for (const existingId of deleteIds) {
      if (!nextIds.has(existingId)) {
        if (tracker.accountIds.has(existingId)) {
          const path = `managed_accounts/${existingId}`;
          try {
            await deleteDoc(doc(db, 'managed_accounts', existingId));
            tracker.accountIds.delete(existingId);
          } catch (error) {
            handleFirestoreError(error, OperationType.DELETE, path);
          }
        }
        if (tracker.directoryIds.has(existingId)) {
          const dirPath = `account_directory/${existingId}`;
          try {
            await deleteDoc(doc(db, 'account_directory', existingId));
            tracker.directoryIds.delete(existingId);
          } catch (error) {
            handleFirestoreError(error, OperationType.DELETE, dirPath);
          }
        }
      }
    }
  }
}

export async function syncSingleTopicToFirestore(
  topic: Topic,
  prevTopic: Topic | undefined,
  tracker: CloudSnapshotTracker
): Promise<void> {
  const topicId = sanitizeFirestoreId(topic.id, 'topic');
  const topicRef = doc(db, 'topics', topicId);
  const topicPath = `topics/${topicId}`;

  let topicExists = false;
  try {
    const snap = await getDoc(topicRef);
    topicExists = snap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, topicPath);
  }

  if (!topicExists) {
    try {
      await setDoc(topicRef, buildTopicCreatePayload(topic, topicId));
      tracker.topicIds.add(topicId);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, topicPath);
    }
  } else if (
    !prevTopic ||
    prevTopic.code !== topic.code ||
    prevTopic.title !== topic.title ||
    prevTopic.description !== topic.description ||
    prevTopic.timeLimitMinutes !== topic.timeLimitMinutes ||
    prevTopic.questions.length !== topic.questions.length
  ) {
    try {
      await updateDoc(topicRef, buildTopicUpdatePayload(topic));
      tracker.topicIds.add(topicId);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, topicPath);
    }
  }

  // Fetch authoritative existing question IDs for this topic
  const existingQIds = new Set<string>();
  try {
    const qSnap = await getDocs(
      query(collection(db, 'topics', topicId, 'questions'), where('visibility', '==', 'public'))
    );
    qSnap.forEach((d) => existingQIds.add(d.id));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, `topics/${topicId}/questions`);
  }

  const prevQMap = new Map((prevTopic?.questions || []).map((q, idx) => [q.id, { q, idx }]));
  const nextQIds = new Set<string>();

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
}

export async function syncTopicsToFirestore(
  prevTopics: Topic[],
  nextTopics: Topic[],
  tracker: CloudSnapshotTracker,
  allowDeletes = true
): Promise<void> {
  const prevMap = new Map(prevTopics.map((t) => [t.id, t]));
  const nextTopicIds = new Set(nextTopics.map((t) => sanitizeFirestoreId(t.id, 'topic')));

  for (const topic of nextTopics) {
    await syncSingleTopicToFirestore(topic, prevMap.get(topic.id), tracker);
  }

  if (allowDeletes) {
    for (const existingTopicId of Array.from(tracker.topicIds)) {
      if (!nextTopicIds.has(existingTopicId)) {
        const qIds = new Set<string>();
        try {
          const qSnap = await getDocs(
            query(
              collection(db, 'topics', existingTopicId, 'questions'),
              where('visibility', '==', 'public')
            )
          );
          qSnap.forEach((d) => qIds.add(d.id));
        } catch (error) {
          handleFirestoreError(
            error,
            OperationType.LIST,
            `topics/${existingTopicId}/questions`
          );
        }

        let batch = writeBatch(db);
        let count = 0;
        for (const qId of qIds) {
          batch.delete(doc(db, 'topics', existingTopicId, 'questions', qId));
          count++;
          if (count >= 350) {
            try {
              await batch.commit();
            } catch (error) {
              handleFirestoreError(
                error,
                OperationType.DELETE,
                `topics/${existingTopicId}/questions`
              );
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
}

export async function saveSingleAttemptToFirestore(
  attempt: QuizAttempt,
  ownerUid: string,
  tracker: CloudSnapshotTracker,
  options?: {
    accountId?: string;
    accounts?: UserAccount[];
    isCloudAdmin?: boolean;
    localTopics?: Topic[];
  }
): Promise<boolean> {
  const attemptId = sanitizeFirestoreId(attempt.id, 'att');
  const topicId = sanitizeFirestoreId(attempt.topicId, 'topic');
  const resolvedAccountId = resolveAttemptAccountId(
    attempt,
    options?.accounts,
    options?.accountId
  );
  const isUnitSubmission = ownerUid === 'unit_account';

  // Check authoritative existence via honor_entries (publicly readable by all devices) or attempts
  if (isUnitSubmission) {
    try {
      const existingHonor = await getDoc(doc(db, 'honor_entries', attemptId));
      if (existingHonor.exists()) {
        tracker.honorEntryIds.add(attemptId);
        return true;
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `honor_entries/${attemptId}`);
    }

    // Verify account exists and is active in /account_directory before submitting unauthenticated
    try {
      const dirSnap = await getDoc(doc(db, 'account_directory', resolvedAccountId));
      if (!dirSnap.exists()) return false;
      const dirData = dirSnap.data();
      if (
        dirData.active !== true ||
        String(dirData.username || '') !== clampString(attempt.accountUsername, 64, 'hocvien')
      ) {
        return false;
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `account_directory/${resolvedAccountId}`);
    }
  } else {
    const attemptRef = doc(db, 'attempts', attemptId);
    try {
      const existingAtt = await getDoc(attemptRef);
      if (existingAtt.exists()) {
        tracker.attemptIds.add(attemptId);
        return true;
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `attempts/${attemptId}`);
    }
  }

  // Ensure parent topic exists in Firestore (required by Global Consistency rule)
  let topicExists = false;
  try {
    const topicSnap = await getDoc(doc(db, 'topics', topicId));
    topicExists = topicSnap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `topics/${topicId}`);
  }

  if (!topicExists && options?.isCloudAdmin && options.localTopics) {
    const localParent = options.localTopics.find(
      (t) => sanitizeFirestoreId(t.id, 'topic') === topicId
    );
    if (localParent) {
      await syncSingleTopicToFirestore(localParent, undefined, tracker);
      topicExists = true;
    }
  }

  if (!topicExists) {
    return false;
  }

  const batch = writeBatch(db);
  batch.set(
    doc(db, 'attempts', attemptId),
    buildAttemptCreatePayload(attempt, attemptId, ownerUid, resolvedAccountId)
  );
  batch.set(
    doc(db, 'honor_entries', attemptId),
    buildHonorCreatePayload(attempt, attemptId, ownerUid, resolvedAccountId)
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
  tracker: CloudSnapshotTracker,
  localTopics: Topic[],
  accounts?: UserAccount[]
): Promise<void> {
  const nextIds = new Set(nextAttempts.map((a) => sanitizeFirestoreId(a.id, 'att')));

  // Create any newly added attempts whose parent topic exists in cloud
  for (const att of nextAttempts) {
    const attId = sanitizeFirestoreId(att.id, 'att');
    if (!tracker.attemptIds.has(attId)) {
      await saveSingleAttemptToFirestore(att, ownerUid, tracker, {
        accounts,
        isCloudAdmin,
        localTopics,
      });
    }
  }

  // Delete removed attempts & paired honor entries (Admin only)
  if (isCloudAdmin) {
    const cloudSnap = await getDocs(
      query(collection(db, 'attempts'), where('scope', '==', 'unit_490'))
    );
    const toDelete: string[] = [];
    cloudSnap.forEach((d) => {
      if (!nextIds.has(d.id)) {
        toDelete.push(d.id);
      }
    });

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

/**
 * Deterministic 2-way merge + automatic push on initial Google connect.
 * Ensures NO local-only accounts, topics, or attempts are ever lost when connecting,
 * and backfills /account_directory so student/guest devices receive every account live.
 */
export async function mergeAndSyncOnConnect(params: {
  user: User;
  isCloudAdmin: boolean;
  localAccounts: UserAccount[];
  localTopics: Topic[];
  localAttempts: QuizAttempt[];
  defaultAdminAccount: UserAccount;
  tracker: CloudSnapshotTracker;
  allowUploads?: boolean;
}): Promise<{
  accounts: UserAccount[];
  topics: Topic[];
  attempts: QuizAttempt[];
  counts: { accounts: number; topics: number; attempts: number };
}> {
  const {
    user,
    isCloudAdmin,
    localAccounts,
    localTopics,
    localAttempts,
    defaultAdminAccount,
    tracker,
    allowUploads = true,
  } = params;

  // 1. Fetch & merge Accounts + backfill /account_directory (Cloud Admin only)
  let mergedAccounts = localAccounts;
  if (isCloudAdmin) {
    const cloudAccounts: UserAccount[] = [];
    try {
      const accSnap = await getDocs(
        query(collection(db, 'managed_accounts'), where('scope', '==', 'unit_490'))
      );
      accSnap.forEach((d) => {
        tracker.accountIds.add(d.id);
        cloudAccounts.push(parseAccountDoc(d.id, d.data()));
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'managed_accounts');
    }

    try {
      const dirSnap = await getDocs(
        query(collection(db, 'account_directory'), where('visibility', '==', 'public'))
      );
      dirSnap.forEach((d) => {
        tracker.directoryIds.add(d.id);
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'account_directory');
    }

    const accByUsername = new Map<string, UserAccount>();
    for (const ca of cloudAccounts) accByUsername.set(ca.username.toLowerCase(), ca);
    for (const la of localAccounts) {
      const key = la.username.toLowerCase();
      if (!accByUsername.has(key) && la.password) {
        accByUsername.set(key, la);
      }
    }
    if (!accByUsername.has('admin')) {
      accByUsername.set('admin', defaultAdminAccount);
    }
    mergedAccounts = Array.from(accByUsername.values());

    // Push any account missing from managed_accounts OR missing from account_directory
    const needsSync = mergedAccounts.filter((a) => {
      const id = sanitizeFirestoreId(a.id, 'acc');
      return !tracker.accountIds.has(id) || !tracker.directoryIds.has(id);
    });
    if (allowUploads && needsSync.length > 0) {
      await syncAccountsToFirestore([], needsSync, tracker, false);
    }
  }

  // 2. Fetch & merge Topics + Questions
  const cloudTopics: Topic[] = [];
  try {
    const topicSnap = await getDocs(
      query(collection(db, 'topics'), where('visibility', '==', 'public'))
    );
    for (const tDoc of topicSnap.docs) {
      if (IS_FIREBASE_STAGING && tDoc.id === STAGING_TEST_TOPIC_ID) continue;
      const td = tDoc.data();
      const tid = tDoc.id;
      tracker.topicIds.add(tid);

      const qSnap = await getDocs(
        query(collection(db, 'topics', tid, 'questions'), where('visibility', '==', 'public'))
      );
      const qIds = new Set<string>();
      const qList: Array<Question & { _order: number }> = [];
      qSnap.forEach((qd) => {
        qIds.add(qd.id);
        qList.push(parseQuestionDoc(qd.id, qd.data()));
      });
      qList.sort((a, b) => a._order - b._order);
      tracker.questionIdsByTopic.set(tid, qIds);

      cloudTopics.push({
        id: tid,
        code: String(td.code || 'CD-01'),
        title: String(td.title || 'Chuyên đề'),
        description: String(td.description || ''),
        timeLimitMinutes: Number(td.timeLimitMinutes || 15),
        createdAt: timestampToIso(td.createdAt, td.createdAtIso),
        updatedAt: timestampToIso(td.updatedAt, td.updatedAtIso),
        questions: qList.map(({ _order: _unused, ...rest }) => rest),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'topics');
  }

  const topicsById = new Map<string, Topic>();
  for (const ct of cloudTopics) topicsById.set(sanitizeFirestoreId(ct.id, 'topic'), ct);
  const localOnlyTopics: Topic[] = [];
  for (const lt of localTopics) {
    const tid = sanitizeFirestoreId(lt.id, 'topic');
    if (!topicsById.has(tid)) {
      topicsById.set(tid, lt);
      localOnlyTopics.push(lt);
    }
  }

  if (allowUploads && isCloudAdmin && localOnlyTopics.length > 0) {
    await syncTopicsToFirestore([], localOnlyTopics, tracker, false);
  }
  const mergedTopics = Array.from(topicsById.values()).sort((a, b) =>
    a.code.localeCompare(b.code)
  );

  // 3. Fetch & merge Attempts
  const cloudAttempts: QuizAttempt[] = [];
  try {
    const attQuery = isCloudAdmin
      ? query(collection(db, 'attempts'), where('scope', '==', 'unit_490'))
      : query(collection(db, 'attempts'), where('ownerUid', '==', user.uid));
    const attSnap = await getDocs(attQuery);
    attSnap.forEach((d) => {
      tracker.attemptIds.add(d.id);
      cloudAttempts.push(parseAttemptDoc(d.id, d.data()));
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'attempts');
  }

  const attemptsById = new Map<string, QuizAttempt>();
  for (const ca of cloudAttempts) attemptsById.set(sanitizeFirestoreId(ca.id, 'att'), ca);
  const localOnlyAttempts: QuizAttempt[] = [];
  for (const la of localAttempts) {
    const aid = sanitizeFirestoreId(la.id, 'att');
    if (!attemptsById.has(aid)) {
      attemptsById.set(aid, la);
      localOnlyAttempts.push(la);
    }
  }

  if (allowUploads) {
    for (const att of localOnlyAttempts) {
      await saveSingleAttemptToFirestore(att, user.uid, tracker, {
        accounts: mergedAccounts,
        isCloudAdmin,
        localTopics: mergedTopics,
      });
    }
  }

  const mergedAttempts = Array.from(attemptsById.values()).sort(
    (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
  );

  return {
    accounts: mergedAccounts,
    topics: mergedTopics,
    attempts: mergedAttempts,
    counts: {
      accounts: tracker.accountIds.size,
      topics: tracker.topicIds.size,
      attempts: tracker.attemptIds.size,
    },
  };
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
    await syncAccountsToFirestore([], accounts, tracker, false);
    accountsSynced = accounts.length;

    await syncTopicsToFirestore([], topics, tracker, false);
    topicsSynced = topics.length;
  }

  for (const att of attempts) {
    const ok = await saveSingleAttemptToFirestore(att, ownerUid, tracker, {
      accounts,
      isCloudAdmin,
      localTopics: topics,
    });
    if (ok) attemptsSynced++;
  }

  return { accountsSynced, topicsSynced, attemptsSynced };
}
