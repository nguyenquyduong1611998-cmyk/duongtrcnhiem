// Phase 4I — fail-closed host pin for the isolated DEMO pilot.
// duongtrcnhiem-test.pages.dev is the existing separate Cloudflare Pages
// test project (its Pages "production" slot is NOT the live GitHub Pages site).
// Any different preview/custom domain needs separate, reviewed code changes.
// The hostname is taken from Request.url, never from spoofable forwarded headers.
export const PHASE4_PINNED_STAGING_HOST='duongtrcnhiem-test.pages.dev';

export function isApprovedPhase4StagingHost(request,env){
  if(env?.PHASE4_STAGING_HOSTNAME!==PHASE4_PINNED_STAGING_HOST)
    return false;
  try{
    const url=new URL(request.url);
    return url.protocol==='https:' &&
      url.hostname===PHASE4_PINNED_STAGING_HOST &&
      url.port==='' &&
      (url.username||'')==='' &&
      (url.password||'')==='';
  }catch{return false;}
}
