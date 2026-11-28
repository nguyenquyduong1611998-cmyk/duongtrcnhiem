// Phase 7C privacy-safe local evidence ledger tests. Never use real data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,symlinkSync}
  from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {
  inspectPhase7cOperatorEvidence,inspectLocalPhase7cEvidence,
} from '../scripts/phase7c-operator-evidence-gate.mjs';

const template=JSON.parse(readFileSync(
  'docs/phase7c-operator-evidence-template.json','utf8'));
const keys=Object.keys(template.operatorReview);
const copied=()=>structuredClone(template);
function assertNoGo(r){
  assert.equal(r.deployAuthorized,false);
  assert.equal(r.evidenceIndependentlyVerified,false);
  assert.equal(r.cloudflareAccountAuthenticatedByThisTool,false);
  assert.equal(r.d1BackupRestoredByThisTool,false);
  assert.equal(r.externalLoadExecutedByThisTool,false);
}
test('repo evidence template starts with 12 NOT_CHECKED entries, never a GO',()=>{
  assert.equal(keys.length,12);
  assert.equal(keys.every(k=>template.operatorReview[k]==='NOT_CHECKED'),true);
  assert.equal(template.gitCommitSha,null);
  const result=inspectPhase7cOperatorEvidence(template);
  assert.equal(result.status,'OPERATOR_EVIDENCE_INCOMPLETE');
  assert.equal(result.reviewedCount,0);
  assert.equal(result.notChecked.length,12);
  assertNoGo(result);
});
test('claimed full review still requires independent Cloudflare authorization',()=>{
  const claimed=copied();
  claimed.gitCommitSha='b'.repeat(40);
  for(const key of keys)claimed.operatorReview[key]='REVIEWED_BY_OPERATOR';
  const output=inspectPhase7cOperatorEvidence(claimed);
  assert.equal(output.status,'ALL_SELF_REPORTED_REQUIRES_INDEPENDENT_AUTHORIZATION');
  assert.equal(output.reviewedCount,12);
  assert.equal(output.totalChecks,12);
  assert.deepEqual(output.notChecked,[]);
  assertNoGo(output);
  claimed.gitCommitSha=null;
  assert.equal(inspectPhase7cOperatorEvidence(claimed).status,
    'STOP_DEPLOYED_COMMIT_UNRECORDED');
});
test('operator-reported blockers always stop review, even when all else says reviewed',()=>{
  const data=copied();
  data.gitCommitSha='c'.repeat(40);
  for(const key of keys)data.operatorReview[key]='REVIEWED_BY_OPERATOR';
  data.operatorReview.previewAccessPolicyAndHashUrls='BLOCKED';
  const result=inspectPhase7cOperatorEvidence(data);
  assert.equal(result.status,'STOP_OPERATOR_REPORTED_BLOCKERS');
  assert.deepEqual(result.blocked,['previewAccessPolicyAndHashUrls']);
  assertNoGo(result);
});
test('unrecognized keys, secret-looking extra material, wrong SHA and statuses are rejected',()=>{
  const mutants=[
    {...copied(),secretToken:'DO_NOT_LOG'},
    {...copied(),databaseId:'PRIVATE_DB_UUID'},
    {...copied(),branch:'main'},
    {...copied(),environment:'production'},
    {...copied(),gitCommitSha:'invalid'},
    {...copied(),gitCommitSha:'d'.repeat(39)},
    {...copied(),schemaVersion:0},
    {...copied(),operatorReview:{
      ...template.operatorReview,privateKey:'PRIVATE_SECRET',
    }},
    {...copied(),operatorReview:{
      ...template.operatorReview,previewAccessPolicyAndHashUrls:true,
    }},
    {...copied(),operatorReview:{
      ...template.operatorReview,previewD1BindingMatchesExpectedIdPrivately:
        'REVIEWED_BY_OPERATOR;DROP TABLE',
    }},
    {...copied(),operatorReview:{}},
    null,[],
  ];
  for(const item of mutants){
    const result=inspectPhase7cOperatorEvidence(item);
    assert.equal(result.status,'BLOCKED_INVALID_LEDGER');
    assertNoGo(result);
    for(const secret of ['DO_NOT_LOG','PRIVATE_DB_UUID','PRIVATE_SECRET','DROP TABLE'])
      assert.equal(JSON.stringify(result).includes(secret),false);
  }
});
test('offline CLI prints only status and check names; no private file paths or contents',()=>{
  const dir=mkdtempSync(join(tmpdir(),'phase7c-private-'));
  const file=join(dir,'PRIVATE_SQL_AND_TOKEN_LEDGER.json');
  try{
    writeFileSync(file,JSON.stringify(template));
    const r=inspectLocalPhase7cEvidence(file);
    assert.equal(r.status,'OPERATOR_EVIDENCE_INCOMPLETE');
    const cli=spawnSync(process.execPath,
      ['scripts/phase7c-operator-evidence-gate.mjs',file],
      {encoding:'utf8',timeout:10000});
    assert.equal(cli.status,0,cli.stderr);
    assert.deepEqual(JSON.parse(cli.stdout),r);
    assert.equal(cli.stdout.includes(dir),false);
    assert.equal(cli.stdout.includes(file),false);
    writeFileSync(file,JSON.stringify({...template,apiToken:'SECRET'}));
    const blocked=inspectLocalPhase7cEvidence(file);
    assert.equal(blocked.status,'BLOCKED_INVALID_LEDGER');
    assertNoGo(blocked);
    assert.equal(JSON.stringify(blocked).includes('SECRET'),false);
    const link=join(dir,'sneaky.json');
    symlinkSync(file,link);
    assert.equal(inspectLocalPhase7cEvidence(link).status,'BLOCKED_INVALID_LEDGER');
    assert.equal(inspectLocalPhase7cEvidence(join(dir,'missing')).status,
      'BLOCKED_INVALID_LEDGER');
    assert.equal(inspectLocalPhase7cEvidence(file+'.missing').deployAuthorized,false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('CLI by default reads the sanitized template, and never connects to Cloudflare',()=>{
  const cli=spawnSync(process.execPath,
    ['scripts/phase7c-operator-evidence-gate.mjs'],
    {encoding:'utf8',timeout:10000});
  assert.equal(cli.status,0,cli.stderr);
  assert.equal(JSON.parse(cli.stdout).status,'OPERATOR_EVIDENCE_INCOMPLETE');
  const source=readFileSync('scripts/phase7c-operator-evidence-gate.mjs','utf8');
  assert.doesNotMatch(source,/\bfetch\s*\(|wrangler|child_process|spawnSync|execFileSync|DatabaseSync/);
});
