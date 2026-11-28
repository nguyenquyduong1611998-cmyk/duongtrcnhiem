// Phase 4E: inspect a LOCAL SQLite snapshot of D1 staging without changing it.
// Never connects to Cloudflare, Firebase or GitHub, imports SQL dumps, uploads
// data, prints account identifiers, passwords, secrets or the backup filename.
// A "pass" is a LOCAL integrity report, NOT deployment authorization.
import {DatabaseSync} from 'node:sqlite';
import {openSync,readSync,closeSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectStagingDemoQuizSchema}
  from '../functions/_shared/phase4-staging-preflight.mjs';

const MAGIC=Buffer.from('SQLite format 3\0','ascii');
const MAX_BYTES=256*1024*1024;

function assertSQLiteSnapshot(file){
  if(typeof file!=='string'||!file.trim())
    throw new Error('LOCAL_BACKUP_PATH_REQUIRED');
  const stats=statSync(file);
  if(!stats.isFile()||stats.size<MAGIC.length||
     stats.size>MAX_BYTES)
    throw new Error('LOCAL_BACKUP_SIZE_OR_TYPE_INVALID');
  const fd=openSync(file,'r');
  const header=Buffer.alloc(MAGIC.length);
  try{
    if(readSync(fd,header,0,MAGIC.length,0)!==MAGIC.length||
      !header.equals(MAGIC))
      throw new Error('LOCAL_BACKUP_NOT_SQLITE_SNAPSHOT');
  }finally{closeSync(fd);}
}

function inspectError(code){return {status:'BLOCKED',reason:code,deployAllowed:false};}

export async function verifyOfflineStagingBackup(file){
  assertSQLiteSnapshot(file);
  // The database is always opened read-only. Schema and account rows are
  // inspected in place, never migrated, restored, imported, or exported.
  const sqlite=new DatabaseSync(resolve(file),{
    readOnly:true,
    enableForeignKeyConstraints:true,
  });
  try{
    const integrity=sqlite.prepare('PRAGMA integrity_check').all();
    if(integrity.length!==1||integrity[0].integrity_check!=='ok')
      return inspectError('SQLITE_INTEGRITY_FAILED');
    const fk=sqlite.prepare('PRAGMA foreign_key_check').all();
    if(fk.length!==0)
      return inspectError('FOREIGN_KEY_VIOLATIONS');
    const adapter={
      prepare(sql) {
        // The preflight is compiled from fixed queries only, never accepts
        // SQL text from the backup file or command line.
        if(!/^(SELECT|PRAGMA)\s/i.test(sql))
          throw new Error('UNEXPECTED_NON_READ_QUERY');
        return {async all(){
          return {results:sqlite.prepare(sql).all()};
        }};
      },
    };
    const report=await inspectStagingDemoQuizSchema(adapter);
    if(report.status==='BLOCKED')
      return inspectError('STAGING_SCHEMA_INCOMPATIBLE');
    return {
      status:'LOCAL_STRUCTURE_CHECK_PASSED',
      schemaStatus:report.status,
      syntheticTablePresent:report.synthetic.exists,
      syntheticRowCount:report.synthetic.rowCount,
      baselineRows:report.existingRowCounts,
      integrityVerified:true,
      foreignKeysVerified:true,
      isFreshBackupVerified:false,
      matchesLiveStagingVerified:false,
      deployAllowed:false,
      message:'Local SQLite snapshot only; still requires fresh backup, live staging checks and explicit approval.',
    };
  }finally{sqlite.close();}
}

async function main(){
  const args=process.argv.slice(2);
  if(args.length!==1||args[0]==='--help'){
    process.stdout.write('Usage: node scripts/phase4-verify-local-backup.mjs <local-snapshot.sqlite>\n');
    if(args.length!==1)process.exitCode=2;
    return;
  }
  try{
    const report=await verifyOfflineStagingBackup(args[0]);
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
    if(report.status!=='LOCAL_STRUCTURE_CHECK_PASSED')process.exitCode=1;
  }catch(e){
    // Deliberately suppress the exception message/stack: OS errors may
    // include private local filenames. No row data is ever printed.
    const code=e?.message==='LOCAL_BACKUP_NOT_SQLITE_SNAPSHOT'?
      'BACKUP_NOT_SQLITE_SNAPSHOT':
      e?.message==='LOCAL_BACKUP_SIZE_OR_TYPE_INVALID'?
        'BACKUP_SIZE_OR_TYPE_INVALID':'BACKUP_CHECK_FAILED';
    process.stdout.write(JSON.stringify(inspectError(code))+'\n');
    process.exitCode=1;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  await main();
