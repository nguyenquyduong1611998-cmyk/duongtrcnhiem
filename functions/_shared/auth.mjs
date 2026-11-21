// Shared Cloudflare Pages Function helpers. No Node.js APIs or third-party packages.
// Staging-only: fail closed unless every required binding is configured.
const te = new TextEncoder();
const td = new TextDecoder();
export const PROJECT_ID = 'duongtrcnhiem-staging';
export const ADMIN_UID = 'aV2S9WYo4tg8XZQSE9snzjeBU203';
export const PBKDF2_ITERATIONS = 310000;
export const GENERIC_LOGIN_ERROR = 'Tên tài khoản hoặc mật khẩu không đúng.';

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}

export function requireStaging(env) {
  // Never silently fall back to production Firebase or client-side secrets.
  if (!env || env.STAGING_AUTH_ENABLED !== 'true' || env.FIREBASE_PROJECT_ID !== PROJECT_ID ||
      !env.AUTH_DB || !env.FIREBASE_SERVICE_ACCOUNT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    throw new Error('STAGING_AUTH_NOT_CONFIGURED');
  }
}
export function usernameKey(s) {
  if (typeof s !== 'string') return null;
  const key = s.trim().toLowerCase();
  return /^[a-z][a-z0-9_]{2,39}$/.test(key) ? key : null;
}
export function safePassword(s) {
  return typeof s === 'string' && s.length >= 12 && s.length <= 128;
}
export function checkRequest(request) {
  if (request.method !== 'POST') return json({error:'METHOD_NOT_ALLOWED'},405);
  if ((request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/json')
    return json({error:'CONTENT_TYPE_REQUIRED'},415);
  // Same-origin browser requests. A spoofed Origin is not a substitute for rate limits.
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return json({error:'FORBIDDEN_ORIGIN'},403);
  const size = Number(request.headers.get('content-length') || 0);
  if (size > 4096) return json({error:'BODY_TOO_LARGE'},413);
  return null;
}
export async function smallJson(request) {
  const raw = await request.text();
  if (raw.length > 4096) throw new Error('BODY_TOO_LARGE');
  const data = JSON.parse(raw);
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('INVALID_JSON');
  return data;
}
function bytesFromB64(s) {
  const cleaned = s.replace(/-/g,'+').replace(/_/g,'/');
  const binary = atob(cleaned + '='.repeat((4-cleaned.length%4)%4));
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}
export function encodeB64(bytes) {
  let text = '';
  for (let i=0;i<bytes.length;i+=8192) {
    text += String.fromCharCode(...bytes.slice(i,i+8192));
  }
  return btoa(text).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
export const encodeString = s => encodeB64(te.encode(s));
export function decodeSegment(s) {
  return JSON.parse(td.decode(bytesFromB64(s)));
}
function randomBytes(n) {const b=new Uint8Array(n);crypto.getRandomValues(b);return b;}
export function randomPassword() {
  // 144 bits of entropy; returned only to the provisioning Admin, never persisted.
  return encodeB64(randomBytes(18));
}
// Explicitly versioned, multi-stage KDF for staging DEMO credentials only.
// Workerd limits a single WebCrypto PBKDF2 invocation to 100,000 iterations.
// Each stage applies a fresh 100k-or-less PBKDF2-SHA256 derivation to the
// previous stage's 32-byte key, with a distinct domain-separated salt.
// This is NOT standard PBKDF2(iterations=310000). Do not use for real users
// without an independent cryptographic review or a managed auth provider.
const STAGING_KDF_PREFIX = 'cf-chain-v1.';
const PBKDF2_WORKER_MAX_ITERATIONS = 100000;
async function derivePbkdf2Key(inputBytes, saltBytes, count) {
  if (count < 1 || count > PBKDF2_WORKER_MAX_ITERATIONS) throw new Error('INVALID_KDF_CHUNK');
  const key = await crypto.subtle.importKey('raw', inputBytes, 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits({
    name: 'PBKDF2', salt: saltBytes, iterations: count, hash: 'SHA-256',
  }, key, 256);
  return new Uint8Array(derived);
}
export async function pbkdf2(password, saltB64, iterations=PBKDF2_ITERATIONS) {
  if (!Number.isInteger(iterations) || iterations < 310000 || iterations > 650000)
    throw new Error('INVALID_KDF_PARAMS');
  if (typeof password !== 'string' || password.length > 128 || password.length === 0)
    throw new Error('INVALID_DEMO_PASSWORD');
  if (!saltB64.startsWith(STAGING_KDF_PREFIX)) {
    // Do not silently produce a different hash for an unversioned record.
    throw new Error('UNSUPPORTED_LEGACY_KDF');
  }
  const salt = bytesFromB64(saltB64.slice(STAGING_KDF_PREFIX.length));
  if (salt.length !== 16) throw new Error('INVALID_KDF_SALT');
  let remaining = iterations;
  let stage = 0;
  let material = te.encode(password);
  while (remaining > 0) {
    const count = Math.min(remaining, PBKDF2_WORKER_MAX_ITERATIONS);
    const stageSalt = new Uint8Array(salt.length + 1);
    stageSalt.set(salt);
    stageSalt[salt.length] = stage;
    material = await derivePbkdf2Key(material, stageSalt, count);
    remaining -= count;
    stage++;
  }
  return encodeB64(material);
}
export async function hashPassword(password) {
  const salt = STAGING_KDF_PREFIX + encodeB64(randomBytes(16));
  return {salt, hash:await pbkdf2(password,salt), iterations:PBKDF2_ITERATIONS};
}
export function equalSecret(a,b) {
  // Length-independent bytewise comparison; no early exit on unequal bytes.
  const aa=te.encode(String(a||'')),bb=te.encode(String(b||''));
  let diff=aa.length ^ bb.length;
  for(let i=0;i<Math.max(aa.length,bb.length);i++) diff |= (aa[i]||0)^(bb[i]||0);
  return diff===0;
}
async function rsaKey(privateKeyPem) {
  const pem=privateKeyPem.replace(/\\n/g,'\n').replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
  return crypto.subtle.importKey('pkcs8',bytesFromB64(pem),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
}
export async function signJwt(env,body) {
  const head={alg:'RS256',typ:'JWT'};
  const input=encodeString(JSON.stringify(head))+'.'+encodeString(JSON.stringify(body));
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',await rsaKey(env.FIREBASE_PRIVATE_KEY),te.encode(input));
  return input+'.'+encodeB64(new Uint8Array(sig));
}
export async function mintFirebaseToken(env,uid) {
  const now=Math.floor(Date.now()/1000);
  return signJwt(env,{
    iss:env.FIREBASE_SERVICE_ACCOUNT_EMAIL,sub:env.FIREBASE_SERVICE_ACCOUNT_EMAIL,
    aud:'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat:now,exp:now+3600,uid,
  });
}

let jwksCache=null, jwksExpiry=0;
export async function verifiedGoogleAdmin(request) {
  const authorization=request.headers.get('authorization')||'';
  const match=/^Bearer ([A-Za-z0-9_.-]+)$/.exec(authorization);
  if (!match || match[1].length>8192) return false;
  const parts=match[1].split('.');
  if(parts.length!==3) return false;
  let header,payload;
  try{header=decodeSegment(parts[0]);payload=decodeSegment(parts[1]);}catch{return false;}
  const now=Math.floor(Date.now()/1000);
  if (header.alg!=='RS256' || typeof header.kid!=='string' ||
      payload.iss!=='https://securetoken.google.com/'+PROJECT_ID ||
      payload.aud!==PROJECT_ID || payload.sub!==ADMIN_UID ||
      payload.user_id!==undefined && payload.user_id!==ADMIN_UID ||
      !Number.isFinite(payload.exp)||payload.exp<=now||
      !Number.isFinite(payload.iat)||payload.iat>now ||
      payload.firebase?.sign_in_provider!=='google.com') return false;
  try{
    if(!jwksCache || Date.now()>jwksExpiry){
      const r=await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
      if(!r.ok) return false;
      jwksCache=await r.json();
      jwksExpiry=Date.now()+Math.min(300000,60*1000);
    }
    const jwk=jwksCache.keys?.find(x=>x.kid===header.kid&&x.kty==='RSA');
    if(!jwk)return false;
    const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,bytesFromB64(parts[2]),te.encode(parts[0]+'.'+parts[1]));
  }catch{return false;}
}
export const noSecrets=()=>json({error:'SERVER_NOT_CONFIGURED'},503);
export const failSafe=()=>json({error:'SERVER_UNAVAILABLE'},503);
