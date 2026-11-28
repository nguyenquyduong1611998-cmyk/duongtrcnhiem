// Phase 6C: publish immutable synthetic-only math revisions in one D1 batch.
// This is a private server module. NOT an actual exam/production service.
// D1 batch is transactional; no individual D1 .run() writes are permitted here.
import {json} from './auth.mjs';
import {
  validatePhase6SyntheticPublishDraft,privatePhase6SyntheticTemplate,
} from './phase6-synthetic-admin-drafts.mjs';

const ID=/^p6_demo_[a-f0-9]{32}$/;
const CONFIRM='PUBLISH_SYNTHETIC_MATH_REVISION';
const SOURCE_MARKER='PHASE6_SYNTHETIC_DRAFT';
const PUB_MARKER='PHASE6_SYNTHETIC_PUBLICATION';
const SELECT_DRAFT='SELECT draft_id,title_code,minutes,templates_json,version,created_at,updated_at,marker FROM phase6_admin_drafts WHERE draft_id=? LIMIT 1';
const SELECT_PUBLISHED=[
  'SELECT p.draft_id,p.revision,p.published_at,p.marker,',
  'v.state,v.time_limit_seconds,',
  '(SELECT count(*) FROM phase5_content_questions q',
  ' WHERE q.topic_id=p.draft_id AND q.revision=p.revision) AS question_count',
  'FROM phase6_admin_publications p',
  'JOIN phase5_content_versions v',
  '  ON v.topic_id=p.draft_id AND v.revision=p.revision',
  'WHERE p.draft_id=? AND p.revision=? LIMIT 1',
].join(' ');

function exact(raw,keys){
  return raw!==null&&typeof raw==='object'&&!Array.isArray(raw)&&
    Object.keys(raw).sort().join(',')===keys.slice().sort().join(',');
}
function validVersion(v){return Number.isSafeInteger(v)&&v>=1&&v<=100000;}
function snapshotWhere(){
  return "draft_id=? AND version=? AND title_code=? AND minutes=? "+
    "AND templates_json=? AND marker='"+SOURCE_MARKER+"'";
}
function projectPublication(row,created){
  if(!row||!ID.test(row.draft_id||'')||!validVersion(row.revision)||
     row.marker!==PUB_MARKER||row.state!=='published'||
     !Number.isSafeInteger(row.published_at)||row.published_at<=0||
     !Number.isSafeInteger(row.time_limit_seconds)||
     row.time_limit_seconds<60||row.time_limit_seconds>14400||
     !Number.isSafeInteger(row.question_count)||
     row.question_count<1||row.question_count>12)
    throw new Error('PHASE6_PUBLISHED_RECORD_INVALID');
  return {
    mode:'phase6-synthetic-publication',
    publication:{
      topicId:row.draft_id,revision:row.revision,
      questionCount:row.question_count,
      timeLimitSeconds:row.time_limit_seconds,
      publishedAt:row.published_at,status:'published',
    },created,
  };
}
async function priorPublication(db,id,version){
  const row=await db.prepare(SELECT_PUBLISHED).bind(id,version).first();
  return row?projectPublication(row,false):null;
}
function prepared(db,sql,...params){return db.prepare(sql).bind(...params);}

function makePublishBatch(db,draft,now){
  const {draftId:id,version,titleCode,minutes,title,templates}=draft;
  const stored=JSON.stringify(templates);
  const guard=[id,version,titleCode,minutes,stored];
  const where=snapshotWhere();
  const statements=[
    // Optional existing topic when publishing a later revision.
    prepared(db,
      'INSERT OR IGNORE INTO phase5_content_topics(topic_id,created_at) '+
      'SELECT draft_id,created_at FROM phase6_admin_drafts WHERE '+where,
      ...guard),
    prepared(db,
      'INSERT INTO phase5_content_versions '+
      '(topic_id,revision,code,title,description,time_limit_seconds,state,created_at,published_at) '+
      "SELECT draft_id,version,?,?,'Synthetic arithmetic DEMO only',minutes*60,'draft',created_at,NULL "+
      'FROM phase6_admin_drafts WHERE '+where,
      'P6-'+titleCode.toUpperCase(),title,...guard),
  ];
  for(const [index,code] of templates.entries()){
    const t=privatePhase6SyntheticTemplate(code);
    const questionId='q'+(index+1);
    statements.push(prepared(db,
      'INSERT INTO phase5_content_questions '+
      '(topic_id,revision,question_id,order_index,question_text,option_a,option_b,option_c,option_d) '+
      'SELECT draft_id,version,?,?,?,?,?,?,? FROM phase6_admin_drafts WHERE '+where,
      questionId,index+1,t.text,...t.options,...guard));
    statements.push(prepared(db,
      'INSERT INTO phase5_content_answer_keys '+
      '(topic_id,revision,question_id,correct_index,explanation) '+
      "SELECT draft_id,version,?,?,'Synthetic math only' FROM phase6_admin_drafts WHERE "+where,
      questionId,t.correctIndex,...guard));
  }
  statements.push(prepared(db,
    "UPDATE phase5_content_versions SET state='published',published_at=? "+
    "WHERE topic_id=? AND revision=? AND state='draft' AND EXISTS ("+
    'SELECT 1 FROM phase6_admin_drafts WHERE '+where+')',
    now,id,version,...guard));
  statements.push(prepared(db,
    'INSERT INTO phase6_admin_publications(draft_id,revision,published_at,marker) '+
    'SELECT v.topic_id,v.revision,?,? FROM phase5_content_versions v '+
    'JOIN phase6_admin_drafts d ON d.draft_id=v.topic_id '+
    'WHERE v.topic_id=? AND v.revision=? AND v.state=\'published\' '+
    'AND v.published_at=? AND d.version=? AND d.title_code=? '+
    'AND d.minutes=? AND d.templates_json=? AND d.marker=\''+SOURCE_MARKER+'\'',
    now,PUB_MARKER,id,version,now,version,titleCode,minutes,stored));
  return statements;
}

export async function handlePhase6SyntheticPublication(db,data){
  if(!db?.prepare||typeof db.batch!=='function'||
     !exact(data,['action','draftId','version','confirmation'])||
     data.action!=='publish'||data.confirmation!==CONFIRM||
     typeof data.draftId!=='string'||!ID.test(data.draftId)||
     !validVersion(data.version))
    return json({error:'INVALID_REQUEST'},400);

  // Lost-response retry: only the server's immutable metadata is returned.
  const prior=await priorPublication(db,data.draftId,data.version);
  if(prior)return json(prior);

  const row=await db.prepare(SELECT_DRAFT).bind(data.draftId).first();
  if(!row)return json({error:'DRAFT_NOT_FOUND'},404);
  const draft=validatePhase6SyntheticPublishDraft(row);
  if(draft.version!==data.version)
    return json({error:'VERSION_CONFLICT'},409);
  if(draft.templates.length<1)
    return json({error:'DRAFT_EMPTY'},400);
  const now=Math.floor(Date.now()/1000);
  if(!Number.isSafeInteger(now)||now<=0||now<draft.createdAt)
    throw new Error('PHASE6_SERVER_CLOCK_INVALID');

  // Cloudflare D1 db.batch executes in one transaction: a SQL/constraint
  // failure rolls back version, private key, metadata and all questions.
  let results;
  try{
    results=await db.batch(makePublishBatch(db,draft,now));
  }catch(error){
    // Concurrent publish may win; a retry must never create a new revision.
    const completed=await priorPublication(db,data.draftId,data.version);
    if(completed)return json(completed);
    const fresh=await db.prepare(SELECT_DRAFT).bind(data.draftId).first();
    if(fresh&&fresh.version!==data.version)
      return json({error:'VERSION_CONFLICT'},409);
    throw error; // endpoint responds with a generic 503; never expose SQL.
  }
  const expected=4+draft.templates.length*2;
  if(!Array.isArray(results)||results.length!==expected||
     results.some(r=>r?.success!==true||!Number.isSafeInteger(r.meta?.changes))||
     results.slice(1).some(r=>r.meta.changes!==1)||
     results[0].meta.changes>1)
    throw new Error('PHASE6_PUBLISH_BATCH_UNCONFIRMED');

  const saved=await priorPublication(db,data.draftId,data.version);
  if(!saved)throw new Error('PHASE6_PUBLISH_NOT_PERSISTED');
  if(saved.publication.questionCount!==draft.templates.length||
     saved.publication.timeLimitSeconds!==draft.minutes*60)
    throw new Error('PHASE6_PUBLISH_SNAPSHOT_MISMATCH');
  return json({...saved,created:true},201);
}
