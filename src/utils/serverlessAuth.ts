import { signInWithCustomToken } from 'firebase/auth';
import { auth, IS_FIREBASE_STAGING } from '../firebase';

interface DemoStudentAccount {
  id: string;
  username: string;
  role: 'student';
  active: boolean;
}
export interface DemoStudentCredentials {
  username: string;
  password: string;
  role: 'student';
}

async function postStaging(path: string, body: Record<string, unknown>, idToken?: string): Promise<Record<string, any>> {
  if (!IS_FIREBASE_STAGING) throw new Error('Chỉ có thể sử dụng trên website staging.');
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(idToken ? {authorization: `Bearer ${idToken}`} : {}),
    },
    body: JSON.stringify(body),
    cache: 'no-store',
    credentials: 'same-origin',
  });
  const result = await res.json().catch(() => null) as Record<string, any> | null;
  if (!res.ok) {
    if (res.status === 503) {
      const backendCode = result?.error;
      if (backendCode === 'SERVER_NOT_CONFIGURED')
        throw new Error('Cloudflare Functions chưa nhận đủ D1 hoặc Secret Firebase staging.');
      if (backendCode === 'PASSWORD_HASH_UNAVAILABLE')
        throw new Error('Cloudflare không thực hiện được phép băm mật khẩu an toàn của tài khoản thử. Cần kiểm tra giới hạn mã hóa của Workers; không tự giảm độ bảo mật.');
      if (backendCode === 'D1_WRITE_FAILED')
        throw new Error('Máy chủ chưa ghi được tài khoản DEMO vào D1. Cần kiểm tra cấu trúc bảng hoặc nhật ký Functions.');
      if (backendCode === 'D1_DELETE_FAILED')
        throw new Error('Máy chủ chưa xóa được bản ghi DEMO trong D1.');
      throw new Error('Cloudflare Functions gặp lỗi khi xử lý yêu cầu (503). Cần xem nhật ký Functions; không nhất thiết thiếu cấu hình.');
    }
    if (res.status === 403) throw new Error('Google Admin không được máy chủ xác nhận. Hãy kiểm tra tài khoản Google và kết nối lại.');
    if (res.status === 429) throw new Error('Đã thử đăng nhập quá nhiều lần. Hãy đợi 15 phút.');
    if (res.status === 401) throw new Error('Tên tài khoản hoặc mật khẩu không đúng.');
    throw new Error(typeof result?.error === 'string' ? result.error : 'Không thể kết nối API Cloudflare.');
  }
  if (!result || typeof result !== 'object') throw new Error('Dữ liệu API không hợp lệ.');
  return result;
}
export async function testBackendReady(): Promise<boolean> {
  if (!IS_FIREBASE_STAGING) return false;
  try {
    const res = await fetch('/api/auth/status', {cache:'no-store',credentials:'same-origin'});
    if (!res.ok) return false;
    const data = await res.json();
    return data?.ready === true && data?.stage === 'staging-only';
  } catch {
    return false;
  }
}
export async function loginWithStagingUsername(username: string, password: string): Promise<DemoStudentAccount> {
  if (!IS_FIREBASE_STAGING || !/^test_hv_[a-f0-9]{12}$/.test(username.trim().toLowerCase())) {
    throw new Error('Hiện chỉ hỗ trợ tài khoản học viên giả trên Firebase staging.');
  }
  const result = await postStaging('/api/auth/student/login', {username,password});
  if (!result.customToken || !result.account || result.account.role !== 'student' ||
      typeof result.account.username !== 'string' || typeof result.account.id !== 'string')
    throw new Error('Máy chủ không trả về UID học viên hợp lệ.');
  const user = await signInWithCustomToken(auth, result.customToken);
  if (user.user.uid !== result.account.id) {
    await auth.signOut();
    throw new Error('UID Firebase không trùng với tài khoản học viên.');
  }
  return result.account as DemoStudentAccount;
}
export async function provisionDemoStudent(idToken: string): Promise<DemoStudentCredentials> {
  const result = await postStaging('/api/auth/admin/demo', {action:'create'}, idToken);
  if (!/^test_hv_[a-f0-9]{12}$/.test(result.username) || typeof result.password !== 'string' || result.role!=='student') {
    throw new Error('Dữ liệu đăng ký demo từ máy chủ không hợp lệ.');
  }
  return {username:result.username,password:result.password,role:'student'};
}
export async function deleteDemoStudent(idToken: string, username: string): Promise<void> {
  if (!/^test_hv_[a-f0-9]{12}$/.test(username)) throw new Error('Không phải tài khoản demo.');
  const res=await postStaging('/api/auth/admin/demo',{action:'delete',username},idToken);
  if (res.deleted!==true) throw new Error('Không nhận được xác nhận xóa demo từ máy chủ.');
}
