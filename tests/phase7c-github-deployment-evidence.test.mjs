// Phase 7C: public GitHub deployment status simulations (zero real network).
// Trust only checks attached to exact staging HEAD; never infer D1 readiness.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {
  evaluateGitHubDeploymentEvidence,inspectGithubStagingDeployment,
  githubEvidenceConstants,
} from '../scripts/phase7c-github-deployment-evidence.mjs';

const SHA='a'.repeat(40);
const MOVED='b'.repeat(40);
const BRANCH='feature/staging-demo-quiz-pilot';
const repo='https://api.github.com/repos/'+githubEvidenceConstants.repository;
const meta=(sha=SHA,branch=BRANCH)=>({name:branch,commit:{sha}});
const one=(name,sha=SHA,status='completed',conclusion='success')=>
  ({name,head_sha:sha,status,conclusion,
    details_url:'https://dash.cloudflare.com/private-account-id'});
const checks=(...items)=>({check_runs:items});
function failClosed(x){
  for(const key of [
    'deploymentAuthorized','livePreviewAliasVerified','cloudflareAccessVerified',
    'previewDatabaseBindingVerified','d1BackupVerified','d1RestoreVerified',
    'multiDeviceVerified','realLoadVerified',
  ])assert.equal(x[key],false,key);
  assert.equal(JSON.stringify(x).includes('private-account-id'),false);
}
test('same staging commit with Cloudflare Pages and GitHub Actions success is check-only',()=>{
  const report=evaluateGitHubDeploymentEvidence(meta(),checks(
    one('Cloudflare Pages'),one('demo-quiz-ci')),meta());
  assert.equal(report.status,'GITHUB_CHECKS_REPORTED_SUCCESS');
  assert.equal(report.commitSha,SHA);
  assert.equal(report.cloudflarePagesCheck,'SUCCESS');
  assert.equal(report.githubActionsCheck,'SUCCESS');
  assert.equal(report.branch,BRANCH);
  failClosed(report);
});
test('stale PR check, missing Cloudflare check and failed GitHub Actions cannot pass',()=>{
  for(const status of [
    checks(one('Cloudflare Pages',MOVED),one('demo-quiz-ci')),
    checks(one('demo-quiz-ci')),
    checks(one('Cloudflare Pages'),one('demo-quiz-ci',SHA,'completed','failure')),
    checks(one('Cloudflare Pages',SHA,'in_progress',null),one('demo-quiz-ci')),
    checks(one('Cloudflare Pages'),one('Cloudflare Pages'),one('demo-quiz-ci')),
    checks(one('Cloudflare Pages'),one('demo-quiz-ci'),one('demo-quiz-ci')),
  ]){
    const result=evaluateGitHubDeploymentEvidence(meta(),status,meta());
    assert.equal(result.status,'GITHUB_CHECKS_NOT_CONFIRMED');
    failClosed(result);
  }
});
test('branch changed while reading, malformed or mismatched refs are blocked',()=>{
  for(const [first,last] of [
    [meta(),meta(MOVED)],[meta(SHA,'main'),meta()],
    [meta(),meta(SHA,'other')],[meta('not-sha'),meta('not-sha')],
    [null,meta()],[meta(),null],
  ]){
    const x=evaluateGitHubDeploymentEvidence(first,
      checks(one('Cloudflare Pages'),one('demo-quiz-ci')),last);
    assert.equal(x.status,'BLOCKED');
    failClosed(x);
  }
  assert.equal(evaluateGitHubDeploymentEvidence(meta(),{check_runs:'fake'},meta())
    .status,'BLOCKED');
});
test('3 requests only to exact GitHub API and no authorization, cookies or POST',async()=>{
  const calls=[];
  const responses=[
    meta(),
    checks(one('Cloudflare Pages'),one('demo-quiz-ci')),
    meta(),
  ];
  const result=await inspectGithubStagingDeployment(async(url,options)=>{
    calls.push({url,options});
    const data=responses[calls.length-1];
    return {
      ok:true,
      headers:{get:()=>null},
      text:async()=>JSON.stringify(data),
    };
  });
  assert.equal(result.status,'GITHUB_CHECKS_REPORTED_SUCCESS');
  assert.deepEqual(calls.map(c=>c.url),[
    repo+'/branches/'+BRANCH,
    repo+'/commits/'+SHA+'/check-runs?per_page=100',
    repo+'/branches/'+BRANCH,
  ]);
  for(const {options,url} of calls){
    assert.equal(url.startsWith(repo+'/'),true);
    assert.equal(options.method,'GET');
    assert.equal(options.credentials,'omit');
    assert.equal(options.redirect,'error');
    assert.equal(options.cache,'no-store');
    assert.equal(options.body,undefined);
    assert.equal(options.headers.authorization,undefined);
    assert.equal(options.headers.cookie,undefined);
  }
  failClosed(result);
});
test('unavailable remote check does not produce green status',async()=>{
  await assert.rejects(inspectGithubStagingDeployment(async()=>({
    ok:false,headers:{get:()=>null},text:async()=>'{PRIVATE_SECRET}',
  })));
  await assert.rejects(inspectGithubStagingDeployment(async()=>({
    ok:true,
    headers:{get:()=>String(99999999)},
    text:async()=>'{PRIVATE_SECRET}',
  })));
  const calls=[];
  const result=await inspectGithubStagingDeployment(async(url)=>{
    calls.push(url);
    const data=calls.length===1?meta():
      calls.length===2?checks(one('Cloudflare Pages'),one('demo-quiz-ci')):
        meta(MOVED);
    return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify(data)};
  });
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.reason,'BRANCH_IDENTITY_OR_HEAD_MISMATCH');
  failClosed(result);
});
test('CLI performs no external traffic unless operator supplies explicit opt-in',()=>{
  const process=spawnSync(globalThis.process.execPath,
    ['scripts/phase7c-github-deployment-evidence.mjs'],
    {encoding:'utf8',timeout:10000});
  assert.equal(process.status,2);
  assert.match(process.stdout,/No network performed/);
  assert.equal(process.stderr,'');
  const source=readFileSync('scripts/phase7c-github-deployment-evidence.mjs','utf8');
  assert.match(source,/--allow-github-metadata/);
  assert.doesNotMatch(source,/wrangler|D1_EXECUTE|Authorization:|--remote/);
});
