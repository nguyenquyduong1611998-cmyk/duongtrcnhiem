// Phase 3J: READ-ONLY preflight for a future, separate manual unlock.
// NO function here enables D1, Firebase Auth or Firestore, issues tokens,
// or authorizes a student to sign in. The return value is NOT a grant.
// A real unlock later requires a transactional state machine, IAM checks,
// dual control, and revalidation after all remote actions.
const UID=/^student_[a-f0-9]{32}$/;
const valid=n=>Number.isSafeInteger(n)&&n>=0;

export async function assessPilotUnlockPreflight(db,readers,uid) {
  if(!db?.prepare ||
     typeof readers?.readFirestoreState!=='function' ||
     typeof readers?.readFirebaseAuthUser!=='function')
    throw new Error('TRUSTED_UNLOCK_READERS_REQUIRED');
  if(typeof uid!=='string'||!UID.test(uid))
    throw new Error('INVALID_STUDENT_ID');

  const state=await db.prepare(
    'SELECT active,password_reset_required,auth_version,'+
    'tokens_valid_after,last_block_event_id '+
    'FROM student_auth_identities WHERE firebase_uid=?'
  ).bind(uid).first();
  if(!state)return {eligibleForManualReview:false,reason:'ACCOUNT_NOT_FOUND'};

  if(state.active!==0 || !valid(state.auth_version) ||
     state.auth_version<2 || !valid(state.tokens_valid_after) ||
     ![0,1].includes(state.password_reset_required) ||
     typeof state.last_block_event_id!=='string' ||
     !/^[a-f0-9-]{36}$/.test(state.last_block_event_id))
    return {eligibleForManualReview:false,reason:'INVALID_D1_BLOCK_STATE'};

  const queue=await db.prepare(
    "SELECT COUNT(*) AS total,"+
    "COALESCE(SUM(CASE WHEN state<>'delivered' THEN 1 ELSE 0 END),0) AS unresolved,"+
    'MAX(auth_version) AS maxVersion '+
    'FROM student_auth_mirror_outbox WHERE firebase_uid=?'
  ).bind(uid).first();
  if(!queue || !valid(queue.total) || !valid(queue.unresolved) ||
     queue.total===0 || queue.unresolved!==0 ||
     !valid(queue.maxVersion) ||
     queue.maxVersion!==state.auth_version)
    return {eligibleForManualReview:false,reason:'REVOCATION_QUEUE_NOT_CLEAR'};

  const latest=await db.prepare(
    'SELECT state,auth_version FROM student_auth_mirror_outbox '+
    'WHERE event_id=? AND firebase_uid=?'
  ).bind(state.last_block_event_id,uid).first();
  if(latest?.state!=='delivered' ||
     latest.auth_version!==state.auth_version)
    return {eligibleForManualReview:false,reason:'LATEST_BLOCK_NOT_CONFIRMED'};

  // Only read from independently trusted server-side readers after D1
  // proves that no prior revocation task remains in flight.
  const firestore=await readers.readFirestoreState(uid);
  if(!firestore || firestore.active!==false ||
     !valid(firestore.authVersion) ||
     firestore.authVersion<state.auth_version ||
     !valid(firestore.revokeAfterSeconds) ||
     firestore.revokeAfterSeconds<state.tokens_valid_after)
    return {eligibleForManualReview:false,reason:'FIRESTORE_BLOCK_NOT_CONFIRMED'};

  const firebase=await readers.readFirebaseAuthUser(uid);
  if(!firebase || firebase.firebaseUid!==uid ||
     firebase.disabled!==true || !valid(firebase.validSince) ||
     firebase.validSince<state.tokens_valid_after)
    return {eligibleForManualReview:false,reason:'FIREBASE_AUTH_BLOCK_NOT_CONFIRMED'};

  return {
    eligibleForManualReview:true,
    canEnableNow:false,
    accountStillDisabled:true,
    requiresNewAuthVersion:true,
    requiresFreshAuthSession:true,
    // This is a read-only snapshot, not a reservation or unlock token.
    mode:'preflight-only',
  };
}
