import {
  requireStaging,json,checkRequest,smallJson,noSecrets,failSafe,
} from '../../_shared/auth.mjs';
import {
  verifyActiveDemoQuizStudent,handleDemoQuizStudent,
} from '../../_shared/synthetic-quiz.mjs';

// Synthetic cross-device graded-quiz proof ONLY, flag OFF by default.
// Current live DEMO student login remains unchanged.
export async function onRequestPost({request,env}) {
  const bad=checkRequest(request);
  if(bad)return bad;
  if(env?.PHASE4_SYNTHETIC_QUIZ_ENABLED!=='true')
    return json({error:'NOT_FOUND'},404);
  try{requireStaging(env);}catch{return noSecrets();}
  try {
    const uid=await verifyActiveDemoQuizStudent(env.AUTH_DB,request);
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
