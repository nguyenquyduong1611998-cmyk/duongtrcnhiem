import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {ADMIN_UID} from '../functions/_shared/auth.mjs';
import {
  requestPilotUnlockReview,approvePilotUnlockReview,
} from '../functions/_shared/pilot-unlock-review.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;

const uid='student_'+'a'.repeat(32);
const event='00000000-0000-4000-8000-000000000001';
const now=1800000000;
const independent='second_reviewer';
const schemas=[
  'serverless/d1-phase3-session-registry.sql',
  'serverless/d1-phase3-session-audit.sql',
  'serverless/d1-phase3-session-mirror-outbox.sql',
  'serverless/d1-phase3-unlock-review.sql',
  'serverless/d1-phase3-review-admins.sql',
];
function fixture() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON;');
  for(const path of schemas)sqlite.exec(readFileSync(path,'utf8'));
  const run=(sql,...args)=>sqlite.prepare(sql).run(...args);
  const get=(sql,...args)=>sqlite.prepare(sql).get(...args);
  let beforeInsert=null;
  const db={
    prepare(sql) {
      return {bind(...args) {
        return {
          async first(){return get(sql,...args)??null;},
          async run(){
            if(beforeInsert&&sql.includes('INSERT OR IGNORE INTO student_pilot_unlock_reviews')) {
              const inject=beforeInsert;beforeInsert=null;inject();
            }
            return {success:true,meta:{changes:run(sql,...args).changes}};
          },
        };
      }};
    },
  };
  run(
    'INSERT INTO student_auth_identities (firebase_uid,auth_version,active,'+
    'password_reset_required,tokens_valid_after,last_block_event_id,'+
    'created_at,updated_at) VALUES (?,3,0,0,?,?,?,?)',
    uid,now-50,event,now-1000,now-100,
  );
  run(
    'INSERT INTO student_auth_block_audit (event_id,firebase_uid,actor_uid,'+
    'action,prior_auth_version,new_auth_version,created_at) '+
    "VALUES (?,?,?,'server-access-blocked',2,3,?)",
    event,uid,ADMIN_UID,now-100,
  );
  run(
    'INSERT INTO student_auth_mirror_outbox '+
    '(event_id,firebase_uid,auth_version,revoke_after_seconds,state,'+
    'attempts,next_attempt_at,delivered_at,created_at,updated_at) '+
    "VALUES (?,?,3,?,'delivered',1,0,?,?,?)",
    event,uid,now-50,now-60,now-100,now-60,
  );
  // Independently provisioned synthetic reviewer (never seeded by schema).
  run('INSERT INTO student_pilot_review_admins '+
    '(firebase_uid,role,active,tokens_valid_after,created_at,updated_at) '+
    "VALUES (?,'unlock_reviewer',1,0,?,?)",
    independent,now-1000,now-1000,
  );
  const readers={
    async readFirestoreState(value) {
      assert.equal(value,uid);
      return {
        active:false,authVersion:3,revokeAfterSeconds:now-50,
      };
    },
    async readFirebaseAuthUser(value) {
      assert.equal(value,uid);
      return {firebaseUid:uid,disabled:true,validSince:now};
    },
  };
  let verifierCalls=0;
  const verifier={
    async verifyIndependentAdmin(actor) {
      verifierCalls++;
      return actor===independent;
    },
    get calls(){return verifierCalls;},
  };
  const report=()=>get('SELECT * FROM student_pilot_unlock_reviews');
  return {
    db,readers,verifier,run,get,report,sqlite,
    injectBeforeInsert(cb){beforeInsert=cb;},
  };
}
const request=(f)=>requestPilotUnlockReview(
  f.db,f.readers,uid,ADMIN_UID,{now},
);
const approve=(f,id,actor=independent,verify=f.verifier)=>approvePilotUnlockReview(
  f.db,id,actor,verify,{now:now+20,reviewerAuthTime:now},
);

test('an audited delivered lock can start a review; approval keeps account disabled',async()=>{
  const f=fixture();
  try {
    const first=await request(f);
    assert.equal(first.reviewCreated,true);
    assert.equal(first.canEnableNow,false);
    assert.match(first.reviewId,/^unlock_[a-f0-9]{32}$/);
    assert.equal(f.report().status,'pending');
    assert.equal(f.report().approved_by,null);
    const approved=await approve(f,first.reviewId);
    assert.deepEqual(approved,{
      approvedForManualReview:true,canEnableNow:false,
      accountStillDisabled:true,mode:'review-only',
    });
    assert.equal(f.report().status,'approved');
    assert.equal(f.report().approved_by,independent);
    assert.equal(f.verifier.calls,1);
    assert.equal(f.get('SELECT active FROM student_auth_identities WHERE firebase_uid=?',uid).active,0);
    assert.equal(f.get('SELECT COUNT(*) AS n FROM student_auth_mirror_outbox').n,1);
    assert.equal(f.get('SELECT COUNT(*) AS n FROM student_auth_block_audit').n,1);
    assert.equal((await request(f)).reviewCreated,false);
    assert.equal((await approve(f,first.reviewId)).approvedForManualReview,false);
  } finally {f.sqlite.close();}
});

test('same Admin cannot self-approve, second reviewer must be independently verified',async()=>{
  const f=fixture();
  try {
    const first=await request(f);
    assert.equal(first.reviewCreated,true);
    assert.equal((await approve(f,first.reviewId,ADMIN_UID,{
      async verifyIndependentAdmin(){return true;},
    })).approvedForManualReview,false);
    await assert.rejects(
      approve(f,first.reviewId,'unverified_admin'),/UNVERIFIED_SECOND_ADMIN/
    );
    assert.equal(f.report().status,'pending');
  } finally {f.sqlite.close();}
});

test('no review if pending, missing or unfinished block, or password reset required',async()=>{
  for(const change of [
    f=>f.run("UPDATE student_auth_mirror_outbox SET state='pending',"+
      'delivered_at=NULL WHERE event_id=?',event),
    f=>f.run('UPDATE student_auth_identities SET password_reset_required=1 WHERE firebase_uid=?',uid),
    f=>f.run('UPDATE student_auth_identities SET auth_version=auth_version+1 WHERE firebase_uid=?',uid),
    f=>f.run('UPDATE student_auth_identities SET last_block_event_id=NULL WHERE firebase_uid=?',uid),
  ]) {
    const f=fixture();
    try {
      change(f);
      const result=await request(f);
      assert.equal(result.reviewCreated,false);
      assert.equal(result.canEnableNow,false);
      assert.equal(f.get('SELECT COUNT(*) AS n FROM student_pilot_unlock_reviews').n,0);
    }finally{f.sqlite.close();}
  }
});

test('D1 version changes between external preflight and insert: CAS fails closed',async()=>{
  const f=fixture();
  try {
    f.injectBeforeInsert(()=>{
      f.run('UPDATE student_auth_identities SET auth_version=4 WHERE firebase_uid=?',uid);
    });
    const result=await request(f);
    assert.equal(result.reviewCreated,false);
    assert.equal(result.reason,'D1_CHANGED_OR_OPEN_REVIEW');
    assert.equal(f.get('SELECT COUNT(*) AS n FROM student_pilot_unlock_reviews').n,0);
  } finally {f.sqlite.close();}
});

test('approval denies late revocation, version changes, repeated approvals',async()=>{
  for(const change of [
    f=>f.run('UPDATE student_auth_identities SET auth_version=4 WHERE firebase_uid=?',uid),
    f=>f.run("UPDATE student_auth_mirror_outbox SET state='pending',"+
      'delivered_at=NULL WHERE event_id=?',event),
    f=>f.run('UPDATE student_auth_identities SET password_reset_required=1 WHERE firebase_uid=?',uid),
  ]) {
    const f=fixture();
    try{
      const first=await request(f);
      assert.equal(first.reviewCreated,true);
      change(f);
      assert.equal((await approve(f,first.reviewId)).approvedForManualReview,false);
      assert.equal(f.report().status,'pending');
    } finally{f.sqlite.close();}
  }
});

test('SQL guard makes even manual activation and INSERT active=1 impossible',()=>{
  const f=fixture();
  try {
    assert.throws(()=>f.run(
      'UPDATE student_auth_identities SET active=1 WHERE firebase_uid=?',uid
    ),/PILOT_DIRECT_ACTIVATION_FORBIDDEN/);
    assert.throws(()=>f.run(
      'INSERT INTO student_auth_identities '+
      '(firebase_uid,active,created_at,updated_at) VALUES (?,1,?,?)',
      'student_'+'b'.repeat(32),now-100,now
    ),/PILOT_DIRECT_ACTIVATION_FORBIDDEN/);
    assert.equal(f.get('SELECT active FROM student_auth_identities WHERE firebase_uid=?',uid).active,0);
  }finally{f.sqlite.close();}
});
test('untrusted initiators and review inputs cannot touch D1',async()=>{
  const f=fixture();
  try{
    await assert.rejects(
      requestPilotUnlockReview(f.db,f.readers,uid,'attacker',{now}),
      /UNAUTHORIZED_UNLOCK_REVIEW_REQUEST/
    );
    await assert.rejects(
      requestPilotUnlockReview(f.db,f.readers,'admin',ADMIN_UID,{now}),
      /UNAUTHORIZED_UNLOCK_REVIEW_REQUEST/
    );
    await assert.rejects(
      approve(f,'invalid'),/INVALID_UNLOCK_APPROVAL/
    );
    assert.equal(f.get('SELECT COUNT(*) AS n FROM student_pilot_unlock_reviews').n,0);
  } finally {f.sqlite.close();}
});

test('review code has no account activation, public route or token creation',()=>{
  const code=readFileSync(new URL(
    '../functions/_shared/pilot-unlock-review.mjs',import.meta.url),'utf8');
  assert.match(code,/assessPilotUnlockPreflight/);
  assert.match(code,/verifyIndependentAdmin/);
  assert.match(code,/canEnableNow:false/);
  assert.doesNotMatch(code,/mintFirebaseToken|disableUser:false|onRequestPost|createCustomToken|SET active=1|SET active = 1|SET active=true/);
});
