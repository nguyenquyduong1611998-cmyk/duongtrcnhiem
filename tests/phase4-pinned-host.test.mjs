import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PHASE4_PINNED_STAGING_HOST,isApprovedPhase4StagingHost,
} from '../functions/_shared/phase4-host-guard.mjs';
import {onRequestPost as studentEndpoint}
  from '../functions/api/demo-quiz/student.js';
import {onRequestPost as adminEndpoint}
  from '../functions/api/demo-quiz/admin.js';
import {onRequestPost as preflightEndpoint}
  from '../functions/api/demo-quiz/preflight.js';

const HOST='duongtrcnhiem-test.pages.dev';
const credentials={
  STAGING_AUTH_ENABLED:'true',
  FIREBASE_PROJECT_ID:'duongtrcnhiem-staging',
  FIREBASE_SERVICE_ACCOUNT_EMAIL:'test@duongtrcnhiem-staging.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY:'SYNTHETIC_TEST_ONLY',
  PHASE4_STAGING_HOSTNAME:HOST,
  PHASE4_SYNTHETIC_QUIZ_ENABLED:'true',
  PHASE4_STAGING_PREFLIGHT_ENABLED:'true',
};
function request(url){
  const origin=new URL(url).origin;
  return new Request(url,{method:'POST',headers:{
    origin,'content-type':'application/json',
    // Never provide a real student token for hostname-denial tests.
    'x-forwarded-host':HOST,host:HOST,
  },body:JSON.stringify({action:'inspect'})});
}
const urls=[
  'https://duongtrcnhiem-test.pages.dev/api/demo-quiz/student',
  'https://duongtrcnhiem-test.pages.dev/api/demo-quiz/admin',
  'https://duongtrcnhiem-test.pages.dev/api/demo-quiz/preflight',
];
const deniedHosts=[
  'https://duongtrcnhiem.pages.dev',
  'https://duongtrcnhiem-test.pages.dev.evil.example',
  'https://demo.duongtrcnhiem-test.pages.dev',
  'https://duongtrcnhiem-test.pages.dev:8443',
  'http://duongtrcnhiem-test.pages.dev',
  'https://duongtrcnhiem-test.pages.dev.example.com',
];

test('project has exactly one reviewed Pages hostname for Phase 4 pilot',()=>{
  assert.equal(PHASE4_PINNED_STAGING_HOST,HOST);
  assert.equal(isApprovedPhase4StagingHost(request(urls[0]),credentials),true);
  assert.equal(
    isApprovedPhase4StagingHost(request(urls[0]),{
      ...credentials,PHASE4_STAGING_HOSTNAME:'duongtrcnhiem.pages.dev',
    }),false);
  assert.equal(
    isApprovedPhase4StagingHost(request(urls[0]),{
      ...credentials,PHASE4_STAGING_HOSTNAME:undefined,
    }),false);
});

test('three routes fail closed for different domains even if both feature flags are ON',async()=>{
  for(const address of deniedHosts){
    assert.equal(isApprovedPhase4StagingHost(
      request(address+'/api/demo-quiz/student'),credentials,
    ),false,address);
    for(const [i,handler] of [
      studentEndpoint,adminEndpoint,preflightEndpoint,
    ].entries()){
      const url=address+new URL(urls[i]).pathname;
      const reply=await handler({request:request(url),env:{
        ...credentials,AUTH_DB:{prepare:()=>{throw new Error('DB_MUST_NOT_BE_QUERIED');}},
      }});
      assert.equal(reply.status,404,url);
      assert.deepEqual(await reply.json(),{error:'NOT_FOUND'});
      assert.equal(reply.headers.get('cache-control'),'no-store, max-age=0');
    }
  }
});

test('three routes fail closed if pin env is missing or accidentally copied to live host',async()=>{
  for(const badValue of [undefined,'duongtrcnhiem.pages.dev',
      'DUONGTRCNHIEM-TEST.PAGES.DEV',
      'duongtrcnhiem-test.pages.dev,duongtrcnhiem.pages.dev']){
    for(const [i,handler] of [
      studentEndpoint,adminEndpoint,preflightEndpoint,
    ].entries()){
      const reply=await handler({request:request(urls[i]),env:{
        ...credentials,PHASE4_STAGING_HOSTNAME:badValue,AUTH_DB:{},
      }});
      assert.equal(reply.status,404,String(badValue));
    }
  }
});

test('approved URL still requires valid Firebase student/Admin auth',async()=>{
  const env={...credentials,AUTH_DB:{
    prepare(){throw new Error('DB_MUST_NOT_BE_QUERIED_WITHOUT_AUTH');},
  }};
  assert.equal((await studentEndpoint({
    request:request(urls[0]),env,
  })).status,401);
  assert.equal((await adminEndpoint({
    request:request(urls[1]),env,
  })).status,403);
  assert.equal((await preflightEndpoint({
    request:request(urls[2]),env,
  })).status,403);
});

test('disabled feature flags always produce 404 even at the correct host',async()=>{
  const env={...credentials,
    PHASE4_SYNTHETIC_QUIZ_ENABLED:'false',
    PHASE4_STAGING_PREFLIGHT_ENABLED:'false',
  };
  for(const [i,handler] of [
    studentEndpoint,adminEndpoint,preflightEndpoint,
  ].entries()){
    assert.equal((await handler({request:request(urls[i]),env})).status,404);
  }
});

test('the host pin never trusts forwarded host headers or arbitrary wildcard suffixes',()=>{
  const x=request('https://duongtrcnhiem.pages.dev/api/demo-quiz/student');
  assert.equal(x.headers.get('x-forwarded-host'),HOST);
  assert.equal(x.headers.get('host'),HOST);
  assert.equal(isApprovedPhase4StagingHost(x,credentials),false);
});
