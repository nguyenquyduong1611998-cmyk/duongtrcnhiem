// Phase 6C full HTTP/SQLite simulation: synthetic data and local RSA only.
// NO network calls or real Cloudflare/Firebase credentials are used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {PROJECT_ID,ADMIN_UID} from '../functions/_shared/auth.mjs';
import {PHASE4_PILOT_PREVIEW_HOST,PHASE4_PINNED_STAGING_HOST}
  from '../functions/_shared/phase4-host-guard.mjs';
import {onRequestPost as publishEndpoint} from '../functions/api/phase6/admin/publish.js';
import {onRequestPost as draftEndpoint} from '../functions/api/phase6/admin/drafts.js';
import {projectPublishedTopic} from '../functions/_shared/phase5-public-content.mjs';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const ORIGIN='https://'+PHASE4_PILOT_PREVIEW_HOST;
const PATH='/api/phase6/admin/publish';
const NOW=Math.floor(Date.now()/1000);
const A='student_'+'a'.repeat(32),B='student_'+'b'.repeat(32);
const kp=await crypto.subtle.generateKey({
  name:'RSASSA-PKCS1-v1_5',hash:'SHA-256',modulusLength:2048,
  publicExponent:new Uint8Array([1,0,1]),
},true,['sign','verify']);
const jwk={...(await crypto.subtle.exportKey('jwk',kp.publicKey)),
  kid:'phase6c-local-test-key',use:'sig'};
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
async function makeJwt(uid,provider='google.com',changes={}){
  const head=encode({alg:'RS256',kid:jwk.kid,typ:'JWT'});
  const body=encode({
    iss:'https://securetoken.google.com/'+PROJECT_ID,aud:PROJECT_ID,
    sub:uid,user_id:uid,iat:NOW,exp:NOW+3600,
    firebase:{sign_in_provider:provider},...changes,
  });
  const input=head+'.'+body;
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',kp.privateKey,
    new TextEncoder().encode(input));
  return input+'.'+Buffer.from(sig).toString('base64url');
}
const ADMIN=await makeJwt(ADMIN_UID),STUDENT=await makeJwt(A,'custom');
const FORGED=await makeJwt(A),BAD_PROJECT=await makeJwt(ADMIN_UID,'google.com',{aud:'fake'});
const BAD_PROVIDER=await makeJwt(ADMIN_UID,'custom');
const originalFetch=globalThis.fetch;
let keyReads=0;
globalThis.fetch=async url=>{
  keyReads++;
  assert.equal(url,'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  return new Response(JSON.stringify({keys:[jwk]}),{status:200});
};

function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for(const path of [
    'serverless/d1-staging-schema.sql',
    'serverless/d1-phase4-synthetic-graded-quiz.sql',
    'serverless/d1-phase5-preview-additive-schema.sql',
    'serverless/d1-phase5-preview-synthetic-math-seed.sql',
    'serverless/d1-phase6b-synthetic-admin-drafts-draft.sql',
    'serverless/d1-phase6c-publication-metadata-draft.sql',
  ])sqlite.exec(readFileSync(path,'utf8'));
  const run=(sql,...args)=>sqlite.prepare(sql).run(...args);
  for(const [username,uid] of [['test_hv_'+'a'.repeat(12),A],['test_hv_'+'b'.repeat(12),B]]){
    run('INSERT INTO demo_students(username,firebase_uid,password_salt,password_hash,kdf_iterations,active,created_at) VALUES (?,?,?,?,310000,1,?)',
      username,uid,'TEST_SALT','TEST_HASH',NOW);
  }
  run("INSERT INTO synthetic_graded_attempts(firebase_uid,quiz_id,answer_index,score,submitted_at,marker) VALUES (?,'synthetic_math_v1',1,10,?,'SYNTHETIC_ONLY')",A,NOW);
  for(const [uid,index,score] of [[A,1,100],[B,0,0]]){
    run("INSERT INTO phase5_content_attempts(attempt_id,student_uid,topic_id,revision,answers_json,correct_count,total_count,score_tenths,started_at,submitted_at,marker) VALUES (?,?,'p5_demo_math',1,?,?,?,?,?,?,'PHASE5_STAGING_MODEL')",
      'attempt_'+uid,uid,JSON.stringify({q1:index}),score===100?1:0,1,score,NOW,NOW);
  }

  const queries=[];
  let interruptAt=0;
  const d1={
    prepare(sql){
      queries.push(sql);
      const stmt={
        bind(...args){
          return {
            _sql:sql,_args:args,
            async first(){return sqlite.prepare(sql).get(...args)??null;},
            async all(){return {success:true,results:sqlite.prepare(sql).all(...args)};},
            async run(){
              const before=sqlite.prepare('SELECT total_changes() AS n').get().n;
              sqlite.prepare(sql).run(...args);
              // Match Cloudflare D1 total_changes() with draft audit trigger rows.
              const after=sqlite.prepare('SELECT total_changes() AS n').get().n;
              return {success:true,meta:{changes:after-before}};
            },
          };
        },
        async all(){return {success:true,results:sqlite.prepare(sql).all()};},
      };
      return stmt;
    },
    async batch(statements){
      sqlite.exec('BEGIN IMMEDIATE');
      try{
        const out=[];
        for(const statement of statements){
          const result=sqlite.prepare(statement._sql).run(...statement._args);
          out.push({success:true,meta:{changes:result.changes}});
          if(interruptAt&&out.length===interruptAt)throw new Error('INJECTED_TRANSACTION_FAILURE');
        }
        sqlite.exec('COMMIT');
        return out;
      }catch(error){
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const env={
    AUTH_DB:d1,AUTH_DB_PREVIEW:d1,
    FIREBASE_PROJECT_ID:PROJECT_ID,STAGING_AUTH_ENABLED:'true',
    FIREBASE_SERVICE_ACCOUNT_EMAIL:'synthetic@'+PROJECT_ID+'.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY:'FAKE_NEVER_USED',
    PHASE4_STAGING_HOSTNAME:PHASE4_PILOT_PREVIEW_HOST,
    PHASE4_PREVIEW_HOST_OPT_IN:'true',
    PHASE6_ADMIN_DRAFTS_ENABLED:'true',
    PHASE6_ADMIN_PUBLISH_ENABLED:'true',
  };
  const request=(body,jwt=ADMIN,opts={})=>{
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
  const call=(body,jwt=ADMIN,opts={})=>publishEndpoint({env,request:request(body,jwt,opts)});
  const draft=(body)=>draftEndpoint({env,request:request(body,ADMIN,{url:ORIGIN+'/api/phase6/admin/drafts'})});
  const makeDraft=async()=>{
    const response=await draft({action:'create',titleCode:'basic',minutes:30});
    assert.equal(response.status,201);
    const created=(await response.json()).draft;
    const saving=await draft({
      action:'save',draftId:created.draftId,version:1,
      titleCode:'practice',minutes:15,templates:['sum_2_2','minus_10_3'],
    });
    assert.equal(saving.status,200);
    return (await saving.json()).draft;
  };
  const count=t=>sqlite.prepare('SELECT count(*) AS n FROM '+t).get().n;
  const oldScores=()=>({
    phase4:sqlite.prepare('SELECT count(*) n,coalesce(sum(score),0) s FROM synthetic_graded_attempts').get(),
    phase5:sqlite.prepare('SELECT count(*) n,coalesce(sum(score_tenths),0) s FROM phase5_content_attempts').get(),
    a:sqlite.prepare('SELECT score_tenths FROM phase5_content_attempts WHERE student_uid=?').get(A).score_tenths,
    b:sqlite.prepare('SELECT score_tenths FROM phase5_content_attempts WHERE student_uid=?').get(B).score_tenths,
  });
  const state=()=>({
    topics:count('phase5_content_topics'),versions:count('phase5_content_versions'),
    questions:count('phase5_content_questions'),
    answerKeys:count('phase5_content_answer_keys'),
    links:count('phase6_admin_publications'),
  });
  return {
    sqlite,env,d1,draft,call,makeDraft,count,queries,state,oldScores,
    setInterruptAt:n=>{interruptAt=n;},
  };
}
const PUBLISH=d=>({
  action:'publish',draftId:d.draftId,version:d.version,
  confirmation:'PUBLISH_SYNTHETIC_MATH_REVISION',
});

test('verified Admin publishes an immutable synthetic revision without leaking answer keys',async()=>{
  const f=fixture();
  try{
    const before=f.oldScores(),draft=await f.makeDraft();
    const response=await f.call(PUBLISH(draft));
    assert.equal(response.status,201);
    assert.equal(response.headers.get('cache-control'),'no-store, max-age=0');
    const body=await response.json();
    assert.equal(body.created,true);
    assert.deepEqual(body.publication,{
      topicId:draft.draftId,revision:2,questionCount:2,
      timeLimitSeconds:900,publishedAt:body.publication.publishedAt,status:'published',
    });
    for(const forbidden of ['correctIndex','correct_index','answers_json','answer_keys',
      'password_hash','student_uid','firebase_uid','explanation','TEST_HASH']){
      assert.equal(JSON.stringify(body).includes(forbidden),false,forbidden);
    }
    const v=f.sqlite.prepare('SELECT * FROM phase5_content_versions WHERE topic_id=? AND revision=?')
      .get(draft.draftId,2);
    const q=f.sqlite.prepare('SELECT * FROM phase5_content_questions WHERE topic_id=? AND revision=? ORDER BY order_index').all(draft.draftId,2);
    const keys=f.sqlite.prepare('SELECT question_id,correct_index FROM phase5_content_answer_keys WHERE topic_id=? AND revision=? ORDER BY question_id').all(draft.draftId,2);
    assert.equal(v.state,'published');
    assert.equal(v.time_limit_seconds,900);
    assert.equal(q.length,2);
    assert.equal(keys.length,2);
    assert.deepEqual(keys.map(x=>x.correct_index),[1,2]);
    const projected=projectPublishedTopic(v,q);
    assert.equal(projected.questions.length,2);
    assert.equal(JSON.stringify(projected).includes('correctIndex'),false);
    assert.equal(JSON.stringify(projected).includes('correct_index'),false);
    assert.equal(f.count('phase6_admin_publications'),1);
    assert.deepEqual(f.oldScores(),before);
    assert.throws(()=>f.sqlite.prepare("UPDATE phase5_content_versions SET title='tampered' WHERE topic_id=? AND revision=2").run(draft.draftId),/IMMUTABLE/);
    assert.throws(()=>f.sqlite.prepare("UPDATE phase5_content_answer_keys SET correct_index=0 WHERE topic_id=? AND revision=2").run(draft.draftId),/IMMUTABLE/);
    assert.throws(()=>f.sqlite.prepare("DELETE FROM phase6_admin_publications").run(),/IMMUTABLE/);
    assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{f.sqlite.close();}
});

test('retry/double click never publishes twice; saving draft creates later revision only',async()=>{
  const f=fixture();
  try{
    const draft=await f.makeDraft(),payload=PUBLISH(draft);
    const [a,b]=await Promise.all([f.call(payload),f.call(payload)]);
    assert.deepEqual([a.status,b.status].sort(),[200,201]);
    const retry=await f.call(payload);
    assert.equal(retry.status,200);
    assert.equal((await retry.json()).created,false);
    assert.equal(f.count('phase6_admin_publications'),1);
    const saving=await f.draft({
      action:'save',draftId:draft.draftId,version:2,
      titleCode:'challenge',minutes:60,templates:['sum_7_8'],
    });
    assert.equal(saving.status,200);
    const fresh=(await saving.json()).draft;
    assert.equal(fresh.version,3);
    assert.equal((await f.call(PUBLISH(fresh))).status,201);
    assert.equal(f.count('phase6_admin_publications'),2);
    const rows=f.sqlite.prepare('SELECT revision,time_limit_seconds FROM phase5_content_versions WHERE topic_id=? ORDER BY revision').all(draft.draftId);
    assert.deepEqual(rows.map(x=>({revision:x.revision,time:x.time_limit_seconds})),[
      {revision:2,time:900},{revision:3,time:3600},
    ]);
  }finally{f.sqlite.close();}
});

test('partial failure rolls back all topic, questions, keys and publication metadata',async()=>{
  const f=fixture();
  try{
    const draft=await f.makeDraft(),before=f.state(),scores=f.oldScores();
    f.setInterruptAt(4);
    assert.equal((await f.call(PUBLISH(draft))).status,503);
    assert.deepEqual(f.state(),before);
    assert.deepEqual(f.oldScores(),scores);
    f.setInterruptAt(0);
    assert.equal((await f.call(PUBLISH(draft))).status,201);
  }finally{f.sqlite.close();}
});

test('empty drafts, stale version, wrong confirmation, forged fields and free text cannot publish',async()=>{
  const f=fixture();
  try{
    const draft=await f.makeDraft();
    for(const payload of [
      {...PUBLISH(draft),confirmation:false},
      {...PUBLISH(draft),uid:A},
      {...PUBLISH(draft),correctIndex:1},
      {...PUBLISH(draft),score:10},
      {...PUBLISH(draft),questions:[{text:'secret'}]},
      {...PUBLISH(draft),action:'import'},
      {...PUBLISH(draft),version:0},
      {action:'publish',draftId:'bad',version:2,confirmation:'PUBLISH_SYNTHETIC_MATH_REVISION'},
    ])assert.equal((await f.call(payload)).status,400);
    assert.equal((await f.call({...PUBLISH(draft),version:1})).status,409);
    const empty=await f.draft({action:'create',titleCode:'basic',minutes:10});
    const obj=(await empty.json()).draft;
    assert.equal((await f.call(PUBLISH(obj))).status,400);
    assert.equal(f.count('phase6_admin_publications'),0);
    assert.equal(f.count('phase5_content_versions'),1);
  }finally{f.sqlite.close();}
});

test('anonymous/student/forged/wrong project and provider cannot publish or even read D1',async()=>{
  const f=fixture();
  try{
    const draft=await f.makeDraft();
    f.queries.length=0;
    for(const jwt of ['',STUDENT,FORGED,BAD_PROJECT,BAD_PROVIDER,'broken.token.data']){
      const response=await f.call(PUBLISH(draft),jwt);
      assert.equal(response.status,403);
      assert.deepEqual(await response.json(),{error:'ADMIN_AUTH_REQUIRED'});
    }
    assert.equal(f.queries.length,0);
    assert.equal(f.count('phase6_admin_publications'),0);
  }finally{f.sqlite.close();}
});

test('independent default-OFF flags, host lock, missing Preview DB and cross-origin denial',async()=>{
  const f=fixture();
  try{
    const draft=await f.makeDraft();
    for(const name of ['PHASE6_ADMIN_PUBLISH_ENABLED','PHASE6_ADMIN_DRAFTS_ENABLED','PHASE4_PREVIEW_HOST_OPT_IN']){
      const value=f.env[name];delete f.env[name];
      assert.equal((await f.call(PUBLISH(draft))).status,404,name);
      f.env[name]=value;
    }
    for(const url of [
      'https://'+PHASE4_PINNED_STAGING_HOST+PATH,
      'https://other.'+PHASE4_PINNED_STAGING_HOST+PATH,
      'https://malicious.example'+PATH,
    ])assert.equal((await f.call(PUBLISH(draft),ADMIN,{url})).status,404);
    assert.equal((await f.call(PUBLISH(draft),ADMIN,{method:'GET'})).status,405);
    assert.equal((await f.call(PUBLISH(draft),ADMIN,{type:'text/plain'})).status,415);
    assert.equal((await f.call(PUBLISH(draft),ADMIN,{origin:'https://evil.example'})).status,403);
    assert.equal((await f.call(PUBLISH(draft),ADMIN,{url:ORIGIN+PATH+'?admin=1'})).status,400);
    f.env.AUTH_DB_PREVIEW=undefined;
    assert.equal((await f.call(PUBLISH(draft))).status,503);
    assert.equal(f.count('phase6_admin_publications'),0);
  }finally{f.sqlite.close();}
});

test('missing publication schema fails safe, does not silently create tables',async()=>{
  const f=fixture();
  try{
    const draft=await f.makeDraft(),scores=f.oldScores();
    f.sqlite.exec('DROP TABLE phase6_admin_publications');
    assert.equal((await f.call(PUBLISH(draft))).status,503);
    assert.deepEqual(f.oldScores(),scores);
    assert.equal(f.count('phase5_content_versions'),1);
  }finally{f.sqlite.close();}
});

test.after(()=>{
  globalThis.fetch=originalFetch;
  assert.ok(keyReads>0,'must verify actual RSA signatures for Google Admin');
});
