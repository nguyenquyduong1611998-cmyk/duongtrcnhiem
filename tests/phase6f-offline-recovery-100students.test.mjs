// Phase 6F: LOCAL backup/restore rehearsal + 100 fake students.
// This is NOT a live load test or confirmation of a Cloudflare D1 backup.
// Uses an isolated temporary SQLite file; never accesses D1 Cloudflare.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {
  readFileSync,copyFileSync,mkdtempSync,rmSync,existsSync,
} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {webcrypto,createHash} from 'node:crypto';
import {handlePhase6StudentExam}
  from '../functions/_shared/phase6-student-timed-exam.mjs';
import {
  handlePhase6StudentHistory,handlePhase6AdminResults,
} from '../functions/_shared/phase6-results-readonly.mjs';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const NOW=1800000000;
const SUBJECT='p6_demo_'+'f'.repeat(32);
const paths=[
  'serverless/d1-staging-schema.sql',
  'serverless/d1-phase4-synthetic-graded-quiz.sql',
  'serverless/d1-phase5-preview-additive-schema.sql',
  'serverless/d1-phase5-preview-synthetic-math-seed.sql',
];
const phase6=[
  'serverless/d1-phase6b-synthetic-admin-drafts-draft.sql',
  'serverless/d1-phase6c-publication-metadata-draft.sql',
  'serverless/d1-phase6-timed-sessions-draft.sql',
  'serverless/d1-phase6d-timed-submissions-draft.sql',
];
const uid=n=>'student_'+n.toString(16).padStart(32,'0');
const username=n=>'test_hv_'+n.toString(16).padStart(12,'0');
const sql=path=>readFileSync(path,'utf8');
const statement=(db,q,...params)=>db.prepare(q).run(...params);
const get=(db,q,...params)=>db.prepare(q).get(...params);
const select=(db,q,...params)=>db.prepare(q).all(...params);
const backup=(db,filename)=>{
  // Name is generated locally in mkdtemp; never accepts external/user input.
  db.exec('VACUUM INTO '+"'"+filename.replaceAll("'","''")+"'");
  assert.ok(existsSync(filename));
};
function d1(db){
  return {
    prepare(query){
      return {
        bind(...args){
          return {
            async first(){return db.prepare(query).get(...args)??null;},
            async all(){return {success:true,results:db.prepare(query).all(...args)};},
            async run(){
              const result=db.prepare(query).run(...args);
              return {success:true,meta:{changes:result.changes}};
            },
          };
        },
        async first(){return db.prepare(query).get()??null;},
        async all(){return {success:true,results:db.prepare(query).all()};},
      };
    },
  };
}
function audit(db){
  assert.equal(get(db,'PRAGMA integrity_check').integrity_check,'ok');
  assert.deepEqual(select(db,'PRAGMA foreign_key_check'),[]);
}
function existingData(db){
  return {
    users:select(db,'SELECT * FROM demo_students ORDER BY firebase_uid'),
    phase4:select(db,'SELECT * FROM synthetic_graded_attempts ORDER BY firebase_uid'),
    phase5:select(db,'SELECT * FROM phase5_content_attempts ORDER BY student_uid'),
    phase5Version:select(db,'SELECT * FROM phase5_content_versions WHERE topic_id=?', 'p5_demo_math'),
  };
}
function seedBaseline(db){
  db.exec('PRAGMA foreign_keys=ON');
  db.function('unixepoch',()=>NOW);
  for(const path of paths)db.exec(sql(path));
  for(let n=1;n<=100;n++)
    statement(db,
      'INSERT INTO demo_students(username,firebase_uid,password_salt,password_hash,kdf_iterations,active,created_at) VALUES (?,?,?,?,310000,1,?)',
      username(n),uid(n),'FAKE_LOCAL_SALT','FAKE_LOCAL_HASH',NOW-1000);
  for(const n of [1,2])
    statement(db,
      "INSERT INTO synthetic_graded_attempts(firebase_uid,quiz_id,answer_index,score,submitted_at,marker) VALUES (?,'synthetic_math_v1',1,10,?,'SYNTHETIC_ONLY')",
      uid(n),NOW-800);
  for(const [n,correct] of [[1,1],[2,0]])
    statement(db,
      "INSERT INTO phase5_content_attempts(attempt_id,student_uid,topic_id,revision,answers_json,correct_count,total_count,score_tenths,started_at,submitted_at,marker) VALUES (?,?,'p5_demo_math',1,?,?,?,?,?,?,'PHASE5_STAGING_MODEL')",
      'p5_demo_phase6f_'+n,uid(n),JSON.stringify({q1:correct}),
      correct,1,correct*100,NOW-700,NOW-700);
  audit(db);
}
function migrateAndPublish(db){
  // Review order mirrors the four offline SQL drafts, NOT applied to D1.
  for(const path of phase6)db.exec(sql(path));
  statement(db,'INSERT INTO phase5_content_topics(topic_id,created_at) VALUES (?,?)',SUBJECT,NOW-600);
  statement(db,
    "INSERT INTO phase5_content_versions(topic_id,revision,code,title,description,time_limit_seconds,state,created_at,published_at) VALUES (?,1,'P6-SYNTHETIC','Toán học DEMO 6F','Math fake only',600,'draft',?,NULL)",
    SUBJECT,NOW-600);
  for(const [id,order,text,correct] of [
    ['q1',1,'2+2?',1],['q2',2,'10-3?',2],
  ]){
    statement(db,
      'INSERT INTO phase5_content_questions(topic_id,revision,question_id,order_index,question_text,option_a,option_b,option_c,option_d) VALUES (?,1,?,?,?,?,?,?,?)',
      SUBJECT,id,order,text,'3','4','7','8');
    statement(db,
      'INSERT INTO phase5_content_answer_keys(topic_id,revision,question_id,correct_index,explanation) VALUES (?,1,?,?,?)',
      SUBJECT,id,correct,'Synthetic math');
  }
  statement(db,
    "UPDATE phase5_content_versions SET state='published',published_at=? WHERE topic_id=? AND revision=1",
    NOW-500,SUBJECT);
  statement(db,
    "INSERT INTO phase6_admin_publications(draft_id,revision,published_at,marker) VALUES (?,1,?,'PHASE6_SYNTHETIC_PUBLICATION')",
    SUBJECT,NOW-500);
  audit(db);
}
const parse=async response=>{
  assert.equal(response.status,200);
  return response.json();
};

test('rehearse isolated SQLite backup, restore, additive migrations and 100 DEMO submissions',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'phase6f-offline-sqlite-'));
  const source=join(directory,'synthetic-source.sqlite');
  const snapshot=join(directory,'synthetic-backup.sqlite');
  const candidate=join(directory,'synthetic-restored-test.sqlite');
  const second=join(directory,'post-submission-backup.sqlite');
  let baseline,restored,recovered;
  try{
    baseline=new DatabaseSync(source);
    seedBaseline(baseline);
    const before=existingData(baseline);
    backup(baseline,snapshot);
    // Baseline snapshot is opened ONLY as a separate copy, never overwritten.
    copyFileSync(snapshot,candidate);
    baseline.close();baseline=null;
    const sourceDigest=createHash('sha256').update(readFileSync(source)).digest('hex');
    restored=new DatabaseSync(candidate);
    restored.exec('PRAGMA foreign_keys=ON');
    restored.function('unixepoch',()=>NOW);
    assert.deepEqual(existingData(restored),before);
    audit(restored);
    migrateAndPublish(restored);
    assert.deepEqual(existingData(restored),before,
      'Phase6A/B/C/D migrations leave Phase4/5 and demo users intact');
    const adapter=d1(restored);

    // 100 asynchronous client operations against one isolated SQLite adapter.
    // No real network latency, Cloudflare worker scheduling or D1 concurrency.
    const students=Array.from({length:100},(_,i)=>i+1);
    const sessions=await Promise.all(students.map(async n=>{
      const r=await handlePhase6StudentExam(adapter,uid(n),
        {action:'start',topicId:SUBJECT,revision:1});
      const body=await parse(r);
      assert.equal(body.session.startedAt,NOW);
      assert.equal(body.session.expiresAt,NOW+600);
      return body.session;
    }));
    assert.equal(new Set(sessions.map(x=>x.sessionId)).size,100);
    const submitted=await Promise.all(students.map(async n=>{
      const answers=n%2===0?{q1:1,q2:2}:{q1:0,q2:0};
      const r=await handlePhase6StudentExam(adapter,uid(n),{
        action:'submit',topicId:SUBJECT,revision:1,
        sessionId:sessions[n-1].sessionId,answers,
      });
      assert.equal(r.status,201);
      return (await r.json()).result;
    }));
    assert.deepEqual(submitted.map(x=>x.score).filter(x=>x===10).length,50);
    assert.equal(submitted.filter(x=>x.score===0).length,50);
    assert.equal(get(restored,'SELECT count(*) AS n FROM phase6_exam_submissions').n,100);
    assert.equal(get(restored,'SELECT count(*) AS n FROM phase6_exam_sessions').n,100);

    // A student can only request her own one submission: no UID filter field.
    const histories=await Promise.all(students.map(async n=>{
      const r=await handlePhase6StudentHistory(adapter,uid(n),{action:'list',offset:0});
      return parse(r);
    }));
    for(let n=1;n<=100;n++){
      assert.equal(histories[n-1].entries.length,1);
      assert.equal(histories[n-1].entries[0].score,n%2===0?10:0);
      assert.equal(JSON.stringify(histories[n-1]).includes(uid(n)),false);
    }
    const admin=await parse(await handlePhase6AdminResults(adapter,{action:'summary'}));
    assert.deepEqual(admin.summary,{
      attemptCount:100,studentCount:100,averageScore:5,maxScore:10,
    });
    const pages=await Promise.all([0,25,50,75].map(async offset=>
      parse(await handlePhase6AdminResults(adapter,{action:'list',offset}))));
    assert.deepEqual(pages.map(p=>p.entries.length),[25,25,25,25]);
    assert.deepEqual(pages.map(p=>p.nextOffset),[25,50,75,null]);
    assert.equal(new Set(pages.flatMap(p=>p.entries.map(x=>x.username))).size,100);
    const adminBody=JSON.stringify({admin,pages});
    for(const secret of ['answers_json','correct_index','student_uid',
      'firebase_uid','password_hash','session_id','FAKE_LOCAL_HASH'])
      assert.equal(adminBody.includes(secret),false,secret);

    assert.deepEqual(existingData(restored),before);
    assert.throws(()=>statement(restored,
      'UPDATE phase6_exam_submissions SET score_tenths=0'),/IMMUTABLE/);
    assert.throws(()=>statement(restored,
      'UPDATE phase6_exam_sessions SET expires_at=expires_at+600'),/IMMUTABLE/);
    audit(restored);
    backup(restored,second);
    restored.close();restored=null;
    recovered=new DatabaseSync(second,{readOnly:true});
    assert.equal(get(recovered,'PRAGMA integrity_check').integrity_check,'ok');
    assert.deepEqual(select(recovered,'PRAGMA foreign_key_check'),[]);
    assert.deepEqual(existingData(recovered),before);
    assert.equal(get(recovered,
      'SELECT count(*) AS n FROM phase6_exam_submissions').n,100);
    // Simulated migrations/100 student tests did not modify source file.
    assert.equal(createHash('sha256').update(readFileSync(source)).digest('hex'),
      sourceDigest);
  }finally{
    if(recovered)recovered.close();
    if(restored)restored.close();
    if(baseline)baseline.close();
    rmSync(directory,{recursive:true,force:true});
  }
});

test('all Phase6 migrations remain additive drafts; no destructive operations on old tables',()=>{
  for(const path of phase6){
    const withoutComments=sql(path).replace(/^--.*$/gm,'');
    assert.match(withoutComments,/CREATE TABLE IF NOT EXISTS/);
    assert.doesNotMatch(withoutComments,
      /\b(?:DROP\s+TABLE|ALTER\s+TABLE|TRUNCATE|ATTACH\s+DATABASE|DETACH\s+DATABASE|VACUUM)\b/i);
    assert.doesNotMatch(withoutComments,
      /\b(?:DELETE\s+FROM|UPDATE)\s+(?:demo_students|login_attempts|synthetic_graded_attempts|phase5_content_attempts)\b/i);
  }
});
