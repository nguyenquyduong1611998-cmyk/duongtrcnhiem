// Phase 5: validate the exact manual Preview-only schema in isolated SQLite.
// Never connects to Cloudflare; synthetic data only; neither the real D1 nor
// the user's confidential backup is ever opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

const schema=readFileSync('serverless/d1-phase5-preview-additive-schema.sql','utf8');
const draft=readFileSync('serverless/d1-phase5-content-model-draft.sql','utf8');
const base=readFileSync('serverless/d1-staging-schema.sql','utf8');
const quiz=readFileSync('serverless/d1-phase4-synthetic-graded-quiz.sql','utf8');
const seed=readFileSync('serverless/d1-phase5-preview-synthetic-math-seed.sql','utf8');
const uid='student_'+'a'.repeat(32);

function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(base);
  db.exec(quiz);
  db.prepare('INSERT INTO demo_students (username,firebase_uid,password_salt,'+
    'password_hash,kdf_iterations,active,created_at) VALUES (?,?,?,?,310000,1,?)')
    .run('test_hv_aaaaaaaaaaaa',uid,'synthetic_salt','synthetic_hash',1800000000);
  db.prepare('INSERT INTO synthetic_graded_attempts (firebase_uid,answer_index,'+
    'score,submitted_at) VALUES (?,1,10,?)').run(uid,1800000000);
  db.prepare('INSERT INTO login_attempts '+
    '(username,failures,first_failed,locked_until) VALUES (?,2,?,?)')
    .run('test_hv_aaaaaaaaaaaa',1800000000,1800000100);
  const state=()=>({
    students:db.prepare('SELECT * FROM demo_students').all(),
    failedLogins:db.prepare('SELECT * FROM login_attempts').all(),
    scores:db.prepare('SELECT * FROM synthetic_graded_attempts').all(),
  });
  return {db,state};
}

test('exact additive Preview file matches reviewed draft schema, excluding disclaimers',()=>{
  const draftSQL=draft.slice(draft.indexOf('CREATE TABLE IF NOT EXISTS phase5_content_topics'));
  const candidateSQL=schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS phase5_content_topics'));
  assert.equal(candidateSQL,draftSQL,'Do not silently modify reviewed schema');
  assert.match(schema,/duongtrcnhiem-auth-preview/);
  assert.match(schema,/DO NOT EXECUTE UNTIL/);
  assert.equal((candidateSQL.match(/CREATE TABLE IF NOT EXISTS/g)||[]).length,5);
  assert.ok((candidateSQL.match(/CREATE TRIGGER IF NOT EXISTS/g)||[]).length>=10);
  assert.doesNotMatch(candidateSQL,/^\s*(?:DROP|DELETE|ALTER|UPDATE|INSERT|REPLACE|ATTACH|DETACH|VACUUM|PRAGMA)\s/mi);
  assert.doesNotMatch(candidateSQL,/\b(?:demo_students|login_attempts|synthetic_graded_attempts|unit_accounts|_cf_KV)\b/i);
});

test('schema is additive, leaves all three existing DEMO tables and rows intact',()=>{
  const f=fixture();
  try{
    const before=f.state();
    const schemaBefore=f.db.prepare("SELECT name,sql,type FROM sqlite_master "+
      "WHERE name IN ('demo_students','login_attempts','synthetic_graded_attempts') "+
      'ORDER BY name').all();
    f.db.exec(schema);
    assert.deepEqual(f.state(),before);
    const schemaAfter=f.db.prepare("SELECT name,sql,type FROM sqlite_master "+
      "WHERE name IN ('demo_students','login_attempts','synthetic_graded_attempts') "+
      'ORDER BY name').all();
    assert.deepEqual(schemaAfter,schemaBefore);
    const newTables=f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' "+
      "AND name LIKE 'phase5_content_%' ORDER BY name").all().map(x=>x.name);
    assert.deepEqual(newTables,[
      'phase5_content_answer_keys','phase5_content_attempts',
      'phase5_content_questions','phase5_content_topics','phase5_content_versions'
    ]);
    for(const t of newTables){
      assert.equal(f.db.prepare('SELECT count(*) AS n FROM '+t).get().n,0);
    }
    assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0);
    assert.equal(f.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    f.db.exec(schema);
    assert.deepEqual(f.state(),before);
    assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{f.db.close();}
});

test('later one-time fake math seed changes only Phase5 tables, never DEMO data',()=>{
  const f=fixture();
  try{
    const before=f.state();
    f.db.exec(schema);
    f.db.exec(seed);
    assert.deepEqual(f.state(),before);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM phase5_content_topics').get().n,1);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM phase5_content_questions').get().n,1);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM phase5_content_answer_keys').get().n,1);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM phase5_content_attempts').get().n,0);
    const v=f.db.prepare("SELECT state FROM phase5_content_versions").get();
    assert.equal(v.state,'published');
    assert.throws(()=>f.db.prepare(
      "UPDATE phase5_content_answer_keys SET correct_index=0").run(),
      /PHASE5_PUBLISHED_KEYS_IMMUTABLE/);
    assert.throws(()=>f.db.prepare(
      "UPDATE phase5_content_versions SET state='draft'").run(),
      /PHASE5_PUBLISHED_VERSION_IMMUTABLE/);
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{f.db.close();}
});
