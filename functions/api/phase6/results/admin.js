// Phase 6E: signed Google Admin, read-only synthetic D1 score board.
// Independent default-OFF gate. Preview DB binding only, never Production.
import {bindStagingDatabaseForRequest} from '../../../_shared/staging-db-binding.mjs';
import {
  checkRequest,smallJson,json,requireStaging,verifiedGoogleAdmin,
  noSecrets,failSafe,
} from '../../../_shared/auth.mjs';
import {PHASE4_PILOT_PREVIEW_HOST,isApprovedPhase4StagingHost}
  from '../../../_shared/phase4-host-guard.mjs';
import {handlePhase6AdminResults} from '../../../_shared/phase6-results-readonly.mjs';

export async function onRequestPost({request,env}){
  let url;
  try{url=new URL(request.url);}catch{return json({error:'NOT_FOUND'},404);}
  if(env?.PHASE6_ADMIN_RESULTS_ENABLED!=='true'||
     env?.PHASE6_RESULTS_READONLY_ENABLED!=='true'||
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
    return await handlePhase6AdminResults(bound.AUTH_DB,data);
  }catch(error){
    console.error('Phase6 admin results failed:',error?.name||'unknown');
    return failSafe();
  }
}
