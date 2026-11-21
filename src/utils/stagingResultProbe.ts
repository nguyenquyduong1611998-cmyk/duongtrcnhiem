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
function isPermissionDenied(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = (error as {code?: unknown}).code;
  return code === 'permission-denied' || code === 'firestore/permission-denied';
}

/**
 * Staging-only negative authorization check. Student B tries to get and delete
 * Student A's synthetic-only result. The two operations must be rejected by
 * Firestore Security Rules. If the read succeeds, stop without attempting
 * deletion. No real user result, account or quiz collection is accessed.
 */
export async function assertOtherDemoStudentDenied(
  user: User | null,
  otherStudentUid: string,
): Promise<void> {
  const student = requireDemoStudent(user);
  const targetUid = otherStudentUid.trim();
  if (!DEMO_UID.test(targetUid)) {
    throw new Error('UID học viên A không đúng định dạng tài khoản DEMO.');
  }
  if (targetUid === student.uid) {
    throw new Error('Hai tài khoản có cùng UID. Hãy sử dụng học viên DEMO B khác A.');
  }
  const targetRef = doc(db, 'demo_result_probes', targetUid);
  try {
    await getDocFromServer(targetRef);
  } catch (error) {
    if (!isPermissionDenied(error)) {
      throw new Error('Không xác minh được quyền đọc: Firebase không trả về permission-denied. Hãy kiểm tra kết nối và Rules.');
    }
    // This denial alone does not prove the target document exists.
    // The owner must confirm their own synthetic result still exists afterward.
    try {
      await deleteDoc(targetRef);
    } catch (deleteError) {
      if (isPermissionDenied(deleteError)) return;
      throw new Error('Không xác minh được quyền xóa: Firebase không trả về permission-denied.');
    }
    throw new Error('CẢNH BÁO: Firebase cho phép học viên B xóa dữ liệu GIẢ của A. Dừng kiểm thử và kiểm tra Rules.');
  }
  throw new Error('CẢNH BÁO: Firebase cho phép học viên B đọc dữ liệu GIẢ của A. Dừng kiểm thử, không thử xóa.');
}

export async function deleteDemoResultProbe(user: User | null): Promise<void> {
  const student = requireDemoStudent(user);
  const ref = refFor(student);
  const existing = await getDocFromServer(ref);
  if (!existing.exists()) return;
  assertResult(existing.data(), student.uid);
  await deleteDoc(ref);
}
