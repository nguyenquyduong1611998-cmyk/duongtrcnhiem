// PHASE 4D — staging-only, read-only schema inspection for the DEMO quiz.
// No DDL/DML, backups, Admin secrets, table rows or account identifiers are
// returned. This is a PREPARED probe, not a staging deployment.
const REQUIRED={
  demo_students:['username','firebase_uid','password_salt','password_hash','active'],
  login_attempts:['username','failures','first_failed','locked_until'],
  unit_accounts:['username','firebase_uid','active','auth_version'],
};
const SCORE_COLUMNS=[
  'firebase_uid','quiz_id','answer_index','score','submitted_at','marker',
];
const NAMES=[
  'demo_students','login_attempts','unit_accounts',
  'synthetic_graded_attempts','synthetic_graded_attempts_by_date',
  'synthetic_grade_no_update',
];
const countQuery={
  demo_students:'SELECT COUNT(*) AS count FROM demo_students',
  login_attempts:'SELECT COUNT(*) AS count FROM login_attempts',
  unit_accounts:'SELECT COUNT(*) AS count FROM unit_accounts',
  synthetic_graded_attempts:
    'SELECT COUNT(*) AS count FROM synthetic_graded_attempts',
};
function expectResults(result){
  if(!Array.isArray(result?.results))throw new Error('INVALID_INSPECTION_RESULT');
  return result.results;
}
async function all(db,sql){
  return expectResults(await db.prepare(sql).all());
}
function columns(rows){
  if(!rows.every(r=>typeof r?.name==='string'))
    throw new Error('INVALID_SCHEMA_METADATA');
  return new Set(rows.map(r=>r.name));
}
function hasAll(have,needed){return needed.every(x=>have.has(x));}
function safeCount(row){
  const n=row?.count;
  if(!Number.isSafeInteger(n)||n<0)
    throw new Error('INVALID_INSPECTION_COUNT');
  return n;
}

export async function inspectStagingDemoQuizSchema(db,{profile='canonical'}={}) {
  // The isolated branch Preview uses only the two DEMO auth tables.
  // Canonical staging retains the stricter unit_accounts requirement.
  if(profile!=='canonical'&&profile!=='preview-demo')
    throw new Error('INVALID_PREFLIGHT_PROFILE');
  if(!db?.prepare)throw new Error('MISSING_STAGING_D1');
  const objects=await all(db,
    "SELECT name,type,tbl_name,sql FROM sqlite_master "+
    "WHERE name IN ('demo_students','login_attempts','unit_accounts',"+
    "'synthetic_graded_attempts','synthetic_graded_attempts_by_date',"+
    "'synthetic_grade_no_update')"
  );
  const objectsByName=new Map();
  for(const row of objects){
    if(!NAMES.includes(row?.name)||objectsByName.has(row.name))
      throw new Error('INVALID_SCHEMA_OBJECT');
    objectsByName.set(row.name,row);
  }
  const tables={};
  const counts={};
  let baselineReady=true;
  for(const name of Object.keys(REQUIRED)){
    const exists=objectsByName.get(name)?.type==='table';
    let fieldsValid=false;
    if(exists){
      fieldsValid=hasAll(columns(
        await all(db,"PRAGMA table_info('"+name+"')")),
        REQUIRED[name],
      );
      if(fieldsValid){
        const values=await all(db,countQuery[name]);
        if(values.length!==1)throw new Error('INVALID_INSPECTION_COUNT');
        counts[name]=safeCount(values[0]);
      }
    }
    const required=name!=='unit_accounts'||profile==='canonical';
    tables[name]={exists,requiredColumnsPresent:fieldsValid,required};
    if(required&&(!exists||!fieldsValid))baselineReady=false;
  }
  const tableMeta=objectsByName.get('synthetic_graded_attempts');
  const indexMeta=objectsByName.get('synthetic_graded_attempts_by_date');
  const triggerMeta=objectsByName.get('synthetic_grade_no_update');
  const newTable=tableMeta?.type==='table' &&
    tableMeta.tbl_name==='synthetic_graded_attempts';
  const newNameOccupied=objectsByName.has('synthetic_graded_attempts')&&!newTable;
  // Names alone are insufficient: a misleading index or empty trigger must
  // not cause the inspector to report that the grade is protected.
  const index=indexMeta?.type==='index' &&
    indexMeta.tbl_name==='synthetic_graded_attempts' &&
    /\bON\s+synthetic_graded_attempts\s*\(\s*submitted_at\s+DESC\s*\)/i.test(
      indexMeta.sql||'');
  const trigger=triggerMeta?.type==='trigger' &&
    triggerMeta.tbl_name==='synthetic_graded_attempts' &&
    /\bBEFORE\s+UPDATE\s+ON\s+synthetic_graded_attempts\b/i.test(
      triggerMeta.sql||'') &&
    /RAISE\s*\(\s*ABORT\s*,\s*'SYNTHETIC_GRADE_IMMUTABLE'\s*\)/i.test(
      triggerMeta.sql||'');
  const indexCollision=objectsByName.has('synthetic_graded_attempts_by_date')&&!index;
  const triggerCollision=objectsByName.has('synthetic_grade_no_update')&&!trigger;
  let scoreFieldsValid=false,foreignKeyValid=false,constraintsValid=false,scoreRows=null;
  if(newTable){
    scoreFieldsValid=hasAll(
      columns(await all(db,"PRAGMA table_info('synthetic_graded_attempts')")),
      SCORE_COLUMNS,
    );
    const schema=tableMeta.sql||'';
    constraintsValid=
      /CHECK\s*\(\s*quiz_id\s*=\s*'synthetic_math_v1'\s*\)/i.test(schema)&&
      /CHECK\s*\(\s*answer_index\s+BETWEEN\s+0\s+AND\s+3\s*\)/i.test(schema)&&
      /CHECK\s*\(\s*marker\s*=\s*'SYNTHETIC_ONLY'\s*\)/i.test(schema)&&
      /answer_index\s*=\s*1\s+AND\s+score\s*=\s*10/i.test(schema)&&
      /answer_index\s*<>\s*1\s+AND\s+score\s*=\s*0/i.test(schema);
    const fk=await all(db,
      "PRAGMA foreign_key_list('synthetic_graded_attempts')");
    foreignKeyValid=fk.some(row=>row?.table==='demo_students'&&
      row.from==='firebase_uid'&&row.to==='firebase_uid'&&
      row.on_delete==='CASCADE');
    if(scoreFieldsValid){
      const count=await all(db,countQuery.synthetic_graded_attempts);
      if(count.length!==1)throw new Error('INVALID_INSPECTION_COUNT');
      scoreRows=safeCount(count[0]);
    }
  }

  const collision=indexCollision||triggerCollision||newNameOccupied ||
    (!newTable&&(index||trigger));
  const syntheticSchemaComplete=newTable&&scoreFieldsValid&&foreignKeyValid&&
    constraintsValid&&index&&trigger;
  const status= !baselineReady||collision||
      (newTable&&!syntheticSchemaComplete) ?
    'BLOCKED' : newTable?'SYNTHETIC_SCHEMA_PRESENT':'REVIEW_MIGRATION_ONLY';
  return {
    mode:'read-only-staging-preflight',
    profile,
    status,
    canExecuteMigrationAutomatically:false,
    requiresFreshBackup:true,
    needsHumanApproval:true,
    baseline:tables,
    existingRowCounts:counts,
    synthetic:{
      exists:newTable,
      columnsValid:scoreFieldsValid,
      foreignKeyValid,
      constraintsValid,
      immutableTriggerPresent:trigger,
      dateIndexPresent:index,
      rowCount:scoreRows,
    },
    // A correct schema is NOT proof of matching D1 bindings, successful
    // backup, safe hostname, database IAM, or browser-to-browser sync.
    deploymentAuthorized:false,
  };
}
