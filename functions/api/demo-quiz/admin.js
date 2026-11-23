import {bindStagingDatabaseForRequest} from '../../_shared/staging-db-binding.mjs';
import {
  requireStaging,json,checkRequest,smallJson,verifiedGoogleAdmin,
  noSecrets,failSafe,
} from '../../_shared/auth.mjs';
import {handleDemoQuizAdmin} from '../../_shared/synthetic-quiz.mjs';
import {isApprovedPhase4StagingHost}
  from '../../_shared/phase4-host-guard.mjs';

// Read-only Admin dashboard of synthetic D1 graded attempts.
// A browser-local Admin role never grants access to this endpoint.
export async function onRequestPost({request,env}) {
  env=bindStagingDatabaseForRequest(env,request);
  const bad=checkRequest(request);
  if(bad)return bad;
  if(env?.PHASE4_SYNTHETIC_QUIZ_ENABLED!=='true')
    return json({error:'NOT_FOUND'},404);
  try{requireStaging(env);}catch{return noSecrets();}
  if(!isApprovedPhase4StagingHost(request,env))
    return json({error:'NOT_FOUND'},404);
  if(!await verifiedGoogleAdmin(request))
    return json({error:'ADMIN_AUTH_REQUIRED'},403);
  let data;
  try{data=await smallJson(request);}
  catch{return json({error:'INVALID_REQUEST'},400);}
  try{return await handleDemoQuizAdmin(env.AUTH_DB,data);}
  catch(error){
    console.error('Synthetic demo quiz admin failure type:',
      error?.name||'unknown');
    return failSafe();
  }
}
