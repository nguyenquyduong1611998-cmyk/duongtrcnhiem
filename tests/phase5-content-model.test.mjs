// PHASE 5 isolated, synthetic-only rehearsal. NEVER touches Cloudflare or Firebase.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {projectPublishedTopic} from '../functions/_shared/phase5-public-content.mjs';

const SCHEMA=readFileSync('serverless/d1-phase5-content-model-draft.sql','utf8');
const TOPIC='p5_demo_math';
const UID='student_'+'a'.repeat(32);
const NOW=1764038400;
function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON;');
  db.exec(SCHEMA);
  const run=(sql,...args)=>db.prepare(sql).run(...args);
  const one=(sql,...args)=>db.prepare(sql).get(...args);
  run('INSERT INTO phase5_content_topics(topic_id,created_at) VALUES (?,?)',TOPIC,NOW);
  const version=(revision=1,state='draft')=>run(
    'INSERT INTO phase5_content_versions '+
    '(topic_id,revision,code,title,description,time_limit_seconds,state,created_at,published_at) '+
    'VALUES (?,?,?,?,?,?,?,?,?)',
    TOPIC,revision,'P5-DEMO','Synthetic arithmetic','Not a real examination',
    600,state,NOW,state==='draft'?null:NOW+1
  );
  const question=(revision=1,id='q1',order=1)=>run(
    'INSERT INTO phase5_content_questions '+
    '(topic_id,revision,question_id,order_index,question_text,option_a,option_b,option_c,option_d) '+
    'VALUES (?,?,?,?,?,?,?,?,?)',
    TOPIC,revision,id,order,'2 + 2 = ?','3','4','5','6'
  );
  const answer=(revision=1,id='q1')=>run(
    'INSERT INTO phase5_content_answer_keys '+
    '(topic_id,revision,question_id,correct_index,explanation) VALUES (?,?,?,?,?)',
    TOPIC,revision,id,1,'Synthetic key for tests only'
  );
  const publish=(revision=1)=>run(
    "UPDATE phase5_content_versions SET state='published',published_at=? WHERE topic_id=? AND revision=?",
    NOW+1,TOPIC,revision
  );
  const attempt=(uid=UID,revision=1,id='attempt-demo-0001')=>run(
    'INSERT INTO phase5_content_attempts '+
    '(attempt_id,student_uid,topic_id,revision,answers_json,correct_count,total_count,'+
    'score_tenths,started_at,submitted_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    id,uid,TOPIC,revision,JSON.stringify({q1:1}),1,1,100,NOW+2,NOW+4
  );
  return {db,run,one,version,question,answer,publish,attempt};
}

test('empty schema is isolated from prior Phase 4 tables and does not write data',()=>{
  const f=fixture();
  try{
    const existing=f.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name);
    assert.equal(existing.some(n=>n==='demo_students'||n==='synthetic_graded_attempts'||n==='unit_accounts'),false);
    assert.equal(f.one('SELECT count(*) AS n FROM phase5_content_attempts').n,0);
    assert.equal(f.one('PRAGMA foreign_key_check')??null,null);
  }finally{f.db.close();}
});

test('publishing needs all answer keys; published question and answer are immutable',()=>{
  const f=fixture();
  try{
    f.version();f.question();
    assert.throws(()=>f.publish(),/PHASE5_KEYS_INCOMPLETE/);
    f.answer();f.publish();
    assert.equal(f.one(
      'SELECT state FROM phase5_content_versions WHERE topic_id=? AND revision=1',TOPIC
    ).state,'published');
    assert.throws(()=>f.run(
      "UPDATE phase5_content_questions SET question_text='tampered' WHERE topic_id=? AND revision=1",TOPIC
    ),/PHASE5_PUBLISHED_QUESTIONS_IMMUTABLE/);
    assert.throws(()=>f.run(
      'UPDATE phase5_content_answer_keys SET correct_index=0 WHERE topic_id=? AND revision=1',TOPIC
    ),/PHASE5_PUBLISHED_KEYS_IMMUTABLE/);
    assert.throws(()=>f.run(
      'DELETE FROM phase5_content_answer_keys WHERE topic_id=? AND revision=1',TOPIC
    ),/PHASE5_PUBLISHED_KEYS_IMMUTABLE/);
    assert.throws(()=>f.run(
      "UPDATE phase5_content_versions SET title='Changed' WHERE topic_id=? AND revision=1",TOPIC
    ),/PHASE5_PUBLISHED_VERSION_IMMUTABLE/);
    assert.throws(()=>f.question(1,'q2',2),/PHASE5_PUBLISHED_QUESTIONS_IMMUTABLE/);
    assert.throws(()=>f.answer(1,'q2'),/constraint|FOREIGN KEY|PHASE5/);
    f.version(2);f.question(2);f.answer(2);f.publish(2);
    assert.equal(f.one("SELECT count(*) AS n FROM phase5_content_versions WHERE state='published'").n,2);
    assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{f.db.close();}
});

test('only a published version accepts one immutable submission per UID',()=>{
  const f=fixture();
  try{
    f.version();f.question();f.answer();
    assert.throws(()=>f.attempt(),/PHASE5_REVISION_NOT_PUBLISHED/);
    f.publish();f.attempt();
    assert.equal(f.one('SELECT score_tenths FROM phase5_content_attempts WHERE student_uid=?',UID).score_tenths,100);
    assert.throws(()=>f.run(
      'INSERT INTO phase5_content_attempts (attempt_id,student_uid,topic_id,revision,'+
      'answers_json,correct_count,total_count,score_tenths,started_at,submitted_at) '+
      'VALUES (?,?,?,?,?,?,?,?,?,?)',
      'attempt-demo-invalid','student_'+'b'.repeat(32),TOPIC,1,
      JSON.stringify({q1:0}),0,1,100,NOW+2,NOW+4
    ),/CHECK constraint failed/);
    assert.throws(()=>f.attempt(UID,1,'attempt-demo-0002'),/UNIQUE constraint failed/);
    assert.throws(()=>f.run("UPDATE phase5_content_attempts SET score_tenths=0"),/PHASE5_ATTEMPT_IMMUTABLE/);
    assert.throws(()=>f.run("DELETE FROM phase5_content_attempts"),/PHASE5_ATTEMPT_IMMUTABLE/);
    assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{f.db.close();}
});

test('public projection never includes correctIndex, explanation, key, score, or personal data',()=>{
  const f=fixture();
  try{
    f.version();f.question();f.answer();f.publish();
    const version=f.one('SELECT * FROM phase5_content_versions WHERE topic_id=? AND revision=1',TOPIC);
    const q=f.one('SELECT * FROM phase5_content_questions WHERE topic_id=? AND revision=1',TOPIC);
    const privateAnswer=f.one('SELECT * FROM phase5_content_answer_keys WHERE topic_id=? AND revision=1',TOPIC);
    const projected=projectPublishedTopic(version,[{...q,...privateAnswer,
      candidateName:'Should never be sent',password:'Never sent',score:10}]);
    assert.deepEqual(projected.questions[0],{
      id:'q1',orderIndex:1,text:'2 + 2 = ?',options:['3','4','5','6']
    });
    const body=JSON.stringify(projected);
    for(const forbidden of ['correctIndex','correct_index','explanation','password','candidateName','score','answer_keys']){
      assert.equal(body.includes(forbidden),false,forbidden);
    }
    assert.throws(()=>projectPublishedTopic({...version,state:'draft'},[q]),/NOT_PUBLISHABLE/);
    assert.throws(()=>projectPublishedTopic(version,[]),/QUESTIONS_INVALID/);
  }finally{f.db.close();}
});
