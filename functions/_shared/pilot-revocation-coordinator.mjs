import {requireStaging} from './auth.mjs';
import {createPilotFirestoreRevocationWriter}
  from './firestore-session-writer.mjs';
import {createPilotFirebaseAuthRevoker}
  from './firebase-auth-revoker.mjs';
import {deliverPilotSessionRevocations}
  from './session-mirror-outbox.mjs';

// PHASE 3H: INTERNAL prototype composition; NO route/cron calls this.
// All three feature flags must be explicitly configured in staging.
// This is not an account provisioning system and must never be used to
// process production or admin UIDs. Still requires a durable staging IAM
// test, reconciliation, and a safe re-enable protocol before activation.
//
// The D1 authority is rechecked before Firestore and before Firebase Auth.
// A re-enable must be blocked while a revocation is pending or processing:
// independent systems cannot make cross-service operations atomic.
const UID=/^student_[a-f0-9]{32}$/;
function correctShape(desired) {
  return desired && !Array.isArray(desired) &&
    Object.keys(desired).sort().join(',')===
      'active,authVersion,firebaseUid,revokeAfterSeconds' &&
    desired.active===false &&
    UID.test(desired.firebaseUid) &&
    Number.isSafeInteger(desired.authVersion) &&
    desired.authVersion>=2 &&
    Number.isSafeInteger(desired.revokeAfterSeconds) &&
    desired.revokeAfterSeconds>=0;
}
export function createPilotRevocationCoordinator(db,firestoreWriter,authRevoker) {
  if(!db?.prepare ||
     typeof firestoreWriter?.applyRevokedState!=='function' ||
     typeof authRevoker?.disableAndRevoke!=='function')
    throw new Error('TRUSTED_REVOCATION_COMPONENTS_REQUIRED');

  async function assertStillBlocked(desired) {
    const current=await db.prepare(
      'SELECT active,auth_version,tokens_valid_after '+
      'FROM student_auth_identities WHERE firebase_uid=?'
    ).bind(desired.firebaseUid).first();
    if(!current || current.active!==0 ||
       current.auth_version!==desired.authVersion ||
       !Number.isSafeInteger(current.tokens_valid_after) ||
       current.tokens_valid_after<desired.revokeAfterSeconds)
      throw new Error('REVOCATION_NO_LONGER_CURRENT');
  }

  return {
    async applyRevokedState(desired) {
      if(!correctShape(desired))throw new Error('INVALID_REVOCATION');
      await assertStillBlocked(desired);
      // Firestore Rules should reject old ID tokens as soon as its
      // server-written state turns inactive.
      const committed=await firestoreWriter.applyRevokedState(desired);
      if(!committed || committed.active!==false ||
         !Number.isSafeInteger(committed.authVersion) ||
         committed.authVersion<desired.authVersion ||
         !Number.isSafeInteger(committed.revokeAfterSeconds) ||
         committed.revokeAfterSeconds<desired.revokeAfterSeconds)
        throw new Error('FIRESTORE_NOT_CONFIRMED');
      // An Admin action might have changed the registry while Firestore
      // wrote. Never knowingly disable a newer reactivated Auth account.
      await assertStillBlocked(desired);
      const disabled=await authRevoker.disableAndRevoke({
        firebaseUid:desired.firebaseUid,
        authVersion:desired.authVersion,
        revokeAfterSeconds:desired.revokeAfterSeconds,
      });
      if(disabled?.firebaseUid!==desired.firebaseUid ||
         disabled.disabled!==true ||
         !Number.isSafeInteger(disabled.validSince) ||
         disabled.validSince<desired.revokeAfterSeconds)
        throw new Error('FIREBASE_AUTH_NOT_CONFIRMED');
      // Return only Firestore commit state to the D1 outbox's existing
      // validity check. This is proof that BOTH stages succeeded.
      return committed;
    },
  };
}

export async function runTrustedPilotRevocationCycle(env, options={}) {
  requireStaging(env);
  if(env.PHASE3_TRUSTED_REVOCATION_DRAIN_ENABLED!=='true' ||
     env.PHASE3_TRUSTED_FIRESTORE_WRITER_ENABLED!=='true' ||
     env.PHASE3_TRUSTED_FIREBASE_AUTH_REVOKER_ENABLED!=='true')
    throw new Error('PILOT_REVOCATION_DRAIN_DISABLED');
  // The only configuration from the service is limit. There is NO HTTP
  // handler, no schedule, and no client request interface to invoke this.
  const db=env.AUTH_DB;
  const firestoreWriter=createPilotFirestoreRevocationWriter(env);
  const authRevoker=createPilotFirebaseAuthRevoker(env);
  const coordinator=createPilotRevocationCoordinator(
    db,firestoreWriter,authRevoker,
  );
  const limit=options.limit ?? 5;
  if(!Number.isSafeInteger(limit)||limit<1||limit>10)
    throw new Error('INVALID_DRAIN_LIMIT');
  return deliverPilotSessionRevocations(db,coordinator,{limit});
}
