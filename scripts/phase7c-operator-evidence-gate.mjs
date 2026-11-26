// Phase 7C manual evidence ledger: enumerate operator observations only.
// Data stays on the operator's local machine; never uploads to GitHub or D1.
// Even when every statement is marked REVIEWED, the ledger is self-reported
// and cannot authorize a migration, enable an API or expose real data.
import {lstatSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const BRANCH='feature/staging-demo-quiz-pilot';
const EXPECTED_KEYS=[
  'exactPreviewAlias',
  'deployedCommitInCloudflareDashboard',
  'previewAccessPolicyAndHashUrls',
  'canonicalTestHostnameProtection',
  'previewD1BindingMatchesExpectedIdPrivately',
  'stagingFirebaseConfiguration',
  'freshPrivateD1Export',
  'independentRestoreAndIntegrity',
  'signedAdminStudentABDeviceTests',
  'realPwaDeviceInstallAndAccountSwitch',
  'authorizedNetworkLoad30to100',
  'dataHandlingAuthorization',
];
const VALUES=['NOT_CHECKED','REVIEWED_BY_OPERATOR','BLOCKED'];
const MAX_BYTES=16384;
const SHA=/^[a-f0-9]{40}$/;

function output(status,missing=[],blocked=[]){
  return {
    mode:'phase7c-private-operator-evidence-ledger',
    status,
    reviewedCount:EXPECTED_KEYS.length-missing.length-blocked.length,
    notChecked:missing,
    blocked,
    totalChecks:EXPECTED_KEYS.length,
    evidenceIndependentlyVerified:false,
    cloudflareAccountAuthenticatedByThisTool:false,
    d1BackupRestoredByThisTool:false,
    externalLoadExecutedByThisTool:false,
    deployAuthorized:false,
  };
}
function invalid(){
  return {
    mode:'phase7c-private-operator-evidence-ledger',
    status:'BLOCKED_INVALID_LEDGER',
    evidenceIndependentlyVerified:false,
    cloudflareAccountAuthenticatedByThisTool:false,
    d1BackupRestoredByThisTool:false,
    externalLoadExecutedByThisTool:false,
    deployAuthorized:false,
  };
}
export function inspectPhase7cOperatorEvidence(data){
  if(!data||typeof data!=='object'||Array.isArray(data)||
     Object.keys(data).sort().join(',')!==
       ['schemaVersion','environment','branch','gitCommitSha','operatorReview'].sort().join(',')||
     data.schemaVersion!==1||data.environment!=='cloudflare-pages-branch-preview'||
     data.branch!==BRANCH||
     (data.gitCommitSha!==null&&
       (typeof data.gitCommitSha!=='string'||!SHA.test(data.gitCommitSha))))
    return invalid();
  const review=data.operatorReview;
  if(!review||typeof review!=='object'||Array.isArray(review)||
     Object.keys(review).sort().join(',')!==[...EXPECTED_KEYS].sort().join(',')||
     !EXPECTED_KEYS.every(key=>VALUES.includes(review[key])))
    return invalid();
  const missing=EXPECTED_KEYS.filter(key=>review[key]==='NOT_CHECKED');
  const blocked=EXPECTED_KEYS.filter(key=>review[key]==='BLOCKED');
  const status=blocked.length?'STOP_OPERATOR_REPORTED_BLOCKERS':
    missing.length?'OPERATOR_EVIDENCE_INCOMPLETE':
      data.gitCommitSha===null?'STOP_DEPLOYED_COMMIT_UNRECORDED':
        'ALL_SELF_REPORTED_REQUIRES_INDEPENDENT_AUTHORIZATION';
  return output(status,missing,blocked);
}
export function inspectLocalPhase7cEvidence(file){
  try{
    if(typeof file!=='string'||!file.trim())return invalid();
    const stat=lstatSync(file);
    if(!stat.isFile()||stat.size<50||stat.size>MAX_BYTES)return invalid();
    const contents=readFileSync(file);
    const text=new TextDecoder('utf-8',{fatal:true}).decode(contents);
    return inspectPhase7cOperatorEvidence(JSON.parse(text));
  }catch{return invalid();}
}
async function main(){
  const args=process.argv.slice(2);
  if(args.length>1||args.includes('--help')){
    process.stdout.write(
      'Usage (OFFLINE, no secrets): node scripts/phase7c-operator-evidence-gate.mjs [local-sanitized-ledger.json]\n'
    );
    if(!args.includes('--help'))process.exitCode=2;
    return;
  }
  const file=args[0]??'docs/phase7c-operator-evidence-template.json';
  const report=inspectLocalPhase7cEvidence(file);
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  // Report is a review tool only, never operational approval. Nonzero if
  // structurally invalid or any operator-reported issue is unresolved.
  if(report.status==='BLOCKED_INVALID_LEDGER'||
     report.status==='STOP_OPERATOR_REPORTED_BLOCKERS')process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  await main();
