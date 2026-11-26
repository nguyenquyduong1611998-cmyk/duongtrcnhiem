// Phase 7G: safe, deterministic private-evidence review. NO browser,
// Cloudflare, Firebase, network, token, SQL, or real user data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync,writeFileSync,mkdtempSync,rmSync,symlinkSync,linkSync,
} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {
  inspectPhase7gPreviewAcceptance,inspectPhase7gPrivateEvidenceFiles,
} from '../scripts/phase7g-preview-acceptance-gate.mjs';

const old=JSON.parse(readFileSync(
  'docs/phase7c-operator-evidence-template.json','utf8'));
const fresh=JSON.parse(readFileSync(
  'docs/phase7g-private-live-acceptance-template.json','utf8'));
const keys=Object.keys(fresh.operatorReview);
const SHA='a'.repeat(40);
const copy=x=>structuredClone(x);
const fixture=()=>{
  const a=copy(old),b=copy(fresh);
  a.gitCommitSha=SHA;b.gitCommitSha=SHA;
  return [a,b];
};
function allPassed(){
  const [a,b]=fixture();
  for(const k of Object.keys(a.operatorReview))
    a.operatorReview[k]='REVIEWED_BY_OPERATOR';
  for(const k of keys)b.operatorReview[k]='PASSED_BY_OPERATOR';
  return [a,b];
}
function noGo(report){
  for(const k of [
    'expectedShaIndependentlyVerifiedByTool',
    'cloudflareDashboardAuthenticatedByTool',
    'cloudflareAccessVerifiedByTool',
    'd1PreviewBindingVerifiedByTool',
    'backupRestoredByTool',
    'realDevicePwaVerifiedByTool',
    'realNetworkLoadMeasuredByTool',
    'independentAuthorizationConfirmedByTool',
    'migrationAuthorized',
    'productionDeploymentAuthorized',
    'liveLoadAuthorized',
    'deploymentAuthorized',
  ])assert.equal(report[k],false,k);
  for(const forbidden of [
    'DO_NOT_LOG','FAKE_API_SECRET','PRIVATE_DB_UUID',
    'PRIVATE_PASSWORD','PRIVATE_ACCESS_JWT',
  ])assert.equal(JSON.stringify(report).includes(forbidden),false,forbidden);
}
test('repo 17-check template is all NOT_CHECKED, never self-claims live evidence',()=>{
  assert.equal(fresh.schemaVersion,1);
  assert.equal(fresh.environment,'cloudflare-pages-branch-preview');
  assert.equal(fresh.project,'duongtrcnhiem-test');
  assert.equal(fresh.branch,'feature/staging-demo-quiz-pilot');
  assert.equal(fresh.previewAlias,
    'feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev');
  assert.equal(fresh.gitCommitSha,null);
  assert.equal(keys.length,17);
  assert.equal(keys.every(k=>fresh.operatorReview[k]==='NOT_CHECKED'),true);
  const report=inspectPhase7gPreviewAcceptance(old,fresh);
  assert.equal(report.status,'EXPECTED_HEAD_SHA_NOT_INDEPENDENTLY_SUPPLIED');
  assert.equal(report.notCheckedCount,17);
  assert.equal(report.operatorReportedPassedCount,0);
  assert.equal(report.phase7cReportedReviewedCount,0);
  noGo(report);
});
test('matching SHA with complete self-reported checks cannot grant GO',()=>{
  const [a,b]=allPassed();
  const report=inspectPhase7gPreviewAcceptance(a,b,SHA);
  assert.equal(report.status,
    'SELF_REPORTED_COMPLETE_REQUIRES_INDEPENDENT_APPROVAL');
  assert.equal(report.operatorReportedPassedCount,17);
  assert.equal(report.phase7cReportedReviewedCount,12);
  assert.equal(report.notCheckedCount,0);
  noGo(report);
});
test('reported failure in either ledger blocks regardless of successes',()=>{
  const [a,b]=allPassed();
  b.operatorReview.previewAliasAccessUnauthenticated='FAILED';
  const report=inspectPhase7gPreviewAcceptance(a,b,SHA);
  assert.equal(report.status,'STOP_OPERATOR_REPORTED_FAILURES');
  assert.equal(report.failedCount,1);
  noGo(report);
  b.operatorReview.previewAliasAccessUnauthenticated='PASSED_BY_OPERATOR';
  a.operatorReview.previewD1BindingMatchesExpectedIdPrivately='BLOCKED';
  const other=inspectPhase7gPreviewAcceptance(a,b,SHA);
  assert.equal(other.status,'STOP_OPERATOR_REPORTED_FAILURES');
  noGo(other);
});
test('incomplete reports remain incomplete even if pinned to HEAD',()=>{
  const [a,b]=allPassed();
  b.operatorReview.realPwaInstallOfflineAndAccountSwitch='NOT_CHECKED';
  assert.equal(inspectPhase7gPreviewAcceptance(a,b,SHA).status,
    'OPERATOR_EVIDENCE_INCOMPLETE');
  b.operatorReview.realPwaInstallOfflineAndAccountSwitch='PASSED_BY_OPERATOR';
  a.operatorReview.freshPrivateD1Export='NOT_CHECKED';
  assert.equal(inspectPhase7gPreviewAcceptance(a,b,SHA).status,
    'OPERATOR_EVIDENCE_INCOMPLETE');
});
test('both ledger SHAs must match separately supplied current GitHub staging HEAD',()=>{
  const [a,b]=allPassed();
  b.gitCommitSha='b'.repeat(40);
  const mismatched=inspectPhase7gPreviewAcceptance(a,b,SHA);
  assert.equal(mismatched.status,'STOP_STALE_OR_INCONSISTENT_SHA');
  noGo(mismatched);
  b.gitCommitSha=SHA;a.gitCommitSha='b'.repeat(40);
  assert.equal(inspectPhase7gPreviewAcceptance(a,b,SHA).status,
    'STOP_STALE_OR_INCONSISTENT_SHA');
  a.gitCommitSha=SHA;
  const noSha=inspectPhase7gPreviewAcceptance(a,b);
  assert.equal(noSha.status,'EXPECTED_HEAD_SHA_NOT_INDEPENDENTLY_SUPPLIED');
  noGo(noSha);
});
test('unknown keys, host/branch changes, injected secrets or non-strict flags blocked',()=>{
  const [a,b]=allPassed();
  const malformed=[
    null,[],42,
    {...b,operatorToken:'DO_NOT_LOG'},
    {...b,previewAlias:'duongtrcnhiem-test.pages.dev'},
    {...b,branch:'main'},
    {...b,project:'another-pages-project'},
    {...b,environment:'production'},
    {...b,schemaVersion:2},
    {...b,gitCommitSha:'INVALID'},
    {...b,operatorReview:{...b.operatorReview,accessJwt:'PRIVATE_ACCESS_JWT'}},
    {...b,operatorReview:{...b.operatorReview,
      previewD1IdComparedPrivately:'PRIVATE_DB_UUID'}},
    {...b,operatorReview:{...b.operatorReview,
      firebaseStagingBuildAndRuntime:true}},
  ];
  for(const input of malformed){
    const result=inspectPhase7gPreviewAcceptance(a,input,SHA);
    assert.equal(result.status,'BLOCKED_INVALID_EVIDENCE');
    noGo(result);
  }
  const fake7c={...a,cloudflareApiToken:'FAKE_API_SECRET'};
  assert.equal(inspectPhase7gPreviewAcceptance(fake7c,b,SHA).status,
    'BLOCKED_INVALID_EVIDENCE');
  assert.equal(inspectPhase7gPreviewAcceptance(a,b,'not-sha').status,
    'BLOCKED_INVALID_EVIDENCE');
});
test('CLI output is only counts/flags; rejects symlink, hardlink and oversize files',()=>{
  const dir=mkdtempSync(join(tmpdir(),'phase7g-local-sanitized-'));
  const fileA=join(dir,'PRIVATE_PASSWORD_7C.json');
  const fileB=join(dir,'PRIVATE_ACCESS_JWT_7G.json');
  const [a,b]=allPassed();
  try{
    writeFileSync(fileA,JSON.stringify(a));
    writeFileSync(fileB,JSON.stringify(b));
    const parsed=inspectPhase7gPrivateEvidenceFiles(fileA,fileB,SHA);
    assert.equal(parsed.status,
      'SELF_REPORTED_COMPLETE_REQUIRES_INDEPENDENT_APPROVAL');
    noGo(parsed);
    const result=spawnSync(process.execPath,[
      'scripts/phase7g-preview-acceptance-gate.mjs',
      SHA,fileA,fileB,
    ],{encoding:'utf8',timeout:10000});
    assert.equal(result.status,0,result.stderr);
    assert.deepEqual(JSON.parse(result.stdout),parsed);
    for(const secret of [dir,fileA,fileB,'PRIVATE_PASSWORD','PRIVATE_ACCESS_JWT',SHA])
      assert.equal((result.stdout+result.stderr).includes(secret),false,secret);
    const symlink=join(dir,'symbolic.json');
    symlinkSync(fileB,symlink);
    assert.equal(inspectPhase7gPrivateEvidenceFiles(
      fileA,symlink,SHA).status,'BLOCKED_INVALID_EVIDENCE');
    const hardlink=join(dir,'hardlink.json');
    linkSync(fileB,hardlink);
    assert.equal(inspectPhase7gPrivateEvidenceFiles(
      fileA,hardlink,SHA).status,'BLOCKED_INVALID_EVIDENCE');
    const failed=spawnSync(process.execPath,[
      'scripts/phase7g-preview-acceptance-gate.mjs',
      SHA,fileA,symlink,
    ],{encoding:'utf8',timeout:10000});
    assert.equal(failed.status,1);
    noGo(JSON.parse(failed.stdout));
    writeFileSync(fileB,'SECRET'.repeat(4000));
    assert.equal(inspectPhase7gPrivateEvidenceFiles(
      fileA,fileB,SHA).status,'BLOCKED_INVALID_EVIDENCE');
    assert.equal(inspectPhase7gPrivateEvidenceFiles(
      join(dir,'missing.json'),fileA,SHA).status,'BLOCKED_INVALID_EVIDENCE');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('default CLI checks blank templates offline and will never claim live readiness',()=>{
  const cmd=spawnSync(process.execPath,
    ['scripts/phase7g-preview-acceptance-gate.mjs'],
    {encoding:'utf8',timeout:10000});
  assert.equal(cmd.status,0,cmd.stderr);
  const report=JSON.parse(cmd.stdout);
  assert.equal(report.status,'EXPECTED_HEAD_SHA_NOT_INDEPENDENTLY_SUPPLIED');
  noGo(report);
  const invalid=spawnSync(process.execPath,
    ['scripts/phase7g-preview-acceptance-gate.mjs','--help'],
    {encoding:'utf8',timeout:10000});
  assert.equal(invalid.status,2);
  const src=readFileSync('scripts/phase7g-preview-acceptance-gate.mjs','utf8');
  assert.doesNotMatch(src,/\bfetch\s*\(|wrangler|child_process|spawnSync|DatabaseSync|\.exec\s*\(/);
});
