import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessPilotUnlockPreflight}
  from '../functions/_shared/pilot-unlock-preflight.mjs';

const uid='student_'+'a'.repeat(32);
const eventId='00000000-0000-4000-8000-000000000001';
const start=1800000000;
function fake({
  identity={},queue={},latest={},firestore={},auth={},
}={}) {
  const calls=[];
  const state={
    active:0,password_reset_required:0,auth_version:5,
    tokens_valid_after:start,last_block_event_id:eventId,...identity,
  };
  const q={total:1,unresolved:0,maxVersion:5,...queue};
  const last={state:'delivered',auth_version:5,...latest};
  const fire={
    active:false,authVersion:5,revokeAfterSeconds:start,...firestore,
  };
  const user={
    firebaseUid:uid,disabled:true,validSince:start+3,...auth,
  };
  const db={
    prepare(sql){
      const kind=sql.includes('FROM student_auth_identities')?'identity':
        sql.includes('MAX(auth_version)')?'queue':
        sql.includes('WHERE event_id=?')?'latest':'unknown';
      assert.notEqual(kind,'unknown',sql);
      return {bind(...args){
        calls.push(kind);
        if(kind==='latest')assert.deepEqual(args,[eventId,uid]);
        else assert.deepEqual(args,[uid]);
        return {async first() {
          if(kind==='identity')return state;
          if(kind==='queue')return q;
          if(kind==='latest')return last;
        }};
      }};
    },
  };
  const readers={
    async readFirestoreState(value){
      assert.equal(value,uid);
      calls.push('firestore');
      return fire;
    },
    async readFirebaseAuthUser(value){
      assert.equal(value,uid);
      calls.push('auth');
      return user;
    },
  };
  return {db,readers,calls};
}

test('all three systems blocked and all queue work delivered: manual review only',async()=>{
  const f=fake();
  const report=await assessPilotUnlockPreflight(f.db,f.readers,uid);
  assert.deepEqual(f.calls,[
    'identity','queue','latest','firestore','auth',
  ]);
  assert.deepEqual(report,{
    eligibleForManualReview:true,
    canEnableNow:false,
    accountStillDisabled:true,
    requiresNewAuthVersion:true,
    requiresFreshAuthSession:true,
    mode:'preflight-only',
  });
  assert.equal(JSON.stringify(report).includes(uid),false);
});
test('pending, processing, missing, or stale D1 revocations block preflight early',async()=>{
  for(const overrides of [
    {queue:{total:1,unresolved:1}},
    {queue:{total:0,unresolved:0,maxVersion:null}},
    {queue:{total:1,unresolved:0,maxVersion:4}},
    {identity:{auth_version:6}},
    {identity:{active:1}},
    {identity:{last_block_event_id:null}},
    {identity:{tokens_valid_after:-1}},
    {latest:{state:'pending'}},
    {latest:{auth_version:4}},
  ]) {
    const f=fake(overrides);
    const result=await assessPilotUnlockPreflight(f.db,f.readers,uid);
    assert.equal(result.eligibleForManualReview,false);
    assert.equal(f.calls.includes('firestore'),false);
    assert.equal(f.calls.includes('auth'),false);
  }
});
test('Firestore or Auth still active or stale blocks manual review',async()=>{
  const variants=[
    {firestore:{active:true}},
    {firestore:{authVersion:4}},
    {firestore:{revokeAfterSeconds:start-1}},
    {auth:{disabled:false}},
    {auth:{firebaseUid:'student_'+'b'.repeat(32)}},
    {auth:{validSince:start-1}},
  ];
  for(const overrides of variants){
    const f=fake(overrides);
    const result=await assessPilotUnlockPreflight(f.db,f.readers,uid);
    assert.equal(result.eligibleForManualReview,false);
    if(overrides.firestore)assert.equal(f.calls.includes('auth'),false);
  }
});
test('bad identity or untrusted readers fail before external access',async()=>{
  const f=fake();
  await assert.rejects(assessPilotUnlockPreflight(f.db,f.readers,'admin'),
    /INVALID_STUDENT_ID/);
  await assert.rejects(assessPilotUnlockPreflight(f.db,{},uid),
    /TRUSTED_UNLOCK_READERS_REQUIRED/);
  assert.deepEqual(f.calls,[]);
});
test('module has no writes, unlock handler, or Firebase session minting',()=>{
  const source=readFileSync(new URL(
    '../functions/_shared/pilot-unlock-preflight.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,
    /\.run\(|\.batch\(|UPDATE student_auth_identities|firebase.*update|mintFirebaseToken|onRequestPost/);
  assert.match(source,/canEnableNow:false/);
  assert.match(source,/eligibleForManualReview:true/);
});
