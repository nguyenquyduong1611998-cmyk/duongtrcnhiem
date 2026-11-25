// Phase 6D: STUDENT ONLY, synthetic math on the pinned Preview, OFF by default.
// All deadlines and submitted_at are D1 unixepoch(), not browser Date.now().
// D1's INSERT guard and trigger enforce ownership and deadline atomically.
// No Phase 5 submissions are modified and no private keys leave this module.
import {json} from './auth.mjs';
import {
  validatePublishedExamDefinition,gradeAnswersOnServer,
} from './phase6-timed-exam.mjs';
import {projectPublishedTopic} from './phase5-public-content.mjs';

const UID=/^student_[a-f0-9]{32}$/;
const TOPIC=/^p6_demo_[a-f0-9]{32}$/;
const SESSION_ID=/^p6_session_[a-f0-9]{32}$/;
const SESSION_MARKER='PHASE6_PREVIEW_DRAFT';
const SUBMISSION_MARKER='PHASE6_SYNTHETIC_SUBMISSION';
const MAX_QUESTIONS=12;
const LIST_SQL=[
  'SELECT v.topic_id,v.revision,v.title,v.time_limit_seconds,',
  '(SELECT count(*) FROM phase5_content_questions q',
  ' WHERE q.topic_id=v.topic_id AND q.revision=v.revision) AS question_count',
  'FROM phase5_content_versions v JOIN phase6_admin_publications p',
  'ON p.draft_id=v.topic_id AND p.revision=v.revision',
  "WHERE v.state='published' AND v.topic_id GLOB 'p6_demo_*'",
  'AND v.revision=(SELECT max(p2.revision) FROM phase6_admin_publications p2',
  'WHERE p2.draft_id=v.topic_id)',
  'ORDER BY v.topic_id ASC LIMIT 101',
].join(' ');
const VERSION_SQL=[
  'SELECT v.topic_id,v.revision,v.code,v.title,v.description,',
  'v.time_limit_seconds,v.state,',
  '(SELECT count(*) FROM phase5_content_questions q',
  'WHERE q.topic_id=v.topic_id AND q.revision=v.revision) AS question_count',
  'FROM phase5_content_versions v JOIN phase6_admin_publications p',
  'ON p.draft_id=v.topic_id AND p.revision=v.revision',
  "WHERE v.topic_id=? AND v.revision=? AND v.state='published' LIMIT 1",
].join(' ');
const QUESTIONS_SQL=[
  'SELECT topic_id,revision,question_id,order_index,question_text,',
  'option_a,option_b,option_c,option_d FROM phase5_content_questions',
  'WHERE topic_id=? AND revision=? ORDER BY order_index ASC LIMIT 13',
].join(' ');
const SESSION_SQL=[
  'SELECT session_id,student_uid,topic_id,revision,question_count,',
  'time_limit_seconds,started_at,expires_at,marker',
  'FROM phase6_exam_sessions WHERE student_uid=? AND topic_id=?',
  'AND revision=? LIMIT 1',
].join(' ');
const SUBMISSION_SQL=[
  'SELECT a.session_id,a.student_uid,a.topic_id,a.revision,a.answers_json,',
  'a.correct_count,a.total_count,a.score_tenths,a.submitted_at,a.marker',
  'FROM phase6_exam_submissions a JOIN phase6_exam_sessions s',
  'ON s.session_id=a.session_id AND s.student_uid=a.student_uid',
  'WHERE a.student_uid=? AND a.topic_id=? AND a.revision=? LIMIT 1',
].join(' ');
const KEYS_SQL=[
  'SELECT k.question_id,k.correct_index FROM phase5_content_answer_keys k',
  'JOIN phase5_content_questions q ON q.topic_id=k.topic_id',
  'AND q.revision=k.revision AND q.question_id=k.question_id',
  'WHERE k.topic_id=? AND k.revision=?',
  'ORDER BY q.order_index ASC LIMIT 13',
].join(' ');
const DB_NOW_SQL='SELECT unixepoch() AS now';
const START_SQL=[
  'INSERT INTO phase6_exam_sessions',
  '(session_id,student_uid,topic_id,revision,question_count,',
  'time_limit_seconds,started_at,expires_at,marker)',
  'SELECT ?,?,v.topic_id,v.revision,',
  '(SELECT count(*) FROM phase5_content_questions q',
  'WHERE q.topic_id=v.topic_id AND q.revision=v.revision),',
  "v.time_limit_seconds,unixepoch(),unixepoch()+v.time_limit_seconds,'PHASE6_PREVIEW_DRAFT'",
  'FROM phase5_content_versions v',
  'JOIN phase6_admin_publications p ON p.draft_id=v.topic_id AND p.revision=v.revision',
  'JOIN demo_students d ON d.firebase_uid=? AND d.active=1',
  "WHERE v.topic_id=? AND v.revision=? AND v.state='published'",
  'ON CONFLICT(student_uid,topic_id,revision) DO NOTHING',
].join(' ');
const SUBMIT_SQL=[
  'INSERT INTO phase6_exam_submissions',
  '(submission_id,session_id,student_uid,topic_id,revision,answers_json,',
  'correct_count,total_count,score_tenths,submitted_at,marker)',
  'SELECT ?,s.session_id,s.student_uid,s.topic_id,s.revision,',
  "?,?,?,?,unixepoch(),'PHASE6_SYNTHETIC_SUBMISSION'",
  'FROM phase6_exam_sessions s',
  'JOIN phase6_admin_publications p ON p.draft_id=s.topic_id AND p.revision=s.revision',
  'JOIN demo_students d ON d.firebase_uid=s.student_uid AND d.active=1',
  'WHERE s.student_uid=? AND s.session_id=? AND s.topic_id=? AND s.revision=?',
  'AND unixepoch() BETWEEN s.started_at AND s.expires_at',
  'ON CONFLICT(student_uid,topic_id,revision) DO NOTHING',
].join(' ');

function exact(data,keys){
  return data!==null&&typeof data==='object'&&!Array.isArray(data)&&
    Object.keys(data).sort().join(',')===keys.slice().sort().join(',');
}
function target(data){
  return typeof data.topicId==='string'&&TOPIC.test(data.topicId)&&
    Number.isSafeInteger(data.revision)&&data.revision>=1&&data.revision<=100000;
}
function countWrite(result){
  if(result?.success!==true||!Number.isSafeInteger(result.meta?.changes)||
     (result.meta.changes!==0&&result.meta.changes!==1))
    throw new Error('PHASE6_D1_WRITE_UNCONFIRMED');
  return result.meta.changes;
}
function parseSession(row,uid,id,revision){
  if(!row)return null;
  if(row.student_uid!==uid||row.topic_id!==id||row.revision!==revision||
     !SESSION_ID.test(row.session_id||'')||row.marker!==SESSION_MARKER||
     !Number.isSafeInteger(row.question_count)||row.question_count<1||
     row.question_count>MAX_QUESTIONS||
     !Number.isSafeInteger(row.time_limit_seconds)||
     row.time_limit_seconds<60||row.time_limit_seconds>14400||
     row.time_limit_seconds%60!==0||
     !Number.isSafeInteger(row.started_at)||row.started_at<=0||
     row.expires_at!==row.started_at+row.time_limit_seconds)
    throw new Error('PHASE6_SESSION_CORRUPT');
  return {
    sessionId:row.session_id,topicId:id,revision,
    questionCount:row.question_count,timeLimitSeconds:row.time_limit_seconds,
    startedAt:row.started_at,expiresAt:row.expires_at,
  };
}
function publicSubmission(row,uid,id,revision){
  if(!row)return null;
  if(row.student_uid!==uid||row.topic_id!==id||row.revision!==revision||
     !SESSION_ID.test(row.session_id||'')||row.marker!==SUBMISSION_MARKER||
     !Number.isSafeInteger(row.correct_count)||row.correct_count<0||
     !Number.isSafeInteger(row.total_count)||row.total_count<1||
     row.total_count>MAX_QUESTIONS||row.correct_count>row.total_count||
     !Number.isSafeInteger(row.score_tenths)||
     row.score_tenths!==Math.round(row.correct_count*100/row.total_count)||
     !Number.isSafeInteger(row.submitted_at)||row.submitted_at<=0)
    throw new Error('PHASE6_RESULT_CORRUPT');
  let answers;
  try{answers=JSON.parse(row.answers_json);}catch{throw new Error('PHASE6_SAVED_ANSWERS_INVALID');}
  if(!answers||typeof answers!=='object'||Array.isArray(answers)||
     Object.keys(answers).length!==row.total_count||
     !Object.entries(answers).every(([k,v])=>
       /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(k)&&
       Number.isSafeInteger(v)&&v>=0&&v<=3))
    throw new Error('PHASE6_SAVED_ANSWERS_INVALID');
  return {
    receipt:{
      topicId:id,revision,correctCount:row.correct_count,
      totalCount:row.total_count,score:row.score_tenths/10,maxScore:10,
      submittedAt:row.submitted_at,status:'submitted',
    },
    answers,sessionId:row.session_id,
  };
}
async function dbNow(db){
  const row=await db.prepare(DB_NOW_SQL).first();
  if(!Number.isSafeInteger(row?.now)||row.now<=0)
    throw new Error('PHASE6_DB_CLOCK_INVALID');
  return row.now;
}
async function versionFor(db,id,revision){
  const row=await db.prepare(VERSION_SQL).bind(id,revision).first();
  if(!row)return null;
  const definition=validatePublishedExamDefinition(row,row.question_count);
  if(definition.questionCount>MAX_QUESTIONS)
    throw new Error('PHASE6_NON_DEMO_QUESTION_COUNT');
  return row;
}
async function publicQuestions(db,version){
  const res=await db.prepare(QUESTIONS_SQL).bind(version.topic_id,version.revision).all();
  if(!Array.isArray(res?.results)||res.results.length!==version.question_count)
    throw new Error('PHASE6_PUBLIC_QUESTIONS_INVALID');
  return projectPublishedTopic(version,res.results).questions;
}
async function readSession(db,uid,id,revision){
  return parseSession(
    await db.prepare(SESSION_SQL).bind(uid,id,revision).first(),uid,id,revision);
}
async function readSubmission(db,uid,id,revision){
  return publicSubmission(
    await db.prepare(SUBMISSION_SQL).bind(uid,id,revision).first(),uid,id,revision);
}
async function sessionResponse(db,uid,version){
  const session=await readSession(db,uid,version.topic_id,version.revision);
  if(!session)return json({session:null});
  if(session.timeLimitSeconds!==version.time_limit_seconds||
     session.questionCount!==version.question_count)
    throw new Error('PHASE6_SESSION_PUBLISHED_MISMATCH');
  const [questions,now]=await Promise.all([publicQuestions(db,version),dbNow(db)]);
  return json({
    session:{...session,serverNow:now},
    topic:{title:version.title,questions},
    result:(await readSubmission(db,uid,version.topic_id,version.revision))?.receipt??null,
  });
}
async function getPrivateKeys(db,version){
  const res=await db.prepare(KEYS_SQL).bind(version.topic_id,version.revision).all();
  if(!Array.isArray(res?.results)||res.results.length!==version.question_count)
    throw new Error('PHASE6_PRIVATE_KEYS_INCOMPLETE');
  return res.results;
}

export async function handlePhase6StudentExam(db,uid,data){
  if(!db?.prepare||!UID.test(uid||'')||!data||typeof data!=='object'||Array.isArray(data))
    return json({error:'UNAUTHORIZED'},401);
  if(exact(data,['action'])&&data.action==='list'){
    const list=await db.prepare(LIST_SQL).all();
    if(!Array.isArray(list?.results)||list.results.length>100)
      throw new Error('PHASE6_PUBLIC_LIST_INVALID');
    const topics=list.results.map(v=>{
      validatePublishedExamDefinition({...v,state:'published'},v.question_count);
      if(!TOPIC.test(v.topic_id)||v.question_count>MAX_QUESTIONS||
         typeof v.title!=='string'||v.title.length<1||v.title.length>250)
        throw new Error('PHASE6_NON_SYNTHETIC_PUBLICATION');
      return {
        topicId:v.topic_id,revision:v.revision,title:v.title,
        questionCount:v.question_count,timeLimitSeconds:v.time_limit_seconds,
      };
    });
    return json({mode:'phase6-student-timed-demo',topics});
  }
  if(!target(data))return json({error:'INVALID_REQUEST'},400);
  const id=data.topicId,revision=data.revision;
  if(exact(data,['action','topicId','revision'])&&data.action==='result'){
    const prior=await readSubmission(db,uid,id,revision);
    return json({result:prior?.receipt??null});
  }
  if(exact(data,['action','topicId','revision'])&&
     (data.action==='start'||data.action==='read')){
    const version=await versionFor(db,id,revision);
    if(!version)return json({error:'NOT_FOUND'},404);
    if(data.action==='start'){
      // Fail closed before creating a session if the separately reviewed
      // Phase 6D submission schema is not installed on this Preview DB.
      await db.prepare('SELECT 1 FROM phase6_exam_submissions LIMIT 1').first();
      const existing=await readSession(db,uid,id,revision);
      if(!existing){
        const sessionId='p6_session_'+crypto.randomUUID().replaceAll('-','');
        // Timestamp is generated in the same DB INSERT statement and checked
        // by its immutable session trigger. Device time is never accepted.
        countWrite(await db.prepare(START_SQL).bind(
          sessionId,uid,uid,id,revision).run());
      }
    }
    return sessionResponse(db,uid,version);
  }
  if(!exact(data,['action','topicId','revision','sessionId','answers'])||
     data.action!=='submit'||typeof data.sessionId!=='string'||
     !SESSION_ID.test(data.sessionId))
    return json({error:'INVALID_REQUEST'},400);
  const session=await readSession(db,uid,id,revision);
  if(!session||session.sessionId!==data.sessionId)
    return json({error:'SESSION_NOT_STARTED'},409);
  const version=await versionFor(db,id,revision);
  if(!version||session.questionCount!==version.question_count||
     session.timeLimitSeconds!==version.time_limit_seconds)
    throw new Error('PHASE6_SESSION_DEFINITION_CHANGED');
  const keys=await getPrivateKeys(db,version);
  let score;
  try{score=gradeAnswersOnServer(keys,data.answers);}
  catch{return json({error:'INVALID_ANSWERS'},400);}
  const canonical=Object.fromEntries(keys.map(k=>[k.question_id,data.answers[k.question_id]]));
  const serialized=JSON.stringify(canonical);
  const existing=await readSubmission(db,uid,id,revision);
  if(existing){
    if(existing.sessionId!==session.sessionId||JSON.stringify(existing.answers)!==serialized)
      return json({error:'ALREADY_SUBMITTED',result:existing.receipt},409);
    return json({result:existing.receipt,created:false});
  }
  const inserted=countWrite(await db.prepare(SUBMIT_SQL).bind(
    'p6_submit_'+crypto.randomUUID().replaceAll('-'),
    serialized,score.correctCount,score.totalCount,score.scoreTenths,
    uid,session.sessionId,id,revision,
  ).run());
  const saved=await readSubmission(db,uid,id,revision);
  if(saved){
    if(saved.sessionId!==session.sessionId||JSON.stringify(saved.answers)!==serialized)
      return json({error:'ALREADY_SUBMITTED',result:saved.receipt},409);
    return json({result:saved.receipt,created:inserted===1},inserted===1?201:200);
  }
  // Enforcement is inside the INSERT, not an application-level clock check.
  const now=await dbNow(db);
  return json({error:now>session.expiresAt?'DEADLINE_EXPIRED':'SUBMISSION_NOT_ACCEPTED'},409);
}
