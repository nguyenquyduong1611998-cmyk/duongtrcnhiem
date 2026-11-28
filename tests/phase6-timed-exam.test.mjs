// Phase 6A: offline synthetic maths; NEVER connects to Cloudflare or Firebase.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {
  validatePublishedExamDefinition,buildServerExamSession,
  assertServerSubmissionWithinDeadline,gradeAnswersOnServer,
} from '../functions/_shared/phase6-timed-exam.mjs';

const UID_A='student_'+'a'.repeat(32);
const UID_B='student_'+'b'.repeat(32);
const VERSION={topic_id:'p6_demo_math',revision:1,state:'published',time_limit_seconds:1800};
const SESSION_ID='session_demo_00001';
const definition=()=>validatePublishedExamDefinition(VERSION,2);
const makeSession=(nowSeconds=1764038400)=>buildServerExamSession({
  definition:definition(),verifiedStudentUid:UID_A,sessionId:SESSION_ID,nowSeconds,
});

test('published exam sets server-owned duration, count and 10-point policy',()=>{
  assert.deepEqual(definition(),{
    topicId:'p6_demo_math',revision:1,timeLimitSeconds:1800,questionCount:2,maxScore:10,
  });
  for(const seconds of [60,600,14400])
    assert.equal(validatePublishedExamDefinition({...VERSION,time_limit_seconds:seconds},1).timeLimitSeconds,seconds);
  for(const seconds of [0,30,61,14401,1.5,NaN])
    assert.throws(()=>validatePublishedExamDefinition({...VERSION,time_limit_seconds:seconds},2),/DEFINITION_INVALID/);
  for(const count of [0,501,2.5,NaN])
    assert.throws(()=>validatePublishedExamDefinition(VERSION,count),/DEFINITION_INVALID/);
  assert.throws(()=>validatePublishedExamDefinition({...VERSION,state:'draft'},2),/DEFINITION_INVALID/);
});

test('verified UID and trusted seconds produce immutable deadline; no client time',()=>{
  const s=makeSession();
  assert.equal(s.expiresAt-s.startedAt,1800);
  assert.equal(s.studentUid,UID_A);
  assert(Object.isFrozen(s));
  assert.throws(()=>buildServerExamSession({definition:definition(),verifiedStudentUid:'student_fake',sessionId:SESSION_ID,nowSeconds:1764038400}),/SESSION_INVALID/);
  assert.throws(()=>buildServerExamSession({definition:{...definition(),timeLimitSeconds:1801},verifiedStudentUid:UID_A,sessionId:SESSION_ID,nowSeconds:1764038400}),/SESSION_INVALID/);
});

test('submission allows exact deadline, denies other UID, early and late submissions',()=>{
  const s=makeSession();
  assert.equal(assertServerSubmissionWithinDeadline(s,UID_A,s.startedAt),true);
  assert.equal(assertServerSubmissionWithinDeadline(s,UID_A,s.expiresAt),true);
  assert.throws(()=>assertServerSubmissionWithinDeadline(s,UID_A,s.expiresAt+1),/DEADLINE_EXPIRED/);
  assert.throws(()=>assertServerSubmissionWithinDeadline(s,UID_B,s.startedAt+1),/FORBIDDEN/);
  assert.throws(()=>assertServerSubmissionWithinDeadline(s,UID_A,s.startedAt-1),/NOT_STARTED/);
  assert.throws(()=>assertServerSubmissionWithinDeadline({...s,expiresAt:s.expiresAt+10},UID_A,s.startedAt),/SESSION_INVALID/);
});

test('server owns answer keys and score; reject forged or incomplete answer map',()=>{
  const keys=[{question_id:'q1',correct_index:1},{question_id:'q2',correct_index:0}];
  assert.deepEqual(gradeAnswersOnServer(keys,{q1:1,q2:0}),{
    correctCount:2,totalCount:2,scoreTenths:100,score:10,maxScore:10,
  });
  assert.equal(gradeAnswersOnServer(keys,{q1:1,q2:3}).score,5);
  assert.equal(gradeAnswersOnServer(keys,{q1:2,q2:3}).score,0);
  for(const invalid of [{q1:1},{q1:1,q2:0,uid:UID_B},{q1:1,q2:4},{q1:1,q2:0.5},null])
    assert.throws(()=>gradeAnswersOnServer(keys,invalid),/ANSWERS_INVALID/);
  assert.throws(()=>gradeAnswersOnServer([...keys,keys[0]],{q1:1,q2:0,q3:0}),/PRIVATE_KEYS_INVALID/);
  const body=JSON.stringify(gradeAnswersOnServer(keys,{q1:1,q2:0}));
  for(const forbidden of ['question_id','correct_index','studentUid','answers','explanation'])
    assert.equal(body.includes(forbidden),false);
});

test('draft SQL: published-only immutable one-session-per-student; no Phase5 score mutation',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec('PRAGMA foreign_keys=ON');
    db.exec(readFileSync('serverless/d1-phase5-preview-additive-schema.sql','utf8'));
    db.exec(readFileSync('serverless/d1-phase6-timed-sessions-draft.sql','utf8'));
    const run=(sql,...args)=>db.prepare(sql).run(...args);
    const t=Number(db.prepare('SELECT unixepoch() AS t').get().t);
    run('INSERT INTO phase5_content_topics(topic_id,created_at) VALUES (?,?)',VERSION.topic_id,t-100);
    run('INSERT INTO phase5_content_versions(topic_id,revision,code,title,description,time_limit_seconds,state,created_at,published_at) VALUES (?,?,?,?,?,?,?,?,?)',
      VERSION.topic_id,1,'P6-DEMO','Synthetic math','Fake only',1800,'draft',t-100,null);
    for(const [id,ord] of [['q1',1],['q2',2]]){
      run('INSERT INTO phase5_content_questions(topic_id,revision,question_id,order_index,question_text,option_a,option_b,option_c,option_d) VALUES (?,?,?,?,?,?,?,?,?)',VERSION.topic_id,1,id,ord,'2+2','1','2','3','4');
      run('INSERT INTO phase5_content_answer_keys(topic_id,revision,question_id,correct_index,explanation) VALUES (?,?,?,?,?)',VERSION.topic_id,1,id,1,'Fake');
    }
    const insert=(session,uid=UID_A)=>run('INSERT INTO phase6_exam_sessions(session_id,student_uid,topic_id,revision,question_count,time_limit_seconds,started_at,expires_at) VALUES (?,?,?,?,?,?,?,?)',
      session.sessionId,uid,session.topicId,session.revision,session.questionCount,session.timeLimitSeconds,session.startedAt,session.expiresAt);
    const session=makeSession(t);
    assert.throws(()=>insert(session),/PHASE6_PUBLISHED_EXAM_MISMATCH/);
    run("UPDATE phase5_content_versions SET state='published',published_at=? WHERE topic_id=? AND revision=1",t-50,VERSION.topic_id);
    assert.equal(insert(session).changes,1);
    assert.throws(()=>insert({...session,sessionId:'session_demo_00002'}),/UNIQUE constraint failed/);
    assert.throws(()=>insert({...session,sessionId:'session_demo_00003',timeLimitSeconds:1200,expiresAt:t+1200},UID_B),/PHASE6_PUBLISHED_EXAM_MISMATCH/);
    assert.throws(()=>insert({...session,sessionId:'session_demo_00004',questionCount:1},UID_B),/PHASE6_PUBLISHED_EXAM_MISMATCH/);
    assert.throws(()=>insert({...session,sessionId:'session_demo_00005',startedAt:t-1000,expiresAt:t+800},UID_B),/PHASE6_SERVER_TIME_REQUIRED/);
    assert.throws(()=>run('UPDATE phase6_exam_sessions SET expires_at=expires_at+10'),/PHASE6_SESSION_IMMUTABLE/);
    assert.throws(()=>run('DELETE FROM phase6_exam_sessions'),/PHASE6_SESSION_IMMUTABLE/);
    assert.equal(db.prepare('SELECT count(*) AS n FROM phase5_content_attempts').get().n,0);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{db.close();}
});
