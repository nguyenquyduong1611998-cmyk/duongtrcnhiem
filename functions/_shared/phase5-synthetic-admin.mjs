// Phase 5F: read-only GOOGLE ADMIN view of staging synthetic D1 scores.
// Never select answer keys, stored choices, Firebase UIDs, or password data.
// Only exact DEMO math topic/revision, and only validated DEMO usernames.
import {json} from './auth.mjs';

const USERNAME=/^test_hv_[a-f0-9]{12}$/;
const TOPIC_ID='p5_demo_math';
const REVISION=1;
const MARKER='PHASE5_STAGING_MODEL';
const MAX_RESULTS=100;

const LIST_SQL=[
  'SELECT s.username,a.topic_id,a.revision,a.correct_count,',
  'a.total_count,a.score_tenths,a.submitted_at,a.marker',
  'FROM phase5_content_attempts a',
  'INNER JOIN demo_students s ON s.firebase_uid=a.student_uid',
  "WHERE a.topic_id='p5_demo_math' AND a.revision=1",
  "AND s.username GLOB 'test_hv_*'",
  'ORDER BY a.submitted_at DESC,s.username ASC LIMIT 101',
].join(' ');

function project(row){
  if(!row||typeof row.username!=='string'||!USERNAME.test(row.username)||
    row.topic_id!==TOPIC_ID||row.revision!==REVISION||row.marker!==MARKER||
    !Number.isSafeInteger(row.correct_count)||
    !Number.isSafeInteger(row.total_count)||
    row.total_count<1||row.total_count>500||
    row.correct_count<0||row.correct_count>row.total_count||
    !Number.isSafeInteger(row.score_tenths)||
    row.score_tenths!==Math.round(row.correct_count*100/row.total_count)||
    !Number.isSafeInteger(row.submitted_at)||row.submitted_at<=0)
    throw new Error('PHASE5_ADMIN_ROW_INVALID');
  return {
    username:row.username,topicId:TOPIC_ID,revision:REVISION,
    correctCount:row.correct_count,totalCount:row.total_count,
    score:row.score_tenths/10,maxScore:10,
    submittedAt:row.submitted_at,
  };
}

export async function handlePhase5SyntheticAdmin(db,data){
  if(!db?.prepare||!data||typeof data!=='object'||Array.isArray(data)||
     Object.keys(data).length!==1||data.action!=='list')
    return json({error:'INVALID_REQUEST'},400);
  const rows=await db.prepare(LIST_SQL).all();
  if(!Array.isArray(rows?.results)||rows.results.length>MAX_RESULTS)
    throw new Error('PHASE5_ADMIN_RESULT_SET_INVALID');
  const attempts=rows.results.map(project);
  if(new Set(attempts.map(row=>row.username)).size!==attempts.length)
    throw new Error('PHASE5_ADMIN_DUPLICATE_STUDENT');
  return json({
    mode:'phase5-synthetic-admin-readonly',
    topicId:TOPIC_ID,revision:REVISION,
    attempts,count:attempts.length,
  });
}
