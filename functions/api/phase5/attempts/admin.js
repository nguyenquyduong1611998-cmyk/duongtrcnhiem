// Phase 5F: DEMO Google Admin score list, strictly READ ONLY and Preview only.
// Independent default-OFF flag. Never infer Admin from browser roles.
import {bindStagingDatabaseForRequest} from '../../../_shared/staging-db-binding.mjs';
import {
  checkRequest,smallJson,json,requireStaging,verifiedGoogleAdmin,
  noSecrets,failSafe,
} from '../../../_shared/auth.mjs';
import {PHASE4_PILOT_PREVIEW_HOST,isApprovedPhase4StagingHost}
  from '../../../_shared/phase4-host-guard.mjs';
import {handlePhase5SyntheticAdmin}
  from '../../../_shared/phase5-synthetic-admin.mjs';

export async function onRequestPost({request,env}){
  let url;
  try{url=new URL(request.url);}catch{return json({error:'NOT_FOUND'},404);}
  if(env?.PHASE5_ADMIN_RESULTS_ENABLED!=='true'||
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
    if(!await verifiedGoogleAdmin(request))
      return json({error:'ADMIN_AUTH_REQUIRED'},403);
    let data;
    try{data=await smallJson(request);}
    catch{return json({error:'INVALID_REQUEST'},400);}
    return await handlePhase5SyntheticAdmin(bound.AUTH_DB,data);
  }catch(error){
    // Only a fixed error category; never print token, names or SQL.
    console.error('Phase 5 Admin synthetic read failed:',error?.name||'unknown');
    return failSafe();
  }
}
