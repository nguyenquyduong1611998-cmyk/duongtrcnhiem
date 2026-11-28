// Phase 4K — exact, separately opted-in Cloudflare Pages preview alias.
// A git branch preview cannot use the canonical test Pages hostname.
// This is an ALLOWLIST of TWO exact hosts, not a *.pages.dev wildcard.
// Preview branch aliases are lowercased with "/" replaced by "-"; the
// ACTUAL alias confirmed in Cloudflare Pages check for commit 0cc4159.
// Both environments still require requireStaging(), Firebase auth and
// the default-OFF Phase 4 feature flags. No automatic deployment occurs.
export const PHASE4_PINNED_STAGING_HOST='duongtrcnhiem-test.pages.dev';
export const PHASE4_PILOT_PREVIEW_HOST=
  'feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev';

export function isApprovedPhase4StagingHost(request,env){
  const desired=env?.PHASE4_STAGING_HOSTNAME;
  if(desired!==PHASE4_PINNED_STAGING_HOST&&
     desired!==PHASE4_PILOT_PREVIEW_HOST)return false;
  // The preview host is NEVER enabled by the normal staging host variable
  // alone, including when the variable is mistakenly copied between
  // production and preview environments.
  if(desired===PHASE4_PILOT_PREVIEW_HOST &&
     env?.PHASE4_PREVIEW_HOST_OPT_IN!=='true')return false;
  try{
    const url=new URL(request.url);
    return url.protocol==='https:'&&
      url.hostname===desired&&url.port===''&&
      url.username===''&&url.password==='';
  }catch{return false;}
}
