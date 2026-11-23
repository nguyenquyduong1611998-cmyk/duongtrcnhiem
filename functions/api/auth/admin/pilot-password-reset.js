import {
  requireStaging,json,checkRequest,smallJson,verifiedGoogleAdmin,
  ADMIN_UID,noSecrets,failSafe,
} from '../../../_shared/auth.mjs';
import {issuePilotTemporaryPassword} from '../../../_shared/pilot-password.mjs';

// Explicitly OFF unless a separate staging-only flag is set.
// This endpoint is synthetic-only; never issues a Firebase login session.
export async function onRequestPost({request,env}) {
  const invalid=checkRequest(request);
  if(invalid) return invalid;
  if(env?.PHASE3_PILOT_PASSWORDS_ENABLED !== 'true') return json({error:'NOT_FOUND'},404);
  try {requireStaging(env);} catch {return noSecrets();}
  if(!await verifiedGoogleAdmin(request)) return json({error:'ADMIN_AUTH_REQUIRED'},403);
  let data;
  try {data=await smallJson(request);} catch {return json({error:'INVALID_REQUEST'},400);}
  try {
    return await issuePilotTemporaryPassword(env.AUTH_DB,data,ADMIN_UID);
  } catch(error) {
    console.error('Pilot password issue failure category:',error?.name || 'unknown');
    return failSafe();
  }
}
