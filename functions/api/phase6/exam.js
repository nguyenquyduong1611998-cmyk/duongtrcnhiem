// Phase 6D: authenticated synthetic DEMO students, Preview-only, OFF by default.
// Never accepts browser UID, client time, grade or correct-answer key.
// All D1 writes use the separate AUTH_DB_PREVIEW binding, never fallback.
import {bindStagingDatabaseForRequest} from '../../_shared/staging-db-binding.mjs';
import {checkRequest,smallJson,json,requireStaging,noSecrets,failSafe}
  from '../../_shared/auth.mjs';
import {isApprovedPhase4StagingHost,PHASE4_PILOT_PREVIEW_HOST}
  from '../../_shared/phase4-host-guard.mjs';
import {verifyActiveDemoQuizStudent}
  from '../../_shared/synthetic-quiz.mjs';
import {handlePhase6StudentExam}
  from '../../_shared/phase6-student-timed-exam.mjs';

export async function onRequestPost({request,env}){
  let url;
  try{url=new URL(request.url);}catch{return json({error:'NOT_FOUND'},404);}
  if(env?.PHASE6_STUDENT_TIMED_EXAM_ENABLED!=='true'||
     env?.PHASE4_PREVIEW_HOST_OPT_IN!=='true'||
     env?.PHASE4_STAGING_HOSTNAME!==PHASE4_PILOT_PREVIEW_HOST||
     url.hostname!==PHASE4_PILOT_PREVIEW_HOST||
     !isApprovedPhase4StagingHost(request,env))
    return json({error:'NOT_FOUND'},404);
  const bad=checkRequest(request);
  if(bad)return bad;
  if(url.search)return json({error:'INVALID_REQUEST'},400);
  const bound=bindStagingDatabaseForRequest(env,request);
  try{requireStaging(bound);}catch{return noSecrets();}
  try{
    const uid=await verifyActiveDemoQuizStudent(bound.AUTH_DB,request);
    if(!uid)return json({error:'UNAUTHORIZED'},401);
    let data;
    try{data=await smallJson(request);}
    catch{return json({error:'INVALID_REQUEST'},400);}
    return handlePhase6StudentExam(bound.AUTH_DB,uid,data);
  }catch(error){
    console.error('Phase6 timed demo exam:',error?.name||'unknown');
    return failSafe();
  }
}
