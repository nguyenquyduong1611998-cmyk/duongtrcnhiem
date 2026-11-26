// Phase 7B — optional, credential-free Cloudflare Pages surface HEAD probe.
// NOT run by CI; without explicit --allow-network, never fetches anything.
// HEAD is read-only and never sends body, JWT, cookies, SQL, student identifiers.
// 200/302/403/404/405 cannot prove D1 identity or Access policy correctness.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PHASE4_PILOT_PREVIEW_HOST}
  from '../functions/_shared/phase4-host-guard.mjs';

const URL_BASE='https://'+PHASE4_PILOT_PREVIEW_HOST;
const PATHS=Object.freeze([
  ['preview_home','/'],
  ['preview_manifest','/phase6f-preview.webmanifest'],
  ['preview_service_worker','/phase6f-preview-sw.js'],
  ['schema_preflight','/api/phase7/preflight'],
  ['student_exam','/api/phase6/exam'],
  ['student_history','/api/phase6/results/student'],
  ['admin_results','/api/phase6/results/admin'],
]);
const classify=status=>{
  if(status===null)return 'NO_NETWORK_RESPONSE';
  if([301,302,303,307,308,401,403].includes(status))
    return 'ACCESS_OR_AUTH_GATE_INCONCLUSIVE';
  if(status===404)return 'OFF_OR_NOT_DEPLOYED_INCONCLUSIVE';
  if(status===405)return 'METHOD_DENIED_OR_ROUTE_UNKNOWN';
  if(status===429)return 'RATE_LIMITED';
  if(status>=500)return 'SERVER_UNAVAILABLE';
  if(status>=200&&status<300)return 'HTTP_SURFACE_RESPONDED';
  return 'UNEXPECTED_HTTP_STATUS';
};
export async function inspectPreviewSurfaceHead(transport){
  if(typeof transport!=='function')throw new Error('TRANSPORT_REQUIRED');
  const probes=[];
  for(const [route,path] of PATHS){
    const requestOptions={
      method:'HEAD',
      redirect:'manual',
      credentials:'omit',
      cache:'no-store',
      headers:{'cache-control':'no-store'},
      signal:AbortSignal.timeout(7000),
    };
    let status=null;
    try{
      const response=await transport(URL_BASE+path,requestOptions);
      if(Number.isInteger(response?.status)&&response.status>=100&&response.status<=599)
        status=response.status;
    }catch{/* Never reflect remote response, cookies or error stacks. */}
    probes.push({route,httpStatus:status,result:classify(status)});
  }
  return {
    mode:'phase7b-public-head-observation',
    host:PHASE4_PILOT_PREVIEW_HOST,
    probes,
    allRequestsHeadOnly:true,
    signedAuthVerified:false,
    previewAccessPolicyVerified:false,
    deployedCommitVerified:false,
    previewD1BindingVerified:false,
    backupVerified:false,
    safeToEnableFeatures:false,
    note:'HEAD-only observations do not prove feature flags, live D1, identity, backup or Cloudflare Access protection.',
  };
}
async function main(){
  const args=process.argv.slice(2);
  if(args.length!==1||args[0]!=='--allow-network'){
    process.stdout.write(
      'No network performed. With operator approval: node scripts/phase7b-preview-surface-probe.mjs --allow-network\n'
    );
    process.exitCode=args.includes('--help')?0:2;
    return;
  }
  const report=await inspectPreviewSurfaceHead(fetch);
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  // This tool always remains an observation; never passes deployment gates.
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  await main();
