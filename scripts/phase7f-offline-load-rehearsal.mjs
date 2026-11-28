// Phase 7F: OFFLINE-only, deterministic 30 -> 60 -> 100 synthetic-client
// regression using server-owned Phase6 handlers and independent SQLite
// connections. This is NOT a Cloudflare D1 / network / real concurrency
// benchmark. No tokens, real users, Wrangler, Cloudflare or external fetch.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {webcrypto} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {handlePhase6StudentExam}
  from '../functions/_shared/phase6-student-timed-exam.mjs';
import {handlePhase6StudentHistory,handlePhase6AdminResults}
  from '../functions/_shared/phase6-results-readonly.mjs';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const NOW=1800000000;
const TOPIC='p6_demo_'+'f'.repeat(32);
const SCHEMA=[
  'serverless/d1-staging-schema.sql',
  'serverless/d1-phase4-synthetic-graded-quiz.sql',
  'serverless/d1-phase5-preview-additive-schema.sql',
  'serverless/d1-phase5-preview-synthetic-math-seed.sql',
  'serverless/d1-phase6b-synthetic-admin-drafts-draft.sql',
  'serverless/d1-phase6c-publication-metadata-draft.sql',
  'serverless/d1-phase6-timed-sessions-draft.sql',
  'serverless/d1-phase6d-timed-submissions-draft.sql',
];
const uid=n=>'student_'+n.toString(16).padStart(32,'0');
const username=n=>'test_hv_'+n.toString(16).padStart(12,'0');
const fixedExam={topicId:TOPIC,revision:1};
const expectedScore=n=>n%2===0?10:0;
function connect(file){
  const db=new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys=ON');
  db.exec('PRAGMA busy_timeout=5000');
  db.function('unixepoch',()=>NOW);
  return db;
}
function adapter(db){
  return {
    prepare(sql){
      return {
        bind(...args){
          return {
            async first(){return db.prepare(sql).get(...args)??null;},
            async all(){return {success:true,results:db.prepare(sql).all(...args)};},
            async run(){
              const result=db.prepare(sql).run(...args);
              return {success:true,meta:{changes:result.changes}};
            },
          };
        },
        async first(){return db.prepare(sql).get()??null;},
        async all(){return {success:true,results:db.prepare(sql).all()};},
      };
    },
  };
}
function seed(db){
  const run=(sql,...args)=>db.prepare(sql).run(...args);
  for(const path of SCHEMA)db.exec(readFileSync(path,'utf8'));
  for(let n=1;n<=100;n++)
    run(
      'INSERT INTO demo_students(username,firebase_uid,password_salt,password_hash,'+
      'kdf_iterations,active,created_at) VALUES (?,?,?,?,310000,1,?)',
      username(n),uid(n),'LOCAL_SYNTHETIC_SALT','LOCAL_SYNTHETIC_HASH',NOW-1000
    );
  run('INSERT INTO phase5_content_topics(topic_id,created_at) VALUES (?,?)',
    TOPIC,NOW-900);
  run(
    "INSERT INTO phase5_content_versions(topic_id,revision,code,title,"+
    "description,time_limit_seconds,state,created_at,published_at) "+
    "VALUES (?,1,'P7F-FAKE','Toán học DEMO 7F','Synthetic arithmetic',600,"+
    "'draft',?,NULL)",
    TOPIC,NOW-900
  );
  for(const [id,order,question,correct] of [
    ['q1',1,'2 + 2 = ?',1],['q2',2,'10 - 3 = ?',2],
  ]){
    run(
      'INSERT INTO phase5_content_questions(topic_id,revision,question_id,'+
      'order_index,question_text,option_a,option_b,option_c,option_d) '+
      'VALUES (?,1,?,?,?,?,?,?,?)',
      TOPIC,id,order,question,'3','4','7','8'
    );
    run(
      'INSERT INTO phase5_content_answer_keys(topic_id,revision,'+
      'question_id,correct_index,explanation) VALUES (?,1,?,?,?)',
      TOPIC,id,correct,'Math DEMO'
    );
  }
  run(
    "UPDATE phase5_content_versions SET state='published',published_at=? "+
    "WHERE topic_id=? AND revision=1",
    NOW-600,TOPIC
  );
  run(
    "INSERT INTO phase6_admin_publications(draft_id,revision,published_at,"+
    "marker) VALUES (?,1,?,'PHASE6_SYNTHETIC_PUBLICATION')",
    TOPIC,NOW-600
  );
}
function rows(db,sql){
  return db.prepare(sql).get().n;
}
function audit(db,expected){
  if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok')
    throw new Error('LOCAL_SQLITE_INTEGRITY_FAILED');
  if(db.prepare('PRAGMA foreign_key_check').get()!==undefined)
    throw new Error('LOCAL_SQLITE_FOREIGN_KEY_FAILED');
  const attempts=rows(db,'SELECT count(*) AS n FROM phase6_exam_submissions');
  const sessions=rows(db,'SELECT count(*) AS n FROM phase6_exam_sessions');
  if(attempts!==expected||sessions!==expected)
    throw new Error('LOCAL_SQLITE_WRITES_OR_SESSIONS_MISMATCHED');
  if(rows(db,'SELECT count(*) AS n FROM demo_students')!==100)
    throw new Error('LOCAL_DEMO_STUDENTS_CHANGED');
  if(rows(db,'SELECT count(*) AS n FROM phase5_content_attempts')!==0)
    throw new Error('PREEXISTING_PHASE5_ATTEMPTS_CHANGED');
}
async function parsed(response,status){
  if(response.status!==status)
    throw new Error('SYNTHETIC_HTTP_STATUS_MISMATCH');
  return response.json();
}
async function oneClient(n,connectionA,connectionB){
  const name=uid(n);
  const first=await parsed(await handlePhase6StudentExam(connectionA,name,{
    action:'start',...fixedExam,
  }),200);
  if(first.session?.questionCount!==2||
     first.session.expiresAt-first.session.startedAt!==600)
    throw new Error('SESSION_DEADLINE_OR_QUESTIONS_INVALID');
  const answers=n%2===0?{q1:1,q2:2}:{q1:0,q2:0};
  const submitted=await parsed(await handlePhase6StudentExam(connectionA,name,{
    action:'submit',...fixedExam,
    sessionId:first.session.sessionId,answers,
  }),201);
  if(submitted.result?.score!==expectedScore(n))
    throw new Error('SYNTHETIC_GRADE_MISMATCH');
  // Separate database handle = separate device, without local state reuse.
  const recovered=await parsed(await handlePhase6StudentExam(connectionB,name,{
    action:'result',...fixedExam,
  }),200);
  if(JSON.stringify(recovered.result)!==JSON.stringify(submitted.result))
    throw new Error('CROSS_CONNECTION_RESTORED_SCORE_MISMATCH');
  const own=await parsed(await handlePhase6StudentHistory(connectionB,name,{
    action:'list',offset:0,
  }),200);
  if(own.entries?.length!==1||own.entries[0].score!==expectedScore(n)||
     own.nextOffset!==null)
    throw new Error('CROSS_CONNECTION_HISTORY_MISMATCH');
  for(const body of [first,recovered,own]){
    const serial=JSON.stringify(body);
    if(/answers_json|correct_index|password_hash|student_uid|firebase_uid|LOCAL_SYNTHETIC_HASH/i.test(serial))
      throw new Error('SYNTHETIC_PRIVATE_DATA_EXPOSED');
  }
  return 1;
}
async function adminReview(readDb,tier){
  const summary=await parsed(await handlePhase6AdminResults(readDb,{
    action:'summary',
  }),200);
  if(summary.summary?.attemptCount!==tier||
     summary.summary?.studentCount!==tier||
     summary.summary?.averageScore!==5||
     summary.summary?.maxScore!==10)
    throw new Error('ADMIN_SUMMARY_MISMATCH');
  const usernames=new Set();
  for(let offset=0;offset<tier;offset+=25){
    const page=await parsed(await handlePhase6AdminResults(readDb,{
      action:'list',offset,
    }),200);
    if(page.entries.length!==Math.min(25,tier-offset)||
       page.nextOffset!==(offset+25<tier?offset+25:null))
      throw new Error('ADMIN_PAGINATION_MISMATCH');
    for(const record of page.entries){
      if(!/^test_hv_[a-f0-9]{12}$/.test(record.username))
        throw new Error('ADMIN_NON_SYNTHETIC_USERNAME');
      usernames.add(record.username);
    }
    if(/answers_json|correct_index|password_hash|student_uid|firebase_uid/.test(
      JSON.stringify(page)))
      throw new Error('ADMIN_PRIVATE_DATA_EXPOSED');
  }
  if(usernames.size!==tier)throw new Error('ADMIN_PAGINATION_DUPLICATE');
}

export async function runPhase7fOfflineLoadRehearsal(){
  const temp=mkdtempSync(join(tmpdir(),'phase7f-synthetic-'));
  const file=join(temp,'SYNTHETIC_LOCAL.sqlite');
  const dbs=[];
  try{
    const seedDb=connect(file);
    seed(seedDb);
    seedDb.close();
    for(let i=0;i<4;i++)dbs.push(connect(file));
    const clients=dbs.map(adapter);
    const waves=[];
    let completed=0;
    for(const target of [30,60,100]){
      const ids=Array.from({length:target-completed},(_,i)=>completed+i+1);
      // Promise fan-out only; same-process SQLite synchronous driver. This is
      // NOT simultaneous network users or a latency/throughput benchmark.
      const promises=ids.map(n=>oneClient(
        n,clients[n%4],clients[(n+1)%4]));
      const results=await Promise.all(promises);
      if(results.length!==ids.length||results.some(x=>x!==1))
        throw new Error('LOCAL_CLIENT_WAVE_FAILED');
      completed=target;
      audit(dbs[0],target);
      await adminReview(clients[3],target);
      waves.push({simulatedTotalUsers:target,committedSubmissions:target,
        uniqueServerSessions:target,adminPages:Math.ceil(target/25)});
    }
    // A manual same-body re-POST is idempotent; it does not create a
    // second grade. The app never performs an automatic retry on error.
    const sample=uid(2);
    const read=await parsed(await handlePhase6StudentExam(clients[2],sample,{
      action:'read',...fixedExam,
    }),200);
    const duplicate=await parsed(await handlePhase6StudentExam(clients[1],sample,{
      action:'submit',...fixedExam,sessionId:read.session.sessionId,
      answers:{q1:1,q2:2},
    }),200);
    if(duplicate.created!==false||duplicate.result.score!==10)
      throw new Error('MANUAL_REPLAY_NOT_IDEMPOTENT');
    const conflict=await parsed(await handlePhase6StudentExam(clients[1],sample,{
      action:'submit',...fixedExam,sessionId:read.session.sessionId,
      answers:{q1:0,q2:0},
    }),409);
    if(conflict.error!=='ALREADY_SUBMITTED')
      throw new Error('MANUAL_CONFLICT_NOT_REJECTED');
    audit(dbs[0],100);
    return {
      mode:'phase7f-offline-synthetic-sqlite-only',
      status:'OFFLINE_FUNCTIONAL_REHEARSAL_PASSED',
      waves,
      independentSqliteConnections:4,
      syntheticUsersOnly:true,
      separateConnectionResultRecovery:true,
      sameBodyManualReplayIdempotent:true,
      changedAnswersDenied:true,
      baselineIntegrityAndForeignKeysChecked:true,
      simulatedConcurrencyIsNotNetworkLoad:true,
      cloudflareD1LiveLoadMeasured:false,
      actualConcurrentUsersVerified:false,
      latencyPercentilesMeasured:false,
      cloudflareQuotaHeadroomVerified:false,
      realDevicePwaInstalled:false,
      deploymentAuthorized:false,
    };
  }finally{
    for(const db of dbs)try{db.close();}catch{/* local cleanup */}
    rmSync(temp,{recursive:true,force:true});
  }
}
async function main(){
  // A CLI with no arguments cannot be pointed to a live host/database.
  if(process.argv.length!==2){
    process.stdout.write('Usage (OFFLINE only): node scripts/phase7f-offline-load-rehearsal.mjs\n');
    process.exitCode=2;
    return;
  }
  const result=await runPhase7fOfflineLoadRehearsal();
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  await main();
