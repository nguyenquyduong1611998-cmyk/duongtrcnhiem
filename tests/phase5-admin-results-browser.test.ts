// @ts-expect-error Bun test runtime-only modules have no browser declaration.
import {describe,test,expect,mock,beforeEach,afterAll} from 'bun:test';
import type {User} from 'firebase/auth';

const ADMIN='SYNTHETIC_TEST_ADMIN_UID';
mock.module('../src/firebase',()=>({
  BOOTSTRAPPED_ADMIN_UID:ADMIN,IS_FIREBASE_STAGING:true,
}));
const client=await import('../src/utils/phase5AdminResults');
const host='feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev';
const TOKEN='MOCK_JWT_NOT_A_VALID_TOKEN';
const validUser={uid:ADMIN,getIdToken:async()=>TOKEN} as unknown as User;
const originalFetch=globalThis.fetch;
const originalWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
function setHost(hostname:string){
  Object.defineProperty(globalThis,'window',{
    configurable:true,value:{location:{hostname}},
  });
}
const attemptA={
  username:'test_hv_'+'a'.repeat(12),
  topicId:'p5_demo_math',revision:1,
  correctCount:1,totalCount:1,score:10,maxScore:10,submittedAt:1800000001,
};
const attemptB={
  username:'test_hv_'+'b'.repeat(12),
  topicId:'p5_demo_math',revision:1,
  correctCount:0,totalCount:1,score:0,maxScore:10,submittedAt:1800000002,
};
function reply(data:unknown,status=200){
  return new Response(JSON.stringify(data),{
    status,headers:{'content-type':'application/json'},
  });
}
beforeEach(()=>setHost(host));
afterAll(()=>{
  globalThis.fetch=originalFetch;
  if(originalWindow)
    Object.defineProperty(globalThis,'window',originalWindow);
  else Reflect.deleteProperty(globalThis,'window');
});

describe('Phase 5 Google Admin browser-only DEMO grades',()=>{
  test('sends only Google Admin Firebase bearer + list action to exact same-origin Preview',async()=>{
    const calls:Array<{url:string,init:RequestInit}>=[];
    globalThis.fetch=(mock(async(url:string,init:RequestInit)=>{
      calls.push({url,init});
      return reply({
        mode:'phase5-synthetic-admin-readonly',
        topicId:'p5_demo_math',revision:1,count:2,
        attempts:[
          {...attemptA,student_uid:'NEVER_SHOW_UID',answers_json:'NEVER_SHOW'},
          {...attemptB,correct_index:1,password_hash:'NEVER_SHOW'},
        ],
      });
    })) as unknown as typeof globalThis.fetch;
    const values=await client.listPhase5AdminScores(validUser);
    expect(values).toEqual([attemptA,attemptB]);
    expect(calls).toHaveLength(1);
    const c=calls[0];
    expect(c.url).toBe('/api/phase5/attempts/admin');
    expect(c.init.method).toBe('POST');
    expect(c.init.credentials).toBe('same-origin');
    expect(c.init.cache).toBe('no-store');
    expect(c.init.redirect).toBe('error');
    expect((c.init.headers as Record<string,string>).authorization)
      .toBe('Bearer '+TOKEN);
    expect(JSON.parse(String(c.init.body))).toEqual({action:'list'});
    for(const key of ['NEVER_SHOW','student_uid','correct_index',
      'answers_json','password_hash']){
      expect(JSON.stringify(values).includes(key)).toBe(false);
      expect(String(c.init.body).includes(key)).toBe(false);
    }
    expect(JSON.stringify(values).includes(TOKEN)).toBe(false);
  });

  test('wrong role, missing Firebase session, other host have zero requests',async()=>{
    let calls=0;
    globalThis.fetch=(mock(async()=>{calls++;return reply({});})) as unknown as typeof globalThis.fetch;
    const other={uid:'student_'+'a'.repeat(32),
      getIdToken:async()=>TOKEN} as unknown as User;
    await expect(client.listPhase5AdminScores(other)).rejects.toThrow();
    await expect(client.listPhase5AdminScores(null)).rejects.toThrow();
    for(const different of [
      'duongtrcnhiem.pages.dev','duongtrcnhiem-test.pages.dev',
      host+'.evil.test','feature-other.duongtrcnhiem-test.pages.dev',
    ]){
      setHost(different);
      await expect(client.listPhase5AdminScores(validUser)).rejects.toThrow();
    }
    expect(calls).toBe(0);
  });

  test('unauthorized, disabled flag, server unavailable and network are safe failures',async()=>{
    for(const status of [401,403,404,503]){
      globalThis.fetch=(mock(async()=>reply({error:'SECRET_DO_NOT_REFLECT'},status))) as unknown as typeof globalThis.fetch;
      let error='';
      try{await client.listPhase5AdminScores(validUser);}
      catch(cause){error=String(cause);}
      expect(error.length).toBeGreaterThan(0);
      expect(error.includes('SECRET_DO_NOT_REFLECT')).toBe(false);
      expect(error.includes(TOKEN)).toBe(false);
    }
    globalThis.fetch=(mock(async()=>{throw new Error('network no response');})) as unknown as typeof globalThis.fetch;
    await expect(client.listPhase5AdminScores(validUser)).rejects.toThrow(
      'Không kết nối được D1'
    );
  });

  test('rejects malformed rows, malformed scores, duplicate or invalid usernames',async()=>{
    for(const rows of [
      [{...attemptA,username:'actual_student_name'}],
      [{...attemptA,score:0}],
      [{...attemptA,correctCount:2}],
      [{...attemptA,score:10,maxScore:20}],
      [attemptA,attemptA],
      new Array(101).fill(attemptA),
    ]){
      globalThis.fetch=(mock(async()=>reply({
        mode:'phase5-synthetic-admin-readonly',
        topicId:'p5_demo_math',revision:1,count:rows.length,attempts:rows,
      }))) as unknown as typeof globalThis.fetch;
      await expect(client.listPhase5AdminScores(validUser)).rejects.toThrow();
    }
  });

  test('Firebase token refresh errors cause no request and no token output',async()=>{
    let calls=0;
    globalThis.fetch=(mock(async()=>{calls++;return reply({});})) as unknown as typeof globalThis.fetch;
    const user=({uid:ADMIN,getIdToken:async()=>{
      throw new Error('token refresh unavailable');
    }}) as unknown as User;
    await expect(client.listPhase5AdminScores(user)).rejects.toThrow();
    expect(calls).toBe(0);
  });
});
