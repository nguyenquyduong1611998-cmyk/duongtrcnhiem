import {PROJECT_ID} from './auth.mjs';

// Phase 3C: verify Firebase ID tokens received from a client. NEVER accept a
// Firebase custom token directly here. The browser must exchange a custom
// token with Firebase Auth first, then send the resulting Firebase ID token.
// This helper proves cryptographic identity, not account activation or
// Firebase Auth refresh-token revocation.
const GOOGLE_JWKS =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const te = new TextEncoder();
const td = new TextDecoder();
let cachedKeys = null;
let cachedUntil = 0;

function fromB64url(value) {
  const canonical = value.replace(/-/g,'+').replace(/_/g,'/');
  const bytes=atob(canonical+'='.repeat((4-canonical.length%4)%4));
  return Uint8Array.from(bytes, c=>c.charCodeAt(0));
}
function parseJwt(token) {
  if(typeof token!=='string' || token.length>8192 ||
     !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
    const parts=token.split('.');
    const header=JSON.parse(td.decode(fromB64url(parts[0])));
    const payload=JSON.parse(td.decode(fromB64url(parts[1])));
    if(!header || typeof header!=='object' || Array.isArray(header) ||
       !payload || typeof payload!=='object' || Array.isArray(payload)) return null;
    return {header,payload,parts};
  } catch {return null;}
}
function integerSeconds(value) {
  return Number.isSafeInteger(value) && value>=0;
}

function validStudentPayload(header,payload,now) {
  if(header.alg!=='RS256' || typeof header.kid!=='string' ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(header.kid)) return false;
  if(payload.iss!=='https://securetoken.google.com/'+PROJECT_ID ||
    payload.aud!==PROJECT_ID || typeof payload.sub!=='string' ||
    !/^student_[a-f0-9]{32}$/.test(payload.sub) ||
    (payload.user_id!==undefined && payload.user_id!==payload.sub)) return false;
  // Only Firebase ID tokens produced by signInWithCustomToken; a custom JWT
  // directly signed by a service account has a different issuer.
  if(payload.firebase?.sign_in_provider!=='custom' ||
     payload.unitStudent!==true ||
     !Number.isSafeInteger(payload.unitAuthVersion) ||
     payload.unitAuthVersion<1) return false;
  if(!integerSeconds(payload.iat) || !integerSeconds(payload.exp) ||
     !integerSeconds(payload.auth_time) ||
     payload.auth_time>payload.iat ||
     payload.iat>now || payload.auth_time>now ||
     payload.exp<=now || payload.exp<=payload.iat ||
     payload.exp-payload.iat>3900) return false;
  if(payload.nbf!==undefined &&
     (!integerSeconds(payload.nbf) || payload.nbf>now)) return false;
  return true;
}

export async function fetchGoogleStudentSigningKeys() {
  if(cachedKeys && cachedUntil>Date.now()) return cachedKeys;
  const response=await fetch(GOOGLE_JWKS,{method:'GET',redirect:'error'});
  if(!response.ok) throw new Error('SIGNING_KEYS_UNAVAILABLE');
  const body=await response.json();
  if(!body || !Array.isArray(body.keys) || body.keys.length===0 ||
    body.keys.length>30) throw new Error('INVALID_SIGNING_KEYS');
  const rawMaxAge=/(?:^|,)\s*max-age=(\d+)(?:,|$)/i.exec(
    response.headers.get('cache-control')||'');
  const seconds=rawMaxAge ? Number(rawMaxAge[1]) : 60;
  cachedUntil=Date.now()+Math.min(300,Math.max(0,seconds))*1000;
  cachedKeys=body.keys;
  return cachedKeys;
}

// Optional options are ONLY for isolated tests. Runtime endpoints always call
// this function without overrides; client input cannot choose signing keys.
export async function verifyStudentFirebaseIdToken(token, options={}) {
  const jwt=parseJwt(token);
  if(!jwt) return null;
  const now=options.now ?? Math.floor(Date.now()/1000);
  if(!Number.isSafeInteger(now) || !validStudentPayload(jwt.header,jwt.payload,now))
    return null;
  try {
    const keys=options.keys ?? await fetchGoogleStudentSigningKeys();
    if(!Array.isArray(keys)) return null;
    const jwk=keys.find(k=>k?.kid===jwt.header.kid &&
      k?.kty==='RSA' && typeof k.n==='string' && typeof k.e==='string');
    if(!jwk) return null;
    const key=await crypto.subtle.importKey('jwk',jwk,
      {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    const signed=jwt.parts[0]+'.'+jwt.parts[1];
    const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',
      key,fromB64url(jwt.parts[2]),te.encode(signed));
    if(!valid) return null;
    return {
      firebaseUid:jwt.payload.sub,
      authVersion:jwt.payload.unitAuthVersion,
      authTime:jwt.payload.auth_time,
    };
  } catch {return null;}
}

export function bearerToken(request) {
  const authorization=request.headers.get('authorization')||'';
  const match=/^Bearer ([A-Za-z0-9._-]+)$/.exec(authorization);
  if(!match || match[1].length>8192) return null;
  return match[1];
}

// D1 is consulted on EVERY protected Cloudflare request. This blocks a
// still-signed, unexpired Firebase ID token after disabling an account or
// increasing its version. This check alone does not revoke Firebase's refresh
// token, nor does it protect direct Firestore reads without matching Rules.
export async function authorizeStudentIdentity(db, identity) {
  if(!db || !identity ||
      !/^student_[a-f0-9]{32}$/.test(identity.firebaseUid||'') ||
      !Number.isSafeInteger(identity.authVersion) ||
      !Number.isSafeInteger(identity.authTime)) return false;
  const row=await db.prepare(
    'SELECT active,password_reset_required,auth_version,tokens_valid_after '+
    'FROM student_auth_identities WHERE firebase_uid=?'
  ).bind(identity.firebaseUid).first();
  return Boolean(row && row.active===1 &&
    row.password_reset_required===0 &&
    Number.isSafeInteger(row.auth_version) &&
    row.auth_version===identity.authVersion &&
    Number.isSafeInteger(row.tokens_valid_after) &&
    row.tokens_valid_after>=0 &&
    identity.authTime>row.tokens_valid_after);
}
