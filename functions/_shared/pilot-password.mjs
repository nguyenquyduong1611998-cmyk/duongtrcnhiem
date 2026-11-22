import {
  ADMIN_UID, json, randomPassword, hashPassword, pbkdf2, equalSecret,
  GENERIC_LOGIN_ERROR, failSafe,
} from './auth.mjs';

// SYNTHETIC ONLY. Never authorize an app session, issue a Firebase token,
// or reuse cf-chain-v1 for real student passwords.
const PILOT_USERNAME = /^pilot_hv_[a-f0-9]{12}$/;
const DUMMY_SALT = 'cf-chain-v1.AAAAAAAAAAAAAAAAAAAAAA';
const WINDOW_SECONDS = 15 * 60;
const LOCK_AFTER = 5;

function exactKeys(data, wanted) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const keys = Object.keys(data).sort();
  const expected = [...wanted].sort();
  return keys.length === expected.length &&
    keys.every((key, i) => key === expected[i]);
}

function validNewPassword(password) {
  return typeof password === 'string' &&
    password.length >= 12 && password.length <= 128 &&
    /[a-z]/.test(password) && /[A-Z]/.test(password) &&
    /[0-9]/.test(password) && /[^a-zA-Z0-9]/.test(password) &&
    !/\s/.test(password);
}

function validOldPassword(password) {
  return typeof password === 'string' && password.length > 0 &&
    password.length <= 128;
}

export async function issuePilotTemporaryPassword(db, data, actorUid) {
  if (actorUid !== ADMIN_UID || !exactKeys(data, ['username']) ||
      typeof data.username !== 'string' || !PILOT_USERNAME.test(data.username)) {
    return json({error:'INVALID_REQUEST'},400);
  }
  const row = await db.prepare(
    'SELECT enrollment_id,status FROM student_pilot_enrollments WHERE username=?'
  ).bind(data.username).first();
  if (!row || row.status !== 'pending') return json({error:'PILOT_NOT_AVAILABLE'},404);

  const temporaryPassword = randomPassword();
  // Intentionally uses only the existing, versioned staging KDF.
  // This is not a credential path for real students.
  const next = await hashPassword(temporaryPassword);
  const now = Math.floor(Date.now()/1000);
  const results = await db.batch([
    db.prepare(
      'INSERT INTO student_pilot_credentials ' +
      '(enrollment_id,password_salt,password_hash,kdf_iterations,' +
      'password_reset_required,password_version,updated_at,password_changed_at) ' +
      "SELECT enrollment_id,?,?,?,1,1,?,NULL FROM student_pilot_enrollments " +
      "WHERE enrollment_id=? AND status='pending' " +
      'ON CONFLICT(enrollment_id) DO UPDATE SET ' +
      'password_salt=excluded.password_salt,password_hash=excluded.password_hash,' +
      'kdf_iterations=excluded.kdf_iterations,password_reset_required=1,' +
      'password_version=student_pilot_credentials.password_version+1,' +
      'updated_at=excluded.updated_at,password_changed_at=NULL'
    ).bind(next.salt,next.hash,next.iterations,now,row.enrollment_id),
    db.prepare(
      'UPDATE student_pilot_enrollments SET auth_version=auth_version+1,updated_at=? ' +
      "WHERE enrollment_id=? AND status='pending' " +
      'AND EXISTS (SELECT 1 FROM student_pilot_credentials ' +
      'WHERE enrollment_id=? AND password_salt=?)'
    ).bind(now,row.enrollment_id,row.enrollment_id,next.salt),
    db.prepare(
      'INSERT INTO student_pilot_password_audit ' +
      '(event_id,enrollment_id,actor_type,action,created_at) ' +
      "SELECT ?,enrollment_id,'admin','temporary-issued',? " +
      'FROM student_pilot_credentials WHERE enrollment_id=? AND password_salt=?'
    ).bind(crypto.randomUUID(),now,row.enrollment_id,next.salt),
    db.prepare(
      'DELETE FROM student_pilot_password_attempts WHERE enrollment_id=?'
    ).bind(row.enrollment_id),
  ]);
  if (!Array.isArray(results) || results.length !== 4 ||
      results.slice(0,3).some(result=>result?.success !== true || result.meta?.changes !== 1) ||
      results[3]?.success !== true) {
    return failSafe();
  }
  // Password is returned ONCE to the verified Admin and is not stored as plaintext.
  return json({
    username:data.username,temporaryPassword,
    mode:'synthetic-only',requiresPasswordChange:true,loginEnabled:false,
  });
}

async function recordBadTemporaryPassword(db, accountId, old, now) {
  if (!accountId) return;
  const stillWithinWindow = old && now - old.first_failed <= WINDOW_SECONDS;
  const failures = stillWithinWindow ? old.failures + 1 : 1;
  const firstFailed = stillWithinWindow ? old.first_failed : now;
  const lockedUntil = failures >= LOCK_AFTER ? now + WINDOW_SECONDS : 0;
  await db.prepare(
    'INSERT INTO student_pilot_password_attempts ' +
    '(enrollment_id,failures,first_failed,locked_until) VALUES (?,?,?,?) ' +
    'ON CONFLICT(enrollment_id) DO UPDATE SET failures=excluded.failures,' +
    'first_failed=excluded.first_failed,locked_until=excluded.locked_until'
  ).bind(accountId,Math.min(failures,1000000),firstFailed,lockedUntil).run();
}

export async function rotatePilotTemporaryPassword(db, data) {
  if (!exactKeys(data,['username','temporaryPassword','newPassword']) ||
      typeof data.username !== 'string' || !PILOT_USERNAME.test(data.username) ||
      !validOldPassword(data.temporaryPassword)) {
    return json({error:GENERIC_LOGIN_ERROR},401);
  }
  if (!validNewPassword(data.newPassword) ||
      data.temporaryPassword === data.newPassword) {
    return json({error:'INVALID_NEW_PASSWORD'},400);
  }
  const row = await db.prepare(
    'SELECT e.enrollment_id,e.status,c.password_salt,c.password_hash,' +
    'c.kdf_iterations,c.password_reset_required,c.password_version ' +
    'FROM student_pilot_enrollments e ' +
    'JOIN student_pilot_credentials c ON c.enrollment_id=e.enrollment_id ' +
    'WHERE e.username=?'
  ).bind(data.username).first();
  const now = Math.floor(Date.now()/1000);
  const old = row ? await db.prepare(
    'SELECT failures,first_failed,locked_until FROM student_pilot_password_attempts ' +
    'WHERE enrollment_id=?'
  ).bind(row.enrollment_id).first() : null;
  if (old && old.locked_until > now) return json({error:GENERIC_LOGIN_ERROR},429);

  // Dummy hash on absent accounts avoids a cheap username enumeration oracle.
  const computed = await pbkdf2(
    data.temporaryPassword,row?.password_salt || DUMMY_SALT,
    row?.kdf_iterations || 310000
  );
  if (!row || row.status !== 'pending' || row.password_reset_required !== 1 ||
      !equalSecret(computed,row.password_hash)) {
    await recordBadTemporaryPassword(db,row?.enrollment_id,old,now);
    return json({error:GENERIC_LOGIN_ERROR},401);
  }
  const next = await hashPassword(data.newPassword);
  const results = await db.batch([
    db.prepare(
      'UPDATE student_pilot_credentials SET password_salt=?,password_hash=?,' +
      'kdf_iterations=?,password_reset_required=0,' +
      'password_version=password_version+1,updated_at=?,password_changed_at=? ' +
      'WHERE enrollment_id=? AND password_hash=? AND password_version=? ' +
      'AND password_reset_required=1 ' +
      'AND EXISTS (SELECT 1 FROM student_pilot_enrollments ' +
      "WHERE enrollment_id=? AND status='pending')"
    ).bind(next.salt,next.hash,next.iterations,now,now,
      row.enrollment_id,row.password_hash,row.password_version,row.enrollment_id),
    db.prepare(
      'UPDATE student_pilot_enrollments SET auth_version=auth_version+1,updated_at=? ' +
      "WHERE enrollment_id=? AND status='pending' " +
      'AND EXISTS (SELECT 1 FROM student_pilot_credentials WHERE enrollment_id=? ' +
      'AND password_salt=? AND password_reset_required=0 AND password_version=?)'
    ).bind(now,row.enrollment_id,row.enrollment_id,next.salt,row.password_version+1),
    db.prepare(
      'INSERT INTO student_pilot_password_audit ' +
      '(event_id,enrollment_id,actor_type,action,created_at) ' +
      "SELECT ?,enrollment_id,'student','password-rotated',? " +
      'FROM student_pilot_credentials WHERE enrollment_id=? ' +
      'AND password_salt=? AND password_reset_required=0 AND password_version=?'
    ).bind(crypto.randomUUID(),now,row.enrollment_id,next.salt,row.password_version+1),
    db.prepare('DELETE FROM student_pilot_password_attempts WHERE enrollment_id=?')
      .bind(row.enrollment_id),
  ]);
  if (!Array.isArray(results) || results.length !== 4 ||
      results[0]?.success !== true) return failSafe();
  if (results[0].meta?.changes !== 1) return json({error:'ACCOUNT_CHANGED_RETRY'},409);
  if (results[1]?.success !== true || results[1].meta?.changes !== 1 ||
      results[2]?.success !== true || results[2].meta?.changes !== 1 ||
      results[3]?.success !== true) return failSafe();
  // No Firebase session, UID, password or hash is returned.
  return json({
    passwordChanged:true,mode:'synthetic-only',loginEnabled:false,
  });
}
