import {
  requireStaging,json,checkRequest,noSecrets,failSafe,
} from '../../../_shared/auth.mjs';
import {
  bearerToken,verifyStudentFirebaseIdToken,authorizeStudentIdentity,
} from '../../../_shared/student-session.mjs';

// PHASE 3C: a protected-backend session CHECK ONLY. Does not create users,
// issue custom tokens, enable Firestore access, or turn on real student login.
// Flag deliberately distinct from both existing STAGING_AUTH_ENABLED and
// PHASE3_PILOT_PASSWORDS_ENABLED; never configure it before review.
export async function onRequestPost({request,env}) {
  const invalid=checkRequest(request);
  if(invalid)return invalid;
  if(env?.PHASE3_STUDENT_SESSION_CHECK_ENABLED!=='true')
    return json({error:'NOT_FOUND'},404);
  try{requireStaging(env);}catch{return noSecrets();}
  const token=bearerToken(request);
  if(!token)return json({error:'UNAUTHORIZED'},401);
  try {
    const verified=await verifyStudentFirebaseIdToken(token);
    if(!verified)return json({error:'UNAUTHORIZED'},401);
    const allowed=await authorizeStudentIdentity(env.AUTH_DB,verified);
    if(!allowed)return json({error:'ACCESS_DENIED'},403);
    return json({authorized:true,mode:'server-check-only',loginEnabled:false});
  } catch(error) {
    console.error('Phase3 session check category:',error?.name||'unknown');
    return failSafe();
  }
}
