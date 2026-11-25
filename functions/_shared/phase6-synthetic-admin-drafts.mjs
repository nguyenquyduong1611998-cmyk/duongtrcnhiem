// Phase 6B: isolated Google Admin CRUD of synthetic arithmetic drafts only.
// Every DB query is server-only; no Firebase UID, student data, real question,
// answer key, publishing operation or Phase 4/5 table is accepted here.
import {json} from './auth.mjs';

const DRAFT_ID=/^p6_demo_[a-f0-9]{32}$/;
const TITLES=Object.freeze({
  basic:'Toán học DEMO - Cơ bản',
  practice:'Toán học DEMO - Luyện tập',
  challenge:'Toán học DEMO - Thử thách',
});
const TEMPLATES=Object.freeze({
  sum_2_2:{text:'2 + 2 = ?',options:['3','4','5','6'],correctIndex:1},
  sum_3_5:{text:'3 + 5 = ?',options:['6','7','8','9'],correctIndex:2},
  sum_7_8:{text:'7 + 8 = ?',options:['14','15','16','17'],correctIndex:1},
  minus_10_3:{text:'10 - 3 = ?',options:['5','6','7','8'],correctIndex:2},
});
const MARKER='PHASE6_SYNTHETIC_DRAFT';
const MAX_DRAFTS=100,MAX_QUESTIONS=12;
const SQL_LIST='SELECT draft_id,title_code,minutes,templates_json,version,created_at,updated_at,marker FROM phase6_admin_drafts ORDER BY updated_at DESC,draft_id ASC LIMIT 101';
const SQL_GET='SELECT draft_id,title_code,minutes,templates_json,version,created_at,updated_at,marker FROM phase6_admin_drafts WHERE draft_id=? LIMIT 1';
const SQL_INSERT="INSERT INTO phase6_admin_drafts (draft_id,title_code,minutes,templates_json,version,created_at,updated_at,marker) SELECT ?,?,?,'[]',1,?,?,'PHASE6_SYNTHETIC_DRAFT' WHERE (SELECT count(*) FROM phase6_admin_drafts)<100";
const SQL_SAVE='UPDATE phase6_admin_drafts SET title_code=?,minutes=?,templates_json=?,version=version+1,updated_at=? WHERE draft_id=? AND version=?';
const SQL_DELETE='DELETE FROM phase6_admin_drafts WHERE draft_id=? AND version=?';

function exact(raw,keys){
  return raw!==null&&typeof raw==='object'&&!Array.isArray(raw)&&
    Object.keys(raw).sort().join(',')===keys.slice().sort().join(',');
}
function safeMinutes(value){return Number.isSafeInteger(value)&&value>=1&&value<=240;}
function safeVersion(value){return Number.isSafeInteger(value)&&value>=1&&value<=100000;}
function safeTitle(code){return typeof code==='string'&&Object.hasOwn(TITLES,code);}
function safeTemplates(raw){
  return Array.isArray(raw)&&raw.length<=MAX_QUESTIONS&&
    raw.every(code=>typeof code==='string'&&Object.hasOwn(TEMPLATES,code));
}
function validId(id){return typeof id==='string'&&DRAFT_ID.test(id);}
function timestamp(){return Math.floor(Date.now()/1000);}
function publicDraft(row,includeQuestions=false){
  if(!row||!validId(row.draft_id)||!safeTitle(row.title_code)||
     !safeMinutes(row.minutes)||!safeVersion(row.version)||
     !Number.isSafeInteger(row.created_at)||row.created_at<=0||
     !Number.isSafeInteger(row.updated_at)||row.updated_at<row.created_at||
     row.marker!==MARKER)
    throw new Error('PHASE6_DRAFT_ROW_INVALID');
  let templates;
  try{templates=JSON.parse(row.templates_json);}catch{throw new Error('PHASE6_DRAFT_TEMPLATES_INVALID');}
  if(!safeTemplates(templates))throw new Error('PHASE6_DRAFT_TEMPLATES_INVALID');
  const projected={
    draftId:row.draft_id,titleCode:row.title_code,title:TITLES[row.title_code],
    minutes:row.minutes,questionCount:templates.length,version:row.version,
    createdAt:row.created_at,updatedAt:row.updated_at,status:'draft',
  };
  if(includeQuestions){
    projected.templates=templates;
    projected.questions=templates.map((code,index)=>({
      id:'q'+(index+1),templateCode:code,
      text:TEMPLATES[code].text,options:[...TEMPLATES[code].options],
    }));
  }
  return projected;
}
async function findDraft(db,id){
  return db.prepare(SQL_GET).bind(id).first();
}
function changed(result){
  if(result?.success!==true||!Number.isSafeInteger(result.meta?.changes))
    throw new Error('PHASE6_D1_WRITE_UNCONFIRMED');
  if(result.meta.changes>1)throw new Error('PHASE6_D1_WRITE_UNEXPECTED');
  return result.meta.changes===1;
}

export async function handlePhase6SyntheticAdminDrafts(db,data){
  if(!db?.prepare||!data||typeof data!=='object'||Array.isArray(data))
    return json({error:'INVALID_REQUEST'},400);

  if(exact(data,['action'])&&data.action==='list'){
    const rows=await db.prepare(SQL_LIST).all();
    if(!Array.isArray(rows?.results)||rows.results.length>MAX_DRAFTS)
      throw new Error('PHASE6_DRAFT_LIST_INVALID');
    return json({mode:'phase6-synthetic-admin-drafts',
      drafts:rows.results.map(row=>publicDraft(row))});
  }

  if(exact(data,['action','draftId'])&&data.action==='get'){
    if(!validId(data.draftId))return json({error:'INVALID_REQUEST'},400);
    const row=await findDraft(db,data.draftId);
    return row?json({draft:publicDraft(row,true)}):json({error:'NOT_FOUND'},404);
  }

  if(exact(data,['action','titleCode','minutes'])&&data.action==='create'){
    if(!safeTitle(data.titleCode)||!safeMinutes(data.minutes))
      return json({error:'INVALID_REQUEST'},400);
    const draftId='p6_demo_'+crypto.randomUUID().replaceAll('-','');
    const now=timestamp();
    const inserted=await db.prepare(SQL_INSERT)
      .bind(draftId,data.titleCode,data.minutes,now,now).run();
    if(!changed(inserted))return json({error:'DRAFT_LIMIT_REACHED'},409);
    const row=await findDraft(db,draftId);
    if(!row)throw new Error('PHASE6_DRAFT_NOT_PERSISTED');
    return json({draft:publicDraft(row,true)},201);
  }

  if(exact(data,['action','draftId','version','titleCode','minutes','templates'])&&
     data.action==='save'){
    if(!validId(data.draftId)||!safeVersion(data.version)||
       !safeTitle(data.titleCode)||!safeMinutes(data.minutes)||
       !safeTemplates(data.templates))
      return json({error:'INVALID_REQUEST'},400);
    const updated=await db.prepare(SQL_SAVE)
      .bind(data.titleCode,data.minutes,JSON.stringify(data.templates),
        timestamp(),data.draftId,data.version).run();
    if(!changed(updated))return json({error:'VERSION_CONFLICT'},409);
    const row=await findDraft(db,data.draftId);
    if(!row)throw new Error('PHASE6_DRAFT_NOT_PERSISTED');
    return json({draft:publicDraft(row,true)});
  }

  if(exact(data,['action','draftId','version'])&&data.action==='delete'){
    if(!validId(data.draftId)||!safeVersion(data.version))
      return json({error:'INVALID_REQUEST'},400);
    const removed=await db.prepare(SQL_DELETE)
      .bind(data.draftId,data.version).run();
    if(!changed(removed))return json({error:'VERSION_CONFLICT'},409);
    return json({deleted:true,draftId:data.draftId});
  }

  // Explicitly no "publish", "submit", "import", arbitrary question text,
  // student UID, answer key, correctIndex, or scoring endpoint.
  return json({error:'INVALID_REQUEST'},400);
}

// Server-only Phase 6C adapter: validates DB rows and returns fixed math facts.
export function validatePhase6SyntheticPublishDraft(row) {
  return publicDraft(row,true);
}
export function privatePhase6SyntheticTemplate(code) {
  if(typeof code!=='string'||!Object.hasOwn(TEMPLATES,code))
    throw new Error('PHASE6_TEMPLATE_NOT_ALLOWED');
  const t=TEMPLATES[code];
  return {text:t.text,options:[...t.options],correctIndex:t.correctIndex};
}

export const PHASE6_SYNTHETIC_TITLES=Object.keys(TITLES);
export const PHASE6_SYNTHETIC_TEMPLATES=Object.keys(TEMPLATES);
