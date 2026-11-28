// Phase 7D: all data is synthetic and stays in temp directory. No network.
// Tests independent restored .sqlite verification without SQL import, writes,
// arbitrary user SQL, data leaks, file mutation or Cloudflare credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {
  readFileSync,writeFileSync,copyFileSync,existsSync,
  mkdtempSync,rmSync,linkSync,symlinkSync,
} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {verifyPhase7dLocalSnapshots}
  from '../scripts/phase7d-verify-restored-sqlite.mjs';

const BASE=[
  'serverless/d1-staging-schema.sql',
  'serverless/d1-phase4-synthetic-graded-quiz.sql',
  'serverless/d1-phase5-preview-additive-schema.sql',
  'serverless/d1-phase5-preview-synthetic-math-seed.sql',
];
const PHASE6=[
  'serverless/d1-phase6b-synthetic-admin-drafts-draft.sql',
  'serverless/d1-phase6c-publication-metadata-draft.sql',
  'serverless/d1-phase6-timed-sessions-draft.sql',
  'serverless/d1-phase6d-timed-submissions-draft.sql',
];
const UID='student_'+'7'.repeat(32);
const NOW=1800000000;
function create(){
  const dir=mkdtempSync(join(tmpdir(),'phase7d-private-'));
  const source=join(dir,'SENSITIVE_ORIGINAL.sqlite');
  const candidate=join(dir,'SENSITIVE_RESTORED.sqlite');
  const db=new DatabaseSync(source);
  db.exec('PRAGMA foreign_keys=ON');
  for(const path of BASE)db.exec(readFileSync(path,'utf8'));
  db.prepare(
    'INSERT INTO demo_students(username,firebase_uid,password_salt,password_hash,active,created_at) VALUES (?,?,?,?,1,?)'
  ).run('test_hv_777777777777',UID,'FAKE_PRIVATE_SALT','FAKE_PRIVATE_HASH',NOW);
  db.prepare(
    "INSERT INTO synthetic_graded_attempts(firebase_uid,quiz_id,answer_index,score,submitted_at,marker) VALUES (?,'synthetic_math_v1',1,10,?,'SYNTHETIC_ONLY')"
  ).run(UID,NOW);
  db.close();
  copyFileSync(source,candidate);
  const close=()=>rmSync(dir,{recursive:true,force:true});
  return {dir,source,candidate,close};
}
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
function noLeak(report,f){
  assert.equal(report.deploymentAllowed,false);
  assert.equal(report.d1SourceIdentityVerified,false);
  assert.equal(report.backupFreshnessVerified,false);
  assert.equal(report.independentCloudflareRestoreVerified,false);
  assert.equal(report.migrationsExecuted,false);
  const text=JSON.stringify(report);
  for(const forbidden of [f.source,f.candidate,f.dir,UID,
    'test_hv_777777777777','FAKE_PRIVATE_SALT','FAKE_PRIVATE_HASH',
    'CREATE TABLE','correct_index','answers_json','password_hash']){
    assert.equal(text.includes(forbidden),false,forbidden);
  }
}
test('two independent copies with original DEMO rows pass local integrity only',async()=>{
  const f=create();
  try{
    const orig=hash(f.source),candidate=hash(f.candidate);
    const report=await verifyPhase7dLocalSnapshots(f.source,f.candidate);
    assert.equal(report.status,'LOCAL_SNAPSHOT_COMPARISON_REVIEW_ONLY',
      JSON.stringify(report));
    assert.equal(report.sourceIntegrityVerified,true);
    assert.equal(report.candidateIntegrityVerified,true);
    assert.equal(report.baselineRowCountsMatch,true);
    assert.equal(report.phase6SchemaStatus,'MIGRATION_REVIEW_REQUIRED');
    assert.equal(report.stages.baseline,'SCHEMA_CANDIDATE');
    noLeak(report,f);
    assert.equal(hash(f.source),orig);
    assert.equal(hash(f.candidate),candidate);
  }finally{f.close();}
});
test('candidate with additive Phase6 schemas preserves old data but does not grant deployment',async()=>{
  const f=create();
  try{
    const orig=hash(f.source);
    const db=new DatabaseSync(f.candidate);
    try{
      db.exec('PRAGMA foreign_keys=ON');
      for(const path of PHASE6)db.exec(readFileSync(path,'utf8'));
    }finally{db.close();}
    const report=await verifyPhase7dLocalSnapshots(f.source,f.candidate);
    assert.equal(report.status,'LOCAL_SNAPSHOT_COMPARISON_REVIEW_ONLY',
      JSON.stringify(report));
    assert.equal(report.phase6SchemaStatus,'SCHEMA_CANDIDATE_REVIEW_ONLY');
    assert.equal(report.stages.phase6d,'SCHEMA_CANDIDATE');
    assert.equal(report.stages.phase6a,'SCHEMA_CANDIDATE');
    assert.equal(hash(f.source),orig);
    noLeak(report,f);
  }finally{f.close();}
});
test('changed baseline counts block, even with schema and foreign keys valid',async()=>{
  const f=create();
  try{
    const db=new DatabaseSync(f.candidate);
    try{
      db.prepare(
        'INSERT INTO demo_students(username,firebase_uid,password_salt,password_hash,active,created_at) VALUES (?,?,?,?,1,?)'
      ).run('test_hv_888888888888','student_'+'8'.repeat(32),'salt2','hash2',NOW);
    }finally{db.close();}
    const report=await verifyPhase7dLocalSnapshots(f.source,f.candidate);
    assert.equal(report.status,'BLOCKED');
    assert.equal(report.reason,'BASELINE_ROW_COUNTS_CHANGED');
    noLeak(report,f);
  }finally{f.close();}
});
test('partial migration or missing immutable triggers fail closed',async()=>{
  const f=create();
  try{
    const db=new DatabaseSync(f.candidate);
    try{
      db.exec('CREATE TABLE phase6_exam_sessions(session_id TEXT)');
    }finally{db.close();}
    const report=await verifyPhase7dLocalSnapshots(f.source,f.candidate);
    assert.equal(report.status,'BLOCKED');
    assert.equal(report.reason,'PHASE7_SCHEMA_MISSING_OR_MISMATCHED');
    noLeak(report,f);
  }finally{f.close();}
});
test('foreign key violations in candidate are BLOCKED and no orphan details shown',async()=>{
  const f=create();
  try{
    const db=new DatabaseSync(f.candidate);
    try{
      db.exec('PRAGMA foreign_keys=OFF');
      db.exec('CREATE TABLE phase7d_parent (id INTEGER PRIMARY KEY)');
      db.exec('CREATE TABLE phase7d_child (parent_id INTEGER REFERENCES phase7d_parent(id))');
      db.exec('INSERT INTO phase7d_child VALUES (12345)');
    }finally{db.close();}
    const report=await verifyPhase7dLocalSnapshots(f.source,f.candidate);
    assert.equal(report.status,'BLOCKED');
    assert.equal(report.reason,'SQLITE_INTEGRITY_OR_FOREIGN_KEY_FAILED');
    assert.equal(JSON.stringify(report).includes('12345'),false);
    noLeak(report,f);
  }finally{f.close();}
});
test('symlinks, hardlinks, same path, malformed SQLite and missing file blocked',async()=>{
  const f=create();
  try{
    assert.equal((await verifyPhase7dLocalSnapshots(f.source,f.source)).reason,
      'FILES_MUST_BE_INDEPENDENT');
    const link=join(f.dir,'symlink.sqlite');
    symlinkSync(f.source,link);
    assert.equal((await verifyPhase7dLocalSnapshots(f.source,link)).reason,
      'INVALID_SQLITE_FILE');
    const hard=join(f.dir,'hardlink.sqlite');
    linkSync(f.source,hard);
    assert.equal((await verifyPhase7dLocalSnapshots(f.source,hard)).reason,
      'FILES_MUST_BE_INDEPENDENT');
    writeFileSync(f.candidate,"DROP TABLE demo_students; SECRET");
    assert.equal((await verifyPhase7dLocalSnapshots(f.source,f.candidate)).reason,
      'INVALID_SQLITE_FILE');
    assert.equal((await verifyPhase7dLocalSnapshots(
      f.source,join(f.dir,'missing.sqlite'))).status,'BLOCKED');
    assert.ok(existsSync(f.source));
  }finally{f.close();}
});
test('reject an uncheckpointed SQLite WAL sidecar instead of trusting stale bytes',async()=>{
  const f=create();
  try{
    writeFileSync(f.candidate+'-wal',Buffer.from('FAKE_UNCHECKPOINTED_WAL'));
    const result=await verifyPhase7dLocalSnapshots(f.source,f.candidate);
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.reason,'INVALID_SQLITE_FILE');
    noLeak(result,f);
  }finally{f.close();}
});
test('CLI uses only existing local snapshot inputs, never exports or emits private filenames',()=>{
  const f=create();
  try{
    const cli=spawnSync(process.execPath,
      ['scripts/phase7d-verify-restored-sqlite.mjs',f.source,f.candidate],
      {encoding:'utf8',timeout:15000});
    assert.equal(cli.status,0,cli.stderr);
    const data=JSON.parse(cli.stdout);
    assert.equal(data.status,'LOCAL_SNAPSHOT_COMPARISON_REVIEW_ONLY');
    noLeak(data,f);
    for(const text of [f.dir,f.source,f.candidate,'FAKE_PRIVATE_HASH'])
      assert.equal((cli.stdout+cli.stderr).includes(text),false);
    const invalid=spawnSync(process.execPath,
      ['scripts/phase7d-verify-restored-sqlite.mjs'],
      {encoding:'utf8',timeout:15000});
    assert.equal(invalid.status,2);
    assert.match(invalid.stdout,/OFFLINE READ-ONLY/);
    const source=readFileSync('scripts/phase7d-verify-restored-sqlite.mjs','utf8');
    assert.match(source,/readOnly:true/);
    assert.doesNotMatch(source,/\bfetch\s*\(|wrangler|child_process|spawnSync|\.exec\(/);
  }finally{f.close();}
});
