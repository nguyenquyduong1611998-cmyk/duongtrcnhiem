import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PROJECT_ID} from '../functions/_shared/auth.mjs';
import {
  verifyDemoQuizIdToken,verifyActiveDemoQuizStudent,
  handleDemoQuizStudent,handleDemoQuizAdmin,
} from '../functions/_shared/synthetic-quiz.mjs';
import {onRequestPost as studentEndpoint}
  from '../functions/api/demo-quiz/student.js';
import {onRequestPost as adminEndpoint}
  from '../functions/api/demo-quiz/admin.js';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const NOW=Math.floor(Date.now()/1000);
const UID_A='student_'+'a'.repeat(32);
const UID_B='student_'+'b'.repeat(32);
const UID_C='student_'+'c'.repeat(32);
const USER_A='test_hv_'+'a'.repeat(12);
const USER_B='test_hv_'+'b'.repeat(12);
const PLAIN='NoPlaintextPasswordsInThisDemoTest';
const DOMAIN='https://duongtrcnhiem-test.pages.dev';
const header={alg:'RS256',kid:'synthetic-rsa-key',typ:'JWT'};
const payload={
  iss:'https://securetoken.google.com/'+PROJECT_ID,
  aud:PROJECT_ID,sub:UID_A,user_id:UID_A,
  exp:NOW+3600,iat:NOW,auth_time:NOW-100,
  firebase:{sign_in_provider:'custom'},
};
const keys=await crypto.subtle.generateKey(
  {name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
    publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},
  true,['sign','verify'],
);
const jwk={
  ...(await crypto.subtle.exportKey('jwk',keys.publicKey)),
  kid:header.kid,use:'sig',
};
const encode=o=>Buffer.from(typeof o==='string'?o:JSON.stringify(o))
  .toString('base64url');
async function sign(body=payload,head=header,privateKey=keys.privateKey){
  const prefix=encode(head)+'.'+encode(body);
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',
    privateKey,new TextEncoder().encode(prefix));
  return prefix+'.'+Buffer.from(signature).toString('base64url');
}

function post(path,body,token='') {
  return new Request(DOMAIN+path,{
    method:'POST',
    headers:{
      origin:DOMAIN,'content-type':'application/json',
      ...(token?{authorization:'Bearer '+token}:{}),
    },body:JSON.stringify(body),
  });
}
function fixture() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync('serverless/d1-staging-schema.sql','utf8'));
  sqlite.exec(readFileSync(
    'serverless/d1-phase4-synthetic-graded-quiz.sql','utf8'));
  const run=(sql,...args)=>sqlite.prepare(sql).run(...args);
  const get=(sql,...args)=>sqlite.prepare(sql).get(...args);
  const db={
    prepare(sql){return {
      async all(){return {results:sqlite.prepare(sql).all()};},
      bind(...args) {
        return {
          async first(){return get(sql,...args)??null;},
          async all(){return {results:sqlite.prepare(sql).all(...args)};},
          async run(){return {success:true,meta:{changes:run(sql,...args).changes}};},
        };
      },
    };},
  };
  const create=(username,uid,active=1)=>run(
    'INSERT INTO demo_students '+
    '(username,firebase_uid,password_salt,password_hash,kdf_iterations,active,created_at) '+
    'VALUES (?,?,?,?,310000,?,?)',
    username,uid,PLAIN,PLAIN,active,NOW-1000,
  );
  create(USER_A,UID_A);
  create(USER_B,UID_B);
  const count=()=>get('SELECT count(*) AS n FROM synthetic_graded_attempts').n;
  return {sqlite,db,run,get,count};
}

test('JWT signature, issuer, audience, Firebase provider and timestamps verified',async()=>{
  const valid=await sign();
  assert.equal(await verifyDemoQuizIdToken(valid,{now:NOW,keys:[jwk]}),UID_A);
  const badClaims=[
    {...payload,iss:'https://securetoken.google.com/not-project'},
    {...payload,aud:'not-project'},
    {...payload,sub:'admin'},
    {...payload,user_id:UID_B},
    {...payload,firebase:{sign_in_provider:'google.com'}},
    {...payload,exp:NOW-1},
    {...payload,iat:NOW+1},
    {...payload,auth_time:NOW+1},
    {...payload,iat:NOW-5000,exp:NOW+1},
    {...payload,nbf:NOW+1},
  ];
  for(const p of badClaims)assert.equal(
    await verifyDemoQuizIdToken(await sign(p),{now:NOW,keys:[jwk]}),
    null,JSON.stringify(p),
  );
  assert.equal(await verifyDemoQuizIdToken(
    await sign(payload,{...header,alg:'none'}),{now:NOW,keys:[jwk]}),null);
  assert.equal(await verifyDemoQuizIdToken(
    await sign(payload,{...header,kid:'untrusted'}),{now:NOW,keys:[jwk]}),null);
  const other=await crypto.subtle.generateKey(
    {name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
      publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},
    true,['sign','verify']);
  assert.equal(await verifyDemoQuizIdToken(
    await sign(payload,header,other.privateKey),{now:NOW,keys:[jwk]}),null);
  assert.equal(await verifyDemoQuizIdToken(
    'not.a.token',{now:NOW,keys:[jwk]}),null);
  assert.equal(await verifyDemoQuizIdToken(
    await sign(),{now:NOW,keys:[]}),null);
});

test('diagnostic callback reports only static stages, never token or UID',async()=>{
  const events=[];
  const onDiagnostic=stage=>events.push(stage);
  const valid=await sign();
  assert.equal(await verifyDemoQuizIdToken(valid,
    {now:NOW,keys:[jwk],onDiagnostic}),UID_A);
  assert.deepEqual(events,[]);
  assert.equal(await verifyDemoQuizIdToken('invalid',
    {now:NOW,keys:[jwk],onDiagnostic}),null);
  assert.equal(events.pop(),'TOKEN_MISSING_OR_MALFORMED');
  assert.equal(await verifyDemoQuizIdToken(await sign({...payload,aud:'bad-project'}),
    {now:NOW,keys:[jwk],onDiagnostic}),null);
  assert.equal(events.pop(),'TOKEN_CLAIMS_REJECTED');
  assert.equal(await verifyDemoQuizIdToken(valid,
    {now:NOW,keys:[],onDiagnostic}),null);
  assert.equal(events.pop(),'SIGNING_KEY_NOT_FOUND');
  const split=valid.split('.');
  split[2]=(split[2][0]==='A'?'B':'A')+split[2].slice(1);
  assert.equal(await verifyDemoQuizIdToken(split.join('.'),
    {now:NOW,keys:[jwk],onDiagnostic}),null);
  assert.equal(events.pop(),'TOKEN_SIGNATURE_REJECTED');
  const f=fixture();
  try{
    f.run('UPDATE demo_students SET active=0 WHERE firebase_uid=?',UID_A);
    assert.equal(await verifyActiveDemoQuizStudent(f.db,
      post('/api/demo-quiz/student',{action:'question'},valid),
      {now:NOW,keys:[jwk],onDiagnostic}),null);
    assert.equal(events.pop(),'DEMO_ACCOUNT_NOT_ACTIVE_IN_BOUND_D1');
    assert.equal(events.length,0);
  }finally{f.sqlite.close();}
  const serialized=JSON.stringify(events);
  assert.equal(serialized.includes(UID_A),false);
  assert.equal(serialized.includes(valid),false);
});

test('Google JWKS failure stages are static, fail closed and recover safely',async()=>{
  const savedFetch=globalThis.fetch;
  const token=await sign();
  const cases=[
    {name:'network',fetcher:async()=>{throw new TypeError('private network detail');},code:'GOOGLE_KEYS_FETCH_FAILED'},
    {name:'403',fetcher:async()=>new Response('',{status:403}),code:'GOOGLE_KEYS_HTTP_403'},
    {name:'404',fetcher:async()=>new Response('',{status:404}),code:'GOOGLE_KEYS_HTTP_404'},
    {name:'429',fetcher:async()=>new Response('',{status:429}),code:'GOOGLE_KEYS_HTTP_429'},
    {name:'5xx',fetcher:async()=>new Response('',{status:502}),code:'GOOGLE_KEYS_HTTP_5XX'},
    {name:'other-status',fetcher:async()=>new Response('',{status:401}),code:'GOOGLE_KEYS_HTTP_OTHER'},
    {name:'json',fetcher:async()=>new Response('invalid json',{status:200}),code:'GOOGLE_KEYS_JSON_INVALID'},
    {name:'set',fetcher:async()=>new Response(JSON.stringify({keys:[]}),{status:200}),code:'GOOGLE_KEYS_SET_INVALID'},
  ];
  try{
    for(const item of cases){
      const stages=[];
      globalThis.fetch=item.fetcher;
      assert.equal(await verifyDemoQuizIdToken(token,
        {now:NOW,onDiagnostic:stage=>stages.push(stage)}),null,item.name);
      assert.deepEqual(stages,[item.code],item.name);
      assert.equal(JSON.stringify(stages).includes(token),false);
      assert.equal(JSON.stringify(stages).includes(UID_A),false);
    }
    globalThis.fetch=async url=>{
      assert.equal(url,'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
      return new Response(JSON.stringify({keys:[jwk]}),{status:200,
        headers:{'cache-control':'max-age=20'}});
    };
    const stages=[];
    assert.equal(await verifyDemoQuizIdToken(token,
      {now:NOW,onDiagnostic:stage=>stages.push(stage)}),UID_A);
    assert.deepEqual(stages,[]);
  }finally{globalThis.fetch=savedFetch;}
});

test('student identity comes from signed ID token AND active D1 demo enrollment',async()=>{
  const f=fixture();
  try {
    const request=post('/api/demo-quiz/student',{action:'result'},await sign());
    assert.equal(await verifyActiveDemoQuizStudent(
      f.db,request,{now:NOW,keys:[jwk]}),UID_A);
    f.run('UPDATE demo_students SET active=0 WHERE firebase_uid=?',UID_A);
    assert.equal(await verifyActiveDemoQuizStudent(
      f.db,request,{now:NOW,keys:[jwk]}),null);
    f.run('UPDATE demo_students SET active=1 WHERE firebase_uid=?',UID_A);
    f.run('DELETE FROM demo_students WHERE firebase_uid=?',UID_A);
    assert.equal(await verifyActiveDemoQuizStudent(
      f.db,request,{now:NOW,keys:[jwk]}),null);
    assert.equal(await verifyActiveDemoQuizStudent(
      f.db,post('/api/demo-quiz/student',{action:'result'})),null);
  }finally{f.sqlite.close();}
});

test('student receives question WITHOUT answer key or correctIndex',async()=>{
  const f=fixture();
  try {
    const r=await handleDemoQuizStudent(f.db,UID_A,{action:'question'});
    assert.equal(r.status,200);
    const question=await r.json();
    assert.equal(question.quizId,'synthetic_math_v1');
    assert.deepEqual(question.options,['3','4','5','6']);
    assert.equal(question.correctIndex,undefined);
    assert.equal(question.answerIndex,undefined);
    assert.equal(question.score,undefined);
    assert.equal(f.count(),0);
  }finally{f.sqlite.close();}
});

test('server grades only from fixed answer key; immutable one attempt per UID',async()=>{
  const f=fixture();
  try {
    assert.deepEqual(await (
      await handleDemoQuizStudent(f.db,UID_A,{action:'result'})
    ).json(),{attempt:null});
    const created=await handleDemoQuizStudent(
      f.db,UID_A,{action:'submit',answerIndex:1});
    assert.equal(created.status,200);
    const result=await created.json();
    assert.equal(result.created,true);
    assert.equal(result.attempt.score,10);
    assert.equal(result.attempt.maxScore,10);
    assert.equal(result.attempt.mode,'server-graded-synthetic');
    assert.equal(f.count(),1);
    const same=await handleDemoQuizStudent(
      f.db,UID_A,{action:'submit',answerIndex:1});
    assert.equal((await same.json()).created,false);
    assert.equal(f.count(),1);
    const replay=await handleDemoQuizStudent(
      f.db,UID_A,{action:'submit',answerIndex:0});
    assert.equal(replay.status,409);
    assert.equal((await replay.json()).error,'ALREADY_SUBMITTED');
    assert.equal(f.get(
      'SELECT score,answer_index FROM synthetic_graded_attempts WHERE firebase_uid=?',
      UID_A).score,10);

    const wrong=await handleDemoQuizStudent(
      f.db,UID_B,{action:'submit',answerIndex:3});
    assert.equal((await wrong.json()).attempt.score,0);
    const admin=await handleDemoQuizAdmin(f.db,{action:'list'});
    assert.equal(admin.status,200);
    const list=await admin.json();
    assert.equal(list.count,2);
    assert.deepEqual(list.attempts.map(x=>x.username).sort(),
      [USER_A,USER_B].sort());
    assert.equal(list.attempts.find(x=>x.username===USER_B).score,0);
    assert.equal(list.attempts.find(x=>x.username===USER_A).score,10);
    assert.equal(list.attempts[0].password,undefined);
    assert.equal(list.attempts[0].firebaseUid,undefined);

    // D1 itself must refuse score changes, even outside the application.
    assert.throws(()=>f.run(
      'UPDATE synthetic_graded_attempts SET score=? WHERE firebase_uid=?',
      0,UID_A,
    ),/SYNTHETIC_GRADE_IMMUTABLE/);

    // Deleting a DEMO enrollment cascades only to its synthetic quiz row.
    f.run('DELETE FROM demo_students WHERE firebase_uid=?',UID_A);
    assert.equal(f.count(),1);
    assert.equal((await (
      await handleDemoQuizStudent(f.db,UID_A,{action:'result'})
    ).json()).attempt,null);
  }finally{f.sqlite.close();}
});

test('only duplicate UID is ignored: unexpected D1 CHECK failures must throw',async()=>{
  const f=fixture();
  try{
    // Simulates a schema mismatch or added staging integrity constraint.
    // Legacy INSERT OR IGNORE would silently skip this CHECK violation.
    f.sqlite.exec(
      'ALTER TABLE synthetic_graded_attempts ADD COLUMN '+
      'synthetic_integrity_guard INTEGER NOT NULL DEFAULT 0 '+
      'CHECK (synthetic_integrity_guard=1)',
    );
    await assert.rejects(
      handleDemoQuizStudent(f.db,UID_A,{action:'submit',answerIndex:1}),
      /CHECK constraint failed/,
    );
    assert.equal(f.count(),0);
  }finally{f.sqlite.close();}
});

test('20 concurrent submissions are write-once even with differing answers',async()=>{
  const f=fixture();
  try{
    const results=await Promise.all(Array.from({length:20},(_,i)=>
      handleDemoQuizStudent(f.db,UID_A,{action:'submit',answerIndex:i%4}),
    ));
    assert.equal(f.count(),1);
    const saved=f.get(
      'SELECT score,answer_index FROM synthetic_graded_attempts WHERE firebase_uid=?',
      UID_A,
    );
    assert.ok([0,1,2,3].includes(saved.answer_index));
    assert.equal(saved.score,saved.answer_index===1?10:0);
    const responses=await Promise.all(results.map(r=>r.json().then(data=>({
      status:r.status,...data,
    }))));
    assert.equal(responses.filter(r=>r.created===true).length,1);
    for(const r of responses){
      assert.ok([200,409].includes(r.status));
      assert.equal(r.attempt?.score,saved.score);
    }
  }finally{f.sqlite.close();}
});

test('account deactivation before INSERT does not store a grade',async()=>{
  const f=fixture();
  try{
    const realPrepare=f.db.prepare;
    f.db.prepare=(sql)=>{
      if(sql.startsWith('INSERT INTO synthetic_graded_attempts '))
        f.run('UPDATE demo_students SET active=0 WHERE firebase_uid=?',UID_A);
      return realPrepare(sql);
    };
    const r=await handleDemoQuizStudent(f.db,UID_A,{action:'submit',answerIndex:1});
    assert.equal(r.status,403);
    assert.equal(f.count(),0);
  }finally{f.sqlite.close();}
});

test('deactivation just AFTER INSERT suppresses student score response',async()=>{
  const f=fixture();
  try{
    const realPrepare=f.db.prepare;
    f.db.prepare=(sql)=>{
      if(sql.startsWith('SELECT a.firebase_uid,a.quiz_id,a.answer_index,'))
        f.run('UPDATE demo_students SET active=0 WHERE firebase_uid=?',UID_A);
      return realPrepare(sql);
    };
    const r=await handleDemoQuizStudent(f.db,UID_A,{action:'submit',answerIndex:1});
    assert.equal(r.status,403);
    assert.equal(f.count(),1);
    assert.equal(f.get('SELECT score FROM synthetic_graded_attempts').score,10);
    assert.equal((await r.json()).attempt,undefined);
  }finally{f.sqlite.close();}
});

test('grade insert uses targeted upsert, never blanket INSERT OR IGNORE',()=>{
  const text=readFileSync('functions/_shared/synthetic-quiz.mjs','utf8');
  assert.match(text,/ON CONFLICT\(firebase_uid\) DO NOTHING/);
  assert.doesNotMatch(text,/INSERT OR IGNORE INTO synthetic_graded_attempts/);
});

test('malicious client data, arbitrary student UID, forged score are rejected',async()=>{
  const f=fixture();
  try {
    const attempts=[
      {action:'submit',answerIndex:1,score:100},
      {action:'submit',answerIndex:1,uid:UID_B},
      {action:'submit',answerIndex:1,role:'admin'},
      {action:'submit',answerIndex:'1'},
      {action:'submit',answerIndex:4},
      {action:'submit',answerIndex:-1},
      {action:'submit',answerIndex:1.5},
      {action:'submit',answerIndex:null},
      {action:'list'},
    ];
    for(const body of attempts){
      const r=await handleDemoQuizStudent(f.db,UID_A,body);
      assert.equal(r.status,400,JSON.stringify(body));
    }
    assert.equal(f.count(),0);
    const missing=await handleDemoQuizStudent(
      f.db,UID_C,{action:'submit',answerIndex:1});
    assert.equal(missing.status,403);
    assert.equal(f.count(),0);
    // SQLite also rejects tampered score, unknown users and invalid markers.
    assert.throws(()=>f.run(
      'INSERT INTO synthetic_graded_attempts '+
      '(firebase_uid,answer_index,score,submitted_at) VALUES (?,?,?,?)',
      UID_A,1,99,NOW,
    ));
    assert.throws(()=>f.run(
      'INSERT INTO synthetic_graded_attempts '+
      '(firebase_uid,answer_index,score,submitted_at) VALUES (?,?,?,?)',
      UID_C,1,10,NOW,
    ));
    assert.throws(()=>f.run(
      'INSERT INTO synthetic_graded_attempts '+
      '(firebase_uid,answer_index,score,submitted_at,marker) '+
      'VALUES (?,?,?,?,?)',UID_A,1,10,NOW,'REAL_GRADE',
    ));
  }finally{f.sqlite.close();}
});

test('both public endpoints default OFF; Admin endpoint requires real signed Admin',async()=>{
  const f=fixture();
  try {
    const req=post('/api/demo-quiz/student',{action:'submit',answerIndex:1});
    assert.equal((await studentEndpoint({request:req,env:{AUTH_DB:f.db}})).status,404);
    const adminReq=post('/api/demo-quiz/admin',{action:'list'});
    assert.equal((await adminEndpoint({request:adminReq,env:{AUTH_DB:f.db}})).status,404);
    const configured={
      AUTH_DB:f.db,
      PHASE4_SYNTHETIC_QUIZ_ENABLED:'true',
      PHASE4_STAGING_HOSTNAME:'duongtrcnhiem-test.pages.dev',
      STAGING_AUTH_ENABLED:'true',
      FIREBASE_PROJECT_ID:PROJECT_ID,
      FIREBASE_SERVICE_ACCOUNT_EMAIL:'synthetic@'+PROJECT_ID+'.iam.gserviceaccount.com',
      FIREBASE_PRIVATE_KEY:'PRIVATE_TEST_PLACEHOLDER',
    };
    assert.equal((await studentEndpoint({
      request:req,env:configured,
    })).status,401);
    assert.equal((await adminEndpoint({
      request:adminReq,env:configured,
    })).status,403);
    assert.equal(f.count(),0);
  }finally{f.sqlite.close();}
});
