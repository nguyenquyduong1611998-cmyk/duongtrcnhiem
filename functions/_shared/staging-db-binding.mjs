// Phase 4N — keep the Pages test Production and PR #3 Preview D1
// bindings separate. Cloudflare currently accepts AUTH_DB_PREVIEW on
// Preview while AUTH_DB exists for the test project's Production.
//
// Always resolve by the actual Request.url hostname, NEVER a user-supplied
// header or query parameter. A Preview must NEVER fall back to AUTH_DB,
// even if the Production binding is inherited by Cloudflare's environment.
import {
  PHASE4_PINNED_STAGING_HOST,
  PHASE4_PILOT_PREVIEW_HOST,
} from './phase4-host-guard.mjs';

export function bindStagingDatabaseForRequest(env,request){
  let host;
  try{host=new URL(request?.url).hostname;}catch{host='';}
  if(host===PHASE4_PILOT_PREVIEW_HOST){
    return {...env,AUTH_DB:env?.AUTH_DB_PREVIEW??undefined};
  }
  if(host===PHASE4_PINNED_STAGING_HOST){
    return {...env,AUTH_DB:env?.AUTH_DB??undefined};
  }
  // Hashed deployment URLs and OTHER branch previews of the same Pages
  // project are intentionally denied access to either database.
  if(host.endsWith('.'+PHASE4_PINNED_STAGING_HOST)){
    return {...env,AUTH_DB:undefined};
  }
  // Preserve existing local/isolated test harnesses and canonical runtime
  // behavior elsewhere. This helper grants no auth by itself.
  return env;
}
