import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {hashPassword, pbkdf2, equalSecret} from '../functions/_shared/auth.mjs';
import {changeSyntheticUnitPassword, onRequestPost} from '../functions/api/auth/student/unit-change-password.js';
import {verifySyntheticUnitCredential} from '../functions/api/auth/student/unit-verify.js';

if(!globalThis.crypto) globalThis.crypto=webcrypto;

function fakeD1(account) {
  const attempts=new Map();
  const sqlStatements=[];
  return {
    attempts, sqlStatements,
    prepare(sql) {
      sqlStatements.push(sql);
      return {
        bind(...args) {
          return {
            async first() {
              if(sql.startsWith('SELECT failures')) return attempts.get(args[0])||null;
              if(sql.startsWith('SELECT password_salt')) return args[0]===account.username?account:null;
              if(sql.startsWith('SELECT username,password_salt')) return args[0]===account.username?account:null;
              throw new Error('UNEXPECTED_FIRST');
            },
            async run() {
              if(sql.startsWith('INSERT INTO login_attempts')) {
                const [username,failures,first_failed,locked_until]=args;
                attempts.set(username,{failures,first_failed,locked_until});
                return {success:true,meta:{changes:1}};
              }
              if(sql.startsWith('DELETE FROM login_attempts')) {
                attempts.delete(args[0]);
                return {success:true,meta:{changes:1}};
              }
              if(sql.startsWith('UPDATE unit_accounts SET password_salt=')) {
                const [salt,hash,iterations,updatedAt,changedAt,username,oldHash,version]=args;
                if(username!==account.username || oldHash!==account.password_hash ||
                   version!==account.auth_version || account.active!==1 ||
                   account.password_reset_required!==1)
                  return {success:true,meta:{changes:0}};
                account.password_salt=salt;
                account.password_hash=hash;
                account.kdf_iterations=iterations;
                account.updated_at=updatedAt;
                account.password_changed_at=changedAt;
                account.password_reset_required=0;
                account.auth_version++;
                return {success:true,meta:{changes:1}};
              }
              throw new Error('UNEXPECTED_RUN');
            },
          };
        },
      };
    },
  };
}

test('forced staging password change requires current temporary password and active account',async()=>{
  const username='test_unit_aabbccddeeff';
  const temporaryPassword='Temporary!Pass12345';
  const newPassword='BrandNew!Password987';
  const initial=await hashPassword(temporaryPassword);
  const account={
    username,password_salt:initial.salt,password_hash:initial.hash,
    kdf_iterations:initial.iterations,active:0,password_reset_required:1,
    role:'student',auth_version:3,
  };
  const db=fakeD1(account);
  const data={username,temporaryPassword,newPassword};

  let response=await changeSyntheticUnitPassword(db,data);
  assert.equal(response.status,401);
  assert.equal(account.auth_version,3);
  assert.equal(account.password_reset_required,1);

  account.active=1;
  response=await changeSyntheticUnitPassword(db,{...data,temporaryPassword:'Wrong!Temporary123'});
  assert.equal(response.status,401);
  assert.equal(account.auth_version,3);

  response=await changeSyntheticUnitPassword(db,data);
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{
    passwordChanged:true,mode:'synthetic-only',loginEnabled:false,username,
  });
  assert.equal(account.password_reset_required,0);
  assert.equal(account.auth_version,4);
  assert.notEqual(account.password_hash,initial.hash);
  assert.notEqual(account.password_salt,initial.salt);
  assert.equal(account.kdf_iterations,310000);
  assert.equal(await pbkdf2(newPassword,account.password_salt),account.password_hash);
  assert.equal(equalSecret(await pbkdf2(temporaryPassword,account.password_salt),account.password_hash),false);
  assert.equal(db.attempts.size,0);
  assert.ok(!db.sqlStatements.some(x=>x.includes('demo_students')||x.includes('managed_accounts')));
  assert.ok(!db.sqlStatements.some(x=>x.includes('firebase_uid')));
  assert.ok(db.sqlStatements.some(x=>x.includes('password_hash=? AND auth_version=?')));

  // Replay with the original one-time password is refused and can't change the record again.
  response=await changeSyntheticUnitPassword(db,data);
  assert.equal(response.status,401);
  assert.equal(account.auth_version,4);

  // Existing verification route recognizes correct new password but never issues a token.
  response=await verifySyntheticUnitCredential(db,{username,password:newPassword});
  assert.equal(response.status,409);
  const body=await response.json();
  assert.equal(body.error,'PASSWORD_CHANGED_LOGIN_DISABLED');
  assert.equal(body.mode,'synthetic-only');
  assert.ok(!JSON.stringify(body).includes(newPassword));
  assert.equal('customToken' in body,false);
  assert.equal('uid' in body,false);
  response=await verifySyntheticUnitCredential(db,{username,password:temporaryPassword});
  assert.equal(response.status,401);
});

test('password policy rejects invalid values and non-demo account names without D1 writes',async()=>{
  const username='test_unit_bbccddeeff00';
  const old='Temporary!Pass12345';
  const k=await hashPassword(old);
  const db=fakeD1({
    username,password_salt:k.salt,password_hash:k.hash,kdf_iterations:k.iterations,
    role:'student',active:1,password_reset_required:1,auth_version:1,
  });
  const invalid=[
    {username:'admin',temporaryPassword:old,newPassword:'BrandNew!Password987'},
    {username:'hocvien01',temporaryPassword:old,newPassword:'BrandNew!Password987'},
    {username,temporaryPassword:old,newPassword:'short'},
    {username,temporaryPassword:old,newPassword:'alllowercasepassword'},
    {username,temporaryPassword:old,newPassword:'JustLetters!Only'},
    {username,temporaryPassword:old,newPassword:'NoSpecialPassword123'},
    {username,temporaryPassword:old,newPassword:'Has Spaces! 123Ab'},
    {username,temporaryPassword:old,newPassword:old},
    {username,temporaryPassword:old,newPassword:'BrandNew!Password987',role:'admin'},
  ];
  for(const p of invalid){
    const r=await changeSyntheticUnitPassword(db,p);
    assert.ok([400,401].includes(r.status),JSON.stringify(p));
  }
  assert.ok(!db.sqlStatements.some(sql=>sql.startsWith('UPDATE unit_accounts')));
});

test('staging-only endpoint rejects wrong origin and missing server bindings',async()=>{
  const uri='https://example.pages.dev/api/auth/student/unit-change-password';
  const data={username:'test_unit_aabbccddeeff',temporaryPassword:'TEMP!1234abcd',
    newPassword:'Newer!5678abcd'};
  const req=(origin)=>new Request(uri,{method:'POST',
    headers:{'content-type':'application/json','origin':origin},body:JSON.stringify(data)});
  assert.equal((await onRequestPost({request:req('https://example.pages.dev'),env:{}})).status,503);
  assert.equal((await onRequestPost({request:req('https://outside.example'),env:{}})).status,403);
  const src=readFileSync(new URL('../functions/api/auth/student/unit-change-password.js',import.meta.url),'utf8');
  const client=readFileSync(new URL('../src/utils/serverlessAuth.ts',import.meta.url),'utf8');
  const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
  const login=readFileSync(new URL('../src/components/LoginScreen.tsx',import.meta.url),'utf8');
  assert.ok(src.includes("password_reset_required=0"));
  assert.ok(src.includes("auth_version=auth_version+1"));
  assert.ok(src.includes("password_hash=? AND auth_version=?"));
  assert.doesNotMatch(src,/mintFirebaseToken|signInWithCustomToken/);
  assert.ok(client.includes("'/api/auth/student/unit-change-password'"));
  assert.ok(app.includes('onChangeSyntheticPassword={IS_FIREBASE_STAGING'));
  assert.ok(login.includes('Đổi mật khẩu thử nghiệm'));
  assert.ok(login.includes('SYNTHETIC_RESET_REQUIRED'));
});
