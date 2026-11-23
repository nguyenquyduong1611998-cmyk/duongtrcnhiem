import {PROJECT_ID,requireStaging,signJwt} from './auth.mjs';

// Phase 3F: UNWIRED server-only Firestore pilot revocation writer.
// Do not attach to a route, scheduled trigger or real-account onboarding.
// A service-account OAuth token bypasses Firestore Security Rules: this code
// MUST stay server-side, use least-privilege IAM, and never serve callers'
// arbitrary collection paths or project IDs. Default OFF even on staging.
//
// Requires a DEDICATED server-only service account, separate from the existing\n// Firebase custom-token signing key. Neither key nor access token is logged.\n// It updates ONLY pilot_session_states/{student_[a-f0-9]{32}} and cannot\n// reactivate an identity. All compare/write operations use Firestore's
// currentDocument preconditions; the committed state is re-read before ack.
// It DOES NOT revoke Firebase Auth refresh tokens or disable Auth users.
const UID=/^student_[a-f0-9]{32}$/;
const STAGING_SERVICE_ACCOUNT=new RegExp(
  '^[-a-z0-9]+@'+PROJECT_ID.replace(/[-]/g,'\\-')+'\\.iam\\.gserviceaccount\\.com$'
);
const TOKEN_ENDPOINT='https://oauth2.googleapis.com/token';
const FIRESTORE_BASE='https://firestore.googleapis.com/v1/projects/'+
  PROJECT_ID+'/databases/(default)/documents/pilot_session_states/';
const SCOPE='https://www.googleapis.com/auth/datastore';
const MAX_RETRIES=5;

const validSeconds=n=>Number.isSafeInteger(n)&&n>=0;
const validVersion=n=>Number.isSafeInteger(n)&&n>=1;

function validateDesired(desired) {
  if(!desired || typeof desired!=='object' || Array.isArray(desired) ||
    Object.keys(desired).sort().join(',')!==
      'active,authVersion,firebaseUid,revokeAfterSeconds' ||
    desired.active!==false || !UID.test(desired.firebaseUid) ||
    !validVersion(desired.authVersion) ||
    !validSeconds(desired.revokeAfterSeconds)) {
    throw new Error('INVALID_REVOCATION');
  }
}

function parseServerState(body) {
  if(!body || !body.fields || typeof body.fields!=='object') {
    throw new Error('INVALID_FIRESTORE_DOCUMENT');
  }
  const {active,authVersion,revokeAfterSeconds}=body.fields;
  if(typeof active?.booleanValue!=='boolean' ||
    !/^(0|[1-9]\d*)$/.test(String(authVersion?.integerValue??'')) ||
    !/^(0|[1-9]\d*)$/.test(String(revokeAfterSeconds?.integerValue??''))) {
    throw new Error('INVALID_FIRESTORE_STATE');
  }
  const result={
    active:active.booleanValue,
    authVersion:Number(authVersion.integerValue),
    revokeAfterSeconds:Number(revokeAfterSeconds.integerValue),
  };
  if(!validVersion(result.authVersion) ||
     !validSeconds(result.revokeAfterSeconds))
    throw new Error('INVALID_FIRESTORE_STATE');
  return result;
}

function encodeState(active,authVersion,revokeAfterSeconds) {
  return {fields:{
    active:{booleanValue:active},
    authVersion:{integerValue:String(authVersion)},
    revokeAfterSeconds:{integerValue:String(revokeAfterSeconds)},
  }};
}

function acceptableCommitted(result,desired) {
  return result?.active===false &&
    validVersion(result.authVersion) &&
    result.authVersion>=desired.authVersion &&
    validSeconds(result.revokeAfterSeconds) &&
    result.revokeAfterSeconds>=desired.revokeAfterSeconds;
}

export function createPilotFirestoreRevocationWriter(env, options={}) {
  // This function is only called by trusted backend code; no request can
  // provide its options. Never instantiate when the feature flag is absent.
  requireStaging(env);
  if(env.PHASE3_TRUSTED_FIRESTORE_WRITER_ENABLED!=='true' ||
     !STAGING_SERVICE_ACCOUNT.test(env.PHASE3_FIRESTORE_SERVICE_ACCOUNT_EMAIL || '') ||
     typeof env.PHASE3_FIRESTORE_PRIVATE_KEY!=='string' ||
     !env.PHASE3_FIRESTORE_PRIVATE_KEY.includes('BEGIN PRIVATE KEY')) {
    throw new Error('PILOT_FIRESTORE_WRITER_DISABLED');
  }
  const fetchImpl=options.fetchImpl ?? fetch;
  const seconds=options.nowSeconds ?? (()=>Math.floor(Date.now()/1000));
  if(typeof fetchImpl!=='function' || typeof seconds!=='function')
    throw new Error('INVALID_WRITER_DEPENDENCY');

  let cachedToken=null;
  let tokenValidUntil=0;
  async function accessToken() {
    const now=seconds();
    if(!validSeconds(now)) throw new Error('INVALID_CLOCK');
    if(cachedToken && now+90<tokenValidUntil) return cachedToken;
    const assertion=await signJwt({
      FIREBASE_PRIVATE_KEY:env.PHASE3_FIRESTORE_PRIVATE_KEY,
    },{
      iss:env.PHASE3_FIRESTORE_SERVICE_ACCOUNT_EMAIL,
      scope:SCOPE,
      aud:TOKEN_ENDPOINT,
      iat:now,exp:now+3500,
    });
    const body=new URLSearchParams({
      grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString();
    const response=await fetchImpl(TOKEN_ENDPOINT,{
      method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded'},
      body,redirect:'error',
    });
    if(!response.ok) throw new Error('GOOGLE_OAUTH_UNAVAILABLE');
    const token=await response.json();
    if(token?.token_type!=='Bearer' ||
      typeof token.access_token!=='string' ||
      token.access_token.length<12 || token.access_token.length>8192 ||
      !Number.isSafeInteger(token.expires_in) ||
      token.expires_in<120 || token.expires_in>7200)
      throw new Error('INVALID_GOOGLE_OAUTH_RESPONSE');
    cachedToken=token.access_token;
    tokenValidUntil=now+token.expires_in;
    return cachedToken;
  }
  async function firestoreRequest(path,init) {
    const token=await accessToken();
    return fetchImpl(path,{
      ...init,redirect:'error',
      headers:{
        authorization:'Bearer '+token,
        ...(init?.body?{'content-type':'application/json'}:{}),
      },
    });
  }
  async function readDocument(path) {
    const response=await firestoreRequest(path,{method:'GET'});
    if(response.status===404)return null;
    if(!response.ok)throw new Error('FIRESTORE_READ_UNAVAILABLE');
    const body=await response.json();
    if(typeof body?.updateTime!=='string' ||
       !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(body.updateTime)) {
      throw new Error('INVALID_FIRESTORE_UPDATE_TIME');
    }
    return {value:parseServerState(body),updateTime:body.updateTime};
  }
  return {
    async applyRevokedState(desired) {
      validateDesired(desired);
      const path=FIRESTORE_BASE+desired.firebaseUid;
      for(let attempt=0;attempt<MAX_RETRIES;attempt++) {
        const current=await readDocument(path);
        // An older event must never disable a NEWER active version. A newer
        // disabled state already satisfies this event if cutoff is sufficient.
        if(current && current.value.authVersion>desired.authVersion &&
           current.value.active===true)
          throw new Error('NEWER_ACTIVE_SESSION_REQUIRES_REVIEW');
        if(current && acceptableCommitted(current.value,desired))
          return current.value;

        const nextVersion=Math.max(
          desired.authVersion,current?.value.authVersion||0,
        );
        const nextCutoff=Math.max(
          desired.revokeAfterSeconds,current?.value.revokeAfterSeconds||0,
        );
        const url=new URL(path);
        for(const field of ['active','authVersion','revokeAfterSeconds'])
          url.searchParams.append('updateMask.fieldPaths',field);
        if(current)url.searchParams.set(
          'currentDocument.updateTime',current.updateTime,
        );
        else url.searchParams.set('currentDocument.exists','false');

        const response=await firestoreRequest(url.toString(),{
          method:'PATCH',
          body:JSON.stringify(encodeState(false,nextVersion,nextCutoff)),
        });
        // Another worker updated the document. Read anew and retry using the
        // returned updateTime. Never overwrite a newer state unconditionally.
        if(response.status===409 || response.status===412)continue;
        if(!response.ok)throw new Error('FIRESTORE_WRITE_UNAVAILABLE');

        // A 200 or 201 response is not sufficient proof. Read server state
        // after the write and confirm monotonic disabled values.
        const committed=await readDocument(path);
        if(committed && acceptableCommitted(committed.value,desired))
          return committed.value;
        throw new Error('FIRESTORE_REVOCATION_NOT_CONFIRMED');
      }
      throw new Error('FIRESTORE_PRECONDITION_CONFLICT');
    },
  };
}
