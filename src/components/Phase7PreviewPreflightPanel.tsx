import React from 'react';
import type {User} from 'firebase/auth';
import {
  readPhase7PreviewSchema,
} from '../utils/phase7PreviewPreflight';
import type {Phase7PreviewSchemaReport} from '../utils/phase7PreviewPreflight';

interface Props{user:User|null;}
const STAGES=[
  {key:'baseline',label:'D1 nền tảng Phase 4/5'},
  {key:'phase6b',label:'6B — Đề nháp Admin'},
  {key:'phase6c',label:'6C — Xuất bản đề'},
  {key:'phase6a',label:'6A — Phiên thi'},
  {key:'phase6d',label:'6D — Lưu điểm'},
] as const;
const LABELS={
  ABSENT:'Chưa có bảng',
  SCHEMA_CANDIDATE:'Có cấu trúc cần thẩm định',
  BLOCKED_INCOMPLETE_OR_MISMATCHED:'Thiếu hoặc sai cấu trúc — DỪNG',
};
export const Phase7PreviewPreflightPanel:React.FC<Props>=({user})=>{
  const [report,setReport]=React.useState<Phase7PreviewSchemaReport|null>(null);
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState('');
  const busyRef=React.useRef(false);
  const check=async()=>{
    if(busyRef.current)return;
    busyRef.current=true;setBusy(true);setError('');setReport(null);
    try{setReport(await readPhase7PreviewSchema(user));}
    catch(cause){setError(cause instanceof Error?cause.message:
      'Chưa kiểm tra được D1 Preview.');}
    finally{busyRef.current=false;setBusy(false);}
  };
  return (
    <section className="space-y-3 rounded-xl border border-[#B8C8BE] bg-[#F6F8F5] p-4"
      aria-label="Kiểm tra cấu trúc D1 Preview Phase 7A">
      <h3 className="text-sm font-bold text-[#152019]">
        Phase 7A — Kiểm tra an toàn D1 Preview (chỉ đọc)
      </h3>
      <p className="text-xs text-[#475569]">
        Chỉ Google Admin trên bản Preview được xem trạng thái các nhóm bảng.
        Công cụ không sao lưu, chạy migration, thay đổi dữ liệu hay đọc điểm.
        Kết quả dù đủ cấu trúc cũng KHÔNG cho phép bật thi thật.
      </p>
      <button type="button" disabled={busy}
        className="rounded-md border border-[#1F4D36] bg-white px-3 py-2 text-xs font-semibold text-[#1F4D36] disabled:opacity-50"
        onClick={()=>void check()}>
        {busy?'Đang kiểm tra…':'Kiểm tra cấu trúc D1 Preview'}
      </button>
      {error&&<p role="alert" className="text-xs text-red-700">{error}</p>}
      {report&&(
        <div className="space-y-2 rounded-md border border-[#DDE3DC] bg-white p-3">
          <p className="text-xs font-bold text-[#152019]">
            Kết quả: {report.status}
          </p>
          <div className="space-y-1">
            {STAGES.map(({key,label})=>(
              <p className="text-xs" key={key}>
                <span className="font-medium">{label}:</span>{' '}
                {LABELS[report.stages[key]]}
              </p>
            ))}
          </div>
          <p className="text-xs font-semibold text-red-700">
            Chưa xác minh ID D1, backup mới, phục hồi độc lập và
            điều kiện vận hành. KHÔNG chạy SQL hoặc bật tính năng.
          </p>
        </div>
      )}
    </section>
  );
};
