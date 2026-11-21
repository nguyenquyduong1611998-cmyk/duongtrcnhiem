import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {hashPassword} from '../functions/_shared/auth.mjs';
import {
  verifySyntheticUnitCredential, onRequestPost,
} from '../functions/api/auth/student/unit-verify.js';

if (!globalThis.crypto) globalThis.crypto=webcrypto;

function database(user) {
  const attempts=new Map();
  const queries=[];
  const db={
    attempts,queries,
    prepare(sql) {
      queries.push(sql);
      return {
        bind(...args) {
          return {
            async first(){
              if (sql.startsWith('SELECT failures,')) return attempts.get(args[0]) || null;
              if (sql.startsWith('SELECT username,password_salt,')) {
                return args[0]===user.username?user:null;
              }
              throw new Error('UNEXPECTED_SELECT');
            },
            async run(){
              if(sql.startsWith('INSERT INTO login_attempts')) {
                const [username,failures,first_failed,locked_until]=args;
                attempts.set(username,{failures,first_failed,locked_until});
                return {success:true};
              }
              if(sql.startsWith('DELETE FROM login_attempts')) {
                attempts.delete(args[0]);
                return {success:true};
              }
              throw new Error('UNEXPECTED_WRITE');
            },
          };
        },
      };
    },
  };
  return db;
}

test('synthetic password verifier never creates a Firebase session and respects locked status',async()=>{
  const tempPassword='staging_temp_password_123456';
  const {salt,hash,iterations}=await hashPassword(tempPassword);
  const username='test_unit_aabbccddeeff';
  const row={
    username,password_salt:salt,password_hash:hash,kdf_iterations:iterations,
    role:'student',active:0,password_reset_required:1,
  };
  const db=database(row);
  let response=await verifySyntheticUnitCredential(db,{username,password:tempPassword});
  assert.equal(response.status,401);
  assert.equal(db.attempts.get(username).failures,1);
  row.active=1;
  response=await verifySyntheticUnitCredential(db,{username,password:'incorrect-for-test'});
  assert.equal(response.status,401);
  assert.equal(db.attempts.get(username).failures,2);
  response=await verifySyntheticUnitCredential(db,{username,password:tempPassword});
  assert.equal(response.status,409);
  const result=await response.json();
  assert.deepEqual(result,{error:'TEMPORARY_PASSWORD_VALID_RESET_REQUIRED',mode:'synthetic-only'});
  assert.equal(db.attempts.size,0);
  assert.ok(!JSON.stringify(result).includes(tempPassword));
  assert.ok(!('customToken' in result));
  assert.ok(!('uid' in result));

  row.password_reset_required=0;
  response=await verifySyntheticUnitCredential(db,{username,password:tempPassword});
  assert.equal(response.status,409); // correct new password, but still no Firebase token
  assert.deepEqual(await response.json(),{error:'PASSWORD_CHANGED_LOGIN_DISABLED',mode:'synthetic-only'});
  row.password_reset_required=1;
  row.active=0;
  response=await verifySyntheticUnitCredential(db,{username,password:tempPassword});
  assert.equal(response.status,401);
  assert.ok(db.queries.every(sql=>!sql.includes('demo_students')));
});

test('attempt limit and invalid input reject without issuing tokens',async()=>{
  const username='test_unit_ff1122334455';
  const {salt,hash,iterations}=await hashPassword('correct-staging-password');
  const db=database({
    username,password_salt:salt,password_hash:hash,kdf_iterations:iterations,
    role:'student',active:1,password_reset_required:1,
  });
  for(let i=0;i<5;i++){
    const res=await verifySyntheticUnitCredential(db,{username,password:'wrong-password'});
    assert.equal(res.status,401);
  }
  assert.equal((await verifySyntheticUnitCredential(db,{username,password:'correct-staging-password'})).status,429);
  assert.equal((await verifySyntheticUnitCredential(db,{username:'admin',password:'wrong-password'})).status,401);
  assert.equal((await verifySyntheticUnitCredential(db,{username:'hocvien01',password:'wrong-password'})).status,401);
  assert.equal((await verifySyntheticUnitCredential(db,{username,password:'correct-staging-password',role:'admin'})).status,400);
});

test('public preflight is staging-only and never enables production or leaks secrets',async()=>{
  const path='https://example.pages.dev/api/auth/student/unit-verify';
  const req=(body,origin='https://example.pages.dev')=>new Request(path,{
    method:'POST',headers:{'content-type':'application/json','origin':origin},
    body:JSON.stringify(body),
  });
  assert.equal((await onRequestPost({request:req({
    username:'test_unit_aabbccddeeff',password:'abc',
  }),env:{}})).status,503);
  assert.equal((await onRequestPost({request:req({
    username:'test_unit_aabbccddeeff',password:'abc',
  },'https://attacker.test'),env:{}})).status,403);
  const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
  const client=readFileSync(new URL('../src/utils/serverlessAuth.ts',import.meta.url),'utf8');
  const route=readFileSync(new URL('../functions/api/auth/student/unit-verify.js',import.meta.url),'utf8');
  assert.match(app,/startsWith\('test_unit_'\)/);
  assert.match(app,/verifySyntheticD1TemporaryPassword\(username, password\)/);
  assert.ok(client.includes("'/api/auth/student/unit-verify'"));
  assert.ok(route.includes("error:'TEMPORARY_PASSWORD_VALID_RESET_REQUIRED'"));
  assert.doesNotMatch(route,/mintFirebaseToken|signInWithCustomToken/);
  assert.doesNotMatch(route,/firebase_uid/);
});
