// Phase 6D: browser contract for separate Preview-only timed synthetic exams.
// No answer keys, scores computed locally, persisted Firebase tokens or
// browser-provided deadlines. All grading is exclusively server-owned.
import type {User} from 'firebase/auth';
import {IS_FIREBASE_STAGING} from '../firebase';
import {isPhase5DemoPreviewHostname} from './phase5DemoTopics';

const ENDPOINT='/api/phase6/exam';
const UID=/^student_[a-f0-9]{32}$/;
const TOPIC=/^p6_demo_[a-f0-9]{32}$/;
const SESSION=/^p6_session_[a-f0-9]{32}$/;
export interface Phase6ExamSummary {
  topicId:string;revision:number;title:string;
  questionCount:number;timeLimitSeconds:number;
}
export interface Phase6ExamQuestion {
  id:string;orderIndex:number;text:string;options:string[];
}
export interface Phase6ExamSession {
  sessionId:string;topicId:string;revision:number;questionCount:number;
  timeLimitSeconds:number;startedAt:number;expiresAt:number;serverNow:number;
}
export interface Phase6ExamResult {
  topicId:string;revision:number;correctCount:number;totalCount:number;
  score:number;maxScore:10;submittedAt:number;status:'submitted';
}
export interface Phase6ExamState {
  session:Phase6ExamSession|null;
  topic?:{title:string;questions:Phase6ExamQuestion[]};
  result?:Phase6ExamResult|null;
}
// Cloudflare Text build variables can contain a trailing newline/space.
// Accept only the literal enabled value after removing surrounding whitespace.
// All staging, exact-host, Firebase UID and server-side API guards remain intact.
export const isPhase6StudentTimedUiFlagEnabled=(flag:unknown):boolean=>
  typeof flag==='string'&&flag.trim()==='true';

export const isPhase6StudentExamUiEnabled=(host:string,flag:unknown):boolean=>
  IS_FIREBASE_STAGING&&isPhase6StudentTimedUiFlagEnabled(flag)&&isPhase5DemoPreviewHostname(host);

function record(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))
    throw new Error('Phản hồi từ máy chủ thi DEMO không hợp lệ.');
  return value as Record<string,unknown>;
}
function integer(value:unknown,min:number,max:number):number{
  if(!Number.isSafeInteger(value)||Number(value)<min||Number(value)>max)
    throw new Error('Dữ liệu bài thi DEMO không hợp lệ.');
  return Number(value);
}
function str(value:unknown,max:number):string{
  if(typeof value!=='string'||value.length<1||value.length>max)
    throw new Error('Dữ liệu bài thi DEMO không hợp lệ.');
  return value;
}
function routeTopic(topic:Phase6ExamSummary){
  if(!TOPIC.test(topic.topicId)||!Number.isSafeInteger(topic.revision)||
     topic.revision<1||topic.revision>100000)
    throw new Error('Phiên bản đề toán học DEMO không hợp lệ.');
  return {topicId:topic.topicId,revision:topic.revision};
}
function summary(value:unknown):Phase6ExamSummary{
  const v=record(value),id=str(v.topicId,80);
  if(!TOPIC.test(id))throw new Error('Mã chuyên đề DEMO không hợp lệ.');
  return {
    topicId:id,revision:integer(v.revision,1,100000),
    title:str(v.title,250),questionCount:integer(v.questionCount,1,12),
    timeLimitSeconds:integer(v.timeLimitSeconds,60,14400),
  };
}
function parseResult(raw:unknown):Phase6ExamResult|null{
  if(raw===null)return null;
  const r=record(raw),base=summary({...r,title:'Toán học DEMO',
    questionCount:r.totalCount,timeLimitSeconds:60});
  const correct=integer(r.correctCount,0,base.questionCount),
    score=integer(Math.round(Number(r.score)*10),0,100)/10;
  if(typeof r.score!=='number'||!Number.isFinite(r.score)||
     Math.abs(score-r.score)>0.00001||
     Math.round(correct*100/base.questionCount)!==Math.round(score*10)||
     r.maxScore!==10||r.status!=='submitted')
    throw new Error('Điểm thi DEMO không hợp lệ.');
  return {
    topicId:base.topicId,revision:base.revision,
    correctCount:correct,totalCount:base.questionCount,
    score,maxScore:10,submittedAt:integer(r.submittedAt,1,Number.MAX_SAFE_INTEGER),
    status:'submitted',
  };
}
function state(value:unknown):Phase6ExamState{
  const x=record(value);
  if(x.session===null)return {session:null};
  const s=record(x.session);
  const id=str(s.topicId,80),sessionId=str(s.sessionId,100);
  if(!TOPIC.test(id)||!SESSION.test(sessionId))
    throw new Error('Phiên thi DEMO không hợp lệ.');
  const revision=integer(s.revision,1,100000),
    questionCount=integer(s.questionCount,1,12),
    timeLimitSeconds=integer(s.timeLimitSeconds,60,14400),
    startedAt=integer(s.startedAt,1,Number.MAX_SAFE_INTEGER),
    expiresAt=integer(s.expiresAt,1,Number.MAX_SAFE_INTEGER),
    serverNow=integer(s.serverNow,1,Number.MAX_SAFE_INTEGER);
  if(expiresAt!==startedAt+timeLimitSeconds)
    throw new Error('Thời hạn thi DEMO không hợp lệ.');
  const topic=record(x.topic);
  if(!Array.isArray(topic.questions)||topic.questions.length!==questionCount)
    throw new Error('Câu hỏi thi DEMO không hợp lệ.');
  const questions=topic.questions.map(raw=>{
    const q=record(raw),id=str(q.id,80);
    if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id)||
       !Array.isArray(q.options)||q.options.length!==4)
      throw new Error('Câu hỏi thi DEMO không hợp lệ.');
    return {
      id,orderIndex:integer(q.orderIndex,1,12),text:str(q.text,4000),
      options:q.options.map(o=>str(o,1000)),
    };
  });
  if(new Set(questions.map(q=>q.id)).size!==questions.length||
     new Set(questions.map(q=>q.orderIndex)).size!==questions.length)
    throw new Error('Câu hỏi DEMO trùng lặp.');
  const result=parseResult(x.result);
  if(result&&(result.topicId!==id||result.revision!==revision||
      result.totalCount!==questionCount))
    throw new Error('Điểm thi không khớp phiên đề.');
  return {
    session:{sessionId,topicId:id,revision,questionCount,timeLimitSeconds,
      startedAt,expiresAt,serverNow},
    topic:{title:str(topic.title,250),questions:questions.sort((a,b)=>a.orderIndex-b.orderIndex)},
    result,
  };
}
async function post(user:User|null,body:Record<string,unknown>):Promise<Record<string,unknown>>{
  if(!IS_FIREBASE_STAGING||typeof window==='undefined'||
     !isPhase5DemoPreviewHostname(window.location.hostname)||
     !user||!UID.test(user.uid))
    throw new Error('Chỉ học viên DEMO trên Preview được làm bài thử.');
  const token=await user.getIdToken();
  if(!token)throw new Error('Phiên đăng nhập học viên DEMO chưa sẵn sàng.');
  let response:Response;
  try{
    response=await fetch(ENDPOINT,{
      method:'POST',
      headers:{'content-type':'application/json',authorization:'Bearer '+token},
      body:JSON.stringify(body),cache:'no-store',credentials:'same-origin',redirect:'error',
    });
  }catch{
    // Caller can recover by reading their own result; never auto POST twice.
    throw new Error('Mất kết nối máy chủ. Hãy đọc lại kết quả trước khi nộp lại.');
  }
  if(response.status===401||response.status===403)
    throw new Error('Phiên học viên DEMO hết hạn hoặc tài khoản đã bị khóa.');
  if(response.status===404)
    throw new Error('Bài thi 6D chưa được bật hoặc phiên đề không tồn tại.');
  if(response.status===409){
    const p=await response.json().catch(()=>null);
    const code=p&&typeof p==='object'&&'error' in p?p.error:'';
    if(code==='DEADLINE_EXPIRED')throw new Error('Đã hết thời gian nộp bài theo đồng hồ máy chủ.');
    if(code==='ALREADY_SUBMITTED')throw new Error('Bài thi đã nộp từ thiết bị khác. Hãy đọc lại kết quả.');
    if(code==='SESSION_NOT_STARTED')throw new Error('Bạn chưa bắt đầu phiên thi này.');
    throw new Error('Phiên thi không thể ghi. Hãy đọc lại trạng thái trên máy chủ.');
  }
  if(!response.ok)
    throw new Error('Máy chủ D1 chưa thể xử lý bài thi DEMO.');
  return record(await response.json().catch(()=>null));
}
export async function listPhase6Exams(user:User|null):Promise<Phase6ExamSummary[]>{
  const p=await post(user,{action:'list'});
  if(p.mode!=='phase6-student-timed-demo'||!Array.isArray(p.topics)||
     p.topics.length>100)
    throw new Error('Danh sách đề thi DEMO không hợp lệ.');
  const items=p.topics.map(summary);
  if(new Set(items.map(t=>t.topicId)).size!==items.length)
    throw new Error('Danh sách đề thi DEMO trùng lặp.');
  return items;
}
export async function readPhase6Exam(user:User|null,topic:Phase6ExamSummary){
  return state((await post(user,{action:'read',...routeTopic(topic)})));
}
export async function startPhase6Exam(user:User|null,topic:Phase6ExamSummary){
  return state((await post(user,{action:'start',...routeTopic(topic)})));
}
export async function readPhase6ExamResult(user:User|null,topic:Phase6ExamSummary){
  const r=await post(user,{action:'result',...routeTopic(topic)});
  return parseResult(r.result);
}
export async function submitPhase6Exam(user:User|null,session:Phase6ExamSession,
  answers:Readonly<Record<string,number>>):Promise<Phase6ExamResult>{
  const r=await post(user,{
    action:'submit',topicId:session.topicId,revision:session.revision,
    sessionId:session.sessionId,answers,
  });
  const result=parseResult(r.result);
  if(!result||result.topicId!==session.topicId||result.revision!==session.revision||
     result.totalCount!==session.questionCount)
    throw new Error('Kết quả chấm điểm của máy chủ không hợp lệ.');
  return result;
}
