import React from 'react';
import type {Phase5DemoTopic,Phase5DemoTopicSummary}
  from '../utils/phase5DemoTopics';
import type {Phase5DemoAnswerMap,Phase5SyntheticAttempt}
  from '../utils/phase5SyntheticSubmission';
import type {SyntheticQuizReceipt}
  from '../utils/syntheticQuizSubmissionRecovery';

interface Props {
  onList:()=>Promise<Phase5DemoTopicSummary[]>;
  onRead:(topicId:string,revision:number)=>Promise<Phase5DemoTopic>;
  // These props are OMITTED entirely unless the separate compile-time
  // Preview-only submit UI flag has been explicitly enabled.
  onSubmit?:(
    answers:Phase5DemoAnswerMap,questionIds:readonly string[]
  )=>Promise<SyntheticQuizReceipt<Phase5SyntheticAttempt>>;
  onReadOwn?:()=>Promise<Phase5SyntheticAttempt|null>;
}

type SubmissionState='inactive'|'checking'|'ready'|'unavailable';
const attemptText=(r:Phase5SyntheticAttempt)=>
  `Điểm Phase 5 DEMO: ${r.score}/${r.maxScore} (${r.correctCount}/${r.totalCount} câu đúng, đã lưu tại D1).`;

// Preview-only UI. When submit callbacks are absent, the old read-only view
// is preserved exactly. No Admin API, no answer keys or real exam content.
export const Phase5DemoTopicPanel:React.FC<Props>=({
  onList,onRead,onSubmit,onReadOwn,
})=>{
  const [busy,setBusy]=React.useState(false);
  const busyRef=React.useRef(false);
  const [topics,setTopics]=React.useState<Phase5DemoTopicSummary[]|null>(null);
  const [current,setCurrent]=React.useState<Phase5DemoTopic|null>(null);
  const [answers,setAnswers]=React.useState<Phase5DemoAnswerMap>({});
  const [attempt,setAttempt]=React.useState<Phase5SyntheticAttempt|null>(null);
  const [submissionState,setSubmissionState]=React.useState<SubmissionState>('inactive');
  const [notice,setNotice]=React.useState('');
  const [error,setError]=React.useState(false);

  const canGrade=!!onSubmit&&!!onReadOwn &&
    current?.topicId==='p5_demo_math'&&current.revision===1;
  const allAnswered=!!current&&
    current.questions.every(q=>Number.isInteger(answers[q.id])&&
      answers[q.id]>=0&&answers[q.id]<=3);

  const run=async(task:()=>Promise<void>)=>{
    if(busyRef.current)return;
    busyRef.current=true;
    setBusy(true);
    setError(false);
    setNotice('');
    try{await task();}
    catch(cause){
      setError(true);
      setNotice(cause instanceof Error?cause.message:
        'Không thể kết nối đến D1. Hãy kiểm tra kết quả đã lưu trước khi làm lại.');
    }finally{busyRef.current=false;setBusy(false);}
  };

  return (
    <section className="space-y-3 rounded-xl border border-[#CBD5E1] bg-[#F7FAFC] p-3"
      aria-label="Đọc chuyên đề toán học DEMO Phase 5 từ D1">
      <p className="text-sm font-bold text-[#152019]">
        Chuyên đề Phase 5 — đọc trực tiếp từ Cloudflare D1
      </p>
      <p className="text-xs leading-relaxed text-[#475569]">
        Chỉ dành cho tài khoản học viên DEMO trên Preview. Hiển thị
        chuyên đề toán học giả đã xuất bản và các lựa chọn trả lời.
        {!onSubmit || !onReadOwn
          ?' Không gửi đáp án, không nộp bài, không chấm điểm hoặc ghi dữ liệu.'
          :' Chỉ một bài nộp mỗi học viên; máy chủ tự chấm và giữ điểm bất biến.'}
      </p>
      <button type="button" disabled={busy}
        onClick={()=>void run(async()=>{
          const items=await onList();
          setTopics(items);
          setCurrent(null);
          setAnswers({});
          setAttempt(null);
          setSubmissionState('inactive');
          setNotice(`Đã đọc ${items.length} chuyên đề DEMO từ D1.`);
        })}
        className="rounded-md border border-[#1F4D36] bg-white px-3 py-2 text-xs font-semibold text-[#1F4D36] disabled:opacity-50">
        Tải danh sách chuyên đề Phase 5
      </button>
      {topics!==null && (
        <div className="space-y-2 rounded-lg border border-[#DDE3DC] bg-white p-3">
          <p className="text-xs font-semibold">
            Chuyên đề đã xuất bản: {topics.length}
          </p>
          {topics.length===0 && (
            <p className="text-xs text-[#475569]">
              Chưa có chuyên đề DEMO nào để đọc.
            </p>
          )}
          {topics.map(item=>(
            <div key={item.topicId+'-'+item.revision}
              className="space-y-1 rounded-md bg-[#F5F7F5] p-2">
              <p className="text-xs font-semibold">{item.title}</p>
              <p className="text-xs text-[#475569]">
                Phiên bản {item.revision} · {item.questionCount} câu hỏi
              </p>
              <button type="button" disabled={busy}
                onClick={()=>void run(async()=>{
                  setSubmissionState('inactive');
                  setAttempt(null);
                  setAnswers({});
                  setCurrent(null);
                  const topic=await onRead(item.topicId,item.revision);
                  setCurrent(topic);
                  setNotice('Đã tải câu hỏi DEMO từ D1 (chỉ đọc).');
                  if(onSubmit&&onReadOwn&&
                     topic.topicId==='p5_demo_math'&&topic.revision===1){
                    // Read server state BEFORE enabling any submit action.
                    // If this fails, fail closed: no grade can be submitted.
                    setSubmissionState('unavailable');
                    const saved=await onReadOwn();
                    setAttempt(saved);
                    setSubmissionState('ready');
                    setNotice(saved?
                      'D1 đã lưu kết quả của học viên này. '+attemptText(saved):
                      'Đã đọc câu hỏi và xác nhận chưa có điểm Phase 5 tại D1.');
                  }
                })}
                className="rounded-md border border-[#1F4D36] bg-white px-3 py-2 text-xs font-semibold text-[#1F4D36] disabled:opacity-50">
                Xem câu hỏi từ D1
              </button>
            </div>
          ))}
        </div>
      )}
      {current && (
        <div className="space-y-3 rounded-lg border border-[#DDE3DC] bg-white p-3">
          <p className="text-xs font-semibold">{current.title} — bản {current.revision}</p>
          {current.questions.map((item,index)=>(
            <fieldset className="space-y-1" key={item.id}>
              <legend className="text-xs font-semibold">Câu {index+1}: {item.text}</legend>
              {canGrade ? (
                <div className="space-y-1">
                  {item.options.map((option,i)=>(
                    <label key={i} className="flex items-center gap-2 text-xs">
                      <input type="radio" name={'phase5-answer-'+item.id}
                        checked={answers[item.id]===i}
                        onChange={()=>setAnswers(a=>({...a,[item.id]:i}))}
                        disabled={busy||submissionState!=='ready'||!!attempt}/>
                      <span>{String.fromCharCode(65+i)}. {option}</span>
                    </label>
                  ))}
                </div>
              ):(
                <div className="space-y-1">
                  {item.options.map((option,i)=>(
                    <p className="text-xs" key={i}>
                      {String.fromCharCode(65+i)}. {option}
                    </p>
                  ))}
                </div>
              )}
            </fieldset>
          ))}
          {canGrade?(
            <div className="space-y-2">
              <button type="button"
                disabled={busy||!!attempt||submissionState!=='ready'||!allAnswered}
                onClick={()=>void run(async()=>{
                  if(!onSubmit||!current||submissionState!=='ready'||attempt||
                    !allAnswered)return;
                  // Once a POST is attempted, NEVER enable a second POST
                  // from this panel if the network or response is uncertain.
                  setSubmissionState('unavailable');
                  const receipt=await onSubmit(
                    answers,current.questions.map(q=>q.id)
                  );
                  setAttempt(receipt.attempt);
                  setSubmissionState('ready');
                  setNotice(
                    receipt.disposition==='new'?
                      'Đã nộp bài DEMO mới. '+attemptText(receipt.attempt):
                    receipt.disposition==='existing'?
                      'Điểm đã lưu trước đó được giữ nguyên. '+attemptText(receipt.attempt):
                      'Phản hồi nộp bài bị gián đoạn nhưng đã đọc được điểm tại D1. '+
                        attemptText(receipt.attempt)
                  );
                })}
                className="rounded-md bg-[#1F4D36] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                Nộp bài Phase 5 — máy chủ tự chấm
              </button>
              <button type="button" disabled={busy}
                onClick={()=>void run(async()=>{
                  if(!onReadOwn)return;
                  const saved=await onReadOwn();
                  setAttempt(saved);
                  if(saved){
                    setSubmissionState('ready');
                    setNotice('Đã đọc kết quả Phase 5 từ D1. '+attemptText(saved));
                  }else{
                    // A missing result after an ambiguous POST is NOT proof
                    // that it is safe to submit again.
                    if(submissionState==='ready')
                      setNotice('Chưa có kết quả Phase 5 của tài khoản này.');
                    else
                      setNotice('Chưa xác nhận được bài nộp. Không bấm nộp lại; hãy kiểm tra sau.');
                  }
                })}
                className="rounded-md border border-[#1F4D36] bg-white px-3 py-2 text-xs font-semibold text-[#1F4D36] disabled:opacity-50">
                Đọc lại điểm Phase 5 từ D1
              </button>
              {attempt && (
                <p className="text-xs font-semibold text-[#166534]">
                  {attemptText(attempt)}
                </p>
              )}
              {submissionState==='unavailable' && !attempt && (
                <p className="text-xs text-[#9A3412]">
                  Chưa xác nhận được trạng thái D1. Chỉ dùng nút đọc lại điểm;
                  không gửi lại bài khi mạng chập chờn.
                </p>
              )}
              <p className="text-xs text-[#475569]">
                Chỉ thử nghiệm toán học giả. Không có chức năng sửa điểm hoặc nộp lần hai.
              </p>
            </div>
          ):(
            <p className="text-xs text-[#475569]">
              Chế độ xem trước: chưa cho nộp bài hay ghi kết quả Phase 5.
            </p>
          )}
        </div>
      )}
      {notice&&(
        <p role="status" className={`text-xs ${error?'text-[#B91C1C]':'text-[#166534]'}`}>
          {notice}
        </p>
      )}
    </section>
  );
};
