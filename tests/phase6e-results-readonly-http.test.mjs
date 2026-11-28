// Phase 6E: signed HTTP + D1 read-only history tests, entirely offline.
// Uses fake DEMO math and an in-memory SQLite database; no remote services.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {PROJECT_ID,ADMIN_UID} from '../functions/_shared/auth.mjs';
import {PHASE4_PILOT_PREVIEW_HOST,PHASE4_PINNED_STAGING_HOST}
  from '../functions/_shared/phase4-host-guard.mjs';
import {onRequestPost as studentEndpoint}
  from '../functions/api/phase6/results/student.js';
import {onRequestPost as adminEndpoint}
  from '../functions/api/phase6/results/admin.js';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const NOW=Math.floor(Date.now()/1000);
const A='student_'+'a'.repeat(32),B='student_'+'b'.repeat(32);
const ORIGIN='https://'+PHASE4_PILOT_PREVIEW_HOST;
const kp=await crypto.subtle.generateKey({
  name:'RSASSA-PKCS1-v1_5',hash:'SHA-256',modulusLength:2048,
  publicExponent:new Uint8Array([1,0,1]),
},true,['sign','verify']);
const jwk={...(await crypto.subtle.exportKey('jwk',kp.publicKey)),kid:'phase6e-local-rsa',use:'sig'};
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
async function jwt(uid,provider='custom',changes={}){
  const header=encode({alg:'RS256',kid:jwk.kid,typ:'JWT'});
  const payload=encode({
    iss:'https://securetoken.google.com/'+PROJECT_ID,aud:PROJECT_ID,
    sub:uid,user_id:uid,iat:NOW,exp:NOW+3600,auth_time:NOW-10,
    firebase:{sign_in_provider:provider},...changes,
  });
  const msg=header+'.'+payload;
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',kp.privateKey,
    new TextEncoder().encode(msg));
  return msg+'.'+Buffer.from(sig).toString('base64url');
}
const STUDENT_A=await jwt(A),STUDENT_B=await jwt(B);
const ADMIN=await jwt(ADMIN_UID,'google.com');
const FORGED_STUDENT=await jwt(B,'google.com');
const FORGED_ADMIN=await jwt(A,'google.com');
const WRONG_PROJECT=await jwt(ADMIN_UID,'google.com',{aud:'fake-project'});
const originalFetch=globalThis.fetch;
let jwksReads=0;
globalThis.fetch=async url=>{
  jwksReads++;
  assert.equal(url,
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  return new Response(JSON.stringify({keys:[jwk]}),{status:200});
};

function fixture(topicCount=3){
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.function('unixepoch',()=>NOW);
  for(const file of [
    'serverless/d1-staging-schema.sql',
    'serverless/d1-phase4-synthetic-graded-quiz.sql',
    'serverless/d1-phase5-preview-additive-schema.sql',
    'serverless/d1-phase5-preview-synthetic-math-seed.sql',
    'serverless/d1-phase6b-synthetic-admin-drafts-draft.sql',
    'serverless/d1-phase6c-publication-metadata-draft.sql',
    'serverless/d1-phase6-timed-sessions-draft.sql',
    'serverless/d1-phase6d-timed-submissions-draft.sql',
  ])db.exec(readFileSync(file,'utf8'));
  const run=(sql,...args)=>db.prepare(sql).run(...args);
  const one=(sql,...args)=>db.prepare(sql).get(...args);
  const count=table=>one('SELECT count(*) AS n FROM '+table).n;
  for(const [uid,c] of [[A,'a'],[B,'b']])
    run('INSERT INTO demo_students(username,firebase_uid,password_salt,password_hash,kdf_iterations,active,created_at) VALUES (?,?,?,?,310000,1,?)',
      'test_hv_'+c.repeat(12),uid,'TEST_SALT','TEST_HASH',NOW-700);
  // Pre-existing Phase4 and Phase5 A/B scores must remain untouched.
  run("INSERT INTO synthetic_graded_attempts(firebase_uid,quiz_id,answer_index,score,submitted_at,marker) VALUES (?,'synthetic_math_v1',1,10,?,'SYNTHETIC_ONLY')",
    A,NOW-500);
  for(const [uid,correct,score] of [[A,1,100],[B,0,0]])
    run("INSERT INTO phase5_content_attempts(attempt_id,student_uid,topic_id,revision,answers_json,correct_count,total_count,score_tenths,started_at,submitted_at,marker) VALUES (?,?,'p5_demo_math',1,?,?,?,?,?,?,'PHASE5_STAGING_MODEL')",
      'attempt_'+uid,uid,JSON.stringify({q1:correct}),correct,1,score,NOW-450,NOW-450);
  const submission=(i,uid,correct)=>{
    const id='p6_demo_'+i.toString(16).padStart(32,'0');
    const topicExists=one('SELECT topic_id FROM phase5_content_topics WHERE topic_id=?',id);
    if(!topicExists){
      run('INSERT INTO phase5_content_topics(topic_id,created_at) VALUES (?,?)',id,NOW-600);
      run("INSERT INTO phase5_content_versions(topic_id,revision,code,title,description,time_limit_seconds,state,created_at,published_at) VALUES (?,1,'P6-DEMO',?,'Synthetic math only',120,'draft',?,NULL)",
        id,'Toán học DEMO số '+i,NOW-600);
      run("INSERT INTO phase5_content_questions(topic_id,revision,question_id,order_index,question_text,option_a,option_b,option_c,option_d) VALUES (?,1,'q1',1,'2 + 2 = ?','3','4','5','6')",id);
      run("INSERT INTO phase5_content_answer_keys(topic_id,revision,question_id,correct_index,explanation) VALUES (?,1,'q1',1,'Synthetic')",id);
      run("UPDATE phase5_content_versions SET state='published',published_at=? WHERE topic_id=? AND revision=1",NOW-500,id);
      run("INSERT INTO phase6_admin_publications(draft_id,revision,published_at,marker) VALUES (?,1,?,'PHASE6_SYNTHETIC_PUBLICATION')",id,NOW-500);
    }
    const label=(uid===A?'a':'b')+i.toString(16).padStart(31,'0');
    const sessionId='p6_session_'+label;
    const submittedId='p6_submit_'+label;
    run('INSERT INTO phase6_exam_sessions(session_id,student_uid,topic_id,revision,question_count,time_limit_seconds,started_at,expires_at,marker) VALUES (?,?,?,1,1,120,?,?,?)',
      sessionId,uid,id,NOW,NOW+120,'PHASE6_PREVIEW_DRAFT');
    run("INSERT INTO phase6_exam_submissions(submission_id,session_id,student_uid,topic_id,revision,answers_json,correct_count,total_count,score_tenths,submitted_at,marker) VALUES (?,?,?,?,1,?,?,?,?,?,'PHASE6_SYNTHETIC_SUBMISSION')",
      submittedId,sessionId,uid,id,
      JSON.stringify({q1:correct?1:0}),correct,1,correct?100:0,NOW);
  };
  for(let i=1;i<=topicCount;i++)submission(i,A,1);
  submission(1,B,0);
  const queries=[];
  const d1={
    prepare(sql){
      queries.push(sql);
      return {
        bind(...args){return {
          async all(){return {success:true,results:db.prepare(sql).all(...args)};},
          async first(){return db.prepare(sql).get(...args)??null;},
        };},
        async all(){return {success:true,results:db.prepare(sql).all()};},
        async first(){return db.prepare(sql).get()??null;},
      };
    },
  };
  const env={
    AUTH_DB:d1,AUTH_DB_PREVIEW:d1,
    FIREBASE_PROJECT_ID:PROJECT_ID,STAGING_AUTH_ENABLED:'true',
    FIREBASE_SERVICE_ACCOUNT_EMAIL:'fake@'+PROJECT_ID+'.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY:'FAKE_TEST_ONLY',
    PHASE4_STAGING_HOSTNAME:PHASE4_PILOT_PREVIEW_HOST,
    PHASE4_PREVIEW_HOST_OPT_IN:'true',
    PHASE6_RESULTS_READONLY_ENABLED:'true',
    PHASE6_ADMIN_RESULTS_ENABLED:'true',
  };
  const send=(role,body,jwtToken=role==='admin'?ADMIN:STUDENT_A,opts={})=>{
    const path='/api/phase6/results/'+role;
    const request=new Request(opts.url??ORIGIN+path,{
      method:opts.method??'POST',
      headers:{
        'content-type':opts.type??'application/json',
        ...(jwtToken?{authorization:'Bearer '+jwtToken}:{}),
        ...(opts.origin?{origin:opts.origin}:{}),
      },
      ...(opts.method==='GET'?{}:{body:JSON.stringify(body)}),
    });
    return (role==='admin'?adminEndpoint:studentEndpoint)({request,env});
  };
  const previous=()=>({
    phase4:count('synthetic_graded_attempts'),
    phase5:count('phase5_content_attempts'),
    phase5Sum:one('SELECT sum(score_tenths) s FROM phase5_content_attempts').s,
    submissions:count('phase6_exam_submissions'),
    sessions:count('phase6_exam_sessions'),
  });
  return {db,d1,send,env,queries,run,one,count,previous};
}

test('own history returns own DEMO scores only, ordered, no private fields or A/B leak',async()=>{
  const f=fixture();
  try{
    const before=f.previous();
    const a=await f.send('student',{action:'list',offset:0},STUDENT_A);
    assert.equal(a.status,200);
    assert.equal(a.headers.get('cache-control'),'no-store, max-age=0');
    const x=await a.json();
    assert.equal(x.mode,'phase6-student-history-readonly');
    assert.equal(x.entries.length,3);
    assert.equal(x.nextOffset,null);
    assert.deepEqual(x.entries.map(r=>r.score),[10,10,10]);
    const b=await (await f.send('student',{action:'list',offset:0},STUDENT_B)).json();
    assert.equal(b.entries.length,1);
    assert.equal(b.entries[0].score,0);
    const body=JSON.stringify(x)+JSON.stringify(b);
    for(const secret of ['student_uid','firebase_uid','username','password_',
      'answers_json','correct_index','answer_keys','session_id','TEST_HASH']){
      assert.equal(body.includes(secret),false,secret);
    }
    assert.deepEqual(f.previous(),before);
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{f.db.close();}
});

test('Admin summary and paged DEMO board include no UID, answer map or private key',async()=>{
  const f=fixture(27);
  try{
    const before=f.previous();
    const summaryResp=await f.send('admin',{action:'summary'});
    assert.equal(summaryResp.status,200);
    const sum=(await summaryResp.json()).summary;
    assert.equal(sum.attemptCount,28);
    assert.equal(sum.studentCount,2);
    assert.equal(sum.averageScore,9.6);
    assert.equal(sum.maxScore,10);
    const first=(await (await f.send('admin',{action:'list',offset:0})).json());
    assert.equal(first.entries.length,25);
    assert.equal(first.nextOffset,25);
    const second=(await (await f.send('admin',{action:'list',offset:25})).json());
    assert.equal(second.entries.length,3);
    assert.equal(second.nextOffset,null);
    const aFirst=(await (await f.send('student',{action:'list',offset:0},STUDENT_A)).json());
    const aSecond=(await (await f.send('student',{action:'list',offset:25},STUDENT_A)).json());
    assert.equal(aFirst.entries.length,25);
    assert.equal(aFirst.nextOffset,25);
    assert.equal(aSecond.entries.length,2);
    assert.deepEqual([...first.entries,...second.entries].filter(r=>r.score===0)
      .map(r=>r.username),['test_hv_'+'b'.repeat(12)]);
    const payload=JSON.stringify({first,second,sum,aFirst,aSecond});
    for(const secret of ['student_uid','firebase_uid','answers_json',
      'correct_index','answer_keys','password_hash','session_id'])
      assert.equal(payload.includes(secret),false,secret);
    assert.deepEqual(f.previous(),before);
    assert.equal(f.queries.some(q=>/phase5_content_answer_keys|answers_json/.test(q)),false);
    assert.equal(f.queries.some(q=>/\bINSERT\b|\bUPDATE\b|\bDELETE\b/i.test(q)),false);
  }finally{f.db.close();}
});

test('invalid pagination, user input filters and impersonation fail closed',async()=>{
  const f=fixture();
  try{
    for(const input of [
      {action:'list'},{action:'list',offset:-25},
      {action:'list',offset:1},{action:'list',offset:10025},
      {action:'list',offset:0,uid:B},{action:'list',offset:0,username:'test_hv_aaaaaaaaaaaa'},
      {action:'list',offset:0,topicId:'p6_demo_other'},
      {action:'export'},{action:'submit',offset:0},{action:'summary',offset:0},
    ]){
      assert.equal((await f.send('student',input)).status,400,JSON.stringify(input));
    }
    for(const input of [{action:'list',offset:-1},{action:'list',offset:0,uid:A},
      {action:'summary',uid:A},{action:'export'},{action:'list',offset:0,sort:'score'}])
      assert.equal((await f.send('admin',input)).status,400,JSON.stringify(input));
    assert.equal(f.count('phase6_exam_submissions'),4);
  }finally{f.db.close();}
});

test('Admin vs student JWTs, anonymous, wrong project and locked student deny reads',async()=>{
  const f=fixture();
  try{
    const bad=['',STUDENT_A,STUDENT_B,FORGED_ADMIN,WRONG_PROJECT,'bad.jwt.signature'];
    f.queries.length=0;
    for(const token of bad){
      const r=await f.send('admin',{action:'list',offset:0},token);
      assert.equal(r.status,403);
      assert.deepEqual(await r.json(),{error:'ADMIN_AUTH_REQUIRED'});
    }
    assert.equal(f.queries.length,0,'Admin must be verified before querying D1');
    for(const token of ['',ADMIN,FORGED_STUDENT,'bad.jwt.signature'])
      assert.equal((await f.send('student',{action:'list',offset:0},token)).status,401);
    f.run('UPDATE demo_students SET active=0 WHERE firebase_uid=?',A);
    assert.equal((await f.send('student',{action:'list',offset:0},STUDENT_A)).status,401);
    assert.equal((await f.send('student',{action:'list',offset:0},STUDENT_B)).status,200);
    assert.equal((await f.send('admin',{action:'summary'})).status,200,
      'Admin can still audit already submitted DEMO grades');
  }finally{f.db.close();}
});

test('default-OFF flags, hostname pin, origin, content-type and missing Preview DB',async()=>{
  const f=fixture();
  try{
    const before=f.previous();
    for(const [role,name] of [
      ['admin','PHASE6_ADMIN_RESULTS_ENABLED'],
      ['admin','PHASE6_RESULTS_READONLY_ENABLED'],
      ['student','PHASE6_RESULTS_READONLY_ENABLED'],
    ]){
      const value=f.env[name];delete f.env[name];
      assert.equal((await f.send(role,{action:'list',offset:0})).status,404);
      f.env[name]=value;
    }
    for(const role of ['student','admin']){
      for(const url of [
        'https://'+PHASE4_PINNED_STAGING_HOST+'/api/phase6/results/'+role,
        'https://malicious.example/api/phase6/results/'+role,
      ])assert.equal((await f.send(role,{action:'list',offset:0},undefined,{url})).status,404);
      assert.equal((await f.send(role,{action:'list',offset:0},undefined,{method:'GET'})).status,405);
      assert.equal((await f.send(role,{action:'list',offset:0},undefined,{type:'text/plain'})).status,415);
      assert.equal((await f.send(role,{action:'list',offset:0},undefined,{origin:'https://other.example'})).status,403);
      assert.equal((await f.send(role,{action:'list',offset:0},undefined,
        {url:ORIGIN+'/api/phase6/results/'+role+'?debug=true'})).status,400);
    }
    f.env.AUTH_DB_PREVIEW=undefined;
    assert.equal((await f.send('student',{action:'list',offset:0})).status,503);
    assert.equal((await f.send('admin',{action:'summary'})).status,503);
    assert.deepEqual(f.previous(),before);
  }finally{f.db.close();}
});

test('missing D1 results schema gives 503 without altering earlier scores',async()=>{
  const f=fixture();
  try{
    const old=f.previous();
    f.db.exec('DROP TABLE phase6_exam_submissions');
    assert.equal((await f.send('student',{action:'list',offset:0})).status,503);
    assert.equal((await f.send('admin',{action:'summary'})).status,503);
    assert.equal(f.count('phase5_content_attempts'),old.phase5);
  }finally{f.db.close();}
});

test.after(()=>{
  globalThis.fetch=originalFetch;
  assert.ok(jwksReads>0,'signed Firebase JWT checks must run');
});
