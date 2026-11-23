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

export async function inspectStagingDemoQuizSchema(db) {
  if(!db?.prepare)throw new Error('MISSING_STAGING_D1');
  const objects=await all(db,
    "SELECT name,type FROM sqlite_master "+
    "WHERE name IN ('demo_students','login_attempts','unit_accounts',"+
    "'synthetic_graded_attempts','synthetic_graded_attempts_by_date',"+
    "'synthetic_grade_no_update')"
  );
  const objectsByName=new Map();
  for(const row of objects){
    if(!NAMES.includes(row?.name)||objectsByName.has(row.name))
      throw new Error('INVALID_SCHEMA_OBJECT');
    objectsByName.set(row.name,row.type);
  }
  const tables={};
  const counts={};
  let baselineReady=true;
  for(const name of Object.keys(REQUIRED)){
    const exists=objectsByName.get(name)==='table';
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
    tables[name]={exists,requiredColumnsPresent:fieldsValid};
    if(!exists||!fieldsValid)baselineReady=false;
  }
  const newTable=objectsByName.get('synthetic_graded_attempts')==='table';
  const newNameOccupied=objectsByName.has('synthetic_graded_attempts')&&!newTable;
  const index=objectsByName.get('synthetic_graded_attempts_by_date')==='index';
  const trigger=objectsByName.get('synthetic_grade_no_update')==='trigger';
  const indexCollision=objectsByName.has('synthetic_graded_attempts_by_date')&&!index;
  const triggerCollision=objectsByName.has('synthetic_grade_no_update')&&!trigger;
  let scoreFieldsValid=false,foreignKeyValid=false,scoreRows=null;
  if(newTable){
    scoreFieldsValid=hasAll(
      columns(await all(db,"PRAGMA table_info('synthetic_graded_attempts')")),
      SCORE_COLUMNS,
    );
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
    index&&trigger;
  const status= !baselineReady||collision||
      (newTable&&!syntheticSchemaComplete) ?
    'BLOCKED' : newTable?'SYNTHETIC_SCHEMA_PRESENT':'REVIEW_MIGRATION_ONLY';
  return {
    mode:'read-only-staging-preflight',
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
      immutableTriggerPresent:trigger,
      dateIndexPresent:index,
      rowCount:scoreRows,
    },
    // A correct schema is NOT proof of matching D1 bindings, successful
    // backup, safe hostname, database IAM, or browser-to-browser sync.
    deploymentAuthorized:false,
  };
}
