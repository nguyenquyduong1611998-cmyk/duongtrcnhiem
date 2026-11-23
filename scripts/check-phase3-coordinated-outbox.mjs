// Phase 3H: D1 outbox + Firestore + Firebase Auth orchestration, simulated
// end to end. Bun SQLite is in-memory; adapters do not contact Google.
import assert from 'node:assert/strict';
import {Database} from 'bun:sqlite';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {ADMIN_UID} from '../functions/_shared/auth.mjs';
import {blockStudentServerAccess}
  from '../functions/api/auth/admin/session-block.js';
import {createPilotRevocationCoordinator}
  from '../functions/_shared/pilot-revocation-coordinator.mjs';
import {deliverPilotSessionRevocations}
  from '../functions/_shared/session-mirror-outbox.mjs';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const now=Math.floor(Date.now()/1000);
const sqlite=new Database(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON');
for(const file of [
  'serverless/d1-phase3-session-registry.sql',
  'serverless/d1-phase3-session-audit.sql',
  'serverless/d1-phase3-session-mirror-outbox.sql',
]) sqlite.exec(readFileSync(file,'utf8'));
const row=(sql,args=[])=>sqlite.query(sql).get(...args);
const execute=(sql,args=[])=>sqlite.query(sql).run(...args);
const db={
  prepare(sql){
    return {bind(...args){
      return {
        sql,args,
        async first(){return row(sql,args)||null;},
        async all(){return {results:sqlite.query(sql).all(...args)};},
        async run(){return {success:true,meta:{changes:execute(sql,args).changes}};},
      };
    }};
  },
  async batch(statements){
    return sqlite.transaction(items=>items.map(({sql,args})=>({
      success:true,meta:{changes:execute(sql,args).changes},
    })))(statements);
  },
};
const uidA='student_'+'a'.repeat(32);
const uidB='student_'+'b'.repeat(32);
const uidC='student_'+'c'.repeat(32);
for(const uid of [uidA,uidB,uidC]){
  execute(
    'INSERT INTO student_auth_identities '+
    '(firebase_uid,auth_version,active,password_reset_required,'+
    'tokens_valid_after,created_at,updated_at) '+
    'VALUES (?,2,1,0,0,?,?)',[uid,now-1000,now-1000],
  );
}

const mirror=new Map(),auth=new Map();
let failAuth=true,firestoreCalls=0,authCalls=0;
const firestore={
  async applyRevokedState(v){
    firestoreCalls++;
    const existing=mirror.get(v.firebaseUid);
    const next={
      active:false,
      authVersion:Math.max(existing?.authVersion||0,v.authVersion),
      revokeAfterSeconds:Math.max(
        existing?.revokeAfterSeconds||0,v.revokeAfterSeconds,
      ),
    };
    mirror.set(v.firebaseUid,next);
    return next;
  },
};
const revoker={
  async disableAndRevoke(v){
    authCalls++;
    if(failAuth)throw new Error('AUTH_BACKEND_TEMPORARILY_UNAVAILABLE');
    const existing=auth.get(v.firebaseUid);
    const next={
      firebaseUid:v.firebaseUid,disabled:true,
      validSince:Math.max(existing?.validSince||0,
        v.revokeAfterSeconds,now),
    };
    auth.set(v.firebaseUid,next);
    return next;
  },
};
const coordinator=createPilotRevocationCoordinator(db,firestore,revoker);
const drain=(t=now)=>deliverPilotSessionRevocations(db,coordinator,{
  now:t,limit:5,leaseOwner:'00000000-0000-4000-8000-0000000000aa',
});
const item=uid=>row(
  'SELECT state,attempts,auth_version FROM student_auth_mirror_outbox '+
  'WHERE firebase_uid=?',[uid],
);

// Student A: outbox remains pending after successful Firestore write but
// Firebase Auth failure. No false success receipt.
const start=await blockStudentServerAccess(db,{firebaseUid:uidA},ADMIN_UID);
assert.equal(start.status,200);
assert.equal((await start.json()).firestoreAccessConfirmedBlocked,false);
assert.equal(item(uidA).state,'pending');
const failed=await drain();
assert.equal(failed.claimed,1);
assert.equal(failed.delivered,0);
assert.equal(failed.retryScheduled,1);
assert.equal(item(uidA).state,'pending');
assert.equal(mirror.get(uidA).active,false);
assert.equal(auth.has(uidA),false);
assert.equal(firestoreCalls,1);
assert.equal(authCalls,1);

// Recovery: both stages confirmed, no new Firebase Auth credentials.
failAuth=false;
const recovered=await drain(now+10);
assert.equal(recovered.delivered,1);
assert.equal(item(uidA).state,'delivered');
assert.equal(item(uidA).attempts,2);
assert.equal(auth.get(uidA).disabled,true);
assert.ok(auth.get(uidA).validSince>=now);
const before=authCalls;
assert.equal((await drain(now+20)).claimed,0);
assert.equal(authCalls,before);

// The D1 optimistic state guard must block an obsolete event if a hypothetical
// future "unlock" advances version while an old event is waiting. This does
// NOT implement a live unlock endpoint.
await blockStudentServerAccess(db,{firebaseUid:uidB},ADMIN_UID);
execute(
  'UPDATE student_auth_identities SET active=1,auth_version=auth_version+1 '+
  'WHERE firebase_uid=?',[uidB],
);
const blockedBefore=authCalls;
const stale=await drain(now+30);
assert.equal(stale.claimed,1);
assert.equal(stale.delivered,0);
assert.equal(stale.retryScheduled,1);
assert.equal(authCalls,blockedBefore);
assert.equal(mirror.has(uidB),false);
assert.equal(item(uidB).state,'pending');

// Do not let a re-enabled account be touched by an old task even if the
// outbox lease expires and it is retried repeatedly.
const again=await drain(now+50);
assert.equal(again.delivered,0);
assert.equal(authCalls,blockedBefore);

// A missing Auth user or inconsistent receipt must also prevent delivery.
await blockStudentServerAccess(db,{firebaseUid:uidC},ADMIN_UID);
revoker.disableAndRevoke=async()=>{
  authCalls++;
  return {firebaseUid:uidC,disabled:false,validSince:now};
};
const wrongReceipt=await drain(now+60);
assert.equal(wrongReceipt.delivered,0);
assert.ok(wrongReceipt.retryScheduled>=1);
assert.equal(item(uidC).state,'pending');
assert.ok(mirror.get(uidC));
assert.equal(auth.has(uidC),false);
sqlite.close();
console.log('Phase 3 coordinated revocation: D1/Firestore/Auth failure, retry and stale-event guards passed.');
