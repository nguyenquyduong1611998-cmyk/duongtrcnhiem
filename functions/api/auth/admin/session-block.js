import {
  requireStaging,json,checkRequest,smallJson,verifiedGoogleAdmin,
  ADMIN_UID,noSecrets,failSafe,
} from '../../../_shared/auth.mjs';

const STUDENT_UID=/^student_[a-f0-9]{32}$/;

// Only blocks authorization for Cloudflare endpoints guarded by student-session.mjs.
// Does NOT call Firebase's revokeRefreshTokens or revoke direct Firestore access.
// Retained as a disabled-by-default synthetic-stage proof until full rollout.
export async function blockStudentServerAccess(db,data,actorUid) {
  if(actorUid!==ADMIN_UID || !data || Array.isArray(data) ||
    typeof data!=='object' || Object.keys(data).length!==1 ||
    typeof data.firebaseUid!=='string' ||
    !STUDENT_UID.test(data.firebaseUid)) {
    return json({error:'INVALID_REQUEST'},400);
  }
  const uid=data.firebaseUid;
  const old=await db.prepare(
    'SELECT active,auth_version,tokens_valid_after ' +
    'FROM student_auth_identities WHERE firebase_uid=?'
  ).bind(uid).first();
  if(!old) return json({error:'ACCOUNT_NOT_FOUND'},404);
  if(old.active!==1) {
    return json({blocked:true,alreadyBlocked:true,mode:'server-access-only'});
  }
  if(!Number.isSafeInteger(old.auth_version) || old.auth_version<1 ||
     !Number.isSafeInteger(old.tokens_valid_after) ||
     old.tokens_valid_after<0) return failSafe();

  const now=Math.floor(Date.now()/1000);
  const newVersion=old.auth_version+1;
  const eventId=crypto.randomUUID();
  const statements=[
    db.prepare(
      'UPDATE student_auth_identities SET active=0,' +
      'auth_version=auth_version+1,' +
      'tokens_valid_after=MAX(tokens_valid_after,?),updated_at=? ' +
      'WHERE firebase_uid=? AND active=1 AND auth_version=?'
    ).bind(now,now,uid,old.auth_version),
    db.prepare(
      'INSERT INTO student_auth_block_audit ' +
      '(event_id,firebase_uid,actor_uid,action,prior_auth_version,' +
      'new_auth_version,created_at) ' +
      "SELECT ?,firebase_uid,?,'server-access-blocked',?,?,? " +
      'FROM student_auth_identities WHERE firebase_uid=? ' +
      'AND active=0 AND auth_version=?'
    ).bind(eventId,actorUid,old.auth_version,newVersion,now,uid,newVersion),
  ];
  const results=await db.batch(statements);
  if(!Array.isArray(results) || results.length!==2 ||
     results.some(r=>r?.success!==true)) return failSafe();
  if(results[0].meta?.changes!==1) return json({error:'ACCOUNT_CHANGED_RETRY'},409);
  if(results[1].meta?.changes!==1) return failSafe();
  return json({blocked:true,alreadyBlocked:false,mode:'server-access-only'});
}

export async function onRequestPost({request,env}) {
  const invalid=checkRequest(request);
  if(invalid)return invalid;
  if(env?.PHASE3_STUDENT_BLOCK_ENABLED!=='true')
    return json({error:'NOT_FOUND'},404);
  try{requireStaging(env);}catch{return noSecrets();}
  if(!await verifiedGoogleAdmin(request))
    return json({error:'ADMIN_AUTH_REQUIRED'},403);
  let data;
  try{data=await smallJson(request);}catch{return json({error:'INVALID_REQUEST'},400);}
  try{return await blockStudentServerAccess(env.AUTH_DB,data,ADMIN_UID);}
  catch(error){
    console.error('Phase3 session blocking category:',error?.name||'unknown');
    return failSafe();
  }
}
