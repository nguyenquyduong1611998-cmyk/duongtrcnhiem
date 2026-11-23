import {
  requireStaging,json,checkRequest,smallJson,verifiedGoogleAdmin,
  noSecrets,failSafe,
} from '../../../_shared/auth.mjs';
import {summarizePilotRevocationQueue}
  from '../../../_shared/pilot-outbox-health.mjs';

// Read-only pilot diagnostics. OFF unless explicitly allowed in staging.
// Admin signature verification is mandatory; returns no account identifiers.
// This is not a live alarm/scheduler or a statement that Firestore is locked.
export async function onRequestPost({request,env}) {
  const invalid=checkRequest(request);
  if(invalid)return invalid;
  if(env?.PHASE3_PILOT_QUEUE_MONITOR_ENABLED!=='true')
    return json({error:'NOT_FOUND'},404);
  try{requireStaging(env);}catch{return noSecrets();}
  if(!await verifiedGoogleAdmin(request))
    return json({error:'ADMIN_AUTH_REQUIRED'},403);
  let input;
  try{input=await smallJson(request);}
  catch{return json({error:'INVALID_REQUEST'},400);}
  if(Object.keys(input).length!==1 || input.action!=='status')
    return json({error:'INVALID_REQUEST'},400);
  try{
    return json(await summarizePilotRevocationQueue(env.AUTH_DB));
  }catch(error){
    console.error('Pilot queue monitor failure type:',error?.name||'unknown');
    return failSafe();
  }
}
