import React from 'react';
import type {
  SyntheticQuizQuestion,SyntheticQuizAttempt,SyntheticQuizAdminAttempt,
} from '../utils/syntheticGradedQuiz';
import type {StagingD1PreflightReport} from '../utils/stagingD1Preflight';
import type {SyntheticQuizReceipt} from '../utils/syntheticQuizSubmissionRecovery';

interface Props {
  onGetQuestion?:()=>Promise<SyntheticQuizQuestion>;
  onSubmit?:(answerIndex:number)=>Promise<SyntheticQuizReceipt<SyntheticQuizAttempt>>;
  onReadOwn?:()=>Promise<SyntheticQuizAttempt|null>;
  onAdminList?:()=>Promise<SyntheticQuizAdminAttempt[]>;
  onAdminPreflight?:()=>Promise<StagingD1PreflightReport>;
}

// A visibly labelled, staging-only UI proving the server owns the grade and
// D1 stores it across browsers. Does not interact with the real quiz flow.
export const StagingDemoQuizPanel:React.FC<Props>=({
  onGetQuestion,onSubmit,onReadOwn,onAdminList,onAdminPreflight,
})=>{
  const [busy,setBusy]=React.useState(false);
  const [question,setQuestion]=React.useState<SyntheticQuizQuestion|null>(null);
  const [selected,setSelected]=React.useState<number|null>(null);
  const [own,setOwn]=React.useState<SyntheticQuizAttempt|null>(null);
  const [rows,setRows]=React.useState<SyntheticQuizAdminAttempt[]|null>(null);
  const [preflight,setPreflight]=React.useState<StagingD1PreflightReport|null>(null);
  const [notice,setNotice]=React.useState('');
  const [isError,setIsError]=React.useState(false);
  const execute=async(fn:()=>Promise<void>)=>{
    if(busy)return;
    setBusy(true);
    setNotice('');
    setIsError(false);
    try{await fn();}
    catch(error){
      setIsError(true);
      setNotice(error instanceof Error?error.message:
        'Không thể kiểm tra dữ liệu DEMO từ D1.');
    }finally{setBusy(false);}
  };
  const resultText=(result:SyntheticQuizAttempt)=>
    `Điểm DEMO: ${result.score}/${result.maxScore} (do máy chủ chấm, đã lưu trên D1).`;
  return (
    <section className="space-y-3 rounded-xl border border-[#BDD7C5] bg-[#F2F9F3] p-3"
      aria-label="Bài kiểm tra DEMO chấm tại máy chủ">
      <p className="text-sm font-bold text-[#152019]">
        Bài kiểm tra DEMO — chấm trên Cloudflare D1
      </p>
      <p className="text-xs leading-relaxed text-[#4B5B50]">
        Chỉ có 1 câu hỏi giả. Học viên chọn đáp án, máy chủ chấm và
        lưu 1 lượt duy nhất theo UID. Admin có thể xem trên thiết bị khác.
        Không dùng điểm thi, danh tính hay bộ đề thực tế. Chức năng đang khóa
        trên staging cho đến khi bật cờ phía máy chủ và tạo bảng thử riêng.
      </p>
      {onGetQuestion && onSubmit && onReadOwn && (
        <div className="space-y-2 rounded-lg border border-[#DDE3DC] bg-white p-3">
          <p className="text-xs font-semibold">Dành cho học viên DEMO</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={()=>void execute(async()=>{
              setQuestion(await onGetQuestion());setSelected(null);
              setNotice('Đã tải câu hỏi giả từ Cloudflare Functions.');
            })}
              className="rounded-md border border-[#1F4D36] px-3 py-2 text-xs font-semibold text-[#1F4D36] disabled:opacity-50">
              Tải câu hỏi DEMO
            </button>
            <button type="button" disabled={busy} onClick={()=>void execute(async()=>{
              const saved=await onReadOwn();setOwn(saved);
              setNotice(saved?resultText(saved):'Chưa nộp bài DEMO ở tài khoản này.');
            })}
              className="rounded-md border border-[#1F4D36] px-3 py-2 text-xs font-semibold text-[#1F4D36] disabled:opacity-50">
              Đọc kết quả từ D1
            </button>
          </div>
          {question && (
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold">{question.text}</legend>
              {question.options.map((option,index)=>(
                <label key={index} className="flex items-center gap-2 text-xs">
                  <input type="radio" name="demo-graded-answer"
                    checked={selected===index}
                    onChange={()=>setSelected(index)}
                    disabled={busy||!!own}/>
                  <span>{option}</span>
                </label>
              ))}
              <button type="button" disabled={busy||selected===null||!!own}
                onClick={()=>void execute(async()=>{
                  if(selected===null)return;
                  const receipt=await onSubmit(selected);setOwn(receipt.attempt);
                  if(receipt.disposition==='new')
                    setNotice('Đã nộp bài DEMO mới. '+resultText(receipt.attempt));
                  else if(receipt.disposition==='existing')
                    setNotice('Đã có bài DEMO được lưu từ trước; điểm cũ được giữ nguyên. '+resultText(receipt.attempt));
                  else
                    setNotice('Không nhận được phản hồi nộp bài, nhưng đã tìm thấy kết quả trong D1; có thể từ phiên khác. '+resultText(receipt.attempt));
                })}
                className="rounded-md bg-[#1F4D36] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                Nộp bài — máy chủ tự chấm
              </button>
            </fieldset>
          )}
          {own && <p className="text-xs font-semibold text-[#166534]">
            {resultText(own)}
          </p>}
        </div>
      )}
      {(onAdminList||onAdminPreflight) && (
        <div className="space-y-2 rounded-lg border border-[#DDE3DC] bg-white p-3">
          <p className="text-xs font-semibold">Dành cho Google Admin staging</p>
          {onAdminList && <button type="button" disabled={busy} onClick={()=>void execute(async()=>{
            const result=await onAdminList();setRows(result);
            setNotice(`Đã lấy ${result.length} kết quả giả từ D1 máy chủ.`);
          })}
            className="rounded-md border border-[#1F4D36] px-3 py-2 text-xs font-semibold text-[#1F4D36] disabled:opacity-50">
            Xem kết quả học viên DEMO từ D1
          </button>}
          {onAdminPreflight && <button type="button" disabled={busy}
            onClick={()=>void execute(async()=>{
              const result=await onAdminPreflight();setPreflight(result);
              setNotice('Đã đọc tình trạng cấu trúc D1. Không có thay đổi nào được thực hiện.');
            })}
            className="rounded-md border border-[#1F4D36] px-3 py-2 text-xs font-semibold text-[#1F4D36] disabled:opacity-50">
            Kiểm tra cấu trúc D1 (chỉ đọc)
          </button>}
          {preflight && <div className="rounded-lg border border-[#DDE3DC] bg-[#F5F7F5] p-2 text-xs space-y-1">
            <p className="font-semibold">Trạng thái: {preflight.status==='BLOCKED'?'Cần xử lý lỗi cấu trúc':preflight.status==='SYNTHETIC_SCHEMA_PRESENT'?'Đã có bảng điểm DEMO':'Chưa tạo bảng điểm DEMO'}</p>
            <p>Bảng kết quả giả: {preflight.synthetic.exists?'Đã tồn tại':'Chưa tồn tại'}; số lượt: {preflight.synthetic.rowCount??'Chưa xác định'}</p>
            <p>Học viên DEMO: {preflight.existingRowCounts.demo_students??'Không có bảng'}; bản ghi đăng nhập thử: {preflight.existingRowCounts.login_attempts??'Không có bảng'}; tài khoản đơn vị thử: {preflight.existingRowCounts.unit_accounts??'Không có bảng'}</p>
            <p className="font-semibold text-[#9A3412]">Chưa được phép triển khai: phải có bản sao lưu mới và phê duyệt riêng.</p>
          </div>}
          {rows && <div className="space-y-1">
            {rows.length===0 && <p className="text-xs">Chưa có kết quả DEMO.</p>}
            {rows.map(r=>(
              <p key={r.username} className="break-all rounded bg-[#F5F7F5] p-2 text-xs">
                <span className="font-mono">{r.username}</span>
                {' — '}{r.score}/{r.maxScore} điểm
              </p>
            ))}
          </div>}
        </div>
      )}
      {notice&&<p role="status"
        className={`text-xs ${isError?'text-[#B91C1C]':'text-[#166534]'}`}>
        {notice}
      </p>}
    </section>
  );
};
