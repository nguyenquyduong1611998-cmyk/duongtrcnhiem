// Phase 4F — STATIC, NON-EXECUTING inspection of a local D1 SQL export.
// The dump is NEVER passed to SQLite, a shell, or any database API.
// A structural scan is NOT a restore, integrity check or deployment approval.
import {lstatSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const MAX_BYTES=32*1024*1024;
const MAX_STATEMENT_PREFIX=128*1024;
const EXPECTED=Object.freeze({
  demo_students:['username','firebase_uid','password_salt','password_hash','active','created_at'],
  login_attempts:['username','failures','first_failed','locked_until'],
  unit_accounts:['username','firebase_uid','password_salt','password_hash','active','auth_version'],
});
const SYNTHETIC=['firebase_uid','quiz_id','answer_index','score','submitted_at','marker'];
// Preview D1 was provisioned with 2 legacy DEMO tables + Phase 4 quiz.
// Do not require unit_accounts there: it belongs to the separate Phase 2 design.
const PREVIEW_EXPECTED=Object.freeze({
  demo_students:EXPECTED.demo_students,
  login_attempts:EXPECTED.login_attempts,
});
const identifier='(?:"([^"]+)"|\\x60([^\\x60]+)\\x60|\\[([^\\]]+)\\]|([A-Za-z_][A-Za-z0-9_]*))';
const createTable=new RegExp(
  '^CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?'+identifier+'\\s*\\(','i',
);
const fieldName=new RegExp('^\\s*'+identifier+'(?=\\s|$)','i');

function sqlStatements(text){
  // Split only at semicolons outside SQL string literals, quoted identifiers
  // and comments. Retain bounded prefixes, never collect long INSERT data.
  const statements=[];
  let part='',overflow=false,quote='',comment='';
  const add=c=>{if(part.length<MAX_STATEMENT_PREFIX)part+=c;
    else overflow=true;};
  const flush=()=>{
    if(part.trim())statements.push({part:part.trim(),overflow});
    part='';overflow=false;
  };
  for(let i=0;i<text.length;i++){
    const c=text[i],n=text[i+1];
    if(comment==='line'){
      if(c==='\n'||c==='\r'){comment='';add(' ');}
      continue;
    }
    if(comment==='block'){
      if(c==='*'&&n==='/'){comment='';i++;add(' ');}
      continue;
    }
    if(quote){
      add(c);
      if(c===quote){
        if(n===quote){add(n);i++;}
        else quote='';
      }
      continue;
    }
    if(c==='-'&&n==='-'){comment='line';i++;add(' ');continue;}
    if(c==='/'&&n==='*'){comment='block';i++;add(' ');continue;}
    if(c==="'"||c==='"'||c.charCodeAt(0)===96){
      quote=c;add(c);continue;
    }
    if(c==='['){quote=']';add(c);continue;}
    if(c===';'){flush();continue;}
    add(c);
  }
  const unclosed=Boolean(quote||comment==='block');
  flush();
  return {statements,unclosed};
}
function unquote(m){return m.slice(1,5).find(x=>x!==undefined)||null;}
function declaredColumns(statement,from){
  const parts=[];
  let depth=1,quote='',part='';
  for(let i=from;i<statement.length;i++){
    const c=statement[i],n=statement[i+1];
    if(quote){
      part+=c;
      if(c===quote){
        if(n===quote){part+=n;i++;}
        else quote='';
      }
      continue;
    }
    if(c==="'"||c==='"'||c.charCodeAt(0)===96){quote=c;part+=c;continue;}
    if(c==='['){quote=']';part+=c;continue;}
    if(c==='('){depth++;part+=c;continue;}
    if(c===')'){
      depth--;
      if(depth===0){parts.push(part);break;}
      if(depth<0)return null;
      part+=c;continue;
    }
    if(c===','&&depth===1){parts.push(part);part='';continue;}
    part+=c;
  }
  if(depth!==0||quote)return null;
  const fields=new Set();
  for(const part of parts){
    const match=fieldName.exec(part);
    if(!match)continue;
    const field=unquote(match)?.toLowerCase();
    if(field && !['constraint','foreign','primary','unique','check'].includes(field))
      fields.add(field);
  }
  return fields;
}

export function inspectD1SqlExportText(source,{profile='canonical'}={}){
  if(profile!=='preview-demo'&&profile!=='canonical')
    return {status:'BLOCKED',reason:'INVALID_PROFILE',deployAllowed:false};
  const requirements=profile==='preview-demo'?PREVIEW_EXPECTED:EXPECTED;
  if(typeof source!=='string'||source.length===0||source.includes('\0'))
    return {status:'BLOCKED',reason:'NOT_SQL_TEXT',deployAllowed:false};
  const {statements,unclosed}=sqlStatements(source);
  if(unclosed)return {status:'BLOCKED',reason:'UNTERMINATED_SQL_TEXT',deployAllowed:false};
  const declarations=new Map();
  let unsafe=false,duplicate=false,oversize=false;
  for(const {part,overflow} of statements){
    if(/^(?:ATTACH|DETACH|VACUUM|DROP|ALTER|REINDEX|LOAD_EXTENSION|DELETE|UPDATE|REPLACE)\b/i.test(part)||
       /^INSERT\s+(?:OR\s+REPLACE\s+)?INTO\s+(?:sqlite_master|sqlite_schema)\b/i.test(part)||
       /^CREATE\s+VIRTUAL\s+TABLE\b/i.test(part)||
       /^PRAGMA\s+(?:writable_schema|trusted_schema)\b/i.test(part))
      unsafe=true;
    const match=createTable.exec(part);
    if(!match)continue;
    const name=unquote(match)?.toLowerCase();
    if(!name||!(name in EXPECTED) && name!=='synthetic_graded_attempts')
      continue;
    if(overflow){oversize=true;continue;}
    if(declarations.has(name)){duplicate=true;continue;}
    declarations.set(name,declaredColumns(part,match[0].length));
  }
  const tables={};
  let baselineComplete=true;
  for(const [name,fields] of Object.entries(requirements)){
    const present=declarations.has(name);
    const columns=declarations.get(name);
    const requiredColumnsPresent=columns instanceof Set&&
      fields.every(field=>columns.has(field));
    tables[name]={declared:present,requiredColumnsPresent};
    if(!requiredColumnsPresent)baselineComplete=false;
  }
  const columns=declarations.get('synthetic_graded_attempts');
  const syntheticDeclared=declarations.has('synthetic_graded_attempts');
  const syntheticColumnsPresent=columns instanceof Set&&
    SYNTHETIC.every(field=>columns.has(field));
  const blocked=unsafe||oversize||duplicate||!baselineComplete||
    (syntheticDeclared&&!syntheticColumnsPresent)||
    (profile==='preview-demo'&&!syntheticColumnsPresent);
  return {
    status:blocked?'BLOCKED':'SQL_EXPORT_STRUCTURE_REVIEW_ONLY',
    ...(blocked?{reason:unsafe?'SQL_OPERATIONS_REQUIRE_MANUAL_REVIEW':
      oversize?'SQL_SCHEMA_STATEMENT_OVERSIZED':
      duplicate?'DUPLICATE_SCHEMA_DECLARATIONS':
      'EXPECTED_SCHEMA_DECLARATIONS_MISSING_OR_INCOMPLETE'}:{}),
    mode:'static-text-inspection-no-sql-execution',
    profile,
    baselineTables:tables,
    syntheticTableDeclared:syntheticDeclared,
    syntheticColumnsPresent,
    integrityVerified:false,
    foreignKeysVerified:false,
    rowsVerified:false,
    importabilityVerified:false,
    isFreshBackupVerified:false,
    matchesLiveStagingVerified:false,
    requiresIsolatedRestoreForIntegrityCheck:true,
    deployAllowed:false,
  };
}

export function inspectLocalD1SqlExport(file,options={}){
  if(typeof file!=='string'||!file.trim())
    throw new Error('SQL_EXPORT_PATH_REQUIRED');
  const stats=lstatSync(file);
  if(!stats.isFile()||stats.size<32||stats.size>MAX_BYTES)
    throw new Error('SQL_EXPORT_SIZE_OR_TYPE_INVALID');
  const buffer=readFileSync(file);
  const text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);
  return inspectD1SqlExportText(text.replace(/^\uFEFF/,''),options);
}

function safeError(error){
  return {
    status:'BLOCKED',
    reason:error?.message==='SQL_EXPORT_SIZE_OR_TYPE_INVALID'?
      'SQL_EXPORT_SIZE_OR_TYPE_INVALID':
      error?.message==='SQL_EXPORT_PATH_REQUIRED'?
      'SQL_EXPORT_PATH_REQUIRED':'SQL_EXPORT_UNREADABLE',
    deployAllowed:false,
  };
}
async function main(){
  const args=process.argv.slice(2);
  const isPreview=args.length===2&&args[0]==='--preview';
  if(!(args.length===1&&args[0]!=='--help')&&!isPreview){
    process.stdout.write('Usage: node scripts/phase4-inspect-d1-sql-export.mjs [--preview] <local-d1-export.sql>\n');
    process.exitCode=2;
    return;
  }
  try{
    const report=inspectLocalD1SqlExport(isPreview?args[1]:args[0],
      {profile:isPreview?'preview-demo':'canonical'});
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
    if(report.status==='BLOCKED')process.exitCode=1;
  }catch(e){
    // Never print exception/stack or path; SQL file contents may be private.
    process.stdout.write(JSON.stringify(safeError(e))+'\n');
    process.exitCode=1;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  await main();
