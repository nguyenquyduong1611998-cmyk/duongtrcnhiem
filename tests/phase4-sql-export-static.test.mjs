// Phase 4F tests: fabricated D1 SQL exports ONLY; no SQL execution or uploads.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync,writeFileSync,mkdtempSync,rmSync,statSync,truncateSync,
} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  inspectD1SqlExportText,inspectLocalD1SqlExport,
} from '../scripts/phase4-inspect-d1-sql-export.mjs';

const base=readFileSync('serverless/d1-staging-schema.sql','utf8');
const unit=readFileSync('serverless/d1-phase2-staging-accounts.sql','utf8');
const quiz=readFileSync('serverless/d1-phase4-synthetic-graded-quiz.sql','utf8');
const sensitive="private-test-secret; CREATE TABLE fake_dump(value TEXT)";
const dump=(extra='')=>
  "PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n"+base+
  '\n'+unit+'\n'+extra+
  "\nINSERT INTO demo_students VALUES ('test_hv_aaaaaaaaaaaa',"+
  "'student_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',"+
  "'"+sensitive.replaceAll("'","''")+"','mock-hash',310000,1,1800000000);\n"+
  'COMMIT;\n';
function fileFixture(text){
  const dir=mkdtempSync(join(tmpdir(),'phase4-d1-sql-export-'));
  const file=join(dir,'private-staging-dump.sql');
  writeFileSync(file,text);
  const clean=()=>rmSync(dir,{recursive:true,force:true});
  return {file,clean};
}
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');

test('recognizes all baseline table declarations; never claims integrity or deployment approval',()=>{
  const report=inspectD1SqlExportText(dump());
  assert.equal(report.status,'SQL_EXPORT_STRUCTURE_REVIEW_ONLY');
  for(const name of ['demo_students','login_attempts','unit_accounts']){
    assert.equal(report.baselineTables[name].declared,true);
    assert.equal(report.baselineTables[name].requiredColumnsPresent,true);
  }
  assert.equal(report.syntheticTableDeclared,false);
  assert.equal(report.integrityVerified,false);
  assert.equal(report.foreignKeysVerified,false);
  assert.equal(report.rowsVerified,false);
  assert.equal(report.importabilityVerified,false);
  assert.equal(report.isFreshBackupVerified,false);
  assert.equal(report.matchesLiveStagingVerified,false);
  assert.equal(report.requiresIsolatedRestoreForIntegrityCheck,true);
  assert.equal(report.deployAllowed,false);
  assert.doesNotMatch(JSON.stringify(report),/test_hv_|mock-hash|private-test-secret/);
});

test('identifies optional synthetic score schema but cannot certify its trigger or data',()=>{
  const report=inspectD1SqlExportText(dump(quiz));
  assert.equal(report.status,'SQL_EXPORT_STRUCTURE_REVIEW_ONLY');
  assert.equal(report.syntheticTableDeclared,true);
  assert.equal(report.syntheticColumnsPresent,true);
  assert.equal(report.integrityVerified,false);
  assert.equal(report.deployAllowed,false);
});

test('supports SQLite double quoted, backtick and bracketed CREATE TABLE names',()=>{
  const modified=base
    .replace('CREATE TABLE IF NOT EXISTS demo_students','CREATE TABLE IF NOT EXISTS "demo_students"')
    .replace('CREATE TABLE IF NOT EXISTS login_attempts','CREATE TABLE IF NOT EXISTS [login_attempts]');
  const renamed=unit.replace('CREATE TABLE IF NOT EXISTS unit_accounts',
    'CREATE TABLE IF NOT EXISTS ' + String.fromCharCode(96) + 'unit_accounts' + String.fromCharCode(96));
  const report=inspectD1SqlExportText(modified+'\n'+renamed);
  assert.equal(report.status,'SQL_EXPORT_STRUCTURE_REVIEW_ONLY');
  for(const name of ['demo_students','login_attempts','unit_accounts'])
    assert.equal(report.baselineTables[name].requiredColumnsPresent,true);
});

test('does not count fake declarations inside comments, SQL strings or trigger bodies',()=>{
  const baseOnly=base+
    "\nINSERT INTO demo_students (username) VALUES ("+
    "'CREATE TABLE unit_accounts (username TEXT, firebase_uid TEXT, password_hash TEXT, password_salt TEXT, active INTEGER, auth_version INTEGER);');\n"+
    "-- CREATE TABLE unit_accounts (password_hash TEXT); \n"+
    "/* CREATE TABLE unit_accounts (username TEXT); */\n";
  const report=inspectD1SqlExportText(baseOnly);
  assert.equal(report.status,'BLOCKED');
  assert.equal(report.baselineTables.unit_accounts.declared,false);
  assert.equal(report.reason,'EXPECTED_SCHEMA_DECLARATIONS_MISSING_OR_INCOMPLETE');
});

test('missing columns and a misleading CHECK string block the schema',()=>{
  const missing=unit.replace('auth_version INTEGER NOT NULL DEFAULT 1',
    'auth_version_alias INTEGER NOT NULL DEFAULT 1');
  const report=inspectD1SqlExportText(base+'\n'+missing);
  assert.equal(report.status,'BLOCKED');
  assert.equal(report.baselineTables.unit_accounts.requiredColumnsPresent,false);
  assert.equal(report.deployAllowed,false);
});

test('duplicate CREATE TABLE and active ATTACH/DROP statements are flagged',()=>{
  for(const value of [
    dump()+base,
    dump()+"\nATTACH DATABASE '/private/file.sqlite' AS unsafe;",
    dump()+"\nDROP TABLE demo_students;",
  ]){
    const report=inspectD1SqlExportText(value);
    assert.equal(report.status,'BLOCKED');
    assert.equal(report.deployAllowed,false);
  }
  // The word ATTACH inside an INSERT string cannot be executed by the scanner.
  const harmless=inspectD1SqlExportText(dump()+
    "\nINSERT INTO demo_students VALUES ('ATTACH DATABASE other.db');");
  assert.equal(harmless.status,'SQL_EXPORT_STRUCTURE_REVIEW_ONLY');
});

test('unterminated SQL text, null bytes and unfinished comment are rejected',()=>{
  for(const input of [
    dump()+"\nINSERT INTO foo VALUES ('unfinished",
    dump()+"\n/* unfinished",
    dump()+"\n\0",
    '',
  ]){
    const report=inspectD1SqlExportText(input);
    assert.equal(report.status,'BLOCKED');
    assert.equal(report.deployAllowed,false);
  }
});

test('local .sql scan does not change file bytes or reveal raw text and names',()=>{
  const f=fileFixture(dump(quiz));
  try{
    const original=hash(f.file),size=statSync(f.file).size;
    const report=inspectLocalD1SqlExport(f.file);
    assert.equal(report.status,'SQL_EXPORT_STRUCTURE_REVIEW_ONLY');
    assert.equal(hash(f.file),original);
    assert.equal(statSync(f.file).size,size);
    const serialized=JSON.stringify(report);
    for(const value of [f.file,'private-staging-dump','test_hv_aaaaaaaaaaaa',
      'mock-hash','private-test-secret','student_aaaaaaaa'])
      assert.equal(serialized.includes(value),false);
  }finally{f.clean();}
});

test('CLI outputs only a non-authorizing report and returns exit 0 on structural review',()=>{
  const f=fileFixture(dump());
  try{
    const run=spawnSync(process.execPath,
      ['scripts/phase4-inspect-d1-sql-export.mjs',f.file],
      {encoding:'utf8',timeout:20000});
    assert.equal(run.status,0,run.stderr);
    const data=JSON.parse(run.stdout);
    assert.equal(data.status,'SQL_EXPORT_STRUCTURE_REVIEW_ONLY');
    assert.equal(data.integrityVerified,false);
    assert.equal(data.deployAllowed,false);
    assert.equal(run.stdout.includes(f.file),false);
    assert.equal(run.stdout.includes('private-test-secret'),false);
  }finally{f.clean();}
});

test('CLI refuses malformed or dangerous dump without printing private path',()=>{
  const f=fileFixture(dump()+"\nATTACH DATABASE '/secret/target' AS x;");
  try{
    const run=spawnSync(process.execPath,
      ['scripts/phase4-inspect-d1-sql-export.mjs',f.file],
      {encoding:'utf8',timeout:20000});
    assert.equal(run.status,1);
    const data=JSON.parse(run.stdout);
    assert.equal(data.status,'BLOCKED');
    assert.equal(data.deployAllowed,false);
    assert.equal(run.stdout.includes(f.file),false);
    assert.equal(run.stderr.includes(f.file),false);
    assert.equal(run.stdout.includes('/secret/target'),false);
  }finally{f.clean();}
});

test('invalid UTF-8, overlarge file and non-file paths fail without SQL execution',()=>{
  const f=fileFixture(dump());
  try{
    writeFileSync(f.file,Buffer.from([0xff,0xfe,0xfd]));
    assert.throws(()=>inspectLocalD1SqlExport(f.file));
    writeFileSync(f.file,Buffer.from([0xff,0xfe,0xfd,0x0a,...new Array(64).fill(0x41)]));
    assert.throws(()=>inspectLocalD1SqlExport(f.file));
    truncateSync(f.file,32*1024*1024+1);
    assert.throws(()=>inspectLocalD1SqlExport(f.file),
      /SQL_EXPORT_SIZE_OR_TYPE_INVALID/);
    assert.throws(()=>inspectLocalD1SqlExport(f.file+'/absent'));
  }finally{f.clean();}
});

test('inspector never executes SQL or uses network and shell subprocesses',()=>{
  const src=readFileSync('scripts/phase4-inspect-d1-sql-export.mjs','utf8');
  assert.doesNotMatch(src,/\bDatabaseSync\b|\bnode:sqlite\b/);
  assert.doesNotMatch(src,/\bfetch\s*\(|wrangler|axios|child_process|execFile\s*\(/);
  assert.doesNotMatch(src,/\beval\s*\(|\bnew Function\b/);
});
