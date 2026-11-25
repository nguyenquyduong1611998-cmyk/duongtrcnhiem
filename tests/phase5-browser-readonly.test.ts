// @ts-expect-error Bun's runner-only test module has no browser TypeScript types.
import {describe,test,expect,mock,afterAll,beforeEach} from 'bun:test';
import type {User} from 'firebase/auth';

// No live Firebase, network calls, Cloudflare bindings or actual student data.
mock.module('../src/firebase',()=>({IS_FIREBASE_STAGING:true}));
const client=await import('../src/utils/phase5DemoTopics');
const correctHost=client.PHASE5_STUDENT_PREVIEW_HOST;
const A='student_'+'a'.repeat(32);
const B='student_'+'b'.repeat(32);
const authToken='SYNTHETIC_NOT_A_VALID_FIREBASE_TOKEN';
const mkUser=(uid:string):User=>({uid,getIdToken:async()=>authToken}) as unknown as User;

const originalFetch=globalThis.fetch;
const originalWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
function host(name:string){
  Object.defineProperty(globalThis,'window',{
    configurable:true,value:{location:{hostname:name}}
  });
}
beforeEach(()=>host(correctHost));
afterAll(()=>{
  globalThis.fetch=originalFetch;
  if(originalWindow)Object.defineProperty(globalThis,'window',originalWindow);
  else Reflect.deleteProperty(globalThis,'window');
});

const goodSummary={
  topicId:'p5_demo_math',revision:1,code:'P5-DEMO',title:'Toán học DEMO',
  description:'Chuyên đề giả',timeLimitSeconds:600,questionCount:1,
};
const goodDetail={
  topicId:'p5_demo_math',revision:1,code:'P5-DEMO',title:'Toán học DEMO',
  description:'Chuyên đề giả',timeLimitSeconds:600,
  questions:[{id:'q1',orderIndex:1,text:'2 + 2 bằng bao nhiêu?',
    options:['3','4','5','6']}],
};
const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{'content-type':'application/json'},
});

describe('Phase5 DEMO student browser read-only contract',()=>{
  test('A and B use current Firebase token in GET only, no score/key in projected data',async()=>{
    const calls:Array<{url:string,options:RequestInit}>=[];
    globalThis.fetch=mock(async (url:string,options:RequestInit)=>{
      calls.push({url,options});
      if(url==='/api/phase5/topics')
        return respond({topics:[{...goodSummary,correctIndex:1,studentUid:A,
          passwordHash:'NEVER_SHOW',score:10}]});
      if(url==='/api/phase5/topics/p5_demo_math/versions/1')
        return respond({topic:{...goodDetail,correctIndex:1,score:10,
          questions:[{...goodDetail.questions[0],explanation:'NEVER_SHOW',
            correct_index:1,passwordHash:'NEVER_SHOW'}]}});
      throw new Error('UNEXPECTED_PATH');
    }) as unknown as typeof globalThis.fetch;
    for(const user of [mkUser(A),mkUser(B)]){
      const list=await client.listPhase5DemoTopics(user);
      expect(list).toEqual([goodSummary]);
      const detail=await client.readPhase5DemoTopic(user,'p5_demo_math',1);
      expect(detail).toEqual(goodDetail);
      for(const x of [list,detail]){
        const serialized=JSON.stringify(x);
        for(const forbidden of ['correctIndex','correct_index','explanation',
          'passwordHash','score','studentUid','NEVER_SHOW']){
          expect(serialized.includes(forbidden)).toBe(false);
        }
      }
    }
    expect(calls).toHaveLength(4);
    for(const call of calls){
      expect(call.options.method).toBe('GET');
      expect((call.options.headers as Record<string,string>).authorization)
        .toBe('Bearer '+authToken);
      expect(call.options.cache).toBe('no-store');
      expect(call.options.credentials).toBe('same-origin');
      expect(call.options.redirect).toBe('error');
      expect(call.options.body).toBeUndefined();
    }
  });

  test('unknown, locked-looking, wrong host or no Firebase identity never calls server',async()=>{
    let callCount=0;
    globalThis.fetch=mock(async ()=>{
      callCount++;return respond({topics:[]});
    }) as unknown as typeof globalThis.fetch;
    for(const user of [null,mkUser('not_a_student'),mkUser('student_bogus')]){
      await expect(client.listPhase5DemoTopics(user)).rejects.toThrow();
    }
    for(const other of [
      'duongtrcnhiem-test.pages.dev','duongtrcnhiem.pages.dev',
      'another.duongtrcnhiem-test.pages.dev',
      correctHost+'.evil.example',
    ]){
      host(other);
      await expect(client.listPhase5DemoTopics(mkUser(A))).rejects.toThrow();
    }
    expect(callCount).toBe(0);
  });

  test('rejects malformed revision/IDs before network and never sends client score',async()=>{
    let calls=0;
    globalThis.fetch=mock(async ()=>{calls++;return respond({topic:goodDetail});})
      as unknown as typeof globalThis.fetch;
    for(const [id,rev] of [
      ['internal_math',1],['p5_demo_math',0],
      ['p5_demo_math',100001],['p5_demo_math',1.5],
      ['p5_demo_math?uid=foo',1],
    ] as Array<[string,number]>){
      await expect(client.readPhase5DemoTopic(mkUser(A),id,rev)).rejects.toThrow();
    }
    expect(calls).toBe(0);
  });

  test('401, 403, 404 and missing schema are errors; token never in messages',async()=>{
    for(const status of [401,403,404,503]){
      globalThis.fetch=mock(async ()=>respond({error:'NEVER_REFLECT_SECRETS'},status))
        as unknown as typeof globalThis.fetch;
      let message='';
      try{await client.listPhase5DemoTopics(mkUser(A));}
      catch(e){message=String(e);}
      expect(message.length).toBeGreaterThan(0);
      expect(message.includes(authToken)).toBe(false);
      expect(message.includes('NEVER_REFLECT_SECRETS')).toBe(false);
    }
  });

  test('malformed data and mismatched topic or revision are not displayed',async()=>{
    for(const json of [
      {topics:[{...goodSummary,topicId:'internal_math'}]},
      {topics:[{...goodSummary,questionCount:0}]},
      {topics:[{...goodSummary,score:100,questionCount:'1'}]},
    ]){
      globalThis.fetch=mock(async ()=>respond(json)) as unknown as typeof globalThis.fetch;
      await expect(client.listPhase5DemoTopics(mkUser(A))).rejects.toThrow();
    }
    for(const json of [
      {topic:{...goodDetail,revision:2}},
      {topic:{...goodDetail,questions:[{...goodDetail.questions[0],options:['3','4']}]}},
      {topic:{...goodDetail,questions:[]}},
    ]){
      globalThis.fetch=mock(async ()=>respond(json)) as unknown as typeof globalThis.fetch;
      await expect(client.readPhase5DemoTopic(mkUser(A),'p5_demo_math',1))
        .rejects.toThrow();
    }
  });
});
