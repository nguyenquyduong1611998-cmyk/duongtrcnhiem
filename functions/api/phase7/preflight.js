// Phase 7A: schema-only inspection for the exact isolated Preview D1.
// READ-ONLY. Admin-only, default OFF and pinned HTTPS hostname.
// No migration, backup, seed, table data, file upload or arbitrary SQL.
import {bindStagingDatabaseForRequest} from '../../_shared/staging-db-binding.mjs';
import {
  checkRequest,smallJson,json,requireStaging,verifiedGoogleAdmin,
  noSecrets,failSafe,
} from '../../_shared/auth.mjs';
import {PHASE4_PILOT_PREVIEW_HOST,isApprovedPhase4StagingHost}
  from '../../_shared/phase4-host-guard.mjs';
import {inspectPhase7PreviewSchema}
  from '../../_shared/phase7-preview-d1-schema-preflight.mjs';

export async function onRequestPost({request,env}){
  let url;
  try{url=new URL(request.url);}catch{return json({error:'NOT_FOUND'},404);}
  if(env?.PHASE7_PREVIEW_SCHEMA_PREFLIGHT_ENABLED!=='true'||
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
    if(!data||Object.keys(data).length!==1||data.action!=='inspect')
      return json({error:'INVALID_REQUEST'},400);
    return json(await inspectPhase7PreviewSchema(bound.AUTH_DB));
  }catch(error){
    console.error('Phase7A schema-only preflight failed:',error?.name||'unknown');
    return failSafe();
  }
}
