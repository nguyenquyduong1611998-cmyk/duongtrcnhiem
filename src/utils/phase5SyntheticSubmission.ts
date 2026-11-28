// Phase 5E: browser-side staging DEMO submission client (not a real exam).
// UI defaults OFF. The separate server flag PHASE5_SYNTHETIC_GRADING_ENABLED
// also defaults OFF. Never put correctIndex/answer keys or student UID in POST.
// Never log or persist Firebase ID token.
import type {User} from 'firebase/auth';
import {IS_FIREBASE_STAGING} from '../firebase';
import {isPhase5DemoPreviewHostname} from './phase5DemoTopics';
import {
  SyntheticQuizDeliveryUncertainError,reconcileSyntheticQuizSubmission,
} from './syntheticQuizSubmissionRecovery';
import type {SyntheticQuizReceipt} from './syntheticQuizSubmissionRecovery';

const UID=/^student_[a-f0-9]{32}$/;
const QUESTION_ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
export const PHASE5_DEMO_TOPIC_ID='p5_demo_math';
export const PHASE5_DEMO_REVISION=1;
const POST_PATH='/api/phase5/attempts/student';

export interface Phase5SyntheticAttempt {
  topicId:typeof PHASE5_DEMO_TOPIC_ID;
  revision:typeof PHASE5_DEMO_REVISION;
  correctCount:number;
  totalCount:number;
  score:number;
  maxScore:10;
  submittedAt:number;
  mode:'phase5-synthetic-server-graded';
}
export type Phase5DemoAnswerMap=Record<string,number>;

export function isPhase5SyntheticSubmitUiEnabled(hostname:string,flag:unknown):boolean {
  return flag==='true' && isPhase5DemoPreviewHostname(hostname);
}

function student(user:User|null):User {
  if(!IS_FIREBASE_STAGING||typeof window==='undefined'||
     !isPhase5DemoPreviewHostname(window.location.hostname)||
     !user||!UID.test(user.uid))
    throw new Error('Chỉ học viên DEMO đã xác thực tại đúng Preview mới có thể nộp bài thử.');
  return user;
}
function parseAttempt(raw:unknown):Phase5SyntheticAttempt {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))
    throw new Error('Biên nhận chấm điểm DEMO từ D1 không hợp lệ.');
  const row=raw as Record<string,unknown>;
  if(row.topicId!==PHASE5_DEMO_TOPIC_ID||row.revision!==1||
     row.mode!=='phase5-synthetic-server-graded'||
     row.maxScore!==10||
     !Number.isSafeInteger(row.correctCount)||
     !Number.isSafeInteger(row.totalCount)||
     Number(row.totalCount)<1||Number(row.totalCount)>500||
     Number(row.correctCount)<0||
     Number(row.correctCount)>Number(row.totalCount)||
     typeof row.score!=='number'||!Number.isFinite(row.score)||
     row.score<0||row.score>10||
     Math.abs(row.score*10-
       Math.round(Number(row.correctCount)*100/Number(row.totalCount)))>0.000001||
     !Number.isSafeInteger(row.submittedAt)||Number(row.submittedAt)<=0)
    throw new Error('Biên nhận chấm điểm DEMO từ D1 không hợp lệ.');
  return {
    topicId:PHASE5_DEMO_TOPIC_ID,revision:1,
    correctCount:Number(row.correctCount),
    totalCount:Number(row.totalCount),
    score:row.score,maxScore:10,
    submittedAt:Number(row.submittedAt),
    mode:'phase5-synthetic-server-graded',
  };
}

export function canonicalPhase5Answers(
  raw:Phase5DemoAnswerMap,questionIds:readonly string[]
):Phase5DemoAnswerMap {
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
     questionIds.length<1||questionIds.length>500||
     Object.keys(raw).length!==questionIds.length||
     new Set(questionIds).size!==questionIds.length)
    throw new Error('Hãy chọn đầy đủ một đáp án cho mỗi câu hỏi DEMO.');
  const result:Phase5DemoAnswerMap=Object.create(null) as Phase5DemoAnswerMap;
  for(const id of questionIds){
    if(!QUESTION_ID.test(id)||!Object.prototype.hasOwnProperty.call(raw,id)||
       !Number.isSafeInteger(raw[id])||raw[id]<0||raw[id]>3)
      throw new Error('Các lựa chọn trả lời DEMO không hợp lệ.');
    result[id]=raw[id];
  }
  return result;
}

async function request(
  validUser:User,action:'submit'|'result',answers?:Phase5DemoAnswerMap
):Promise<Record<string,unknown>> {
  // Token-refresh errors occur before the POST and are NOT ambiguous writes.
  const token=await validUser.getIdToken();
  if(!token)throw new Error('Phiên Firebase DEMO chưa sẵn sàng.');
  const body=action==='submit'
    ?{action,topicId:PHASE5_DEMO_TOPIC_ID,revision:PHASE5_DEMO_REVISION,answers}
    :{action,topicId:PHASE5_DEMO_TOPIC_ID,revision:PHASE5_DEMO_REVISION};
  let response:Response;
  try{
    response=await fetch(POST_PATH,{
      method:'POST',headers:{
        'content-type':'application/json',authorization:`Bearer ${token}`,
      },
      body:JSON.stringify(body),
      credentials:'same-origin',cache:'no-store',redirect:'error',
    });
  }catch{
    if(action==='submit')throw new SyntheticQuizDeliveryUncertainError();
    throw new Error('Không kết nối được D1 để đọc kết quả. Hãy kiểm tra mạng.');
  }
  const data=await response.json().catch(()=>null) as Record<string,unknown>|null;
  if(response.status===401||response.status===403)
    throw new Error('Phiên Firebase không hợp lệ hoặc học viên DEMO đã bị khóa.');
  if(response.status===404)
    throw new Error('Nộp bài Phase 5 đang tắt trên máy chủ Preview.');
  if(response.status===415||response.status===400)
    throw new Error('Yêu cầu nộp bài DEMO không hợp lệ.');
  if(response.status===409 && action==='submit' && data?.error==='ALREADY_SUBMITTED' && data.attempt){
    // A different submission won. Show its original grade, never overwrite it.
    return {attempt:parseAttempt(data.attempt),created:false,__existingDifferent:true};
  }
  if(!response.ok)
    throw new Error('Máy chủ Phase 5 chưa sẵn sàng. Hãy đọc lại kết quả từ D1 trước khi thử thao tác khác.');
  if(!data||typeof data!=='object'||Array.isArray(data)){
    if(action==='submit')throw new SyntheticQuizDeliveryUncertainError();
    throw new Error('Máy chủ trả kết quả DEMO không hợp lệ.');
  }
  return data;
}

export async function readOwnPhase5SyntheticAttempt(user:User|null):Promise<Phase5SyntheticAttempt|null>{
  const valid=student(user);
  const data=await request(valid,'result');
  if(!Object.prototype.hasOwnProperty.call(data,'attempt'))
    throw new Error('Máy chủ không trả trạng thái kết quả Phase 5.');
  return data.attempt===null?null:parseAttempt(data.attempt);
}

export async function submitPhase5SyntheticAttempt(
  user:User|null,answers:Phase5DemoAnswerMap,questionIds:readonly string[],
):Promise<SyntheticQuizReceipt<Phase5SyntheticAttempt>> {
  const valid=student(user);
  const canonical=canonicalPhase5Answers(answers,questionIds);
  return reconcileSyntheticQuizSubmission(
    async()=>{
      const data=await request(valid,'submit',canonical);
      const attempt=parseAttempt(data.attempt);
      if(attempt.totalCount!==questionIds.length)
        throw new Error('Biên nhận chấm bài không khớp số câu hỏi đã tải.');
      if(data.__existingDifferent===true||data.created===false)
        return {attempt,disposition:'existing' as const};
      if(data.created===true)
        return {attempt,disposition:'new' as const};
      // HTTP 200 without reliable commit status: recover by reading once.
      throw new SyntheticQuizDeliveryUncertainError();
    },
    ()=>readOwnPhase5SyntheticAttempt(valid),
  );
}
