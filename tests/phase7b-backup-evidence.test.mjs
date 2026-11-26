// Phase 7B local D1 export guard. Tests only synthetic SQL files.
// Never uses Cloudflare, imports SQL, or exposes filenames/row data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,rmSync,readFileSync,writeFileSync,copyFileSync,
  symlinkSync,statSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {inspectPreviewBackupCopies}
  from '../scripts/phase7b-backup-evidence.mjs';

const base=readFileSync('serverless/d1-staging-schema.sql','utf8');
const quiz=readFileSync('serverless/d1-phase4-synthetic-graded-quiz.sql','utf8');
const marker="INSERT INTO demo_students VALUES ('PRIVATE_USER', 'PRIVATE_UID', 'PRIVATE_SALT', 'PRIVATE_HASH', 310000, 1, 1800000000);";
const fake=base+'\n'+quiz+'\n'+marker;
function fixture(){
  const directory=mkdtempSync(join(tmpdir(),'phase7b-local-evidence-'));
  const source=join(directory,'sensitive-preview-export.sql');
  const copy=join(directory,'independent-copy.sql');
  writeFileSync(source,fake);
  copyFileSync(source,copy);
  return {directory,source,copy,done:()=>rmSync(directory,{recursive:true,force:true})};
}
function noLeak(report,f){
  assert.equal(report.deploymentAllowed,false);
  assert.equal(report.d1IdentityVerified,false);
  assert.equal(report.exportFreshnessVerified,false);
  assert.equal(report.cloudflareBackupVerified,false);
  assert.equal(report.isolatedRestoreVerified,false);
  assert.equal(report.previewAccessVerified,false);
  const payload=JSON.stringify(report);
  for(const secret of [
    'PRIVATE_USER','PRIVATE_UID','PRIVATE_SALT','PRIVATE_HASH',
    f.directory,f.source,f.copy,'INSERT INTO',
  ])assert.equal(payload.includes(secret),false,secret);
}
test('identical local DEMO SQL copies pass static structural inspection ONLY',()=>{
  const f=fixture();
  try{
    const before=readFileSync(f.source);
    const copyBefore=readFileSync(f.copy);
    const report=inspectPreviewBackupCopies(f.source,f.copy);
    assert.equal(report.status,'OFFLINE_SQL_COPY_MATCH_ONLY');
    assert.equal(report.localCopyBytesMatch,true);
    assert.equal(report.localExportStructurePlausible,true);
    noLeak(report,f);
    assert.deepEqual(readFileSync(f.source),before);
    assert.deepEqual(readFileSync(f.copy),copyBefore);
    assert.equal(statSync(f.source).size,before.length);
  }finally{f.done();}
});
test('single modified byte, non-matching length, same source path fail closed',()=>{
  const f=fixture();
  try{
    writeFileSync(f.copy,fake.replace('PRIVATE_USER','PRIVATE_NAME'));
    const altered=inspectPreviewBackupCopies(f.source,f.copy);
    assert.equal(altered.status,'BLOCKED');
    assert.equal(altered.reason,'LOCAL_COPY_BYTES_DIFFER');
    noLeak(altered,f);
    writeFileSync(f.copy,fake+' ');
    assert.equal(inspectPreviewBackupCopies(f.source,f.copy).reason,'LOCAL_COPY_BYTES_DIFFER');
    assert.equal(inspectPreviewBackupCopies(f.source,f.source).reason,
      'SOURCE_AND_COPY_MUST_BE_DISTINCT');
  }finally{f.done();}
});
test('reject text export missing Preview tables and suspicious operations',()=>{
  const f=fixture();
  try{
    for(const content of [
      'CREATE TABLE demo_students(username TEXT);',
      base+'\n'+quiz+'\nDROP TABLE demo_students;',
      base+'\n'+quiz+'\nUPDATE demo_students SET active=0;',
      base+'\n'+quiz+'\nATTACH DATABASE \'PRIVATE_PATH\' AS other;',
    ]){
      writeFileSync(f.source,content);
      writeFileSync(f.copy,content);
      const result=inspectPreviewBackupCopies(f.source,f.copy);
      assert.equal(result.status,'BLOCKED');
      assert.equal(result.reason,'EXPORT_STATIC_STRUCTURE_NOT_ACCEPTED');
      noLeak(result,f);
    }
  }finally{f.done();}
});
test('reject symbolic links, missing file, truncated bytes and invalid UTF8',()=>{
  const f=fixture();
  try{
    const link=join(f.directory,'alias.sql');
    symlinkSync(f.source,link);
    assert.equal(inspectPreviewBackupCopies(link,f.copy).status,'BLOCKED');
    assert.equal(inspectPreviewBackupCopies(f.source,join(f.directory,'missing')).status,
      'BLOCKED');
    writeFileSync(f.copy,'tiny');
    assert.equal(inspectPreviewBackupCopies(f.source,f.copy).status,'BLOCKED');
    writeFileSync(f.source,Buffer.concat([
      Buffer.from(fake,'utf8'),Buffer.from([255,254,253]),
    ]));
    copyFileSync(f.source,f.copy);
    const notUtf8=inspectPreviewBackupCopies(f.source,f.copy);
    assert.equal(notUtf8.reason,'EXPORT_NOT_VALID_UTF8');
    noLeak(notUtf8,f);
  }finally{f.done();}
});
test('CLI emits only safe aggregate state even with sensitive local SQL',()=>{
  const f=fixture();
  try{
    const run=spawnSync(process.execPath,
      ['scripts/phase7b-backup-evidence.mjs',f.source,f.copy],
      {encoding:'utf8',timeout:20000});
    assert.equal(run.status,0,run.stderr);
    const report=JSON.parse(run.stdout);
    assert.equal(report.status,'OFFLINE_SQL_COPY_MATCH_ONLY');
    noLeak(report,f);
    assert.equal(run.stderr,'');
    for(const secret of ['PRIVATE_USER','PRIVATE_UID','PRIVATE_HASH',f.directory])
      assert.equal((run.stdout+run.stderr).includes(secret),false);
  }finally{f.done();}
});
test('CLI needs two local paths and never does network or D1 writes',()=>{
  const run=spawnSync(process.execPath,
    ['scripts/phase7b-backup-evidence.mjs'],
    {encoding:'utf8',timeout:20000});
  assert.equal(run.status,2);
  assert.match(run.stdout,/offline only/);
  const src=readFileSync('scripts/phase7b-backup-evidence.mjs','utf8');
  assert.doesNotMatch(src,/\bfetch\s*\(|wrangler|child_process|spawnSync|execFileSync|DatabaseSync|\bexec\s*\(/);
});
