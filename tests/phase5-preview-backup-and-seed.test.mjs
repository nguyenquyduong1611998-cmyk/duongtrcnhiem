// Phase 5 preparatory tests ONLY. Simulated backup + seed in SQLite memory.
// No Cloudflare network, credentials, production data or actual D1 writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {inspectD1SqlExportText,inspectLocalD1SqlExport}
  from '../scripts/phase4-inspect-d1-sql-export.mjs';
import {projectPublishedTopic}
  from '../functions/_shared/phase5-public-content.mjs';
const legacy=readFileSync('serverless/d1-staging-schema.sql','utf8');
const phase4=readFileSync('serverless/d1-phase4-synthetic-graded-quiz.sql','utf8');
const phase5=readFileSync('serverless/d1-phase5-content-model-draft.sql','utf8');
const seed=readFileSync('serverless/d1-phase5-preview-synthetic-math-seed.sql','utf8');
const UID='student_'+'e'.repeat(32);
const NOW=1800000000;
function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(legacy);db.exec(phase4);
  db.prepare('INSERT INTO demo_students '+
   '(username,firebase_uid,password_salt,password_hash,active,created_at) VALUES (?,?,?,?,1,?)')
   .run('test_hv_eeeeeeeeeeee',UID,'SYNTHETIC_SALT','SYNTHETIC_HASH',NOW);
  db.prepare('INSERT INTO synthetic_graded_attempts '+
    '(firebase_uid,answer_index,score,submitted_at) VALUES (?,1,10,?)')
    .run(UID,NOW);
  const scan=()=>({
    student:db.prepare('SELECT * FROM demo_students').all(),
    grades:db.prepare('SELECT * FROM synthetic_graded_attempts').all(),
    attempts:db.prepare('SELECT * FROM login_attempts').all(),
  });
  return {db,scan};
}

test('Preview export profile accepts 2 baseline tables and Phase4 score only',()=>{
  const sql=legacy+'\n'+phase4+'\n'+
    "INSERT INTO demo_students VALUES ('mock','student_"+
    'e'.repeat(32)+"','secret','secret',310000,1,1800000000);";
  const report=inspectD1SqlExportText(sql,{profile:'preview-demo'});
  assert.equal(report.status,'SQL_EXPORT_STRUCTURE_REVIEW_ONLY');
  assert.equal(report.profile,'preview-demo');
  assert.deepEqual(Object.keys(report.baselineTables).sort(),
    ['demo_students','login_attempts']);
  assert.equal(report.syntheticTableDeclared,true);
  assert.equal(report.syntheticColumnsPresent,true);
  for(const key of ['integrityVerified','rowsVerified','importabilityVerified',
    'isFreshBackupVerified','matchesLiveStagingVerified','deployAllowed'])
    assert.equal(report[key],false,key);
  assert.doesNotMatch(JSON.stringify(report),/secret|student_eeee|mock/);
  const canonical=inspectD1SqlExportText(sql);
  assert.equal(canonical.status,'BLOCKED');
  assert.equal(canonical.baselineTables.unit_accounts.requiredColumnsPresent,false);
});

test('Preview export inspection blocks missing grade schema, ALTER, DROP or invalid profiles',()=>{
  for(const candidate of [
    legacy,
    legacy+phase4+"\nDROP TABLE demo_students;",
    legacy+phase4+"\nALTER TABLE demo_students ADD COLUMN leak TEXT;",
    legacy+phase4+"\nDELETE FROM synthetic_graded_attempts;",
  ]){
    assert.equal(inspectD1SqlExportText(candidate,{profile:'preview-demo'}).status,'BLOCKED');
  }
  assert.equal(inspectD1SqlExportText(legacy+phase4,{profile:'other'}).status,'BLOCKED');
});

test('CLI --preview checks fake D1 export locally without printing secrets',()=>{
  const dir=mkdtempSync(join(tmpdir(),'phase5-preview-export-'));
  const file=join(dir,'SYNTHETIC_PRIVATE_DUMP.sql');
  try{
    writeFileSync(file,legacy+'\n'+phase4+
      "\nINSERT INTO demo_students VALUES ('secret_username','secret_uid','secret_salt','secret_hash',310000,1,1800000000);");
    const result=inspectLocalD1SqlExport(file,{profile:'preview-demo'});
    assert.equal(result.status,'SQL_EXPORT_STRUCTURE_REVIEW_ONLY');
    const p=spawnSync(process.execPath,
      ['scripts/phase4-inspect-d1-sql-export.mjs','--preview',file],
      {encoding:'utf8',timeout:20000});
    assert.equal(p.status,0,p.stderr);
    const body=JSON.parse(p.stdout);
    assert.equal(body.status,'SQL_EXPORT_STRUCTURE_REVIEW_ONLY');
    assert.equal(body.deployAllowed,false);
    for(const secret of ['secret_username','secret_uid','secret_salt',
      'secret_hash',dir,file,'SYNTHETIC_PRIVATE_DUMP'])
      assert.equal((p.stdout+p.stderr).includes(secret),false,secret);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Phase 5 schema + math-only seed preserve all Phase 4 rows exactly',()=>{
  const f=fixture();
  try{
    const before=f.scan();
    f.db.exec(phase5);
    f.db.exec(seed);
    assert.deepEqual(f.scan(),before);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM phase5_content_topics").get().n,1);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM phase5_content_versions").get().n,1);
    assert.equal(f.db.prepare("SELECT state FROM phase5_content_versions").get().state,'published');
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM phase5_content_questions").get().n,1);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM phase5_content_answer_keys").get().n,1);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM phase5_content_attempts").get().n,0);
    const v=f.db.prepare('SELECT * FROM phase5_content_versions').get();
    const q=f.db.prepare('SELECT * FROM phase5_content_questions').all();
    const publicTopic=projectPublishedTopic(v,q);
    assert.equal(publicTopic.questions[0].text,'2 + 2 bằng bao nhiêu?');
    assert.deepEqual(publicTopic.questions[0].options,['3','4','5','6']);
    for(const forbidden of ['correctIndex','correct_index','explanation','SECRET','password',
      'score','answer_keys']){
      assert.equal(JSON.stringify(publicTopic).includes(forbidden),false,forbidden);
    }
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.equal(f.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    // Re-running the seed is intentionally rejected; original rows remain unchanged.
    assert.throws(()=>f.db.exec(seed),/UNIQUE constraint failed/);
    assert.deepEqual(f.scan(),before);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM phase5_content_versions").get().n,1);
  }finally{f.db.close();}
});

test('seed is clearly inert until manual approval and never touches old tables',()=>{
  const uncommented=seed.replace(/^--.*$/gm,'');
  assert.match(seed,/DO NOT EXECUTE YET/);
  assert.match(seed,/duongtrcnhiem-auth-preview/);
  assert.match(uncommented,/INSERT INTO phase5_content_topics/);
  assert.match(uncommented,/INSERT INTO phase5_content_answer_keys/);
  assert.doesNotMatch(uncommented,/\b(?:DELETE|DROP|ALTER|ATTACH|VACUUM|REPLACE)\b/i);
  assert.doesNotMatch(uncommented,/\b(?:demo_students|login_attempts|unit_accounts|synthetic_graded_attempts)\b/i);
  assert.doesNotMatch(uncommented,/\b(?:CREATE TABLE|CREATE TRIGGER)\b/i);
});
