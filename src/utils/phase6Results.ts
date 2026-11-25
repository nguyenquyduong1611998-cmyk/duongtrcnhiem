// Phase 6E: strict Preview-only browser contracts for read-only D1 scores.
// Never store ID tokens, accept browser roles, or request private answer keys.
import type {User} from 'firebase/auth';
import {BOOTSTRAPPED_ADMIN_UID,IS_FIREBASE_STAGING} from '../firebase';
import {isPhase5DemoPreviewHostname} from './phase5DemoTopics';

const STUDENT_ENDPOINT='/api/phase6/results/student';
const ADMIN_ENDPOINT='/api/phase6/results/admin';
const UID=/^student_[a-f0-9]{32}$/;
const TOPIC=/^p6_demo_[a-f0-9]{32}$/;
const USERNAME=/^test_hv_[a-f0-9]{12}$/;
const PAGE=25;
const MAX_OFFSET=10000;

export interface Phase6HistoryEntry{
  topicId:string;revision:number;title:string;correctCount:number;
  totalCount:number;score:number;maxScore:10;submittedAt:number;
  status:'submitted';
}
export interface Phase6AdminScore extends Phase6HistoryEntry{username:string;}
export interface Phase6ResultsPage<T>{
  entries:T[];offset:number;nextOffset:number|null;
}
export interface Phase6ResultsSummary{
  attemptCount:number;studentCount:number;averageScore:number|null;maxScore:10;
}

export function isPhase6StudentHistoryUiEnabled(host:string,flag:unknown):boolean{
  return IS_FIREBASE_STAGING&&flag==='true'&&isPhase5DemoPreviewHostname(host);
}
export function isPhase6AdminResultsUiEnabled(host:string,flag:unknown):boolean{
  return IS_FIREBASE_STAGING&&flag==='true'&&isPhase5DemoPreviewHostname(host);
}
function record(v:unknown):Record<string,unknown>{
  if(!v||typeof v!=='object'||Array.isArray(v))
    throw new Error('Dữ liệu kết quả thi DEMO không hợp lệ.');
  return v as Record<string,unknown>;
}
function number(v:unknown,min:number,max:number):number{
  if(!Number.isSafeInteger(v)||Number(v)<min||Number(v)>max)
    throw new Error('Dữ liệu điểm DEMO không hợp lệ.');
  return Number(v);
}
function score(raw:unknown):Phase6HistoryEntry{
  const r=record(raw);
  const correct=number(r.correctCount,0,12);
  const total=number(r.totalCount,1,12);
  const tenths=Math.round(correct*100/total);
  if(typeof r.topicId!=='string'||!TOPIC.test(r.topicId)||
     typeof r.title!=='string'||r.title.length<1||r.title.length>250||
     correct>total||typeof r.score!=='number'||!Number.isFinite(r.score)||
     r.score!==tenths/10||r.maxScore!==10||r.status!=='submitted')
    throw new Error('Bảng điểm Phase 6 có dữ liệu không hợp lệ.');
  return {
    topicId:r.topicId,revision:number(r.revision,1,100000),title:r.title,
    correctCount:correct,totalCount:total,score:r.score,maxScore:10,
    submittedAt:number(r.submittedAt,1,Number.MAX_SAFE_INTEGER),
    status:'submitted',
  };
}
function page<T extends Phase6HistoryEntry>(
  raw:unknown,mode:string,offset:number,
  project:(v:unknown)=>T,
):Phase6ResultsPage<T>{
  const v=record(raw);
  if(v.mode!==mode||v.offset!==offset||
     !Array.isArray(v.entries)||v.entries.length>PAGE||
     (v.nextOffset!==null&&v.nextOffset!==offset+PAGE))
    throw new Error('Trang kết quả Phase 6 không hợp lệ.');
  const entries=v.entries.map(project);
  const keys=entries.map(x=>
    ('username' in x?String(x.username)+':':'')+x.topicId+':'+x.revision);
  if(new Set(keys).size!==keys.length)
    throw new Error('Dữ liệu kết quả bị trùng lặp.');
  return {entries,offset,nextOffset:v.nextOffset as number|null};
}
async function request(
  user:User|null,role:'student'|'admin',
  endpoint:string,body:Record<string,unknown>,
):Promise<unknown>{
  if(!IS_FIREBASE_STAGING||typeof window==='undefined'||
     !isPhase5DemoPreviewHostname(window.location.hostname)||!user||
     (role==='student'?!UID.test(user.uid):user.uid!==BOOTSTRAPPED_ADMIN_UID))
    throw new Error('Chỉ tài khoản DEMO có quyền mới được xem điểm trên Preview.');
  const token=await user.getIdToken();
  if(!token)throw new Error('Phiên Firebase chưa sẵn sàng.');
  let response:Response;
  try{
    response=await fetch(endpoint,{
      method:'POST',
      headers:{
        'content-type':'application/json',authorization:'Bearer '+token,
      },
      body:JSON.stringify(body),cache:'no-store',credentials:'same-origin',redirect:'error',
    });
  }catch{throw new Error('Không kết nối được D1 để xem điểm. Hãy thử lại.');}
  if(response.status===401||response.status===403)
    throw new Error('Tài khoản không có quyền xem điểm trên máy chủ.');
  if(response.status===404)
    throw new Error('Tính năng lịch sử điểm Phase 6 chưa được bật.');
  if(!response.ok)
    throw new Error('Máy chủ D1 chưa thể tải lịch sử điểm.');
  return response.json().catch(()=>null);
}
function offsetChecked(offset:number):number{
  if(!Number.isSafeInteger(offset)||offset<0||offset>MAX_OFFSET||
     offset%PAGE!==0)
    throw new Error('Vị trí trang điểm không hợp lệ.');
  return offset;
}
export async function listPhase6OwnHistory(
  user:User|null,offset=0,
):Promise<Phase6ResultsPage<Phase6HistoryEntry>>{
  const index=offsetChecked(offset);
  return page(await request(user,'student',STUDENT_ENDPOINT,
    {action:'list',offset:index}), 'phase6-student-history-readonly',index,score);
}
export async function listPhase6AdminResults(
  user:User|null,offset=0,
):Promise<Phase6ResultsPage<Phase6AdminScore>>{
  const index=offsetChecked(offset);
  return page(await request(user,'admin',ADMIN_ENDPOINT,
    {action:'list',offset:index}), 'phase6-admin-results-readonly',index,raw=>{
      const r=record(raw);
      if(typeof r.username!=='string'||!USERNAME.test(r.username))
        throw new Error('Tên tài khoản DEMO trong bảng điểm không hợp lệ.');
      return {username:r.username,...score(r)};
    });
}
export async function readPhase6AdminSummary(user:User|null):Promise<Phase6ResultsSummary>{
  const raw=record(await request(user,'admin',ADMIN_ENDPOINT,{action:'summary'}));
  if(raw.mode!=='phase6-admin-results-readonly')
    throw new Error('Tổng hợp điểm Phase 6 không hợp lệ.');
  const x=record(raw.summary);
  const attempts=number(x.attemptCount,0,1000000);
  const students=number(x.studentCount,0,attempts);
  const average=x.averageScore;
  if(x.maxScore!==10||
     (attempts===0?average!==null:
       typeof average!=='number'||!Number.isFinite(average)||
       average<0||average>10||Math.round(average*10)!==average*10))
    throw new Error('Tổng hợp điểm Phase 6 không hợp lệ.');
  return {
    attemptCount:attempts,studentCount:students,
    averageScore:average as number|null,maxScore:10,
  };
}
