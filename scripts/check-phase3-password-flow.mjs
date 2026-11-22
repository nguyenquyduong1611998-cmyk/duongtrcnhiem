// In-memory only: validates the actual Phase 3 synthetic D1 SQL queries.
// Requires Bun (bun:sqlite); never opens a real Cloudflare database.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Database} from 'bun:sqlite';
import {
  issuePilotTemporaryPassword,rotatePilotTemporaryPassword,
} from '../functions/_shared/pilot-password.mjs';
import {ADMIN_UID} from '../functions/_shared/auth.mjs';
import {onRequestPost as adminEndpoint} from '../functions/api/auth/admin/pilot-password-reset.js';
import {onRequestPost as studentEndpoint} from '../functions/api/auth/student/pilot-password-change.js';

const sqlite=new Database(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON;');
for(const path of [
  'serverless/d1-phase3-pilot-enrollments.sql',
  'serverless/d1-phase3-pilot-passwords.sql'
]) sqlite.exec(readFileSync(path,'utf8'));

const perform=(sql,args=[])=>sqlite.query(sql).run(...args);
const read=(sql,args=[])=>sqlite.query(sql).get(...args);
const d1={
  prepare(sql) {
    return {
      bind(...args) {
        return {
          sql,args,
          async first(){return read(sql,args) || null;},
          async run(){return {success:true,meta:{changes:perform(sql,args).changes}};},
        };
      },
    };
  },
  async batch(statements) {
    const tx=sqlite.transaction((items)=>items.map(({sql,args})=>({
      success:true,meta:{changes:perform(sql,args).changes},
    })));
    return tx(statements);
  },
};

const enrollment='pilot_'+'a'.repeat(32);
const username='pilot_hv_'+'b'.repeat(12);
perform(
  "INSERT INTO student_pilot_enrollments (enrollment_id,username,status,auth_version,created_at,updated_at) " +
  "VALUES (?,?,'pending',1,100,100)",
  [enrollment,username]
);

const count=(table)=>read('SELECT COUNT(*) AS n FROM '+table).n;
const credential=()=>read(
  'SELECT password_reset_required,password_version,password_hash,password_salt '+
  'FROM student_pilot_credentials WHERE enrollment_id=?',[enrollment]
);

function makePost(path,body,origin='https://example.pages.dev') {
  return new Request('https://example.pages.dev'+path,{
    method:'POST',
    headers:{'content-type':'application/json',origin},
    body:JSON.stringify(body),
  });
}
const adminPath='/api/auth/admin/pilot-password-reset';
const studentPath='/api/auth/student/pilot-password-change';
const stagingEnv={
  AUTH_DB:d1,
  STAGING_AUTH_ENABLED:'true',
  FIREBASE_PROJECT_ID:'duongtrcnhiem-staging',
  FIREBASE_SERVICE_ACCOUNT_EMAIL:'synthetic@example.invalid',
  FIREBASE_PRIVATE_KEY:'fake-placeholder-not-an-actual-key',
};

const disabledAdmin=await adminEndpoint({
  request:makePost(adminPath,{username}),env:stagingEnv,
});
assert.equal(disabledAdmin.status,404);
const disabledStudent=await studentEndpoint({
  request:makePost(studentPath,{
    username,temporaryPassword:'not-real',newPassword:'NewPass!2026Secure',
  }),env:stagingEnv,
});
assert.equal(disabledStudent.status,404);
assert.equal(count('student_pilot_credentials'),0);

// Even explicitly flagged-on, an unverified Admin cannot issue a password.
const unauthorized=await adminEndpoint({
  request:makePost(adminPath,{username}),
  env:{...stagingEnv,PHASE3_PILOT_PASSWORDS_ENABLED:'true'},
});
assert.equal(unauthorized.status,403);
assert.equal(count('student_pilot_credentials'),0);

const first=await issuePilotTemporaryPassword(d1,{username},ADMIN_UID);
assert.equal(first.status,200);
const firstResult=await first.json();
assert.match(firstResult.temporaryPassword,/^[a-zA-Z0-9_-]{24}$/);
assert.equal(firstResult.loginEnabled,false);
assert.equal(firstResult.requiresPasswordChange,true);
assert.equal(firstResult.mode,'synthetic-only');
assert.equal(firstResult.username,username);
assert.equal(count('student_pilot_credentials'),1);
assert.equal(count('student_pilot_password_audit'),1);
const original=credential();
assert.equal(original.password_reset_required,1);
assert.equal(original.password_version,1);
assert.notEqual(original.password_hash,firstResult.temporaryPassword);
assert.equal(read(
  'SELECT status FROM student_pilot_enrollments WHERE enrollment_id=?',[enrollment]
).status,'pending');

// Input constraints are fail-closed; do not alter the issued credential.
for (const input of [
  {username:'admin'},
  {username,password:'provided-by-client'},
  {username:'pilot_hv_'+'c'.repeat(12),extra:true},
]){
  assert.equal((await issuePilotTemporaryPassword(d1,input,ADMIN_UID)).status,400);
}
assert.equal((await issuePilotTemporaryPassword(d1,{username},'attacker')).status,400);
assert.equal(count('student_pilot_password_audit'),1);

const incorrect=await rotatePilotTemporaryPassword(d1,{
  username,temporaryPassword:'WrongPass!2026zz',newPassword:'NewPass!2026Secure',
});
assert.equal(incorrect.status,401);
assert.equal(read(
  'SELECT failures FROM student_pilot_password_attempts WHERE enrollment_id=?',
  [enrollment]
).failures,1);

// Admin may reissue a one-time password. Old credential is invalidated.
const second=await issuePilotTemporaryPassword(d1,{username},ADMIN_UID);
assert.equal(second.status,200);
const secondResult=await second.json();
assert.notEqual(firstResult.temporaryPassword,secondResult.temporaryPassword);
assert.equal(credential().password_version,2);
assert.equal(count('student_pilot_password_attempts'),0);
assert.equal(count('student_pilot_password_audit'),2);
const oldRejected=await rotatePilotTemporaryPassword(d1,{
  username,temporaryPassword:firstResult.temporaryPassword,
  newPassword:'NewPass!2026Secure',
});
assert.equal(oldRejected.status,401);

// Invalid password requirements are detected without rotating.
for(const newPassword of ['short','onlylowercase0123456789','NoSpaces! 2026']) {
  assert.equal((await rotatePilotTemporaryPassword(d1,{
    username,temporaryPassword:secondResult.temporaryPassword,newPassword,
  })).status,400);
}
assert.equal(credential().password_reset_required,1);

const rotated=await rotatePilotTemporaryPassword(d1,{
  username,temporaryPassword:secondResult.temporaryPassword,
  newPassword:'NewPass!2026Secure',
});
assert.equal(rotated.status,200);
const rotateResult=await rotated.json();
assert.deepEqual(rotateResult,{
  passwordChanged:true,mode:'synthetic-only',loginEnabled:false,
});
assert.equal(credential().password_reset_required,0);
assert.equal(credential().password_version,3);
assert.equal(count('student_pilot_password_attempts'),0);
assert.equal(count('student_pilot_password_audit'),3);
assert.equal(read(
  'SELECT auth_version FROM student_pilot_enrollments WHERE enrollment_id=?',[enrollment]
).auth_version,4);

const replay=await rotatePilotTemporaryPassword(d1,{
  username,temporaryPassword:secondResult.temporaryPassword,
  newPassword:'Another!Pass2026',
});
assert.equal(replay.status,401);
assert.equal(credential().password_version,3);

// Lock an enrollment: no further password reissue or rotation.
perform("UPDATE student_pilot_enrollments SET status='disabled' WHERE enrollment_id=?",[enrollment]);
assert.equal((await issuePilotTemporaryPassword(d1,{username},ADMIN_UID)).status,404);
assert.equal((await rotatePilotTemporaryPassword(d1,{
  username,temporaryPassword:'NewPass!2026Secure',
  newPassword:'Another!Pass2026',
})).status,401);
assert.equal(count('student_pilot_password_audit'),3);

// A status restriction applies at SQL level; active accounts cannot be created.
assert.throws(()=>perform(
  "UPDATE student_pilot_enrollments SET status='active' WHERE enrollment_id=?",
  [enrollment]
));
assert.equal(count('student_pilot_enrollments'),1);
assert.equal(count('student_pilot_credentials'),1);

// Brute-force protection for a second synthetic account: 5 failures lock
// further attempts; admin reissue clears the test-only failure counter.
const enrollment2='pilot_'+'c'.repeat(32);
const username2='pilot_hv_'+'d'.repeat(12);
perform(
  "INSERT INTO student_pilot_enrollments (enrollment_id,username,status,auth_version,created_at,updated_at) " +
  "VALUES (?,?,'pending',1,100,100)",
  [enrollment2,username2]
);
const secondAccount=await issuePilotTemporaryPassword(d1,{username:username2},ADMIN_UID);
assert.equal(secondAccount.status,200);
const secondPassword=(await secondAccount.json()).temporaryPassword;
for(let attempt=0;attempt<5;attempt++) {
  assert.equal((await rotatePilotTemporaryPassword(d1,{
    username:username2,temporaryPassword:'Wrong!Password2026',
    newPassword:'Safe!Replacement2026',
  })).status,401);
}
assert.equal(read(
  'SELECT failures FROM student_pilot_password_attempts WHERE enrollment_id=?',
  [enrollment2]
).failures,5);
assert.equal((await rotatePilotTemporaryPassword(d1,{
  username:username2,temporaryPassword:secondPassword,
  newPassword:'Safe!Replacement2026',
})).status,429);
const reissued=await issuePilotTemporaryPassword(d1,{username:username2},ADMIN_UID);
assert.equal(reissued.status,200);
assert.equal(read(
  'SELECT COUNT(*) AS n FROM student_pilot_password_attempts WHERE enrollment_id=?',
  [enrollment2]
).n,0);
assert.equal((await rotatePilotTemporaryPassword(d1,{
  username:username2,temporaryPassword:(await reissued.json()).temporaryPassword,
  newPassword:'Safe!Replacement2026',
})).status,200);

assert.equal((await rotatePilotTemporaryPassword(d1,{
  username:'pilot_hv_'+'e'.repeat(12),
  temporaryPassword:'Wrong!Password2026',
  newPassword:'Safe!Replacement2026',
})).status,401);

sqlite.close();
console.log('Phase 3 synthetic first-password-change: SQLite integration passed (no cloud writes).');
