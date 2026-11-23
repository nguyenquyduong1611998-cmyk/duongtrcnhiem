import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
  verifyStudentFirebaseIdToken,bearerToken,authorizeStudentIdentity,
} from '../functions/_shared/student-session.mjs';
import {onRequestPost} from '../functions/api/auth/student/session-check.js';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const project='duongtrcnhiem-staging';
const uid='student_'+'a'.repeat(32);
const now=Math.floor(Date.now()/1000);
const head={alg:'RS256',kid:'local-test-key',typ:'JWT'};
const payload={
  iss:'https://securetoken.google.com/'+project,
  aud:project,sub:uid,user_id:uid,
  exp:now+3600,iat:now,auth_time:now-100,
  firebase:{sign_in_provider:'custom'},
  unitStudent:true,unitAuthVersion:3,
};
const keys=await crypto.subtle.generateKey(
  {name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
    publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},
  true,['sign','verify'],
);
const jwk={...(await crypto.subtle.exportKey('jwk',keys.publicKey)),kid:head.kid};
const encode=value=>Buffer.from(
  typeof value==='string'?value:JSON.stringify(value)
).toString('base64url');

async function sign(obj=payload,header=head,privateKey=keys.privateKey){
  const signed=encode(header)+'.'+encode(obj);
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',
    privateKey,new TextEncoder().encode(signed));
  return signed+'.'+Buffer.from(signature).toString('base64url');
}
async function verified(candidate, options={}){
  return verifyStudentFirebaseIdToken(await sign(candidate),
    {now,keys:[jwk],...options});
}

test('valid signed Firebase ID token returns only constrained student identity',async()=>{
  const result=await verified();
  assert.deepEqual(result,{firebaseUid:uid,authVersion:3,authTime:now-100});
});

test('strict Firebase project, role, version, issuer, dates and identity checks',async()=>{
  const variants=[
    {...payload,iss:'https://securetoken.google.com/not-this-project'},
    {...payload,aud:'not-this-project'},
    {...payload,iss:'service-account@example.invalid'},
    {...payload,sub:'admin'},
    {...payload,sub:uid,user_id:'another-user'},
    {...payload,firebase:{sign_in_provider:'google.com'}},
    {...payload,unitStudent:false},
    {...payload,unitAuthVersion:undefined},
    {...payload,unitAuthVersion:0},
    {...payload,unitAuthVersion:'3'},
    {...payload,exp:now-1},
    {...payload,iat:now+1},
    {...payload,auth_time:now+1},
    {...payload,auth_time:now+1,iat:now+1},
    {...payload,auth_time:now+1,iat:now+2},
    {...payload,auth_time:now+5},
    {...payload,iat:now-5000,exp:now+1},
    {...payload,nbf:now+1},
    {...payload,auth_time:now,iat:now-1},
  ];
  for(const candidate of variants)
    assert.equal(await verified(candidate),null,JSON.stringify(candidate));
  assert.equal(await verifyStudentFirebaseIdToken(
    'not.a.real.token',{now,keys:[jwk]}),null);
});

test('rejects valid-looking but mismatched signatures and untrusted signing keys',async()=>{
  const wrong=await crypto.subtle.generateKey(
    {name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
      publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},
    true,['sign','verify'],
  );
  const forged=await sign(payload,head,wrong.privateKey);
  assert.equal(await verifyStudentFirebaseIdToken(forged,{now,keys:[jwk]}),null);
  assert.equal(await verifyStudentFirebaseIdToken(
    await sign(payload,{...head,kid:'unknown'}),
    {now,keys:[jwk]}),null);
  assert.equal(await verifyStudentFirebaseIdToken(
    await sign(payload,{...head,alg:'none'}),
    {now,keys:[jwk]}),null);
  assert.equal(await verifyStudentFirebaseIdToken(
    await sign(payload,{...head,alg:'HS256'}),
    {now,keys:[jwk]}),null);
});

test('the endpoint accepts a Bearer header, not an account id or client-supplied keys',()=>{
  const r=(value)=>new Request('https://example.pages.dev/',{
    headers:{authorization:value},
  });
  assert.equal(bearerToken(r('Bearer '+('abc.def.ghi'))),'abc.def.ghi');
  assert.equal(bearerToken(r('Bearer '+'a'.repeat(8200))),null);
  assert.equal(bearerToken(r('Basic abc')),null);
  assert.equal(bearerToken(r('Bearer abc def')),null);
  assert.equal(bearerToken(r('Bearer ')),null);
});

function fakeDb(record){
  let reads=0;
  return {
    get reads(){return reads;},
    prepare(sql){
      assert.match(sql,/FROM student_auth_identities WHERE firebase_uid=\?/);
      return {bind(value){
        reads++;
        assert.equal(value,uid);
        return {async first(){return record||null;}};
      }};
    },
  };
}
const goodRecord={
  active:1,password_reset_required:0,auth_version:3,
  tokens_valid_after:now-200,
};
test('D1 checks status, password reset, version, and authentication boundary',async()=>{
  const valid={firebaseUid:uid,authVersion:3,authTime:now-100};
  const goodDb=fakeDb(goodRecord);
  assert.equal(await authorizeStudentIdentity(goodDb,valid),true);
  assert.equal(goodDb.reads,1);
  for(const record of [
    null,
    {...goodRecord,active:0},
    {...goodRecord,password_reset_required:1},
    {...goodRecord,auth_version:4},
    {...goodRecord,tokens_valid_after:now-100},
    {...goodRecord,tokens_valid_after:now-50},
    {...goodRecord,auth_version:'3'},
    {...goodRecord,tokens_valid_after:null},
  ]){
    assert.equal(await authorizeStudentIdentity(fakeDb(record),valid),false);
  }
  assert.equal(await authorizeStudentIdentity(fakeDb(goodRecord),{
    firebaseUid:'student_'+'b'.repeat(32),authVersion:'3',authTime:now-100,
  }),false);
  assert.equal(await authorizeStudentIdentity(null,valid),false);
});

test('session-check feature flag is OFF by default and rejects unknown tokens',async()=>{
  const request=(token)=>new Request(
    'https://example.pages.dev/api/auth/student/session-check',{
      method:'POST',
      headers:{
        'content-type':'application/json',
        origin:'https://example.pages.dev',
        authorization:'Bearer '+token,
      },
      body:'{}',
    }
  );
  const db={prepare(){throw new Error('Must not query D1');}};
  const disabled=await onRequestPost({request:request(await sign()),env:{AUTH_DB:db}});
  assert.equal(disabled.status,404);
  const enabled=await onRequestPost({
    request:request('invalid'),
    env:{
      AUTH_DB:db,STAGING_AUTH_ENABLED:'true',
      PHASE3_STUDENT_SESSION_CHECK_ENABLED:'true',
      FIREBASE_PROJECT_ID:project,
      FIREBASE_SERVICE_ACCOUNT_EMAIL:'synthetic@example.invalid',
      FIREBASE_PRIVATE_KEY:'NOT_A_REAL_KEY',
    },
  });
  assert.equal(enabled.status,401);
  const result=await enabled.json();
  assert.deepEqual(result,{error:'UNAUTHORIZED'});
});

test('new session registry starts disabled, never stores passwords',()=>{
  const schema=readFileSync(new URL(
    '../serverless/d1-phase3-session-registry.sql',import.meta.url),'utf8');
  assert.match(schema,/CREATE TABLE IF NOT EXISTS student_auth_identities/);
  assert.match(schema,/active INTEGER NOT NULL DEFAULT 0/);
  assert.match(schema,/password_reset_required INTEGER NOT NULL DEFAULT 1/);
  assert.match(schema,/tokens_valid_after INTEGER NOT NULL DEFAULT 0/);
  assert.doesNotMatch(schema,/password_hash|password_salt|INSERT INTO|ALTER TABLE|DROP TABLE/);
  const endpoint=readFileSync(new URL(
    '../functions/api/auth/student/session-check.js',import.meta.url),'utf8');
  assert.match(endpoint,/PHASE3_STUDENT_SESSION_CHECK_ENABLED!=='true'/);
  assert.doesNotMatch(endpoint,/mintFirebaseToken|signInWithCustomToken/);
});
