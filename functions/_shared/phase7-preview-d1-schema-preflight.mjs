// Phase 7A — read-only Phase6 schema inventory on isolated Cloudflare Preview.
// Pure metadata only: never select table rows, answer keys, UIDs, credentials,
// student answers, scores, D1 IDs, or any user-supplied table names / SQL.
//
// This only reviews the expected SHAPE, not actual backup status, D1 binding
// identity, migration authorization, real-user suitability, or deployment.
const TABLES={
  baseline:[
    ['demo_students','username','firebase_uid','active'],
    ['login_attempts','username','failures','locked_until'],
    ['synthetic_graded_attempts','firebase_uid','score','marker'],
    ['phase5_content_topics','topic_id','created_at'],
    ['phase5_content_versions','topic_id','revision','state','time_limit_seconds'],
    ['phase5_content_questions','topic_id','revision','question_id','option_a','option_b','option_c','option_d'],
    ['phase5_content_answer_keys','topic_id','revision','question_id','correct_index'],
    ['phase5_content_attempts','student_uid','topic_id','revision','score_tenths'],
  ],
  phase6b:[
    ['phase6_admin_drafts','draft_id','templates_json','version','minutes','marker'],
    ['phase6_admin_draft_events','draft_id','event_type','version','happened_at'],
  ],
  phase6c:[
    ['phase6_admin_publications','draft_id','revision','published_at','marker'],
  ],
  phase6a:[
    ['phase6_exam_sessions','session_id','student_uid','topic_id','revision','expires_at','started_at','marker'],
  ],
  phase6d:[
    ['phase6_exam_submissions','submission_id','session_id','student_uid','topic_id','revision','answers_json','score_tenths','marker'],
  ],
};
const EXTRA={
  baseline:[
    ['synthetic_grade_no_update','trigger','synthetic_graded_attempts','BEFORE UPDATE','SYNTHETIC_GRADE_IMMUTABLE'],
    ['phase5_published_version_no_update','trigger','phase5_content_versions','BEFORE UPDATE','PHASE5_PUBLISHED_VERSION_IMMUTABLE'],
    ['phase5_attempt_no_update','trigger','phase5_content_attempts','BEFORE UPDATE','PHASE5_ATTEMPT_IMMUTABLE'],
  ],
  phase6b:[
    ['phase6_drafts_updated_at','index','phase6_admin_drafts'],
    ['phase6_admin_draft_created','trigger','phase6_admin_drafts','AFTER INSERT'],
    ['phase6_admin_draft_saved','trigger','phase6_admin_drafts','AFTER UPDATE'],
    ['phase6_admin_draft_deleted','trigger','phase6_admin_drafts','AFTER DELETE'],
  ],
  phase6c:[
    ['phase6_publications_latest','index','phase6_admin_publications'],
    ['phase6_publication_requires_published','trigger','phase6_admin_publications','BEFORE INSERT','PHASE6_PUBLICATION_NOT_PUBLISHED'],
    ['phase6_publication_no_update','trigger','phase6_admin_publications','BEFORE UPDATE','PHASE6_PUBLICATION_IMMUTABLE'],
    ['phase6_publication_no_delete','trigger','phase6_admin_publications','BEFORE DELETE','PHASE6_PUBLICATION_IMMUTABLE'],
  ],
  phase6a:[
    ['phase6_session_uid_time','index','phase6_exam_sessions'],
    ['phase6_session_start_guard','trigger','phase6_exam_sessions','BEFORE INSERT','PHASE6_SERVER_TIME_REQUIRED'],
    ['phase6_session_no_update','trigger','phase6_exam_sessions','BEFORE UPDATE','PHASE6_SESSION_IMMUTABLE'],
    ['phase6_session_no_delete','trigger','phase6_exam_sessions','BEFORE DELETE','PHASE6_SESSION_IMMUTABLE'],
  ],
  phase6d:[
    ['phase6_submissions_uid_time','index','phase6_exam_submissions'],
    ['phase6_submission_guard','trigger','phase6_exam_submissions','BEFORE INSERT','PHASE6_SESSION_OWNER_OR_DEADLINE'],
    ['phase6_submission_no_update','trigger','phase6_exam_submissions','BEFORE UPDATE','PHASE6_SUBMISSION_IMMUTABLE'],
    ['phase6_submission_no_delete','trigger','phase6_exam_submissions','BEFORE DELETE','PHASE6_SUBMISSION_IMMUTABLE'],
  ],
};
const PHASES=['baseline','phase6b','phase6c','phase6a','phase6d'];
const NAMES=PHASES.flatMap(phase=>[
  ...TABLES[phase].map(row=>row[0]),
  ...EXTRA[phase].map(row=>row[0]),
]);
const PHASE6_TABLE_CHECKS={
  phase6_admin_drafts:[
    /CHECK\s*\(\s*marker\s*=\s*'PHASE6_SYNTHETIC_DRAFT'/i,
    /CHECK\s*\(\s*minutes\s+BETWEEN\s+1\s+AND\s+240\s*\)/i,
  ],
  phase6_admin_publications:[
    /PRIMARY\s+KEY\s*\(\s*draft_id\s*,\s*revision\s*\)/i,
    /REFERENCES\s+phase5_content_versions\s*\(/i,
  ],
  phase6_exam_sessions:[
    /UNIQUE\s*\(\s*student_uid\s*,\s*topic_id\s*,\s*revision\s*\)/i,
    /CHECK\s*\(\s*expires_at\s*=\s*started_at\s*\+\s*time_limit_seconds\s*\)/i,
    /REFERENCES\s+phase5_content_versions\s*\(/i,
  ],
  phase6_exam_submissions:[
    /UNIQUE\s*\(\s*student_uid\s*,\s*topic_id\s*,\s*revision\s*\)/i,
    /REFERENCES\s+phase6_exam_sessions\s*\(/i,
    /CHECK\s*\(\s*marker\s*=\s*'PHASE6_SYNTHETIC_SUBMISSION'\s*\)/i,
    /CHECK\s*\(\s*score_tenths\s*=\s*CAST\s*\(/i,
  ],
};
function rows(result){
  if(!Array.isArray(result?.results))throw new Error('PHASE7A_INVALID_D1_METADATA');
  return result.results;
}
function isValidSql(row,expected){
  if(typeof row?.sql!=='string'||row.sql.length<25)return false;
  return !expected||expected.every(regex=>regex.test(row.sql));
}
function declaredShape(row,extra){
  if(!row||row.type!==extra[1]||row.tbl_name!==extra[2])
    return false;
  if(extra[1]==='index')return isValidSql(row);
  const sql=row.sql||'';
  if(typeof sql!=='string'||!sql.toUpperCase().includes(extra[3]))
    return false;
  return !extra[4]||sql.includes(extra[4])&&
    /RAISE\s*\(\s*ABORT\s*,/i.test(sql);
}
async function metadata(db){
  const query='SELECT name,type,tbl_name,sql FROM sqlite_master WHERE name IN ('+
    NAMES.map(()=>'?').join(',')+')';
  const list=rows(await db.prepare(query).bind(...NAMES).all());
  const map=new Map();
  for(const row of list){
    if(!NAMES.includes(row?.name)||map.has(row.name))
      throw new Error('PHASE7A_DUPLICATE_SCHEMA_OBJECT');
    map.set(row.name,row);
  }
  return map;
}
async function tableShape(db,row,table){
  if(!row||row.type!=='table'||row.tbl_name!==table[0]||
     !isValidSql(row,PHASE6_TABLE_CHECKS[table[0]]))
    return false;
  // PRAGMA names are from this module's constant allowlist, NEVER the request.
  const list=rows(await db.prepare(
    "PRAGMA table_info('"+table[0]+"')"
  ).all());
  if(!list.every(r=>typeof r?.name==='string'))
    throw new Error('PHASE7A_INVALID_COLUMN_METADATA');
  const set=new Set(list.map(r=>r.name));
  return table.slice(1).every(col=>set.has(col));
}

export async function inspectPhase7PreviewSchema(db){
  if(!db?.prepare)throw new Error('PHASE7A_PREVIEW_BINDING_MISSING');
  const all=await metadata(db);
  const stages={};
  for(const phase of PHASES){
    const tables=TABLES[phase];
    const extra=EXTRA[phase];
    let existing=0,correct=0;
    const expected=tables.length+extra.length;
    for(const table of tables){
      const meta=all.get(table[0]);
      if(meta)existing++;
      if(await tableShape(db,meta,table))correct++;
    }
    for(const entry of extra){
      const meta=all.get(entry[0]);
      if(meta)existing++;
      if(declaredShape(meta,entry))correct++;
    }
    stages[phase]=existing===0?'ABSENT':
      existing===expected&&correct===expected?'SCHEMA_CANDIDATE':
      'BLOCKED_INCOMPLETE_OR_MISMATCHED';
  }
  const baselineOk=stages.baseline==='SCHEMA_CANDIDATE';
  let prefix=true,unexpectedOrder=false;
  for(const phase of PHASES.slice(1)){
    if(stages[phase]==='ABSENT')prefix=false;
    else if(!prefix)unexpectedOrder=true;
  }
  const bad=PHASES.some(phase=>
    stages[phase]==='BLOCKED_INCOMPLETE_OR_MISMATCHED');
  const allPhase6=PHASES.slice(1).every(phase=>
    stages[phase]==='SCHEMA_CANDIDATE');
  const status=!baselineOk?'BLOCKED_BASELINE_MISSING_OR_MISMATCHED':
    bad||unexpectedOrder?'BLOCKED_PARTIAL_OR_UNEXPECTED_ORDER':
      allPhase6?'SCHEMA_CANDIDATE_REVIEW_ONLY':
        'MIGRATION_REVIEW_REQUIRED';

  // The response exposes only fixed phase names and status, no sqlite_master
  // SQL, column lists, rows, counts, secrets, Firebase UIDs or answer keys.
  return {
    mode:'phase7a-preview-d1-schema-preflight',
    status,stages,
    migrationOrder:['phase6b','phase6c','phase6a','phase6d'],
    targetDatabaseIdentityVerified:false,
    freshBackupVerified:false,
    liveRestoreVerified:false,
    schemaOnlyChecks:true,
    migrationsExecuted:false,
    deployAuthorized:false,
  };
}
