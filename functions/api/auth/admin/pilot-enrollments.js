import {
  requireStaging, json, checkRequest, smallJson, verifiedGoogleAdmin,
  ADMIN_UID, noSecrets, failSafe,
} from '../../../_shared/auth.mjs';

// Phase 3 opt-in scaffold: never accepts a real username or a password.
// No student login endpoint reads this table; no Firebase custom token is minted.
// Even when feature-flagged on, new enrollments remain 'pending' (not active).
const MAX_PILOT_RECORDS = 100;

function hasExactFields(data, allowed) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const keys = Object.keys(data).sort();
  const expected = [...allowed].sort();
  return keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]);
}
function publicRow(row) {
  return {
    enrollmentId: row.enrollment_id,
    username: row.username,
    status: row.status,
    createdAt: Number(row.created_at),
  };
}

// Exported for isolated tests. Caller MUST gate access and verify the Admin ID token.
export async function handlePilotEnrollmentAction(db, data, actorUid) {
  if (!actorUid || actorUid !== ADMIN_UID ||
      !hasExactFields(data, data?.action === 'create' || data?.action === 'list' ? ['action'] : [])) {
    return json({error:'INVALID_REQUEST'},400);
  }
  if (data.action === 'list') {
    const found = await db.prepare(
      'SELECT enrollment_id,username,status,created_at ' +
      'FROM student_pilot_enrollments ORDER BY created_at DESC LIMIT ?'
    ).bind(MAX_PILOT_RECORDS).all();
    return json({
      mode:'pilot-no-login',
      loginEnabled:false,
      accounts:(found.results || []).map(publicRow),
    });
  }
  if (data.action !== 'create') return json({error:'INVALID_REQUEST'},400);

  const enrollmentId = 'pilot_' + crypto.randomUUID().replaceAll('-','');
  const username = 'pilot_hv_' + crypto.randomUUID().replaceAll('-','').slice(0,12);
  const eventId = crypto.randomUUID();
  const now = Math.floor(Date.now()/1000);

  // Both statements are one D1 transaction. The conditional audit SELECT prevents
  // an audit event when the maximum pilot record count blocks insertion.
  const statements = [
    db.prepare(
      "INSERT INTO student_pilot_enrollments " +
      "(enrollment_id,username,status,auth_version,created_at,updated_at) " +
      "SELECT ?,?,'pending',1,?,? " +
      "WHERE (SELECT COUNT(*) FROM student_pilot_enrollments) < ?"
    ).bind(enrollmentId,username,now,now,MAX_PILOT_RECORDS),
    db.prepare(
      "INSERT INTO student_pilot_audit (event_id,enrollment_id,actor_uid,action,created_at) " +
      "SELECT ?, enrollment_id, ?, 'created', ? " +
      "FROM student_pilot_enrollments WHERE enrollment_id=?"
    ).bind(eventId,actorUid,now,enrollmentId),
  ];
  const results = await db.batch(statements);
  if (!Array.isArray(results) || results.length !== 2 ||
      results[0]?.success !== true || results[1]?.success !== true) {
    return failSafe();
  }
  if (results[0].meta?.changes !== 1) {
    return json({error:'PILOT_CAPACITY_REACHED'},409);
  }
  if (results[1].meta?.changes !== 1) {
    return failSafe();
  }
  return json({
    mode:'pilot-no-login',
    loginEnabled:false,
    account:publicRow({
      enrollment_id:enrollmentId,username,status:'pending',created_at:now,
    }),
  },201);
}

export async function onRequestPost({request,env}) {
  const invalid = checkRequest(request);
  if (invalid) return invalid;

  // Opt-in must be explicitly set on the staging Pages environment. It is
  // intentionally NOT included in the existing STAGING_AUTH_ENABLED setting.
  if (env?.PHASE3_PILOT_ENROLLMENT_ENABLED !== 'true') {
    return json({error:'NOT_FOUND'},404);
  }
  try { requireStaging(env); } catch { return noSecrets(); }
  if (!await verifiedGoogleAdmin(request)) return json({error:'ADMIN_AUTH_REQUIRED'},403);
  let data;
  try { data = await smallJson(request); } catch { return json({error:'INVALID_REQUEST'},400); }
  try {
    return await handlePilotEnrollmentAction(env.AUTH_DB,data,ADMIN_UID);
  } catch (error) {
    // Do not log names, password material, Firebase UID, tokens, or raw SQL.
    console.error('Pilot enrollment backend error category:',error?.name || 'unknown');
    return failSafe();
  }
}
