// Phase 6E: strictly read-only projection of committed Phase 6D DEMO grades.
// Never SELECT answer keys, answers_json, session IDs, JWTs, password data or
// student UIDs into a response. No SQL writes and no arbitrary query filters.
import {json} from './auth.mjs';

const UID=/^student_[a-f0-9]{32}$/;
const TOPIC=/^p6_demo_[a-f0-9]{32}$/;
const DEMO_USERNAME=/^test_hv_[a-f0-9]{12}$/;
const MARKER='PHASE6_SYNTHETIC_SUBMISSION';
const PAGE_SIZE=25;
const MAX_OFFSET=10000;
const FIELDS=[
  'a.topic_id,a.revision,v.title,a.correct_count,a.total_count,',
  'a.score_tenths,a.submitted_at,a.marker',
].join('');
const JOIN=[
  'FROM phase6_exam_submissions a',
  'JOIN phase6_exam_sessions s ON s.session_id=a.session_id',
  'AND s.student_uid=a.student_uid AND s.topic_id=a.topic_id',
  'AND s.revision=a.revision',
  'JOIN phase6_admin_publications p ON p.draft_id=a.topic_id',
  "AND p.revision=a.revision AND p.marker='PHASE6_SYNTHETIC_PUBLICATION'",
  'JOIN phase5_content_versions v ON v.topic_id=a.topic_id',
  "AND v.revision=a.revision AND v.state='published'",
].join(' ');
const GUARDS="a.marker='PHASE6_SYNTHETIC_SUBMISSION' AND a.topic_id GLOB 'p6_demo_*'";
const STUDENT_SQL=[
  'SELECT',FIELDS,JOIN,'WHERE',GUARDS,'AND a.student_uid=?',
  'ORDER BY a.submitted_at DESC,a.topic_id ASC,a.revision DESC',
  'LIMIT 26 OFFSET ?',
].join(' ');
const ADMIN_JOIN=[
  JOIN,'JOIN demo_students d ON d.firebase_uid=a.student_uid',
].join(' ');
const ADMIN_SQL=[
  'SELECT d.username,',FIELDS,ADMIN_JOIN,'WHERE',GUARDS,
  "AND d.username GLOB 'test_hv_*'",
  'ORDER BY a.submitted_at DESC,d.username ASC,a.topic_id ASC,a.revision DESC',
  'LIMIT 26 OFFSET ?',
].join(' ');
const SUMMARY_SQL=[
  'SELECT count(*) AS attempt_count,',
  'count(DISTINCT a.student_uid) AS student_count,',
  'coalesce(sum(a.score_tenths),0) AS total_score_tenths',
  ADMIN_JOIN,'WHERE',GUARDS,"AND d.username GLOB 'test_hv_*'",
].join(' ');

function exact(data,fields){
  return !!data&&typeof data==='object'&&!Array.isArray(data)&&
    Object.keys(data).sort().join(',')===fields.slice().sort().join(',');
}
function validOffset(offset){
  return Number.isSafeInteger(offset)&&offset>=0&&offset<=MAX_OFFSET&&
    offset%PAGE_SIZE===0;
}
function score(row){
  if(!row||!TOPIC.test(row.topic_id||'')||
     !Number.isSafeInteger(row.revision)||row.revision<1||row.revision>100000||
     typeof row.title!=='string'||row.title.length<1||row.title.length>250||
     row.marker!==MARKER||
     !Number.isSafeInteger(row.correct_count)||row.correct_count<0||
     !Number.isSafeInteger(row.total_count)||row.total_count<1||
     row.total_count>12||row.correct_count>row.total_count||
     !Number.isSafeInteger(row.score_tenths)||
     row.score_tenths!==Math.round(row.correct_count*100/row.total_count)||
     !Number.isSafeInteger(row.submitted_at)||row.submitted_at<=0)
    throw new Error('PHASE6_RESULT_ROW_INVALID');
  return {
    topicId:row.topic_id,revision:row.revision,title:row.title,
    correctCount:row.correct_count,totalCount:row.total_count,
    score:row.score_tenths/10,maxScore:10,
    submittedAt:row.submitted_at,status:'submitted',
  };
}
function page(rows,offset,admin){
  if(!Array.isArray(rows)||rows.length>PAGE_SIZE+1)
    throw new Error('PHASE6_RESULT_PAGE_INVALID');
  const entries=rows.slice(0,PAGE_SIZE).map(row=>{
    const base=score(row);
    if(!admin)return base;
    if(typeof row.username!=='string'||!DEMO_USERNAME.test(row.username))
      throw new Error('PHASE6_DEMO_USERNAME_INVALID');
    return {username:row.username,...base};
  });
  const keys=entries.map(r=>
    (admin?r.username+':':'')+r.topicId+':'+r.revision);
  if(new Set(keys).size!==keys.length)
    throw new Error('PHASE6_RESULT_DUPLICATES');
  return {entries,offset,nextOffset:rows.length>PAGE_SIZE?offset+PAGE_SIZE:null};
}
export async function handlePhase6StudentHistory(db,uid,data){
  if(!db?.prepare||!UID.test(uid||''))
    return json({error:'UNAUTHORIZED'},401);
  if(!exact(data,['action','offset'])||data.action!=='list'||
     !validOffset(data.offset))
    return json({error:'INVALID_REQUEST'},400);
  const result=await db.prepare(STUDENT_SQL).bind(uid,data.offset).all();
  if(!Array.isArray(result?.results))throw new Error('PHASE6_STUDENT_HISTORY_DB_INVALID');
  return json({
    mode:'phase6-student-history-readonly',
    ...page(result.results,data.offset,false),
  });
}
export async function handlePhase6AdminResults(db,data){
  if(!db?.prepare)return json({error:'INVALID_REQUEST'},400);
  if(exact(data,['action'])&&data.action==='summary'){
    const row=await db.prepare(SUMMARY_SQL).first();
    if(!row||!Number.isSafeInteger(row.attempt_count)||
       row.attempt_count<0||row.attempt_count>1000000||
       !Number.isSafeInteger(row.student_count)||row.student_count<0||
       row.student_count>row.attempt_count||
       !Number.isSafeInteger(row.total_score_tenths)||
       row.total_score_tenths<0||
       row.total_score_tenths>row.attempt_count*100)
      throw new Error('PHASE6_ADMIN_SUMMARY_INVALID');
    const averageScore=row.attempt_count===0?null:
      Math.round(row.total_score_tenths/row.attempt_count)/10;
    return json({
      mode:'phase6-admin-results-readonly',
      summary:{
        attemptCount:row.attempt_count,studentCount:row.student_count,
        averageScore,maxScore:10,
      },
    });
  }
  if(!exact(data,['action','offset'])||data.action!=='list'||
     !validOffset(data.offset))
    return json({error:'INVALID_REQUEST'},400);
  const result=await db.prepare(ADMIN_SQL).bind(data.offset).all();
  if(!Array.isArray(result?.results))throw new Error('PHASE6_ADMIN_HISTORY_DB_INVALID');
  return json({
    mode:'phase6-admin-results-readonly',
    ...page(result.results,data.offset,true),
  });
}
