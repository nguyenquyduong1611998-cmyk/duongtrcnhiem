import React from 'react';
import type {User} from 'firebase/auth';
import {
  listPhase6Exams,readPhase6Exam,startPhase6Exam,
  readPhase6ExamResult,submitPhase6Exam,
} from '../utils/phase6StudentExam';
import {getPhase6RemainingSeconds} from '../utils/phase6ExamTime';
import {retainPhase6LocalSelections} from '../utils/phase7SessionRefresh';
import type {
  Phase6ExamSummary,Phase6ExamState,Phase6ExamResult,
} from '../utils/phase6StudentExam';

interface Props {user:User|null;}
const button='rounded-md border border-[#1F4D36] bg-white px-3 py-2 text-xs font-semibold text-[#1F4D36] disabled:cursor-not-allowed disabled:opacity-40';

// Only rendered when 6D Preview UI is explicitly enabled for an authenticated
// DEMO Firebase student. Does not import local QuizFlow (which has answer keys).
export const Phase6StudentExamPanel:React.FC<Props>=({user})=>{
  const [topics,setTopics]=React.useState<Phase6ExamSummary[]|null>(null);
  const [chosen,setChosen]=React.useState<Phase6ExamSummary|null>(null);
  const [state,setState]=React.useState<Phase6ExamState|null>(null);
  const [answers,setAnswers]=React.useState<Record<string,number>>({});
  const [result,setResult]=React.useState<Phase6ExamResult|null>(null);
  // A lost submit response may mean D1 already committed the grade.
  // Do not allow another submit until the student explicitly checks D1.
  const [unconfirmedSubmitId,setUnconfirmedSubmitId]=React.useState<string|null>(null);
  const [confirmSubmit,setConfirmSubmit]=React.useState(false);
  const [busy,setBusy]=React.useState(false);
  const busyRef=React.useRef(false);
  const [notice,setNotice]=React.useState('');
  const [failed,setFailed]=React.useState(false);
  const [tick,setTick]=React.useState(0);
  const sync=React.useRef<{serverNow:number;receivedAt:number}|null>(null);
  React.useEffect(()=>{
    const timer=window.setInterval(()=>setTick(v=>v+1),1000);
    return ()=>window.clearInterval(timer);
  },[]);
  const setExam=(next:Phase6ExamState)=>{
    // Reading the identical server session must not erase unsubmitted answers
    // on this device. A different/altered session or a final score clears them.
    setAnswers(current=>retainPhase6LocalSelections(state,next,current));
    setState(next);setConfirmSubmit(false);
    setResult(next.result??null);
    if(next.result&&next.session)
      setUnconfirmedSubmitId(prev=>prev===next.session?.sessionId?null:prev);
    sync.current=next.session?{
      serverNow:next.session.serverNow,receivedAt:performance.now(),
    }:null;
  };
  const run=async(action:()=>Promise<void>)=>{
    if(busyRef.current)return;
    busyRef.current=true;setBusy(true);setNotice('');setFailed(false);
    try{await action();}
    catch(error){
      setFailed(true);
      setNotice(error instanceof Error?error.message:
        'Không thể kết nối máy chủ thi DEMO.');
    }finally{busyRef.current=false;setBusy(false);}
  };
  const session=state?.session;
  void tick;
  const remaining=session&&sync.current
    ?getPhase6RemainingSeconds(session.expiresAt,sync.current.serverNow,
      sync.current.receivedAt,performance.now())
    :0;
  const allAnswered=!!state?.topic&&state.topic.questions.length>0&&
    state.topic.questions.every(q=>Number.isSafeInteger(answers[q.id])&&
      answers[q.id]>=0&&answers[q.id]<=3);
  const unconfirmed=!!session&&unconfirmedSubmitId===session.sessionId;
  const disabled=busy||!session||!!result||remaining<=0||unconfirmed;
  return (
    <section className="space-y-3 rounded-xl border border-[#BCD5C5] bg-[#F2F9F3] p-4"
      aria-label="Bài thi toán học DEMO Phase 6D">
      <h3 className="font-bold text-[#152019]">Phase 6D — Thi toán học DEMO có thời hạn</h3>
      <p className="text-xs text-[#475569]">
        Chỉ dữ liệu toán học giả. Thời hạn và điểm do Cloudflare D1 quyết định.
        Đồng hồ trên màn hình chỉ để tham khảo, không kéo dài hạn nộp ở máy chủ.
        Mỗi học viên có một lần nộp cho mỗi phiên bản đề.
        Đáp án chưa nộp chỉ nằm trên thiết bị này: không đồng bộ sang điện thoại,
        máy tính khác hay khôi phục khi đóng trang. Đồng bộ phiên không đặt lại giờ.
      </p>
      <button className={button} type="button" disabled={busy}
        onClick={()=>void run(async()=>{
          const items=await listPhase6Exams(user);setTopics(items);setChosen(null);
          setState(null);setResult(null);setAnswers({});
          setNotice('Đã tải '+items.length+' đề toán học DEMO đã xuất bản.');
        })}>Tải danh sách đề thi DEMO</button>
      {topics!==null&&(
        <div className="space-y-2 rounded-lg border border-[#DDE3DC] bg-white p-3">
          {topics.length===0&&<p className="text-xs">
            Chưa có phiên bản đề DEMO nào được xuất bản trên D1 Preview.
          </p>}
          {topics.map(t=>(
            <div key={t.topicId+'-'+t.revision}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-[#F5F7F5] p-2">
              <div className="text-xs">
                <p className="font-semibold">{t.title}</p>
                <p>Phiên bản {t.revision} · {t.questionCount} câu · {t.timeLimitSeconds/60} phút</p>
              </div>
              <button className={button} type="button" disabled={busy}
                onClick={()=>void run(async()=>{
                  const next=await readPhase6Exam(user,t);
                  setChosen(t);setExam(next);
                  setNotice(next.session?'Đã khôi phục phiên thi từ máy chủ.':
                    'Chưa bắt đầu phiên thi. Bấm Bắt đầu để máy chủ ấn định giờ.');
                })}>Mở đề</button>
            </div>
          ))}
        </div>
      )}
      {chosen&&(
        <div className="space-y-3 rounded-lg border border-[#DDE3DC] bg-white p-3">
          <p className="text-xs font-semibold">
            {chosen.title} · phiên bản {chosen.revision}
          </p>
          {!session?(
            <div className="flex flex-wrap gap-2">
              <button className={button} type="button" disabled={busy}
                onClick={()=>void run(async()=>{
                  const started=await startPhase6Exam(user,chosen);
                  if(!started.session)throw new Error('Không nhận được phiên thi từ D1.');
                  setExam(started);setNotice('Máy chủ đã bắt đầu tính giờ.');
                })}>Bắt đầu làm bài (máy chủ tính giờ)</button>
              <button className={button} type="button" disabled={busy}
                onClick={()=>void run(async()=>{
                  const recovered=await readPhase6Exam(user,chosen);
                  setExam(recovered);
                  setNotice(recovered.session
                    ? 'Đã khôi phục phiên từ D1, thời gian không bắt đầu lại.'
                    : 'D1 chưa ghi nhận phiên đã bắt đầu. Có thể bấm Bắt đầu.');
                })}>Đọc lại phiên từ D1 (sau mất mạng)</button>
            </div>
          ):(
            <>
              <p className="text-sm font-semibold tabular-nums">
                Còn lại: {Math.floor(remaining/60)}:{String(remaining%60).padStart(2,'0')}
              </p>
              {unconfirmed&&!result&&(
                <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs font-semibold text-amber-900">
                  Chưa xác định bài nộp đã được lưu hay chưa. Hãy bấm Đọc lại kết quả từ D1
                  trước khi thử nộp lại. Không có thao tác nộp tự động.
                </p>
              )}
              {result?(
                <div className="rounded-md bg-[#E9F7EC] p-3 text-sm">
                  Đã nộp: {result.score}/{result.maxScore} điểm ·
                  {result.correctCount}/{result.totalCount} câu đúng.
                </div>
              ):remaining===0?(
                <p className="text-xs font-semibold text-red-700">
                  Thời gian hiển thị đã hết. Nếu từng nộp nhưng mất phản hồi,
                  hãy bấm Đọc kết quả từ D1. Không tự động gửi lại bài.
                </p>
              ):(
                <>
                  {state?.topic?.questions.map(q=>(
                    <fieldset className="space-y-2 rounded-md border border-[#E2E8F0] p-3"
                      disabled={disabled} key={q.id}>
                      <legend className="text-sm font-semibold">{q.orderIndex}. {q.text}</legend>
                      {q.options.map((option,index)=>(
                        <label key={index} className="flex items-center gap-2 text-xs">
                          <input type="radio" name={'p6-'+q.id} value={index}
                            checked={answers[q.id]===index}
                            onChange={()=>setAnswers(prev=>({...prev,[q.id]:index}))}/>
                          <span>{String.fromCharCode(65+index)}. {option}</span>
                        </label>
                      ))}
                    </fieldset>
                  ))}
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" disabled={disabled} checked={confirmSubmit}
                      onChange={e=>setConfirmSubmit(e.target.checked)}/>
                    Xác nhận nộp bài DEMO, không thể chỉnh sửa sau khi máy chủ lưu điểm
                  </label>
                  <button className={button} type="button"
                    disabled={disabled||!allAnswered||!confirmSubmit}
                    onClick={()=>void run(async()=>{
                      setUnconfirmedSubmitId(session.sessionId);
                      setConfirmSubmit(false);
                      try{
                        const score=await submitPhase6Exam(user,session,answers);
                        setResult(score);setAnswers({});
                        setUnconfirmedSubmitId(prev=>prev===session.sessionId?null:prev);
                        setNotice('Điểm đã được máy chủ xác nhận và lưu trên D1.');
                      }catch{
                        // POST may already have been committed when the response vanished.
                        // Never retry automatically or expose raw server error details.
                        throw new Error('Chưa xác định bài đã được lưu. Bấm Đọc lại kết quả từ D1 trước khi nộp lại.');
                      }
                    })}>Nộp bài lên máy chủ để chấm điểm</button>
                </>
              )}
              <button className={button} type="button" disabled={busy}
                onClick={()=>void run(async()=>{
                  const stored=await readPhase6ExamResult(user,chosen);
                  if(stored){
                    setResult(stored);setAnswers({});setConfirmSubmit(false);
                  }else if(!result){
                    // A verified empty D1 read permits a new *manual* attempt.
                    // The server still enforces one immutable grade per session.
                    setConfirmSubmit(false);
                  }
                  setUnconfirmedSubmitId(prev=>prev===session.sessionId?null:prev);
                  setNotice(stored?'Đã đọc điểm đã lưu từ D1.':
                    'D1 chưa ghi nhận bài nộp. Nếu còn giờ, hãy xác nhận và nộp thủ công.');
                })}>Đọc lại kết quả từ D1</button>
              <button className={button} type="button" disabled={busy}
                onClick={()=>void run(async()=>{
                  setExam(await readPhase6Exam(user,chosen));
                  setNotice('Đã cập nhật phiên và thời gian từ D1. Đáp án chưa nộp chỉ giữ trên thiết bị này khi phiên không đổi.');
                })}>Đồng bộ phiên thi</button>
            </>
          )}
        </div>
      )}
      {notice&&<p role="status"
        className={'text-xs '+(failed?'text-red-700':'text-green-800')}>
        {notice}
      </p>}
    </section>
  );
};
