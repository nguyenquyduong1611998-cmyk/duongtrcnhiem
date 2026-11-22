// Phase 3E: pure transport-agnostic D1 outbox consumer.
// This module is NOT attached to any HTTP endpoint, scheduled trigger, or
// production Firestore connection. A future trusted service must provide a
// monotonic Firestore transaction writer; no browser client may be that writer.
//
// Security contract for writer.applyRevokedState:
// - Only write pilot_session_states/{firebaseUid} from a trusted service;
// - never change an active:false state to active:true;
// - never decrease authVersion or revokeAfterSeconds;
// - read, compare and update in a single Firestore transaction;
// - be safe when the same event is retried or arrives after newer versions;
// - return the committed server state, not merely an HTTP acknowledgement.
//
// While an outbox item is pending, D1-protected APIs are already blocked but
// direct Firestore accesses might NOT YET be blocked. No end-to-end revocation
// guarantee until the trusted writer, monitoring, and Firebase Auth token
// revocation have been integrated and security-tested.

const UID=/^student_[a-f0-9]{32}$/;
const EVENT=/^[a-f0-9-]{36}$/;
const LEASE_SECONDS=60;
const MAX_BATCH=25;

function safeOutboxRow(row) {
  return row && EVENT.test(row.event_id) &&
    UID.test(row.firebase_uid) &&
    Number.isSafeInteger(row.auth_version) && row.auth_version>=2 &&
    Number.isSafeInteger(row.revoke_after_seconds) &&
    row.revoke_after_seconds>=0 &&
    Number.isSafeInteger(row.attempts) && row.attempts>=0 &&
    row.attempts<1000000;
}

function validConfirmation(applied,source) {
  return applied && applied.active===false &&
    Number.isSafeInteger(applied.authVersion) &&
    applied.authVersion>=source.authVersion &&
    Number.isSafeInteger(applied.revokeAfterSeconds) &&
    applied.revokeAfterSeconds>=source.revokeAfterSeconds;
}

function backoffSeconds(attempt) {
  // At least 10 seconds, capped at one hour. The event is never discarded.
  return Math.min(3600,5 * (2 ** Math.min(attempt,10)));
}

export async function deliverPilotSessionRevocations(db,writer,options={}) {
  if(!db?.prepare || typeof writer?.applyRevokedState!=='function')
    throw new Error('TRUSTED_DEPENDENCIES_REQUIRED');
  const now=options.now ?? Math.floor(Date.now()/1000);
  const limit=options.limit ?? 10;
  const leaseOwner=options.leaseOwner ?? crypto.randomUUID();
  if(!Number.isSafeInteger(now) || now<1 ||
     !Number.isSafeInteger(limit) || limit<1 || limit>MAX_BATCH ||
     !EVENT.test(leaseOwner)) throw new Error('INVALID_DRAIN_OPTIONS');

  const result=await db.prepare(
    'SELECT event_id,firebase_uid,auth_version,revoke_after_seconds,attempts ' +
    'FROM student_auth_mirror_outbox WHERE ' +
    "(state='pending' AND next_attempt_at<=?) OR " +
    "(state='processing' AND lease_until<=?) " +
    'ORDER BY created_at ASC LIMIT ?'
  ).bind(now,now,limit).all();
  const summary={claimed:0,delivered:0,retryScheduled:0,skipped:0};
  for(const row of (result?.results||[])) {
    if(!safeOutboxRow(row)) {
      summary.skipped++;
      continue;
    }
    const claim=await db.prepare(
      "UPDATE student_auth_mirror_outbox SET state='processing'," +
      'attempts=attempts+1,lease_owner=?,lease_until=?,updated_at=? ' +
      'WHERE event_id=? AND attempts=? AND ( ' +
      "(state='pending' AND next_attempt_at<=?) OR " +
      "(state='processing' AND lease_until<=?) )"
    ).bind(leaseOwner,now+LEASE_SECONDS,now,
      row.event_id,row.attempts,now,now).run();
    if(claim?.success!==true || claim?.meta?.changes!==1) {
      summary.skipped++;
      continue;
    }
    summary.claimed++;
    const desired={
      firebaseUid:row.firebase_uid,
      active:false,
      authVersion:row.auth_version,
      revokeAfterSeconds:row.revoke_after_seconds,
    };
    const newAttempt=row.attempts+1;
    try {
      const applied=await writer.applyRevokedState(desired);
      if(!validConfirmation(applied,desired))
        throw new Error('REVOCATION_NOT_CONFIRMED');
      const ack=await db.prepare(
        "UPDATE student_auth_mirror_outbox SET state='delivered'," +
        'lease_owner=NULL,lease_until=NULL,delivered_at=?,updated_at=? ' +
        "WHERE event_id=? AND state='processing' " +
        'AND lease_owner=? AND attempts=?'
      ).bind(now,now,row.event_id,leaseOwner,newAttempt).run();
      if(ack?.success===true && ack?.meta?.changes===1) {
        summary.delivered++;
      } else {
        // Lease lost or DB error. Future retry is safe only if the trusted
        // Firestore writer is idempotent and version-monotonic.
        summary.skipped++;
      }
    } catch {
      // Never print or persist an auth credential, token or raw network error.
      const retry=await db.prepare(
        "UPDATE student_auth_mirror_outbox SET state='pending'," +
        'lease_owner=NULL,lease_until=NULL,next_attempt_at=?,updated_at=? ' +
        "WHERE event_id=? AND state='processing' " +
        'AND lease_owner=? AND attempts=?'
      ).bind(now+backoffSeconds(newAttempt),now,
        row.event_id,leaseOwner,newAttempt).run();
      if(retry?.success===true && retry?.meta?.changes===1)
        summary.retryScheduled++;
      else summary.skipped++;
    }
  }
  return summary;
}
