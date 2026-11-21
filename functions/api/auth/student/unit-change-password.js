import {
  requireStaging, json, checkRequest, smallJson, pbkdf2, hashPassword,
  equalSecret, GENERIC_LOGIN_ERROR, noSecrets, failSafe,
} from '../../../_shared/auth.mjs';

// STAGING ONLY. Prove possession of the current one-time password, then rotate.
// This NEVER creates a Firebase session or changes a non-test_unit_ account.
const TEST_USERNAME=/^test_unit_[a-f0-9]{12}$/;
const DUMMY_SALT='cf-chain-v1.AAAAAAAAAAAAAAAAAAAAAA';
const WINDOW_SECONDS=15*60;
const MAX_FAILURES=5;

function validNewPassword(value) {
  return typeof value==='string' && value.length>=12 && value.length<=128 &&
    /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value) &&
    /[^a-zA-Z0-9]/.test(value) && !/\s/.test(value);
}

async function recordFailure(db,username,attempt,now) {
  const recent=attempt && now-attempt.first_failed<=WINDOW_SECONDS;
  const count=recent?attempt.failures+1:1;
  await db.prepare(
    'INSERT INTO login_attempts (username, failures, first_failed, locked_until) VALUES (?, ?, ?, ?) '+
    'ON CONFLICT(username) DO UPDATE SET failures=excluded.failures, first_failed=excluded.first_failed, locked_until=excluded.locked_until'
  ).bind(username,count,recent?attempt.first_failed:now,
    count>=MAX_FAILURES?now+WINDOW_SECONDS:0).run();
}

export async function changeSyntheticUnitPassword(db, data) {
  if(!data || typeof data!=='object' || Array.isArray(data) ||
     Object.keys(data).sort().join(',')!=='newPassword,temporaryPassword,username') {
    return json({error:'INVALID_REQUEST'},400);
  }
  const {username,temporaryPassword,newPassword}=data;
  if(typeof username!=='string' || !TEST_USERNAME.test(username) ||
     typeof temporaryPassword!=='string' || temporaryPassword.length<1 ||
     temporaryPassword.length>128) {
    return json({error:GENERIC_LOGIN_ERROR},401);
  }
  if(!validNewPassword(newPassword) || newPassword===temporaryPassword) {
    return json({error:'INVALID_NEW_PASSWORD'},400);
  }
  const now=Math.floor(Date.now()/1000);
  const attempts=await db.prepare(
    'SELECT failures, first_failed, locked_until FROM login_attempts WHERE username=?'
  ).bind(username).first();
  if(attempts && attempts.locked_until>now) {
    return json({error:GENERIC_LOGIN_ERROR},429);
  }
  const account=await db.prepare(
    "SELECT password_salt,password_hash,kdf_iterations,active,role,password_reset_required,auth_version "+
    "FROM unit_accounts WHERE username=? AND username GLOB 'test_unit_*'"
  ).bind(username).first();
  const temporaryHash=await pbkdf2(temporaryPassword,account?.password_salt||DUMMY_SALT,
    account?.kdf_iterations||310000);
  if(!account || account.role!=='student' || account.active!==1 ||
     account.password_reset_required!==1 || !equalSecret(temporaryHash,account.password_hash)) {
    await recordFailure(db,username,attempts,now);
    return json({error:GENERIC_LOGIN_ERROR},401);
  }

  // The state and old hash must match at write time, preventing a concurrent
  // reset / disable / previous password reuse from silently succeeding.
  const next=await hashPassword(newPassword);
  const result=await db.prepare(
    "UPDATE unit_accounts SET password_salt=?,password_hash=?,kdf_iterations=?,"+
    "password_reset_required=0,auth_version=auth_version+1,updated_at=?,password_changed_at=? "+
    "WHERE username=? AND username GLOB 'test_unit_*' AND active=1 "+
    "AND password_reset_required=1 AND password_hash=? AND auth_version=?"
  ).bind(next.salt,next.hash,next.iterations,now,now,username,
    account.password_hash,account.auth_version).run();
  if(!result.success || result.meta?.changes!==1) {
    return json({error:'ACCOUNT_CHANGED_RETRY'},409);
  }
  await db.prepare('DELETE FROM login_attempts WHERE username=?').bind(username).run();
  // No password, hash, UID, session token or sign-in permission in the response.
  return json({passwordChanged:true,mode:'synthetic-only',
    loginEnabled:false,username});
}

export async function onRequestPost({request,env}) {
  const invalid=checkRequest(request);
  if(invalid)return invalid;
  try { requireStaging(env); } catch { return noSecrets(); }
  let data;
  try { data=await smallJson(request); }
  catch { return json({error:'INVALID_REQUEST'},400); }
  try {
    return await changeSyntheticUnitPassword(env.AUTH_DB,data);
  } catch(error) {
    console.error('Synthetic password rotation category:',error?.name||'unknown');
    return failSafe();
  }
}
