import React from 'react';
import type {User} from 'firebase/auth';
import {
  listPhase6OwnHistory,listPhase6AdminResults,readPhase6AdminSummary,
} from '../utils/phase6Results';
import {Phase7HistoryReadGate,phase7HistoryIdentity} from '../utils/phase7HistoryReadGate';
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
  const [loadedIdentity,setLoadedIdentity]=React.useState<string|null>(null);
  const [busy,setBusy]=React.useState(false);
  const busyRef=React.useRef(false);
  const gateRef=React.useRef(new Phase7HistoryReadGate());
  const [notice,setNotice]=React.useState('');
  const [failed,setFailed]=React.useState(false);
  const identityKey=phase7HistoryIdentity(role,user?.uid??null);
  // Never display any former account's result, even before effects run.
  const visiblePage=loadedIdentity===identityKey?page:null;
  const visibleSummary=loadedIdentity===identityKey?summary:null;

  const fetchPage=async(offset:number)=>{
    if(role==='admin')return listPhase6AdminResults(user,offset);
    return listPhase6OwnHistory(user,offset);
  };
  const load=async(offset:number,isCurrent:()=>boolean)=>{
    // Every load gets a fresh Firebase token and reads D1. No score cache.
    const [next,totals]=await Promise.all([
      fetchPage(offset),
      role==='admin'&&offset===0?readPhase6AdminSummary(user):Promise.resolve(null),
    ]);
    if(!isCurrent())return;
    setPage(next);
    if(totals)setSummary(totals);
    setLoadedIdentity(identityKey);
    setNotice('Đã đọc dữ liệu từ D1 Preview. Trang '+(offset/25+1)+'.');
  };
  const run=async(offset:number)=>{
    if(busyRef.current)return;
    const uid=user?.uid??null;
    const version=gateRef.current.begin(role,uid);
    const isCurrent=()=>gateRef.current.isCurrent(role,uid,version);
    busyRef.current=true;setBusy(true);setNotice('');setFailed(false);
    setPage(null);setLoadedIdentity(null);
    if(offset===0)setSummary(null);
    try{await load(offset,isCurrent);}
    catch(error){
      if(isCurrent()){
        // If D1 is unavailable, do not silently present older grades as fresh.
        setPage(null);setSummary(null);setLoadedIdentity(null);
        setFailed(true);
        setNotice(error instanceof Error?error.message:'Không tải được kết quả DEMO.');
      }
    }finally{
      if(isCurrent()){busyRef.current=false;setBusy(false);}
    }
  };
  React.useEffect(()=>{
    gateRef.current.setIdentity(role,user?.uid??null);
    gateRef.current.invalidate();
    busyRef.current=false;
    setBusy(false);
    setPage(null);setSummary(null);setNotice('');
    setLoadedIdentity(null);
    // One read when the user opens the history panel. No polling/retries.
    if(user)void run(0);
    return ()=>gateRef.current.invalidate();
  },[role,user?.uid]);
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
        Lịch sử tự tải khi mở trang; nếu vừa nộp trên thiết bị khác,
        hãy bấm Tải lại. Không tự động kiểm tra liên tục.
      </p>
      {busy&&<p role="status" className="text-xs text-[#475569]">
        Đang tải kết quả mới từ D1…
      </p>}
      <button className={button} disabled={busy} type="button"
        onClick={()=>void run(0)}>
        {visiblePage?'Tải lại bảng điểm từ D1':'Tải kết quả từ D1'}
      </button>
      {role==='admin'&&visibleSummary&&(
        <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
          <div className="rounded-md bg-white p-3">
            <p className="text-[#64756A]">Lượt nộp</p>
            <p className="text-lg font-semibold tabular-nums">{visibleSummary.attemptCount}</p>
          </div>
          <div className="rounded-md bg-white p-3">
            <p className="text-[#64756A]">Học viên DEMO đã nộp</p>
            <p className="text-lg font-semibold tabular-nums">{visibleSummary.studentCount}</p>
          </div>
          <div className="rounded-md bg-white p-3">
            <p className="text-[#64756A]">Điểm trung bình các lượt nộp</p>
            <p className="text-lg font-semibold tabular-nums">
              {visibleSummary.averageScore===null?'—':visibleSummary.averageScore.toFixed(1)+'/10'}
            </p>
          </div>
        </div>
      )}
      {visiblePage&&(
        <div className="space-y-2 rounded-lg bg-white p-3">
          <p className="text-xs text-[#64756A]">
            Trang {visiblePage.offset/25+1} · {visiblePage.entries.length} kết quả
            {visiblePage.nextOffset!==null?' · còn dữ liệu ở trang tiếp theo':''}
          </p>
          {visiblePage.entries.length===0&&(
            <p className="text-xs">Chưa có lượt nộp DEMO nào trong trang này.</p>
          )}
          {visiblePage.entries.map(entry=>(
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
            <button type="button" disabled={busy||visiblePage.offset===0}
              className={button}
              onClick={()=>void run(visiblePage.offset-25)}>Trang trước</button>
            <button type="button" disabled={busy||visiblePage.nextOffset===null}
              className={button}
              onClick={()=>void run(visiblePage.nextOffset??0)}>Trang sau</button>
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
