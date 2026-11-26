// Phase 7C: public GitHub commit/check-run evidence only.
// This script NEVER calls Cloudflare, reads D1, handles secrets or writes data.
// By default there is NO network. Opt-in fetch reads just two GitHub REST
// endpoints for the hard-coded Staging branch and its exact HEAD SHA.
// A green Cloudflare Pages check is NOT proof of the live Preview alias,
// Cloudflare Access, bindings, schema, backup or operational readiness.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const REPO='nguyenquyduong1611998-cmyk/duongtrcnhiem';
const BRANCH='feature/staging-demo-quiz-pilot';
const API='https://api.github.com/repos/'+REPO;
const SHA=/^[a-f0-9]{40}$/;
const MAX_JSON_BYTES=512*1024;

export const githubEvidenceConstants=Object.freeze({repository:REPO,branch:BRANCH});
export function evaluateGitHubDeploymentEvidence(firstBranch,checkRuns,lastBranch){
  const a=firstBranch?.commit?.sha;
  const b=lastBranch?.commit?.sha;
  if(firstBranch?.name!==BRANCH||lastBranch?.name!==BRANCH||
     typeof a!=='string'||!SHA.test(a)||a!==b)
    return blocked('BRANCH_IDENTITY_OR_HEAD_MISMATCH');
  if(!Array.isArray(checkRuns?.check_runs)||checkRuns.check_runs.length>100)
    return blocked('CHECK_RUNS_MALFORMED');
  const targetNames=['Cloudflare Pages','demo-quiz-ci'];
  const observed={};
  for(const name of targetNames){
    const matching=checkRuns.check_runs.filter(r=>r?.name===name);
    // Ambiguous status is not treated as success; one check for this SHA.
    observed[name]=matching.length===1&&matching[0].head_sha===a&&
      matching[0].status==='completed'&&matching[0].conclusion==='success'
      ?'SUCCESS':'UNVERIFIED';
  }
  const status=targetNames.every(name=>observed[name]==='SUCCESS')
    ?'GITHUB_CHECKS_REPORTED_SUCCESS'
    :'GITHUB_CHECKS_NOT_CONFIRMED';
  return {
    mode:'phase7c-github-check-only',
    status,
    branch:BRANCH,
    commitSha:a,
    cloudflarePagesCheck:observed['Cloudflare Pages'],
    githubActionsCheck:observed['demo-quiz-ci'],
    livePreviewAliasVerified:false,
    cloudflareAccessVerified:false,
    previewDatabaseBindingVerified:false,
    d1BackupVerified:false,
    d1RestoreVerified:false,
    multiDeviceVerified:false,
    realLoadVerified:false,
    deploymentAuthorized:false,
  };
}
function blocked(reason){
  return {
    mode:'phase7c-github-check-only',
    status:'BLOCKED',
    reason,
    livePreviewAliasVerified:false,
    cloudflareAccessVerified:false,
    previewDatabaseBindingVerified:false,
    d1BackupVerified:false,
    d1RestoreVerified:false,
    multiDeviceVerified:false,
    realLoadVerified:false,
    deploymentAuthorized:false,
  };
}
async function safeGetJson(fetcher,url){
  if(!url.startsWith(API+'/')||url.includes('?')&&
     !url.endsWith('?per_page=100'))
    throw new Error('UNAPPROVED_GITHUB_API_TARGET');
  const response=await fetcher(url,{
    method:'GET',redirect:'error',credentials:'omit',cache:'no-store',
    headers:{
      accept:'application/vnd.github+json',
      'x-github-api-version':'2022-11-28',
    },
    signal:AbortSignal.timeout(8000),
  });
  if(!response?.ok||!(Number(response.headers?.get('content-length')||0)<=MAX_JSON_BYTES))
    throw new Error('GITHUB_UNAVAILABLE');
  const raw=await response.text();
  if(raw.length>MAX_JSON_BYTES)
    throw new Error('GITHUB_RESPONSE_OVERSIZED');
  return JSON.parse(raw);
}
export async function inspectGithubStagingDeployment(fetcher){
  const branchUrl=API+'/branches/'+BRANCH;
  const head=await safeGetJson(fetcher,branchUrl);
  const sha=head?.commit?.sha;
  if(head?.name!==BRANCH||typeof sha!=='string'||!SHA.test(sha))
    return blocked('BRANCH_IDENTITY_OR_HEAD_MISMATCH');
  const checks=await safeGetJson(fetcher,API+'/commits/'+sha+'/check-runs?per_page=100');
  const again=await safeGetJson(fetcher,branchUrl);
  return evaluateGitHubDeploymentEvidence(head,checks,again);
}
async function main(){
  if(process.argv.length!==3||process.argv[2]!=='--allow-github-metadata'){
    process.stdout.write(
      'No network performed. Optional public GitHub-only check: '+
      'node scripts/phase7c-github-deployment-evidence.mjs --allow-github-metadata\n'
    );
    process.exitCode=process.argv.includes('--help')?0:2;
    return;
  }
  try{
    const report=await inspectGithubStagingDeployment(fetch);
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
    if(report.status!=='GITHUB_CHECKS_REPORTED_SUCCESS')process.exitCode=1;
  }catch{
    process.stdout.write(JSON.stringify(blocked('GITHUB_READ_UNAVAILABLE'))+'\n');
    process.exitCode=1;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  await main();
