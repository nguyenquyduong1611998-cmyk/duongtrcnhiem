import React from 'react';
import type {User} from 'firebase/auth';
import {
  listPhase6OwnHistory,listPhase6AdminResults,readPhase6AdminSummary,
} from '../utils/phase6Results';
import type {
  Phase6AdminScore,Phase6HistoryEntry,Phase6ResultsPage,Phase6ResultsSummary,
} from '../utils/phase6Results';

interface Props {user:User|null;role:'student'|'admin';}
const button='rounded-md border border-[#1F4D36] bg-white px-3 py-2 text-xs font-semibold text-[#1F4D36] disabled:cursor-not-allowed disabled:opacity-40';
const DATE_OPTIONS:Intl.DateTimeFormatOptions={
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
};
function renderDate(seconds:number):string{
  return new Date(seconds*1000).toLocaleString('vi-VN',DATE_OPTIONS);
}
// Separate read-only result panel; no browser score computation or identity input.
// Enabled only on pinned Cloudflare Preview for verified Firebase DEMO roles.
export const Phase6ResultsPanel:React.FC<Props>=({user,role})=>{
  const [page,setPage]=React.useState<
    Phase6ResultsPage<Phase6HistoryEntry|Phase6AdminScore>|null>(null);
  const [summary,setSummary]=React.useState<Phase6ResultsSummary|null>(null);
  const [busy,setBusy]=React.useState(false);
  const busyRef=React.useRef(false);
  const [notice,setNotice]=React.useState('');
  const [failed,setFailed]=React.useState(false);
  React.useEffect(()=>{
    setPage(null);setSummary(null);setNotice('');
  },[role,user?.uid]);
  const run=async(fn:()=>Promise<void>)=>{
    if(busyRef.current)return;
    busyRef.current=true;setBusy(true);setFailed(false);setNotice('');
    try{await fn();}
    catch(error){
      setFailed(true);
      setNotice(error instanceof Error?error.message:'Không tải được kết quả DEMO.');
    }finally{busyRef.current=false;setBusy(false);}
  };
  const fetchPage=async(offset:number)=>{
    if(role==='admin')return listPhase6AdminResults(user,offset);
    return listPhase6OwnHistory(user,offset);
  };
  const load=async(offset:number)=>{
    // No local cached scores; each request reads D1 with fresh Firebase token.
    const [next,totals]=await Promise.all([
      fetchPage(offset),
      role==='admin'&&offset===0?readPhase6AdminSummary(user):Promise.resolve(null),
    ]);
    setPage(next);
    if(totals)setSummary(totals);
    setNotice('Đã đọc dữ liệu từ D1 Preview. Trang '+(offset/25+1)+'.');
  };
  return (
    <section className="space-y-3 rounded-xl border border-[#C6D6CA] bg-[#F4F9F5] p-4"
      aria-label={role==='admin'
        ?'Bảng điểm Phase 6E DEMO của Admin':'Lịch sử thi Phase 6E DEMO của học viên'}>
      <h3 className="text-sm font-bold text-[#152019]">
        {role==='admin'?'Phase 6E — Bảng điểm DEMO dành cho Google Admin':
          'Phase 6E — Lịch sử điểm thi DEMO của bạn'}
      </h3>
      <p className="text-xs text-[#475569]">
        Chỉ đọc các điểm thi Phase 6 đã nộp từ D1 Preview. Không bao gồm
        kết quả Phase 4 một câu hay lịch sử luyện tập lưu riêng trên thiết bị.
        Đây là điểm toán giả để thử hệ thống, không phải điểm chính thức;
        không hiện đáp án đúng hay dữ liệu đăng nhập.
      </p>
      <button className={button} disabled={busy} type="button"
        onClick={()=>void run(()=>load(0))}>
        {page?'Tải lại bảng điểm từ D1':'Tải kết quả từ D1'}
      </button>
      {role==='admin'&&summary&&(
        <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
          <div className="rounded-md bg-white p-3">
            <p className="text-[#64756A]">Lượt nộp</p>
            <p className="text-lg font-semibold tabular-nums">{summary.attemptCount}</p>
          </div>
          <div className="rounded-md bg-white p-3">
            <p className="text-[#64756A]">Học viên DEMO đã nộp</p>
            <p className="text-lg font-semibold tabular-nums">{summary.studentCount}</p>
          </div>
          <div className="rounded-md bg-white p-3">
            <p className="text-[#64756A]">Điểm trung bình các lượt nộp</p>
            <p className="text-lg font-semibold tabular-nums">
              {summary.averageScore===null?'—':summary.averageScore.toFixed(1)+'/10'}
            </p>
          </div>
        </div>
      )}
      {page&&(
        <div className="space-y-2 rounded-lg bg-white p-3">
          <p className="text-xs text-[#64756A]">
            Trang {page.offset/25+1} · {page.entries.length} kết quả
            {page.nextOffset!==null?' · còn dữ liệu ở trang tiếp theo':''}
          </p>
          {page.entries.length===0&&(
            <p className="text-xs">Chưa có lượt nộp DEMO nào trong trang này.</p>
          )}
          {page.entries.map(entry=>(
            <div key={(role==='admin'&&'username' in entry?entry.username+':':'')+
              entry.topicId+'-'+entry.revision}
              className="space-y-1 rounded-md border border-[#E2E8F0] p-3 text-xs">
              {role==='admin'&&'username' in entry&&(
                <p className="font-semibold">Học viên DEMO: {entry.username}</p>
              )}
              <p className="font-semibold text-[#152019]">{entry.title}</p>
              <p>Phiên bản {entry.revision} · {entry.correctCount}/{entry.totalCount} câu đúng ·
                Điểm {entry.score.toFixed(1)}/{entry.maxScore}</p>
              <p className="text-[#64756A]">Nộp lúc: {renderDate(entry.submittedAt)}</p>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy||page.offset===0}
              className={button}
              onClick={()=>void run(()=>load(page.offset-25))}>Trang trước</button>
            <button type="button" disabled={busy||page.nextOffset===null}
              className={button}
              onClick={()=>void run(()=>load(page.nextOffset??0))}>Trang sau</button>
          </div>
        </div>
      )}
      {notice&&<p role="status"
        className={'text-xs '+(failed?'text-red-700':'text-green-800')}>
        {notice}
      </p>}
    </section>
  );
};
