import {ADMIN_UID} from './auth.mjs';
import {assessPilotUnlockPreflight} from './pilot-unlock-preflight.mjs';

// Phase 3K: review workflow only. No HTTP endpoint, no schedule and no
// account activation; in particular it NEVER activates an account, enables Firebase
// Auth, alters Firestore session metadata or issues a token.
// The second-reviewer verifier is a trusted backend dependency, NOT a
// callback supplied by a browser.
const UID=/^student_[a-f0-9]{32}$/;
const REVIEW=/^unlock_[a-f0-9]{32}$/;
const ACTOR=/^[A-Za-z0-9_-]{3,128}$/;
const EVENT=/^[a-f0-9-]{36}$/;

function safeClock(now) {
  if(!Number.isSafeInteger(now) || now<=0)
    throw new Error('INVALID_REVIEW_CLOCK');
}
function validDB(db) {
  if(!db?.prepare)throw new Error('UNLOCK_REVIEW_DB_REQUIRED');
}

export async function requestPilotUnlockReview(
  db,readers,uid,requesterUid,options={}
) {
  validDB(db);
  if(!UID.test(uid||'') || requesterUid!==ADMIN_UID)
    throw new Error('UNAUTHORIZED_UNLOCK_REVIEW_REQUEST');
  const preflight=await assessPilotUnlockPreflight(db,readers,uid);
  if(preflight.eligibleForManualReview!==true ||
     preflight.canEnableNow!==false)
    return {reviewCreated:false,canEnableNow:false,reason:'PREFLIGHT_NOT_CLEAR'};

  const now=options.now??Math.floor(Date.now()/1000);
  safeClock(now);
  const identity=await db.prepare(
    'SELECT active,auth_version,last_block_event_id,'+
    'password_reset_required,tokens_valid_after '+
    'FROM student_auth_identities WHERE firebase_uid=?'
  ).bind(uid).first();
  if(!identity || identity.active!==0 ||
     !Number.isSafeInteger(identity.auth_version) ||
     identity.auth_version<2 ||
     identity.password_reset_required!==0 ||
     !EVENT.test(identity.last_block_event_id||'') ||
     !Number.isSafeInteger(identity.tokens_valid_after) ||
     identity.tokens_valid_after<0)
    return {reviewCreated:false,canEnableNow:false,reason:'D1_CHANGED'};

  const reviewId='unlock_'+crypto.randomUUID().replaceAll('-','');
  const result=await db.prepare(
    'INSERT OR IGNORE INTO student_pilot_unlock_reviews '+
    '(review_id,firebase_uid,blocked_auth_version,block_event_id,'+
    'requested_by,approved_by,status,requested_at,updated_at) '+
    "SELECT ?,e.firebase_uid,e.auth_version,e.last_block_event_id,?,NULL,'pending',?,? "+
    'FROM student_auth_identities e WHERE e.firebase_uid=? '+
    'AND e.active=0 AND e.password_reset_required=0 '+
    'AND e.auth_version=? AND e.last_block_event_id=? '+
    'AND e.tokens_valid_after=? '+
    'AND EXISTS (SELECT 1 FROM student_auth_mirror_outbox o '+
    'WHERE o.event_id=e.last_block_event_id '+
    "AND o.firebase_uid=e.firebase_uid AND o.state='delivered' "+
    'AND o.auth_version=e.auth_version) '+
    'AND NOT EXISTS (SELECT 1 FROM student_auth_mirror_outbox o '+
    "WHERE o.firebase_uid=e.firebase_uid AND o.state<>'delivered') "+
    'AND NOT EXISTS (SELECT 1 FROM student_pilot_unlock_reviews r '+
    "WHERE r.firebase_uid=e.firebase_uid AND r.status IN ('pending','approved'))"
  ).bind(reviewId,requesterUid,now,now,uid,
    identity.auth_version,identity.last_block_event_id,
    identity.tokens_valid_after).run();
  if(result?.success!==true)
    throw new Error('UNLOCK_REVIEW_WRITE_FAILED');
  if(result.meta?.changes!==1)
    return {reviewCreated:false,canEnableNow:false,reason:'D1_CHANGED_OR_OPEN_REVIEW'};
  return {
    reviewCreated:true,reviewId,
    status:'pending',canEnableNow:false,mode:'review-only',
  };
}

// A separate trusted admin-verification facility will be needed BEFORE
// this can be wired to a real Admin action. An approved review is NOT an
// authorization to change D1/Firebase/Firestore account activation.
export async function approvePilotUnlockReview(
  db,reviewId,secondReviewerUid,reviewerVerifier,options={}
) {
  validDB(db);
  if(!REVIEW.test(reviewId||'') ||
     !ACTOR.test(secondReviewerUid||'') ||
     typeof reviewerVerifier?.verifyIndependentAdmin!=='function')
    throw new Error('INVALID_UNLOCK_APPROVAL');
  if(await reviewerVerifier.verifyIndependentAdmin(secondReviewerUid)!==true)
    throw new Error('UNVERIFIED_SECOND_ADMIN');
  const now=options.now??Math.floor(Date.now()/1000);
  safeClock(now);
  const reviewerAuthTime=options.reviewerAuthTime;
  if(!Number.isSafeInteger(reviewerAuthTime) ||
     reviewerAuthTime<=0 || reviewerAuthTime>now ||
     now-reviewerAuthTime>300)
    throw new Error('REVIEWER_RECENT_LOGIN_REQUIRED');

  const outcome=await db.prepare(
    "UPDATE student_pilot_unlock_reviews SET status='approved',"+
    'approved_by=?,updated_at=MAX(updated_at,?) '+
    "WHERE review_id=? AND status='pending' AND requested_by<>? "+
    'AND EXISTS (SELECT 1 FROM student_pilot_review_admins reviewer '+
    "WHERE reviewer.firebase_uid=? AND reviewer.role='unlock_reviewer' "+
    'AND reviewer.active=1 AND reviewer.tokens_valid_after<?) '+
    'AND EXISTS (SELECT 1 FROM student_auth_identities e '+
    'WHERE e.firebase_uid=student_pilot_unlock_reviews.firebase_uid '+
    'AND e.active=0 AND e.password_reset_required=0 '+
    'AND e.auth_version=student_pilot_unlock_reviews.blocked_auth_version '+
    'AND e.last_block_event_id=student_pilot_unlock_reviews.block_event_id '+
    'AND EXISTS (SELECT 1 FROM student_auth_mirror_outbox o '+
    'WHERE o.event_id=e.last_block_event_id '+
    "AND o.state='delivered' AND o.auth_version=e.auth_version) "+
    'AND NOT EXISTS (SELECT 1 FROM student_auth_mirror_outbox o '+
    "WHERE o.firebase_uid=e.firebase_uid AND o.state<>'delivered'))"
  ).bind(secondReviewerUid,now,reviewId,secondReviewerUid,
    secondReviewerUid,reviewerAuthTime).run();
  if(outcome?.success!==true)throw new Error('UNLOCK_APPROVAL_WRITE_FAILED');
  return {
    approvedForManualReview:outcome.meta?.changes===1,
    canEnableNow:false,accountStillDisabled:true,mode:'review-only',
  };
}
