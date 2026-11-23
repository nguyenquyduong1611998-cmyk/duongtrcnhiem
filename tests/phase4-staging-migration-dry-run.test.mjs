// PHASE 4C: offline-only dry-run and rollback rehearsal for the NEW
// synthetic score table. Never connects to Cloudflare, Firebase or GitHub.
// This is NOT a test of the real staging D1 database/backup.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {handleDemoQuizStudent,handleDemoQuizAdmin}
  from '../functions/_shared/synthetic-quiz.mjs';

const base=readFileSync('serverless/d1-staging-schema.sql','utf8');
const phase2=readFileSync('serverless/d1-phase2-staging-accounts.sql','utf8');
const migration=readFileSync(
  'serverless/d1-phase4-synthetic-graded-quiz.sql','utf8',
);
const now=1800000000;
const uid=n=>'student_'+n.toString(16).padStart(32,'0');
const studentName=n=>'test_hv_'+n.toString(16).padStart(12,'0');
const make=()=>{
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(base);
  sqlite.exec(phase2);
  const exec=(sql,...args)=>sqlite.prepare(sql).run(...args);
  const get=(sql,...args)=>sqlite.prepare(sql).get(...args);
  const all=(sql,...args)=>sqlite.prepare(sql).all(...args);
  const d1={
    prepare(sql){return {
      async all(){return {success:true,results:all(sql)};},
      bind(...args){return {
        async first(){return get(sql,...args)??null;},
        async run(){return {success:true,meta:{changes:exec(sql,...args).changes}};},
      };},
    };},
  };
  // Existing DEMO, failed-login and separate unit_account credentials are
  // inert synthetic values; not credentials used by any connected system.
  for(let n=1;n<=4;n++)exec(
    'INSERT INTO demo_students '+
    '(username,firebase_uid,password_salt,password_hash,kdf_iterations,'+
    'active,created_at) VALUES (?,?,?,?,310000,1,?)',
    studentName(n),uid(n),'fictional-demo-salt-'+n,
    'fictional-demo-hash-'+n,now-100,
  );
  exec('INSERT INTO login_attempts '+
    '(username,failures,first_failed,locked_until) VALUES (?,?,?,?)',
    studentName(2),2,now-300,now+300);
  exec('INSERT INTO unit_accounts '+
    '(username,firebase_uid,password_salt,password_hash,'+
    'created_at,updated_at) VALUES (?,?,?,?,?,?)',
    'test_unit_000000000001',uid(200),
    'cf-chain-v1.'+'a'.repeat(22),
    'a'.repeat(43),now-500,now-300,
  );
  const state=()=>({
    demos:all('SELECT * FROM demo_students ORDER BY username'),
    attempts:all('SELECT * FROM login_attempts ORDER BY username'),
    unit:all('SELECT * FROM unit_accounts ORDER BY username'),
    schema:all("SELECT name,type,sql FROM sqlite_master "+
      "WHERE name IN ('demo_students','login_attempts','unit_accounts') "+
      'ORDER BY name'),
  });
  return {sqlite,exec,get,all,d1,state};
};

test('migration file is additive, named and has no old-table DML or DDL',()=>{
  const sql=migration.replace(/^--.*$/gm,'');
  assert.match(sql,/CREATE TABLE IF NOT EXISTS synthetic_graded_attempts/);
  assert.match(sql,/REFERENCES demo_students\(firebase_uid\) ON DELETE CASCADE/);
  assert.match(sql,/CREATE TRIGGER IF NOT EXISTS synthetic_grade_no_update/);
  assert.match(sql,/CREATE INDEX IF NOT EXISTS synthetic_graded_attempts_by_date/);
  assert.doesNotMatch(sql,
    /\b(?:DROP|ALTER|TRUNCATE|VACUUM|ATTACH|DETACH)\b/i);
  assert.doesNotMatch(sql,
    /\b(?:INSERT\s+INTO|UPDATE\s+\w+|DELETE\s+FROM|REPLACE\s+INTO)\b/i);
  assert.doesNotMatch(sql,/\b(?:PRAGMA|CREATE\s+VIRTUAL|CREATE\s+TEMP)\b/i);
});

test('migration twice leaves existing DEMO, login attempt and unit data EXACTLY intact',()=>{
  const f=make();
  try {
    const before=f.state();
    const namesBefore=f.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    f.sqlite.exec(migration);
    f.sqlite.exec(migration); // safe to retry schema-only migration
    assert.deepEqual(f.state(),before);
    const namesAfter=f.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    const added=namesAfter.map(x=>x.name).filter(name=>
      !namesBefore.some(x=>x.name===name));
    assert.deepEqual(added,['synthetic_graded_attempts']);
    assert.equal(f.get('SELECT COUNT(*) AS n FROM synthetic_graded_attempts').n,0);
    assert.equal(f.get('PRAGMA foreign_keys').foreign_keys,1);
    assert.deepEqual(f.all('PRAGMA foreign_key_check'),[]);
    assert.equal(f.get('PRAGMA integrity_check').integrity_check,'ok');
  }finally{f.sqlite.close();}
});

test('failed transaction rollback restores baseline before any migration commit',()=>{
  const f=make();
  try {
    const before=f.state();
    f.sqlite.exec('BEGIN IMMEDIATE');
    try {
      f.sqlite.exec(migration);
      f.exec('INSERT INTO synthetic_graded_attempts '+
        '(firebase_uid,answer_index,score,submitted_at) VALUES (?,?,?,?)',
        uid(1),1,10,now);
      assert.equal(f.get('SELECT COUNT(*) AS n FROM synthetic_graded_attempts').n,1);
    }finally {
      f.sqlite.exec('ROLLBACK');
    }
    assert.deepEqual(f.state(),before);
    assert.equal(f.get("SELECT COUNT(*) AS n FROM sqlite_master "+
      "WHERE name='synthetic_graded_attempts'").n,0);
    assert.deepEqual(f.all('PRAGMA foreign_key_check'),[]);
    assert.equal(f.get('PRAGMA integrity_check').integrity_check,'ok');
  }finally{f.sqlite.close();}
});

test('missing baseline is rejected instead of generating a shadow demo_students table',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON');
    // SQLite accepts CREATE TABLE with an unresolved foreign table name.
    // Therefore verify prerequisites BEFORE applying this migration.
    assert.equal(db.prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master "+
      "WHERE type='table' AND name='demo_students'"
    ).get().n,0);
    const safePreflight=()=>{
      const found=db.prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master "+
        "WHERE type='table' AND name IN ('demo_students','login_attempts')"
      ).get().n;
      if(found!==2) throw new Error('STAGING_BASE_SCHEMA_NOT_READY');
      db.exec(migration);
    };
    assert.throws(safePreflight,/STAGING_BASE_SCHEMA_NOT_READY/);
    assert.equal(db.prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master "+
      "WHERE type='table' AND name='synthetic_graded_attempts'"
    ).get().n,0);
  }finally{db.close();}
});

test('100 different DEMO students: server scores once and Admin lists exactly 100',async()=>{
  const f=make();
  try {
    for(let n=5;n<=100;n++)f.exec(
      'INSERT INTO demo_students '+
      '(username,firebase_uid,password_salt,password_hash,created_at) '+
      'VALUES (?,?,?,?,?)',
      studentName(n),uid(n),'fictional-salt','fictional-hash',now-100,
    );
    const before=f.state();
    f.sqlite.exec(migration);
    for(let n=1;n<=100;n++){
      const response=await handleDemoQuizStudent(
        f.d1,uid(n),{action:'submit',answerIndex:n%2===0?1:3},
      );
      assert.equal(response.status,200);
      const result=await response.json();
      assert.equal(result.created,true);
      assert.equal(result.attempt.score,n%2===0?10:0);
    }
    const admin=await handleDemoQuizAdmin(f.d1,{action:'list'});
    assert.equal(admin.status,200);
    const {count,attempts}=await admin.json();
    assert.equal(count,100);
    assert.equal(attempts.length,100);
    assert.equal(new Set(attempts.map(x=>x.username)).size,100);
    assert.equal(attempts.filter(x=>x.score===10).length,50);
    assert.equal(attempts.filter(x=>x.score===0).length,50);
    assert.deepEqual(f.state(),before);
    assert.deepEqual(f.all('PRAGMA foreign_key_check'),[]);
    assert.equal(f.get('PRAGMA integrity_check').integrity_check,'ok');
  }finally{f.sqlite.close();}
});

test('synthetic scores cannot overwrite grades; disabled accounts denied on read',async()=>{
  const f=make();
  try {
    f.sqlite.exec(migration);
    const response=await handleDemoQuizStudent(
      f.d1,uid(1),{action:'submit',answerIndex:1});
    assert.equal(response.status,200);
    const stored=f.get(
      'SELECT score FROM synthetic_graded_attempts WHERE firebase_uid=?',
      uid(1));
    assert.equal(stored.score,10);
    assert.throws(()=>f.exec(
      'UPDATE synthetic_graded_attempts SET score=0 WHERE firebase_uid=?',
      uid(1)),/SYNTHETIC_GRADE_IMMUTABLE/);
    f.exec('UPDATE demo_students SET active=0 WHERE firebase_uid=?',uid(1));
    assert.deepEqual(await (
      await handleDemoQuizStudent(f.d1,uid(1),{action:'result'})
    ).json(),{attempt:null});
    f.exec('DELETE FROM demo_students WHERE firebase_uid=?',uid(1));
    assert.equal(f.get('SELECT COUNT(*) AS n FROM synthetic_graded_attempts').n,0);
    assert.deepEqual(f.all('PRAGMA foreign_key_check'),[]);
  }finally{f.sqlite.close();}
});
