// Phase 5D: complete in-memory HTTP/SQLite grading tests using synthetic JWTs.
// No Cloudflare D1 requests, real accounts, credentials, or internal questions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PROJECT_ID} from '../functions/_shared/auth.mjs';
import {PHASE4_PILOT_PREVIEW_HOST,PHASE4_PINNED_STAGING_HOST}
  from '../functions/_shared/phase4-host-guard.mjs';
import {onRequestPost as phase5Post}
  from '../functions/api/phase5/attempts/student.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const PREVIEW='https://'+PHASE4_PILOT_PREVIEW_HOST;
const A='student_'+'a'.repeat(32),B='student_'+'b'.repeat(32);
const LOCKED='student_'+'c'.repeat(32),OTHER='student_'+'d'.repeat(32);
const NOW=Math.floor(Date.now()/1000);
const KID='phase5-grading-simulated-kid';
const keys=await crypto.subtle.generateKey({
  name:'RSASSA-PKCS1-v1_5',hash:'SHA-256',
  modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),
},true,['sign','verify']);
const jwk={...(await crypto.subtle.exportKey('jwk',keys.publicKey)),kid:KID,use:'sig'};
const encode=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
async function makeToken(uid,change={}){
  const header=encode({alg:'RS256',kid:KID,typ:'JWT'});
  const claims=encode({
    iss:'https://securetoken.google.com/'+PROJECT_ID,
    aud:PROJECT_ID,sub:uid,user_id:uid,
    iat:NOW,exp:NOW+3600,auth_time:NOW-1,
    firebase:{sign_in_provider:'custom'},...change,
  });
  const message=header+'.'+claims;
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',
    keys.privateKey,new TextEncoder().encode(message));
  return message+'.'+Buffer.from(signature).toString('base64url');
}
const tokens={
  A:await makeToken(A),B:await makeToken(B),locked:await makeToken(LOCKED),
  unknown:await makeToken(OTHER),wrongProject:await makeToken(A,{aud:'wrong-project'}),
  wrongProvider:await makeToken(A,{firebase:{sign_in_provider:'google.com'}}),
};
const originalFetch=globalThis.fetch;
let jwksFetchCount=0;
globalThis.fetch=async (url,options)=>{
  jwksFetchCount++;
  assert.equal(url,
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  assert.equal(options?.redirect,'manual');
  return new Response(JSON.stringify({keys:[jwk]}),{status:200,headers:{'cache-control':'max-age=30'}});
};

function fixture({questions=2}={}){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync('serverless/d1-staging-schema.sql','utf8'));
  sqlite.exec(readFileSync('serverless/d1-phase4-synthetic-graded-quiz.sql','utf8'));
  sqlite.exec(readFileSync('serverless/d1-phase5-preview-additive-schema.sql','utf8'));
  const run=(sql,...args)=>sqlite.prepare(sql).run(...args);
  const read=(sql,...args)=>sqlite.prepare(sql).get(...args);
  for(const [uid,username,active] of [
    [A,'test_hv_aaaaaaaaaaaa',1],
    [B,'test_hv_bbbbbbbbbbbb',1],
    [LOCKED,'test_hv_cccccccccccc',0],
  ]){
    run('INSERT INTO demo_students '+
      '(username,firebase_uid,password_salt,password_hash,kdf_iterations,active,created_at)'+
      ' VALUES (?,?,?,?,310000,?,?)',
      username,uid,'TEST_ONLY_SALT','TEST_ONLY_HASH',active,NOW);
  }
  run('INSERT INTO synthetic_graded_attempts (firebase_uid,answer_index,score,submitted_at) VALUES (?,1,10,?)',
    A,NOW);
  run('INSERT INTO phase5_content_topics (topic_id,created_at) VALUES (?,?)',
    'p5_demo_math',NOW);
  run('INSERT INTO phase5_content_versions '+
      '(topic_id,revision,code,title,description,time_limit_seconds,state,created_at,published_at) '+
      "VALUES ('p5_demo_math',1,'P5-DEMO','Synthetic math','Synthetic only',600,'draft',?,NULL)",
      NOW);
  const items=[
    ['q1',1,'2 + 2 = ?','3','4','5','6',1],
    ['q2',2,'3 + 3 = ?','5','6','7','8',1],
  ];
  for(const [id,order,q,a,b,c,d,correct] of items.slice(0,questions)){
    run('INSERT INTO phase5_content_questions '+
      '(topic_id,revision,question_id,order_index,question_text,option_a,option_b,option_c,option_d) '+
      "VALUES ('p5_demo_math',1,?,?,?,?,?,?,?)",
      id,order,q,a,b,c,d);
    run('INSERT INTO phase5_content_answer_keys '+
      "(topic_id,revision,question_id,correct_index,explanation) "+
      "VALUES ('p5_demo_math',1,?,?,?)",
      id,correct,'PRIVATE_NOT_FOR_BROWSER');
  }
  run("UPDATE phase5_content_versions SET state='published',published_at=? "+
    "WHERE topic_id='p5_demo_math' AND revision=1",NOW+1);

  let queried=[];
  const d1={
    prepare(sql){
      queried.push(sql);
      return {
        bind(...args){
          return {
            async first(){return sqlite.prepare(sql).get(...args)??null;},
            async all(){return {results:sqlite.prepare(sql).all(...args)};},
            async run(){
              const result=sqlite.prepare(sql).run(...args);
              return {success:true,meta:{changes:result.changes}};
            },
          };
        },
      };
    },
  };
  const env={
    AUTH_DB:d1,
    AUTH_DB_PREVIEW:d1,
    PHASE5_SYNTHETIC_GRADING_ENABLED:'true',
    PHASE5_READONLY_TOPICS_ENABLED:'true',
    PHASE4_PREVIEW_HOST_OPT_IN:'true',
    PHASE4_STAGING_HOSTNAME:PHASE4_PILOT_PREVIEW_HOST,
    STAGING_AUTH_ENABLED:'true',
    FIREBASE_PROJECT_ID:PROJECT_ID,
    FIREBASE_SERVICE_ACCOUNT_EMAIL:'synthetic@'+PROJECT_ID+'.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY:'SYNTHETIC_NOT_USED',
  };
  function request(token,data,{url=PREVIEW+'/api/phase5/attempts/student',
    method='POST',type='application/json',origin=undefined,headers={}}={}){
    return new Request(url,{
      method,
      headers:{
        ...(type?{'content-type':type}:{}),
        ...(token?{authorization:'Bearer '+token}:{}),
        ...(origin?{origin}:{}),
        ...headers,
      },
      ...(method==='POST'?{body:JSON.stringify(data)}:{}),
    });
  }
  const call=(token,data,opts={})=>phase5Post({
    env,request:request(token,data,opts)
  });
  const submit=(token,answers,opts={})=>
    call(token,{action:'submit',topicId:'p5_demo_math',revision:1,answers},opts);
  const result=(token,opts={})=>
    call(token,{action:'result',topicId:'p5_demo_math',revision:1},opts);
  const count=()=>read('SELECT COUNT(*) AS n FROM phase5_content_attempts').n;
  const phase4=()=>read('SELECT firebase_uid,score,answer_index FROM synthetic_graded_attempts');
  return {sqlite,read,run,env,call,submit,result,count,phase4,
    get queried(){return queried;}};
}

test('two questions: correct answers graded on server, immutable score, no key leaked',async()=>{
  const f=fixture();
  try{
    const before=f.phase4();
    const r=await f.submit(tokens.A,{q1:1,q2:1});
    assert.equal(r.status,200);
    const body=await r.json();
    assert.equal(body.created,true);
    assert.deepEqual(body.attempt,{
      topicId:'p5_demo_math',revision:1,correctCount:2,totalCount:2,
      score:10,maxScore:10,submittedAt:body.attempt.submittedAt,
      mode:'phase5-synthetic-server-graded',
    });
    assert.ok(body.attempt.submittedAt>=NOW);
    assert.equal(f.count(),1);
    assert.deepEqual(f.phase4(),before);
    const raw=f.read('SELECT answers_json,score_tenths,correct_count,marker FROM phase5_content_attempts');
    assert.deepEqual(JSON.parse(raw.answers_json),{q1:1,q2:1});
    assert.equal(raw.score_tenths,100);
    assert.equal(raw.marker,'PHASE5_STAGING_MODEL');
    assert.ok(f.queried.some(sql=>sql.includes('phase5_content_answer_keys')));
    for(const secret of ['answers_json','answer_index','correct_index','explanation',
      'PRIVATE_NOT_FOR_BROWSER','student_uid','password_salt','password_hash',
      'firebase_uid','attempt_id']){
      assert.equal(JSON.stringify(body).includes(secret),false,secret);
    }
    const own=await f.result(tokens.A);
    assert.equal(own.status,200);
    assert.deepEqual((await own.json()).attempt,body.attempt);
    assert.throws(()=>f.run('UPDATE phase5_content_attempts SET score_tenths=0'),
      /PHASE5_ATTEMPT_IMMUTABLE/);
    assert.throws(()=>f.run('DELETE FROM phase5_content_attempts'),
      /PHASE5_ATTEMPT_IMMUTABLE/);
  }finally{f.sqlite.close();}
});

test('incorrect and partially correct answers produce server scores, never client-supplied',async()=>{
  const f=fixture();
  try{
    const r=await f.submit(tokens.B,{q1:1,q2:0});
    assert.equal(r.status,200);
    const data=await r.json();
    assert.equal(data.attempt.correctCount,1);
    assert.equal(data.attempt.totalCount,2);
    assert.equal(data.attempt.score,5);
    assert.equal(f.read('SELECT score_tenths FROM phase5_content_attempts').score_tenths,50);
    const noOther=await f.result(tokens.A);
    assert.deepEqual(await noOther.json(),{attempt:null});
  }finally{f.sqlite.close();}
});

test('duplicate same answer is idempotent, conflicting answer rejected and grade not overwritten',async()=>{
  const f=fixture();
  try{
    const first=await (await f.submit(tokens.A,{q1:1,q2:1})).json();
    const second=await f.submit(tokens.A,{q1:1,q2:1});
    assert.equal(second.status,200);
    const repeat=await second.json();
    assert.equal(repeat.created,false);
    assert.deepEqual(repeat.attempt,first.attempt);
    const changed=await f.submit(tokens.A,{q1:0,q2:0});
    assert.equal(changed.status,409);
    const conflict=await changed.json();
    assert.equal(conflict.error,'ALREADY_SUBMITTED');
    assert.deepEqual(conflict.attempt,first.attempt);
    assert.equal(f.count(),1);
    assert.equal(f.read('SELECT score_tenths FROM phase5_content_attempts').score_tenths,100);
  }finally{f.sqlite.close();}
});

test('missing/locked/forged auth denied before INSERT, even with valid body',async()=>{
  const f=fixture();
  try{
    for(const [name,token] of Object.entries({
      none:'',locked:tokens.locked,unknown:tokens.unknown,
      wrongProject:tokens.wrongProject,wrongProvider:tokens.wrongProvider,
      malformed:'fake.payload.signature',
    })){
      const response=await f.submit(token,{q1:1,q2:1});
      assert.equal(response.status,401,name);
    }
    assert.equal(f.count(),0);
    assert.equal(f.phase4().score,10);
  }finally{f.sqlite.close();}
});

test('fail-closed flags, unknown hosts and missing Preview DB never mutate any row',async()=>{
  const f=fixture();
  try{
    for(const flag of ['PHASE5_SYNTHETIC_GRADING_ENABLED',
      'PHASE5_READONLY_TOPICS_ENABLED','PHASE4_PREVIEW_HOST_OPT_IN']){
      const saved=f.env[flag];
      delete f.env[flag];
      assert.equal((await f.submit(tokens.A,{q1:1,q2:1})).status,404,flag);
      f.env[flag]=saved;
    }
    for(const url of [
      'https://'+PHASE4_PINNED_STAGING_HOST+'/api/phase5/attempts/student',
      'https://other.'+PHASE4_PINNED_STAGING_HOST+'/api/phase5/attempts/student',
      'https://example.org/api/phase5/attempts/student',
      PREVIEW+'.attacker.invalid/api/phase5/attempts/student',
    ]){
      assert.equal((await f.submit(tokens.A,{q1:1,q2:1},{url})).status,404,url);
    }
    f.env.AUTH_DB_PREVIEW=undefined;
    assert.equal((await f.submit(tokens.A,{q1:1,q2:1})).status,503);
    assert.equal(f.count(),0);
  }finally{f.sqlite.close();}
});

test('reject unknown question IDs, omitted answers, payload extra keys and query',async()=>{
  const f=fixture();
  try{
    for(const body of [
      {q1:1},{q1:1,q2:1,unexpected:0},{q1:1,q2:9},
      {q1:'1',q2:1},{q1:1,q2:null},[1,1],
      {__proto__:2,q1:1,q2:1,extra:0}
    ]){
      assert.equal((await f.submit(tokens.A,body)).status,400);
    }
    const attack={action:'submit',topicId:'p5_demo_math',
      revision:1,answers:{q1:1,q2:1},score:10,student_uid:B};
    assert.equal((await f.call(tokens.A,attack)).status,400);
    const query=await f.submit(tokens.A,{q1:1,q2:1},{
      url:PREVIEW+'/api/phase5/attempts/student?admin=true'
    });
    assert.equal(query.status,400);
    const cross=await f.submit(tokens.A,{q1:1,q2:1},
      {origin:'https://unrelated.example'});
    assert.equal(cross.status,403);
    assert.equal((await f.submit(tokens.A,{q1:1,q2:1},{type:'text/plain'})).status,415);
    assert.equal((await f.call(tokens.A,{action:'result',topicId:'p5_demo_math',revision:1},
      {method:'GET'})).status,405);
    assert.equal(f.count(),0);
  }finally{f.sqlite.close();}
});

test('one-question topic also graded, no cross-student leakage in own result',async()=>{
  const f=fixture({questions:1});
  try{
    const first=await f.submit(tokens.A,{q1:0});
    assert.equal(first.status,200);
    assert.equal((await first.json()).attempt.score,0);
    assert.equal((await f.result(tokens.B)).status,200);
    assert.deepEqual(await (await f.result(tokens.B)).json(),{attempt:null});
    assert.equal(f.count(),1);
  }finally{f.sqlite.close();}
});

test.after(()=>{
  globalThis.fetch=originalFetch;
  assert.ok(jwksFetchCount>0,'Security tests must verify signed JWT via public keys');
});
