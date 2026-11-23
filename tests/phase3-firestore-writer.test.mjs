// All OAuth and Firestore calls are intercepted. No remote network, deploy,
// Firebase user account or Cloudflare database is touched by this test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify as verifySignature} from 'node:crypto';
import {PROJECT_ID} from '../functions/_shared/auth.mjs';
import {createPilotFirestoreRevocationWriter}
  from '../functions/_shared/firestore-session-writer.mjs';

const {publicKey,privateKey}=generateKeyPairSync('rsa',{
  modulusLength:2048,
  publicKeyEncoding:{type:'spki',format:'pem'},
  privateKeyEncoding:{type:'pkcs8',format:'pem'},
});
const validEnv={
  STAGING_AUTH_ENABLED:'true',
  FIREBASE_PROJECT_ID:PROJECT_ID,
  FIREBASE_SERVICE_ACCOUNT_EMAIL:
    'synthetic@'+PROJECT_ID+'.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY:privateKey,
  PHASE3_FIRESTORE_SERVICE_ACCOUNT_EMAIL:
    'revocation-writer@'+PROJECT_ID+'.iam.gserviceaccount.com',
  PHASE3_FIRESTORE_PRIVATE_KEY:privateKey,
  AUTH_DB:{},
  PHASE3_TRUSTED_FIRESTORE_WRITER_ENABLED:'true',
};
const uid='student_'+'a'.repeat(32);
const anotherUid='student_'+'b'.repeat(32);
const now=1800000000;
const desired=(firebaseUid=uid,authVersion=5,revokeAfterSeconds=now)=>({
  firebaseUid,active:false,authVersion,revokeAfterSeconds,
});
const response=(body,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{'content-type':'application/json'},
});
const projectDoc='https://firestore.googleapis.com/v1/projects/'+PROJECT_ID+
  '/databases/(default)/documents/pilot_session_states/';
const decode=segment=>JSON.parse(Buffer.from(segment,'base64url').toString());

function backend() {
  const docs=new Map();
  const network={
    reads:0,writes:0,oauth:0,failRead:false,failWrite:false,failOAuth:false,
    failAck:false,injectConflict:false,oauthScopes:[],
  };
  let updateNumber=0;
  const stored=(user,value)=>docs.set(user,{
    value,
    updateTime:'2026-11-22T10:00:'+
      String(++updateNumber).padStart(2,'0')+'.000000Z',
  });

  const transport=async(url,init={})=>{
    if(url==='https://oauth2.googleapis.com/token') {
      network.oauth++;
      assert.equal(init.method,'POST');
      assert.equal(init.redirect,'error');
      assert.equal(init.headers['content-type'],
        'application/x-www-form-urlencoded');
      const form=new URLSearchParams(init.body);
      assert.equal(form.get('grant_type'),
        'urn:ietf:params:oauth:grant-type:jwt-bearer');
      const assertion=form.get('assertion');
      const parts=assertion.split('.');
      assert.equal(parts.length,3);
      assert.equal(decode(parts[0]).alg,'RS256');
      const signed=parts[0]+'.'+parts[1];
      assert.equal(verifySignature('RSA-SHA256',Buffer.from(signed),
        publicKey,Buffer.from(parts[2],'base64url')),true);
      const claims=decode(parts[1]);
      assert.equal(claims.iss,validEnv.PHASE3_FIRESTORE_SERVICE_ACCOUNT_EMAIL);
      assert.equal(claims.aud,url);
      assert.equal(claims.iat,now);
      assert.equal(claims.exp,now+3500);
      network.oauthScopes.push(claims.scope);
      return network.failOAuth ? response({error:'invalid_grant'},403) :
        response({
          access_token:'synthetic-test-oauth-token',
          token_type:'Bearer',expires_in:3600,
        });
    }
    assert.equal(init.redirect,'error');
    assert.equal(init.headers.authorization,'Bearer synthetic-test-oauth-token');
    const parsed=new URL(url);
    assert.equal(parsed.origin,'https://firestore.googleapis.com');
    assert.equal(parsed.pathname.startsWith(new URL(projectDoc).pathname),true);
    const account=parsed.pathname.slice(new URL(projectDoc).pathname.length);
    assert.match(account,/^student_[a-f0-9]{32}$/);
    const previous=docs.get(account);
    if(init.method==='GET') {
      network.reads++;
      assert.equal(parsed.search,'');
      if(network.failRead)return response({error:'unavailable'},503);
      if(network.failAck && network.writes>0) return response({
        fields:{
          active:{booleanValue:true},
          authVersion:{integerValue:'1'},
          revokeAfterSeconds:{integerValue:'0'},
        },
        updateTime:'2026-11-22T10:00:00.000000Z',
      });
      if(!previous)return response({error:'not-found'},404);
      return response({
        fields:{
          active:{booleanValue:previous.value.active},
          authVersion:{
            integerValue:String(previous.value.authVersion),
          },
          revokeAfterSeconds:{
            integerValue:String(previous.value.revokeAfterSeconds),
          },
        },
        updateTime:previous.updateTime,
      });
    }
    if(init.method==='PATCH') {
      network.writes++;
      assert.deepEqual(
        parsed.searchParams.getAll('updateMask.fieldPaths'),
        ['active','authVersion','revokeAfterSeconds'],
      );
      const input=JSON.parse(init.body);
      assert.deepEqual(Object.keys(input.fields).sort(),
        ['active','authVersion','revokeAfterSeconds']);
      const active=input.fields.active.booleanValue;
      const authVersion=Number(input.fields.authVersion.integerValue);
      const revokeAfterSeconds=Number(input.fields.revokeAfterSeconds.integerValue);
      assert.equal(active,false);
      assert.ok(Number.isSafeInteger(authVersion));
      assert.ok(Number.isSafeInteger(revokeAfterSeconds));
      if(network.failWrite)return response({error:'unavailable'},503);

      if(network.injectConflict) {
        network.injectConflict=false;
        stored(account,{
          active:false,authVersion:authVersion+2,
          revokeAfterSeconds:revokeAfterSeconds+100,
        });
        return response({error:'aborted'},412);
      }
      if(previous) {
        assert.equal(parsed.searchParams.has('currentDocument.exists'),false);
        if(parsed.searchParams.get('currentDocument.updateTime')!==
          previous.updateTime) return response({error:'conflict'},412);
      } else if(parsed.searchParams.get('currentDocument.exists')!=='false') {
        return response({error:'already-exists'},409);
      }
      stored(account,{active,authVersion,revokeAfterSeconds});
      return response({name:projectDoc+account},200);
    }
    throw new Error('Unexpected HTTP method');
  };
  return {
    docs,network,stored,
    writer:createPilotFirestoreRevocationWriter(validEnv,{
      fetchImpl:transport,nowSeconds:()=>now,
    }),
  };
}

test('staging-only feature is OFF by default; other project/accounts are refused',()=>{
  assert.throws(
    ()=>createPilotFirestoreRevocationWriter({
      ...validEnv,PHASE3_TRUSTED_FIRESTORE_WRITER_ENABLED:undefined,
    }),/PILOT_FIRESTORE_WRITER_DISABLED/);
  assert.throws(
    ()=>createPilotFirestoreRevocationWriter({
      ...validEnv,FIREBASE_PROJECT_ID:'production-project',
    }),/STAGING_AUTH_NOT_CONFIGURED/);
  assert.throws(
    ()=>createPilotFirestoreRevocationWriter({
      ...validEnv,
      PHASE3_FIRESTORE_SERVICE_ACCOUNT_EMAIL:'other@not-staging.iam.gserviceaccount.com',
    }),/PILOT_FIRESTORE_WRITER_DISABLED/);
  assert.throws(
    ()=>createPilotFirestoreRevocationWriter({
      ...validEnv,PHASE3_FIRESTORE_PRIVATE_KEY:undefined,
    }),/PILOT_FIRESTORE_WRITER_DISABLED/);
});

test('creates one disabled synthetic doc with narrow OAuth and CAS exists:false',async()=>{
  const {writer,docs,network}=backend();
  assert.deepEqual(await writer.applyRevokedState(desired()),{
    active:false,authVersion:5,revokeAfterSeconds:now,
  });
  assert.equal(docs.get(uid).value.active,false);
  assert.equal(network.writes,1);
  assert.equal(network.reads,2);
  assert.equal(network.oauth,1);
  assert.deepEqual(network.oauthScopes,
    ['https://www.googleapis.com/auth/datastore']);

  // Idempotent delivery cannot re-patch or re-enable an already blocked row.
  assert.deepEqual(await writer.applyRevokedState(desired()),{
    active:false,authVersion:5,revokeAfterSeconds:now,
  });
  assert.equal(network.writes,1);
  assert.equal(network.oauth,1);
});

test('an existing ACTIVE state may be disabled using updateTime CAS',async()=>{
  const {writer,stored,docs,network}=backend();
  stored(uid,{active:true,authVersion:4,revokeAfterSeconds:now-100});
  const result=await writer.applyRevokedState(desired());
  assert.deepEqual(result,{
    active:false,authVersion:5,revokeAfterSeconds:now,
  });
  assert.equal(docs.get(uid).value.active,false);
  assert.equal(network.writes,1);
});

test('older events NEVER overwrite a newer active account',async()=>{
  const {writer,stored,docs,network}=backend();
  const current={active:true,authVersion:8,revokeAfterSeconds:now+900};
  stored(uid,current);
  await assert.rejects(
    writer.applyRevokedState(desired()),/NEWER_ACTIVE_SESSION_REQUIRES_REVIEW/
  );
  assert.deepEqual(docs.get(uid).value,current);
  assert.equal(network.writes,0);
});

test('newer disabled record satisfies an old event without a write',async()=>{
  const {writer,stored,network}=backend();
  stored(uid,{active:false,authVersion:9,revokeAfterSeconds:now+500});
  const applied=await writer.applyRevokedState(desired());
  assert.deepEqual(applied,{
    active:false,authVersion:9,revokeAfterSeconds:now+500,
  });
  assert.equal(network.writes,0);
});

test('preserves a greater existing revocation cutoff while upgrading version',async()=>{
  const {writer,stored,docs}=backend();
  stored(uid,{active:false,authVersion:4,revokeAfterSeconds:now+1000});
  assert.deepEqual(await writer.applyRevokedState(desired()),{
    active:false,authVersion:5,revokeAfterSeconds:now+1000,
  });
  assert.equal(docs.get(uid).value.revokeAfterSeconds,now+1000);
});

test('conditional-write conflict retries, rereads and never overwrites newer state',async()=>{
  const {writer,network,stored}=backend();
  stored(uid,{active:true,authVersion:4,revokeAfterSeconds:now-10});
  network.injectConflict=true;
  assert.deepEqual(await writer.applyRevokedState(desired()),{
    active:false,authVersion:7,revokeAfterSeconds:now+100,
  });
  assert.equal(network.writes,1);
  assert.equal(network.reads,2);
});

test('bad input, OAuth failure, API failure and unconfirmed write fail closed',async()=>{
  const {writer,network}=backend();
  for(const input of [
    {firebaseUid:uid,active:true,authVersion:5,revokeAfterSeconds:now},
    {...desired(),firebaseUid:'admin'},
    {...desired(),firebaseUid:anotherUid,role:'admin'},
    {...desired(),authVersion:'5'},
    {...desired(),revokeAfterSeconds:-1},
  ]) {
    await assert.rejects(writer.applyRevokedState(input),/INVALID_REVOCATION/);
  }
  assert.equal(network.oauth,0);
  network.failOAuth=true;
  await assert.rejects(writer.applyRevokedState(desired()),
    /GOOGLE_OAUTH_UNAVAILABLE/);
  network.failOAuth=false;
  network.failRead=true;
  await assert.rejects(writer.applyRevokedState(desired()),
    /FIRESTORE_READ_UNAVAILABLE/);
  network.failRead=false;
  network.failWrite=true;
  await assert.rejects(writer.applyRevokedState(desired()),
    /FIRESTORE_WRITE_UNAVAILABLE/);
  network.failWrite=false;
  network.failAck=true;
  await assert.rejects(writer.applyRevokedState(desired()),
    /FIRESTORE_REVOCATION_NOT_CONFIRMED/);
});
