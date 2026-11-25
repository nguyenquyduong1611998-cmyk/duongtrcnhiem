import React from 'react';
import type {Phase5AdminScore} from '../utils/phase5AdminResults';

interface Props {
  onList:()=>Promise<Phase5AdminScore[]>;
}

// Admin-only UI, all data fetched from validated server endpoint.
// No client role or manually typed UID may grant access to D1.
export const Phase5AdminResultsPanel:React.FC<Props>=({onList})=>{
  const [busy,setBusy]=React.useState(false);
  const busyRef=React.useRef(false);
  const [rows,setRows]=React.useState<Phase5AdminScore[]|null>(null);
  const [notice,setNotice]=React.useState('');
  const [failed,setFailed]=React.useState(false);
  const read=async()=>{
    if(busyRef.current)return;
    busyRef.current=true;
    setBusy(true);setFailed(false);setNotice('');
    try{
      const result=await onList();
      setRows(result);
      setNotice(`Đã đọc ${result.length} kết quả Phase 5 DEMO từ Cloudflare D1.`);
    }catch(error){
      setRows(null);setFailed(true);
      setNotice(error instanceof Error?error.message:
        'Không thể đọc bảng điểm Phase 5 từ D1.');
    }finally{busyRef.current=false;setBusy(false);}
  };
  return (
    <section className="space-y-3 rounded-xl border border-[#BDD7C5] bg-[#F2F9F3] p-3"
      aria-label="Bảng điểm Phase 5 DEMO dành cho Google Admin">
      <p className="text-sm font-bold text-[#152019]">
        Bảng điểm Phase 5 — Google Admin
      </p>
      <p className="text-xs leading-relaxed text-[#4B5B50]">
        Chỉ xem điểm toán học DEMO đã lưu trong D1 Preview. Không xem đáp án,
        mã Firebase, thông tin đăng nhập hoặc điểm thi thật. Không sửa hay xóa kết quả.
      </p>
      <button type="button" disabled={busy} onClick={()=>void read()}
        className="rounded-md border border-[#1F4D36] bg-white px-3 py-2 text-xs font-semibold text-[#1F4D36] disabled:opacity-50">
        Xem bảng điểm Phase 5 từ D1
      </button>
      {rows!==null&&(
        <div className="space-y-2 rounded-lg border border-[#DDE3DC] bg-white p-3">
          <p className="text-xs font-semibold">Bài nộp Phase 5 DEMO: {rows.length}</p>
          {rows.length===0&&(
            <p className="text-xs text-[#475569]">Chưa có bài nộp DEMO nào.</p>
          )}
          {rows.map(row=>(
            <div className="space-y-1 rounded-md bg-[#F5F7F5] p-2" key={row.username}>
              <p className="break-all font-mono text-xs font-semibold">{row.username}</p>
              <p className="text-xs">
                {row.score}/{row.maxScore} điểm · {row.correctCount}/{row.totalCount} câu đúng
              </p>
              <p className="text-xs text-[#475569]">
                Chuyên đề Toán học DEMO — phiên bản {row.revision}
              </p>
            </div>
          ))}
        </div>
      )}
      {notice&&(
        <p role="status" className={`text-xs ${failed?'text-[#B91C1C]':'text-[#166534]'}`}>
          {notice}
        </p>
      )}
    </section>
  );
};
