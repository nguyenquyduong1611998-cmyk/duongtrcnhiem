// Phase 3E: synthetic-only integration proof. No network, Firebase connection
// or Cloudflare D1 deployment. Runs on Bun's in-memory SQLite.
import assert from 'node:assert/strict';
import {Database} from 'bun:sqlite';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {ADMIN_UID} from '../functions/_shared/auth.mjs';
import {blockStudentServerAccess} from '../functions/api/auth/admin/session-block.js';
import {deliverPilotSessionRevocations} from '../functions/_shared/session-mirror-outbox.mjs';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const sqlite=new Database(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON');
for(const file of [
  'serverless/d1-phase3-session-registry.sql',
  'serverless/d1-phase3-session-audit.sql',
  'serverless/d1-phase3-session-mirror-outbox.sql',
]) sqlite.exec(readFileSync(file,'utf8'));
const run=(sql,args=[])=>sqlite.query(sql).run(...args);
const get=(sql,args=[])=>sqlite.query(sql).get(...args);
const db={
  prepare(sql) {
    return {bind(...args){
      return {
        async first(){return get(sql,args)||null;},
        async all(){return {results:sqlite.query(sql).all(...args)};},
        async run(){return {success:true,meta:{changes:run(sql,args).changes}};},
      };
    }};
  },
  async batch(statements){
    const tx=sqlite.transaction(items=>items.map(stmt=>stmt));
    // D1 batch executes the prepared statements atomically. The real D1
    // wrapper above hides SQL, so use a test-specific extraction below.
    return tx(statements);
  },
};
// batch needs the SQL and bind args for SQLite's transaction.
db.prepare=(sql)=>({bind(...args){
  return {
    sql,args,
    async first(){return get(sql,args)||null;},
    async all(){return {results:sqlite.query(sql).all(...args)};},
    async run(){return {success:true,meta:{changes:run(sql,args).changes}};},
  };
}});
db.batch=async statements=>sqlite.transaction(
  items=>items.map(({sql,args})=>({
    success:true,meta:{changes:run(sql,args).changes},
  }))
)(statements);

const now=Math.floor(Date.now()/1000);
const uidA='student_'+'a'.repeat(32);
const uidB='student_'+'b'.repeat(32);
const uidC='student_'+'c'.repeat(32);
for(const [uid,version] of [[uidA,2],[uidB,3],[uidC,4]]) {
  run(
    'INSERT INTO student_auth_identities (firebase_uid,active,' +
    'password_reset_required,auth_version,tokens_valid_after,created_at,updated_at) ' +
    'VALUES (?,1,0,?,0,?,?)',
    [uid,version,now-300,now-300],
  );
}
const fakeFirestore=new Map();
const writer={
  attempts:0, fail:false, badReceipt:false,
  async applyRevokedState(desired) {
    this.attempts++;
    assert.deepEqual(Object.keys(desired).sort(),
      ['active','authVersion','firebaseUid','revokeAfterSeconds']);
    assert.equal(desired.active,false);
    if(this.fail) throw new Error('SIMULATED_UNAVAILABLE');
    if(this.badReceipt) return {active:true,authVersion:desired.authVersion};
    const prior=fakeFirestore.get(desired.firebaseUid);
    // Simulate mandatory monotonic server-side Firestore transaction.
    if(!prior || prior.authVersion<desired.authVersion ||
      (prior.authVersion===desired.authVersion &&
        prior.revokeAfterSeconds<=desired.revokeAfterSeconds)) {
      fakeFirestore.set(desired.firebaseUid,{...desired});
    }
    return fakeFirestore.get(desired.firebaseUid);
  },
};
const outbox=(uid)=>get(
  'SELECT event_id,state,attempts,next_attempt_at,lease_owner,lease_until,' +
  'auth_version,revoke_after_seconds,delivered_at ' +
  'FROM student_auth_mirror_outbox WHERE firebase_uid=?',[uid],
);
const count=table=>get('SELECT count(*) AS n FROM '+table).n;
const block=async uid=>{
  const response=await blockStudentServerAccess(db,{firebaseUid:uid},ADMIN_UID);
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.firestoreAccessConfirmedBlocked,false);
  assert.equal(body.mirrorStatus,'pending');
  return body;
};
const opts=(second=now,owner='00000000-0000-4000-8000-000000000001')=>({
  now:second,limit:25,leaseOwner:owner,
});

assert.deepEqual(await block(uidA),{
  blocked:true,alreadyBlocked:false,mode:'server-access-only',
  mirrorStatus:'pending',firestoreAccessConfirmedBlocked:false,
});
assert.equal(count('student_auth_block_audit'),1);
assert.equal(count('student_auth_mirror_outbox'),1);
assert.equal(outbox(uidA).state,'pending');
assert.equal(fakeFirestore.has(uidA),false);

// The D1 block succeeds even when Firestore publisher is unreachable.
// No "delivered" acknowledgment is made on failure.
writer.fail=true;
const failed=await deliverPilotSessionRevocations(db,writer,opts());
assert.deepEqual(failed,{
  claimed:1,delivered:0,retryScheduled:1,skipped:0,
});
assert.equal(outbox(uidA).state,'pending');
assert.equal(outbox(uidA).attempts,1);
assert.equal(outbox(uidA).next_attempt_at,now+10);
assert.equal(fakeFirestore.has(uidA),false);
assert.deepEqual(await deliverPilotSessionRevocations(db,writer,opts(now+9)),{
  claimed:0,delivered:0,retryScheduled:0,skipped:0,
});
writer.fail=false;
assert.deepEqual(await deliverPilotSessionRevocations(db,writer,opts(now+10)),{
  claimed:1,delivered:1,retryScheduled:0,skipped:0,
});
assert.equal(outbox(uidA).state,'delivered');
assert.equal(outbox(uidA).attempts,2);
assert.ok(outbox(uidA).delivered_at>0);
assert.equal(fakeFirestore.get(uidA).active,false);
assert.equal(fakeFirestore.get(uidA).authVersion,3);
assert.ok(fakeFirestore.get(uidA).revokeAfterSeconds>=now);
assert.deepEqual(await deliverPilotSessionRevocations(db,writer,opts(now+11)),{
  claimed:0,delivered:0,retryScheduled:0,skipped:0,
});
// No extra events on a repeated Admin block.
const repeated=await blockStudentServerAccess(db,{firebaseUid:uidA},ADMIN_UID);
assert.equal((await repeated.json()).alreadyBlocked,true);
assert.equal(count('student_auth_mirror_outbox'),1);

// A malformed/nonmonotonic delivery receipt must never mark the event done.
await block(uidB);
writer.badReceipt=true;
const invalid=await deliverPilotSessionRevocations(db,writer,opts(now+20));
assert.equal(invalid.delivered,0);
assert.equal(invalid.retryScheduled,1);
assert.equal(outbox(uidB).state,'pending');
writer.badReceipt=false;
assert.equal((await deliverPilotSessionRevocations(db,writer,opts(now+30))).delivered,1);
assert.equal(fakeFirestore.get(uidB).authVersion,4);

// Crash recovery: an abandoned lease becomes available after 60 seconds.
await block(uidC);
run(
  "UPDATE student_auth_mirror_outbox SET state='processing',attempts=1," +
  'lease_owner=?,lease_until=?,updated_at=? WHERE firebase_uid=?',
  ['00000000-0000-4000-8000-000000000002',now+45,now,uidC],
);
assert.equal((await deliverPilotSessionRevocations(db,writer,opts(now+44))).claimed,0);
const recovered=await deliverPilotSessionRevocations(db,writer,opts(now+46));
assert.equal(recovered.claimed,1);
assert.equal(recovered.delivered,1);
assert.equal(outbox(uidC).attempts,2);
assert.equal(outbox(uidC).state,'delivered');

// A second worker cannot claim the same event while the first lease is held.
const uidD='student_'+'d'.repeat(32);
run(
  'INSERT INTO student_auth_identities (firebase_uid,active,' +
  'password_reset_required,auth_version,tokens_valid_after,created_at,updated_at) ' +
  'VALUES (?,1,0,1,0,?,?)',
  [uidD,now-300,now-300],
);
await block(uidD);
const parallelWriter={
  async applyRevokedState(desired){
    const competing=await deliverPilotSessionRevocations(db,writer,
      opts(now+50,'00000000-0000-4000-8000-000000000004'));
    assert.equal(competing.claimed,0);
    return writer.applyRevokedState(desired);
  },
};
assert.equal((await deliverPilotSessionRevocations(db,parallelWriter,
  opts(now+50,'00000000-0000-4000-8000-000000000003'))).delivered,1);
assert.equal(count('student_auth_mirror_outbox'),4);

// When a newer disabled version is already present, an older event must never
// overwrite it. The fake writer implements this as a monotonic transaction.
const uidE='student_'+'e'.repeat(32);
run(
  'INSERT INTO student_auth_identities (firebase_uid,active,' +
  'password_reset_required,auth_version,tokens_valid_after,created_at,updated_at) ' +
  'VALUES (?,1,0,1,0,?,?)',
  [uidE,now-300,now-300],
);
await block(uidE);
fakeFirestore.set(uidE,{
  firebaseUid:uidE,active:false,authVersion:8,revokeAfterSeconds:now+100,
});
assert.equal((await deliverPilotSessionRevocations(db,writer,opts(now+60))).delivered,1);
assert.equal(fakeFirestore.get(uidE).authVersion,8);
assert.equal(fakeFirestore.get(uidE).revokeAfterSeconds,now+100);

// Neither invalid dependencies nor an untrusted owner can drive the consumer.
await assert.rejects(
  deliverPilotSessionRevocations(db,{},opts(now+61)),/TRUSTED_DEPENDENCIES_REQUIRED/
);
await assert.rejects(
  deliverPilotSessionRevocations(db,writer,{...opts(now+61),limit:1000}),
  /INVALID_DRAIN_OPTIONS/
);

assert.equal(count('student_auth_block_audit'),5);
assert.equal(count('student_auth_mirror_outbox'),5);
sqlite.close();
console.log('Phase 3 D1 mirror outbox: atomic commit, retries, lease recovery, idempotence and concurrency passed.');
