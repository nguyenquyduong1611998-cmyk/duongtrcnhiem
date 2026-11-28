import React from 'react';
import type {User} from 'firebase/auth';
import {
  PHASE6_TITLES,PHASE6_TEMPLATES,listPhase6Drafts,getPhase6Draft,
  createPhase6Draft,savePhase6Draft,deletePhase6Draft,publishPhase6Draft,
} from '../utils/phase6AdminDrafts';
import {PHASE6_TIME_PRESETS,isValidPhase6Minutes} from '../utils/phase6ExamTime';
import type {
  Phase6AdminDraft,Phase6DraftSummary,Phase6TitleCode,Phase6TemplateCode,
} from '../utils/phase6AdminDrafts';

interface Props {user:User|null;canPublish?:boolean;}
const button='rounded-md border border-[#1F4D36] bg-white px-3 py-2 text-xs font-semibold text-[#1F4D36] disabled:opacity-40';
const input='w-full rounded-md border border-[#B9C8BB] bg-white p-2 text-sm text-[#152019]';

// Phase 6B: staging Google Admin ONLY, rendered behind an explicit Vite flag.
// All content is synthetic arithmetic; publishing and real-text input are absent.
// Server independently verifies the signed Google Admin token on every operation.
export const Phase6AdminDraftsPanel:React.FC<Props>=({user,canPublish=false})=>{
  const [drafts,setDrafts]=React.useState<Phase6DraftSummary[]|null>(null);
  const [selected,setSelected]=React.useState<Phase6AdminDraft|null>(null);
  const [titleCode,setTitleCode]=React.useState<Phase6TitleCode>('basic');
  const [minutes,setMinutes]=React.useState(15);
  const [templates,setTemplates]=React.useState<Phase6TemplateCode[]>([]);
  const [newTemplate,setNewTemplate]=React.useState<Phase6TemplateCode>('sum_2_2');
  const [confirmDelete,setConfirmDelete]=React.useState(false);
  const [confirmPublish,setConfirmPublish]=React.useState(false);
  const [publishedRevision,setPublishedRevision]=React.useState<number|null>(null);
  const [busy,setBusy]=React.useState(false);
  const busyRef=React.useRef(false);
  const [notice,setNotice]=React.useState('');
  const [failed,setFailed]=React.useState(false);
  const setEditor=(draft:Phase6AdminDraft)=>{
    setSelected(draft);setTitleCode(draft.titleCode);setMinutes(draft.minutes);
    setTemplates([...draft.templates]);setConfirmDelete(false);
    setConfirmPublish(false);setPublishedRevision(null);
  };
  const run=async(action:()=>Promise<void>)=>{
    if(busyRef.current)return;
    busyRef.current=true;setBusy(true);setNotice('');setFailed(false);
    try{await action();}
    catch(error){
      setFailed(true);
      setNotice(error instanceof Error?error.message:'Không thể quản lý bản nháp DEMO.');
    }finally{busyRef.current=false;setBusy(false);}
  };
  const refresh=async()=>setDrafts(await listPhase6Drafts(user));
  const validTime=isValidPhase6Minutes(minutes);
  const unsaved=!!selected&&(titleCode!==selected.titleCode||minutes!==selected.minutes||
    templates.join('|')!==selected.templates.join('|'));
  const draftTitle=PHASE6_TITLES.find(x=>x.code===titleCode)?.label??'Toán học DEMO';
  return (
    <section className="space-y-3 rounded-xl border border-[#BDD7C5] bg-[#F2F9F3] p-4"
      aria-label="Giai đoạn 6B - quản lý đề giả ở D1 Preview">
      <p className="text-sm font-bold text-[#152019]">
        Giai đoạn 6B — Ngân hàng đề nháp DEMO
      </p>
      <p className="text-xs leading-relaxed text-[#4B5B50]">
        Chỉ Google Admin trên Preview. Tạo và sửa đề toán học giả trong D1;
        các câu hỏi lấy từ mẫu cố định, không thể nhập thông tin nội bộ.
        Đề chưa xuất bản, học viên không thấy và không thể dùng để thi có điểm.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={busy}
          onClick={()=>void run(async()=>{
            await refresh();setNotice('Đã tải danh sách bản nháp DEMO từ D1 Preview.');
          })}>Tải danh sách bản nháp</button>
        <button type="button" className={button} disabled={busy||!validTime}
          onClick={()=>void run(async()=>{
            const created=await createPhase6Draft(user,titleCode,minutes);
            setEditor(created);await refresh();
            setNotice('Đã tạo bản nháp DEMO mới. Chưa được xuất bản.');
          })}>Tạo đề nháp mới</button>
      </div>
      {drafts!==null&&(
        <div className="space-y-2 rounded-lg border border-[#DDE3DC] bg-white p-3">
          <p className="text-xs font-semibold">Bản nháp DEMO: {drafts.length}</p>
          {drafts.length===0&&<p className="text-xs">Chưa có bản nháp nào.</p>}
          {drafts.map(item=>(
            <div key={item.draftId} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-[#F5F7F5] p-2">
              <div className="text-xs">
                <p className="font-semibold">{item.title}</p>
                <p>{item.minutes} phút · {item.questionCount} câu · bản sửa {item.version}</p>
              </div>
              <button type="button" className={button} disabled={busy}
                onClick={()=>void run(async()=>{
                  setEditor(await getPhase6Draft(user,item.draftId));
                  setNotice('Đang chỉnh sửa bản nháp DEMO đã chọn.');
                })}>Chỉnh sửa</button>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-3 rounded-lg border border-[#DDE3DC] bg-white p-3">
        <p className="text-xs font-semibold">
          {selected?'Chỉnh sửa bản nháp · phiên bản '+selected.version:'Thông số cho đề nháp mới'}
        </p>
        <label className="block space-y-1 text-xs">
          <span className="font-semibold">Tên chuyên đề DEMO</span>
          <select className={input} disabled={busy} value={titleCode}
            onChange={event=>setTitleCode(event.target.value as Phase6TitleCode)}>
            {PHASE6_TITLES.map(item=><option key={item.code} value={item.code}>{item.label}</option>)}
          </select>
        </label>
        <label className="block space-y-1 text-xs">
          <span className="font-semibold">Thời gian làm bài (1–240 phút)</span>
          <input className={input} disabled={busy} type="number" min={1} max={240}
            step={1} value={minutes} onChange={event=>setMinutes(Number(event.target.value))}/>
        </label>
        <div role="group" aria-label="Chọn nhanh thời gian làm bài"
          className="flex flex-wrap gap-2">
          {PHASE6_TIME_PRESETS.map(value=>(
            <button key={value} type="button" disabled={busy}
              aria-pressed={minutes===value}
              className={button+(minutes===value?' border-[#1F4D36] bg-[#E9F7EC]':'')}
              onClick={()=>{setMinutes(value);setConfirmPublish(false);}}>
              {value} phút
            </button>
          ))}
        </div>
        <p className={'text-xs '+(validTime?'text-[#4B5B50]':'text-red-700')}
          role="status">
          {validTime
            ? 'Thời gian '+minutes+' phút chỉ áp dụng cho bản nháp DEMO sau khi lưu và xuất bản phiên bản mới. Phiên thi đã bắt đầu không được kéo dài.'
            : 'Hãy nhập số phút nguyên từ 1 đến 240 trước khi lưu đề DEMO.'}
        </p>
        {selected&&(
          <>
            <div className="space-y-2">
              <p className="text-xs font-semibold">
                Câu hỏi toán học giả ({templates.length}/12)
              </p>
              {templates.map((code,index)=>(
                <div key={index} className="flex flex-wrap items-center gap-2 rounded-md bg-[#F5F7F5] p-2">
                  <span className="text-xs">{index+1}. {PHASE6_TEMPLATES.find(t=>t.code===code)?.label}</span>
                  <button type="button" disabled={busy||index===0} className={button}
                    onClick={()=>setTemplates(prev=>{
                      const out=[...prev];[out[index-1],out[index]]=[out[index],out[index-1]];
                      return out;
                    })}>Lên</button>
                  <button type="button" disabled={busy||index===templates.length-1}
                    className={button} onClick={()=>setTemplates(prev=>{
                      const out=[...prev];[out[index],out[index+1]]=[out[index+1],out[index]];
                      return out;
                    })}>Xuống</button>
                  <button type="button" disabled={busy} className={button}
                    onClick={()=>setTemplates(prev=>prev.filter((_,i)=>i!==index))}>Bỏ câu</button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                <select aria-label="Chọn câu toán giả" value={newTemplate}
                  disabled={busy} className={input}
                  onChange={e=>setNewTemplate(e.target.value as Phase6TemplateCode)}>
                  {PHASE6_TEMPLATES.map(t=><option key={t.code} value={t.code}>{t.label}</option>)}
                </select>
                <button type="button" disabled={busy||templates.length>=12}
                  className={button}
                  onClick={()=>setTemplates(prev=>prev.length<12?[...prev,newTemplate]:prev)}>
                  Thêm câu mẫu
                </button>
              </div>
            </div>
            <button type="button" disabled={busy||!validTime} className={button}
              onClick={()=>void run(async()=>{
                const next=await savePhase6Draft(user,selected,titleCode,minutes,templates);
                setEditor(next);await refresh();
                setNotice('Đã lưu bản nháp '+draftTitle+'. Chưa xuất bản.');
              })}>Lưu thay đổi vào D1 Preview</button>
            {canPublish&&(
              <div className="space-y-2 rounded-lg border border-[#94A3B8] p-3">
                <p className="text-xs font-semibold">6C — Duyệt xuất bản bản toán học DEMO</p>
                <p className="text-xs">
                  Hãy lưu mọi thay đổi trước. Phiên bản đã xuất bản không thể sửa
                  hoặc thu hồi bằng chức năng này. Học viên chưa có API Phase 6D để làm đề.
                </p>
                {unsaved&&<p className="text-xs text-amber-700">
                  Bạn có thay đổi chưa lưu. Hãy bấm Lưu thay đổi trước khi xuất bản.
                </p>}
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={confirmPublish} disabled={busy}
                    onChange={e=>setConfirmPublish(e.target.checked)}/>
                  Tôi xác nhận đây chỉ là đề toán DEMO và đã kiểm tra nội dung
                </label>
                <button type="button" className={button}
                  disabled={busy||!confirmPublish||unsaved||templates.length<1}
                  onClick={()=>void run(async()=>{
                    const receipt=await publishPhase6Draft(user,selected);
                    setPublishedRevision(receipt.publication.revision);
                    setConfirmPublish(false);
                    setNotice(receipt.created
                      ?'Đã xuất bản revision '+receipt.publication.revision+' vào D1 Preview.'
                      :'Phiên bản này đã xuất bản trước đó, không tạo bản sao.');
                  })}>Xuất bản phiên bản toán học DEMO</button>
                {publishedRevision!==null&&<p className="text-xs text-green-800">
                  Đã xác nhận phiên bản {publishedRevision} được lưu cố định ở máy chủ.
                </p>}
              </div>
            )}
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={confirmDelete} disabled={busy}
                onChange={e=>setConfirmDelete(e.target.checked)}/>
              Xác nhận xóa bản nháp đã chọn (bản đã xuất bản vẫn được giữ nguyên)
            </label>
            <button type="button" disabled={busy||!confirmDelete} className={button}
              onClick={()=>void run(async()=>{
                await deletePhase6Draft(user,selected);
                setSelected(null);setTemplates([]);setConfirmDelete(false);
                await refresh();setNotice('Đã xóa bản nháp DEMO.');
              })}>Xóa bản nháp DEMO</button>
          </>
        )}
      </div>
      {notice&&<p role="status" className={'text-xs '+(failed?'text-red-700':'text-green-800')}>
        {notice}
      </p>}
    </section>
  );
};
