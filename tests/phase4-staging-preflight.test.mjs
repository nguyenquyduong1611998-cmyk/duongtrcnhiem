// Phase 4D — no Cloudflare D1 calls; in-memory sqlite + signed mock Admin.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PROJECT_ID,ADMIN_UID} from '../functions/_shared/auth.mjs';
import {PHASE4_PILOT_PREVIEW_HOST} from '../functions/_shared/phase4-host-guard.mjs';
import {inspectStagingDemoQuizSchema}
  from '../functions/_shared/phase4-staging-preflight.mjs';
import {onRequestPost}
  from '../functions/api/demo-quiz/preflight.js';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const now=Math.floor(Date.now()/1000);
const origin='https://duongtrcnhiem-test.pages.dev';
const base=readFileSync('serverless/d1-staging-schema.sql','utf8');
const unit=readFileSync('serverless/d1-phase2-staging-accounts.sql','utf8');
const quiz=readFileSync('serverless/d1-phase4-synthetic-graded-quiz.sql','utf8');
const keyPair=await crypto.subtle.generateKey(
  {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256',
    modulusLength:2048,publicExponent:new Uint8Array([1,0,1])},
  true,['sign','verify'],
);
const key={
  ...(await crypto.subtle.exportKey('jwk',keyPair.publicKey)),
  kid:'phase4-preflight-test-key',use:'sig',
};
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
async function adminToken(uid=ADMIN_UID,provider='google.com'){
  const unsigned=b64({alg:'RS256',typ:'JWT',kid:key.kid})+'.'+b64({
    iss:'https://securetoken.google.com/'+PROJECT_ID,
    aud:PROJECT_ID,sub:uid,user_id:uid,iat:now,exp:now+3500,
    firebase:{sign_in_provider:provider},
  });
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',
    keyPair.privateKey,new TextEncoder().encode(unsigned));
  return unsigned+'.'+Buffer.from(signature).toString('base64url');
}
const originalFetch=globalThis.fetch;
let googleCalls=0;
globalThis.fetch=async url=>{
  googleCalls++;
  assert.equal(url,
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  return new Response(JSON.stringify({keys:[key]}),{status:200});
};

function fixture({withUnit=true,withQuiz=false,withBaseline=true}={}){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  if(withBaseline)sqlite.exec(base);
  if(withUnit)sqlite.exec(unit);
  if(withQuiz)sqlite.exec(quiz);
  const sqlUsed=[];
  const db={
    prepare(sql){
      sqlUsed.push(sql);
      const stmt=sqlite.prepare(sql);
      return {
        async all(){return {success:true,results:stmt.all()};},
        bind(...args){return {
          async first(){return stmt.get(...args)??null;},
          async all(){return {results:stmt.all(...args)};},
        };},
      };
    },
  };
  const env={
    AUTH_DB:db,STAGING_AUTH_ENABLED:'true',
    FIREBASE_PROJECT_ID:PROJECT_ID,
    FIREBASE_SERVICE_ACCOUNT_EMAIL:
      'synthetic@'+PROJECT_ID+'.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY:'UNUSED_PLACEHOLDER_NO_REAL_SECRET',
    PHASE4_STAGING_PREFLIGHT_ENABLED:'true',
    PHASE4_STAGING_HOSTNAME:'duongtrcnhiem-test.pages.dev',
  };
  const request=(token='',body={action:'inspect'})=>new Request(
    origin+'/api/demo-quiz/preflight',{
      method:'POST',headers:{
        origin,'content-type':'application/json',
        ...(token?{authorization:'Bearer '+token}:{}),
      },body:JSON.stringify(body),
    },
  );
  return {sqlite,db,env,sqlUsed,request};
}
test('before migration: read-only report identifies valid baseline and no score table',async()=>{
  const f=fixture();
  try{
    const result=await inspectStagingDemoQuizSchema(f.db);
    assert.equal(result.status,'REVIEW_MIGRATION_ONLY');
    assert.equal(result.deploymentAuthorized,false);
    assert.equal(result.canExecuteMigrationAutomatically,false);
    assert.equal(result.requiresFreshBackup,true);
    assert.equal(result.needsHumanApproval,true);
    assert.equal(result.synthetic.exists,false);
    assert.equal(result.synthetic.rowCount,null);
    assert.deepEqual(result.existingRowCounts,{
      demo_students:0,login_attempts:0,unit_accounts:0,
    });
    assert.equal(result.baseline.demo_students.requiredColumnsPresent,true);
    assert.equal(result.baseline.unit_accounts.requiredColumnsPresent,true);
    assert.ok(f.sqlUsed.length>0);
    for(const sql of f.sqlUsed){
      assert.match(sql,/^(SELECT|PRAGMA)\s/i);
      assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|DROP|ALTER|ATTACH)\b/i);
    }
    assert.equal(f.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE name='synthetic_graded_attempts'"
    ).get().n,0);
  }finally{f.sqlite.close();}
});
test('two-table Preview is valid only under explicit preview-demo profile',async()=>{
  for(const withQuiz of [false,true]){
    const f=fixture({withUnit:false,withQuiz});
    try{
      const canonical=await inspectStagingDemoQuizSchema(f.db);
      assert.equal(canonical.status,'BLOCKED');
      assert.equal(canonical.profile,'canonical');
      const preview=await inspectStagingDemoQuizSchema(f.db,{profile:'preview-demo'});
      assert.equal(preview.status,withQuiz?'SYNTHETIC_SCHEMA_PRESENT':'REVIEW_MIGRATION_ONLY');
      assert.equal(preview.baseline.demo_students.required,true);
      assert.equal(preview.baseline.login_attempts.required,true);
      assert.equal(preview.baseline.unit_accounts.required,false);
      assert.equal(preview.baseline.unit_accounts.exists,false);
      assert.equal(preview.deploymentAuthorized,false);
      assert.equal(preview.canExecuteMigrationAutomatically,false);
    }finally{f.sqlite.close();}
  }
});
test('preflight requires an opted-in exact Preview alias before two-table inspection',async()=>{
  const f=fixture({withUnit:false});
  try{
    const previewOrigin='https://'+PHASE4_PILOT_PREVIEW_HOST;
    f.env.AUTH_DB_PREVIEW=f.db;
    f.env.PHASE4_STAGING_HOSTNAME=PHASE4_PILOT_PREVIEW_HOST;
    const makeRequest=token=>new Request(previewOrigin+'/api/demo-quiz/preflight',{
      method:'POST',headers:{origin:previewOrigin,'content-type':'application/json',
        authorization:'Bearer '+token},
      body:JSON.stringify({action:'inspect'}),
    });
    const token=await adminToken();
    assert.equal((await onRequestPost({request:makeRequest(token),env:f.env})).status,404);
    f.env.PHASE4_PREVIEW_HOST_OPT_IN='true';
    assert.equal((await onRequestPost({request:makeRequest('invalid'),env:f.env})).status,403);
    const response=await onRequestPost({request:makeRequest(token),env:f.env});
    assert.equal(response.status,200);
    const report=await response.json();
    assert.equal(report.profile,'preview-demo');
    assert.equal(report.status,'REVIEW_MIGRATION_ONLY');
    assert.equal(report.baseline.unit_accounts.required,false);
    assert.equal(report.existingRowCounts.demo_students,0);
    assert.equal(report.existingRowCounts.login_attempts,0);
    assert.equal(report.deploymentAuthorized,false);
  }finally{f.sqlite.close();}
});
test('after migration: verifies table, columns, FK, index and append-only trigger',async()=>{
  const f=fixture({withQuiz:true});
  try{
    const report=await inspectStagingDemoQuizSchema(f.db);
    assert.equal(report.status,'SYNTHETIC_SCHEMA_PRESENT');
    assert.equal(report.synthetic.exists,true);
    assert.equal(report.synthetic.columnsValid,true);
    assert.equal(report.synthetic.foreignKeyValid,true);
    assert.equal(report.synthetic.constraintsValid,true);
    assert.equal(report.synthetic.immutableTriggerPresent,true);
    assert.equal(report.synthetic.dateIndexPresent,true);
    assert.equal(report.synthetic.rowCount,0);
    assert.equal(report.deploymentAuthorized,false);
    assert.equal(JSON.stringify(report).includes('password_hash'),false);
  }finally{f.sqlite.close();}
});
test('blocks missing baseline, incomplete score table, and schema name collisions',async()=>{
  for(const type of ['missing-unit','incomplete','name-collision']){
    const f=fixture({
      withUnit:type!=='missing-unit',withQuiz:false,
    });
    try {
      if(type==='incomplete') f.sqlite.exec(
        'CREATE TABLE synthetic_graded_attempts (firebase_uid TEXT PRIMARY KEY)'
      );
      if(type==='name-collision') f.sqlite.exec(
        'CREATE VIEW synthetic_grade_no_update AS SELECT 1 AS probe'
      );
      const report=await inspectStagingDemoQuizSchema(f.db);
      assert.equal(report.status,'BLOCKED',type);
      assert.equal(report.deploymentAuthorized,false);
      assert.equal(report.canExecuteMigrationAutomatically,false);
    }finally{f.sqlite.close();}
  }
});
test('spoofed table, index or no-op trigger is BLOCKED even with plausible names',async()=>{
  const cases=[
    // A table with the correct columns, but no grading CHECK protection.
    "CREATE TABLE synthetic_graded_attempts ("+
      "firebase_uid TEXT PRIMARY KEY REFERENCES demo_students(firebase_uid) ON DELETE CASCADE,"+
      "quiz_id TEXT,answer_index INTEGER,score INTEGER,submitted_at INTEGER,marker TEXT);"+
    "CREATE INDEX synthetic_graded_attempts_by_date "+
      "ON synthetic_graded_attempts(submitted_at DESC);"+
    "CREATE TRIGGER synthetic_grade_no_update "+
      "BEFORE UPDATE ON synthetic_graded_attempts BEGIN SELECT 1; END;",
    // The index name looks correct, but it points to the wrong table.
    "CREATE INDEX synthetic_graded_attempts_by_date "+
      "ON demo_students(created_at DESC);",
  ];
  for(const sql of cases){
    const f=fixture();
    try{
      f.sqlite.exec(sql);
      const result=await inspectStagingDemoQuizSchema(f.db);
      assert.equal(result.status,'BLOCKED');
      assert.equal(result.deploymentAuthorized,false);
      if(sql.includes('BEGIN SELECT 1'))
        assert.equal(result.synthetic.immutableTriggerPresent,false);
    }finally{f.sqlite.close();}
  }
});
test('rejects corrupt or inconsistent D1 adapter metadata, never infers readiness',async()=>{
  const f=fixture();
  try{
    const broken={prepare(sql){
      return {
        async all(){
          if(sql.includes('sqlite_master'))
            return {results:[{name:'demo_students',type:'table'},
              {name:'demo_students',type:'table'}]};
          return {results:[]};
        },
      };
    }};
    await assert.rejects(inspectStagingDemoQuizSchema(broken),
      /INVALID_SCHEMA_OBJECT/);
    await assert.rejects(inspectStagingDemoQuizSchema(null),
      /MISSING_STAGING_D1/);
  }finally{f.sqlite.close();}
});
test('HTTP route defaults to 404, rejects unauthenticated, wrong Admin, and SQL input',async()=>{
  const f=fixture();
  try{
    delete f.env.PHASE4_STAGING_PREFLIGHT_ENABLED;
    assert.equal((await onRequestPost({
      request:f.request(),env:f.env,
    })).status,404);
    assert.deepEqual(f.sqlUsed,[]);
    f.env.PHASE4_STAGING_PREFLIGHT_ENABLED='true';
    assert.equal((await onRequestPost({
      request:f.request(),env:f.env,
    })).status,403);
    assert.deepEqual(f.sqlUsed,[]);
    const wrong=await adminToken('not_admin_but_signed');
    assert.equal((await onRequestPost({
      request:f.request(wrong),env:f.env,
    })).status,403);
    assert.deepEqual(f.sqlUsed,[]);
    const valid=await adminToken();
    const malformed=await onRequestPost({
      request:f.request(valid,{action:'inspect',sql:'DROP TABLE demo_students'}),
      env:f.env,
    });
    assert.equal(malformed.status,400);
    assert.deepEqual(f.sqlUsed,[]);
  }finally{f.sqlite.close();}
});
test('verified Admin may read only aggregate schema status, no account data',async()=>{
  const f=fixture({withQuiz:true});
  try{
    const response=await onRequestPost({
      request:f.request(await adminToken()),env:f.env,
    });
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store, max-age=0');
    const report=await response.json();
    assert.equal(report.status,'SYNTHETIC_SCHEMA_PRESENT');
    assert.equal(report.deploymentAuthorized,false);
    assert.ok(googleCalls>0);
    const serialized=JSON.stringify(report);
    assert.equal(serialized.includes('firebaseUid'),false);
    assert.equal(serialized.includes('password_salt'),false);
    assert.equal(serialized.includes('privateKey'),false);
    for(const sql of f.sqlUsed) assert.match(sql,/^(SELECT|PRAGMA)\s/i);
  }finally{f.sqlite.close();}
});
test.after(()=>{globalThis.fetch=originalFetch;});
