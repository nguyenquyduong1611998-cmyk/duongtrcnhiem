// Phase 4B - full Cloudflare HTTP handler simulation, two independent DEMO
// browser sessions + Admin browser, all sharing one in-memory SQLite D1.
// NO real network calls; never touches Cloudflare or Firebase projects.
import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {PROJECT_ID,ADMIN_UID} from '../functions/_shared/auth.mjs';
import {onRequestPost as studentEndpoint}
  from '../functions/api/demo-quiz/student.js';
import {onRequestPost as adminEndpoint}
  from '../functions/api/demo-quiz/admin.js';

if(!globalThis.crypto) globalThis.crypto=webcrypto;
const BASE='https://duongtrcnhiem-test.pages.dev';
const A='student_'+'a'.repeat(32);
const B='student_'+'b'.repeat(32);
const C='student_'+'c'.repeat(32);
const NAME_A='test_hv_'+'a'.repeat(12);
const NAME_B='test_hv_'+'b'.repeat(12);
const NOW=Math.floor(Date.now()/1000);
const KID='phase4-e2e-rsa-jwk';
const kp=await crypto.subtle.generateKey(
  {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256',
    modulusLength:2048,publicExponent:new Uint8Array([1,0,1])},
  true,['sign','verify'],
);
const publicJwk={
  ...(await crypto.subtle.exportKey('jwk',kp.publicKey)),
  kid:KID,use:'sig',
};
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
async function firebaseToken(uid,provider,changes={}) {
  const head=b64({alg:'RS256',kid:KID,typ:'JWT'});
  const payload=b64({
    iss:'https://securetoken.google.com/'+PROJECT_ID,
    aud:PROJECT_ID,sub:uid,user_id:uid,
    iat:NOW,exp:NOW+3600,auth_time:NOW-100,
    email_verified:true,
    firebase:{sign_in_provider:provider},...changes,
  });
  const value=head+'.'+payload;
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',
    kp.privateKey,new TextEncoder().encode(value));
  return value+'.'+Buffer.from(sig).toString('base64url');
}
const [tokenA,tokenB,tokenAdmin,tokenUnknown]=await Promise.all([
  firebaseToken(A,'custom'),
  firebaseToken(B,'custom'),
  firebaseToken(ADMIN_UID,'google.com'),
  firebaseToken(C,'custom'),
]);

const fetchOriginal=globalThis.fetch;
let outboundCalls=0;
globalThis.fetch=async(url,opts)=>{
  outboundCalls++;
  assert.equal(url,
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
    'Unexpected outbound network request!');
  assert.equal(opts?.method??'GET','GET');
  return new Response(JSON.stringify({keys:[publicJwk]}),{
    status:200,
    headers:{'content-type':'application/json','cache-control':'max-age=30'},
  });
};
function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync('serverless/d1-staging-schema.sql','utf8'));
  sqlite.exec(readFileSync('serverless/d1-phase4-synthetic-graded-quiz.sql','utf8'));
  const run=(sql,...args)=>sqlite.prepare(sql).run(...args);
  const first=(sql,...args)=>sqlite.prepare(sql).get(...args)??null;
  const db={
    prepare(sql){
      return {
        async all(){return {success:true,results:sqlite.prepare(sql).all()};},
        bind(...args){
          return {
            async first(){return first(sql,...args);},
            async run(){return {success:true,meta:{changes:run(sql,...args).changes}};},
          };
        },
      };
    },
  };
  for(const [name,uid] of [[NAME_A,A],[NAME_B,B]]) {
    run('INSERT INTO demo_students '+
      '(username,firebase_uid,password_salt,password_hash,'+
      'kdf_iterations,active,created_at) VALUES (?,?,?,?,310000,1,?)',
      name,uid,'synthetic-salt','synthetic-hash',NOW-500);
  }
  const env={
    FIREBASE_PROJECT_ID:PROJECT_ID,STAGING_AUTH_ENABLED:'true',
    FIREBASE_SERVICE_ACCOUNT_EMAIL:
      'test-signer@'+PROJECT_ID+'.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY:'NOT_AN_ACTUAL_PRIVATE_KEY',
    AUTH_DB:db,PHASE4_SYNTHETIC_QUIZ_ENABLED:'true',
    PHASE4_STAGING_HOSTNAME:'duongtrcnhiem-test.pages.dev',
  };
  const call=(type,token,body)=>{
    const path=type==='admin'?'/api/demo-quiz/admin':'/api/demo-quiz/student';
    const request=new Request(BASE+path,{
      method:'POST',
      headers:{'content-type':'application/json',
        origin:BASE,...(token?{authorization:'Bearer '+token}:{})},
      body:JSON.stringify(body),
    });
    return type==='admin'?adminEndpoint({request,env}):
      studentEndpoint({request,env});
  };
  return {sqlite,run,first,env,call};
}

test('A submits on browser one, reads on browser two; B isolated; Admin sees both',async()=>{
  const f=fixture();
  try {
    const question=await f.call('student',tokenA,{action:'question'});
    assert.equal(question.status,200);
    assert.equal(question.headers.get('cache-control'),'no-store, max-age=0');
    const text=await question.json();
    assert.equal(text.quizId,'synthetic_math_v1');
    assert.equal(text.correctIndex,undefined);
    assert.equal(text.score,undefined);

    const first=await f.call('student',tokenA,{action:'submit',answerIndex:1});
    assert.equal(first.status,200);
    const a=await first.json();
    assert.equal(a.created,true);
    assert.equal(a.attempt.score,10);

    // Browser 2 has its OWN Request object + same Firebase identity.
    const second=await f.call('student',tokenA,{action:'result'});
    assert.equal(second.status,200);
    const own=await second.json();
    assert.deepEqual(own.attempt,a.attempt);

    const bResult=await f.call('student',tokenB,{action:'result'});
    assert.equal(bResult.status,200);
    assert.deepEqual(await bResult.json(),{attempt:null});
    const bSubmit=await f.call('student',tokenB,{action:'submit',answerIndex:0});
    assert.equal(bSubmit.status,200);
    assert.equal((await bSubmit.json()).attempt.score,0);

    const forbidden=await f.call('student',tokenB,
      {action:'result',uid:A});
    assert.equal(forbidden.status,400);
    assert.equal((await forbidden.json()).error,'INVALID_REQUEST');

    const unauthenticated=await f.call('admin',tokenB,{action:'list'});
    assert.equal(unauthenticated.status,403);
    const listing=await f.call('admin',tokenAdmin,{action:'list'});
    assert.equal(listing.status,200);
    const summary=await listing.json();
    assert.equal(summary.count,2);
    const scores=new Map(summary.attempts.map(r=>[r.username,r.score]));
    assert.equal(scores.get(NAME_A),10);
    assert.equal(scores.get(NAME_B),0);
    for(const row of summary.attempts){
      assert.equal(row.firebaseUid,undefined);
      assert.equal(row.passwordHash,undefined);
      assert.equal(row.answerIndex,undefined);
    }
    assert.equal(f.first('SELECT count(*) AS n FROM synthetic_graded_attempts').n,2);
    assert.equal(f.first(
      "SELECT count(*) AS n FROM sqlite_master WHERE name='attempts'").n,0);
  }finally{f.sqlite.close();}
});

test('stale client cannot rewrite result and empty or forged token is rejected',async()=>{
  const f=fixture();
  try {
    for(const token of ['',tokenUnknown,'garbage.jwt.token']){
      const r=await f.call('student',token,{action:'submit',answerIndex:1});
      assert.equal(r.status,401);
    }
    const wrongProject=await firebaseToken(A,'custom',{aud:'some-other-project'});
    assert.equal((await f.call('student',wrongProject,
      {action:'submit',answerIndex:1})).status,401);
    const wrongProvider=await firebaseToken(A,'google.com');
    assert.equal((await f.call('student',wrongProvider,
      {action:'submit',answerIndex:1})).status,401);
    const first=await f.call('student',tokenA,{action:'submit',answerIndex:1});
    assert.equal(first.status,200);
    const concurrent=await Promise.all([
      f.call('student',tokenA,{action:'submit',answerIndex:0}),
      f.call('student',tokenA,{action:'submit',answerIndex:1}),
    ]);
    assert.deepEqual(concurrent.map(x=>x.status),[409,200]);
    assert.equal(f.first(
      'SELECT score FROM synthetic_graded_attempts WHERE firebase_uid=?',A
    ).score,10);
    for(const payload of [
      {action:'submit',answerIndex:1,score:100},
      {action:'submit',answerIndex:1,role:'admin'},
      {action:'submit',answerIndex:1,firebaseUid:B},
    ]) {
      const r=await f.call('student',tokenA,payload);
      assert.equal(r.status,400);
    }
    f.run('UPDATE demo_students SET active=0 WHERE firebase_uid=?',A);
    assert.equal((await f.call('student',tokenA,{action:'result'})).status,401);
    assert.equal((await f.call('student',tokenA,
      {action:'submit',answerIndex:1})).status,401);
    f.run('UPDATE demo_students SET active=1 WHERE firebase_uid=?',A);
    assert.equal((await f.call('student',tokenA,{action:'result'})).status,200);
    assert.throws(()=>f.run(
      'UPDATE synthetic_graded_attempts SET score=0 WHERE firebase_uid=?',A,
    ),/SYNTHETIC_GRADE_IMMUTABLE/);
  }finally{f.sqlite.close();}
});

test('both HTTP routes stay 404 without opt-in and never use public user fields',async()=>{
  const f=fixture();
  try{
    delete f.env.PHASE4_SYNTHETIC_QUIZ_ENABLED;
    assert.equal((await f.call('student',tokenA,{action:'result'})).status,404);
    assert.equal((await f.call('admin',tokenAdmin,{action:'list'})).status,404);
    f.env.PHASE4_SYNTHETIC_QUIZ_ENABLED='true';
    f.env.FIREBASE_PROJECT_ID='wrong-project';
    assert.equal((await f.call('student',tokenA,{action:'result'})).status,503);
    assert.equal((await f.call('admin',tokenAdmin,{action:'list'})).status,503);
  }finally{f.sqlite.close();}
});

test.after(()=>{
  globalThis.fetch=fetchOriginal;
  assert.ok(outboundCalls>0,"Verifier should fetch Google's public JWKS");
});
