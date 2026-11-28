import {bindStagingDatabaseForRequest} from '../../_shared/staging-db-binding.mjs';
import {
  requireStaging,json,checkRequest,smallJson,noSecrets,failSafe,
} from '../../_shared/auth.mjs';
import {
  verifyActiveDemoQuizStudent,handleDemoQuizStudent,
} from '../../_shared/synthetic-quiz.mjs';
import {isApprovedPhase4StagingHost,PHASE4_PILOT_PREVIEW_HOST}
  from '../../_shared/phase4-host-guard.mjs';

// Synthetic cross-device graded-quiz proof ONLY, flag OFF by default.
// Current live DEMO student login remains unchanged.
export async function onRequestPost({request,env}) {
  env=bindStagingDatabaseForRequest(env,request);
  const bad=checkRequest(request);
  if(bad)return bad;
  if(env?.PHASE4_SYNTHETIC_QUIZ_ENABLED!=='true')
    return json({error:'NOT_FOUND'},404);
  if(!isApprovedPhase4StagingHost(request,env))
    return json({error:'NOT_FOUND'},404);
  try{requireStaging(env);}catch{return noSecrets();}
  // Diagnostics default OFF, only the exact approved Preview hostname.
  // This prints static failure codes to server logs; never JWTs, UID or PII.
  const diagnose=env?.PHASE4_DEMO_AUTH_DIAGNOSTICS==='true' &&
    env?.PHASE4_PREVIEW_HOST_OPT_IN==='true' &&
    new URL(request.url).hostname===PHASE4_PILOT_PREVIEW_HOST;
  const onDiagnostic=diagnose
    ? code=>console.warn('PHASE4_DEMO_AUTH_DIAGNOSTIC:',code)
    : undefined;
  try {
    const uid=await verifyActiveDemoQuizStudent(env.AUTH_DB,request,
      {onDiagnostic});
    if(!uid)return json({error:'UNAUTHORIZED'},401);
    let data;
    try{data=await smallJson(request);}
    catch{return json({error:'INVALID_REQUEST'},400);}
    return await handleDemoQuizStudent(env.AUTH_DB,uid,data);
  }catch(error){
    console.error('Synthetic demo quiz student failure type:',
      error?.name||'unknown');
    return failSafe();
  }
}
