import {ADMIN_UID} from './auth.mjs';

// Phase 3M: OFFLINE-ONLY, synthetic blocked-state preparation.
// This function is not attached to a route, worker, cron or user interface.
// It cannot re-enable D1/Firebase Auth/Firestore or mint any token.
// Changes advance the D1 authentication version, force a future password
// reset, and move the revocation cutoff forward while keeping active=0.
//
// D1 batch is atomic. The prepare marker ties journal insertion to the
// exact conditional UPDATE; a stale/racing review cannot create a journal.
const REVIEW=/^unlock_[a-f0-9]{32}$/;
const MAX_REVIEW_AGE_SECONDS=900;

export async function preparePilotUnlockBlockedState(
  db,reviewId,operatorUid,options={}
) {
  if(!db?.prepare || typeof db.batch!=='function')
    throw new Error('UNLOCK_PREPARATION_DB_REQUIRED');
  if(!REVIEW.test(reviewId||'') || operatorUid!==ADMIN_UID)
    throw new Error('UNAUTHORIZED_UNLOCK_PREPARATION');

  const now=options.now??Math.floor(Date.now()/1000);
  if(!Number.isSafeInteger(now)||now<=MAX_REVIEW_AGE_SECONDS)
    throw new Error('INVALID_PREPARATION_CLOCK');
  const prepareId='prepare_'+crypto.randomUUID().replaceAll('-','');

  const updated=db.prepare(
    'UPDATE student_auth_identities SET '+
    'auth_version=auth_version+1,active=0,password_reset_required=1,'+
    'tokens_valid_after=MAX(tokens_valid_after,?),'+
    'last_unlock_prepare_id=?,updated_at=MAX(updated_at,?) '+
    'WHERE active=0 AND password_reset_required=0 '+
    'AND last_unlock_prepare_id IS NULL '+
    'AND auth_version BETWEEN 2 AND 2147483646 '+
    'AND EXISTS (SELECT 1 FROM student_pilot_unlock_reviews r '+
    'JOIN student_pilot_review_admins reviewer '+
    'ON reviewer.firebase_uid=r.approved_by '+
    "AND reviewer.role='unlock_reviewer' AND reviewer.active=1 "+
    'WHERE r.review_id=? AND r.status=? '+
    'AND r.requested_by=? AND r.approved_by<>r.requested_by '+
    'AND r.firebase_uid=student_auth_identities.firebase_uid '+
    'AND r.blocked_auth_version=student_auth_identities.auth_version '+
    'AND r.block_event_id=student_auth_identities.last_block_event_id '+
    'AND reviewer.tokens_valid_after<r.updated_at '+
    'AND r.updated_at BETWEEN ? AND ? '+
    'AND EXISTS (SELECT 1 FROM student_auth_mirror_outbox o '+
    'WHERE o.event_id=r.block_event_id '+
    "AND o.state='delivered' AND o.auth_version=r.blocked_auth_version) "+
    'AND NOT EXISTS (SELECT 1 FROM student_auth_mirror_outbox pending '+
    'WHERE pending.firebase_uid=r.firebase_uid '+
    "AND pending.state<>'delivered') "+
    'AND NOT EXISTS (SELECT 1 FROM student_pilot_unlock_preparations p '+
    "WHERE p.firebase_uid=r.firebase_uid AND p.status='prepared'))"
  ).bind(now,prepareId,now,reviewId,'approved',operatorUid,
    now-MAX_REVIEW_AGE_SECONDS,now);

  const journal=db.prepare(
    'INSERT INTO student_pilot_unlock_preparations '+
    '(prepare_id,review_id,firebase_uid,prior_auth_version,'+
    'new_auth_version,token_cutoff,status,created_at,updated_at) '+
    'SELECT ?,r.review_id,e.firebase_uid,r.blocked_auth_version,'+
    "e.auth_version,e.tokens_valid_after,'prepared',?,? "+
    'FROM student_pilot_unlock_reviews r '+
    'JOIN student_auth_identities e ON e.firebase_uid=r.firebase_uid '+
    'WHERE r.review_id=? AND r.status=? '+
    'AND e.active=0 AND e.password_reset_required=1 '+
    'AND e.last_unlock_prepare_id=? '+
    'AND e.auth_version=r.blocked_auth_version+1 '+
    'AND e.tokens_valid_after>=?'
  ).bind(prepareId,now,now,reviewId,'approved',prepareId,now);

  // The second statement must observe the CAS marker from the first.
  // Failure of either SQL statement throws and rolls back the D1 batch.
  const outcome=await db.batch([updated,journal]);
  if(!Array.isArray(outcome)||outcome.length!==2 ||
     outcome.some(r=>r?.success!==true))
    throw new Error('UNLOCK_PREPARATION_TRANSACTION_FAILED');
  const changes=outcome.map(r=>r.meta?.changes);
  if(changes[0]===0 && changes[1]===0)
    return {
      prepared:false,accountStillDisabled:true,canEnableNow:false,
      reason:'REVIEW_STALE_OR_NOT_APPROVED',
    };
  if(changes[0]!==1 || changes[1]!==1)
    throw new Error('UNLOCK_PREPARATION_RECONCILIATION_REQUIRED');
  return {
    prepared:true,prepareId,accountStillDisabled:true,
    passwordResetRequired:true,canEnableNow:false,
    mode:'blocked-preparation-only',
  };
}
