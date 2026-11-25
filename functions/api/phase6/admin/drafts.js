// Phase 6B: Preview-only synthetic draft CRUD for verified Google Admin.
// Default OFF: no D1 migration, secret, or flag is set by GitHub code.
import {bindStagingDatabaseForRequest} from '../../../_shared/staging-db-binding.mjs';
import {
  checkRequest,smallJson,json,requireStaging,verifiedGoogleAdmin,
  noSecrets,failSafe,
} from '../../../_shared/auth.mjs';
import {PHASE4_PILOT_PREVIEW_HOST,isApprovedPhase4StagingHost}
  from '../../../_shared/phase4-host-guard.mjs';
import {handlePhase6SyntheticAdminDrafts}
  from '../../../_shared/phase6-synthetic-admin-drafts.mjs';

export async function onRequestPost({request,env}){
  let url;
  try{url=new URL(request.url);}catch{return json({error:'NOT_FOUND'},404);}
  if(env?.PHASE6_ADMIN_DRAFTS_ENABLED!=='true'||
     env?.PHASE4_PREVIEW_HOST_OPT_IN!=='true'||
     env?.PHASE4_STAGING_HOSTNAME!==PHASE4_PILOT_PREVIEW_HOST||
     url.hostname!==PHASE4_PILOT_PREVIEW_HOST||
     !isApprovedPhase4StagingHost(request,env))
    return json({error:'NOT_FOUND'},404);
  const invalid=checkRequest(request);
  if(invalid)return invalid;
  if(url.search)return json({error:'INVALID_REQUEST'},400);
  const bound=bindStagingDatabaseForRequest(env,request);
  try{requireStaging(bound);}catch{return noSecrets();}
  try{
    if(!await verifiedGoogleAdmin(request))
      return json({error:'ADMIN_AUTH_REQUIRED'},403);
    let data;
    try{data=await smallJson(request);}
    catch{return json({error:'INVALID_REQUEST'},400);}
    return await handlePhase6SyntheticAdminDrafts(bound.AUTH_DB,data);
  }catch(error){
    // Don't expose payloads, JWTs, SQL statements, answer keys or DB contents.
    console.error('Phase6 Admin synthetic drafts error:',error?.name||'unknown');
    return failSafe();
  }
}
