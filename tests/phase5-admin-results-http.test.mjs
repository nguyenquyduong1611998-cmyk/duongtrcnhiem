// Phase 5F: in-memory SQLite + signed synthetic RSA JWT end-to-end Admin tests.
// No external network, real accounts, Cloudflare DB, or password material.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {PROJECT_ID,ADMIN_UID} from '../functions/_shared/auth.mjs';
import {PHASE4_PILOT_PREVIEW_HOST,PHASE4_PINNED_STAGING_HOST}
  from '../functions/_shared/phase4-host-guard.mjs';
import {onRequestPost as adminEndpoint}
  from '../functions/api/phase5/attempts/admin.js';
import {handlePhase5SyntheticAdmin}
  from '../functions/_shared/phase5-synthetic-admin.mjs';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const ORIGIN='https://'+PHASE4_PILOT_PREVIEW_HOST;
const PATH='/api/phase5/attempts/admin';
const A='student_'+'a'.repeat(32),B='student_'+'b'.repeat(32);
const NAME_A='test_hv_'+'a'.repeat(12),NAME_B='test_hv_'+'b'.repeat(12);
const NOW=Math.floor(Date.now()/1000);
const kp=await crypto.subtle.generateKey({
  name:'RSASSA-PKCS1-v1_5',hash:'SHA-256',
  modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),
},true,['sign','verify']);
const jwk={...(await crypto.subtle.exportKey('jwk',kp.publicKey)),
  kid:'phase5-admin-rsa-key',use:'sig'};
const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
async function token(uid,provider,changes={}){
  const header=encode({alg:'RS256',kid:'phase5-admin-rsa-key',typ:'JWT'});
  const payload=encode({
    iss:'https://securetoken.google.com/'+PROJECT_ID,
    aud:PROJECT_ID,sub:uid,user_id:uid,iat:NOW,exp:NOW+3600,
    auth_time:NOW-1,firebase:{sign_in_provider:provider},
    ...changes,
  });
  const input=header+'.'+payload;
  const signed=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',
    kp.privateKey,new TextEncoder().encode(input));
  return input+'.'+Buffer.from(signed).toString('base64url');
}
const validAdmin=await token(ADMIN_UID,'google.com');
const studentA=await token(A,'custom');
const studentB=await token(B,'custom');
const forgedAdmin=await token(A,'google.com');
const badProject=await token(ADMIN_UID,'google.com',{aud:'fake-project'});
const badProvider=await token(ADMIN_UID,'custom');
const originalFetch=globalThis.fetch;
let keyReads=0;
globalThis.fetch=async (url,opts)=>{
  keyReads++;
  assert.equal(url,
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  assert.equal(opts?.method??'GET','GET');
  return new Response(JSON.stringify({keys:[jwk]}),{
    status:200,headers:{'content-type':'application/json'},
  });
};

function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync('serverless/d1-staging-schema.sql','utf8'));
  sqlite.exec(readFileSync('serverless/d1-phase4-synthetic-graded-quiz.sql','utf8'));
  sqlite.exec(readFileSync('serverless/d1-phase5-preview-additive-schema.sql','utf8'));
  sqlite.exec(readFileSync('serverless/d1-phase5-preview-synthetic-math-seed.sql','utf8'));
  const run=(sql,...args)=>sqlite.prepare(sql).run(...args);
  const get=(sql,...args)=>sqlite.prepare(sql).get(...args);
  for(const [username,uid] of [[NAME_A,A],[NAME_B,B]]){
    run('INSERT INTO demo_students '+
      '(username,firebase_uid,password_salt,password_hash,kdf_iterations,active,created_at)'+
      ' VALUES (?,?,?,?,310000,1,?)',
      username,uid,'TEST_ONLY_SALT','TEST_ONLY_HASH',NOW);
  }
  run('INSERT INTO synthetic_graded_attempts '+
    '(firebase_uid,quiz_id,answer_index,score,submitted_at,marker) '+
    "VALUES (?,'synthetic_math_v1',1,10,?,'SYNTHETIC_ONLY')",
    A,NOW);
  for(const [uid,correctIndex,score] of [[A,1,100],[B,0,0]]){
    run('INSERT INTO phase5_content_attempts '+
      '(attempt_id,student_uid,topic_id,revision,answers_json,correct_count,'+
      'total_count,score_tenths,started_at,submitted_at,marker) '+
      "VALUES (?,?,'p5_demo_math',1,?,?,?,?,?,?,'PHASE5_STAGING_MODEL')",
      'attempt_'+uid,uid,JSON.stringify({q1:correctIndex}),
      score===100?1:0,1,score,NOW,NOW);
  }
  const sqlQueries=[];
  const d1={
    prepare(sql){
      sqlQueries.push(sql);
      return {
        async all(){return {success:true,results:sqlite.prepare(sql).all()};},
      };
    },
  };
  const env={
    AUTH_DB:d1,AUTH_DB_PREVIEW:d1,
    FIREBASE_PROJECT_ID:PROJECT_ID,
    STAGING_AUTH_ENABLED:'true',
    FIREBASE_SERVICE_ACCOUNT_EMAIL:'synthetic@'+PROJECT_ID+'.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY:'FAKE_NOT_USED_FOR_ADMIN_VERIFY',
    PHASE4_STAGING_HOSTNAME:PHASE4_PILOT_PREVIEW_HOST,
    PHASE4_PREVIEW_HOST_OPT_IN:'true',
    PHASE5_READONLY_TOPICS_ENABLED:'true',
    PHASE5_ADMIN_RESULTS_ENABLED:'true',
  };
  const request=(jwt=validAdmin,data={action:'list'},opts={})=>{
    const url=opts.url??ORIGIN+PATH;
    const method=opts.method??'POST';
    return new Request(url,{
      method,headers:{
        'content-type':opts.type??'application/json',
        ...(jwt?{authorization:'Bearer '+jwt}:{}),
        ...(opts.origin?{origin:opts.origin}:{}),
      },
      ...(method==='POST'?{body:JSON.stringify(data)}:{}),
    });
  };
  const call=(jwt=validAdmin,data={action:'list'},opts={})=>
    adminEndpoint({request:request(jwt,data,opts),env});
  const scoreState=()=>get('SELECT COUNT(*) AS n, SUM(score_tenths) AS total '+
    'FROM phase5_content_attempts');
  return {sqlite,env,d1,call,request,run,get,scoreState,sqlQueries};
}

test('Google Admin reads isolated A 10/10 and B 0/10, no secret/UID/answer leakage',async()=>{
  const f=fixture();
  try{
    const before=f.scoreState(),phase4=f.get(
      'SELECT COUNT(*) AS n,SUM(score) AS total FROM synthetic_graded_attempts');
    const response=await f.call();
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store, max-age=0');
    const payload=await response.json();
    assert.equal(payload.mode,'phase5-synthetic-admin-readonly');
    assert.equal(payload.topicId,'p5_demo_math');
    assert.equal(payload.revision,1);
    assert.equal(payload.count,2);
    assert.equal(payload.attempts.length,2);
    const map=new Map(payload.attempts.map(row=>[row.username,row]));
    assert.equal(map.get(NAME_A).score,10);
    assert.equal(map.get(NAME_A).correctCount,1);
    assert.equal(map.get(NAME_B).score,0);
    assert.equal(map.get(NAME_B).correctCount,0);
    assert.equal(map.get(NAME_A).totalCount,1);
    assert.deepEqual(f.scoreState(),before);
    assert.deepEqual(f.get('SELECT COUNT(*) AS n,SUM(score) AS total '+
      'FROM synthetic_graded_attempts'),phase4);
    const serialized=JSON.stringify(payload);
    for(const forbidden of [A,B,'student_uid','firebase_uid','answers_json',
      'correct_index','explanation','password_hash','password_salt',
      'TEST_ONLY_HASH','TEST_ONLY_SALT','attempt_id']){
      assert.equal(serialized.includes(forbidden),false,forbidden);
    }
    assert.ok(f.sqlQueries.every(sql=>/^SELECT /i.test(sql)));
    assert.ok(f.sqlQueries.every(sql=>!sql.includes('answer_keys')));
    assert.equal(f.get('PRAGMA quick_check').quick_check,'ok');
    assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{f.sqlite.close();}
});

test('student, forged Admin, malformed token and unknown provider denied',async()=>{
  const f=fixture();
  try{
    const before=f.scoreState();
    for(const jwt of ['',studentA,studentB,forgedAdmin,badProject,
      badProvider,'forged.token.signature']){
      const response=await f.call(jwt);
      assert.equal(response.status,403);
      assert.deepEqual(await response.json(),{error:'ADMIN_AUTH_REQUIRED'});
    }
    assert.deepEqual(f.scoreState(),before);
    assert.equal(f.sqlQueries.length,0);
  }finally{f.sqlite.close();}
});

test('explicit separate flag is default OFF; wrong hostname and missing Preview D1 fail closed',async()=>{
  const f=fixture();
  try{
    const before=f.scoreState();
    for(const flag of ['PHASE5_ADMIN_RESULTS_ENABLED',
      'PHASE5_READONLY_TOPICS_ENABLED','PHASE4_PREVIEW_HOST_OPT_IN']){
      const previous=f.env[flag];
      delete f.env[flag];
      assert.equal((await f.call()).status,404,flag);
      f.env[flag]=previous;
    }
    for(const url of [
      'https://'+PHASE4_PINNED_STAGING_HOST+PATH,
      'https://other.'+PHASE4_PINNED_STAGING_HOST+PATH,
      'https://attacker.example'+PATH,
      ORIGIN+'.attacker.example'+PATH,
    ])assert.equal((await f.call(validAdmin,{action:'list'},{url})).status,404,url);
    f.env.AUTH_DB_PREVIEW=undefined;
    assert.equal((await f.call()).status,503);
    assert.deepEqual(f.scoreState(),before);
    assert.equal(f.sqlQueries.length,0);
  }finally{f.sqlite.close();}
});

test('POST/Origin/JSON guards, invalid payload and query never list scores',async()=>{
  const f=fixture();
  try{
    const before=f.scoreState();
    assert.equal((await f.call(validAdmin,{action:'list'},{
      method:'GET'})).status,405);
    assert.equal((await f.call(validAdmin,{action:'list'},{
      origin:'https://attacker.example'})).status,403);
    assert.equal((await f.call(validAdmin,{action:'list'},{
      type:'text/plain'})).status,415);
    assert.equal((await f.call(validAdmin,{action:'list'},{
      url:ORIGIN+PATH+'?student_uid=student_fake'})).status,400);
    for(const payload of [
      {action:'list',student_uid:A},{action:'submit'},
      {action:'list',answers:{q1:1}}, {action:'list',score:10},
      {action:'lookup',username:NAME_A},[],
    ]){
      assert.equal((await f.call(validAdmin,payload)).status,400);
    }
    assert.deepEqual(f.scoreState(),before);
  }finally{f.sqlite.close();}
});

test('invalid DB rows and oversized datasets fail closed (no partial rows)',async()=>{
  const fakeDb=(rows)=>({
    prepare(sql){
      assert.ok(sql.includes('phase5_content_attempts'));
      return {async all(){return {results:rows};}};
    },
  });
  const valid={username:NAME_A,topic_id:'p5_demo_math',revision:1,
    correct_count:1,total_count:1,score_tenths:100,submitted_at:NOW,
    marker:'PHASE5_STAGING_MODEL'};
  for(const rows of [
    [{...valid,username:'real_person'}],
    [{...valid,score_tenths:0}],
    [{...valid,correct_count:2}],
    [valid,{...valid}],
    new Array(101).fill(valid),
  ]){
    await assert.rejects(()=>handlePhase5SyntheticAdmin(fakeDb(rows),
      {action:'list'}));
  }
  const ok=await handlePhase5SyntheticAdmin(fakeDb([valid]),{action:'list'});
  assert.equal(ok.status,200);
  const row=(await ok.json()).attempts[0];
  assert.deepEqual(Object.keys(row).sort(),[
    'username','topicId','revision','correctCount','totalCount',
    'score','maxScore','submittedAt',
  ].sort());
});

test.after(()=>{
  globalThis.fetch=originalFetch;
  assert.ok(keyReads>0,'Google Admin auth must verify RSA JWT signatures');
});
