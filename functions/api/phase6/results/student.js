// Phase 6E: student-owned read-only D1 history (pinned Preview only).
// Default OFF, no session/score mutation and no alternate DB fallback.
import {bindStagingDatabaseForRequest} from '../../../_shared/staging-db-binding.mjs';
import {checkRequest,smallJson,json,requireStaging,noSecrets,failSafe}
  from '../../../_shared/auth.mjs';
import {PHASE4_PILOT_PREVIEW_HOST,isApprovedPhase4StagingHost}
  from '../../../_shared/phase4-host-guard.mjs';
import {verifyActiveDemoQuizStudent} from '../../../_shared/synthetic-quiz.mjs';
import {handlePhase6StudentHistory} from '../../../_shared/phase6-results-readonly.mjs';

export async function onRequestPost({request,env}){
  let url;
  try{url=new URL(request.url);}catch{return json({error:'NOT_FOUND'},404);}
  if(env?.PHASE6_RESULTS_READONLY_ENABLED!=='true'||
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
    return await handlePhase6StudentHistory(bound.AUTH_DB,uid,data);
  }catch(error){
    console.error('Phase6 student history failed:',error?.name||'unknown');
    return failSafe();
  }
}
