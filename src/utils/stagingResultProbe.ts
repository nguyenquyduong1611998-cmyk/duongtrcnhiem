// A fixed, synthetic score document for verifying cross-browser Firebase UID ownership.
// Only available on staging; does not touch actual quiz attempts or histories.
import type { User } from 'firebase/auth';
import { deleteDoc, doc, getDocFromServer, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, IS_FIREBASE_STAGING } from '../firebase';

const DEMO_UID = /^student_[a-f0-9]{32}$/;
const MARKER = 'SYNTHETIC_ONLY';
const RESULT_TYPE = 'DEMO_SYNC_PROBE';
const FAKE_SCORE = 7;

function requireDemoStudent(user: User | null): User {
  if (!IS_FIREBASE_STAGING || !user || !DEMO_UID.test(user.uid)) {
    throw new Error('Chỉ học viên DEMO đã đăng nhập Firebase staging được kiểm thử.');
  }
  return user;
}
function refFor(user: User) {
  return doc(db, 'demo_result_probes', user.uid);
}
function assertResult(data: Record<string, unknown>, uid: string) {
  if (data.ownerUid !== uid || data.marker !== MARKER ||
      data.resultType !== RESULT_TYPE || data.score !== FAKE_SCORE ||
      !data.createdAt || Object.keys(data).sort().join(',') !== 'createdAt,marker,ownerUid,resultType,score') {
    throw new Error('Dữ liệu thử không khớp mẫu cố định. Không tiếp tục thay đổi tài liệu.');
  }
}
export async function createDemoResultProbe(user: User | null): Promise<void> {
  const student = requireDemoStudent(user);
  const ref = refFor(student);
  const existing = await getDocFromServer(ref);
  if (existing.exists()) {
    assertResult(existing.data(), student.uid);
    return;
  }
  await setDoc(ref, {
    ownerUid: student.uid,
    marker: MARKER,
    resultType: RESULT_TYPE,
    score: FAKE_SCORE,
    createdAt: serverTimestamp(),
  });
  await readDemoResultProbe(student);
}
export async function readDemoResultProbe(user: User | null): Promise<void> {
  const student = requireDemoStudent(user);
  const snapshot = await getDocFromServer(refFor(student));
  if (!snapshot.exists()) throw new Error('Chưa có kết quả giả trên Firebase. Hãy tạo ở trình duyệt đầu tiên.');
  assertResult(snapshot.data(), student.uid);
}
export async function deleteDemoResultProbe(user: User | null): Promise<void> {
  const student = requireDemoStudent(user);
  const ref = refFor(student);
  const existing = await getDocFromServer(ref);
  if (!existing.exists()) return;
  assertResult(existing.data(), student.uid);
  await deleteDoc(ref);
}
