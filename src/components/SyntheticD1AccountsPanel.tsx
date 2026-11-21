import React from 'react';
import type { SyntheticD1Account, SyntheticTemporaryCredential } from '../utils/serverlessAuth';

interface Props {
  onList: () => Promise<SyntheticD1Account[]>;
  onCreate: () => Promise<SyntheticD1Account>;
  onSetActive: (username: string, active: boolean) => Promise<void>;
  onDelete: (username: string) => Promise<void>;
  onResetPassword: (username: string) => Promise<SyntheticTemporaryCredential>;
}

/** Staging-only Admin tool; database never returns raw passwords or password hashes. */
export const SyntheticD1AccountsPanel: React.FC<Props> = ({
  onList, onCreate, onSetActive, onDelete, onResetPassword,
}) => {
  const [accounts, setAccounts] = React.useState<SyntheticD1Account[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [deletePending, setDeletePending] = React.useState<string | null>(null);
  const [resetPending, setResetPending] = React.useState<string | null>(null);
  const [temporaryCredential, setTemporaryCredential] = React.useState<SyntheticTemporaryCredential | null>(null);
  const [revealPassword, setRevealPassword] = React.useState(false);

  const resetPassword = async (username: string) => {
    if (busy) return;
    setBusy(true);
    setError(false);
    setMessage('');
    setTemporaryCredential(null);
    setRevealPassword(false);
    try {
      const credential = await onResetPassword(username);
      setTemporaryCredential(credential);
      setResetPending(null);
      setMessage('Đã cấp mật khẩu tạm cho tài khoản GIẢ. Mật khẩu chỉ có trong cửa sổ này, chưa thể dùng đăng nhập.');
      setAccounts(await onList());
      setLoaded(true);
    } catch (cause) {
      setError(true);
      setMessage(cause instanceof Error ? cause.message : 'Không thể cấp mật khẩu tạm.');
    } finally {
      setBusy(false);
    }
  };


  async function perform(operation: () => Promise<string>, refresh = true) {
    if (busy) return;
    setBusy(true);
    setError(false);
    setMessage('');
    try {
      const text = await operation();
      if (refresh) {
        setAccounts(await onList());
        setLoaded(true);
      }
      setMessage(text);
    } catch (cause) {
      setError(true);
      setMessage(cause instanceof Error ? cause.message : 'Không thể truy cập D1. Vui lòng kiểm tra máy chủ.');
    } finally {
      setBusy(false);
    }
  }
  const load = () => void perform(async () => {
    setAccounts(await onList());
    setLoaded(true);
    return 'Đã lấy danh sách tài khoản giả trực tiếp từ Cloudflare D1.';
  }, false);

  return (
    <section className="space-y-3 rounded-xl border border-[#DDE3DC] bg-[#FAFBF9] p-3" aria-label="Kiểm thử quản lý tài khoản tập trung trên D1">
      <p className="text-sm font-bold text-[#152019]">Quản lý tài khoản giả trong Cloudflare D1</p>
      <p className="text-xs leading-relaxed text-[#4B5B50]">
        Chỉ tạo tài khoản tự động dạng test_unit_. Tài khoản được khóa mặc định,
        yêu cầu đặt lại mật khẩu và CHƯA thể dùng để đăng nhập. Không chạm vào
        admin, hocvien01, hocvien02, bảng demo_students hoặc Firebase production.
      </p>
      <button
        type="button" disabled={busy}
        onClick={load}
        className="w-full rounded-md border border-[#1F4D36] px-3 py-2 text-xs font-semibold text-[#1F4D36] disabled:opacity-50"
      >Đọc danh sách tài khoản giả từ D1</button>
      <button
        type="button" disabled={busy}
        onClick={() => void perform(async () => {
          const account = await onCreate();
          return `Đã tạo ${account.username} trong D1 (đang khóa, chưa đăng nhập được).`;
        })}
        className="w-full rounded-md border border-[#1F4D36] px-3 py-2 text-xs font-semibold text-[#1F4D36] disabled:opacity-50"
      >Tạo 1 tài khoản giả test_unit_ trong D1</button>
      {temporaryCredential && (
        <div className="space-y-2 rounded-md border border-[#DDE3DC] bg-white p-3">
          <p className="text-xs font-semibold text-[#152019]">
            Mật khẩu tạm của tài khoản GIẢ: {temporaryCredential.username}
          </p>
          <p className="text-xs text-[#B91C1C]">
            Chỉ hiển thị trong phiên này. KHÔNG chụp ảnh mật khẩu hoặc gửi vào chat.
            Không phải mật khẩu của học viên thật, và chưa thể đăng nhập bằng mật khẩu này.
          </p>
          <input
            type={revealPassword ? 'text' : 'password'}
            readOnly
            value={temporaryCredential.temporaryPassword}
            autoComplete="off"
            aria-label="Mật khẩu tạm của tài khoản giả"
            onClick={(event) => event.currentTarget.select()}
            className="w-full rounded-md border border-[#DDE3DC] bg-[#FAFBF9] p-2 font-mono text-xs"
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setRevealPassword((value) => !value)}
              className="rounded-md border border-[#1F4D36] px-2 py-1.5 text-xs text-[#1F4D36]">
              {revealPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
            </button>
            <button type="button" onClick={() => {setTemporaryCredential(null);setRevealPassword(false);}}
              className="rounded-md border border-[#CFD8CE] px-2 py-1.5 text-xs">
              Đóng và xóa khỏi màn hình
            </button>
          </div>
        </div>
      )}
      {loaded && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-[#152019]">Số tài khoản thử nghiệm: {accounts.length}</p>
          {accounts.length === 0 && (
            <p className="text-xs text-[#4B5B50]">D1 chưa có tài khoản test_unit_ nào.</p>
          )}
          {accounts.map((account) => (
            <div key={account.username} className="rounded-md border border-[#DDE3DC] bg-white p-2 space-y-2">
              <p className="break-all font-mono text-xs text-[#152019]">{account.username}</p>
              <p className="text-xs text-[#4B5B50]">
                {account.active ? 'Trạng thái D1: mở' : 'Trạng thái D1: khóa'}
                {' • '}Yêu cầu đặt lại mật khẩu: {account.passwordResetRequired ? 'Có' : 'Không'}
              </p>
              <p className="text-xs text-[#64756A]">Chưa hỗ trợ đăng nhập bằng bảng này.</p>
              <div className="flex flex-wrap gap-2">
                {resetPending === account.username ? (
                  <>
                    <button type="button" disabled={busy}
                      onClick={() => void resetPassword(account.username)}
                      className="rounded-md border border-[#1F4D36] px-2 py-1.5 text-xs font-semibold text-[#1F4D36] disabled:opacity-50"
                    >Xác nhận cấp mật khẩu tạm</button>
                    <button type="button" disabled={busy} onClick={() => setResetPending(null)}
                      className="rounded-md border border-[#CFD8CE] px-2 py-1.5 text-xs">Hủy</button>
                  </>
                ) : (
                  <button type="button" disabled={busy}
                    onClick={() => {setResetPending(account.username);setDeletePending(null);}}
                    className="rounded-md border border-[#1F4D36] px-2 py-1.5 text-xs font-semibold text-[#1F4D36] disabled:opacity-50"
                  >Cấp mật khẩu tạm (GIẢ)</button>
                )}
                <button
                  type="button" disabled={busy}
                  onClick={() => void perform(async () => {
                    await onSetActive(account.username, !account.active);
                    return `Đã ${account.active ? 'khóa' : 'mở trạng thái'} ${account.username} trong D1.`;
                  })}
                  className="rounded-md border border-[#1F4D36] px-2 py-1.5 text-xs font-semibold text-[#1F4D36] disabled:opacity-50"
                >{account.active ? 'Khóa trong D1' : 'Mở trạng thái D1'}</button>
                {deletePending === account.username ? (
                  <>
                    <button
                      type="button" disabled={busy}
                      onClick={() => void perform(async () => {
                        await onDelete(account.username);
                        setDeletePending(null);
                        return `Đã xóa tài khoản giả ${account.username} khỏi D1.`;
                      })}
                      className="rounded-md border border-[#B91C1C] px-2 py-1.5 text-xs font-semibold text-[#B91C1C] disabled:opacity-50"
                    >Xác nhận xóa GIẢ</button>
                    <button type="button" disabled={busy}
                      onClick={() => setDeletePending(null)}
                      className="rounded-md border border-[#CFD8CE] px-2 py-1.5 text-xs"
                    >Hủy</button>
                  </>
                ) : (
                  <button type="button" disabled={busy}
                    onClick={() => setDeletePending(account.username)}
                    className="rounded-md border border-[#B91C1C] px-2 py-1.5 text-xs font-semibold text-[#B91C1C] disabled:opacity-50"
                  >Xóa tài khoản giả</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {!!message && (
        <p role="status" className={`text-xs ${error ? 'text-[#B91C1C]' : 'text-[#166534]'}`}>{message}</p>
      )}
    </section>
  );
};
