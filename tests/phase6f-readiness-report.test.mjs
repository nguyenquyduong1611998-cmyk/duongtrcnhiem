// Phase 6F: local readiness report cannot be misused as deployment approval.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {inspectPhase6fOfflineReadiness}
  from '../scripts/phase6f-ci-readiness-report.mjs';

test('all offline source checks pass but real Cloudflare release remains NO-GO',()=>{
  const report=inspectPhase6fOfflineReadiness();
  assert.equal(report.status,'CODE_AUDIT_ONLY',JSON.stringify(report));
  assert.equal(Object.values(report.checks).every(Boolean),true);
  assert.equal(report.missingFileCount,0);
  assert.equal(report.deploymentAllowed,false);
  assert.match(report.architecture,/Cloudflare/);
  assert.match(report.architecture,/no VPS/);
  assert.equal(Object.values(report.releaseGates).every(v=>v===false),true);
  assert.equal('backupsApproved' in report,false);
});

test('missing source files cause a blocked report with zero side effects',()=>{
  const directory=mkdtempSync(join(tmpdir(),'phase6f-missing-src-'));
  try{
    const report=inspectPhase6fOfflineReadiness(directory);
    assert.equal(report.status,'CODE_CHECK_BLOCKED');
    assert.ok(report.missingFileCount>0);
    assert.equal(report.deploymentAllowed,false);
    assert.equal(Object.values(report.checks).some(v=>v===false),true);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('offline release report CLI never claims Production or migration approved',()=>{
  const result=spawnSync(process.execPath,
    ['scripts/phase6f-ci-readiness-report.mjs'],
    {encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);
  const report=JSON.parse(result.stdout);
  assert.equal(report.deploymentAllowed,false);
  assert.equal(report.releaseGates.freshD1PreviewBackupVerified,false);
  assert.equal(report.releaseGates.actual30To100UserLoadVerified,false);
  assert.equal(report.releaseGates.realDevicePwaInstallVerified,false);
  assert.equal(result.stdout.includes('FAKE_LOCAL_HASH'),false);
});
