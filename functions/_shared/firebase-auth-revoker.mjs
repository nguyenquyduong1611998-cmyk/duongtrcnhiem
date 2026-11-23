import {PROJECT_ID,requireStaging,signJwt} from './auth.mjs';

// PHASE 3G -- DRAFT ONLY, NOT CONNECTED TO ANY PUBLIC ROUTE OR CRON.
// This writer uses a separate, dedicated Firebase Auth service account;
// NEVER use the Google Admin's browser token or the demo login signer.
// Google OAuth grants admin-level privileges and bypasses client-side Rules.
// Per-project permission required: firebaseauth.users.get / users.update.
// Setting disableUser=true is a privileged irreversible-to-client action.
// Server-only, opt-in, pilot UID pattern only. DO NOT enable on real users.
const UID=/^student_[a-f0-9]{32}$/;
const PROJECT=PROJECT_ID;
const AUTH_ROOT='https://identitytoolkit.googleapis.com/v1/projects/'+
  PROJECT+'/accounts:';
const OAUTH_URL='https://oauth2.googleapis.com/token';
const SCOPE='https://www.googleapis.com/auth/identitytoolkit';
const ACCOUNT_EMAIL=/^[a-z0-9-]+@duongtrcnhiem-staging\.iam\.gserviceaccount\.com$/;
const seconds=n=>Number.isSafeInteger(n)&&n>=0;

function readUser(result,uid) {
  const users=result?.users;
  if(!Array.isArray(users) || users.length!==1 ||
     users[0]?.localId!==uid ||
     typeof users[0].disabled!=='boolean') throw new Error('AUTH_USER_NOT_CONFIRMED');
  const since=String(users[0].validSince ?? '0');
  if(!/^(0|[1-9][0-9]*)$/.test(since)) throw new Error('AUTH_REVOKE_TIMESTAMP_INVALID');
  const validSince=Number(since);
  if(!seconds(validSince)) throw new Error('AUTH_REVOKE_TIMESTAMP_INVALID');
  return {firebaseUid:uid,disabled:users[0].disabled,validSince};
}

export function createPilotFirebaseAuthRevoker(env, options={}) {
  requireStaging(env);
  if(env.PHASE3_TRUSTED_FIREBASE_AUTH_REVOKER_ENABLED!=='true' ||
     !ACCOUNT_EMAIL.test(env.PHASE3_AUTH_SERVICE_ACCOUNT_EMAIL||'') ||
     typeof env.PHASE3_AUTH_PRIVATE_KEY!=='string' ||
     !env.PHASE3_AUTH_PRIVATE_KEY.includes('BEGIN PRIVATE KEY'))
    throw new Error('PILOT_AUTH_REVOKER_DISABLED');
  const send=options.fetchImpl ?? fetch;
  const nowSeconds=options.nowSeconds ?? (()=>Math.floor(Date.now()/1000));
  if(typeof send!=='function'||typeof nowSeconds!=='function')
    throw new Error('INVALID_REVOCATION_DEPENDENCY');

  let token=null,validUntil=0;
  async function oauth() {
    const now=nowSeconds();
    if(!seconds(now)||now<1) throw new Error('INVALID_CLOCK');
    if(token&&now+90<validUntil)return token;
    const assertion=await signJwt({
      FIREBASE_PRIVATE_KEY:env.PHASE3_AUTH_PRIVATE_KEY,
    },{
      iss:env.PHASE3_AUTH_SERVICE_ACCOUNT_EMAIL,
      scope:SCOPE,aud:OAUTH_URL,iat:now,exp:now+3500,
    });
    const body=new URLSearchParams({
      grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion,
    }).toString();
    const response=await send(OAUTH_URL,{
      method:'POST',redirect:'error',
      headers:{'content-type':'application/x-www-form-urlencoded'},
      body,
    });
    if(!response.ok)throw new Error('AUTH_OAUTH_UNAVAILABLE');
    const data=await response.json();
    if(data?.token_type!=='Bearer' ||
       typeof data.access_token!=='string' ||
       data.access_token.length<12||data.access_token.length>8192 ||
       !Number.isSafeInteger(data.expires_in)||
       data.expires_in<120||data.expires_in>7200)
      throw new Error('INVALID_AUTH_OAUTH_RESPONSE');
    token=data.access_token;
    validUntil=now+data.expires_in;
    return token;
  }

  async function request(endpoint,body) {
    const accessToken=await oauth();
    return send(AUTH_ROOT+endpoint,{
      method:'POST',redirect:'error',
      headers:{
        authorization:'Bearer '+accessToken,
        'content-type':'application/json',
      },
      body:JSON.stringify(body),
    });
  }

  async function lookup(uid) {
    const response=await request('lookup',{localId:[uid]});
    if(!response.ok)throw new Error('AUTH_LOOKUP_UNAVAILABLE');
    return readUser(await response.json(),uid);
  }

  return {
    async disableAndRevoke(desired) {
      if(!desired || typeof desired!=='object' || Array.isArray(desired) ||
        Object.keys(desired).sort().join(',')!==
          'authVersion,firebaseUid,revokeAfterSeconds' ||
        !UID.test(desired.firebaseUid) ||
        !Number.isSafeInteger(desired.authVersion) ||
        desired.authVersion<2 ||
        !seconds(desired.revokeAfterSeconds))
        throw new Error('INVALID_AUTH_REVOCATION');

      // Always read live Firebase Auth state. Never trust a cached response
      // or the success status of an update request for proof.
      const existing=await lookup(desired.firebaseUid);
      const now=nowSeconds();
      if(!seconds(now)||now<1) throw new Error('INVALID_CLOCK');
      const cutoff=Math.max(now,desired.revokeAfterSeconds);
      if(existing.disabled && existing.validSince>=cutoff) return existing;
      const response=await request('update',{
        localId:desired.firebaseUid,
        validSince:String(Math.max(existing.validSince,cutoff)),
        disableUser:true,
      });
      if(!response.ok)throw new Error('AUTH_DISABLE_UNAVAILABLE');
      const body=await response.json();
      if(body?.localId!==desired.firebaseUid)
        throw new Error('AUTH_DISABLE_NOT_CONFIRMED');

      const committed=await lookup(desired.firebaseUid);
      if(committed.disabled!==true ||
         committed.validSince<cutoff ||
         committed.validSince<existing.validSince)
        throw new Error('AUTH_DISABLE_NOT_CONFIRMED');
      return committed;
    },
  };
}
