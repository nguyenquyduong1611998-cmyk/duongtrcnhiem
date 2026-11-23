// Phase 4J — entirely mocked fetch. NEVER makes a real HTTP request.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {probePublicStaging,STAGING_HOST}
  from '../scripts/phase4-public-staging-probe.mjs';

const urls=[
  '/api/auth/status',
  '/api/demo-quiz/student',
  '/api/demo-quiz/admin',
  '/api/demo-quiz/preflight',
];
const json=(value,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{'content-type':'application/json'},
});
function mockSequence(responses){
  const seen=[];
  const transport=async (url,opts)=>{
    const i=seen.length;
    seen.push({url,opts});
    assert.equal(url,'https://'+STAGING_HOST+urls[i]);
    return typeof responses[i]==='function'
      ?responses[i](url,opts):responses[i];
  };
  return {seen,transport};
}

test('safe OFF-or-undeployed result makes NO claim of deployment/DB readiness',async()=>{
  const {seen,transport}=mockSequence([
    json({stage:'staging-only',ready:true,mode:'demo-students-only',
      password:'never-copy-this'}),json({error:'NOT_FOUND'},404),
    json({error:'NOT_FOUND'},404),json({error:'NOT_FOUND'},404),
  ]);
  const r=await probePublicStaging(transport);
  assert.equal(r.status,'NEW_APIS_OFF_OR_NOT_DEPLOYED');
  assert.equal(r.results[0].readinessReported,true);
  assert.equal(r.deploymentVerified,false);
  assert.equal(r.databaseVerified,false);
  assert.equal(r.backupVerified,false);
  assert.equal(r.approvedForActivation,false);
  assert.equal(JSON.stringify(r).includes('never-copy-this'),false);
  assert.equal(seen.length,4);
  for(const [i,{url,opts}] of seen.entries()){
    assert.equal(new URL(url).hostname,STAGING_HOST);
    assert.equal(new URL(url).protocol,'https:');
    assert.equal(opts.redirect,'manual');
    assert.equal(opts.credentials,'omit');
    assert.equal(opts.cache,'no-store');
    assert.equal(opts.headers.authorization,undefined);
    assert.equal(opts.headers.cookie,undefined);
    assert.equal(opts.method,i===0?'GET':'POST');
    if(i===0)assert.equal(opts.body,undefined);
    else assert.deepEqual(JSON.parse(opts.body),{action:'result'});
  }
});

test('Cloudflare Access redirect and 401/403 yield INCONCLUSIVE, not OFF',async()=>{
  const {transport}=mockSequence([
    new Response('',{status:302,headers:{location:
      'https://login.example.test/secret-session'}}),
    new Response('',{status:403}),new Response('',{status:401}),
    new Response('',{status:403}),
  ]);
  const r=await probePublicStaging(transport);
  assert.equal(r.status,'ACCESS_GATE_INCONCLUSIVE');
  assert.equal(r.results[0].httpStatus,302);
  assert.equal(r.approvedForActivation,false);
  assert.equal(JSON.stringify(r).includes('secret-session'),false);
});

test('enabled unauthenticated route and validation response must be reviewed',async()=>{
  for(const httpStatus of [200,201,204,400]){
    const {transport}=mockSequence([
      json({stage:'staging-only',ready:false,mode:'demo-students-only'}),
      new Response('',{status:httpStatus}),
      json({error:'NOT_FOUND'},404),
      json({error:'NOT_FOUND'},404),
    ]);
    const r=await probePublicStaging(transport);
    assert.equal(r.status,'MANUAL_SECURITY_REVIEW');
    assert.equal(r.approvedForActivation,false);
    assert.equal(r.databaseVerified,false);
  }
});

test('HTTP 500/429 and network loss never imply readiness',async()=>{
  const {transport}=mockSequence([
    json({stage:'staging-only',ready:false,mode:'demo-students-only'}),
    ()=>{throw new Error('private token in exception');},
    new Response('',{status:503}),
    new Response('',{status:429}),
  ]);
  const r=await probePublicStaging(transport);
  assert.equal(r.status,'UNVERIFIED');
  assert.equal(r.results[1].httpStatus,null);
  assert.equal(r.results[1].result,'NO_NETWORK_RESPONSE');
  assert.equal(r.results[2].result,'SERVER_UNAVAILABLE');
  assert.equal(r.results[3].result,'RATE_LIMITED');
  assert.equal(JSON.stringify(r).includes('private token'),false);
});

test('unexpected auth/status content is ignored, not leaked or trusted',async()=>{
  const {transport}=mockSequence([
    json({ready:true,apiKey:'DO_NOT_PRINT',stage:'fake-stage'}),
    json({error:'NOT_FOUND'},404),
    json({error:'NOT_FOUND'},404),
    json({error:'NOT_FOUND'},404),
  ]);
  const r=await probePublicStaging(transport);
  assert.equal(r.results[0].readinessReported,undefined);
  assert.equal(JSON.stringify(r).includes('DO_NOT_PRINT'),false);
});

test('CLI without --allow-network refuses before attempting any HTTP',()=>{
  for(const args of [[],['--wrong'],['--allow-network','--other']]){
    const x=spawnSync(process.execPath,
      ['scripts/phase4-public-staging-probe.mjs',...args],
      {encoding:'utf8',timeout:8000});
    assert.equal(x.status,2);
    assert.match(x.stdout,/Not executed/);
    assert.doesNotMatch(x.stdout,/password|Authorization: Bearer/i);
  }
});

test('source cannot be parameterized to reach production or take credentials',()=>{
  const src=readFileSync('scripts/phase4-public-staging-probe.mjs','utf8');
  assert.match(src,/STAGING_HOST='duongtrcnhiem-test\.pages\.dev'/);
  assert.match(src,/--allow-network/);
  assert.match(src,/credentials:'omit'/);
  assert.match(src,/redirect:'manual'/);
  assert.doesNotMatch(src,/process\.env|readFileSync|wrangler|firebase-admin/);
  assert.doesNotMatch(src,/\/api\/auth\/student\/login|\/api\/auth\/admin\/demo/);
});
