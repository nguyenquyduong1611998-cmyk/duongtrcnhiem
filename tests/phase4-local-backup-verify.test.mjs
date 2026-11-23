import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {verifyOfflineStagingBackup}
  from '../scripts/phase4-verify-local-backup.mjs';

const base=readFileSync('serverless/d1-staging-schema.sql','utf8');
const phase2=readFileSync('serverless/d1-phase2-staging-accounts.sql','utf8');
const quiz=readFileSync('serverless/d1-phase4-synthetic-graded-quiz.sql','utf8');
const uid='student_'+'a'.repeat(32);
const createdAt=1800000000;

function fixture({withBase=true,withUnit=true,withQuiz=false,orphan=false}={}){
  const dir=mkdtempSync(join(tmpdir(),'phase4-local-backup-'));
  const path=join(dir,'private-staging-test.sqlite');
  const db=new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON');
  if(withBase)db.exec(base);
  if(withUnit)db.exec(phase2);
  if(withBase){
    db.prepare('INSERT INTO demo_students '+
      '(username,firebase_uid,password_salt,password_hash,active,created_at) '+
      'VALUES (?,?,?,?,1,?)')
      .run('test_hv_aaaaaaaaaaaa',uid,
        'secret-salt-test-never-print','secret-hash-test-never-print',createdAt);
  }
  if(withQuiz){
    db.exec(quiz);
    db.prepare('INSERT INTO synthetic_graded_attempts '+
      '(firebase_uid,answer_index,score,submitted_at) '+
      'VALUES (?,?,?,?)').run(uid,1,10,createdAt);
  }
  if(orphan){
    db.exec('PRAGMA foreign_keys=OFF');
    db.exec('CREATE TABLE fake_parent (id INTEGER PRIMARY KEY)');
    db.exec('CREATE TABLE fake_child '+
      '(parent_id INTEGER REFERENCES fake_parent(id))');
    db.exec('INSERT INTO fake_child VALUES (1234)');
  }
  db.close();
  const clean=()=>rmSync(dir,{recursive:true,force:true});
  return {path,clean};
}
const digest=file=>createHash('sha256').update(readFileSync(file)).digest('hex');

test('checks valid snapshot before migration without modifying a single byte',async()=>{
  const f=fixture();
  try{
    const before=digest(f.path);
    const sizeBefore=statSync(f.path).size;
    const report=await verifyOfflineStagingBackup(f.path);
    assert.equal(report.status,'LOCAL_STRUCTURE_CHECK_PASSED');
    assert.equal(report.schemaStatus,'REVIEW_MIGRATION_ONLY');
    assert.equal(report.syntheticTablePresent,false);
    assert.equal(report.syntheticRowCount,null);
    assert.equal(report.baselineRows.demo_students,1);
    assert.equal(report.baselineRows.unit_accounts,0);
    assert.equal(report.integrityVerified,true);
    assert.equal(report.foreignKeysVerified,true);
    assert.equal(report.isFreshBackupVerified,false);
    assert.equal(report.matchesLiveStagingVerified,false);
    assert.equal(report.deployAllowed,false);
    assert.equal(digest(f.path),before);
    assert.equal(statSync(f.path).size,sizeBefore);
    const serialized=JSON.stringify(report);
    for(const forbidden of [
      uid,'test_hv_aaaaaaaaaaaa','secret-salt','secret-hash',
      'private-staging-test.sqlite',
    ])assert.equal(serialized.includes(forbidden),false);
  }finally{f.clean();}
});

test('reads snapshot with installed synthetic score schema without modifying data',async()=>{
  const f=fixture({withQuiz:true});
  try{
    const hash=digest(f.path);
    const report=await verifyOfflineStagingBackup(f.path);
    assert.equal(report.status,'LOCAL_STRUCTURE_CHECK_PASSED');
    assert.equal(report.schemaStatus,'SYNTHETIC_SCHEMA_PRESENT');
    assert.equal(report.syntheticRowCount,1);
    assert.equal(report.deployAllowed,false);
    assert.equal(digest(f.path),hash);
    const reopened=new DatabaseSync(f.path,{readOnly:true});
    try{
      assert.equal(reopened.prepare('SELECT score FROM synthetic_graded_attempts').get().score,10);
      assert.throws(()=>reopened.exec('DELETE FROM demo_students'));
    }finally{reopened.close();}
  }finally{f.clean();}
});

test('rejects a missing unit schema, never treats missing migration as approval',async()=>{
  const f=fixture({withUnit:false});
  try{
    const hash=digest(f.path);
    const report=await verifyOfflineStagingBackup(f.path);
    assert.deepEqual(report,{
      status:'BLOCKED',
      reason:'STAGING_SCHEMA_INCOMPATIBLE',
      deployAllowed:false,
    });
    assert.equal(digest(f.path),hash);
  }finally{f.clean();}
});

test('foreign-key violation blocks the report without printing affected rows',async()=>{
  const f=fixture({orphan:true});
  try{
    const hash=digest(f.path);
    const result=await verifyOfflineStagingBackup(f.path);
    assert.deepEqual(result,{
      status:'BLOCKED',reason:'FOREIGN_KEY_VIOLATIONS',deployAllowed:false,
    });
    assert.equal(digest(f.path),hash);
    assert.equal(JSON.stringify(result).includes('1234'),false);
  }finally{f.clean();}
});

test('refuses SQL export text instead of executing untrusted SQL statements',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'phase4-dump-'));
  const path=join(dir,'private-snapshot.sql');
  const marker=join(dir,'must-not-create.txt');
  try{
    writeFileSync(path,
      "ATTACH DATABASE '"+marker+"' AS malicious; "+
      "CREATE TABLE malicious.test (id INTEGER);"
    );
    await assert.rejects(verifyOfflineStagingBackup(path),
      /LOCAL_BACKUP_NOT_SQLITE_SNAPSHOT/);
    const {existsSync}=await import('node:fs');
    assert.equal(existsSync(marker),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('rejects non-file, missing, and incomplete binary database snapshots',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'phase4-invalid-backup-'));
  try{
    const file=join(dir,'broken.sqlite');
    writeFileSync(file,Buffer.from('SQLite format 3\0','ascii'));
    await assert.rejects(verifyOfflineStagingBackup(file));
    await assert.rejects(verifyOfflineStagingBackup(dir),
      /LOCAL_BACKUP_SIZE_OR_TYPE_INVALID/);
    await assert.rejects(verifyOfflineStagingBackup(''));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('the inspector opens readOnly, does not include backup path or network clients',()=>{
  const src=readFileSync('scripts/phase4-verify-local-backup.mjs','utf8');
  assert.match(src,/readOnly:true/);
  assert.match(src,/PRAGMA integrity_check/);
  assert.match(src,/PRAGMA foreign_key_check/);
  assert.doesNotMatch(src,/\bfetch\s*\(|wrangler|axios|child_process|spawn\s*\(|execFile\s*\(/);
  assert.doesNotMatch(src,/JSON\.stringify\(\s*sqlite\.prepare/);
});
