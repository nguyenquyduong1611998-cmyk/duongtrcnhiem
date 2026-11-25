// @ts-expect-error Bun's runner-only test module lacks browser TypeScript declarations.
import {describe,test,expect,mock,beforeEach,afterAll} from 'bun:test';
import type {User} from 'firebase/auth';

// Synthetic credentials and mock network only; no real Firebase or D1 calls.
mock.module('../src/firebase',()=>({IS_FIREBASE_STAGING:true}));
const client=await import('../src/utils/phase5SyntheticSubmission');
const host='feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev';
const uid='student_'+'a'.repeat(32);
const token='FAKE_NOT_A_REAL_FIREBASE_TOKEN';
const user=(userId=uid):User=>({uid:userId,getIdToken:async()=>token}) as unknown as User;
const baseAttempt={
  topicId:'p5_demo_math',revision:1,correctCount:2,totalCount:2,
  score:10,maxScore:10,submittedAt:1800000000,
  mode:'phase5-synthetic-server-graded',
};
const goodAnswers={q1:1,q2:1};
const ids=['q1','q2'];
const savedFetch=globalThis.fetch;
const savedWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
function setHost(h:string){
  Object.defineProperty(globalThis,'window',{
    configurable:true,value:{location:{hostname:h}},
  });
}
function reply(json:unknown,status=200):Response{
  return new Response(JSON.stringify(json),{
    status,headers:{'content-type':'application/json'},
  });
}
beforeEach(()=>setHost(host));
afterAll(()=>{
  globalThis.fetch=savedFetch;
  if(savedWindow)Object.defineProperty(globalThis,'window',savedWindow);
  else Reflect.deleteProperty(globalThis,'window');
});

describe('Phase 5E DEMO browser submits only after explicit opt-in',()=>{
  test('feature flag requires true and the exact pinned Preview alias',()=>{
    expect(client.isPhase5SyntheticSubmitUiEnabled(host,undefined)).toBe(false);
    expect(client.isPhase5SyntheticSubmitUiEnabled(host,'false')).toBe(false);
    expect(client.isPhase5SyntheticSubmitUiEnabled(host,false)).toBe(false);
    expect(client.isPhase5SyntheticSubmitUiEnabled(host,'true')).toBe(true);
    for(const wrongHost of [
      'duongtrcnhiem-test.pages.dev',
      'duongtrcnhiem.pages.dev',
      'feature-other.duongtrcnhiem-test.pages.dev',
      host+'.attacker.example',
    ])expect(client.isPhase5SyntheticSubmitUiEnabled(wrongHost,'true')).toBe(false);
  });

  test('server owns score, browser sends only exact synthetic answer map and Firebase bearer',async()=>{
    const requests:Array<{url:string,init:RequestInit}>=[];
    globalThis.fetch=mock(async(url:string,init:RequestInit)=>{
      requests.push({url,init});
      return reply({attempt:{...baseAttempt,score:10,secret:'do-not-project'},created:true});
    }) as unknown as typeof globalThis.fetch;
    const result=await client.submitPhase5SyntheticAttempt(user(),{q2:1,q1:1},ids);
    expect(result).toEqual({attempt:baseAttempt,disposition:'new'});
    expect(requests).toHaveLength(1);
    const req=requests[0];
    expect(req.url).toBe('/api/phase5/attempts/student');
    expect(req.init.method).toBe('POST');
    expect(req.init.credentials).toBe('same-origin');
    expect(req.init.cache).toBe('no-store');
    expect(req.init.redirect).toBe('error');
    expect((req.init.headers as Record<string,string>).authorization)
      .toBe('Bearer '+token);
    const body=JSON.parse(String(req.init.body));
    expect(body).toEqual({
      action:'submit',topicId:'p5_demo_math',revision:1,
      answers:{q1:1,q2:1},
    });
    for(const forbidden of ['uid','score','correctIndex','student_uid',
      'correct_index','password','token']){
      expect(JSON.stringify(body).includes(forbidden)).toBe(false);
      expect(JSON.stringify(result).includes(forbidden)).toBe(false);
    }
  });

  test('readOwn only queries result for this Firebase student, no score sent',async()=>{
    globalThis.fetch=mock(async(url:string,init:RequestInit)=>{
      expect(url).toBe('/api/phase5/attempts/student');
      expect(init.method).toBe('POST');
      expect(JSON.parse(String(init.body))).toEqual({
        action:'result',topicId:'p5_demo_math',revision:1,
      });
      return reply({attempt:baseAttempt});
    }) as unknown as typeof globalThis.fetch;
    expect(await client.readOwnPhase5SyntheticAttempt(user()))
      .toEqual(baseAttempt);
  });

  test('lost submit response triggers one own-result read, never a second submit',async()=>{
    const requests:string[]=[];
    globalThis.fetch=mock(async(_url:string,init:RequestInit)=>{
      const action=JSON.parse(String(init.body)).action as string;
      requests.push(action);
      if(action==='submit')throw new Error('Network terminated after D1 commit');
      return reply({attempt:baseAttempt});
    }) as unknown as typeof globalThis.fetch;
    const result=await client.submitPhase5SyntheticAttempt(user(),goodAnswers,ids);
    expect(result).toEqual({attempt:baseAttempt,disposition:'recovered'});
    expect(requests).toEqual(['submit','result']);
  });

  test('no D1 attempt after network failure is uncertain, not proof of a safe resubmit',async()=>{
    const requests:string[]=[];
    globalThis.fetch=mock(async(_url:string,init:RequestInit)=>{
      const action=JSON.parse(String(init.body)).action as string;
      requests.push(action);
      if(action==='submit')throw new Error('lost');
      return reply({attempt:null});
    }) as unknown as typeof globalThis.fetch;
    await expect(client.submitPhase5SyntheticAttempt(user(),goodAnswers,ids))
      .rejects.toThrow('Không rõ máy chủ đã nhận bài');
    expect(requests).toEqual(['submit','result']);
  });

  test('HTTP 409 returns existing original score; never repeats a POST',async()=>{
    let calls=0;
    globalThis.fetch=mock(async()=>{
      calls++;
      return reply({error:'ALREADY_SUBMITTED',
        attempt:{...baseAttempt,score:0,correctCount:0}},409);
    }) as unknown as typeof globalThis.fetch;
    const result=await client.submitPhase5SyntheticAttempt(user(),goodAnswers,ids);
    expect(result.disposition).toBe('existing');
    expect(result.attempt.score).toBe(0);
    expect(calls).toBe(1);
  });

  test('HTTP 401/403/404/5xx do not masquerade as successful or trigger a result read',async()=>{
    for(const status of [401,403,404,500,503]){
      let calls=0;
      globalThis.fetch=mock(async()=>{
        calls++;return reply({error:'NO_SENSITIVE_DETAILS'},status);
      }) as unknown as typeof globalThis.fetch;
      await expect(client.submitPhase5SyntheticAttempt(user(),goodAnswers,ids))
        .rejects.toThrow();
      expect(calls).toBe(1);
    }
  });

  test('invalid answers and untrusted identity never attempt network',async()=>{
    let calls=0;
    globalThis.fetch=(mock(async()=>{calls++;return reply({attempt:null});})) as unknown as typeof globalThis.fetch;
    for(const answers of [
      {q1:1}, {q1:1,q2:4}, {q1:1,q2:1,other:0},
      {q1:1,q2:1.5}, {q1:-1,q2:1},
    ]){
      await expect(client.submitPhase5SyntheticAttempt(user(),answers,ids))
        .rejects.toThrow();
    }
    for(const badUser of [null,user('admin'),user('student_invalid')])
      await expect(client.readOwnPhase5SyntheticAttempt(badUser)).rejects.toThrow();
    setHost('duongtrcnhiem.pages.dev');
    await expect(client.submitPhase5SyntheticAttempt(user(),goodAnswers,ids))
      .rejects.toThrow();
    expect(calls).toBe(0);
  });

  test('a failed Firebase token refresh happens before any POST and is not assumed saved',async()=>{
    let calls=0;
    globalThis.fetch=(mock(async()=>{calls++;return reply({attempt:baseAttempt});})) as unknown as typeof globalThis.fetch;
    const brokenUser=({uid,getIdToken:async()=>{throw new Error('token refresh failed')}}) as unknown as User;
    await expect(client.submitPhase5SyntheticAttempt(brokenUser,goodAnswers,ids))
      .rejects.toThrow('token refresh failed');
    expect(calls).toBe(0);
  });

  test('malformed success without created status reads stored result once',async()=>{
    const requests:string[]=[];
    globalThis.fetch=mock(async(_url:string,init:RequestInit)=>{
      const action=JSON.parse(String(init.body)).action as string;
      requests.push(action);
      return action==='submit'?
        reply({attempt:baseAttempt}):reply({attempt:baseAttempt});
    }) as unknown as typeof globalThis.fetch;
    const r=await client.submitPhase5SyntheticAttempt(user(),goodAnswers,ids);
    expect(r.disposition).toBe('recovered');
    expect(requests).toEqual(['submit','result']);
  });
});
