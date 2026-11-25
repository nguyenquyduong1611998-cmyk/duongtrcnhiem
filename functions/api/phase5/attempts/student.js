// Phase 5D: OFF by default, PREVIEW ONLY, synthetic demo math submissions.
// Do not enable until local security tests, review and explicit operator gate.
import {bindStagingDatabaseForRequest} from '../../../_shared/staging-db-binding.mjs';
import {
  checkRequest,smallJson,json,requireStaging,noSecrets,failSafe,
} from '../../../_shared/auth.mjs';
import {isApprovedPhase4StagingHost,PHASE4_PILOT_PREVIEW_HOST}
  from '../../../_shared/phase4-host-guard.mjs';
import {verifyActiveDemoQuizStudent}
  from '../../../_shared/synthetic-quiz.mjs';
import {handlePhase5SyntheticStudent}
  from '../../../_shared/phase5-synthetic-grading.mjs';

export async function onRequestPost({request,env}) {
  let url;
  try{url=new URL(request.url);}catch{return json({error:'NOT_FOUND'},404);}
  // Separate OFF-by-default write gate. The read-only flag never enables it.
  if(env?.PHASE5_SYNTHETIC_GRADING_ENABLED!=='true'||
     env?.PHASE5_READONLY_TOPICS_ENABLED!=='true'||
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
    return await handlePhase5SyntheticStudent(bound.AUTH_DB,uid,data);
  }catch(error){
    // Never echo student UID, JWT, answer key, row, SQL or secret.
    console.error('Phase5 synthetic grading failure type:',error?.name||'unknown');
    return failSafe();
  }
}
