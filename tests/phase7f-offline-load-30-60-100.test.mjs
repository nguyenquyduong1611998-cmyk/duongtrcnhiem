// Phase 7F: strictly offline 30/60/100 synthetic-client functional rehearsal.
// No real requests, quotas, network latency or Cloudflare users are measured.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {runPhase7fOfflineLoadRehearsal}
  from '../scripts/phase7f-offline-load-rehearsal.mjs';

function noGo(result){
  assert.equal(result.mode,'phase7f-offline-synthetic-sqlite-only');
  assert.equal(result.syntheticUsersOnly,true);
  assert.equal(result.simulatedConcurrencyIsNotNetworkLoad,true);
  assert.equal(result.cloudflareD1LiveLoadMeasured,false);
  assert.equal(result.actualConcurrentUsersVerified,false);
  assert.equal(result.latencyPercentilesMeasured,false);
  assert.equal(result.cloudflareQuotaHeadroomVerified,false);
  assert.equal(result.realDevicePwaInstalled,false);
  assert.equal(result.deploymentAuthorized,false);
  const serialized=JSON.stringify(result);
  for(const bad of [
    'LOCAL_SYNTHETIC_HASH','LOCAL_SYNTHETIC_SALT',
    'firebase_uid','student_uid','password_hash',
    'correct_index','answers_json','p6_session_','test_hv_',
    'student_','cloudflare.com','pages.dev','http:',
  ])assert.equal(serialized.includes(bad),false,bad);
}
test('30 then 60 then 100 independent DEMO clients share SQLite and keep unique grades',async()=>{
  const result=await runPhase7fOfflineLoadRehearsal();
  assert.equal(result.status,'OFFLINE_FUNCTIONAL_REHEARSAL_PASSED');
  assert.deepEqual(result.waves,[
    {simulatedTotalUsers:30,committedSubmissions:30,
      uniqueServerSessions:30,adminPages:2},
    {simulatedTotalUsers:60,committedSubmissions:60,
      uniqueServerSessions:60,adminPages:3},
    {simulatedTotalUsers:100,committedSubmissions:100,
      uniqueServerSessions:100,adminPages:4},
  ]);
  assert.equal(result.independentSqliteConnections,4);
  assert.equal(result.separateConnectionResultRecovery,true);
  assert.equal(result.sameBodyManualReplayIdempotent,true);
  assert.equal(result.changedAnswersDenied,true);
  assert.equal(result.baselineIntegrityAndForeignKeysChecked,true);
  noGo(result);
});
test('CLI is local-only, no host args; output cannot contain PII or overclaim live benchmark',()=>{
  const run=spawnSync(process.execPath,
    ['scripts/phase7f-offline-load-rehearsal.mjs'],
    {encoding:'utf8',timeout:30000});
  assert.equal(run.status,0,run.stderr);
  const parsed=JSON.parse(run.stdout);
  assert.equal(parsed.waves.length,3);
  assert.equal(parsed.waves[2].simulatedTotalUsers,100);
  noGo(parsed);
  const invalid=spawnSync(process.execPath,
    ['scripts/phase7f-offline-load-rehearsal.mjs','https://example.com'],
    {encoding:'utf8',timeout:15000});
  assert.equal(invalid.status,2);
  assert.match(invalid.stdout,/OFFLINE only/);
  const code=readFileSync('scripts/phase7f-offline-load-rehearsal.mjs','utf8');
  assert.doesNotMatch(code,
    /\bfetch\s*\(|wrangler|child_process|spawnSync|https:\/\/|\bD1_DATABASE_ID\b|\.env\b/);
});
