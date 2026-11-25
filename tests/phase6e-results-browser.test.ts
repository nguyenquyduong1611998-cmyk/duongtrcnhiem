// @ts-expect-error Bun test runtime module types are not browser declarations.
import {describe,test,expect,mock,beforeEach,afterAll} from 'bun:test';
import type {User} from 'firebase/auth';

// No live Firebase or Cloudflare. Only synthetic accounts/tokens.
const ADMIN_UID='SYNTHETIC_ADMIN_UID_6E';
mock.module('../src/firebase',()=>({
  BOOTSTRAPPED_ADMIN_UID:ADMIN_UID,IS_FIREBASE_STAGING:true,
}));
const client=await import('../src/utils/phase6Results');
const host='feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev';
const A='student_'+'a'.repeat(32),B='student_'+'b'.repeat(32);
const TOKEN='FAKE_RSA_JWT_DO_NOT_SEND_TO_REAL_PROVIDER';
const mkUser=(uid:string)=>({uid,getIdToken:async()=>TOKEN}) as unknown as User;
const originalFetch=globalThis.fetch;
const originalWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
function setHost(name:string){
  Object.defineProperty(globalThis,'window',{
    configurable:true,value:{location:{hostname:name}},
  });
}
beforeEach(()=>setHost(host));
afterAll(()=>{
  globalThis.fetch=originalFetch;
  if(originalWindow)Object.defineProperty(globalThis,'window',originalWindow);
  else Reflect.deleteProperty(globalThis,'window');
});
const score={
  topicId:'p6_demo_'+'c'.repeat(32),revision:2,title:'Toán học DEMO',
  correctCount:2,totalCount:2,score:10,maxScore:10,
  submittedAt:1800000001,status:'submitted',
};
const adminRow={username:'test_hv_'+'a'.repeat(12),...score};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{'content-type':'application/json'},
});
const studentPayload={
  mode:'phase6-student-history-readonly',
  entries:[{...score,correct_index:1,answers_json:'DO_NOT_DISPLAY',student_uid:A}],
  offset:0,nextOffset:null,
};
const adminPayload={
  mode:'phase6-admin-results-readonly',
  entries:[{...adminRow,correct_index:1,password_hash:'DO_NOT_DISPLAY',firebase_uid:A}],
  offset:0,nextOffset:null,
};

describe('Phase 6E Preview-only read-only browser scores',()=>{
  test('student sends only own signed list, strips unwanted server fields',async()=>{
    const calls:Array<{url:string,options:RequestInit}>=[];
    globalThis.fetch=(mock(async(url:string,options:RequestInit)=>{
      calls.push({url,options});return reply(studentPayload);
    })) as unknown as typeof globalThis.fetch;
    const data=await client.listPhase6OwnHistory(mkUser(A));
    expect(data.entries).toEqual([score]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/phase6/results/student');
    expect(JSON.parse(String(calls[0].options.body)))
      .toEqual({action:'list',offset:0});
    expect(calls[0].options.method).toBe('POST');
    expect(calls[0].options.credentials).toBe('same-origin');
    expect(calls[0].options.cache).toBe('no-store');
    expect(calls[0].options.redirect).toBe('error');
    expect((calls[0].options.headers as Record<string,string>).authorization)
      .toBe('Bearer '+TOKEN);
    for(const forbidden of ['correct_index','answers_json','student_uid',
      'DO_NOT_DISPLAY',TOKEN]){
      expect(JSON.stringify(data).includes(forbidden)).toBe(false);
    }
  });

  test('Admin only receives DEMO username plus score; summary math is checked',async()=>{
    const calls:Array<{url:string,options:RequestInit}>=[];
    globalThis.fetch=(mock(async(url:string,options:RequestInit)=>{
      calls.push({url,options});
      const request=JSON.parse(String(options.body)) as {action:string;offset?:number};
      return reply(request.action==='summary'
        ?{mode:'phase6-admin-results-readonly',summary:{
            attemptCount:2,studentCount:2,averageScore:5,maxScore:10,
          }}
        :adminPayload);
    })) as unknown as typeof globalThis.fetch;
    expect((await client.listPhase6AdminResults(mkUser(ADMIN_UID))).entries)
      .toEqual([adminRow]);
    expect(await client.readPhase6AdminSummary(mkUser(ADMIN_UID)))
      .toEqual({attemptCount:2,studentCount:2,averageScore:5,maxScore:10});
    expect(calls).toHaveLength(2);
    expect(calls.every(c=>c.url==='/api/phase6/results/admin')).toBe(true);
    const fields=JSON.stringify(calls.map(x=>x.options.body));
    for(const forbidden of ['uid','username','score','correctIndex','answers_json'])
      expect(fields.includes(forbidden)).toBe(false);
  });

  test('wrong identity, hostname, or pagination never sends network request',async()=>{
    let count=0;
    globalThis.fetch=(mock(async()=>{count++;return reply({});})) as unknown as typeof globalThis.fetch;
    for(const invalid of [null,mkUser('other_user'),mkUser(ADMIN_UID)])
      await expect(client.listPhase6OwnHistory(invalid)).rejects.toThrow();
    for(const invalid of [null,mkUser(A),mkUser(B)])
      await expect(client.listPhase6AdminResults(invalid)).rejects.toThrow();
    for(const offset of [-1,1,24,10025,Infinity,NaN]){
      await expect(client.listPhase6OwnHistory(mkUser(A),offset)).rejects.toThrow();
      await expect(client.listPhase6AdminResults(mkUser(ADMIN_UID),offset))
        .rejects.toThrow();
    }
    for(const other of [
      'duongtrcnhiem.pages.dev','duongtrcnhiem-test.pages.dev',
      host+'.attacker.example','feature-random.duongtrcnhiem-test.pages.dev',
    ]){
      setHost(other);
      await expect(client.listPhase6OwnHistory(mkUser(A))).rejects.toThrow();
      await expect(client.listPhase6AdminResults(mkUser(ADMIN_UID)))
        .rejects.toThrow();
      expect(client.isPhase6StudentHistoryUiEnabled(other,'true')).toBe(false);
      expect(client.isPhase6AdminResultsUiEnabled(other,'true')).toBe(false);
    }
    expect(count).toBe(0);
  });

  test('malformed or leaked score fields are never trusted as user-visible rows',async()=>{
    for(const invalid of [
      {...score,score:0},{...score,correctCount:3},
      {...score,topicId:'real_internal_topic'},
      {...score,maxScore:20},{...score,revision:0},
      {...score,submittedAt:-1},
    ]){
      globalThis.fetch=(mock(async()=>reply({
        mode:'phase6-student-history-readonly',offset:0,nextOffset:null,
        entries:[invalid],
      }))) as unknown as typeof globalThis.fetch;
      await expect(client.listPhase6OwnHistory(mkUser(A))).rejects.toThrow();
    }
    for(const invalid of [
      {...adminRow,username:'real_student_name'},
      {...adminRow,username:'test_hv_bogus'},
    ]){
      globalThis.fetch=(mock(async()=>reply({
        ...adminPayload,entries:[invalid],
      }))) as unknown as typeof globalThis.fetch;
      await expect(client.listPhase6AdminResults(mkUser(ADMIN_UID)))
        .rejects.toThrow();
    }
    globalThis.fetch=(mock(async()=>reply({
      mode:'phase6-admin-results-readonly',summary:{
        attemptCount:0,studentCount:1,averageScore:6,maxScore:10,
      },
    }))) as unknown as typeof globalThis.fetch;
    await expect(client.readPhase6AdminSummary(mkUser(ADMIN_UID)))
      .rejects.toThrow();
  });

  test('HTTP rejection/network failure does not leak body or JWT',async()=>{
    for(const status of [401,403,404,503]){
      globalThis.fetch=(mock(async()=>reply({secret:'DO_NOT_REFLECT'},status)))
        as unknown as typeof globalThis.fetch;
      for(const fn of [
        ()=>client.listPhase6OwnHistory(mkUser(A)),
        ()=>client.listPhase6AdminResults(mkUser(ADMIN_UID)),
      ]){
        let message='';
        try{await fn();}catch(error){message=String(error);}
        expect(message.length).toBeGreaterThan(0);
        expect(message.includes('DO_NOT_REFLECT')).toBe(false);
        expect(message.includes(TOKEN)).toBe(false);
      }
    }
    globalThis.fetch=(mock(async()=>{throw new Error('network details private');}))
      as unknown as typeof globalThis.fetch;
    await expect(client.listPhase6OwnHistory(mkUser(A))).rejects.toThrow(
      'Không kết nối được D1'
    );
  });
});
