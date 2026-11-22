// Synthetic, end-to-end emulator proof of the D1 -> Firestore outbox boundary.
// Uses Node's in-memory SQLite and the Firestore Emulator ONLY.
// No production keys, Cloudflare writes, real accounts, grades or deploys.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds}
  from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,runTransaction}
  from 'firebase/firestore';
import {ADMIN_UID} from '../functions/_shared/auth.mjs';
import {blockStudentServerAccess}
  from '../functions/api/auth/admin/session-block.js';
import {deliverPilotSessionRevocations}
  from '../functions/_shared/session-mirror-outbox.mjs';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const uid='student_'+'f'.repeat(32);
const uidB='student_'+'e'.repeat(32);
const now=Math.floor(Date.now()/1000);
const rules=readFileSync('firestore.phase3.pilot.rules','utf8');
const claim={
  firebase:{sign_in_provider:'custom'},
  unitStudent:true,unitAuthVersion:4,auth_time:now-100,
};
const validRecord=student=>({
  ownerUid:student,marker:'SYNTHETIC_ONLY',
  resultType:'PHASE3_REVOKE_PROBE',score:7,
});

test('D1 event is durable; trusted Firestore emulator writer closes the direct-read gap',async()=>{
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for(const path of [
    'serverless/d1-phase3-session-registry.sql',
    'serverless/d1-phase3-session-audit.sql',
    'serverless/d1-phase3-session-mirror-outbox.sql',
  ]) sqlite.exec(readFileSync(path,'utf8'));
  const run=(sql,args)=>sqlite.prepare(sql).run(...args);
  const first=(sql,args)=>sqlite.prepare(sql).get(...args);
  const list=(sql,args)=>sqlite.prepare(sql).all(...args);
  const db={
    prepare(sql) {
      return {bind(...args) {
        return {
          sql,args,
          async first(){return first(sql,args)||null;},
          async all(){return {results:list(sql,args)};},
          async run(){return {
            success:true,meta:{changes:run(sql,args).changes},
          };},
        };
      }};
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE TRANSACTION');
      try {
        const results=statements.map(({sql,args})=>({
          success:true,meta:{changes:run(sql,args).changes},
        }));
        sqlite.exec('COMMIT');
        return results;
      } catch(error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  run(
    'INSERT INTO student_auth_identities ' +
    '(firebase_uid,active,password_reset_required,auth_version,' +
    'tokens_valid_after,created_at,updated_at) ' +
    'VALUES (?,1,0,4,0,?,?)',
    [uid,now-1000,now-1000],
  );
  const env=await initializeTestEnvironment({
    projectId:'demo-phase3-session-guard',
    firestore:{rules,host:'127.0.0.1',port:8089},
  });
  try {
    await env.withSecurityRulesDisabled(async context=>{
      const firestore=context.firestore();
      await setDoc(doc(firestore,'pilot_session_states',uid),{
        active:true,authVersion:4,revokeAfterSeconds:now-200,
      });
      await setDoc(doc(firestore,'pilot_session_states',uidB),{
        active:true,authVersion:4,revokeAfterSeconds:now-200,
      });
    });
    const student=env.authenticatedContext(uid,claim).firestore();
    const other=env.authenticatedContext(uidB,claim).firestore();
    const own=doc(student,'pilot_session_probes',uid);
    const otherDoc=doc(other,'pilot_session_probes',uidB);
    await assertSucceeds(setDoc(own,validRecord(uid)));
    await assertSucceeds(setDoc(otherDoc,validRecord(uidB)));
    await assertSucceeds(getDoc(own));

    const response=await blockStudentServerAccess(db,{firebaseUid:uid},ADMIN_UID);
    assert.equal(response.status,200);
    assert.equal((await response.json()).mirrorStatus,'pending');
    assert.equal(first(
      'SELECT state FROM student_auth_mirror_outbox WHERE firebase_uid=?',[uid],
    ).state,'pending');
    // Important security limitation: D1 block alone DOES NOT close direct
    // Firestore access. This deliberate assertion must not be removed.
    await assertSucceeds(getDoc(own));

    let failOnce=true;
    const trustedWriter={
      async applyRevokedState(desired){
        if(failOnce) {
          failOnce=false;
          throw new Error('SYNTHETIC_NETWORK_OUTAGE');
        }
        // withSecurityRulesDisabled is an Emulator-only trusted server stand-in.
        // Production needs a real Admin SDK/REST service with this same
        // transaction + nondecreasing version/revocation semantics.
        return env.withSecurityRulesDisabled(async ctx=>{
          const serverDb=ctx.firestore();
          const ref=doc(serverDb,'pilot_session_states',desired.firebaseUid);
          return runTransaction(serverDb,async tx=>{
            const snapshot=await tx.get(ref);
            const existing=snapshot.exists()?snapshot.data():null;
            if(existing && (
              existing.authVersion>desired.authVersion ||
              (existing.authVersion===desired.authVersion &&
                existing.revokeAfterSeconds>desired.revokeAfterSeconds)
            )) return existing;
            const next={
              active:false,authVersion:desired.authVersion,
              revokeAfterSeconds:desired.revokeAfterSeconds,
            };
            tx.set(ref,next);
            return next;
          });
        });
      },
    };
    const opts=(n)=>({
      now:n,limit:1,leaseOwner:'00000000-0000-4000-8000-0000000000f1',
    });
    const failed=await deliverPilotSessionRevocations(db,trustedWriter,opts(now));
    assert.equal(failed.retryScheduled,1);
    assert.equal(first('SELECT state FROM student_auth_mirror_outbox WHERE firebase_uid=?',
      [uid]).state,'pending');
    await assertSucceeds(getDoc(own)); // still not synchronized
    const delivered=await deliverPilotSessionRevocations(db,trustedWriter,opts(now+10));
    assert.equal(delivered.delivered,1);
    assert.equal(first('SELECT state FROM student_auth_mirror_outbox WHERE firebase_uid=?',
      [uid]).state,'delivered');

    // Old Firebase token is still cryptographically valid but Firestore Rules
    // now deny direct access because server-authored metadata is disabled.
    await assertFails(getDoc(own));
    await assertSucceeds(getDoc(otherDoc));
    await assertFails(getDoc(doc(other,'pilot_session_probes',uid)));

    const mirrored=await env.withSecurityRulesDisabled(async ctx=>{
      const snapshot=await getDoc(doc(ctx.firestore(),'pilot_session_states',uid));
      return snapshot.data();
    });
    assert.equal(mirrored.active,false);
    assert.equal(mirrored.authVersion,5);
    assert.ok(mirrored.revokeAfterSeconds>=now);
    assert.equal((await deliverPilotSessionRevocations(db,trustedWriter,opts(now+11)))
      .claimed,0);
  } finally {
    await env.cleanup();
    sqlite.close();
  }
});
