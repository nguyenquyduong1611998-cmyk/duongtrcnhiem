import {PROJECT_ID} from './auth.mjs';
import {bearerToken,fetchGoogleStudentSigningKeys}
  from './student-session.mjs';
import {approvePilotUnlockReview} from './pilot-unlock-review.mjs';

// Phase 3L: offline-only proof of independently signed reviewer identity.
// NOT wired to an HTTP endpoint or a scheduled task. An Admin UID sent in
// a JSON body, or a Firebase Custom Token, NEVER counts as authorization.
// The Google ID-token signing key is downloaded from Google's fixed endpoint;
// runtime callers cannot choose the issuer, Firebase project, or JWKS URL.
const UID=/^[A-Za-z0-9_-]{6,128}$/;
const KID=/^[A-Za-z0-9_-]{1,128}$/;
const MAX_AUTH_AGE_SECONDS=300;
const textDecoder=new TextDecoder();
const textEncoder=new TextEncoder();

function parsePart(value) {
  const base64=value.replace(/-/g,'+').replace(/_/g,'/');
  return JSON.parse(textDecoder.decode(
    Uint8Array.from(atob(base64+'='.repeat((4-base64.length%4)%4)),
      c=>c.charCodeAt(0))));
}
function binary(value) {
  const base64=value.replace(/-/g,'+').replace(/_/g,'/');
  return Uint8Array.from(
    atob(base64+'='.repeat((4-base64.length%4)%4)),
    c=>c.charCodeAt(0));
}
function eligibleClaims(header,body,now) {
  return header?.alg==='RS256' && KID.test(header.kid||'') &&
    body?.iss==='https://securetoken.google.com/'+PROJECT_ID &&
    body.aud===PROJECT_ID &&
    UID.test(body.sub||'') && !body.sub.startsWith('student_') &&
    (body.user_id===undefined || body.user_id===body.sub) &&
    body.firebase?.sign_in_provider==='google.com' &&
    body.email_verified===true &&
    Number.isSafeInteger(body.iat) &&
    Number.isSafeInteger(body.exp) &&
    Number.isSafeInteger(body.auth_time) &&
    body.iat<=now &&
    body.auth_time<=body.iat &&
    body.auth_time<=now &&
    now-body.auth_time<=MAX_AUTH_AGE_SECONDS &&
    body.exp>now && body.exp-body.iat<=3900 &&
    (body.nbf===undefined ||
      (Number.isSafeInteger(body.nbf)&&body.nbf<=now));
}

export async function reviewerActiveInD1(db,uid,authTime) {
  if(!db?.prepare || !UID.test(uid||'') ||
     uid.startsWith('student_') ||
     !Number.isSafeInteger(authTime) || authTime<=0)
    return false;
  const row=await db.prepare(
    'SELECT active,role,tokens_valid_after '+
    'FROM student_pilot_review_admins WHERE firebase_uid=?'
  ).bind(uid).first();
  return Boolean(row?.active===1 &&
    row.role==='unlock_reviewer' &&
    Number.isSafeInteger(row.tokens_valid_after) &&
    row.tokens_valid_after>=0 &&
    authTime>row.tokens_valid_after);
}

// Optional keys/now are restricted to module-level test calls; no public
// handler accepts either. Live callers must use Google's signed JWKS keys.
export async function verifyPilotReviewerIdToken(request,db,options={}) {
  const token=bearerToken(request);
  if(!token || !db?.prepare) return null;
  const now=options.now??Math.floor(Date.now()/1000);
  if(!Number.isSafeInteger(now)||now<1) return null;
  const parts=token.split('.');
  if(parts.length!==3) return null;
  let header,body;
  try {
    header=parsePart(parts[0]);body=parsePart(parts[1]);
    if(!header || Array.isArray(header) ||
       typeof header!=='object' || !body ||
       Array.isArray(body) || typeof body!=='object' ||
       !eligibleClaims(header,body,now))return null;

    const keys=options.keys??await fetchGoogleStudentSigningKeys();
    if(!Array.isArray(keys))return null;
    const jwk=keys.find(key=>key?.kid===header.kid &&
      key.kty==='RSA' && typeof key.n==='string' &&
      typeof key.e==='string' &&
      (key.use===undefined||key.use==='sig'));
    if(!jwk)return null;
    const rsaKey=await crypto.subtle.importKey(
      'jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},
      false,['verify']);
    const signed=parts[0]+'.'+parts[1];
    if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',
      rsaKey,binary(parts[2]),textEncoder.encode(signed)))
      return null;
    // No role/UID inferred from email or unsigned request data: only the
    // signed Firebase UID and enabled D1 role can grant reviewer identity.
    if(!await reviewerActiveInD1(db,body.sub,body.auth_time))
      return null;
    return {uid:body.sub,authTime:body.auth_time};
  } catch {
    // Do not log tokens, claims, reviewer IDs, or signing keys.
    return null;
  }
}

// This is the ONLY intended adapter into the existing approval function.
// Recheck D1 at the moment of approval to handle removal of reviewer rights.
// The approval SQL itself also requires an active D1 reviewer row, so a
// revoked reviewer cannot win a race between this read and the update.
export async function approvePilotReviewWithSignedAdmin(
  db,reviewId,request,options={}
) {
  const identity=await verifyPilotReviewerIdToken(
    request,db,options);
  if(!identity)
    return {
      approvedForManualReview:false,canEnableNow:false,
      accountStillDisabled:true,mode:'review-only',
    };
  const verifier={
    async verifyIndependentAdmin(candidate) {
      return candidate===identity.uid &&
        await reviewerActiveInD1(db,identity.uid,identity.authTime);
    },
  };
  return approvePilotUnlockReview(
    db,reviewId,identity.uid,verifier,
    {reviewerAuthTime:identity.authTime,...(options.now===undefined?{}:{now:options.now})},
  );
}
