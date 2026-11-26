// @ts-expect-error Bun runtime test imports have no browser TS declarations.
import {describe,test,expect,mock,beforeEach,afterAll} from 'bun:test';
import type {User} from 'firebase/auth';

// Phase 7E: TWO separate synthetic browser profiles sharing fake server state.
// Browser clients never store grades/tokens locally and never auto re-POST
// after the server may have committed. No real network or Cloudflare.
const ADMIN='SYNTHETIC_7E_GOOGLE_ADMIN';
mock.module('../src/firebase',()=>({
  BOOTSTRAPPED_ADMIN_UID:ADMIN,IS_FIREBASE_STAGING:true,
}));
const exam=await import('../src/utils/phase6StudentExam');
const history=await import('../src/utils/phase6Results');
const HOST='feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev';
const A='student_'+'a'.repeat(32);
const B='student_'+'b'.repeat(32);
const topic={topicId:'p6_demo_'+'e'.repeat(32),revision:2,
  title:'Toán học DEMO 7E',questionCount:2,timeLimitSeconds:300};
const session={sessionId:'p6_session_'+'a'.repeat(32),topicId:topic.topicId,
  revision:2,questionCount:2,timeLimitSeconds:300,
  startedAt:1800000000,expiresAt:1800000300,serverNow:1800000000};
const receipt={topicId:topic.topicId,revision:2,correctCount:2,totalCount:2,
  score:10,maxScore:10 as const,submittedAt:1800000045,
  status:'submitted' as const};
const questions=[
  {id:'q1',orderIndex:1,text:'2 + 2 = ?',options:['3','4','5','6']},
  {id:'q2',orderIndex:2,text:'10 - 3 = ?',options:['5','6','7','8']},
];
const TOKENS={A:'SYNTHETIC_PROFILE_A_TOKEN',
  PHONE:'SYNTHETIC_PROFILE_A_SECOND_DEVICE_TOKEN',
  B:'SYNTHETIC_PROFILE_B_TOKEN',ADMIN:'SYNTHETIC_ADMIN_TOKEN'};
const user=(uid:string,token:string)=>
  ({uid,getIdToken:async()=>token}) as unknown as User;
const pcA=user(A,TOKENS.A),phoneA=user(A,TOKENS.PHONE),
  browserB=user(B,TOKENS.B),admin=user(ADMIN,TOKENS.ADMIN);
const oldFetch=globalThis.fetch;
const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
const setHost=(hostname=HOST)=>Object.defineProperty(globalThis,'window',{
  configurable:true,value:{location:{hostname}},
});
beforeEach(()=>setHost());
afterAll(()=>{
  globalThis.fetch=oldFetch;
  if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);
  else Reflect.deleteProperty(globalThis,'window');
});
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{'content-type':'application/json'},
});
const EMPTY={mode:'phase6-student-history-readonly',
  entries:[],offset:0,nextOffset:null};
const OWN={...EMPTY,entries:[{...receipt,title:topic.title}]};
const SUMMARY={mode:'phase6-admin-results-readonly',summary:{
  attemptCount:1,studentCount:1,averageScore:10,maxScore:10,
}};

describe('Phase 7E separate browser identity and lost-response recovery',()=>{
  test('PC submission response drops; phone fetches server result with no second submit',async()=>{
    const calls:Array<{url:string;options:RequestInit;token:string;action:string}>=[];
    let committed=false;
    globalThis.fetch=(mock(async(url:string,options:RequestInit)=>{
      const request=JSON.parse(String(options.body)) as {action:string};
      const token=(options.headers as Record<string,string>).authorization;
      calls.push({url,options,token,action:request.action});
      if(request.action==='submit'){
        committed=true; // server D1 successfully saved the result once
        throw new Error('SYNTHETIC_LOST_HTTP_RESPONSE_AFTER_COMMIT');
      }
      if(request.action==='result')return response({result:committed?receipt:null});
      if(request.action==='list'&&url.includes('/results/'))return response(OWN);
      if(request.action==='start')return response({
        session,topic:{title:topic.title,questions},result:null,
      });
      throw Error('UNEXPECTED_SYNTHETIC_ACTION');
    })) as unknown as typeof globalThis.fetch;
    const started=await exam.startPhase6Exam(pcA,topic);
    expect(started.session).toEqual(session);
    await expect(exam.submitPhase6Exam(pcA,session,{q1:1,q2:2})).
      rejects.toThrow('Mất kết nối máy chủ');
    const recovered=await exam.readPhase6ExamResult(phoneA,topic);
    expect(recovered).toEqual(receipt);
    const historyOnPhone=await history.listPhase6OwnHistory(phoneA);
    expect(historyOnPhone.entries).toEqual([{...receipt,title:topic.title}]);
    expect(calls.filter(x=>x.action==='submit')).toHaveLength(1);
    expect(calls.filter(x=>x.action==='result')).toHaveLength(1);
    expect(calls[0].token).toBe('Bearer '+TOKENS.A);
    expect(calls[1].token).toBe('Bearer '+TOKENS.A);
    for(const x of calls.slice(2))
      expect(x.token).toBe('Bearer '+TOKENS.PHONE);
    expect(calls.every(x=>x.options.cache==='no-store'&&
      x.options.credentials==='same-origin'&&
      x.options.redirect==='error')).toBe(true);
    expect(JSON.stringify(recovered).includes(TOKENS.A)).toBe(false);
    expect(JSON.stringify(recovered).includes(TOKENS.PHONE)).toBe(false);
  });

  test('account A→B switch uses B token and B-only histories; Google Admin sees summary',async()=>{
    const calls:Array<{path:string;token:string;body:Record<string,unknown>}>=[];
    globalThis.fetch=(mock(async(path:string,options:RequestInit)=>{
      const body=JSON.parse(String(options.body)) as Record<string,unknown>;
      const token=(options.headers as Record<string,string>).authorization;
      calls.push({path,token,body});
      if(path==='/api/phase6/exam'){
        return response({result:token==='Bearer '+TOKENS.B?null:receipt});
      }
      if(path==='/api/phase6/results/student'){
        return response(token==='Bearer '+TOKENS.B?EMPTY:OWN);
      }
      if(path==='/api/phase6/results/admin'){
        return response(SUMMARY);
      }
      throw Error('UNEXPECTED_ENDPOINT');
    })) as unknown as typeof globalThis.fetch;
    expect((await exam.readPhase6ExamResult(pcA,topic))?.score).toBe(10);
    expect((await history.listPhase6OwnHistory(pcA)).entries).toEqual([{...receipt,title:topic.title}]);
    // New Firebase user/profile -> independent request identity, no A cache.
    expect(await exam.readPhase6ExamResult(browserB,topic)).toBeNull();
    expect((await history.listPhase6OwnHistory(browserB)).entries).toEqual([]);
    expect(await history.readPhase6AdminSummary(admin))
      .toEqual(SUMMARY.summary);
    expect(calls.map(x=>x.token)).toEqual([
      'Bearer '+TOKENS.A,'Bearer '+TOKENS.A,
      'Bearer '+TOKENS.B,'Bearer '+TOKENS.B,
      'Bearer '+TOKENS.ADMIN,
    ]);
    for(const req of calls){
      expect(Object.keys(req.body).some(k=>
        ['uid','username','password','score','correctIndex'].includes(k))).toBe(false);
    }
  });

  test('non-preview host and wrong role reject before any transport request',async()=>{
    let count=0;
    globalThis.fetch=(mock(async()=>{
      count++;return response({result:receipt});
    })) as unknown as typeof globalThis.fetch;
    for(const host of [
      'duongtrcnhiem-test.pages.dev',
      'duongtrcnhiem.pages.dev',
      HOST+'.evil.test',
      'random.duongtrcnhiem-test.pages.dev',
    ]){
      setHost(host);
      await expect(exam.readPhase6ExamResult(pcA,topic)).rejects.toThrow();
      await expect(history.listPhase6OwnHistory(pcA)).rejects.toThrow();
      await expect(history.readPhase6AdminSummary(admin)).rejects.toThrow();
    }
    setHost();
    await expect(exam.readPhase6ExamResult(admin,topic)).rejects.toThrow();
    await expect(history.listPhase6OwnHistory(admin)).rejects.toThrow();
    await expect(history.readPhase6AdminSummary(browserB)).rejects.toThrow();
    expect(count).toBe(0);
  });

  test('server failure or stale token never creates browser-side optimistic score',async()=>{
    const calls:string[]=[];
    globalThis.fetch=(mock(async(path:string,options:RequestInit)=>{
      const body=JSON.parse(String(options.body)) as {action:string};
      calls.push(body.action);
      if(body.action==='submit')return response({error:'SERVER_FAILURE'},503);
      if(body.action==='result')return response({result:null});
      if(path==='/api/phase6/results/student')return response(EMPTY);
      throw Error('UNEXPECTED_REQUEST');
    })) as unknown as typeof globalThis.fetch;
    await expect(exam.submitPhase6Exam(pcA,session,{q1:1,q2:2})).
      rejects.toThrow('D1 chưa thể xử lý');
    expect(await exam.readPhase6ExamResult(phoneA,topic)).toBeNull();
    expect((await history.listPhase6OwnHistory(phoneA)).entries).toEqual([]);
    expect(calls.filter(x=>x==='submit')).toHaveLength(1);
    expect(calls).toEqual(['submit','result','list']);
  });
});
