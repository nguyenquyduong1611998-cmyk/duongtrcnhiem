// PHASE 5B — read-only DEMO topic browser API, PREVIEW ONLY and default OFF.
// Never upload real/internal content or modify D1 from this module.
// Queries exclude answer-key table; every outbound field uses an explicit allowlist.
import {bindStagingDatabaseForRequest} from './staging-db-binding.mjs';
import {
  isApprovedPhase4StagingHost,PHASE4_PILOT_PREVIEW_HOST,
} from './phase4-host-guard.mjs';
import {json,requireStaging,noSecrets} from './auth.mjs';
import {verifyActiveDemoQuizStudent} from './synthetic-quiz.mjs';
import {projectPublishedTopic} from './phase5-public-content.mjs';

const DEMO_TOPIC_ID=/^p5_demo_[a-z0-9_-]{1,70}$/;
const SCHEMA_NOT_READY={error:'PHASE5_SCHEMA_NOT_READY'};
const SQL_LIST=[
  'SELECT v.topic_id,v.revision,v.code,v.title,v.description,',
  'v.time_limit_seconds,',
  '(SELECT COUNT(*) FROM phase5_content_questions q',
  ' WHERE q.topic_id=v.topic_id AND q.revision=v.revision) AS question_count',
  'FROM phase5_content_versions v',
  "WHERE v.state='published' AND v.topic_id GLOB 'p5_demo_*'",
  'AND v.revision=(SELECT MAX(w.revision) FROM phase5_content_versions w',
  "  WHERE w.topic_id=v.topic_id AND w.state='published')",
  'ORDER BY v.topic_id ASC LIMIT 25',
].join(' ');
const SQL_TOPIC=[
  'SELECT topic_id,revision,code,title,description,time_limit_seconds,state',
  'FROM phase5_content_versions',
  "WHERE topic_id=? AND revision=? AND state='published'",
  'LIMIT 1',
].join(' ');
const SQL_QUESTIONS=[
  'SELECT topic_id,revision,question_id,order_index,question_text,',
  'option_a,option_b,option_c,option_d',
  'FROM phase5_content_questions',
  'WHERE topic_id=? AND revision=?',
  'ORDER BY order_index ASC LIMIT 501',
].join(' ');

export async function authorizePhase5PreviewRead({request,env}) {
  // Do not permit normal test-Production, arbitrary previews or other hosts.
  // A configured flag never overrides the explicit hostname allowlist.
  let url;
  try{url=new URL(request.url);}catch{return {error:json({error:'NOT_FOUND'},404)};}
  if(request.method!=='GET')
    return {error:json({error:'METHOD_NOT_ALLOWED'},405)};
  if(env?.PHASE5_READONLY_TOPICS_ENABLED!=='true' ||
     env?.PHASE4_PREVIEW_HOST_OPT_IN!=='true' ||
     env?.PHASE4_STAGING_HOSTNAME!==PHASE4_PILOT_PREVIEW_HOST ||
     url.hostname!==PHASE4_PILOT_PREVIEW_HOST ||
     !isApprovedPhase4StagingHost(request,env))
    return {error:json({error:'NOT_FOUND'},404)};
  if(url.search)
    return {error:json({error:'INVALID_REQUEST'},400)};
  const origin=request.headers.get('origin');
  if(origin && origin!==url.origin)
    return {error:json({error:'FORBIDDEN_ORIGIN'},403)};
  const bound=bindStagingDatabaseForRequest(env,request);
  try{requireStaging(bound);}catch{return {error:noSecrets()};}
  // Must verify Firebase ID token AND active enrollment in *Preview* D1.
  // Do not trust client UID, role, username or Host / Forwarded headers.
  try{
    const uid=await verifyActiveDemoQuizStudent(bound.AUTH_DB,request);
    if(!uid)return {error:json({error:'UNAUTHORIZED'},401)};
  }catch{
    return {error:json({error:'SERVER_UNAVAILABLE'},503)};
  }
  return {db:bound.AUTH_DB};
}

function publishedSummary(row) {
  if(!row||!DEMO_TOPIC_ID.test(row.topic_id||'')||
    !Number.isSafeInteger(row.revision)||row.revision<1||
    row.revision>100000||typeof row.code!=='string'||row.code.length<1||
    row.code.length>40||typeof row.title!=='string'||
    row.title.length<1||row.title.length>250||
    typeof row.description!=='string'||row.description.length>2000||
    !Number.isSafeInteger(row.time_limit_seconds)||
    row.time_limit_seconds<60||row.time_limit_seconds>14400||
    !Number.isSafeInteger(row.question_count)||
    row.question_count<1||row.question_count>500)
    throw new Error('PHASE5_TOPIC_INVALID');
  return {
    topicId:row.topic_id,revision:row.revision,
    code:row.code,title:row.title,
    description:row.description,
    timeLimitSeconds:row.time_limit_seconds,
    questionCount:row.question_count,
  };
}

export async function listPublishedSyntheticTopics(db) {
  const response=await db.prepare(SQL_LIST).all();
  if(!Array.isArray(response?.results)) throw new Error('PHASE5_DB_INVALID');
  return response.results.map(publishedSummary);
}

export function validPhase5TopicRoute(topicId,revision) {
  if(typeof topicId!=='string'||!DEMO_TOPIC_ID.test(topicId))return null;
  if(typeof revision!=='string'||!/^[1-9][0-9]{0,5}$/.test(revision))return null;
  const rev=Number(revision);
  return rev<=100000 ? {topicId,revision:rev} : null;
}

export async function getPublishedSyntheticTopic(db,route) {
  const version=await db.prepare(SQL_TOPIC).bind(route.topicId,route.revision).first();
  if(!version)return null;
  // Intentionally NEVER query phase5_content_answer_keys here.
  const response=await db.prepare(SQL_QUESTIONS).bind(route.topicId,route.revision).all();
  if(!Array.isArray(response?.results))throw new Error('PHASE5_DB_INVALID');
  const topic=projectPublishedTopic(version,response.results);
  if(!DEMO_TOPIC_ID.test(topic.topicId))throw new Error('PHASE5_NON_DEMO_REJECTED');
  return topic;
}

export function phase5DbFailureResponse(){
  // Schema intentionally is NOT applied to Cloudflare D1 yet.
  // Do not expose query text, table names, credentials or identifiers.
  return json(SCHEMA_NOT_READY,503);
}
