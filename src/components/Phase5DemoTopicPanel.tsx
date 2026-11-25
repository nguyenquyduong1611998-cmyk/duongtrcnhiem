import React from 'react';
import type {Phase5DemoTopic,Phase5DemoTopicSummary}
  from '../utils/phase5DemoTopics';

interface Props {
  onList:()=>Promise<Phase5DemoTopicSummary[]>;
  onRead:(topicId:string,revision:number)=>Promise<Phase5DemoTopic>;
}

// A read-only demonstration panel. Never sends answers or grades; no Admin API.
// Every button fetches from server using the current Firebase DEMO login.
export const Phase5DemoTopicPanel:React.FC<Props>=({onList,onRead})=>{
  const [busy,setBusy]=React.useState(false);
  const [topics,setTopics]=React.useState<Phase5DemoTopicSummary[]|null>(null);
  const [current,setCurrent]=React.useState<Phase5DemoTopic|null>(null);
  const [notice,setNotice]=React.useState('');
  const [error,setError]=React.useState(false);

  const run=async(task:()=>Promise<void>)=>{
    if(busy)return;
    setBusy(true);
    setError(false);
    setNotice('');
    try{await task();}
    catch(cause){
      setError(true);
      setNotice(cause instanceof Error?cause.message:
        'Không thể đọc chuyên đề DEMO trên D1.');
    }finally{setBusy(false);}
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
        Không gửi đáp án, không nộp bài, không chấm điểm hoặc ghi dữ liệu.
      </p>
      <button type="button" disabled={busy}
        onClick={()=>void run(async()=>{
          const items=await onList();
          setTopics(items);
          setCurrent(null);
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
                  const topic=await onRead(item.topicId,item.revision);
                  setCurrent(topic);
                  setNotice('Đã tải câu hỏi DEMO từ D1 (chỉ đọc).');
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
            <div className="space-y-1" key={item.id}>
              <p className="text-xs font-semibold">Câu {index+1}: {item.text}</p>
              <div className="space-y-1">
                {item.options.map((option,i)=>(
                  <p className="text-xs" key={i}>
                    {String.fromCharCode(65+i)}. {option}
                  </p>
                ))}
              </div>
            </div>
          ))}
          <p className="text-xs text-[#475569]">
            Chế độ xem trước: chưa cho nộp bài hay ghi kết quả Phase 5.
          </p>
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
