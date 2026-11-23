import {
  requireStaging,json,checkRequest,smallJson,noSecrets,failSafe,
} from '../../../_shared/auth.mjs';
import {rotatePilotTemporaryPassword} from '../../../_shared/pilot-password.mjs';

// Synthetic first-password-change proof only. No tokens or app sessions.
// Requires explicit staging-only flag, in addition to existing staging guard.
export async function onRequestPost({request,env}) {
  const invalid=checkRequest(request);
  if(invalid) return invalid;
  if(env?.PHASE3_PILOT_PASSWORDS_ENABLED !== 'true') return json({error:'NOT_FOUND'},404);
  try {requireStaging(env);} catch {return noSecrets();}
  let data;
  try {data=await smallJson(request);} catch {return json({error:'INVALID_REQUEST'},400);}
  try {
    return await rotatePilotTemporaryPassword(env.AUTH_DB,data);
  } catch(error) {
    console.error('Pilot password rotation failure category:',error?.name || 'unknown');
    return failSafe();
  }
}
