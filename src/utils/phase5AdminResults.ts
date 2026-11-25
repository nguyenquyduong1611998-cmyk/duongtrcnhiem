// Phase 5F: Google Admin staging only, read-only synthetic D1 results.
// No student UID, answers or private key material enters the UI.
import type {User} from 'firebase/auth';
import {IS_FIREBASE_STAGING,BOOTSTRAPPED_ADMIN_UID} from '../firebase';
import {isPhase5DemoPreviewHostname} from './phase5DemoTopics';

const USERNAME=/^test_hv_[a-f0-9]{12}$/;
const ENDPOINT='/api/phase5/attempts/admin';

export interface Phase5AdminScore {
  username:string;
  topicId:'p5_demo_math';
  revision:1;
  correctCount:number;
  totalCount:number;
  score:number;
  maxScore:10;
  submittedAt:number;
}

function record(raw:unknown):Record<string,unknown>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))
    throw new Error('Dữ liệu bảng điểm Phase 5 không hợp lệ.');
  return raw as Record<string,unknown>;
}
function parsedScore(raw:unknown):Phase5AdminScore {
  const x=record(raw);
  if(typeof x.username!=='string'||!USERNAME.test(x.username)||
     x.topicId!=='p5_demo_math'||x.revision!==1||
     !Number.isSafeInteger(x.correctCount)||
     !Number.isSafeInteger(x.totalCount)||
     Number(x.totalCount)<1||Number(x.totalCount)>500||
     Number(x.correctCount)<0||
     Number(x.correctCount)>Number(x.totalCount)||
     typeof x.score!=='number'||!Number.isFinite(x.score)||
     x.score<0||x.score>10||
     Math.abs(x.score*10-Math.round(
       Number(x.correctCount)*100/Number(x.totalCount)))>0.000001||
     x.maxScore!==10||
     !Number.isSafeInteger(x.submittedAt)||Number(x.submittedAt)<=0)
    throw new Error('Kết quả DEMO Phase 5 không hợp lệ.');
  return {
    username:x.username,topicId:'p5_demo_math',revision:1,
    correctCount:Number(x.correctCount),totalCount:Number(x.totalCount),
    score:x.score,maxScore:10,submittedAt:Number(x.submittedAt),
  };
}

export async function listPhase5AdminScores(user:User|null):Promise<Phase5AdminScore[]>{
  if(!IS_FIREBASE_STAGING||!user||user.uid!==BOOTSTRAPPED_ADMIN_UID||
    typeof window==='undefined'||
    !isPhase5DemoPreviewHostname(window.location.hostname))
    throw new Error('Chỉ Google Admin staging trên đúng Preview được xem điểm DEMO.');
  const token=await user.getIdToken();
  if(typeof token!=='string'||!token)
    throw new Error('Phiên đăng nhập Google Admin chưa sẵn sàng.');
  let response:Response;
  try{
    response=await fetch(ENDPOINT,{
      method:'POST',
      headers:{
        'content-type':'application/json',
        authorization:`Bearer ${token}`,
      },
      body:JSON.stringify({action:'list'}),
      credentials:'same-origin',cache:'no-store',redirect:'error',
    });
  }catch{
    throw new Error('Không kết nối được D1 để đọc bảng điểm DEMO. Hãy thử lại.');
  }
  if(response.status===404)
    throw new Error('Bảng điểm Google Admin Phase 5 chưa được bật trên Preview.');
  if(response.status===401||response.status===403)
    throw new Error('Bạn cần đăng nhập đúng Google Admin staging.');
  if(!response.ok)
    throw new Error('Máy chủ chưa thể đọc bảng điểm Phase 5 từ D1.');
  const payload=record(await response.json().catch(()=>null));
  if(payload.mode!=='phase5-synthetic-admin-readonly'||
    payload.topicId!=='p5_demo_math'||payload.revision!==1||
    !Array.isArray(payload.attempts)||payload.attempts.length>100||
    payload.count!==payload.attempts.length)
    throw new Error('Máy chủ trả danh sách điểm Phase 5 không hợp lệ.');
  const list=payload.attempts.map(parsedScore);
  if(new Set(list.map(row=>row.username)).size!==list.length)
    throw new Error('Danh sách điểm Phase 5 có tài khoản trùng lặp.');
  return list;
}
