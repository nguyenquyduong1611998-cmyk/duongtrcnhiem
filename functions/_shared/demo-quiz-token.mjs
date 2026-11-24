// Dedicated PHASE 4 staging DEMO verifier utilities.
// No dependency on experimental Phase 3 real-student authentication.
const JWKS_URL='https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let keys=null,validUntil=0;
// Static failure categories only; never log URLs, headers, response bodies or JWTs.
function publicKeyFetchFailure(diagnosticCode){
  const err=new Error('GOOGLE_SIGNING_KEYS_UNAVAILABLE');
  err.diagnosticCode=diagnosticCode;
  return err;
}
export async function fetchGoogleStudentSigningKeys(){
  if(keys && Date.now()<validUntil)return keys;
  let response;
  // Cloudflare Workers rejects redirect:'error' before any network request.
  // Use manual mode and fail closed on all 3xx responses instead.
  try{response=await fetch(JWKS_URL,{method:'GET',redirect:'manual'});}
  catch{throw publicKeyFetchFailure('GOOGLE_KEYS_FETCH_FAILED');}
  if(!response.ok){
    // Do not include arbitrary status codes in logs; use a fixed allowlist.
    const category=response.status>=300&&response.status<400?'GOOGLE_KEYS_HTTP_REDIRECT':
      response.status===403?'GOOGLE_KEYS_HTTP_403':
      response.status===404?'GOOGLE_KEYS_HTTP_404':
      response.status===429?'GOOGLE_KEYS_HTTP_429':
      response.status>=500?'GOOGLE_KEYS_HTTP_5XX':
      'GOOGLE_KEYS_HTTP_OTHER';
    throw publicKeyFetchFailure(category);
  }
  let data;
  try{data=await response.json();}
  catch{throw publicKeyFetchFailure('GOOGLE_KEYS_JSON_INVALID');}
  if(!data||!Array.isArray(data.keys)||data.keys.length<1||
     data.keys.length>30)
    throw publicKeyFetchFailure('GOOGLE_KEYS_SET_INVALID');
  const header=response.headers.get('cache-control')||'';
  const raw=/(?:^|,)\s*max-age=(\d+)(?:,|$)/i.exec(header);
  const seconds=raw?Number(raw[1]):60;
  keys=data.keys;
  validUntil=Date.now()+Math.min(300,Math.max(0,seconds))*1000;
  return keys;
}
export function bearerToken(request){
  const header=request?.headers?.get('authorization')||'';
  const match=/^Bearer ([A-Za-z0-9._-]+)$/.exec(header);
  if(!match || match[1].length>8192)return null;
  return match[1];
}
