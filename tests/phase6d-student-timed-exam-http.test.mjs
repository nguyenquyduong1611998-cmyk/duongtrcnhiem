// Phase 6D: offline signed-student HTTP + in-memory SQLite D1 simulation.
// No remote Cloudflare, Firebase project or real student data are touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {PROJECT_ID,ADMIN_UID} from '../functions/_shared/auth.mjs';
import {PHASE4_PILOT_PREVIEW_HOST,PHASE4_PINNED_STAGING_HOST}
  from '../functions/_shared/phase4-host-guard.mjs';
import {onRequestPost as endpoint} from '../functions/api/phase6/exam.js';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const NOW=Math.floor(Date.now()/1000);
const UID_A='student_'+'a'.repeat(32);
const UID_B='student_'+'b'.repeat(32);
const DEMO_TOPIC='p6_demo_'+'c'.repeat(32);
const ORIGIN='https://'+PHASE4_PILOT_PREVIEW_HOST;
const PATH='/api/phase6/exam';
const kp=await crypto.subtle.generateKey({
  name:'RSASSA-PKCS1-v1_5',hash:'SHA-256',modulusLength:2048,
  publicExponent:new Uint8Array([1,0,1]),
},true,['sign','verify']);
const jwk={...(await crypto.subtle.exportKey('jwk',kp.publicKey)),
  kid:'phase6d-local-rsa',use:'sig'};
const encode=obj=>Buffer.from(JSON.stringify(obj)).toString('base64url');
async function token(uid,provider='custom',changes={}){
  const head=encode({alg:'RS256',kid:jwk.kid,typ:'JWT'});
  const payload=encode({
    iss:'https://securetoken.google.com/'+PROJECT_ID,
    aud:PROJECT_ID,sub:uid,user_id:uid,
    iat:NOW,exp:NOW+3600,auth_time:NOW-10,
    firebase:{sign_in_provider:provider},
    ...changes,
  });
  const value=head+'.'+payload;
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',
    kp.privateKey,new TextEncoder().encode(value));
  return value+'.'+Buffer.from(signature).toString('base64url');
}
const A=await token(UID_A),B=await token(UID_B);
const ADMIN=await token(ADMIN_UID,'google.com');
const FORGED=await token(UID_A,'google.com');
const INVALID_PROJECT=await token(UID_A,'custom',{aud:'other-project'});
const originalFetch=globalThis.fetch;
let keyReads=0;
globalThis.fetch=async url=>{
  keyReads++;
  assert.equal(url,
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  return new Response(JSON.stringify({keys:[jwk]}),{
    status:200,headers:{'content-type':'application/json'},
  });
};

function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  let fakeNow=NOW;
  sqlite.function('unixepoch',()=>fakeNow);
  sqlite.exec('PRAGMA foreign_keys=ON');
  for(const path of [
    'serverless/d1-staging-schema.sql',
    'serverless/d1-phase4-synthetic-graded-quiz.sql',
    'serverless/d1-phase5-preview-additive-schema.sql',
    'serverless/d1-phase5-preview-synthetic-math-seed.sql',
    'serverless/d1-phase6b-synthetic-admin-drafts-draft.sql',
    'serverless/d1-phase6c-publication-metadata-draft.sql',
    'serverless/d1-phase6-timed-sessions-draft.sql',
    'serverless/d1-phase6d-timed-submissions-draft.sql',
  ])sqlite.exec(readFileSync(path,'utf8'));
  const run=(sql,...params)=>sqlite.prepare(sql).run(...params);
  const get=(sql,...params)=>sqlite.prepare(sql).get(...params);
  const count=table=>get('SELECT count(*) AS n FROM '+table).n;
  for(const [username,uid] of [
    ['test_hv_'+'a'.repeat(12),UID_A],
    ['test_hv_'+'b'.repeat(12),UID_B],
  ])run(
    'INSERT INTO demo_students '+
    '(username,firebase_uid,password_salt,password_hash,kdf_iterations,active,created_at) '+
    'VALUES (?,?,?,?,310000,1,?)',
    username,uid,'TEST_SALT','TEST_HASH',NOW-1000);
  run("INSERT INTO synthetic_graded_attempts(firebase_uid,quiz_id,answer_index,score,submitted_at,marker) VALUES (?,'synthetic_math_v1',1,10,?,'SYNTHETIC_ONLY')",
    UID_A,NOW-100);
  for(const [uid,correct,score] of [[UID_A,1,100],[UID_B,0,0]])run(
    "INSERT INTO phase5_content_attempts(attempt_id,student_uid,topic_id,revision,answers_json,correct_count,total_count,score_tenths,started_at,submitted_at,marker) VALUES (?,?,'p5_demo_math',1,?,?,?,?,?,?,'PHASE5_STAGING_MODEL')",
    'attempt_'+uid,uid,JSON.stringify({q1:correct}),
    score===100?1:0,1,score,NOW-500,NOW-500);
  // Synthetic Phase6 publication, immutable before any student starts.
  run('INSERT INTO phase5_content_topics(topic_id,created_at) VALUES (?,?)',
    DEMO_TOPIC,NOW-500);
  run("INSERT INTO phase5_content_versions(topic_id,revision,code,title,description,time_limit_seconds,state,created_at,published_at) VALUES (?,2,'P6-PRACTICE','Toán học DEMO - Luyện tập','Fake arithmetic only',120,'draft',?,NULL)",
    DEMO_TOPIC,NOW-500);
  const questions=[
    ['q1',1,'2 + 2 = ?','3','4','5','6',1],
    ['q2',2,'10 - 3 = ?','5','6','7','8',2],
  ];
  for(const [id,order,text,a,b,c,d,correct] of questions){
    run('INSERT INTO phase5_content_questions(topic_id,revision,question_id,order_index,question_text,option_a,option_b,option_c,option_d) VALUES (?,?,?,?,?,?,?,?,?)',
      DEMO_TOPIC,2,id,order,text,a,b,c,d);
    run('INSERT INTO phase5_content_answer_keys(topic_id,revision,question_id,correct_index,explanation) VALUES (?,?,?,?,?)',
      DEMO_TOPIC,2,id,correct,'Fake arithmetic');
  }
  run("UPDATE phase5_content_versions SET state='published',published_at=? WHERE topic_id=? AND revision=2",
    NOW-200,DEMO_TOPIC);
  run("INSERT INTO phase6_admin_publications(draft_id,revision,published_at,marker) VALUES (?,2,?,'PHASE6_SYNTHETIC_PUBLICATION')",
    DEMO_TOPIC,NOW-200);

  const queries=[];
  const d1={
    prepare(sql){
      queries.push(sql);
      return {
        bind(...params){
          return {
            async first(){return sqlite.prepare(sql).get(...params)??null;},
            async all(){return {success:true,results:sqlite.prepare(sql).all(...params)};},
            async run(){
              const result=sqlite.prepare(sql).run(...params);
              return {success:true,meta:{changes:result.changes}};
            },
          };
        },
        async all(){return {success:true,results:sqlite.prepare(sql).all()};},
        async first(){return sqlite.prepare(sql).get()??null;},
      };
    },
  };
  const env={
    AUTH_DB:d1,AUTH_DB_PREVIEW:d1,
    FIREBASE_PROJECT_ID:PROJECT_ID,STAGING_AUTH_ENABLED:'true',
    FIREBASE_SERVICE_ACCOUNT_EMAIL:'synthetic@'+PROJECT_ID+'.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY:'FAKE_NEVER_USED',
    PHASE4_STAGING_HOSTNAME:PHASE4_PILOT_PREVIEW_HOST,
    PHASE4_PREVIEW_HOST_OPT_IN:'true',
    PHASE6_STUDENT_TIMED_EXAM_ENABLED:'true',
  };
  const request=(body,token=A,opts={})=>{
    const url=opts.url??ORIGIN+PATH,method=opts.method??'POST';
    return new Request(url,{
      method,
      headers:{
        'content-type':opts.type??'application/json',
        ...(token?{authorization:'Bearer '+token}:{}),
        ...(opts.origin?{origin:opts.origin}:{}),
      },
      ...(method==='POST'?{body:JSON.stringify(body)}:{}),
    });
  };
  const call=(body,token=A,opts={})=>endpoint({request:request(body,token,opts),env});
  const oldScores=()=>({
    count4:count('synthetic_graded_attempts'),
    sum4:get('SELECT coalesce(sum(score),0) AS n FROM synthetic_graded_attempts').n,
    count5:count('phase5_content_attempts'),
    sum5:get('SELECT coalesce(sum(score_tenths),0) AS n FROM phase5_content_attempts').n,
    a:get('SELECT score_tenths FROM phase5_content_attempts WHERE student_uid=?',UID_A).score_tenths,
    b:get('SELECT score_tenths FROM phase5_content_attempts WHERE student_uid=?',UID_B).score_tenths,
  });
  const exam={topicId:DEMO_TOPIC,revision:2};
  const start={action:'start',...exam};
  const list={action:'list'};
  const read={action:'read',...exam};
  const result={action:'result',...exam};
  const submit=(session,answers)=>({
    action:'submit',...exam,sessionId:session.sessionId,answers,
  });
  return {
    sqlite,env,queries,call,run,get,count,oldScores,
    setClock:n=>{fakeNow=n;},
    exam,start,list,read,result,submit,
  };
}

test('signed student starts D1-clock session; reads same session after reconnect, no private key',async()=>{
  const f=fixture();
  try{
    const before=f.oldScores();
    const list=await f.call(f.list),body=await list.json();
    assert.equal(list.status,200);
    assert.equal(body.topics.length,1);
    assert.equal(body.topics[0].topicId,DEMO_TOPIC);
    assert.equal(body.topics[0].timeLimitSeconds,120);
    assert.equal(JSON.stringify(body).includes('correct_index'),false);
    const beforeStart=await (await f.call(f.read)).json();
    assert.equal(beforeStart.session,null);
    const first=await f.call(f.start);
    assert.equal(first.status,200);
    const started=await first.json();
    assert.match(started.session.sessionId,/^p6_session_[a-f0-9]{32}$/);
    assert.equal(started.session.startedAt,NOW);
    assert.equal(started.session.expiresAt,NOW+120);
    assert.equal(started.session.serverNow,NOW);
    assert.equal(started.topic.questions.length,2);
    const payload=JSON.stringify(started);
    for(const forbidden of ['correctIndex','correct_index','answer_keys',
      'answers_json','student_uid','firebase_uid','TEST_HASH','explanation'])
      assert.equal(payload.includes(forbidden),false,forbidden);
    const again=await (await f.call(f.start)).json();
    const recovered=await (await f.call(f.read)).json();
    assert.equal(again.session.sessionId,started.session.sessionId);
    assert.deepEqual(recovered.session,started.session);
    assert.equal(f.count('phase6_exam_sessions'),1);
    assert.deepEqual(f.oldScores(),before);
  }finally{f.sqlite.close();}
});

test('submission at exact DB deadline succeeds, one second late rejected, no client clock',async()=>{
  const f=fixture();
  try{
    const before=f.oldScores();
    const a=(await (await f.call(f.start)).json()).session;
    const b=(await (await f.call(f.start,B)).json()).session;
    assert.notEqual(a.sessionId,b.sessionId);
    f.setClock(NOW+120);
    const pass=await f.call(f.submit(a,{q1:1,q2:2}));
    assert.equal(pass.status,201);
    const result=(await pass.json()).result;
    assert.equal(result.score,10);
    assert.equal(result.correctCount,2);
    assert.equal(result.submittedAt,NOW+120);
    f.setClock(NOW+121);
    const late=await f.call(f.submit(b,{q1:0,q2:0}),B);
    assert.equal(late.status,409);
    assert.deepEqual(await late.json(),{error:'DEADLINE_EXPIRED'});
    assert.equal(f.count('phase6_exam_submissions'),1);
    const readback=await (await f.call(f.result)).json();
    assert.deepEqual(readback.result,result);
    assert.deepEqual((await f.call(f.result,B)).status,200);
    assert.deepEqual((await (await f.call(f.result,B)).json()).result,null);
    assert.deepEqual(f.oldScores(),before);
    const record=f.get('SELECT started_at,expires_at FROM phase6_exam_sessions WHERE session_id=?',a.sessionId);
    assert.equal(record.expires_at-record.started_at,120);
    assert.throws(()=>f.run('UPDATE phase6_exam_sessions SET expires_at=expires_at+60'),/IMMUTABLE/);
    assert.throws(()=>f.run('UPDATE phase6_exam_submissions SET score_tenths=0'),/IMMUTABLE/);
    assert.throws(()=>f.run('DELETE FROM phase6_exam_submissions'),/IMMUTABLE/);
  }finally{f.sqlite.close();}
});

test('duplicate POST/ambiguous response is idempotent; another answer cannot overwrite',async()=>{
  const f=fixture();
  try{
    const session=(await (await f.call(f.start)).json()).session;
    const good=f.submit(session,{q1:1,q2:2});
    const [a,b]=await Promise.all([f.call(good),f.call(good)]);
    assert.deepEqual([a.status,b.status].sort(),[200,201]);
    assert.equal((await (await f.call(good)).json()).created,false);
    const changed=await f.call(f.submit(session,{q1:0,q2:0}));
    assert.equal(changed.status,409);
    const conflict=await changed.json();
    assert.equal(conflict.error,'ALREADY_SUBMITTED');
    assert.equal(conflict.result.score,10);
    assert.equal(f.count('phase6_exam_submissions'),1);
    f.setClock(NOW+500);
    const retry=await f.call(good);
    assert.equal(retry.status,200);
    assert.equal((await retry.json()).result.score,10);
  }finally{f.sqlite.close();}
});

test('signed B cannot read A submission or submit A session; account lock blocks requests',async()=>{
  const f=fixture();
  try{
    const a=(await (await f.call(f.start)).json()).session;
    const attack=await f.call(f.submit(a,{q1:1,q2:2}),B);
    assert.equal(attack.status,409);
    assert.deepEqual(await attack.json(),{error:'SESSION_NOT_STARTED'});
    assert.equal((await (await f.call(f.result,B)).json()).result,null);
    assert.equal((await f.call(f.submit(a,{q1:1,q2:2}))).status,201);
    assert.equal((await (await f.call(f.result,B)).json()).result,null);
    f.run('UPDATE demo_students SET active=0 WHERE firebase_uid=?',UID_A);
    assert.equal((await f.call(f.result)).status,401);
    assert.equal((await f.call(f.start)).status,401);
    assert.equal(f.count('phase6_exam_submissions'),1);
  }finally{f.sqlite.close();}
});

test('invalid and incomplete answers, forged UID/score/time never write submission',async()=>{
  const f=fixture();
  try{
    const session=(await (await f.call(f.start)).json()).session;
    const invalid=[
      {q1:1},{q1:1,q2:2,uid:UID_A},{q1:1,q2:4},
      {q1:1,q2:-1},{q1:0.5,q2:2},{q1:1,q2:'2'},null,
    ];
    for(const answers of invalid){
      const r=await f.call(f.submit(session,answers));
      assert.equal(r.status,400,JSON.stringify(answers));
      assert.deepEqual(await r.json(),{error:'INVALID_ANSWERS'});
    }
    for(const extra of [
      {score:10},{correctIndex:1},{startedAt:NOW-1000},
      {expiresAt:NOW+30000},{studentUid:UID_B},
    ]){
      const r=await f.call({...f.submit(session,{q1:1,q2:2}),...extra});
      assert.equal(r.status,400,JSON.stringify(extra));
    }
    assert.equal(f.count('phase6_exam_submissions'),0);
  }finally{f.sqlite.close();}
});

test('D1 submission trigger blocks direct forged deadline and UID writes',async()=>{
  const f=fixture();
  try{
    const session=(await (await f.call(f.start)).json()).session;
    const sql='INSERT INTO phase6_exam_submissions '+
      '(submission_id,session_id,student_uid,topic_id,revision,answers_json,'+
      'correct_count,total_count,score_tenths,submitted_at) '+
      'VALUES (?,?,?,?,?,?,?,?,?,?)';
    const args=(id,uid,time)=>[
      id,session.sessionId,uid,DEMO_TOPIC,2,'{"q1":1,"q2":2}',2,2,100,time,
    ];
    assert.throws(()=>f.run(sql,...args('fake_direct_uid_00001',UID_B,NOW)),/PHASE6_SESSION_OWNER_OR_DEADLINE/);
    f.setClock(NOW+121);
    assert.throws(()=>f.run(sql,...args('fake_direct_late_0002',UID_A,NOW+121)),/PHASE6_SESSION_OWNER_OR_DEADLINE/);
    assert.equal(f.count('phase6_exam_submissions'),0);
  }finally{f.sqlite.close();}
});

test('anonymous, Admin, forged, wrong project and invalid JWT never access D1 exam',async()=>{
  const f=fixture();
  try{
    f.queries.length=0;
    for(const jwt of ['',ADMIN,FORGED,INVALID_PROJECT,'bad.jwt.signature']){
      assert.equal((await f.call(f.start,jwt)).status,401);
    }
    assert.equal(f.queries.filter(q=>q.includes('phase6_exam_sessions')).length,0);
    assert.equal(f.count('phase6_exam_sessions'),0);
  }finally{f.sqlite.close();}
});

test('default OFF, pinned Preview only, POST JSON/Origin and missing binding deny access',async()=>{
  const f=fixture();
  try{
    const before=f.oldScores();
    for(const name of ['PHASE6_STUDENT_TIMED_EXAM_ENABLED','PHASE4_PREVIEW_HOST_OPT_IN']){
      const value=f.env[name];delete f.env[name];
      assert.equal((await f.call(f.start)).status,404);
      f.env[name]=value;
    }
    for(const url of [
      'https://'+PHASE4_PINNED_STAGING_HOST+PATH,
      'https://any.'+PHASE4_PINNED_STAGING_HOST+PATH,
      'https://attacker.example'+PATH,
    ])assert.equal((await f.call(f.start,A,{url})).status,404,url);
    assert.equal((await f.call(f.start,A,{method:'GET'})).status,405);
    assert.equal((await f.call(f.start,A,{type:'text/plain'})).status,415);
    assert.equal((await f.call(f.start,A,{origin:'https://attacker.example'})).status,403);
    assert.equal((await f.call(f.start,A,{url:ORIGIN+PATH+'?uid=wrong'})).status,400);
    f.env.AUTH_DB_PREVIEW=undefined;
    assert.equal((await f.call(f.start)).status,503);
    assert.equal(f.count('phase6_exam_sessions'),0);
    assert.deepEqual(f.oldScores(),before);
  }finally{f.sqlite.close();}
});

test('missing Phase6D schema fails safely rather than creating a table',async()=>{
  const f=fixture();
  try{
    f.sqlite.exec('DROP TABLE phase6_exam_submissions');
    assert.equal((await f.call(f.start)).status,503);
    assert.equal(f.count('phase6_exam_sessions'),0,'no orphan start on incomplete schema');
    assert.equal((await f.call(f.result)).status,503);
    assert.equal(f.count('phase5_content_attempts'),2);
  }finally{f.sqlite.close();}
});

test.after(()=>{
  globalThis.fetch=originalFetch;
  assert.ok(keyReads>0,'Firebase token signature verification is mandatory');
});
