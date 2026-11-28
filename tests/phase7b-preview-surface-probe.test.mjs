// Phase 7B Preview-only HEAD observations are deliberately inconclusive.
// All tests use fake transport and never connect to Cloudflare.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {PHASE4_PILOT_PREVIEW_HOST}
  from '../functions/_shared/phase4-host-guard.mjs';
import {inspectPreviewSurfaceHead}
  from '../scripts/phase7b-preview-surface-probe.mjs';

const host='https://'+PHASE4_PILOT_PREVIEW_HOST;
test('only hardcoded HTTPS Preview HEAD calls without cookies, JWT, SQL or body',async()=>{
  const calls=[];
  const response=await inspectPreviewSurfaceHead(async(url,opts)=>{
    calls.push({url,opts});
    return {status:opts.method==='HEAD'?405:500};
  });
  assert.equal(calls.length,7);
  assert.deepEqual(calls.map(x=>new URL(x.url).pathname),[
    '/','/phase6f-preview.webmanifest','/phase6f-preview-sw.js',
    '/api/phase7/preflight','/api/phase6/exam',
    '/api/phase6/results/student','/api/phase6/results/admin',
  ]);
  for(const {url,opts} of calls){
    assert.ok(url.startsWith(host+'/'));
    assert.equal(opts.method,'HEAD');
    assert.equal(opts.redirect,'manual');
    assert.equal(opts.credentials,'omit');
    assert.equal(opts.cache,'no-store');
    assert.deepEqual(opts.headers,{'cache-control':'no-store'});
    assert.equal(opts.body,undefined);
    assert.equal(opts.headers.authorization,undefined);
    assert.equal(opts.headers.cookie,undefined);
  }
  assert.equal(response.probes.every(x=>
    x.result==='METHOD_DENIED_OR_ROUTE_UNKNOWN'),true);
  assert.equal(response.safeToEnableFeatures,false);
  assert.equal(response.previewD1BindingVerified,false);
  assert.equal(response.previewAccessPolicyVerified,false);
  assert.equal(response.deployedCommitVerified,false);
  assert.equal(response.backupVerified,false);
  assert.equal(response.signedAuthVerified,false);
  assert.equal(JSON.stringify(response).includes('TOKEN'),false);
});
test('accessible static pages are observations, never an Access approval',async()=>{
  const report=await inspectPreviewSurfaceHead(async url=>({
    status:url.endsWith('/')?200:403,
  }));
  assert.equal(report.probes[0].result,'HTTP_SURFACE_RESPONDED');
  assert.equal(report.probes[1].result,'ACCESS_OR_AUTH_GATE_INCONCLUSIVE');
  assert.equal(report.safeToEnableFeatures,false);
  assert.equal(report.previewAccessPolicyVerified,false);
});
test('unexpected network errors and endpoints missing stay NO-GO',async()=>{
  const report=await inspectPreviewSurfaceHead(async(url)=>{
    if(url.endsWith('/'))throw new Error('SENSITIVE_PRIVATE_NETWORK_MESSAGE');
    return {status:404};
  });
  assert.equal(report.probes[0].result,'NO_NETWORK_RESPONSE');
  assert.equal(report.probes[1].result,'OFF_OR_NOT_DEPLOYED_INCONCLUSIVE');
  assert.equal(report.safeToEnableFeatures,false);
  assert.equal(JSON.stringify(report).includes('SENSITIVE_PRIVATE_NETWORK_MESSAGE'),false);
});
test('invoking CLI without --allow-network performs no probe',()=>{
  const out=spawnSync(process.execPath,
    ['scripts/phase7b-preview-surface-probe.mjs'],
    {encoding:'utf8',timeout:20000});
  assert.equal(out.status,2);
  assert.match(out.stdout,/No network performed/);
  assert.equal(out.stderr,'');
  const script=readFileSync('scripts/phase7b-preview-surface-probe.mjs','utf8');
  assert.match(script,/args\.length!==1\|\|args\[0\]!=='--allow-network'/);
  assert.doesNotMatch(script,/method:\s*'POST'|authorization:|cookie:/i);
});
