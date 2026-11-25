// @ts-expect-error Bun runtime test imports have no browser TypeScript type declarations.
import {describe,test,expect,mock,beforeEach,afterAll} from 'bun:test';
import type {User} from 'firebase/auth';

const ADMIN='SYNTHETIC_PHASE7A_ADMIN_UID';
mock.module('../src/firebase',()=>({
  BOOTSTRAPPED_ADMIN_UID:ADMIN,IS_FIREBASE_STAGING:true,
}));
const client=await import('../src/utils/phase7PreviewPreflight');
const HOST='feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev';
const TOKEN='SYNTHETIC_NOT_REAL_JWT';
const admin={uid:ADMIN,getIdToken:async()=>TOKEN} as unknown as User;
const originalFetch=globalThis.fetch;
const originalWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
function host(h:string){
  Object.defineProperty(globalThis,'window',{
    configurable:true,value:{location:{hostname:h}},
  });
}
beforeEach(()=>host(HOST));
afterAll(()=>{
  globalThis.fetch=originalFetch;
  if(originalWindow)Object.defineProperty(globalThis,'window',originalWindow);
  else Reflect.deleteProperty(globalThis,'window');
});
const valid={
  mode:'phase7a-preview-d1-schema-preflight',
  status:'MIGRATION_REVIEW_REQUIRED',
  stages:{
    baseline:'SCHEMA_CANDIDATE',
    phase6b:'ABSENT',phase6c:'ABSENT',phase6a:'ABSENT',phase6d:'ABSENT',
  },
  migrationOrder:['phase6b','phase6c','phase6a','phase6d'],
  targetDatabaseIdentityVerified:false,freshBackupVerified:false,
  liveRestoreVerified:false,schemaOnlyChecks:true,migrationsExecuted:false,
  deployAuthorized:false,
};
const reply=(body:unknown,status=200)=>
  new Response(JSON.stringify(body),{status});

describe('Phase 7A Google Admin browser Preview-only schema checker',()=>{
  test('only fixed inspect action, no SQL/UID or grades; strips all extra fields',async()=>{
    const calls:Array<{url:string,options:RequestInit}>=[];
    globalThis.fetch=(mock(async(url:string,options:RequestInit)=>{
      calls.push({url,options});
      return reply({...valid,extraSecret:'NEVER_SHOW',password_hash:'SECRET'});
    })) as unknown as typeof globalThis.fetch;
    const report=await client.readPhase7PreviewSchema(admin);
    expect(report).toEqual(valid);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/phase7/preflight');
    expect(calls[0].options.method).toBe('POST');
    expect(calls[0].options.cache).toBe('no-store');
    expect(calls[0].options.redirect).toBe('error');
    expect(calls[0].options.credentials).toBe('same-origin');
    expect((calls[0].options.headers as Record<string,string>).authorization)
      .toBe('Bearer '+TOKEN);
    expect(JSON.parse(String(calls[0].options.body)))
      .toEqual({action:'inspect'});
    for(const secret of ['SECRET','NEVER_SHOW','password_hash',TOKEN,'DROP TABLE'])
      expect(JSON.stringify(report).includes(secret)).toBe(false);
  });
  test('student, unknown Admin and other hostname never make HTTP request',async()=>{
    let calls=0;
    globalThis.fetch=(mock(async()=>{calls++;return reply(valid);}))
      as unknown as typeof globalThis.fetch;
    for(const user of [
      null,{uid:'student_'+'a'.repeat(32),getIdToken:async()=>TOKEN} as unknown as User,
    ]){
      await expect(client.readPhase7PreviewSchema(user)).rejects.toThrow();
    }
    for(const other of [
      'duongtrcnhiem.pages.dev','duongtrcnhiem-test.pages.dev',
      HOST+'.attacker.test','feature-else.duongtrcnhiem-test.pages.dev',
    ]){
      host(other);
      await expect(client.readPhase7PreviewSchema(admin)).rejects.toThrow();
      expect(client.isPhase7PreviewPreflightUiEnabled(other,'true')).toBe(false);
    }
    expect(client.isPhase7PreviewPreflightUiEnabled(HOST,'false')).toBe(false);
    expect(calls).toBe(0);
  });
  test('rejects server claims of deployment approval, mismatched phase or bad order',async()=>{
    for(const unsafe of [
      {...valid,deployAuthorized:true},
      {...valid,freshBackupVerified:true},
      {...valid,stages:{...valid.stages,phase6d:'READY'}},
      {...valid,migrationOrder:['phase6a','phase6b','phase6c','phase6d']},
      {...valid,status:'READY_TO_DEPLOY'},
      {...valid,stages:{baseline:'SCHEMA_CANDIDATE'}},
      {...valid,schemaOnlyChecks:false},
    ]){
      globalThis.fetch=(mock(async()=>reply(unsafe))) as unknown as typeof globalThis.fetch;
      await expect(client.readPhase7PreviewSchema(admin)).rejects.toThrow();
    }
  });
  test('network errors, 404, 403, 503 and token refresh errors do not leak secrets',async()=>{
    for(const status of [401,403,404,503]){
      globalThis.fetch=(mock(async()=>reply({private:'SERVER_SECRET'},status)))
        as unknown as typeof globalThis.fetch;
      let message='';
      try{await client.readPhase7PreviewSchema(admin);}
      catch(error){message=String(error);}
      expect(message.length).toBeGreaterThan(0);
      expect(message.includes(TOKEN)).toBe(false);
      expect(message.includes('SERVER_SECRET')).toBe(false);
    }
    globalThis.fetch=(mock(async()=>{throw new Error('hidden fetch error');}))
      as unknown as typeof globalThis.fetch;
    await expect(client.readPhase7PreviewSchema(admin)).rejects.toThrow(
      'Không thể kết nối Preview D1'
    );
    let calls=0;
    globalThis.fetch=(mock(async()=>{calls++;return reply(valid);}))
      as unknown as typeof globalThis.fetch;
    await expect(client.readPhase7PreviewSchema({
      uid:ADMIN,getIdToken:async()=>{throw new Error('private token error');},
    } as unknown as User)).rejects.toThrow();
    expect(calls).toBe(0);
  });
});
