// Phase 7B — OFFLINE-only D1 Preview SQL export copy-integrity inspection.
// Does not contact Cloudflare, use a database, parse INSERT values, execute
// supplied SQL, copy files or log filenames, paths, passwords or SQL content.
// Byte equality and structural plausibility do NOT prove restore, freshness,
// origin database identity, Cloudflare Access configuration or deploy safety.
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectD1SqlExportText}
  from './phase4-inspect-d1-sql-export.mjs';

const MAX_BYTES=32*1024*1024;
const DECODER=new TextDecoder('utf-8',{fatal:true});

function safeRead(path){
  if(typeof path!=='string'||!path.trim())
    throw new Error('INVALID_LOCAL_FILE');
  const file=resolve(path);
  const stat=lstatSync(file);
  if(!stat.isFile()||stat.size<32||stat.size>MAX_BYTES)
    throw new Error('INVALID_LOCAL_FILE');
  return {
    file:realpathSync(file),
    bytes:readFileSync(file),
  };
}
const blocked=(reason,copyMatch=false)=>({
  status:'BLOCKED',
  reason,
  profile:'preview-demo',
  localCopyBytesMatch:copyMatch,
  localExportStructurePlausible:false,
  d1IdentityVerified:false,
  exportFreshnessVerified:false,
  cloudflareBackupVerified:false,
  isolatedRestoreVerified:false,
  previewAccessVerified:false,
  deploymentAllowed:false,
});
export function inspectPreviewBackupCopies(sourcePath,copyPath){
  let source,copy;
  try{
    source=safeRead(sourcePath);
    copy=safeRead(copyPath);
  }catch{return blocked('LOCAL_COPY_UNREADABLE_OR_INVALID');}
  if(source.file===copy.file)
    return blocked('SOURCE_AND_COPY_MUST_BE_DISTINCT');
  if(source.bytes.length!==copy.bytes.length)
    return blocked('LOCAL_COPY_BYTES_DIFFER');
  const digestA=createHash('sha256').update(source.bytes).digest();
  const digestB=createHash('sha256').update(copy.bytes).digest();
  if(!digestA.equals(digestB))
    return blocked('LOCAL_COPY_BYTES_DIFFER');
  let data;
  try{
    data=DECODER.decode(source.bytes).replace(/^\uFEFF/,'');
  }catch{return blocked('EXPORT_NOT_VALID_UTF8',true);}
  // Existing scanner sees only the expected Preview schema declarations.
  // It never executes export statements or returns rows/passwords.
  const structure=inspectD1SqlExportText(data,{profile:'preview-demo'});
  if(structure.status!=='SQL_EXPORT_STRUCTURE_REVIEW_ONLY')
    return blocked('EXPORT_STATIC_STRUCTURE_NOT_ACCEPTED',true);
  return {
    status:'OFFLINE_SQL_COPY_MATCH_ONLY',
    profile:'preview-demo',
    localCopyBytesMatch:true,
    localExportStructurePlausible:true,
    d1IdentityVerified:false,
    exportFreshnessVerified:false,
    cloudflareBackupVerified:false,
    isolatedRestoreVerified:false,
    previewAccessVerified:false,
    deploymentAllowed:false,
    note:'Two local copies match; this is NOT a D1 restore or evidence of the source database. Manual Cloudflare checks still required.',
  };
}
async function main(){
  const args=process.argv.slice(2);
  if(args.length!==2||args.includes('--help')){
    process.stdout.write('Usage (offline only): node scripts/phase7b-backup-evidence.mjs <local-preview-export.sql> <independent-copy.sql>\n');
    if(!args.includes('--help'))process.exitCode=2;
    return;
  }
  const report=inspectPreviewBackupCopies(args[0],args[1]);
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if(report.status!=='OFFLINE_SQL_COPY_MATCH_ONLY')process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  await main();
