// Phase 3M - SQLite in-memory only: no Cloudflare/Firebase mutations.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {ADMIN_UID} from '../functions/_shared/auth.mjs';
import {preparePilotUnlockBlockedState}
  from '../functions/_shared/pilot-unlock-preparation.mjs';
import {authorizeStudentIdentity}
  from '../functions/_shared/student-session.mjs';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const uid='student_'+'a'.repeat(32);
const reviewId='unlock_'+'b'.repeat(32);
const eventId='00000000-0000-4000-8000-000000000001';
const reviewer='second_admin_01';
const now=1800000000;
const schemas=[
  'serverless/d1-phase3-session-registry.sql',
  'serverless/d1-phase3-session-audit.sql',
  'serverless/d1-phase3-session-mirror-outbox.sql',
  'serverless/d1-phase3-unlock-review.sql',
  'serverless/d1-phase3-review-admins.sql',
  'serverless/d1-phase3-unlock-preparation.sql',
];

function fixture() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for(const path of schemas)sqlite.exec(readFileSync(path,'utf8'));
  const exec=(sql,...args)=>sqlite.prepare(sql).run(...args);
  const read=(sql,...args)=>sqlite.prepare(sql).get(...args);
  let beforeBatch=null;
  const db={
    prepare(sql) {return {bind(...args) {
      return {
        sql,args,
        async first(){return read(sql,...args)??null;},
        async run(){return {success:true,meta:{changes:exec(sql,...args).changes}};},
      };
    }};},
    async batch(statements) {
      if(beforeBatch) {
        const callback=beforeBatch;beforeBatch=null;callback();
      }
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const out=statements.map(({sql,args})=>({
          success:true,meta:{changes:exec(sql,...args).changes},
        }));
        sqlite.exec('COMMIT');
        return out;
      } catch(error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  exec(
    'INSERT INTO student_auth_identities '+
    '(firebase_uid,auth_version,active,password_reset_required,'+
    'tokens_valid_after,last_block_event_id,created_at,updated_at) '+
    'VALUES (?,3,0,0,?,?,?,?)',
    uid,now-500,eventId,now-1000,now-200,
  );
  exec(
    'INSERT INTO student_auth_block_audit '+
    '(event_id,firebase_uid,actor_uid,action,prior_auth_version,'+
    'new_auth_version,created_at) '+
    "VALUES (?,?,?,'server-access-blocked',2,3,?)",
    eventId,uid,ADMIN_UID,now-200,
  );
  exec(
    'INSERT INTO student_auth_mirror_outbox '+
    '(event_id,firebase_uid,auth_version,revoke_after_seconds,'+
    'state,attempts,next_attempt_at,delivered_at,created_at,updated_at) '+
    "VALUES (?,?,3,?,'delivered',1,0,?,?,?)",
    eventId,uid,now-500,now-150,now-200,now-150,
  );
  exec(
    'INSERT INTO student_pilot_review_admins '+
    '(firebase_uid,active,role,tokens_valid_after,created_at,updated_at) '+
    "VALUES (?,1,'unlock_reviewer',0,?,?)",
    reviewer,now-1000,now-1000,
  );
  exec(
    'INSERT INTO student_pilot_unlock_reviews '+
    '(review_id,firebase_uid,blocked_auth_version,block_event_id,'+
    'requested_by,approved_by,status,requested_at,updated_at) '+
    "VALUES (?,?,3,?,?,?,'approved',?,?)",
    reviewId,uid,eventId,ADMIN_UID,reviewer,now-200,now-20,
  );
  return {
    sqlite,db,exec,read,
    beforeBatch(cb){beforeBatch=cb;},
    state(){return read('SELECT * FROM student_auth_identities WHERE firebase_uid=?',uid);},
    journal(){return read('SELECT * FROM student_pilot_unlock_preparations WHERE firebase_uid=?',uid);},
    count(){return read('SELECT count(*) AS n FROM student_pilot_unlock_preparations').n;},
  };
}
const prepare=f=>preparePilotUnlockBlockedState(
  f.db,reviewId,ADMIN_UID,{now},
);
test('approved two-Admin review prepares ONLY a disabled, fresh-version D1 state',async()=>{
  const f=fixture();
  try {
    const first=await prepare(f);
    assert.equal(first.prepared,true);
    assert.equal(first.canEnableNow,false);
    assert.equal(first.accountStillDisabled,true);
    assert.equal(first.passwordResetRequired,true);
    assert.match(first.prepareId,/^prepare_[a-f0-9]{32}$/);
    const state=f.state(),journal=f.journal();
    assert.equal(state.active,0);
    assert.equal(state.password_reset_required,1);
    assert.equal(state.auth_version,4);
    assert.equal(state.tokens_valid_after,now);
    assert.equal(state.last_unlock_prepare_id,first.prepareId);
    assert.equal(journal.prepare_id,first.prepareId);
    assert.equal(journal.review_id,reviewId);
    assert.equal(journal.prior_auth_version,3);
    assert.equal(journal.new_auth_version,4);
    assert.equal(journal.token_cutoff,now);
    assert.equal(journal.status,'prepared');
    assert.equal(await authorizeStudentIdentity(f.db,{
      firebaseUid:uid,authVersion:3,authTime:now-100,
    }),false);
    assert.equal(await authorizeStudentIdentity(f.db,{
      firebaseUid:uid,authVersion:4,authTime:now+20,
    }),false);
    assert.equal(f.count(),1);
    const replay=await prepare(f);
    assert.equal(replay.prepared,false);
    assert.equal(f.count(),1);
    assert.equal(f.state().auth_version,4);
  } finally{f.sqlite.close();}
});

test('stale, revoked and non-approved reviews cannot prepare an unlock',async()=>{
  const cases=[
    f=>f.exec("UPDATE student_pilot_unlock_reviews SET status='pending',approved_by=NULL WHERE review_id=?",reviewId),
    f=>f.exec('UPDATE student_pilot_review_admins SET active=0 WHERE firebase_uid=?',reviewer),
    f=>f.exec('UPDATE student_pilot_review_admins SET tokens_valid_after=? WHERE firebase_uid=?',now-1,reviewer),
    f=>f.exec('UPDATE student_pilot_unlock_reviews SET requested_at=?,updated_at=? WHERE review_id=?',now-1100,now-1000,reviewId),
    f=>f.exec('UPDATE student_pilot_unlock_reviews SET updated_at=? WHERE review_id=?',now+100,reviewId),
    f=>f.exec('UPDATE student_auth_identities SET auth_version=5 WHERE firebase_uid=?',uid),
    f=>f.exec('UPDATE student_auth_identities SET password_reset_required=1 WHERE firebase_uid=?',uid),
    f=>f.exec('UPDATE student_auth_identities SET last_unlock_prepare_id=? WHERE firebase_uid=?','prepare_'+'e'.repeat(32),uid),
    f=>f.exec("UPDATE student_auth_mirror_outbox SET state='pending',delivered_at=NULL WHERE event_id=?",eventId),
  ];
  for(let i=0;i<cases.length;i++) {
    const f=fixture();
    try {
      cases[i](f);
      const result=await prepare(f);
      assert.equal(result.prepared,false,'scenario '+i);
      assert.equal(result.canEnableNow,false);
      assert.equal(f.count(),0,'no journal for scenario '+i);
      assert.equal(f.state().active,0);
    }finally{f.sqlite.close();}
  }
});

test('a race modifying D1 after review still cannot mint a preparation',async()=>{
  const f=fixture();
  try {
    f.beforeBatch(()=>{
      f.exec('UPDATE student_auth_identities SET auth_version=auth_version+1 WHERE firebase_uid=?',uid);
    });
    const result=await prepare(f);
    assert.equal(result.prepared,false);
    assert.equal(f.count(),0);
    assert.equal(f.state().active,0);
    assert.equal(f.state().auth_version,4);
  }finally{f.sqlite.close();}
});

test('transaction rolls back if journal INSERT fails after CAS state change',async()=>{
  const f=fixture();
  try{
    // A deliberately conflicting preparation ID cannot be generated through
    // the public function; simulate a SQL constraint failure via a trigger.
    f.sqlite.exec(
      "CREATE TRIGGER test_abort_journal BEFORE INSERT ON "+
      "student_pilot_unlock_preparations BEGIN "+
      "SELECT RAISE(ABORT,'SIMULATED_JOURNAL_FAILURE'); END;"
    );
    await assert.rejects(prepare(f),/SIMULATED_JOURNAL_FAILURE/);
    assert.equal(f.state().auth_version,3);
    assert.equal(f.state().password_reset_required,0);
    assert.equal(f.state().last_unlock_prepare_id,null);
    assert.equal(f.count(),0);
  }finally{f.sqlite.close();}
});

test('preparation does not override the phase 3 no-direct-activation triggers',async()=>{
  const f=fixture();
  try {
    await prepare(f);
    assert.throws(()=>f.exec(
      'UPDATE student_auth_identities SET active=1 WHERE firebase_uid=?',uid,
    ),/PILOT_DIRECT_ACTIVATION_FORBIDDEN/);
    assert.equal(f.state().active,0);
    assert.equal(f.journal().status,'prepared');
  }finally{f.sqlite.close();}
});

test('no caller can prepare without a valid fixed Admin and approved review ID',async()=>{
  const f=fixture();
  try {
    await assert.rejects(
      preparePilotUnlockBlockedState(f.db,reviewId,'attacker',{now}),
      /UNAUTHORIZED_UNLOCK_PREPARATION/);
    await assert.rejects(
      preparePilotUnlockBlockedState(f.db,'invalid',ADMIN_UID,{now}),
      /UNAUTHORIZED_UNLOCK_PREPARATION/);
    await assert.rejects(
      preparePilotUnlockBlockedState(f.db,reviewId,ADMIN_UID,{now:0}),
      /INVALID_PREPARATION_CLOCK/);
    assert.equal(f.count(),0);
    assert.equal(f.state().auth_version,3);
  }finally{f.sqlite.close();}
});

test('module contains no live route, Firebase token mint, or account activation',()=>{
  const c=readFileSync(new URL(
    '../functions/_shared/pilot-unlock-preparation.mjs',import.meta.url),
    'utf8');
  assert.doesNotMatch(c,/onRequestPost|mintFirebaseToken|createCustomToken|disableUser:false/);
  assert.match(c,/active=0,password_reset_required=1/);
  assert.match(c,/last_unlock_prepare_id/);
  assert.match(c,/NOT EXISTS \(SELECT 1 FROM student_auth_mirror_outbox pending/);
  assert.match(c,/canEnableNow:false/);
});
