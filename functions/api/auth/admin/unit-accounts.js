import {bindStagingDatabaseForRequest} from '../../../_shared/staging-db-binding.mjs';
import {
  requireStaging, json, checkRequest, smallJson, verifiedGoogleAdmin,
  hashPassword, randomPassword, noSecrets, failSafe,
} from '../../../_shared/auth.mjs';

// Phase 2B staging-only D1 test records. No real users, no password inputs,
// and no authentication endpoint accepts these test_unit_ accounts.
const SYNTHETIC_USERNAME = /^test_unit_[a-f0-9]{12}$/;

function isExactFields(data, keys) {
  const received = Object.keys(data).sort();
  return received.length === keys.length &&
    received.every((key, index) => key === [...keys].sort()[index]);
}
function isSyntheticUsername(value) {
  return typeof value === 'string' && SYNTHETIC_USERNAME.test(value);
}
function publicAccount(row) {
  return {
    username: row.username,
    role: 'student',
    active: row.active === 1,
    passwordResetRequired: row.password_reset_required === 1,
    createdAt: Number(row.created_at),
  };
}

export async function handleSyntheticUnitAccountAction(db, data) {
  const action = data.action;
  if (action === 'list') {
    if (!isExactFields(data, ['action'])) return json({error:'INVALID_REQUEST'},400);
    const result = await db.prepare(
      "SELECT username, active, password_reset_required, created_at FROM unit_accounts " +
      "WHERE username GLOB 'test_unit_*' ORDER BY created_at DESC, username DESC LIMIT 50"
    ).all();
    return json({accounts:(result.results || []).map(publicAccount),mode:'synthetic-only'});
  }
  if (action === 'create') {
    if (!isExactFields(data, ['action'])) return json({error:'INVALID_REQUEST'},400);
    const username = 'test_unit_' + crypto.randomUUID().replaceAll('-','').slice(0,12);
    const uid = 'student_' + crypto.randomUUID().replaceAll('-','');
    // A random password is hashed then discarded: NOT delivered to the browser.
    // Reset is required and login is not implemented for these staging records.
    const kdf = await hashPassword(randomPassword());
    const now = Math.floor(Date.now()/1000);
    await db.prepare(
      "INSERT INTO unit_accounts (username,firebase_uid,role,password_salt,password_hash," +
      "kdf_scheme,kdf_iterations,active,password_reset_required,auth_version,created_at,updated_at) " +
      "VALUES (?,?,'student',?,?,'cf-chain-v1',?,0,1,1,?,?)"
    ).bind(username,uid,kdf.salt,kdf.hash,kdf.iterations,now,now).run();
    return json({
      account: publicAccount({username,active:0,password_reset_required:1,created_at:now}),
      mode:'synthetic-only',
    },201);
  }

  if (action === 'reset-password') {
    if (!isExactFields(data, ['action','username']) || !isSyntheticUsername(data.username)) {
      return json({error:'INVALID_ACTION_OR_USERNAME'},400);
    }
    const username = data.username;
    const existing = await db.prepare(
      "SELECT username FROM unit_accounts WHERE username=? AND username GLOB 'test_unit_*'"
    ).bind(username).first();
    if (!existing) return json({error:'SYNTHETIC_ACCOUNT_NOT_FOUND'},404);

    // A fresh temporary credential is returned ONCE to the verified staging
    // Admin only. Never store plaintext or log it. It cannot be used to sign in:
    // the unit_accounts login path is intentionally not enabled yet.
    const temporaryPassword = randomPassword();
    const kdf = await hashPassword(temporaryPassword);
    const now = Math.floor(Date.now()/1000);
    const result = await db.prepare(
      "UPDATE unit_accounts SET password_salt=?,password_hash=?,kdf_iterations=?," +
      "password_reset_required=1,auth_version=auth_version+1,updated_at=?," +
      "password_changed_at=? WHERE username=? AND username GLOB 'test_unit_*'"
    ).bind(kdf.salt,kdf.hash,kdf.iterations,now,now,username).run();
    if (!result.success || !result.meta || result.meta.changes !== 1) {
      return json({error:'SYNTHETIC_ACCOUNT_NOT_FOUND'},404);
    }
    return json({username,temporaryPassword,mode:'synthetic-only',
      note:'CHỈ DỮ LIỆU GIẢ: Mật khẩu tạm hiển thị một lần, vẫn yêu cầu đổi và chưa được phép đăng nhập.'});
  }

  if (!['lock','unlock','delete'].includes(action) ||
      !isExactFields(data, ['action','username']) ||
      !isSyntheticUsername(data.username)) {
    return json({error:'INVALID_ACTION_OR_USERNAME'},400);
  }
  const username=data.username;
  if (action === 'delete') {
    const result = await db.prepare(
      "DELETE FROM unit_accounts WHERE username=? AND username GLOB 'test_unit_*'"
    ).bind(username).run();
    if (!result.success || !result.meta || result.meta.changes !== 1) {
      return json({error:'SYNTHETIC_ACCOUNT_NOT_FOUND'},404);
    }
    return json({deleted:true,username,mode:'synthetic-only'});
  }
  const active = action === 'unlock' ? 1 : 0;
  const now = Math.floor(Date.now()/1000);
  const result = await db.prepare(
    "UPDATE unit_accounts SET active=?,auth_version=auth_version+1,updated_at=?," +
    "disabled_at=? WHERE username=? AND username GLOB 'test_unit_*'"
  ).bind(active,now,active ? null : now,username).run();
  if (!result.success || !result.meta || result.meta.changes !== 1) {
    return json({error:'SYNTHETIC_ACCOUNT_NOT_FOUND'},404);
  }
  // Unlock only changes D1 state; no login endpoint uses unit_accounts yet.
  return json({username,active:active===1,mode:'synthetic-only'});
}

export async function onRequestPost({request, env}) {
  env=bindStagingDatabaseForRequest(env,request);
  const invalid = checkRequest(request);
  if (invalid) return invalid;
  try { requireStaging(env); } catch { return noSecrets(); }
  // Verify signed Google Firebase ID token and exact bootstrap Admin UID.
  if (!await verifiedGoogleAdmin(request)) {
    return json({error:'ADMIN_AUTH_REQUIRED'},403);
  }
  let data;
  try { data = await smallJson(request); }
  catch { return json({error:'INVALID_REQUEST'},400); }
  try {
    return await handleSyntheticUnitAccountAction(env.AUTH_DB, data);
  } catch (error) {
    // No passwords, hashes, SQL text or JWTs in client responses/logs.
    console.error('Staging unit account API:',error?.name || 'unknown');
    return failSafe();
  }
}
