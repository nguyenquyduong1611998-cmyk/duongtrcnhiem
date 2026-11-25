// PHASE 5D (PREPARATION) — synthetic-only, server-owned grade on Preview D1.
// The Cloudflare API requires a SECOND default-OFF flag before any write.
// Never import this file into Vite/browser or expose answer-key rows.
// No timed session/start route: started_at == submitted_at is a server timestamp.
// NOT a production exam engine, real grade, or time-enforced assessment.
import {json} from './auth.mjs';

const STUDENT_UID=/^student_[a-f0-9]{32}$/;
const QUESTION_ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const TOPIC_ID='p5_demo_math';
const REVISION=1;
const MARKER='PHASE5_STAGING_MODEL';

const QUESTION_KEYS_SQL=[
  'SELECT q.question_id,q.order_index,k.correct_index',
  'FROM phase5_content_questions q',
  'JOIN phase5_content_answer_keys k',
  '  ON k.topic_id=q.topic_id AND k.revision=q.revision',
  ' AND k.question_id=q.question_id',
  'JOIN phase5_content_versions v',
  '  ON v.topic_id=q.topic_id AND v.revision=q.revision',
  "WHERE q.topic_id=? AND q.revision=? AND v.state='published'",
  'ORDER BY q.order_index ASC LIMIT 501',
].join(' ');
const SELECT_OWN_ATTEMPT=[
  'SELECT a.student_uid,a.topic_id,a.revision,a.answers_json,',
  'a.correct_count,a.total_count,a.score_tenths,a.submitted_at,a.marker',
  'FROM phase5_content_attempts a',
  'JOIN demo_students s ON s.firebase_uid=a.student_uid AND s.active=1',
  'WHERE a.student_uid=? AND a.topic_id=? AND a.revision=? LIMIT 1',
].join(' ');
const INSERT_ATTEMPT=[
  'INSERT INTO phase5_content_attempts',
  '(attempt_id,student_uid,topic_id,revision,answers_json,',
  'correct_count,total_count,score_tenths,started_at,submitted_at,marker)',
  'SELECT ?,?,?,?,?,?,?,?,?,?,?',
  'WHERE EXISTS (SELECT 1 FROM demo_students',
  '  WHERE firebase_uid=? AND active=1)',
  'AND EXISTS (SELECT 1 FROM phase5_content_versions',
  "  WHERE topic_id=? AND revision=? AND state='published')",
  'ON CONFLICT(student_uid,topic_id,revision) DO NOTHING',
].join(' ');

function exact(raw,keys){
  return raw!==null&&typeof raw==='object'&&!Array.isArray(raw)&&
    Object.keys(raw).sort().join(',')===keys.slice().sort().join(',');
}
function validTarget(data){
  return data.topicId===TOPIC_ID&&data.revision===REVISION;
}
function parseStoredAttempt(row,uid){
  if(!row)return null;
  if(row.student_uid!==uid||row.topic_id!==TOPIC_ID||
    row.revision!==REVISION||row.marker!==MARKER||
    !Number.isSafeInteger(row.correct_count)||
    !Number.isSafeInteger(row.total_count)||
    row.total_count<1||row.total_count>500||
    row.correct_count<0||row.correct_count>row.total_count||
    !Number.isSafeInteger(row.score_tenths)||
    row.score_tenths!==Math.round(row.correct_count*100/row.total_count)||
    !Number.isSafeInteger(row.submitted_at)||row.submitted_at<=0)
    throw new Error('PHASE5_STORED_ATTEMPT_INVALID');
  let answers;
  try{answers=JSON.parse(row.answers_json);}catch{throw new Error('PHASE5_STORED_ANSWERS_INVALID');}
  if(!answers||typeof answers!=='object'||Array.isArray(answers)||
    Object.keys(answers).length!==row.total_count||
    !Object.entries(answers).every(([id,index])=>
      QUESTION_ID.test(id)&&Number.isSafeInteger(index)&&index>=0&&index<=3))
    throw new Error('PHASE5_STORED_ANSWERS_INVALID');
  // Responses NEVER include the answer choices, key, or explanation.
  return {
    attempt:{
      topicId:TOPIC_ID,revision:REVISION,
      correctCount:row.correct_count,totalCount:row.total_count,
      score:row.score_tenths/10,maxScore:10,
      submittedAt:row.submitted_at,
      mode:'phase5-synthetic-server-graded',
    },
    answers,
  };
}
async function readOwn(db,uid){
  const row=await db.prepare(SELECT_OWN_ATTEMPT)
    .bind(uid,TOPIC_ID,REVISION).first();
  return parseStoredAttempt(row,uid);
}
async function readKeys(db){
  const rows=await db.prepare(QUESTION_KEYS_SQL).bind(TOPIC_ID,REVISION).all();
  if(!Array.isArray(rows?.results)||rows.results.length<1||rows.results.length>500)
    throw new Error('PHASE5_PUBLISHED_KEYS_NOT_READY');
  const ids=new Set(),orders=new Set();
  for(const r of rows.results){
    if(!QUESTION_ID.test(r?.question_id||'')||
       !Number.isSafeInteger(r?.order_index)||r.order_index<1||
       r.order_index>500||!Number.isSafeInteger(r?.correct_index)||
       r.correct_index<0||r.correct_index>3||
       ids.has(r.question_id)||orders.has(r.order_index))
      throw new Error('PHASE5_KEYS_INVALID');
    ids.add(r.question_id);orders.add(r.order_index);
  }
  return rows.results;
}
function canonicalAnswerMap(raw,questions){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
     Object.keys(raw).length!==questions.length)
    return null;
  const canonical={};
  for(const q of questions){
    if(!Object.hasOwn(raw,q.question_id)||
      !Number.isSafeInteger(raw[q.question_id])||
      raw[q.question_id]<0||raw[q.question_id]>3) return null;
    canonical[q.question_id]=raw[q.question_id];
  }
  return canonical;
}

export async function handlePhase5SyntheticStudent(db,uid,data){
  if(!db?.prepare||!STUDENT_UID.test(uid||''))
    return json({error:'UNAUTHORIZED'},401);
  const resultRequest=exact(data,['action','topicId','revision'])&&
    data.action==='result'&&validTarget(data);
  const submitRequest=exact(data,['action','topicId','revision','answers'])&&
    data.action==='submit'&&validTarget(data);
  if(!resultRequest&&!submitRequest)
    return json({error:'INVALID_REQUEST'},400);

  if(resultRequest){
    const prior=await readOwn(db,uid);
    return json({attempt:prior?.attempt??null});
  }
  // Idempotency is based on the D1 uniqueness constraint; a second
  // browser cannot overwrite the stored score even after a lost response.
  const existing=await readOwn(db,uid);
  if(existing){
    const given=canonicalAnswerMap(data.answers,await readKeys(db));
    if(!given)return json({error:'INVALID_REQUEST'},400);
    if(JSON.stringify(given)!==JSON.stringify(existing.answers))
      return json({error:'ALREADY_SUBMITTED',attempt:existing.attempt},409);
    return json({attempt:existing.attempt,created:false});
  }
  const questions=await readKeys(db);
  const answers=canonicalAnswerMap(data.answers,questions);
  if(!answers)return json({error:'INVALID_REQUEST'},400);
  const correctCount=questions.reduce((n,q)=>
    n+(answers[q.question_id]===q.correct_index?1:0),0);
  const totalCount=questions.length;
  const scoreTenths=Math.round(correctCount*100/totalCount);
  const submittedAt=Math.floor(Date.now()/1000);
  if(!Number.isSafeInteger(submittedAt)||submittedAt<=0)
    throw new Error('PHASE5_INVALID_SERVER_CLOCK');
  // Random ID is not provided by the browser; no client UID or grade trusted.
  const attemptId='p5_demo_'+crypto.randomUUID();
  const inserted=await db.prepare(INSERT_ATTEMPT).bind(
    attemptId,uid,TOPIC_ID,REVISION,JSON.stringify(answers),
    correctCount,totalCount,scoreTenths,submittedAt,submittedAt,MARKER,
    uid,TOPIC_ID,REVISION,
  ).run();
  if(inserted?.success!==true||
     !Number.isSafeInteger(inserted.meta?.changes)||
     (inserted.meta.changes!==0&&inserted.meta.changes!==1))
    throw new Error('PHASE5_D1_WRITE_UNCONFIRMED');
  const saved=await readOwn(db,uid);
  if(!saved)return json({error:'NOT_AVAILABLE'},403);
  if(JSON.stringify(answers)!==JSON.stringify(saved.answers))
    return json({error:'ALREADY_SUBMITTED',attempt:saved.attempt},409);
  return json({attempt:saved.attempt,created:inserted.meta.changes===1});
}
