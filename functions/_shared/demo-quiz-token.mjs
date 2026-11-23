// Dedicated PHASE 4 staging DEMO verifier utilities.
// No dependency on experimental Phase 3 real-student authentication.
const JWKS_URL='https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let keys=null,validUntil=0;
export async function fetchGoogleStudentSigningKeys(){
  if(keys && Date.now()<validUntil)return keys;
  const response=await fetch(JWKS_URL,{method:'GET',redirect:'error'});
  if(!response.ok)throw new Error('GOOGLE_SIGNING_KEYS_UNAVAILABLE');
  const data=await response.json();
  if(!data||!Array.isArray(data.keys)||data.keys.length<1||
     data.keys.length>30)throw new Error('INVALID_SIGNING_KEYS');
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
