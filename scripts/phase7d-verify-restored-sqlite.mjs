// Phase 7D: independently inspect TWO ALREADY EXISTING local SQLite files.
// This command NEVER imports SQL, creates/restores a database, runs migrations,
// accesses Cloudflare, or modifies the source/candidate. Only fixed read-only
// queries are allowed. The comparison does NOT establish the files' provenance,
// freshness, isolation from Cloudflare, or authorization for any live deployment.
import {DatabaseSync} from 'node:sqlite';
import {
  lstatSync,statSync,realpathSync,openSync,readSync,closeSync,
} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectPhase7PreviewSchema}
  from '../functions/_shared/phase7-preview-d1-schema-preflight.mjs';

const MAX_BYTES=256*1024*1024;
const MAGIC=Buffer.from('SQLite format 3\0','ascii');
const BASELINE_TABLES=Object.freeze([
  'demo_students','login_attempts','synthetic_graded_attempts',
  'phase5_content_topics','phase5_content_versions',
  'phase5_content_questions','phase5_content_answer_keys',
  'phase5_content_attempts',
]);
const VALID_SCHEMA=new Set([
  'SCHEMA_CANDIDATE_REVIEW_ONLY','MIGRATION_REVIEW_REQUIRED',
]);
const BLOCKED=reason=>({
  mode:'phase7d-local-restored-sqlite-verification',
  status:'BLOCKED',
  reason,
  sourceIntegrityVerified:false,
  candidateIntegrityVerified:false,
  baselineRowCountsMatch:false,
  phase6SchemaStatus:'NOT_VERIFIED',
  d1SourceIdentityVerified:false,
  backupFreshnessVerified:false,
  independentCloudflareRestoreVerified:false,
  migrationsExecuted:false,
  deploymentAllowed:false,
});
function checkedPath(path){
  if(typeof path!=='string'||!path.trim())throw Error('INVALID_FILE');
  const actual=resolve(path),lstat=lstatSync(actual),stat=statSync(actual);
  if(!lstat.isFile()||!stat.isFile()||stat.size<MAGIC.length||
     stat.size>MAX_BYTES)throw Error('INVALID_FILE');
  const fd=openSync(actual,'r');
  try{
    const b=Buffer.alloc(MAGIC.length);
    if(readSync(fd,b,0,b.length,0)!==b.length||!b.equals(MAGIC))
      throw Error('NOT_SQLITE');
  }finally{closeSync(fd);}
  return {path:realpathSync(actual),stat};
}
function sha256File(path){
  const fd=openSync(path,'r'),hash=createHash('sha256'),buffer=Buffer.alloc(65536);
  try{
    let count=0;
    while((count=readSync(fd,buffer,0,buffer.length,null))>0)
      hash.update(buffer.subarray(0,count));
    return hash.digest('hex');
  }finally{closeSync(fd);}
}
function dbAdapter(db){
  return {
    prepare(sql){
      // The Phase7A inspector has a fixed allowlist and never receives
      // arbitrary SQL/table names from this script's CLI input.
      if(!/^SELECT name,type,tbl_name,sql FROM sqlite_master WHERE name IN \(/.test(sql)&&
         !/^PRAGMA table_info\('[a-z0-9_]+'\)$/.test(sql))
        throw Error('UNEXPECTED_SCHEMA_QUERY');
      const stmt=db.prepare(sql);
      return {
        bind(...params){
          return {async all(){return {results:stmt.all(...params)};}};
        },
        async all(){return {results:stmt.all()};},
      };
    },
  };
}
function integrity(db){
  const quick=db.prepare('PRAGMA integrity_check').get();
  // Do not return the potentially sensitive SQLite error rows.
  if(quick?.integrity_check!=='ok')return false;
  return db.prepare('PRAGMA foreign_key_check').get()===undefined;
}
function baselineCounts(db){
  return BASELINE_TABLES.map(name=>{
    // Names are fixed constants in this module, not user-provided.
    const result=db.prepare('SELECT count(*) AS n FROM '+name).get();
    if(!Number.isSafeInteger(result?.n)||result.n<0)
      throw Error('INVALID_COUNT');
    return result.n;
  });
}
function result(status,reason,stages,statuses){
  return {
    mode:'phase7d-local-restored-sqlite-verification',
    status,
    ...(reason?{reason}:{}),
    sourceIntegrityVerified:true,
    candidateIntegrityVerified:true,
    baselineRowCountsMatch:true,
    phase6SchemaStatus:statuses.candidate,
    sourceSchemaStatus:statuses.source,
    stages,
    d1SourceIdentityVerified:false,
    backupFreshnessVerified:false,
    independentCloudflareRestoreVerified:false,
    migrationsExecuted:false,
    deploymentAllowed:false,
    note:'Files on this computer are structurally consistent only. No actual Cloudflare backup or independent restore has been proven.',
  };
}
export async function verifyPhase7dLocalSnapshots(sourcePath,candidatePath){
  let source,candidate;
  try{
    source=checkedPath(sourcePath);candidate=checkedPath(candidatePath);
  }catch{return BLOCKED('INVALID_SQLITE_FILE');}
  if(source.path===candidate.path||
     (source.stat.dev===candidate.stat.dev&&source.stat.ino===candidate.stat.ino))
    return BLOCKED('FILES_MUST_BE_INDEPENDENT');
  const sourceHash=sha256File(source.path);
  const candidateHash=sha256File(candidate.path);
  let sourceDB,candidateDB,report;
  try{
    sourceDB=new DatabaseSync(source.path,{
      readOnly:true,enableForeignKeyConstraints:true,
    });
    candidateDB=new DatabaseSync(candidate.path,{
      readOnly:true,enableForeignKeyConstraints:true,
    });
    if(!integrity(sourceDB)||!integrity(candidateDB))
      return BLOCKED('SQLITE_INTEGRITY_OR_FOREIGN_KEY_FAILED');
    const sourceSchema=await inspectPhase7PreviewSchema(dbAdapter(sourceDB));
    const candidateSchema=await inspectPhase7PreviewSchema(dbAdapter(candidateDB));
    if(!VALID_SCHEMA.has(sourceSchema.status)||
       !VALID_SCHEMA.has(candidateSchema.status))
      return BLOCKED('PHASE7_SCHEMA_MISSING_OR_MISMATCHED');
    const before=baselineCounts(sourceDB);
    const after=baselineCounts(candidateDB);
    if(!before.every((n,i)=>n===after[i]))
      return BLOCKED('BASELINE_ROW_COUNTS_CHANGED');
    report=result('LOCAL_SNAPSHOT_COMPARISON_REVIEW_ONLY',null,
      candidateSchema.stages,
      {source:sourceSchema.status,candidate:candidateSchema.status});
  }catch{
    return BLOCKED('SQLITE_READ_OR_SCHEMA_FAILURE');
  }finally{
    try{candidateDB?.close();}catch{/* no sensitive error paths */}
    try{sourceDB?.close();}catch{/* no sensitive error paths */}
  }
  // The source/candidate are checked before and after open. Never print hashes.
  try{
    if(sha256File(source.path)!==sourceHash||
       sha256File(candidate.path)!==candidateHash)
      return BLOCKED('LOCAL_FILES_CHANGED_DURING_CHECK');
  }catch{return BLOCKED('LOCAL_FILES_CHANGED_DURING_CHECK');}
  return report;
}
async function main(){
  const args=process.argv.slice(2);
  if(args.length!==2||args.includes('--help')){
    process.stdout.write(
      'Usage (OFFLINE READ-ONLY): node scripts/phase7d-verify-restored-sqlite.mjs <local-source.sqlite> <independent-restored-copy.sqlite>\n'
    );
    if(!args.includes('--help'))process.exitCode=2;
    return;
  }
  const report=await verifyPhase7dLocalSnapshots(args[0],args[1]);
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if(report.status!=='LOCAL_SNAPSHOT_COMPARISON_REVIEW_ONLY')process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  await main();
