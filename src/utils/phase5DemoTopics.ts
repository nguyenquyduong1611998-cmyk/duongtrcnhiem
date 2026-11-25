// Phase 5B — Preview-only client for PUBLISHED SYNTHETIC topics.
// No content writes, no grading, no answer keys, no persisted tokens.
// Browser only gets an active DEMO student's current Firebase ID token.
import type {User} from 'firebase/auth';
import {IS_FIREBASE_STAGING} from '../firebase';

export const PHASE5_STUDENT_PREVIEW_HOST =
  'feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev';
const DEMO_UID=/^student_[a-f0-9]{32}$/;
const DEMO_TOPIC=/^p5_demo_[a-z0-9_-]{1,70}$/;

export interface Phase5DemoTopicSummary {
  topicId:string;
  revision:number;
  code:string;
  title:string;
  description:string;
  timeLimitSeconds:number;
  questionCount:number;
}
export interface Phase5DemoQuestion {
  id:string;
  orderIndex:number;
  text:string;
  options:string[];
}
export interface Phase5DemoTopic {
  topicId:string;
  revision:number;
  code:string;
  title:string;
  description:string;
  timeLimitSeconds:number;
  questions:Phase5DemoQuestion[];
}

export function isPhase5DemoPreviewHostname(hostname:string):boolean {
  return hostname===PHASE5_STUDENT_PREVIEW_HOST;
}

function requireDemoPreviewStudent(user:User|null):User {
  if(!IS_FIREBASE_STAGING ||
     typeof window==='undefined' ||
     !isPhase5DemoPreviewHostname(window.location.hostname) ||
     !user || !DEMO_UID.test(user.uid))
    throw new Error('Chỉ học viên DEMO trên đúng Cloudflare Preview được đọc chuyên đề thử.');
  return user;
}

function record(raw:unknown):Record<string,unknown> {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))
    throw new Error('Máy chủ trả dữ liệu chuyên đề DEMO không hợp lệ.');
  return raw as Record<string,unknown>;
}

function int(raw:unknown,min:number,max:number):number {
  if(!Number.isSafeInteger(raw)||Number(raw)<min||Number(raw)>max)
    throw new Error('Máy chủ trả dữ liệu chuyên đề DEMO không hợp lệ.');
  return Number(raw);
}
function text(raw:unknown,max:number):string {
  if(typeof raw!=='string'||raw.length<1||raw.length>max)
    throw new Error('Máy chủ trả dữ liệu chuyên đề DEMO không hợp lệ.');
  return raw;
}
function demoId(raw:unknown):string {
  if(typeof raw!=='string'||!DEMO_TOPIC.test(raw))
    throw new Error('Định danh chuyên đề DEMO không hợp lệ.');
  return raw;
}
function summary(raw:unknown):Phase5DemoTopicSummary {
  const x=record(raw);
  return {
    topicId:demoId(x.topicId),
    revision:int(x.revision,1,100000),
    code:text(x.code,40),
    title:text(x.title,250),
    description:typeof x.description==='string'&&x.description.length<=2000?
      x.description:text(x.description,2000),
    timeLimitSeconds:int(x.timeLimitSeconds,60,14400),
    questionCount:int(x.questionCount,1,500),
  };
}
function question(raw:unknown):Phase5DemoQuestion {
  const q=record(raw);
  if(!Array.isArray(q.options)||q.options.length!==4)
    throw new Error('Câu hỏi DEMO không hợp lệ.');
  const id=text(q.id,80);
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id))
    throw new Error('Định danh câu hỏi DEMO không hợp lệ.');
  return {
    id,orderIndex:int(q.orderIndex,1,500),
    text:text(q.text,4000),
    options:q.options.map(value=>text(value,1000)),
  };
}
function detail(raw:unknown):Phase5DemoTopic {
  const x=record(raw);
  if(!Array.isArray(x.questions)||x.questions.length<1||
     x.questions.length>500)
    throw new Error('Chưa có câu hỏi DEMO hợp lệ.');
  const parsed=x.questions.map(question);
  const ids=new Set(parsed.map(q=>q.id));
  const orders=new Set(parsed.map(q=>q.orderIndex));
  if(ids.size!==parsed.length||orders.size!==parsed.length)
    throw new Error('Câu hỏi DEMO trùng lặp.');
  return {
    topicId:demoId(x.topicId),
    revision:int(x.revision,1,100000),
    code:text(x.code,40),
    title:text(x.title,250),
    description:typeof x.description==='string'&&x.description.length<=2000?
      x.description:text(x.description,2000),
    timeLimitSeconds:int(x.timeLimitSeconds,60,14400),
    questions:parsed.sort((a,b)=>a.orderIndex-b.orderIndex),
  };
}

async function get(path:string,user:User):Promise<Record<string,unknown>> {
  const token=await user.getIdToken();
  if(typeof token!=='string'||!token)throw new Error('Phiên Firebase DEMO chưa sẵn sàng.');
  let response:Response;
  try{
    response=await fetch(path,{
      method:'GET',
      headers:{authorization:`Bearer ${token}`},
      cache:'no-store',
      credentials:'same-origin',
      redirect:'error',
    });
  }catch{
    throw new Error('Không kết nối được Cloudflare. Hãy kiểm tra mạng và thử đọc lại.');
  }
  if(response.status===401||response.status===403)
    throw new Error('Phiên đăng nhập không hợp lệ hoặc tài khoản DEMO đã bị khóa.');
  if(response.status===404)
    throw new Error('API chuyên đề Phase 5 hiện không khả dụng trên Preview.');
  if(response.status===503)
    throw new Error('D1 Phase 5 chưa sẵn sàng. Không có dữ liệu nào bị thay đổi.');
  if(!response.ok)
    throw new Error('Không thể đọc chuyên đề Phase 5 từ máy chủ.');
  return record(await response.json().catch(()=>null));
}

export async function listPhase5DemoTopics(user:User|null):Promise<Phase5DemoTopicSummary[]> {
  const valid=requireDemoPreviewStudent(user);
  const payload=await get('/api/phase5/topics',valid);
  if(!Array.isArray(payload.topics)||payload.topics.length>25)
    throw new Error('Danh sách chuyên đề DEMO không hợp lệ.');
  return payload.topics.map(summary);
}
export async function readPhase5DemoTopic(
  user:User|null,topicId:string,revision:number
):Promise<Phase5DemoTopic> {
  const valid=requireDemoPreviewStudent(user);
  const id=demoId(topicId);
  const version=int(revision,1,100000);
  const payload=await get(
    `/api/phase5/topics/${encodeURIComponent(id)}/versions/${version}`,valid
  );
  const parsed=detail(payload.topic);
  if(parsed.topicId!==id||parsed.revision!==version)
    throw new Error('Phiên bản chuyên đề DEMO trả về không khớp.');
  return parsed;
}
