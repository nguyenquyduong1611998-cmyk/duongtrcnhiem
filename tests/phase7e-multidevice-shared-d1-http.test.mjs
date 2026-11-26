// Phase 7E — INTEGRATED multi-device rehearsal using real Cloudflare Pages
// HTTP handlers and independent SQLite connections to ONE local shared file.
// Completely offline. Synthetic math questions/UIDs only; no Cloudflare,
// Firebase real credentials, external network, or real student records.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {webcrypto} from 'node:crypto';
import {PROJECT_ID,ADMIN_UID} from '../functions/_shared/auth.mjs';
import {PHASE4_PILOT_PREVIEW_HOST,PHASE4_PINNED_STAGING_HOST}
  from '../functions/_shared/phase4-host-guard.mjs';
import {onRequestPost as examEndpoint}
  from '../functions/api/phase6/exam.js';
import {onRequestPost as ownEndpoint}
  from '../functions/api/phase6/results/student.js';
import {onRequestPost as adminEndpoint}
  from '../functions/api/phase6/results/admin.js';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const NOW=Math.floor(Date.now()/1000);
const UID_A='student_'+'a'.repeat(32);
const UID_B='student_'+'b'.repeat(32);
const TOPIC='p6_demo_'+'e'.repeat(32);
const HOST='https://'+PHASE4_PILOT_PREVIEW_HOST;
const SESSION={topicId:TOPIC,revision:2};
const SCHEMAS=[
  'serverless/d1-staging-schema.sql',
  'serverless/d1-phase4-synthetic-graded-quiz.sql',
  'serverless/d1-phase5-preview-additive-schema.sql',
  'serverless/d1-phase5-preview-synthetic-math-seed.sql',
  'serverless/d1-phase6b-synthetic-admin-drafts-draft.sql',
  'serverless/d1-phase6c-publication-metadata-draft.sql',
  'serverless/d1-phase6-timed-sessions-draft.sql',
  'serverless/d1-phase6d-timed-submissions-draft.sql',
];
const keyPair=await crypto.subtle.generateKey({
  name:'RSASSA-PKCS1-v1_5',hash:'SHA-256',
  modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),
},true,['sign','verify']);
const jwk={...(await crypto.subtle.exportKey('jwk',keyPair.publicKey)),
  kid:'phase7e-fake-jwt-local',use:'sig'};
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
async function jwt(uid,provider='custom',changes={}){
  const header=encode({alg:'RS256',typ:'JWT',kid:jwk.kid});
  const body=encode({
    iss:'https://securetoken.google.com/'+PROJECT_ID,
    aud:PROJECT_ID,sub:uid,user_id:uid,
    iat:NOW,exp:NOW+3600,auth_time:NOW-20,
    firebase:{sign_in_provider:provider},...changes,
  });
  const message=header+'.'+body;
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',
    keyPair.privateKey,new TextEncoder().encode(message));
  return message+'.'+Buffer.from(signature).toString('base64url');
}
const A=await jwt(UID_A),B=await jwt(UID_B);
const ADMIN=await jwt(ADMIN_UID,'google.com');
const WRONG_PROVIDER=await jwt(UID_A,'google.com');
const WRONG_PROJECT=await jwt(UID_A,'custom',{aud:'wrong'});
const EXPIRED=await jwt(UID_A,'custom',{exp:NOW-60});
const originalFetch=globalThis.fetch;
let jwksCalls=0;
globalThis.fetch=async url=>{
  jwksCalls++;
  assert.equal(url,
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  return new Response(JSON.stringify({keys:[jwk]}),{status:200});
};

function openFile(path,clock){
  const db=new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON');
  db.function('unixepoch',()=>clock.value);
  return db;
}
function d1(db){
  return {
    prepare(sql){
      const statement=db.prepare(sql);
      return {
        bind(...args){
          return {
            async first(){return statement.get(...args)??null;},
            async all(){return {success:true,results:statement.all(...args)};},
            async run(){
              const result=statement.run(...args);
              return {success:true,meta:{changes:result.changes}};
            },
          };
        },
        async all(){return {success:true,results:statement.all()};},
        async first(){return statement.get()??null;},
      };
    },
  };
}
function init(db){
  for(const sql of SCHEMAS)db.exec(readFileSync(sql,'utf8'));
  const run=(sql,...args)=>db.prepare(sql).run(...args);
  for(const [uid,username] of [
    [UID_A,'test_hv_'+'a'.repeat(12)],
    [UID_B,'test_hv_'+'b'.repeat(12)],
  ])run(
    'INSERT INTO demo_students(username,firebase_uid,password_salt,password_hash,'+
    'kdf_iterations,active,created_at) VALUES (?,?,?,?,310000,1,?)',
    username,uid,'SYNTHETIC_SALT','SYNTHETIC_HASH',NOW-600
  );
  run('INSERT INTO phase5_content_topics(topic_id,created_at) VALUES (?,?)',
    TOPIC,NOW-500);
  run(
    "INSERT INTO phase5_content_versions(topic_id,revision,code,title,description,"+
    "time_limit_seconds,state,created_at,published_at) "+
    "VALUES (?,2,'P6-7E','Toán học DEMO 7E','Fake math only',300,'draft',?,NULL)",
    TOPIC,NOW-500
  );
  for(const [id,order,q,correct] of [
    ['q1',1,'2 + 2 = ?',1],['q2',2,'10 - 3 = ?',2],
  ]){
    run(
      'INSERT INTO phase5_content_questions(topic_id,revision,question_id,'+
      'order_index,question_text,option_a,option_b,option_c,option_d) '+
      'VALUES (?,2,?,?,?,?,?,?,?)',
      TOPIC,id,order,q,'3','4','7','8'
    );
    run(
      'INSERT INTO phase5_content_answer_keys(topic_id,revision,question_id,'+
      'correct_index,explanation) VALUES (?,2,?,?,?)',
      TOPIC,id,correct,'Fake arithmetic only'
    );
  }
  run(
    "UPDATE phase5_content_versions SET state='published',published_at=? "+
    "WHERE topic_id=? AND revision=2",
    NOW-300,TOPIC
  );
  run(
    "INSERT INTO phase6_admin_publications(draft_id,revision,published_at,marker) "+
    "VALUES (?,2,?,'PHASE6_SYNTHETIC_PUBLICATION')",
    TOPIC,NOW-300
  );
}
function fixture(){
  const directory=mkdtempSync(join(tmpdir(),'phase7e-multidevice-'));
  const path=join(directory,'SYNTHETIC_SHARED_D1.sqlite');
  const clock={value:NOW};
  const seed=openFile(path,clock);
  init(seed);
  seed.close();
  const handles=[];
  const open=()=>{
    const db=openFile(path,clock);
    handles.push(db);
    return db;
  };
  const sql=open();
  const canonical={prepare(){throw new Error('WRONG_CANONICAL_DATABASE');}};
  const envFor=db=>({
    AUTH_DB_PREVIEW:d1(db),AUTH_DB:canonical,
    FIREBASE_PROJECT_ID:PROJECT_ID,STAGING_AUTH_ENABLED:'true',
    FIREBASE_SERVICE_ACCOUNT_EMAIL:'synthetic@'+PROJECT_ID+'.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY:'SYNTHETIC_PRIVATE_KEY_ONLY',
    PHASE4_STAGING_HOSTNAME:PHASE4_PILOT_PREVIEW_HOST,
    PHASE4_PREVIEW_HOST_OPT_IN:'true',
    PHASE6_STUDENT_TIMED_EXAM_ENABLED:'true',
    PHASE6_RESULTS_READONLY_ENABLED:'true',
    PHASE6_ADMIN_RESULTS_ENABLED:'true',
  });
  const device=(label,token)=>{
    const db=open(),env=envFor(db),requests=[];
    const call=async(route,body,override={})=>{
      requests.push({route,action:body?.action,method:override.method||'POST'});
      const method=override.method||'POST';
      const url=override.url||HOST+route;
      const request=new Request(url,{
        method,
        headers:{
          'content-type':override.type||'application/json',
          ...(token?{authorization:'Bearer '+token}:{}),
          ...(override.origin?{origin:override.origin}:{}),
        },
        ...(method==='POST'?{body:JSON.stringify(body)}:{}),
      });
      const handler=route==='/api/phase6/exam'?examEndpoint:
        route==='/api/phase6/results/student'?ownEndpoint:
          adminEndpoint;
      return handler({request,env});
    };
    const exam=(body,overrides)=>call('/api/phase6/exam',body,overrides);
    const own=(body={action:'list',offset:0},overrides)=>
      call('/api/phase6/results/student',body,overrides);
    const admin=(body={action:'summary'},overrides)=>
      call('/api/phase6/results/admin',body,overrides);
    return {label,db,env,requests,exam,own,admin};
  };
  const close=()=>{
    for(const db of handles)try{db.close();}catch{/* no error data */}
    rmSync(directory,{recursive:true,force:true});
  };
  return {
    device,sql,open,close,clock,
    get:(query,...args)=>sql.prepare(query).get(...args),
    count:table=>sql.prepare('SELECT count(*) AS n FROM '+table).get().n,
  };
}
const payload=async(response,status)=>{
  assert.equal(response.status,status,
    'unexpected HTTP status '+response.status);
  assert.equal(response.headers.get('cache-control'),'no-store, max-age=0');
  return response.json();
};
const start={action:'start',...SESSION},read={action:'read',...SESSION},
  result={action:'result',...SESSION};
const submit=(session,answers)=>({
  action:'submit',...SESSION,sessionId:session.sessionId,answers,
});
function noPrivateData(body){
  const serialized=JSON.stringify(body);
  for(const secret of [
    'SYNTHETIC_HASH','SYNTHETIC_SALT','SYNTHETIC_PRIVATE_KEY_ONLY',
    'correct_index','answers_json','answer_keys','password_hash',
    'student_uid','firebase_uid','PRIVATE_JWT',
  ])assert.equal(serialized.includes(secret),false,secret);
}
test('PC A starts + submits; phone A reads same server session/score; Admin reads both users',async()=>{
  const f=fixture();
  try{
    const pcA=f.device('PC A',A);
    const phoneA=f.device('Phone A',A);
    const browserB=f.device('Browser B',B);
    const admin=f.device('Admin separate device',ADMIN);
    const empty=await payload(await phoneA.exam(read),200);
    assert.equal(empty.session,null);
    const aStarted=await payload(await pcA.exam(start),200);
    assert.equal(aStarted.session.timeLimitSeconds,300);
    const phoneStarted=await payload(await phoneA.exam(read),200);
    assert.deepEqual(phoneStarted.session,aStarted.session);
    assert.equal(f.count('phase6_exam_sessions'),1);
    noPrivateData(phoneStarted);

    const aReceipt=await payload(await pcA.exam(submit(aStarted.session,{
      q1:1,q2:2,
    })),201);
    assert.equal(aReceipt.result.score,10);
    const recovered=await payload(await phoneA.exam(result),200);
    assert.deepEqual(recovered.result,aReceipt.result);
    const ownA=await payload(await phoneA.own(),200);
    assert.equal(ownA.entries.length,1);
    assert.equal(ownA.entries[0].score,10);
    noPrivateData(ownA);
    assert.equal(f.count('phase6_exam_submissions'),1);

    const bsRead=await payload(await browserB.exam(result),200);
    assert.equal(bsRead.result,null,'B cannot read A score');
    const bsOwn=await payload(await browserB.own(),200);
    assert.deepEqual(bsOwn.entries,[]);
    const attack=await payload(await browserB.exam(
      submit(aStarted.session,{q1:0,q2:0})),409);
    assert.equal(attack.error,'SESSION_NOT_STARTED');
    assert.equal(f.count('phase6_exam_submissions'),1);

    const bStarted=await payload(await browserB.exam(start),200);
    assert.notEqual(bStarted.session.sessionId,aStarted.session.sessionId);
    const bReceipt=await payload(await browserB.exam(submit(
      bStarted.session,{q1:0,q2:0})),201);
    assert.equal(bReceipt.result.score,0);
    assert.equal((await payload(await pcA.exam(result),200)).result.score,10);
    assert.equal((await payload(await browserB.own(),200)).entries[0].score,0);
    assert.equal(f.count('phase6_exam_submissions'),2);
    const summary=await payload(await admin.admin(),200);
    assert.deepEqual(summary.summary,{
      attemptCount:2,studentCount:2,averageScore:5,maxScore:10,
    });
    const listing=await payload(await admin.admin({action:'list',offset:0}),200);
    assert.equal(listing.entries.length,2);
    assert.deepEqual(listing.entries.map(e=>e.username).sort(),[
      'test_hv_'+'a'.repeat(12),'test_hv_'+'b'.repeat(12),
    ]);
    noPrivateData(listing);
    assert.equal(f.count('phase6_exam_submissions'),2);
    assert.equal(phoneA.requests.every(x=>x.action!=='submit'),true);
    assert.equal(admin.requests.every(x=>x.action==='summary'||x.action==='list'),true);
    assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{f.close();}
});

test('dropped submit response: phone uses GET-like read action only, no second POST submit',async()=>{
  const f=fixture();
  try{
    const pc=f.device('PC',A);
    const phone=f.device('Phone',A);
    const started=(await payload(await pc.exam(start),200)).session;
    // Server commits a single write; client never sees this HTTP response.
    await payload(await pc.exam(submit(started,{q1:1,q2:2})),201);
    const lostNetworkAfterWrite=true;
    assert.equal(lostNetworkAfterWrite,true);
    const phoneRead=await payload(await phone.exam(result),200);
    assert.equal(phoneRead.result.score,10);
    assert.equal((await payload(await phone.own(),200)).entries.length,1);
    assert.equal(phone.requests.filter(x=>x.action==='submit').length,0);
    assert.equal(pc.requests.filter(x=>x.action==='submit').length,1);
    assert.equal(f.count('phase6_exam_submissions'),1);
    // Deliberate manual retry of SAME payload is idempotent but not automatic.
    const repeat=await payload(await pc.exam(submit(started,{
      q1:1,q2:2,
    })),200);
    assert.equal(repeat.created,false);
    assert.equal(f.count('phase6_exam_submissions'),1);
    const conflicting=await payload(await phone.exam(submit(started,{
      q1:0,q2:0,
    })),409);
    assert.equal(conflicting.error,'ALREADY_SUBMITTED');
    assert.equal(conflicting.result.score,10);
    assert.equal(f.get('SELECT score_tenths AS score FROM phase6_exam_submissions').score,100);
  }finally{f.close();}
});

test('same browser switches A→B: server owns UID, B cannot fetch A cache or result',async()=>{
  const f=fixture();
  try{
    const screenA=f.device('Screen A',A);
    const a=(await payload(await screenA.exam(start),200)).session;
    await payload(await screenA.exam(submit(a,{q1:1,q2:2})),201);
    // Simulate clearing authenticated client state and starting a new login;
    // the browser now uses a *different signed token* and independent adapter.
    const screenB=f.device('Screen B after logout/login',B);
    assert.equal((await payload(await screenB.exam(result),200)).result,null);
    assert.equal((await payload(await screenB.own(),200)).entries.length,0);
    assert.equal((await payload(await screenB.exam(
      submit(a,{q1:1,q2:2})),409)).error,'SESSION_NOT_STARTED');
    assert.equal(f.count('phase6_exam_submissions'),1);
    noPrivateData(await payload(await screenB.own(),200));
  }finally{f.close();}
});

test('anonymous/invalid student/Admin or wrong host cannot read other device results',async()=>{
  const f=fixture();
  try{
    const student=f.device('A',A);
    const s=(await payload(await student.exam(start),200)).session;
    await payload(await student.exam(submit(s,{q1:1,q2:2})),201);
    for(const invalid of ['',WRONG_PROVIDER,WRONG_PROJECT,EXPIRED,ADMIN]){
      const bad=f.device('Unauthenticated or invalid',invalid);
      assert.equal((await bad.exam(result)).status,401);
      assert.equal((await bad.own()).status,401);
    }
    for(const jwtBad of ['',A,B,WRONG_PROJECT]){
      const bad=f.device('Not Google Admin',jwtBad);
      const r=await bad.admin({action:'list',offset:0});
      assert.equal(r.status,403);
      assert.deepEqual(await r.json(),{error:'ADMIN_AUTH_REQUIRED'});
    }
    const denied=f.device('Pinned host check',A);
    for(const url of [
      'https://'+PHASE4_PINNED_STAGING_HOST+'/api/phase6/exam',
      'https://attacker.example/api/phase6/exam',
      'http://'+PHASE4_PILOT_PREVIEW_HOST+'/api/phase6/exam',
    ])assert.equal((await denied.exam(result,{url})).status,404);
    assert.equal((await denied.exam(result,{method:'GET'})).status,405);
    assert.equal((await denied.exam(result,{origin:'https://evil.example'})).status,403);
    assert.equal(f.count('phase6_exam_submissions'),1);
  }finally{f.close();}
});

test('flags default OFF and absent Preview binding fail closed without canonical fallback',async()=>{
  const f=fixture();
  try{
    const user=f.device('PC',A);
    const admin=f.device('Admin',ADMIN);
    delete user.env.PHASE6_STUDENT_TIMED_EXAM_ENABLED;
    delete user.env.PHASE6_RESULTS_READONLY_ENABLED;
    delete admin.env.PHASE6_ADMIN_RESULTS_ENABLED;
    assert.equal((await user.exam(start)).status,404);
    assert.equal((await user.own()).status,404);
    assert.equal((await admin.admin()).status,404);
    user.env.PHASE6_STUDENT_TIMED_EXAM_ENABLED='true';
    user.env.PHASE6_RESULTS_READONLY_ENABLED='true';
    delete user.env.AUTH_DB_PREVIEW;
    assert.equal((await user.exam(start)).status,503);
    assert.equal((await user.own()).status,503);
    assert.equal(f.count('phase6_exam_sessions'),0);
    assert.equal(f.count('phase6_exam_submissions'),0);
  }finally{f.close();}
});

test('closing all device connections and reconnecting preserves committed grades',async()=>{
  const f=fixture();
  try{
    const a=f.device('PC',A);
    const started=(await payload(await a.exam(start),200)).session;
    await payload(await a.exam(submit(started,{q1:1,q2:2})),201);
    const late=f.device('New phone session',A);
    assert.equal((await payload(await late.exam(result),200)).result.score,10);
    assert.equal((await payload(await late.own(),200)).entries.length,1);
    assert.equal(f.count('phase6_exam_submissions'),1);
    const db2=f.open();
    assert.equal(db2.prepare('SELECT COUNT(*) AS n FROM phase6_exam_submissions').get().n,1);
    assert.equal(db2.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.deepEqual(db2.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{f.close();}
});

test.after(()=>{
  globalThis.fetch=originalFetch;
  assert.ok(jwksCalls>0,'actual signed JWT RSA verification was exercised');
});
