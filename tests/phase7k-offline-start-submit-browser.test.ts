// @ts-expect-error Bun runtime test imports aren't in browser TS declarations.
import {test,expect,mock,beforeEach,afterAll} from 'bun:test';
import {readFileSync} from 'node:fs';
import type {User} from 'firebase/auth';

// Isolated fake server/transport with two devices: NO live Firebase/D1/Cloudflare.
// All IDs, access tokens, arithmetic and grades are fake.
const ADMIN='SYNTHETIC_7K_GOOGLE_ADMIN';
mock.module('../src/firebase',()=>({
  BOOTSTRAPPED_ADMIN_UID:ADMIN,IS_FIREBASE_STAGING:true,
}));
const exam=await import('../src/utils/phase6StudentExam');
const history=await import('../src/utils/phase6Results');

const HOST='feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev';
const A='student_'+'a'.repeat(32);
const B='student_'+'b'.repeat(32);
const TOPIC='p6_demo_'+'c'.repeat(32);
const SESSION='p6_session_'+'d'.repeat(32);
const tokens={pc:'SYNTHETIC_PC_TOKEN',phone:'SYNTHETIC_PHONE_TOKEN',
  b:'SYNTHETIC_B_TOKEN',admin:'SYNTHETIC_ADMIN_TOKEN'};
const user=(uid:string,token:string)=>({
  uid,getIdToken:async()=>token,
}) as unknown as User;
const pc=user(A,tokens.pc),phone=user(A,tokens.phone),
  other=user(B,tokens.b),admin=user(ADMIN,tokens.admin);
const topic={topicId:TOPIC,revision:2,title:'Toán học giả DEMO',
  questionCount:2,timeLimitSeconds:300};
const questions=[
  {id:'q1',orderIndex:1,text:'2 + 2 = ?',options:['3','4','5','6']},
  {id:'q2',orderIndex:2,text:'10 - 3 = ?',options:['5','6','7','8']},
];
const initial=1_800_000_000;
const oldFetch=globalThis.fetch,oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{'content-type':'application/json'},
});

type ServerSession={
  sessionId:string;topicId:string;revision:number;questionCount:number;
  timeLimitSeconds:number;startedAt:number;expiresAt:number;serverNow:number;
};
type Grade={
  topicId:string;revision:number;correctCount:number;totalCount:number;
  score:number;maxScore:10;submittedAt:number;status:'submitted';
};
let now=initial;
let active:ServerSession|null=null;
let grade:Grade|null=null;
let startResponseLost=false,submitResponseLost=false,dropBeforeCommit=false,
  offline=false;
let requestLog:Array<{endpoint:string;action:string;token:string;body:Record<string,unknown>;options:RequestInit}>=[];
function configure(){
  now=initial;active=null;grade=null;startResponseLost=false;
  submitResponseLost=false;dropBeforeCommit=false;offline=false;
  requestLog=[];
  Object.defineProperty(globalThis,'window',{
    configurable:true,value:{location:{hostname:HOST}},
  });
  globalThis.fetch=(mock(async(endpoint:string,options:RequestInit)=>{
    const body=JSON.parse(String(options.body)) as Record<string,unknown>;
    const action=String(body.action);
    const token=(options.headers as Record<string,string>).authorization;
    requestLog.push({endpoint,action,token,body,options});
    if(offline)throw new Error('SYNTHETIC_NETWORK_OFFLINE');
    const uid=token==='Bearer '+tokens.b?B:
      token==='Bearer '+tokens.admin?ADMIN:A;
    if(endpoint==='/api/phase6/exam'){
      if(action==='start'){
        if(uid===B)return reply({error:'FORBIDDEN'},401);
        if(!active)active={
          sessionId:SESSION,topicId:TOPIC,revision:2,questionCount:2,
          timeLimitSeconds:300,startedAt:now,expiresAt:now+300,
          serverNow:now,
        };
        if(startResponseLost){
          startResponseLost=false;
          throw new Error('SYNTHETIC_RESPONSE_LOST_AFTER_SESSION_INSERT');
        }
        return reply({session:{...active,serverNow:now},
          topic:{title:topic.title,questions},result:grade});
      }
      if(action==='read'){
        if(uid===B)return reply({session:null});
        return active?reply({session:{...active,serverNow:now},
          topic:{title:topic.title,questions},result:grade}):reply({session:null});
      }
      if(action==='result'){
        return reply({result:uid===A?grade:null});
      }
      if(action==='submit'){
        if(uid!==A||!active||now>active.expiresAt)
          return reply({error:'DEADLINE_EXPIRED'},409);
        if(dropBeforeCommit)throw new Error('SYNTHETIC_NETWORK_OFFLINE_BEFORE_COMMIT');
        if(!grade)grade={
          topicId:TOPIC,revision:2,correctCount:2,totalCount:2,
          score:10,maxScore:10,submittedAt:now,status:'submitted',
        };
        if(submitResponseLost){
          submitResponseLost=false;
          throw new Error('SYNTHETIC_RESPONSE_LOST_AFTER_GRADE_COMMIT');
        }
        return reply({result:grade});
      }
    }
    if(endpoint==='/api/phase6/results/student'&&action==='list'){
      return reply({mode:'phase6-student-history-readonly',offset:0,nextOffset:null,
        entries:uid===A&&grade?[{...grade,title:topic.title}]:[]});
    }
    if(endpoint==='/api/phase6/results/admin'&&action==='summary'){
      return reply({mode:'phase6-admin-results-readonly',summary:{
        attemptCount:grade?1:0,studentCount:grade?1:0,
        averageScore:grade?10:null,maxScore:10,
      }});
    }
    throw new Error('UNEXPECTED_SYNTHETIC_REQUEST');
  })) as unknown as typeof globalThis.fetch;
}
beforeEach(configure);
afterAll(()=>{
  globalThis.fetch=oldFetch;
  if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);
  else Reflect.deleteProperty(globalThis,'window');
});

test('PC start commits then loses response; phone reads same immutable session and deadline',async()=>{
  startResponseLost=true;
  await expect(exam.startPhase6Exam(pc,topic))
    .rejects.toThrow('Mất kết nối máy chủ');
  expect(active?.startedAt).toBe(initial);
  now+=180;
  const onPhone=await exam.readPhase6Exam(phone,topic);
  const onPc=await exam.readPhase6Exam(pc,topic);
  expect(onPhone.session?.sessionId).toBe(SESSION);
  expect(onPc.session?.expiresAt).toBe(initial+300);
  expect(onPhone.session?.expiresAt).toBe(initial+300);
  expect(onPhone.session?.serverNow).toBe(initial+180);
  expect(onPhone.result).toBeNull();
  expect(onPhone.topic?.questions).toHaveLength(2);
  expect(requestLog.map(x=>x.action)).toEqual(['start','read','read']);
  expect(requestLog.filter(x=>x.action==='submit')).toHaveLength(0);
});

test('submission committed but response lost: result/history visible on phone and Admin, no retry',async()=>{
  await exam.startPhase6Exam(pc,topic);
  now+=45;
  submitResponseLost=true;
  await expect(exam.submitPhase6Exam(pc,active!,{q1:1,q2:2}))
    .rejects.toThrow('Mất kết nối máy chủ');
  expect(grade?.score).toBe(10);
  const phoneResult=await exam.readPhase6ExamResult(phone,topic);
  const phoneHistory=await history.listPhase6OwnHistory(phone);
  const bHistory=await history.listPhase6OwnHistory(other);
  const adminSummary=await history.readPhase6AdminSummary(admin);
  expect(phoneResult?.score).toBe(10);
  expect(phoneHistory.entries).toEqual([{...grade,title:topic.title}]);
  expect(bHistory.entries).toHaveLength(0);
  expect(adminSummary).toEqual({attemptCount:1,studentCount:1,averageScore:10,maxScore:10});
  expect(requestLog.filter(x=>x.action==='submit')).toHaveLength(1);
  expect(requestLog.map(x=>x.token)).toEqual([
    'Bearer '+tokens.pc,'Bearer '+tokens.pc,
    'Bearer '+tokens.phone,'Bearer '+tokens.phone,
    'Bearer '+tokens.b,'Bearer '+tokens.admin,
  ]);
  expect(JSON.stringify(phoneHistory)).not.toContain(tokens.pc);
  expect(JSON.stringify(phoneHistory)).not.toContain(tokens.phone);
  expect(requestLog.every(x=>x.options.cache==='no-store'&&
    x.options.redirect==='error'&&x.options.credentials==='same-origin'))
    .toBe(true);
});

test('no commit while offline: D1 returns null, manual submit still governed by original deadline',async()=>{
  await exam.startPhase6Exam(pc,topic);
  dropBeforeCommit=true;
  await expect(exam.submitPhase6Exam(pc,active!,{q1:1,q2:2}))
    .rejects.toThrow('Mất kết nối máy chủ');
  expect(grade).toBeNull();
  dropBeforeCommit=false;
  now+=299;
  expect(await exam.readPhase6ExamResult(phone,topic)).toBeNull();
  const resumed=await exam.readPhase6Exam(phone,topic);
  expect(resumed.session?.sessionId).toBe(SESSION);
  expect(resumed.session?.expiresAt).toBe(initial+300);
  now+=2;
  await expect(exam.submitPhase6Exam(phone,resumed.session!,{q1:1,q2:2}))
    .rejects.toThrow('Đã hết thời gian');
  expect(await exam.readPhase6ExamResult(phone,topic)).toBeNull();
  expect(requestLog.filter(x=>x.action==='submit')).toHaveLength(2);
  expect(grade).toBeNull();
});

test('offline result lookup fails closed and never causes a second POST submit',async()=>{
  await exam.startPhase6Exam(pc,topic);
  submitResponseLost=true;
  await expect(exam.submitPhase6Exam(pc,active!,{q1:1,q2:2}))
    .rejects.toThrow();
  offline=true;
  await expect(exam.readPhase6ExamResult(phone,topic))
    .rejects.toThrow('Mất kết nối máy chủ');
  await expect(history.listPhase6OwnHistory(phone))
    .rejects.toThrow('Không kết nối được D1');
  expect(requestLog.filter(x=>x.action==='submit')).toHaveLength(1);
  offline=false;
  expect((await exam.readPhase6ExamResult(phone,topic))?.score).toBe(10);
});

test('UI requires explicit D1 lookup after an unconfirmed submit and offers manual session recovery',()=>{
  const panel=readFileSync('src/components/Phase6StudentExamPanel.tsx','utf8');
  expect(panel).toContain('const [unconfirmedSubmitId,setUnconfirmedSubmitId]');
  expect(panel).toContain('unconfirmedSubmitId===session.sessionId');
  expect(panel).toContain('Đọc lại phiên từ D1 (sau mất mạng)');
  expect(panel).toContain('Chưa xác định bài nộp đã được lưu hay chưa');
  expect(panel).toContain('const stored=await readPhase6ExamResult(user,chosen)');
  expect(panel).not.toContain('localStorage.');
  expect(panel).not.toContain('sessionStorage.');
  expect(panel).not.toContain('indexedDB.');
  expect(panel).not.toContain('setInterval(()=>submit');
});
