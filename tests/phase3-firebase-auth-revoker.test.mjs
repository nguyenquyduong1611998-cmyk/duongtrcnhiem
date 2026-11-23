import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify as rsaVerify} from 'node:crypto';
import {PROJECT_ID} from '../functions/_shared/auth.mjs';
import {createPilotFirebaseAuthRevoker}
  from '../functions/_shared/firebase-auth-revoker.mjs';

// HTTP is mocked and locked to fixed service endpoints. No Google calls.
const {publicKey,privateKey}=generateKeyPairSync('rsa',{
  modulusLength:2048,
  publicKeyEncoding:{type:'spki',format:'pem'},
  privateKeyEncoding:{type:'pkcs8',format:'pem'},
});
const uid='student_'+'a'.repeat(32);
const anotherUid='student_'+'b'.repeat(32);
const now=1800000000;
const env={
  FIREBASE_PROJECT_ID:PROJECT_ID,
  STAGING_AUTH_ENABLED:'true',
  AUTH_DB:{},
  FIREBASE_SERVICE_ACCOUNT_EMAIL:'demo-login@'+PROJECT_ID+
    '.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY:privateKey,
  PHASE3_TRUSTED_FIREBASE_AUTH_REVOKER_ENABLED:'true',
  PHASE3_AUTH_SERVICE_ACCOUNT_EMAIL:'dedicated-revoke@'+PROJECT_ID+
    '.iam.gserviceaccount.com',
  PHASE3_AUTH_PRIVATE_KEY:privateKey,
};
const base='https://identitytoolkit.googleapis.com/v1/projects/'+
  PROJECT_ID+'/accounts:';
const respond=(body,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{'content-type':'application/json'},
});
const jwtDecode=s=>JSON.parse(Buffer.from(s,'base64url').toString());
const desired=(firebaseUid=uid,authVersion=5,revokeAfterSeconds=now-100)=>({
  firebaseUid,authVersion,revokeAfterSeconds,
});

function fakeAuth() {
  const data=new Map([[uid,{
    localId:uid,disabled:false,validSince:String(now-1000),
  }]]);
  const counters={
    oauth:0,lookups:0,updates:0,
    failOAuth:false,failLookup:false,failUpdate:false,
    badUpdateReceipt:false,badLookupReceipt:false,
    failConfirmation:false,
  };
  const fetchImpl=async (url,opts={})=>{
    assert.equal(opts.redirect,'error');
    assert.equal(opts.method,'POST');
    if(url==='https://oauth2.googleapis.com/token') {
      counters.oauth++;
      assert.equal(opts.headers['content-type'],
        'application/x-www-form-urlencoded');
      const form=new URLSearchParams(opts.body);
      assert.equal(form.get('grant_type'),
        'urn:ietf:params:oauth:grant-type:jwt-bearer');
      const assertion=form.get('assertion').split('.');
      assert.equal(assertion.length,3);
      assert.equal(jwtDecode(assertion[0]).alg,'RS256');
      assert.equal(rsaVerify('RSA-SHA256',
        Buffer.from(assertion[0]+'.'+assertion[1]),publicKey,
        Buffer.from(assertion[2],'base64url')),true);
      const claims=jwtDecode(assertion[1]);
      assert.equal(claims.aud,url);
      assert.equal(claims.iss,env.PHASE3_AUTH_SERVICE_ACCOUNT_EMAIL);
      assert.equal(claims.scope,
        'https://www.googleapis.com/auth/identitytoolkit');
      assert.equal(claims.iat,now);
      assert.equal(claims.exp,now+3500);
      return counters.failOAuth?respond({error:'denied'},403):
        respond({
          token_type:'Bearer',
          access_token:'fake-auth-access-token-123456',
          expires_in:3600,
        });
    }
    assert.equal(opts.headers.authorization,'Bearer fake-auth-access-token-123456');
    assert.equal(opts.headers['content-type'],'application/json');
    const body=JSON.parse(opts.body);
    if(url===base+'lookup') {
      counters.lookups++;
      assert.deepEqual(Object.keys(body),['localId']);
      assert.equal(body.localId.length,1);
      assert.match(body.localId[0],/^student_[a-f0-9]{32}$/);
      if(counters.failLookup)return respond({error:'unavailable'},503);
      if(counters.badLookupReceipt)return respond({users:[]});
      const user=data.get(body.localId[0]);
      if(!user)return respond({users:[]});
      if(counters.failConfirmation && counters.updates>0)
        return respond({users:[{...user,disabled:false}]});
      return respond({users:[user]});
    }
    if(url===base+'update') {
      counters.updates++;
      assert.deepEqual(Object.keys(body).sort(),
        ['disableUser','localId','validSince']);
      assert.equal(body.disableUser,true);
      assert.match(body.localId,/^student_[a-f0-9]{32}$/);
      assert.ok(Number.isSafeInteger(Number(body.validSince)));
      if(counters.failUpdate)return respond({error:'unavailable'},503);
      const previous=data.get(body.localId);
      assert.ok(previous,'Never create Firebase Auth accounts from revoke flow');
      assert.ok(Number(body.validSince)>=Number(previous.validSince));
      data.set(body.localId,{
        localId:body.localId,disabled:true,validSince:body.validSince,
      });
      return respond({
        localId:counters.badUpdateReceipt?anotherUid:body.localId,
      });
    }
    throw new Error('UNEXPECTED_NETWORK_DESTINATION');
  };
  return {
    data,counters,
    revoker:createPilotFirebaseAuthRevoker(env,{fetchImpl,nowSeconds:()=>now}),
  };
}

test('revocation adapter disabled without explicit secrets and staging flags',()=>{
  for(const bad of [
    {...env,PHASE3_TRUSTED_FIREBASE_AUTH_REVOKER_ENABLED:undefined},
    {...env,PHASE3_AUTH_PRIVATE_KEY:undefined},
    {...env,PHASE3_AUTH_SERVICE_ACCOUNT_EMAIL:'not-staging@example.invalid'},
  ]) assert.throws(
    ()=>createPilotFirebaseAuthRevoker(bad),/PILOT_AUTH_REVOKER_DISABLED/
  );
  assert.throws(
    ()=>createPilotFirebaseAuthRevoker({
      ...env,FIREBASE_PROJECT_ID:'production-project',
    }),/STAGING_AUTH_NOT_CONFIGURED/
  );
});

test('disables a synthetic account and revokes refresh-token eligibility',async()=>{
  const f=fakeAuth();
  const result=await f.revoker.disableAndRevoke(desired());
  assert.deepEqual(result,{
    firebaseUid:uid,disabled:true,validSince:now,
  });
  assert.equal(f.counters.oauth,1);
  assert.equal(f.counters.lookups,2);
  assert.equal(f.counters.updates,1);
  assert.equal(f.data.get(uid).disabled,true);
  const repeated=await f.revoker.disableAndRevoke(desired());
  assert.deepEqual(repeated,result);
  assert.equal(f.counters.updates,1);
});

test('never decreases existing Firebase Auth validSince',async()=>{
  const f=fakeAuth();
  f.data.set(uid,{localId:uid,disabled:false,validSince:String(now+500)});
  const applied=await f.revoker.disableAndRevoke(desired());
  assert.equal(applied.validSince,now+500);
  assert.equal(f.data.get(uid).validSince,String(now+500));
  assert.equal(f.counters.updates,1);
});

test('rejects arbitrary identities, roles, auth versions and fields before network',async()=>{
  const f=fakeAuth();
  for(const request of [
    {firebaseUid:'admin',authVersion:5,revokeAfterSeconds:now-100},
    {...desired(),disableUser:false},
    {...desired(),firebaseUid:anotherUid,accountRole:'admin'},
    {...desired(),authVersion:1},
    {...desired(),authVersion:'5'},
    {...desired(),revokeAfterSeconds:-1},
    {...desired(),revokeAfterSeconds:NaN},
  ]) await assert.rejects(f.revoker.disableAndRevoke(request),
    /INVALID_AUTH_REVOCATION/);
  assert.equal(f.counters.oauth,0);
});

test('fails closed for missing account and unsuccessful OAuth/lookup/update',async()=>{
  const missing=fakeAuth();
  await assert.rejects(missing.revoker.disableAndRevoke(desired(anotherUid)),
    /AUTH_USER_NOT_CONFIRMED/);
  const badOauth=fakeAuth();
  badOauth.counters.failOAuth=true;
  await assert.rejects(badOauth.revoker.disableAndRevoke(desired()),
    /AUTH_OAUTH_UNAVAILABLE/);
  const badLookup=fakeAuth();
  badLookup.counters.failLookup=true;
  await assert.rejects(badLookup.revoker.disableAndRevoke(desired()),
    /AUTH_LOOKUP_UNAVAILABLE/);
  const badReceipt=fakeAuth();
  badReceipt.counters.badLookupReceipt=true;
  await assert.rejects(badReceipt.revoker.disableAndRevoke(desired()),
    /AUTH_USER_NOT_CONFIRMED/);
  const badUpdate=fakeAuth();
  badUpdate.counters.failUpdate=true;
  await assert.rejects(badUpdate.revoker.disableAndRevoke(desired()),
    /AUTH_DISABLE_UNAVAILABLE/);
});

test('never acknowledges a mismatched update receipt or failed readback',async()=>{
  const f=fakeAuth();
  f.counters.badUpdateReceipt=true;
  await assert.rejects(f.revoker.disableAndRevoke(desired()),
    /AUTH_DISABLE_NOT_CONFIRMED/);
  const g=fakeAuth();
  g.counters.failConfirmation=true;
  await assert.rejects(g.revoker.disableAndRevoke(desired()),
    /AUTH_DISABLE_NOT_CONFIRMED/);
});
