import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  createPilotRevocationCoordinator,runTrustedPilotRevocationCycle,
} from '../functions/_shared/pilot-revocation-coordinator.mjs';
import {PROJECT_ID} from '../functions/_shared/auth.mjs';

const uid='student_'+'a'.repeat(32);
const desired={
  firebaseUid:uid,active:false,authVersion:5,revokeAfterSeconds:1800000000,
};
const make=()=>{
  const record={
    active:0,auth_version:5,tokens_valid_after:1800000000,
  };
  const history=[];
  const db={
    record,history,
    prepare(sql) {
      assert.match(sql,/FROM student_auth_identities WHERE firebase_uid=\?/);
      return {
        bind(value) {
          assert.equal(value,uid);
          return {async first() {
            history.push('D1');
            return {...record};
          }};
        },
      };
    },
  };
  let firestoreFailed=false,authFailed=false;
  const firestore={
    async applyRevokedState(v) {
      history.push('Firestore');
      assert.deepEqual(v,desired);
      if(firestoreFailed)throw new Error('SIMULATED_FIRESTORE_DOWN');
      return {
        active:false,authVersion:5,revokeAfterSeconds:1800000000,
      };
    },
  };
  const auth={
    async disableAndRevoke(v) {
      history.push('Auth');
      assert.deepEqual(v,{
        firebaseUid:uid,authVersion:5,revokeAfterSeconds:1800000000,
      });
      if(authFailed)throw new Error('SIMULATED_AUTH_DOWN');
      return {firebaseUid:uid,disabled:true,validSince:1800000001};
    },
  };
  return {
    db,history,firestore,auth,
    setFirestoreFailed(v){firestoreFailed=v;},
    setAuthFailed(v){authFailed=v;},
  };
};

test('invalid account and dependency shapes fail before any side effects',async()=>{
  const s=make(),runner=createPilotRevocationCoordinator(s.db,s.firestore,s.auth);
  for(const v of [
    null,{...desired,active:true},
    {...desired,firebaseUid:'admin'},
    {...desired,authVersion:'5'},
    {...desired,newRole:'admin'},
    {...desired,revokeAfterSeconds:-1},
  ]) await assert.rejects(runner.applyRevokedState(v),/INVALID_REVOCATION/);
  assert.deepEqual(s.history,[]);
  assert.throws(
    ()=>createPilotRevocationCoordinator({},s.firestore,s.auth),
    /TRUSTED_REVOCATION_COMPONENTS_REQUIRED/
  );
});

test('completes Firestore, rechecks D1, then disables Auth before acknowledging',async()=>{
  const s=make(),runner=createPilotRevocationCoordinator(s.db,s.firestore,s.auth);
  assert.deepEqual(await runner.applyRevokedState(desired),{
    active:false,authVersion:5,revokeAfterSeconds:1800000000,
  });
  assert.deepEqual(s.history,['D1','Firestore','D1','Auth']);
});

test('refuses to contact Firebase when D1 row was enabled or version advanced',async()=>{
  for(const row of [
    {active:1},
    {auth_version:6},
    {tokens_valid_after:1800000000-1},
  ]) {
    const s=make();
    Object.assign(s.db.record,row);
    const runner=createPilotRevocationCoordinator(s.db,s.firestore,s.auth);
    await assert.rejects(runner.applyRevokedState(desired),
      /REVOCATION_NO_LONGER_CURRENT/);
    assert.deepEqual(s.history,['D1']);
  }
});

test('D1 change during Firestore write prevents dangerous late Auth disable',async()=>{
  const s=make();
  s.firestore.applyRevokedState=async()=>{
    s.history.push('Firestore');
    s.db.record.active=1;
    s.db.record.auth_version=6;
    return {active:false,authVersion:5,revokeAfterSeconds:1800000000};
  };
  const runner=createPilotRevocationCoordinator(s.db,s.firestore,s.auth);
  await assert.rejects(runner.applyRevokedState(desired),
    /REVOCATION_NO_LONGER_CURRENT/);
  assert.deepEqual(s.history,['D1','Firestore','D1']);
});

test('Firestore outage, Auth outage or false success cannot mark delivery',async()=>{
  const s=make(),runner=createPilotRevocationCoordinator(s.db,s.firestore,s.auth);
  s.setFirestoreFailed(true);
  await assert.rejects(runner.applyRevokedState(desired),
    /SIMULATED_FIRESTORE_DOWN/);
  assert.deepEqual(s.history,['D1','Firestore']);

  s.setFirestoreFailed(false);
  s.history.length=0;
  s.setAuthFailed(true);
  await assert.rejects(runner.applyRevokedState(desired),
    /SIMULATED_AUTH_DOWN/);
  assert.deepEqual(s.history,['D1','Firestore','D1','Auth']);

  s.setAuthFailed(false);
  s.history.length=0;
  s.auth.disableAndRevoke=async()=>{
    s.history.push('Auth');
    return {firebaseUid:uid,disabled:false,validSince:1800000000};
  };
  await assert.rejects(runner.applyRevokedState(desired),
    /FIREBASE_AUTH_NOT_CONFIRMED/);
  assert.deepEqual(s.history,['D1','Firestore','D1','Auth']);
});

test('pilot coordinator stays disconnected from public endpoints and workers',()=>{
  const source=readFileSync(new URL(
    '../functions/_shared/pilot-revocation-coordinator.mjs',import.meta.url),
    'utf8');
  const route=readFileSync(new URL(
    '../functions/api/auth/admin/session-block.js',import.meta.url),'utf8');
  assert.match(source,/PHASE3_TRUSTED_REVOCATION_DRAIN_ENABLED/);
  assert.match(source,/PHASE3_TRUSTED_FIRESTORE_WRITER_ENABLED/);
  assert.match(source,/PHASE3_TRUSTED_FIREBASE_AUTH_REVOKER_ENABLED/);
  assert.doesNotMatch(route,/runTrustedPilotRevocationCycle/);
  assert.doesNotMatch(source,/export async function onRequest/);
  assert.doesNotMatch(source,/scheduled\s*\(/);
});

test('run wrapper refuses absent staging/drain flags before any network',async()=>{
  const env={
    STAGING_AUTH_ENABLED:'true',
    FIREBASE_PROJECT_ID:PROJECT_ID,
    AUTH_DB:{},
    FIREBASE_SERVICE_ACCOUNT_EMAIL:'synthetic@example.invalid',
    FIREBASE_PRIVATE_KEY:'not-real',
  };
  await assert.rejects(
    runTrustedPilotRevocationCycle(env),
    /PILOT_REVOCATION_DRAIN_DISABLED/
  );
});
