// Phase 7A: offline read-only D1 schema inventory, zero Cloudflare access.
// Includes deliberate partial/mismatched deployments and failing migrations.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {PROJECT_ID,ADMIN_UID} from '../functions/_shared/auth.mjs';
import {PHASE4_PILOT_PREVIEW_HOST,PHASE4_PINNED_STAGING_HOST}
  from '../functions/_shared/phase4-host-guard.mjs';
import {inspectPhase7PreviewSchema}
  from '../functions/_shared/phase7-preview-d1-schema-preflight.mjs';
import {onRequestPost as endpoint} from '../functions/api/phase7/preflight.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const files={
  base:[
    'serverless/d1-staging-schema.sql',
    'serverless/d1-phase4-synthetic-graded-quiz.sql',
    'serverless/d1-phase5-preview-additive-schema.sql',
  ],
  phase6b:'serverless/d1-phase6b-synthetic-admin-drafts-draft.sql',
  phase6c:'serverless/d1-phase6c-publication-metadata-draft.sql',
  phase6a:'serverless/d1-phase6-timed-sessions-draft.sql',
  phase6d:'serverless/d1-phase6d-timed-submissions-draft.sql',
};
const PHASES=['phase6b','phase6c','phase6a','phase6d'];
const NOW=Math.floor(Date.now()/1000);
const HOST='https://'+PHASE4_PILOT_PREVIEW_HOST;
const ENDPOINT='/api/phase7/preflight';
function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  const executed=[];
  const adapter={
    prepare(sql){
      executed.push(sql);
      if(!/^(SELECT|PRAGMA)\s/i.test(sql))
        throw new Error('TEST_UNEXPECTED_WRITE');
      return {
        bind(...args){
          return {async all(){return {success:true,results:sqlite.prepare(sql).all(...args)};}};
        },
        async all(){return {success:true,results:sqlite.prepare(sql).all()};},
      };
    },
  };
  const apply=stage=>{
    for(const file of stage==='base'?files.base:[files[stage]])
      sqlite.exec(readFileSync(file,'utf8'));
  };
  const env={
    AUTH_DB_PREVIEW:adapter,
    AUTH_DB:{prepare:()=>{throw new Error('WRONG_CANONICAL_D1');}},
    FIREBASE_PROJECT_ID:PROJECT_ID,STAGING_AUTH_ENABLED:'true',
    FIREBASE_SERVICE_ACCOUNT_EMAIL:'synthetic@'+PROJECT_ID+'.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY:'SYNTHETIC_TEST_ONLY',
    PHASE7_PREVIEW_SCHEMA_PREFLIGHT_ENABLED:'true',
    PHASE4_STAGING_HOSTNAME:PHASE4_PILOT_PREVIEW_HOST,
    PHASE4_PREVIEW_HOST_OPT_IN:'true',
  };
  return {sqlite,apply,adapter,env,executed};
}
const project=r=>JSON.stringify(r);
function assertNoRelease(response){
  assert.equal(response.deployAuthorized,false);
  assert.equal(response.targetDatabaseIdentityVerified,false);
  assert.equal(response.freshBackupVerified,false);
  assert.equal(response.liveRestoreVerified,false);
  assert.equal(response.migrationsExecuted,false);
  assert.equal(response.schemaOnlyChecks,true);
  const body=project(response);
  for(const secret of ['correct_index','firebase_uid','password_hash',
    'answers_json','CREATE TABLE','FAKE_LOCAL','test_hv_','private_key'])
    assert.equal(body.includes(secret),false,secret);
}
test('baseline with no Phase6 is safe: migration review only, not automatic apply',async()=>{
  const f=fixture();
  try{
    f.apply('base');
    const data=await inspectPhase7PreviewSchema(f.adapter);
    assert.equal(data.status,'MIGRATION_REVIEW_REQUIRED');
    assert.equal(data.stages.baseline,'SCHEMA_CANDIDATE');
    for(const stage of PHASES)assert.equal(data.stages[stage],'ABSENT');
    assert.deepEqual(data.migrationOrder,PHASES);
    assertNoRelease(data);
    assert.equal(f.executed.every(x=>/^(SELECT|PRAGMA)\s/i.test(x)),true);
  }finally{f.sqlite.close();}
});
test('ordered, complete schemas are CANDIDATE ONLY; immutable guard objects checked',async()=>{
  const f=fixture();
  try{
    f.apply('base');
    for(const stage of PHASES)f.apply(stage);
    const body=await inspectPhase7PreviewSchema(f.adapter);
    assert.equal(body.status,'SCHEMA_CANDIDATE_REVIEW_ONLY',project(body));
    for(const name of ['baseline',...PHASES])
      assert.equal(body.stages[name],'SCHEMA_CANDIDATE');
    assertNoRelease(body);
    assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.equal(f.sqlite.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  }finally{f.sqlite.close();}
});
test('safe prefix of individually complete migrations is still pending review',async()=>{
  for(let n=1;n<PHASES.length;n++){
    const f=fixture();
    try{
      f.apply('base');
      for(const phase of PHASES.slice(0,n))f.apply(phase);
      const report=await inspectPhase7PreviewSchema(f.adapter);
      assert.equal(report.status,'MIGRATION_REVIEW_REQUIRED',project(report));
      assertNoRelease(report);
    }finally{f.sqlite.close();}
  }
});
test('missing baseline, partial migration and wrong-order schemas fail closed',async()=>{
  {
    const f=fixture();
    try{
      const report=await inspectPhase7PreviewSchema(f.adapter);
      assert.equal(report.status,'BLOCKED_BASELINE_MISSING_OR_MISMATCHED');
      assertNoRelease(report);
    }finally{f.sqlite.close();}
  }
  {
    const f=fixture();
    try{
      f.apply('base');
      f.sqlite.exec('CREATE TABLE phase6_admin_drafts (draft_id TEXT PRIMARY KEY)');
      const report=await inspectPhase7PreviewSchema(f.adapter);
      assert.equal(report.status,'BLOCKED_PARTIAL_OR_UNEXPECTED_ORDER');
      assert.equal(report.stages.phase6b,'BLOCKED_INCOMPLETE_OR_MISMATCHED');
    }finally{f.sqlite.close();}
  }
  {
    const f=fixture();
    try{
      f.apply('base');f.apply('phase6a');
      const report=await inspectPhase7PreviewSchema(f.adapter);
      assert.equal(report.status,'BLOCKED_PARTIAL_OR_UNEXPECTED_ORDER');
      assert.equal(report.stages.phase6a,'SCHEMA_CANDIDATE');
      assert.equal(report.stages.phase6b,'ABSENT');
    }finally{f.sqlite.close();}
  }
  {
    const f=fixture();
    try{
      f.apply('base');
      f.sqlite.exec('CREATE VIEW phase6_admin_drafts AS SELECT 1 AS id');
      const report=await inspectPhase7PreviewSchema(f.adapter);
      assert.equal(report.status,'BLOCKED_PARTIAL_OR_UNEXPECTED_ORDER');
      assert.equal(report.stages.phase6b,'BLOCKED_INCOMPLETE_OR_MISMATCHED');
    }finally{f.sqlite.close();}
  }
});

const kp=await crypto.subtle.generateKey({
  name:'RSASSA-PKCS1-v1_5',hash:'SHA-256',
  modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),
},true,['sign','verify']);
const jwk={...(await crypto.subtle.exportKey('jwk',kp.publicKey)),
  kid:'phase7a-synthetic-rsa',use:'sig'};
const encode=obj=>Buffer.from(JSON.stringify(obj)).toString('base64url');
async function token(uid,provider='google.com',changes={}){
  const head=encode({alg:'RS256',kid:jwk.kid,typ:'JWT'});
  const body=encode({
    iss:'https://securetoken.google.com/'+PROJECT_ID,
    aud:PROJECT_ID,sub:uid,user_id:uid,
    iat:NOW,exp:NOW+3600,auth_time:NOW-60,
    firebase:{sign_in_provider:provider},...changes,
  });
  const message=head+'.'+body;
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',
    kp.privateKey,new TextEncoder().encode(message));
  return message+'.'+Buffer.from(sig).toString('base64url');
}
const ADMIN=await token(ADMIN_UID);
const STUDENT=await token('student_'+'a'.repeat(32),'custom');
const NONADMIN=await token('student_'+'b'.repeat(32),'google.com');
const WRONG_PROJECT=await token(ADMIN_UID,'google.com',{aud:'different'});
const originalFetch=globalThis.fetch;
globalThis.fetch=async url=>{
  assert.equal(url,
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  return new Response(JSON.stringify({keys:[jwk]}),{status:200});
};
function call(f,body={action:'inspect'},jwt=ADMIN,overrides={}){
  const url=overrides.url??HOST+ENDPOINT;
  const method=overrides.method??'POST';
  const request=new Request(url,{
    method,headers:{
      'content-type':overrides.type??'application/json',
      ...(jwt?{authorization:'Bearer '+jwt}:{}),
      ...(overrides.origin?{origin:overrides.origin}:{}),
    },
    ...(method==='POST'?{body:JSON.stringify(body)}:{}),
  });
  return endpoint({request,env:f.env});
}
test('signed Google Admin may inspect ONLY pinned Preview; response contains no D1 rows',async()=>{
  const f=fixture();
  try{
    f.apply('base');
    const response=await call(f);
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store, max-age=0');
    const body=await response.json();
    assert.equal(body.mode,'phase7a-preview-d1-schema-preflight');
    assert.equal(body.status,'MIGRATION_REVIEW_REQUIRED');
    assertNoRelease(body);
    assert.equal(f.executed.every(x=>/^(SELECT|PRAGMA)\s/i.test(x)),true);
  }finally{f.sqlite.close();}
});
test('anonymous, student, wrong Admin or Firebase project denied before DB access',async()=>{
  const f=fixture();
  try{
    f.apply('base');f.executed.length=0;
    for(const jwt of ['',STUDENT,NONADMIN,WRONG_PROJECT,'not.a.jwt']){
      const response=await call(f,{action:'inspect'},jwt);
      assert.equal(response.status,403);
      assert.deepEqual(await response.json(),{error:'ADMIN_AUTH_REQUIRED'});
    }
    assert.equal(f.executed.length,0);
  }finally{f.sqlite.close();}
});
test('default OFF, wrong host, HTTP, origin, JSON and query guard fail closed',async()=>{
  const f=fixture();
  try{
    f.apply('base');f.executed.length=0;
    for(const key of [
      'PHASE7_PREVIEW_SCHEMA_PREFLIGHT_ENABLED',
      'PHASE4_PREVIEW_HOST_OPT_IN',
    ]){
      const before=f.env[key];delete f.env[key];
      assert.equal((await call(f)).status,404);
      f.env[key]=before;
    }
    for(const url of [
      'https://'+PHASE4_PINNED_STAGING_HOST+ENDPOINT,
      'https://random.example'+ENDPOINT,
      'https://'+PHASE4_PILOT_PREVIEW_HOST+'.evil.example'+ENDPOINT,
      'http://'+PHASE4_PILOT_PREVIEW_HOST+ENDPOINT,
    ])assert.equal((await call(f,{action:'inspect'},ADMIN,{url})).status,404,url);
    assert.equal((await call(f,{action:'inspect'},ADMIN,{method:'GET'})).status,405);
    assert.equal((await call(f,{action:'inspect'},ADMIN,{type:'text/plain'})).status,415);
    assert.equal((await call(f,{action:'inspect'},ADMIN,{origin:'https://evil.test'})).status,403);
    assert.equal((await call(f,{action:'inspect'},ADMIN,{url:HOST+ENDPOINT+'?sql=abc'})).status,400);
    for(const input of [
      {action:'inspect',sql:'DROP TABLE demo_students'},
      {action:'inspect',name:'phase6_exam_sessions'},
      {action:'list'},{action:'inspect',uid:'student_'+'a'.repeat(32)},
    ])assert.equal((await call(f,input)).status,400);
    assert.equal(f.executed.length,0);
  }finally{f.sqlite.close();}
});
test('missing isolated Preview binding never falls back to canonical D1',async()=>{
  const f=fixture();
  try{
    f.apply('base');f.executed.length=0;
    delete f.env.AUTH_DB_PREVIEW;
    const response=await call(f);
    assert.equal(response.status,503);
    assert.deepEqual(await response.json(),{error:'SERVER_NOT_CONFIGURED'});
    assert.equal(f.executed.length,0);
  }finally{f.sqlite.close();}
});
test('malformed D1 schema read gives safe 503 and no row/SQL content leaked',async()=>{
  const f=fixture();
  try{
    f.apply('base');
    f.env.AUTH_DB_PREVIEW={
      prepare:()=>{throw new Error('PRIVATE_SQL_AND_ROW_CONTENT');},
    };
    const result=await call(f);
    assert.equal(result.status,503);
    assert.equal((await result.text()).includes('PRIVATE_SQL_AND_ROW_CONTENT'),false);
  }finally{f.sqlite.close();}
});

test.after(()=>{globalThis.fetch=originalFetch;});
