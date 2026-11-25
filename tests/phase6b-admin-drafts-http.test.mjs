// Phase 6B isolated HTTP + SQLite rehearsal. Only synthetic math, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {PROJECT_ID,ADMIN_UID} from '../functions/_shared/auth.mjs';
import {PHASE4_PILOT_PREVIEW_HOST,PHASE4_PINNED_STAGING_HOST}
  from '../functions/_shared/phase4-host-guard.mjs';
import {onRequestPost as endpoint} from '../functions/api/phase6/admin/drafts.js';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const ORIGIN='https://'+PHASE4_PILOT_PREVIEW_HOST;
const PATH='/api/phase6/admin/drafts';
const NOW=Math.floor(Date.now()/1000);
const A='student_'+'a'.repeat(32);
const keyPair=await crypto.subtle.generateKey({
  name:'RSASSA-PKCS1-v1_5',hash:'SHA-256',
  modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),
},true,['sign','verify']);
const jwk={...(await crypto.subtle.exportKey('jwk',keyPair.publicKey)),
  kid:'phase6b-only-test-key',use:'sig'};
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
async function makeJwt(uid,provider='google.com',extra={}){
  const header=encode({alg:'RS256',kid:jwk.kid,typ:'JWT'});
  const body=encode({
    iss:'https://securetoken.google.com/'+PROJECT_ID,
    aud:PROJECT_ID,sub:uid,user_id:uid,
    iat:NOW,exp:NOW+3600,firebase:{sign_in_provider:provider},...extra,
  });
  const payload=header+'.'+body;
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keyPair.privateKey,
    new TextEncoder().encode(payload));
  return payload+'.'+Buffer.from(sig).toString('base64url');
}
const ADMIN=await makeJwt(ADMIN_UID),STUDENT=await makeJwt(A,'custom');
const FORGED=await makeJwt(A),WRONG_PROJECT=await makeJwt(ADMIN_UID,'google.com',{aud:'invalid'}),
  WRONG_PROVIDER=await makeJwt(ADMIN_UID,'custom');
const originalFetch=globalThis.fetch;
let keyReads=0;
globalThis.fetch=async(url)=>{
  keyReads++;
  assert.equal(url,'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  return new Response(JSON.stringify({keys:[jwk]}),{status:200});
};

function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync('serverless/d1-staging-schema.sql','utf8'));
  sqlite.exec(readFileSync('serverless/d1-phase4-synthetic-graded-quiz.sql','utf8'));
  sqlite.exec(readFileSync('serverless/d1-phase5-preview-additive-schema.sql','utf8'));
  sqlite.exec(readFileSync('serverless/d1-phase5-preview-synthetic-math-seed.sql','utf8'));
  sqlite.exec(readFileSync('serverless/d1-phase6b-synthetic-admin-drafts-draft.sql','utf8'));
  const queries=[];
  const d1={
    prepare(sql){
      queries.push(sql);
      const stmt=sqlite.prepare(sql);
      return {
        bind(...args){
          return {
            async run(){
              const result=stmt.run(...args);
              return {success:true,meta:{changes:result.changes}};
            },
            async first(){return stmt.get(...args)??null;},
            async all(){return {success:true,results:stmt.all(...args)};},
          };
        },
        async all(){return {success:true,results:stmt.all()};},
      };
    },
  };
  const env={
    AUTH_DB:d1,AUTH_DB_PREVIEW:d1,
    FIREBASE_PROJECT_ID:PROJECT_ID,STAGING_AUTH_ENABLED:'true',
    FIREBASE_SERVICE_ACCOUNT_EMAIL:'synthetic@'+PROJECT_ID+'.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY:'NEVER_USED_FOR_THIS_TEST',
    PHASE4_STAGING_HOSTNAME:PHASE4_PILOT_PREVIEW_HOST,
    PHASE4_PREVIEW_HOST_OPT_IN:'true',
    PHASE6_ADMIN_DRAFTS_ENABLED:'true',
  };
  const makeRequest=(body={action:'list'},jwt=ADMIN,opts={})=>{
    const url=opts.url??ORIGIN+PATH,method=opts.method??'POST';
    return new Request(url,{
      method,
      headers:{
        'content-type':opts.type??'application/json',
        ...(jwt?{authorization:'Bearer '+jwt}:{}),
        ...(opts.origin?{origin:opts.origin}:{}),
      },
      ...(method==='POST'?{body:JSON.stringify(body)}:{}),
    });
  };
  const call=(body={action:'list'},jwt=ADMIN,opts={})=>
    endpoint({env,request:makeRequest(body,jwt,opts)});
  const count=table=>sqlite.prepare('SELECT count(*) AS n FROM '+table).get().n;
  return {sqlite,env,d1,queries,call,count};
}
const create={action:'create',titleCode:'basic',minutes:30};
function assertNoExistingDataChanges(f,before){
  assert.deepEqual({
    students:f.count('demo_students'),oldScores:f.count('synthetic_graded_attempts'),
    topics:f.count('phase5_content_topics'),versions:f.count('phase5_content_versions'),
    phase5scores:f.count('phase5_content_attempts'),
  },before);
}
function snapshot(f){
  return {
    students:f.count('demo_students'),oldScores:f.count('synthetic_graded_attempts'),
    topics:f.count('phase5_content_topics'),versions:f.count('phase5_content_versions'),
    phase5scores:f.count('phase5_content_attempts'),
  };
}

test('Google Admin can create/list/get/save/delete synthetic drafts, metadata audit is durable',async()=>{
  const f=fixture();
  try{
    const before=snapshot(f);
    const created=await f.call(create);
    assert.equal(created.status,201);
    const data=await created.json();
    assert.match(data.draft.draftId,/^p6_demo_[a-f0-9]{32}$/);
    assert.equal(data.draft.title,'Toán học DEMO - Cơ bản');
    assert.equal(data.draft.minutes,30);
    assert.equal(data.draft.version,1);
    assert.equal(data.draft.questionCount,0);
    const id=data.draft.draftId;
    const list=await (await f.call()).json();
    assert.equal(list.mode,'phase6-synthetic-admin-drafts');
    assert.equal(list.drafts.length,1);
    assert.equal(list.drafts[0].draftId,id);
    assert.equal(list.drafts[0].templates,undefined);
    const saved=await f.call({
      action:'save',draftId:id,version:1,titleCode:'practice',minutes:45,
      templates:['sum_2_2','minus_10_3'],
    });
    assert.equal(saved.status,200);
    const body=await saved.json();
    assert.equal(body.draft.version,2);
    assert.equal(body.draft.questionCount,2);
    assert.equal(body.draft.questions[0].text,'2 + 2 = ?');
    assert.equal(body.draft.questions[1].text,'10 - 3 = ?');
    const publicJson=JSON.stringify(body);
    for(const forbidden of ['correctIndex','correct_index','answer_keys','student_uid',
      'password_hash','firebase_uid','explanation','token','PHASE5_STAGING_MODEL'])
      assert.equal(publicJson.includes(forbidden),false,forbidden);
    const loaded=await (await f.call({action:'get',draftId:id})).json();
    assert.deepEqual(loaded.draft,body.draft);
    assert.equal((await f.call({action:'delete',draftId:id,version:2})).status,200);
    assert.equal((await f.call({action:'get',draftId:id})).status,404);
    assert.equal(f.count('phase6_admin_drafts'),0);
    assert.deepEqual(f.sqlite.prepare(
      'SELECT event_type,version FROM phase6_admin_draft_events ORDER BY id'
    ).all(),[
      {event_type:'create',version:1},
      {event_type:'save',version:2},
      {event_type:'delete',version:2},
    ]);
    assertNoExistingDataChanges(f,before);
    assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{f.sqlite.close();}
});

test('optimistic version prevents stale updates, duplicate deletion and lost updates',async()=>{
  const f=fixture();
  try{
    const r=await (await f.call(create)).json();
    const id=r.draft.draftId;
    const op={action:'save',draftId:id,version:1,titleCode:'challenge',
      minutes:20,templates:['sum_3_5']};
    const [a,b]=await Promise.all([f.call(op),f.call({...op,minutes:90})]);
    assert.deepEqual([a.status,b.status].sort(),[200,409]);
    assert.equal((await f.call({action:'delete',draftId:id,version:1})).status,409);
    const fresh=await (await f.call({action:'get',draftId:id})).json();
    assert.equal(fresh.draft.version,2);
    assert.equal(fresh.draft.questionCount,1);
    assert.equal(f.count('phase6_admin_draft_events'),2);
  }finally{f.sqlite.close();}
});

test('anonymous/student/forged/admin wrong project or provider cannot read or write',async()=>{
  const f=fixture();
  try{
    const before=snapshot(f);
    for(const token of ['',STUDENT,FORGED,WRONG_PROJECT,WRONG_PROVIDER,'invalid.jwt.signature']){
      const response=await f.call(create,token);
      assert.equal(response.status,403);
      assert.deepEqual(await response.json(),{error:'ADMIN_AUTH_REQUIRED'});
    }
    assert.equal(f.count('phase6_admin_drafts'),0);
    assertNoExistingDataChanges(f,before);
    assert.equal(f.queries.length,0,'authorization is checked before database access');
  }finally{f.sqlite.close();}
});

test('flag OFF by default, wrong hosts and absent preview binding are fail-closed',async()=>{
  const f=fixture();
  try{
    for(const name of ['PHASE6_ADMIN_DRAFTS_ENABLED','PHASE4_PREVIEW_HOST_OPT_IN']){
      const value=f.env[name];delete f.env[name];
      assert.equal((await f.call(create)).status,404,name);
      f.env[name]=value;
    }
    for(const url of [
      'https://'+PHASE4_PINNED_STAGING_HOST+PATH,
      'https://another.'+PHASE4_PINNED_STAGING_HOST+PATH,
      'https://example.com'+PATH,
      ORIGIN+'.attacker.example'+PATH,
    ])assert.equal((await f.call(create,ADMIN,{url})).status,404,url);
    f.env.AUTH_DB_PREVIEW=undefined;
    assert.equal((await f.call(create)).status,503);
    assert.equal(f.count('phase6_admin_drafts'),0);
    assert.equal(f.queries.length,0);
  }finally{f.sqlite.close();}
});

test('body, origin, method, query and synthetic-only payload restrictions',async()=>{
  const f=fixture();
  try{
    assert.equal((await f.call(create,ADMIN,{method:'GET'})).status,405);
    assert.equal((await f.call(create,ADMIN,{type:'text/plain'})).status,415);
    assert.equal((await f.call(create,ADMIN,{origin:'https://evil.example'})).status,403);
    assert.equal((await f.call(create,ADMIN,{url:ORIGIN+PATH+'?role=admin'})).status,400);
    for(const payload of [
      {action:'create',titleCode:'Nội dung nội bộ',minutes:30},
      {action:'create',titleCode:'basic',minutes:0},
      {action:'create',titleCode:'basic',minutes:241},
      {action:'create',titleCode:'basic',minutes:1.5},
      {action:'create',titleCode:'basic',minutes:30,uid:A},
      {action:'publish',draftId:'p6_demo_'+ 'a'.repeat(32)},
      {action:'import',questions:[{text:'confidential'}]},
      {action:'save',draftId:'p6_demo_'+'a'.repeat(32),version:1,titleCode:'basic',
        minutes:10,templates:['secret_question']},
      {action:'save',draftId:'p6_demo_'+'a'.repeat(32),version:1,titleCode:'basic',
        minutes:10,templates:new Array(13).fill('sum_2_2')},
      {action:'save',draftId:'p6_demo_'+'a'.repeat(32),version:1,titleCode:'basic',
        minutes:10,templates:['sum_2_2'],correctIndex:1},
      [],
    ])assert.equal((await f.call(payload)).status,400,JSON.stringify(payload));
    assert.equal(f.count('phase6_admin_drafts'),0);
  }finally{f.sqlite.close();}
});

test('missing Phase6 schema fails 503 and never creates it automatically',async()=>{
  const f=fixture();
  try{
    f.sqlite.exec('DROP TABLE phase6_admin_drafts');
    assert.equal((await f.call({action:'list'})).status,503);
    assert.equal((await f.call(create)).status,503);
    assertNoExistingDataChanges(f,snapshot(f));
  }finally{f.sqlite.close();}
});

test.after(()=>{
  globalThis.fetch=originalFetch;
  assert.ok(keyReads>0,'the signed Firebase Admin key must be verified');
});
