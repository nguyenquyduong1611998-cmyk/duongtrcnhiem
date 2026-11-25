// Phase 6B: strictly Preview-only synthetic Admin drafts.
// Never send localStorage roles, student UIDs or real training content.
import type {User} from 'firebase/auth';
import {BOOTSTRAPPED_ADMIN_UID,IS_FIREBASE_STAGING} from '../firebase';
import {isPhase5DemoPreviewHostname} from './phase5DemoTopics';

const ENDPOINT='/api/phase6/admin/drafts';
const PUBLISH_ENDPOINT='/api/phase6/admin/publish';
export type Phase6TitleCode='basic'|'practice'|'challenge';
export type Phase6TemplateCode='sum_2_2'|'sum_3_5'|'sum_7_8'|'minus_10_3';

export const PHASE6_TITLES:ReadonlyArray<{code:Phase6TitleCode;label:string}>=[
  {code:'basic',label:'Toán học DEMO - Cơ bản'},
  {code:'practice',label:'Toán học DEMO - Luyện tập'},
  {code:'challenge',label:'Toán học DEMO - Thử thách'},
];
export const PHASE6_TEMPLATES:ReadonlyArray<{code:Phase6TemplateCode;label:string}>=[
  {code:'sum_2_2',label:'2 + 2 = ?'},
  {code:'sum_3_5',label:'3 + 5 = ?'},
  {code:'sum_7_8',label:'7 + 8 = ?'},
  {code:'minus_10_3',label:'10 - 3 = ?'},
];
export interface Phase6DraftSummary {
  draftId:string;titleCode:Phase6TitleCode;title:string;
  minutes:number;questionCount:number;version:number;
  createdAt:number;updatedAt:number;status:'draft';
}
export interface Phase6AdminDraft extends Phase6DraftSummary {
  templates:Phase6TemplateCode[];
  questions:{id:string;templateCode:Phase6TemplateCode;text:string;options:string[]}[];
}
export interface Phase6Publication {
  topicId:string;revision:number;questionCount:number;
  timeLimitSeconds:number;publishedAt:number;status:'published';
}
export interface Phase6PublishReceipt {
  publication:Phase6Publication;created:boolean;
}
function object(raw:unknown):Record<string,unknown>{
  if(raw===null||typeof raw!=='object'||Array.isArray(raw))
    throw new Error('Dữ liệu bản nháp Phase 6 không hợp lệ.');
  return raw as Record<string,unknown>;
}
function titleCode(value:unknown):value is Phase6TitleCode {
  return PHASE6_TITLES.some(item=>item.code===value);
}
function templateCode(value:unknown):value is Phase6TemplateCode {
  return PHASE6_TEMPLATES.some(item=>item.code===value);
}
function draftId(value:unknown):value is string{
  return typeof value==='string'&&/^p6_demo_[a-f0-9]{32}$/.test(value);
}
function summary(raw:unknown):Phase6DraftSummary {
  const x=object(raw);
  if(!draftId(x.draftId)||!titleCode(x.titleCode)||
     typeof x.title!=='string'||
     x.title!==PHASE6_TITLES.find(t=>t.code===x.titleCode)?.label||
     !Number.isSafeInteger(x.minutes)||Number(x.minutes)<1||Number(x.minutes)>240||
     !Number.isSafeInteger(x.questionCount)||Number(x.questionCount)<0||
     Number(x.questionCount)>12||
     !Number.isSafeInteger(x.version)||Number(x.version)<1||
     !Number.isSafeInteger(x.createdAt)||Number(x.createdAt)<=0||
     !Number.isSafeInteger(x.updatedAt)||Number(x.updatedAt)<Number(x.createdAt)||
     x.status!=='draft')
    throw new Error('Máy chủ trả bản nháp Phase 6 không hợp lệ.');
  return {
    draftId:x.draftId,titleCode:x.titleCode,title:x.title,
    minutes:Number(x.minutes),questionCount:Number(x.questionCount),
    version:Number(x.version),createdAt:Number(x.createdAt),
    updatedAt:Number(x.updatedAt),status:'draft',
  };
}
function parseDraft(raw:unknown):Phase6AdminDraft{
  const x=object(raw),base=summary(x);
  if(!Array.isArray(x.templates)||x.templates.length!==base.questionCount||
     !x.templates.every(templateCode)||!Array.isArray(x.questions)||
     x.questions.length!==x.templates.length)
    throw new Error('Bộ câu hỏi bản nháp không hợp lệ.');
  const validatedTemplates=x.templates as Phase6TemplateCode[];
  const questions=x.questions.map((value,index)=>{
    const q=object(value);
    const label=PHASE6_TEMPLATES.find(t=>t.code===validatedTemplates[index])?.label;
    if(q.id!=='q'+(index+1)||q.templateCode!==validatedTemplates[index]||
       q.text!==label||!Array.isArray(q.options)||q.options.length!==4||
       !q.options.every(o=>typeof o==='string'&&o.length<=1000))
      throw new Error('Câu hỏi bản nháp không hợp lệ.');
    return {
      id:q.id as string,templateCode:q.templateCode as Phase6TemplateCode,
      text:q.text as string,options:q.options as string[],
    };
  });
  return {...base,templates:[...validatedTemplates],questions};
}
export function isPhase6AdminDraftsUiEnabled(hostname:string,flag:unknown):boolean{
  return IS_FIREBASE_STAGING && flag==='true'&&
    isPhase5DemoPreviewHostname(hostname);
}
async function request(user:User|null,body:Record<string,unknown>,endpoint=ENDPOINT):Promise<Record<string,unknown>>{
  if(!IS_FIREBASE_STAGING||!user||user.uid!==BOOTSTRAPPED_ADMIN_UID||
     typeof window==='undefined'||
     !isPhase5DemoPreviewHostname(window.location.hostname))
    throw new Error('Chỉ Google Admin trên Preview được quản lý đề giả Phase 6.');
  const token=await user.getIdToken();
  if(!token)throw new Error('Hãy đăng nhập lại Google Admin.');
  let response:Response;
  try{
    response=await fetch(endpoint,{
      method:'POST',headers:{
        'content-type':'application/json',authorization:'Bearer '+token,
      },body:JSON.stringify(body),
      credentials:'same-origin',cache:'no-store',redirect:'error',
    });
  }catch{
    throw new Error('Không kết nối được với API bản nháp D1 Preview.');
  }
  if(response.status===404)
    throw new Error('Chức năng Phase 6B chưa được bật hoặc không tìm thấy bản nháp.');
  if(response.status===401||response.status===403)
    throw new Error('Tài khoản này không có quyền Google Admin staging.');
  if(response.status===409)
    throw new Error('Bản nháp đã thay đổi trên thiết bị khác. Tải lại trước khi sửa.');
  if(!response.ok)
    throw new Error('Máy chủ chưa thể lưu hoặc đọc bản nháp DEMO.');
  return object(await response.json().catch(()=>null));
}
export async function listPhase6Drafts(user:User|null):Promise<Phase6DraftSummary[]>{
  const raw=await request(user,{action:'list'});
  if(raw.mode!=='phase6-synthetic-admin-drafts'||!Array.isArray(raw.drafts)||
     raw.drafts.length>100)
    throw new Error('Danh sách bản nháp DEMO không hợp lệ.');
  const drafts=raw.drafts.map(summary);
  if(new Set(drafts.map(d=>d.draftId)).size!==drafts.length)
    throw new Error('Danh sách bản nháp có mã trùng.');
  return drafts;
}
export async function getPhase6Draft(user:User|null,id:string):Promise<Phase6AdminDraft>{
  return parseDraft((await request(user,{action:'get',draftId:id})).draft);
}
export async function createPhase6Draft(
  user:User|null,title:Phase6TitleCode,minutes:number
):Promise<Phase6AdminDraft>{
  return parseDraft((await request(user,{action:'create',titleCode:title,minutes})).draft);
}
export async function savePhase6Draft(user:User|null,draft:Phase6AdminDraft,
  title:Phase6TitleCode,minutes:number,templates:Phase6TemplateCode[]
):Promise<Phase6AdminDraft>{
  return parseDraft((await request(user,{
    action:'save',draftId:draft.draftId,version:draft.version,
    titleCode:title,minutes,templates,
  })).draft);
}
export async function deletePhase6Draft(user:User|null,draft:Phase6AdminDraft):Promise<void>{
  const result=await request(user,{
    action:'delete',draftId:draft.draftId,version:draft.version,
  });
  if(result.deleted!==true||result.draftId!==draft.draftId)
    throw new Error('Không xác nhận được việc xóa bản nháp DEMO.');
}

export async function publishPhase6Draft(user:User|null,draft:Phase6AdminDraft)
  :Promise<Phase6PublishReceipt>{
  if(draft.questionCount<1)
    throw new Error('Bản nháp DEMO cần ít nhất một câu hỏi trước khi xuất bản.');
  const raw=await request(user,{
    action:'publish',draftId:draft.draftId,version:draft.version,
    confirmation:'PUBLISH_SYNTHETIC_MATH_REVISION',
  },PUBLISH_ENDPOINT);
  const x=object(raw.publication);
  if(raw.mode!=='phase6-synthetic-publication'||
     typeof raw.created!=='boolean'||
     x.topicId!==draft.draftId||x.revision!==draft.version||
     x.questionCount!==draft.questionCount||
     x.timeLimitSeconds!==draft.minutes*60||
     !Number.isSafeInteger(x.publishedAt)||Number(x.publishedAt)<=0||
     x.status!=='published')
    throw new Error('Xác nhận xuất bản từ máy chủ không hợp lệ.');
  return {
    publication:{
      topicId:draft.draftId,revision:draft.version,
      questionCount:draft.questionCount,timeLimitSeconds:draft.minutes*60,
      publishedAt:Number(x.publishedAt),status:'published',
    },
    created:raw.created,
  };
}
