// Phase 7G — OFFLINE-only evaluation of two separately reviewed, sanitized
// Cloudflare Preview acceptance ledgers. Never calls Cloudflare, GitHub,
// networks, D1, browsers or credentials. Review statuses are SELF-REPORTED;
// even all "PASSED_BY_OPERATOR" values can NEVER authorize deploy/migration.
// Never print SHA, file paths, operator names, raw observations or secrets.
import {lstatSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectPhase7cOperatorEvidence}
  from './phase7c-operator-evidence-gate.mjs';

const BRANCH='feature/staging-demo-quiz-pilot';
const PROJECT='duongtrcnhiem-test';
const ALIAS='feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev';
const MAX_FILE_BYTES=16384;
const SHA=/^[a-f0-9]{40}$/;
const FIELDS=Object.freeze([
  'cloudflareDashboardDeploymentMatchesHead',
  'previewAliasAccessUnauthenticated',
  'hashedPreviewUrlAccessUnauthenticated',
  'canonicalPagesHostAccessUnauthenticated',
  'customDomainsAndAccessReviewed',
  'previewD1IdComparedPrivately',
  'firebaseStagingBuildAndRuntime',
  'freshD1SqlExportValidatedPrivately',
  'separateRestoreAndIntegrityChecked',
  'phase6MigrationsReviewedAndSeparatelyApproved',
  'phase7aSchemaPreflightApprovedAndReviewed',
  'sameStudentReadsOwnExamOnSecondDevice',
  'differentStudentDeniedCrossAccount',
  'adminGoogleResultsReadOnly',
  'lostResponseSubmitRecoveryAndNoDuplicate',
  'realPwaInstallOfflineAndAccountSwitch',
  'authorizedMeasured30to60to100AndRollback',
]);
const STATUS=new Set(['NOT_CHECKED','PASSED_BY_OPERATOR','FAILED']);
const SELF_REPORT_SUCCESS='SELF_REPORTED_COMPLETE_REQUIRES_INDEPENDENT_APPROVAL';

function exactly(record,keys){
  return record!==null&&typeof record==='object'&&!Array.isArray(record)&&
    Object.keys(record).sort().join(',')===[...keys].sort().join(',');
}
function output(status,review={},extra={}){
  const values=FIELDS.map(k=>review[k]??'NOT_CHECKED');
  return {
    mode:'phase7g-private-operator-preview-acceptance',
    status,
    totalChecks:FIELDS.length,
    operatorReportedPassedCount:values.filter(x=>x==='PASSED_BY_OPERATOR').length,
    notCheckedCount:values.filter(x=>x==='NOT_CHECKED').length,
    failedCount:values.filter(x=>x==='FAILED').length,
    ...extra,
    // These are hard-coded fail-closed; changing observation JSON cannot set GO.
    expectedShaIndependentlyVerifiedByTool:false,
    cloudflareDashboardAuthenticatedByTool:false,
    cloudflareAccessVerifiedByTool:false,
    d1PreviewBindingVerifiedByTool:false,
    backupRestoredByTool:false,
    realDevicePwaVerifiedByTool:false,
    realNetworkLoadMeasuredByTool:false,
    independentAuthorizationConfirmedByTool:false,
    migrationAuthorized:false,
    productionDeploymentAuthorized:false,
    liveLoadAuthorized:false,
    deploymentAuthorized:false,
  };
}
const invalid=()=>output('BLOCKED_INVALID_EVIDENCE');
export function inspectPhase7gPreviewAcceptance(phase7c,session,expectedHeadSha=null){
  if(!exact(session,[
    'schemaVersion','environment','project','branch','previewAlias',
    'gitCommitSha','operatorReview',
  ])||session.schemaVersion!==1||
    session.environment!=='cloudflare-pages-branch-preview'||
    session.project!==PROJECT||session.branch!==BRANCH||
    session.previewAlias!==ALIAS||
    (session.gitCommitSha!==null&&
      (typeof session.gitCommitSha!=='string'||!SHA.test(session.gitCommitSha)))||
    !exact(session.operatorReview,FIELDS)||
    !FIELDS.every(k=>STATUS.has(session.operatorReview[k])))
    return invalid();

  const phase7cResult=inspectPhase7cOperatorEvidence(phase7c);
  if(phase7cResult.status==='BLOCKED_INVALID_LEDGER')return invalid();

  const extra={
    phase7cReportedReviewedCount:phase7cResult.reviewedCount,
    phase7cTotalChecks:phase7cResult.totalChecks,
  };
  const report=session.operatorReview;
  const failed=FIELDS.some(k=>report[k]==='FAILED')||
    phase7cResult.status==='STOP_OPERATOR_REPORTED_BLOCKERS';
  // A failure is safety-critical and wins over incomplete SHA status.
  if(failed)return output('STOP_OPERATOR_REPORTED_FAILURES',report,extra);
  if(expectedHeadSha!==null&&(typeof expectedHeadSha!=='string'||
     !SHA.test(expectedHeadSha)))
    return invalid();
  if(expectedHeadSha!==null&&
     (session.gitCommitSha!==expectedHeadSha||
      phase7c.gitCommitSha!==expectedHeadSha))
    return output('STOP_STALE_OR_INCONSISTENT_SHA',report,extra);
  if(expectedHeadSha===null||phase7c.gitCommitSha===null||
     session.gitCommitSha===null)
    return output('EXPECTED_HEAD_SHA_NOT_INDEPENDENTLY_SUPPLIED',report,extra);
  if(FIELDS.some(k=>report[k]==='NOT_CHECKED')||
     phase7cResult.status!=='ALL_SELF_REPORTED_REQUIRES_INDEPENDENT_AUTHORIZATION')
    return output('OPERATOR_EVIDENCE_INCOMPLETE',report,extra);
  // Self-reports can NEVER elevate privileges or verify real Cloudflare.
  return output(SELF_REPORT_SUCCESS,report,extra);
}
function readSanitized(file){
  if(typeof file!=='string'||!file.trim())throw Error('INVALID_PATH');
  const stat=lstatSync(resolve(file));
  if(!stat.isFile()||stat.nlink!==1||stat.size<50||
     stat.size>MAX_FILE_BYTES)throw Error('INVALID_FILE');
  const bytes=readFileSync(resolve(file));
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
export function inspectPhase7gPrivateEvidenceFiles(
  oldLedger,newLedger,expectedHeadSha=null,
){
  try{
    const old=readSanitized(oldLedger);
    const fresh=readSanitized(newLedger);
    return inspectPhase7gPreviewAcceptance(old,fresh,expectedHeadSha);
  }catch{return invalid();}
}
async function main(){
  const args=process.argv.slice(2);
  const defaults=[
    'docs/phase7c-operator-evidence-template.json',
    'docs/phase7g-private-live-acceptance-template.json',
  ];
  if(args.length!==0&&args.length!==3){
    process.stdout.write(
      'Usage (OFFLINE): node scripts/phase7g-preview-acceptance-gate.mjs '+
      '[<expected-github-staging-head-sha40> <private-phase7c-ledger.json> '+
      '<private-phase7g-observations.json>]\n');
    process.exitCode=2;return;
  }
  const report=args.length===0?
    inspectPhase7gPrivateEvidenceFiles(...defaults):
    inspectPhase7gPrivateEvidenceFiles(args[1],args[2],args[0]);
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if(report.status==='BLOCKED_INVALID_EVIDENCE'||
     report.status==='STOP_STALE_OR_INCONSISTENT_SHA'||
     report.status==='STOP_OPERATOR_REPORTED_FAILURES')process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  await main();
