// Phase 6F: read-only code/release audit for the Cloudflare-only architecture.
// This CLI deliberately NEVER marks an actual deployment as approved: the
// Cloudflare D1 snapshot, real load, approvals and device install are external.
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const REQUIRED=[
  'serverless/d1-phase6-timed-sessions-draft.sql',
  'serverless/d1-phase6b-synthetic-admin-drafts-draft.sql',
  'serverless/d1-phase6c-publication-metadata-draft.sql',
  'serverless/d1-phase6d-timed-submissions-draft.sql',
  'functions/api/phase6/exam.js',
  'functions/api/phase6/results/student.js',
  'functions/api/phase6/results/admin.js',
  'public/phase6f-preview.webmanifest',
  'public/phase6f-preview-icon.svg',
  'public/phase6f-preview-sw.js',
  'src/utils/phase6fPreviewPwa.ts',
  'tests/phase6f-offline-recovery-100students.test.mjs',
  'tests/phase6f-pwa-sw-security.test.mjs',
  'tests/phase6f-pwa-browser.test.ts',
  'docs/phase6f-security-backup-pwa-release-gates.md',
];
const read=(root,file)=>readFileSync(resolve(root,file),'utf8');
const presence=(root,file)=>existsSync(resolve(root,file));

export function inspectPhase6fOfflineReadiness(root=process.cwd()){
  const missing=REQUIRED.filter(path=>!presence(root,path));
  let allowlistAndOff=false;
  let pwaPolicy=false;
  let noInlinePwaInHtml=false;
  let manifestValid=false;
  if(!missing.length){
    const student=read(root,'functions/api/phase6/exam.js');
    const history=read(root,'functions/api/phase6/results/student.js');
    const admin=read(root,'functions/api/phase6/results/admin.js');
    const pwa=read(root,'src/utils/phase6fPreviewPwa.ts');
    const sw=read(root,'public/phase6f-preview-sw.js');
    const html=read(root,'index.html');
    const manifest=JSON.parse(read(root,'public/phase6f-preview.webmanifest'));
    allowlistAndOff=[
      [student,'PHASE6_STUDENT_TIMED_EXAM_ENABLED'],
      [history,'PHASE6_RESULTS_READONLY_ENABLED'],
      [admin,'PHASE6_ADMIN_RESULTS_ENABLED'],
    ].every(([src,flag])=>src.includes(flag+"!=='true'")&&
      src.includes('PHASE4_PILOT_PREVIEW_HOST')&&
      src.includes('bindStagingDatabaseForRequest'));
    pwaPolicy=pwa.includes("flag==='true'")&&
      pwa.includes("protocol==='https:'")&&
      pwa.includes('isPhase5DemoPreviewHostname')&&
      sw.includes("request.mode==='navigate'")&&
      sw.includes("request.headers.has('authorization')")&&
      sw.includes("url.pathname.startsWith('/api/')");
    noInlinePwaInHtml=!html.includes('phase6f-preview.webmanifest')&&
      !html.includes('phase6f-preview-sw.js');
    manifestValid=manifest.start_url==='/'&&manifest.scope==='/'&&
      manifest.display==='standalone'&&Array.isArray(manifest.icons)&&
      manifest.icons.some(icon=>icon.src==='/phase6f-preview-icon.svg');
  }
  const checks={
    draftSchemasAndOfflineTestsPresent:missing.length===0,
    serverApiDefaultOffAndPinnedPreview:allowlistAndOff,
    previewPwaSecureAssetOnly:pwaPolicy,
    pwaDoesNotAdvertiseInHtmlByDefault:noInlinePwaInHtml,
    previewManifestBaseline:manifestValid,
  };
  const codeChecksPass=Object.values(checks).every(Boolean);
  return {
    status:codeChecksPass?'CODE_AUDIT_ONLY':'CODE_CHECK_BLOCKED',
    checks,missingFileCount:missing.length,
    architecture:'Cloudflare Pages + Functions + D1 + Firebase; no VPS',
    releaseGates:{
      freshD1PreviewBackupVerified:false,
      independentLiveD1RestoreVerified:false,
      migrations6aTo6dApprovedAndApplied:false,
      signedStudentAdminLiveNegativeTests:false,
      actual30To100UserLoadVerified:false,
      realDevicePwaInstallVerified:false,
      securityAndDataClassificationApproved:false,
    },
    deploymentAllowed:false,
    message:'CI-only report. Offline checks do not authorize enabling D1, deploying Production or using real data.',
  };
}
async function main(){
  const report=inspectPhase6fOfflineReadiness();
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if(report.status!=='CODE_AUDIT_ONLY')process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  await main();
