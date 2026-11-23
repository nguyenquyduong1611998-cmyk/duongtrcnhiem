import test from 'node:test';
import assert from 'node:assert/strict';
import {bindStagingDatabaseForRequest}
  from '../functions/_shared/staging-db-binding.mjs';
import {PHASE4_PINNED_STAGING_HOST,PHASE4_PILOT_PREVIEW_HOST}
  from '../functions/_shared/phase4-host-guard.mjs';
import {onRequestGet as status}
  from '../functions/api/auth/status.js';
import {onRequestPost as studentLogin}
  from '../functions/api/auth/student/login.js';
import {onRequestPost as adminDemo}
  from '../functions/api/auth/admin/demo.js';

const preview='https://'+PHASE4_PILOT_PREVIEW_HOST;
const canonical='https://'+PHASE4_PINNED_STAGING_HOST;
const prod={prepare(){throw new Error('PRODUCTION_DB_ACCESSED_ON_PREVIEW');}};
const called={canonical:0,preview:0};
const previewDb={
  prepare(sql){
    called.preview++;
    assert.match(sql,/sqlite_master/);
    return {all:async()=>({results:[
      {name:'demo_students'},{name:'login_attempts'},
    ]})};
  },
};
const request=(origin,path='/api/auth/status')=>new Request(origin+path,{
  headers:{'x-forwarded-host':PHASE4_PINNED_STAGING_HOST,
    host:PHASE4_PINNED_STAGING_HOST},
});
const env={AUTH_DB:prod,AUTH_DB_PREVIEW:previewDb,
  STAGING_AUTH_ENABLED:'true',FIREBASE_PROJECT_ID:'duongtrcnhiem-staging',
  FIREBASE_PRIVATE_KEY:'SYNTHETIC_NO_REAL_KEY',
  FIREBASE_SERVICE_ACCOUNT_EMAIL:'fake@duongtrcnhiem-staging.iam.gserviceaccount.com',
};

test('exact PR Preview hostname selects only AUTH_DB_PREVIEW and never AUTH_DB',()=>{
  const r=bindStagingDatabaseForRequest(env,request(preview));
  assert.equal(r.AUTH_DB,previewDb);
  assert.equal(env.AUTH_DB,prod);
  assert.equal(env.AUTH_DB_PREVIEW,previewDb);
});
test('canonical test Pages hostname keeps existing AUTH_DB binding',()=>{
  const r=bindStagingDatabaseForRequest(env,request(canonical));
  assert.equal(r.AUTH_DB,prod);
});
test('Preview missing binding fails closed even if canonical D1 is inherited',async()=>{
  const noPreview={...env,AUTH_DB_PREVIEW:undefined};
  const resolved=bindStagingDatabaseForRequest(noPreview,request(preview));
  assert.equal(resolved.AUTH_DB,undefined);
  const reply=await status({request:request(preview),env:noPreview});
  assert.equal(reply.status,200);
  assert.deepEqual(await reply.json(),{
    stage:'staging-only',ready:false,d1Connected:false,tablesReady:false,
    login:'username-password',mode:'demo-students-only',
  });
});
test('unapproved hashed or other Pages previews never inherit either D1 binding',()=>{
  for(const host of [
    '6a665b92.duongtrcnhiem-test.pages.dev',
    '70871492.duongtrcnhiem-test.pages.dev',
    'another-branch.duongtrcnhiem-test.pages.dev',
  ]){
    const db=bindStagingDatabaseForRequest(env,
      request('https://'+host));
    assert.equal(db.AUTH_DB,undefined,host);
  }
});
test('status reads only Preview D1 if it exists; never touches canonical database',async()=>{
  called.preview=0;
  const r=await status({request:request(preview),env});
  assert.equal(r.status,200);
  const body=await r.json();
  assert.equal(body.d1Connected,true);
  assert.equal(body.tablesReady,true);
  assert.equal(body.ready,true);
  assert.equal(called.preview,1);
  assert.equal(Object.keys(body).includes('databaseName'),false);
});
test('spoofed forwarded host cannot select another D1',()=>{
  const req=new Request(preview+'/api/auth/status',{
    headers:{'host':PHASE4_PINNED_STAGING_HOST,
      'x-forwarded-host':PHASE4_PINNED_STAGING_HOST},
  });
  assert.equal(bindStagingDatabaseForRequest(env,req).AUTH_DB,previewDb);
});
test('credential-bearing routes on Preview never fall back to canonical DB',async()=>{
  const noPreview={...env,AUTH_DB_PREVIEW:undefined};
  const makePost=(path)=>new Request(preview+path,{method:'POST',headers:{
    'content-type':'application/json',origin:preview,
  },body:JSON.stringify({action:'list',username:'test_hv_000000000001',
      password:'SYNTHETIC_NOT_REAL'})});
  const login=await studentLogin({
    request:makePost('/api/auth/student/login'),env:noPreview,
  });
  const admin=await adminDemo({
    request:makePost('/api/auth/admin/demo'),env:noPreview,
  });
  assert.equal(login.status,503);
  assert.equal(admin.status,503);
});
