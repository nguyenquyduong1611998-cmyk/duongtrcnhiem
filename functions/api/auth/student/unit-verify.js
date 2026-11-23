import {bindStagingDatabaseForRequest} from '../../../_shared/staging-db-binding.mjs';
import {
  requireStaging, json, checkRequest, smallJson, pbkdf2, equalSecret,
  GENERIC_LOGIN_ERROR, noSecrets, failSafe,
} from '../../../_shared/auth.mjs';

// STAGING-ONLY: authentication preflight for synthetic test_unit_ accounts.
// Never issues a Firebase custom token or an app session.
const TEST_USERNAME = /^test_unit_[a-f0-9]{12}$/;
const DUMMY_SALT='cf-chain-v1.AAAAAAAAAAAAAAAAAAAAAA';
const WINDOW_SECONDS=15*60;
const MAX_FAILURES=5;

async function countFailedAttempt(db,username,attempt,now) {
  const recent=attempt && now-attempt.first_failed<=WINDOW_SECONDS;
  const failures=recent?attempt.failures+1:1;
  const firstFailed=recent?attempt.first_failed:now;
  const lockedUntil=failures>=MAX_FAILURES?now+WINDOW_SECONDS:0;
  await db.prepare(
    'INSERT INTO login_attempts (username, failures, first_failed, locked_until) VALUES (?, ?, ?, ?) '+
    'ON CONFLICT(username) DO UPDATE SET failures=excluded.failures, first_failed=excluded.first_failed, locked_until=excluded.locked_until'
  ).bind(username,failures,firstFailed,lockedUntil).run();
}

export async function verifySyntheticUnitCredential(db, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      Object.keys(data).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(data,'username') ||
      !Object.prototype.hasOwnProperty.call(data,'password')) {
    return json({error:'INVALID_REQUEST'},400);
  }
  const username=data.username;
  const password=data.password;
  if (typeof username !== 'string' || !TEST_USERNAME.test(username) ||
      typeof password !== 'string' || password.length===0 || password.length>128) {
    return json({error:GENERIC_LOGIN_ERROR},401);
  }
  const now=Math.floor(Date.now()/1000);
  const attempt=await db.prepare(
    'SELECT failures, first_failed, locked_until FROM login_attempts WHERE username=?'
  ).bind(username).first();
  if (attempt && attempt.locked_until>now) {
    return json({error:GENERIC_LOGIN_ERROR},429);
  }
  const user=await db.prepare(
    'SELECT username,password_salt,password_hash,kdf_iterations,active,password_reset_required,role '+
    'FROM unit_accounts WHERE username=? AND username GLOB \'test_unit_*\''
  ).bind(username).first();
  const hash=await pbkdf2(password,user?.password_salt||DUMMY_SALT,user?.kdf_iterations||310000);
  if (!user || user.role!=='student' || user.active!==1 ||
      !equalSecret(hash,user.password_hash)) {
    await countFailedAttempt(db,username,attempt,now);
    return json({error:GENERIC_LOGIN_ERROR},401);
  }
  await db.prepare('DELETE FROM login_attempts WHERE username=?').bind(username).run();
  // No Firebase UID, token, password or hash is sent to the client.
  // Correct passwords never grant a session while synthetic login is disabled.
  if (user.password_reset_required===1) {
    return json({error:'TEMPORARY_PASSWORD_VALID_RESET_REQUIRED',mode:'synthetic-only'},409);
  }
  return json({error:'PASSWORD_CHANGED_LOGIN_DISABLED',mode:'synthetic-only'},409);
}

export async function onRequestPost({request,env}) {
  env=bindStagingDatabaseForRequest(env,request);
  const invalid=checkRequest(request);
  if (invalid)return invalid;
  try{requireStaging(env);}catch{return noSecrets();}
  let data;
  try{data=await smallJson(request);}
  catch{return json({error:'INVALID_REQUEST'},400);}
  try{
    return await verifySyntheticUnitCredential(env.AUTH_DB,data);
  }catch(error){
    console.error('Synthetic D1 credential check category:',error?.name || 'unknown');
    return failSafe();
  }
}
