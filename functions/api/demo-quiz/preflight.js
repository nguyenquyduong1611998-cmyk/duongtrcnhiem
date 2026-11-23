import {bindStagingDatabaseForRequest} from '../../_shared/staging-db-binding.mjs';
import {
  requireStaging,json,checkRequest,smallJson,
  verifiedGoogleAdmin,noSecrets,failSafe,
} from '../../_shared/auth.mjs';
import {inspectStagingDemoQuizSchema}
  from '../../_shared/phase4-staging-preflight.mjs';
import {isApprovedPhase4StagingHost,PHASE4_PILOT_PREVIEW_HOST}
  from '../../_shared/phase4-host-guard.mjs';

// Read-only, Admin-only and OFF until independently approved in staging.
// NO migration execution, SQL input, table rows, credentials or identifiers.
export async function onRequestPost({request,env}){
  env=bindStagingDatabaseForRequest(env,request);
  const invalid=checkRequest(request);
  if(invalid)return invalid;
  if(env?.PHASE4_STAGING_PREFLIGHT_ENABLED!=='true')
    return json({error:'NOT_FOUND'},404);
  if(!isApprovedPhase4StagingHost(request,env))
    return json({error:'NOT_FOUND'},404);
  try{requireStaging(env);}catch{return noSecrets();}
  if(!await verifiedGoogleAdmin(request))
    return json({error:'ADMIN_AUTH_REQUIRED'},403);
  let input;
  try{input=await smallJson(request);}
  catch{return json({error:'INVALID_REQUEST'},400);}
  if(Object.keys(input).length!==1||input.action!=='inspect')
    return json({error:'INVALID_REQUEST'},400);
  // Only the approved, opted-in branch alias may use the two-table
  // Preview profile; canonical staging retains its stricter check.
  const profile=new URL(request.url).hostname===PHASE4_PILOT_PREVIEW_HOST
    ? 'preview-demo':'canonical';
  try{return json(await inspectStagingDemoQuizSchema(env.AUTH_DB,{profile}));}
  catch(error){
    console.error('Phase4 preflight error type:',error?.name||'unknown');
    return failSafe();
  }
}
