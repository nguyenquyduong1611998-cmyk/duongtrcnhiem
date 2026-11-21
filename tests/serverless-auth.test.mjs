// Cloudflare Pages Functions staging-only tests, no real D1 or Firebase secrets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  requireStaging, usernameKey, equalSecret, hashPassword, pbkdf2,
  mintFirebaseToken, decodeSegment, randomPassword, PROJECT_ID
} from '../functions/_shared/auth.mjs';
import { onRequestPost as login } from '../functions/api/auth/student/login.js';
import { onRequestPost as adminDemo } from '../functions/api/auth/admin/demo.js';
import { onRequestGet as status } from '../functions/api/auth/status.js';

if (!globalThis.crypto) globalThis.crypto=webcrypto;
function makePost(url, body){
  return new Request(url,{method:'POST',headers:{'content-type':'application/json','origin':new URL(url).origin},body:JSON.stringify(body)});
}

test('Cloudflare Functions fail closed until staging D1 and Firebase secrets are provided', async()=>{
  assert.throws(()=>requireStaging({}),/STAGING_AUTH_NOT_CONFIGURED/);
  assert.throws(()=>requireStaging({STAGING_AUTH_ENABLED:'true',FIREBASE_PROJECT_ID:PROJECT_ID}),/NOT_CONFIGURED/);
  assert.equal((await status({env:{}})).status,200);
  assert.equal((await (await status({env:{}})).json()).ready,false);
  const loginResult=await login({request:makePost('https://example.pages.dev/api/auth/student/login',{username:'test_hv_123456abcdef',password:'wrong'}),env:{}});
  assert.equal(loginResult.status,503);
  const adminResult=await adminDemo({request:makePost('https://example.pages.dev/api/auth/admin/demo',{action:'create'}),env:{}});
  assert.equal(adminResult.status,503);
});

test('status confirms D1 binding and both required tables without returning secrets', async()=>{
  const env = {
    AUTH_DB: {
      prepare: (sql) => {
        assert.ok(sql.includes('sqlite_master'));
        return {all: async()=>({results:[{name:'demo_students'},{name:'login_attempts'}]})};
      },
    },
    STAGING_AUTH_ENABLED: 'false',
    FIREBASE_PROJECT_ID: PROJECT_ID,
  };
  const result=await (await status({env})).json();
  assert.equal(result.d1Connected,true);
  assert.equal(result.tablesReady,true);
  assert.equal(result.ready,false);
  assert.equal(Object.keys(result).includes('FIREBASE_PRIVATE_KEY'),false);
  const missingTable=await (await status({env:{
    AUTH_DB:{prepare:()=>({all:async()=>({results:[{name:'demo_students'}]})})},
  }})).json();
  assert.equal(missingTable.d1Connected,true);
  assert.equal(missingTable.tablesReady,false);
  assert.equal(missingTable.ready,false);
  const inaccessible=await (await status({env:{
    AUTH_DB:{prepare:()=>({all:async()=>{throw new Error('db inaccessible');}})},
  }})).json();
  assert.equal(inaccessible.d1Connected,false);
  assert.equal(inaccessible.ready,false);
});

test('server-side password hashes use random salt and PBKDF2; compare in constant work',async()=>{
  const a=await hashPassword('STRONG_DEMO_PASS_1234');
  const b=await hashPassword('STRONG_DEMO_PASS_1234');
  assert.notEqual(a.salt,b.salt);
  assert.notEqual(a.hash,b.hash);
  assert.equal(a.iterations,310000);
  assert.equal(a.hash,await pbkdf2('STRONG_DEMO_PASS_1234',a.salt));
  assert.ok(equalSecret(a.hash,a.hash));
  assert.ok(!equalSecret(a.hash,b.hash));
  assert.ok(!equalSecret(a.hash,''));
  assert.ok(randomPassword().length>=20);
});

test('demo usernames never accept legacy admin or arbitrary user characters',()=>{
  assert.equal(usernameKey(' ADMIN '),'admin'); // only normalization, not permitted as demo in route
  assert.equal(usernameKey('  TeSt_Hv_123abc  '),'test_hv_123abc');
  assert.equal(usernameKey('../admin'),null);
  assert.equal(usernameKey('a'),null);
});

test('Firebase custom token has staging claims and can be verified with test RSA key',async()=>{
  const keys=await crypto.subtle.generateKey({
    name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
    publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'
  },true,['sign','verify']);
  const raw=await crypto.subtle.exportKey('pkcs8',keys.privateKey);
  const pem='-----BEGIN PRIVATE KEY-----\\n'+Buffer.from(raw).toString('base64')+'\\n-----END PRIVATE KEY-----';
  const token=await mintFirebaseToken({FIREBASE_PRIVATE_KEY:pem,FIREBASE_SERVICE_ACCOUNT_EMAIL:'fake@duongtrcnhiem-staging.iam.gserviceaccount.com'},'student_test_123');
  const [header,payload,signature]=token.split('.');
  assert.equal(decodeSegment(header).alg,'RS256');
  const claims=decodeSegment(payload);
  assert.equal(claims.uid,'student_test_123');
  assert.equal(claims.aud,'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit');
  const signatureBytes=Uint8Array.from(Buffer.from(signature.replace(/-/g,'+').replace(/_/g,'/'),'base64'));
  assert.ok(await crypto.subtle.verify('RSASSA-PKCS1-v1_5',keys.publicKey,signatureBytes,new TextEncoder().encode(header+'.'+payload)));
});

test('reject invalid method, origin, and large body before reading secrets',async()=>{
  const wrongOrigin = new Request('https://example.pages.dev/api/auth/student/login',{
    method:'POST',headers:{'content-type':'application/json','origin':'https://evil.example'},body:'{}'
  });
  assert.equal((await login({request:wrongOrigin,env:{}})).status,403);
  const wrongContent = new Request('https://example.pages.dev/api/auth/student/login',{
    method:'POST',headers:{'content-type':'text/plain'},body:'{}'
  });
  assert.equal((await login({request:wrongContent,env:{}})).status,415);
});
