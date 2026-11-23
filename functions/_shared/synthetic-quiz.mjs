import {
  PROJECT_ID,json,decodeSegment,
} from './auth.mjs';
import {fetchGoogleStudentSigningKeys,bearerToken} from './student-session.mjs';

// PHASE 4A: proof of server-owned scoring for a SINGLE, fixed, fake question.
// The correct answer never needs to be sent by the quiz API before submission.
// Not suitable for real questions or grades; no frontend score is trusted.
const te=new TextEncoder();
const UID=/^student_[a-f0-9]{32}$/;
const QUIZ_ID='synthetic_math_v1';
const MARKER='SYNTHETIC_ONLY';
const CORRECT_INDEX=1; // private to Cloudflare Functions, NOT shipped in Vite
const OPTIONS=Object.freeze(['3','4','5','6']);
const TOKEN_KID=/^[A-Za-z0-9_-]{1,128}$/;

function bytes(value) {
  const string=value.replace(/-/g,'+').replace(/_/g,'/');
  return Uint8Array.from(
    atob(string+'='.repeat((4-string.length%4)%4)),
    c=>c.charCodeAt(0),
  );
}
function validTokenClaims(header,payload,now) {
  return header?.alg==='RS256' && TOKEN_KID.test(header.kid||'') &&
    payload?.iss==='https://securetoken.google.com/'+PROJECT_ID &&
    payload.aud===PROJECT_ID &&
    UID.test(payload.sub||'') &&
    (payload.user_id===undefined||payload.user_id===payload.sub) &&
    payload.firebase?.sign_in_provider==='custom' &&
    Number.isSafeInteger(payload.iat) && payload.iat>0 &&
    Number.isSafeInteger(payload.exp) && payload.exp>now &&
    Number.isSafeInteger(payload.auth_time) && payload.auth_time>0 &&
    payload.auth_time<=payload.iat &&
    payload.iat<=now && payload.exp-payload.iat<=3900 &&
    (payload.nbf===undefined ||
      (Number.isSafeInteger(payload.nbf)&&payload.nbf<=now));
}

// Key override is only for signed, in-memory unit tests. HTTP routes never
// provide options and never accept keys/UIDs/roles from the browser.
export async function verifyDemoQuizIdToken(token,options={}) {
  if(typeof token!=='string'||token.length>8192||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))
    return null;
  const parts=token.split('.');
  const now=options.now??Math.floor(Date.now()/1000);
  if(!Number.isSafeInteger(now)||now<=0)return null;
  try {
    const header=decodeSegment(parts[0]);
    const payload=decodeSegment(parts[1]);
    if(!header||Array.isArray(header)||typeof header!=='object'||
      !payload||Array.isArray(payload)||typeof payload!=='object'||
      !validTokenClaims(header,payload,now))return null;
    const keys=options.keys??await fetchGoogleStudentSigningKeys();
    if(!Array.isArray(keys))return null;
    const jwk=keys.find(k=>k?.kid===header.kid&&k.kty==='RSA'&&
      typeof k.n==='string'&&typeof k.e==='string'&&
      (k.use===undefined||k.use==='sig'));
    if(!jwk)return null;
    const key=await crypto.subtle.importKey('jwk',jwk,
      {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    const ok=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',
      key,bytes(parts[2]),te.encode(parts[0]+'.'+parts[1]));
    return ok?payload.sub:null;
  } catch{return null;}
}

export async function verifyActiveDemoQuizStudent(db,request,options={}) {
  if(!db?.prepare)return null;
  const uid=await verifyDemoQuizIdToken(bearerToken(request),options);
  if(!uid)return null;
  const row=await db.prepare(
    'SELECT firebase_uid FROM demo_students '+
    'WHERE firebase_uid=? AND active=1'
  ).bind(uid).first();
  return row?.firebase_uid===uid?uid:null;
}

function exact(data,fields) {
  return data&&typeof data==='object'&&!Array.isArray(data)&&
    Object.keys(data).sort().join(',')===fields.slice().sort().join(',');
}
function readAttempt(row) {
  if(!row)return null;
  if(!UID.test(row.firebase_uid||'')||
    row.quiz_id!==QUIZ_ID || row.marker!==MARKER ||
    !Number.isSafeInteger(row.answer_index) ||
    row.answer_index<0 || row.answer_index>3 ||
    row.score!==(row.answer_index===CORRECT_INDEX?10:0) ||
    !Number.isSafeInteger(row.submitted_at) ||
    row.submitted_at<=0)
    throw new Error('SYNTHETIC_ATTEMPT_CORRUPT');
  return {
    quizId:QUIZ_ID,score:row.score,
    maxScore:10,submittedAt:row.submitted_at,
    mode:'server-graded-synthetic',
  };
}

async function fetchAttempt(db,uid) {
  return db.prepare(
    'SELECT firebase_uid,quiz_id,answer_index,score,submitted_at,marker '+
    'FROM synthetic_graded_attempts WHERE firebase_uid=?'
  ).bind(uid).first();
}

export async function handleDemoQuizStudent(db,uid,data) {
  if(!db?.prepare||!UID.test(uid||''))
    return json({error:'UNAUTHORIZED'},401);
  if(exact(data,['action'])&&data.action==='question') {
    return json({
      quizId:QUIZ_ID,
      text:'Câu hỏi DEMO: 2 + 2 bằng bao nhiêu?',
      options:[...OPTIONS],
      mode:'synthetic-only',
      oneSubmission:true,
    });
  }
  if(exact(data,['action'])&&data.action==='result') {
    const row=await fetchAttempt(db,uid);
    return json({attempt:readAttempt(row)});
  }
  if(!exact(data,['action','answerIndex'])||
     data.action!=='submit'||
     !Number.isInteger(data.answerIndex) ||
     data.answerIndex<0||data.answerIndex>3)
    return json({error:'INVALID_REQUEST'},400);

  const now=Math.floor(Date.now()/1000);
  const score=data.answerIndex===CORRECT_INDEX?10:0;
  const inserted=await db.prepare(
    'INSERT OR IGNORE INTO synthetic_graded_attempts '+
    '(firebase_uid,quiz_id,answer_index,score,submitted_at,marker) '+
    'SELECT ?,?,?,?,?,? WHERE EXISTS '+
    '(SELECT 1 FROM demo_students WHERE firebase_uid=? AND active=1)'
  ).bind(uid,QUIZ_ID,data.answerIndex,score,now,MARKER,uid).run();
  if(inserted?.success!==true)
    throw new Error('SYNTHETIC_ATTEMPT_WRITE_FAILED');
  const row=await fetchAttempt(db,uid);
  if(!row)return json({error:'NOT_AVAILABLE'},403);
  const attempt=readAttempt(row);
  if(inserted.meta?.changes===0&&row.answer_index!==data.answerIndex)
    return json({error:'ALREADY_SUBMITTED',attempt},409);
  return json({attempt,created:inserted.meta?.changes===1});
}

export async function handleDemoQuizAdmin(db,data) {
  if(!db?.prepare||!exact(data,['action'])||data.action!=='list')
    return json({error:'INVALID_REQUEST'},400);
  const result=await db.prepare(
    'SELECT a.firebase_uid,a.quiz_id,a.answer_index,a.score,'+
    'a.submitted_at,a.marker,s.username '+
    'FROM synthetic_graded_attempts a '+
    'JOIN demo_students s ON s.firebase_uid=a.firebase_uid '+
    "WHERE s.username GLOB 'test_hv_*' "+
    'ORDER BY a.submitted_at DESC,a.firebase_uid ASC LIMIT 100'
  ).all();
  if(!Array.isArray(result?.results))throw new Error('INVALID_D1_QUERY');
  const attempts=result.results.map(row=>{
    if(typeof row.username!=='string'||
      !/^test_hv_[a-f0-9]{12}$/.test(row.username))
      throw new Error('INVALID_DEMO_STUDENT');
    return {username:row.username,...readAttempt(row)};
  });
  return json({
    mode:'server-graded-synthetic',attempts,count:attempts.length,
  });
}
