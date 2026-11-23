// PHASE 4A: synthetic-only UI client. Never uploads actual attempts or grades.
// The server computes a fixed demo score; the browser never submits a score.
import type {User} from 'firebase/auth';
import {BOOTSTRAPPED_ADMIN_UID,IS_FIREBASE_STAGING} from '../firebase';
import {SyntheticQuizDeliveryUncertainError,reconcileSyntheticQuizSubmission} from './syntheticQuizSubmissionRecovery';
import type {SyntheticQuizReceipt} from './syntheticQuizSubmissionRecovery';

const DEMO_UID=/^student_[a-f0-9]{32}$/;
const USERNAME=/^test_hv_[a-f0-9]{12}$/;

export interface SyntheticQuizQuestion {
  quizId:'synthetic_math_v1';
  text:string;
  options:string[];
  mode:'synthetic-only';
  oneSubmission:true;
}
export interface SyntheticQuizAttempt {
  quizId:'synthetic_math_v1';
  score:number;
  maxScore:10;
  submittedAt:number;
  mode:'server-graded-synthetic';
}
export interface SyntheticQuizAdminAttempt extends SyntheticQuizAttempt {
  username:string;
}

function requireDemoUser(user:User|null):User {
  if(!IS_FIREBASE_STAGING || !user || !DEMO_UID.test(user.uid))
    throw new Error('Chỉ học viên DEMO của Firebase staging được làm bài này.');
  return user;
}
function requireDemoAdmin(user:User|null):User {
  if(!IS_FIREBASE_STAGING || !user ||
    user.uid!==BOOTSTRAPPED_ADMIN_UID)
    throw new Error('Cần đăng nhập Google Admin staging để xem kết quả DEMO.');
  return user;
}
async function post(path:string,data:Record<string,unknown>,user:User,allowExisting=false):Promise<Record<string,unknown>> {
  // Request identity first: failures while refreshing a Firebase token must
  // not be mistaken for a submitted or saved DEMO answer.
  const token=await user.getIdToken();
  let response:Response;
  try{response=await fetch(path,{
    method:'POST',
    headers:{
      'content-type':'application/json',
      authorization:`Bearer ${token}`,
    },
    body:JSON.stringify(data),
    credentials:'same-origin',
    cache:'no-store',
  });}
  catch{
    if(data.action==='submit')throw new SyntheticQuizDeliveryUncertainError();
    throw new Error('Không thể kết nối Cloudflare để đọc dữ liệu DEMO. Hãy kiểm tra mạng.');
  }
  const result=await response.json().catch(()=>null) as Record<string,unknown>|null;
  if(response.ok&&!result){
    if(data.action==='submit')throw new SyntheticQuizDeliveryUncertainError();
    throw new Error('Máy chủ trả về dữ liệu DEMO không hợp lệ.');
  }
  if(response.status===404)
    throw new Error('Chức năng chấm bài DEMO đang tắt trên máy chủ staging.');
  if(response.status===409 && result?.error==='ALREADY_SUBMITTED'){
    if(allowExisting && result.attempt) return {...result,__alreadySubmitted:true};
    throw new Error('Học viên đã nộp bài DEMO từ thiết bị khác. Hãy dùng nút đọc kết quả.');
  }
  if(response.status===401||response.status===403)
    throw new Error('Phiên Firebase chưa được xác minh hoặc học viên DEMO đã bị khóa.');
  if(!response.ok||!result)
    throw new Error('Máy chủ D1 chưa sẵn sàng cho bài DEMO. Không có điểm thi thật nào được ghi.');
  return result;
}
function attempt(raw:unknown):SyntheticQuizAttempt {
  if(!raw||typeof raw!=='object')
    throw new Error('Dữ liệu kết quả DEMO không hợp lệ.');
  const x=raw as Record<string,unknown>;
  if(x.quizId!=='synthetic_math_v1' || x.mode!=='server-graded-synthetic' ||
    (x.score!==0&&x.score!==10)||x.maxScore!==10||
    !Number.isSafeInteger(x.submittedAt)||Number(x.submittedAt)<=0)
    throw new Error('Máy chủ trả về dữ liệu điểm thử không đúng định dạng.');
  return {
    quizId:'synthetic_math_v1',
    mode:'server-graded-synthetic',
    score:Number(x.score),maxScore:10,submittedAt:Number(x.submittedAt),
  };
}
export async function getSyntheticQuizQuestion(user:User|null):Promise<SyntheticQuizQuestion> {
  const data=await post('/api/demo-quiz/student',{action:'question'},requireDemoUser(user));
  if(data.quizId!=='synthetic_math_v1'||data.mode!=='synthetic-only'||
    data.oneSubmission!==true||typeof data.text!=='string'||
    !Array.isArray(data.options)||data.options.length!==4||
    !data.options.every(x=>typeof x==='string')) {
    throw new Error('Câu hỏi DEMO từ máy chủ không hợp lệ.');
  }
  return {
    quizId:'synthetic_math_v1',mode:'synthetic-only',
    oneSubmission:true,text:data.text,options:data.options,
  };
}
export async function submitSyntheticQuiz(user:User|null,answerIndex:number):Promise<SyntheticQuizReceipt<SyntheticQuizAttempt>> {
  if(!Number.isInteger(answerIndex)||answerIndex<0||answerIndex>3)
    throw new Error('Chọn một đáp án hợp lệ trước khi nộp.');
  const validUser=requireDemoUser(user);
  return reconcileSyntheticQuizSubmission(
    async()=>{
      const data=await post('/api/demo-quiz/student',
        {action:'submit',answerIndex},validUser,true);
      return {
        attempt:attempt(data.attempt),
        disposition:data.__alreadySubmitted===true||data.created===false?'existing':'new',
      };
    },
    ()=>readOwnSyntheticQuiz(validUser),
  );
}
export async function readOwnSyntheticQuiz(user:User|null):Promise<SyntheticQuizAttempt|null> {
  const data=await post('/api/demo-quiz/student',
    {action:'result'},requireDemoUser(user));
  return data.attempt===null?null:attempt(data.attempt);
}
export async function listSyntheticQuizAttempts(user:User|null):Promise<SyntheticQuizAdminAttempt[]> {
  const data=await post('/api/demo-quiz/admin',{action:'list'},requireDemoAdmin(user));
  if(data.mode!=='server-graded-synthetic' || !Array.isArray(data.attempts) ||
    data.attempts.length>100 || data.count!==data.attempts.length)
    throw new Error('Danh sách kết quả DEMO không hợp lệ.');
  return data.attempts.map((raw:unknown)=>{
    const row=raw as Record<string,unknown>;
    if(typeof row?.username!=='string'||!USERNAME.test(row.username))
      throw new Error('Tên tài khoản thử nghiệm không hợp lệ.');
    return {username:row.username,...attempt(raw)};
  });
}
