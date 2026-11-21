import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  onRequestPost, handleSyntheticUnitAccountAction
} from '../functions/api/auth/admin/unit-accounts.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

function fakeD1() {
  const rows = new Map();
  const sqlStatements = [];
  return {
    rows,
    sqlStatements,
    prepare(sql) {
      sqlStatements.push(sql);
      return {
        all: async () => ({
          results: Array.from(rows.values()).map(x => ({
            username:x.username, active:x.active,
            password_reset_required:x.password_reset_required,
            created_at:x.created_at,
          })),
        }),
        bind(...args) {
          return {
            async first() {
              if (sql.startsWith('SELECT username FROM unit_accounts')) {
                const item = rows.get(args[0]);
                return item ? {username:item.username} : null;
              }
              throw new Error('UNEXPECTED_SQL_FIRST');
            },
            async run() {
              if (sql.startsWith('INSERT INTO unit_accounts')) {
                const [username, uid, salt, hash, iterations, created, updated] = args;
                if (rows.has(username)) throw new Error('DUPLICATE_TEST_USERNAME');
                rows.set(username,{
                  username,firebase_uid:uid,role:'student',
                  password_salt:salt,password_hash:hash,kdf_iterations:iterations,
                  password_reset_required:1,active:0,auth_version:1,
                  created_at:created, updated_at:updated,
                });
                return {success:true,meta:{changes:1}};
              }
              if (sql.startsWith('UPDATE unit_accounts SET password_salt=')) {
                const [salt, hash, iterations, updatedAt, passwordChangedAt, username] = args;
                const row=rows.get(username);
                if (!row) return {success:true,meta:{changes:0}};
                row.password_salt=salt;
                row.password_hash=hash;
                row.kdf_iterations=iterations;
                row.password_reset_required=1;
                row.password_changed_at=passwordChangedAt;
                row.updated_at=updatedAt;
                row.auth_version++;
                return {success:true,meta:{changes:1}};
              }
              if (sql.startsWith('UPDATE unit_accounts')) {
                const [active,updatedAt,disabledAt,username] = args;
                const row=rows.get(username);
                if (!row) return {success:true,meta:{changes:0}};
                row.active=active;
                row.updated_at=updatedAt;
                row.disabled_at=disabledAt;
                row.auth_version++;
                return {success:true,meta:{changes:1}};
              }
              if (sql.startsWith('DELETE FROM unit_accounts')) {
                const changes=rows.delete(args[0]) ? 1 : 0;
                return {success:true,meta:{changes}};
              }
              throw new Error('UNEXPECTED_SQL');
            },
          };
        },
      };
    },
  };
}

const dataOf=async response => response.json();

test('new D1 manager rejects non-Admin, missing binding and cross-origin calls',async()=>{
  const url='https://example.pages.dev/api/auth/admin/unit-accounts';
  const post=(body, origin='https://example.pages.dev') =>
    new Request(url,{method:'POST',headers:{'content-type':'application/json','origin':origin},body:JSON.stringify(body)});
  let dbCalls=0;
  const env={
    STAGING_AUTH_ENABLED:'true',
    FIREBASE_PROJECT_ID:'duongtrcnhiem-staging',
    FIREBASE_SERVICE_ACCOUNT_EMAIL:'synthetic@example.invalid',
    FIREBASE_PRIVATE_KEY:'synthetic-test-secret',
    AUTH_DB:{prepare(){dbCalls++;throw new Error('Must not be called');}},
  };
  assert.equal((await onRequestPost({request:post({action:'list'}),env:{}})).status,503);
  assert.equal((await onRequestPost({request:post({action:'list'},'https://evil.test'),env})).status,403);
  assert.equal((await onRequestPost({request:post({action:'list'}),env})).status,403);
  assert.equal(dbCalls,0);
});

test('Admin action handler can only manage synthetic D1 accounts and returns no credentials',async()=>{
  const db=fakeD1();
  const invalid=await handleSyntheticUnitAccountAction(db,{action:'create',username:'admin'});
  assert.equal(invalid.status,400);
  assert.equal(db.sqlStatements.length,0);

  const created=await handleSyntheticUnitAccountAction(db,{action:'create'});
  assert.equal(created.status,201);
  const createdBody=await dataOf(created);
  const username=createdBody.account.username;
  assert.match(username,/^test_unit_[a-f0-9]{12}$/);
  assert.equal(createdBody.mode,'synthetic-only');
  assert.equal(createdBody.account.active,false);
  assert.equal(createdBody.account.passwordResetRequired,true);
  assert.ok(!JSON.stringify(createdBody).includes('passwordHash'));
  assert.ok(!JSON.stringify(createdBody).includes('password_hash'));
  assert.ok(!('password' in createdBody));
  assert.equal(db.rows.size,1);
  const stored=db.rows.get(username);
  assert.equal(stored.active,0);
  assert.equal(stored.password_reset_required,1);
  assert.equal(stored.role,'student');
  assert.match(stored.password_salt,/^cf-chain-v1\./);
  assert.equal(stored.password_hash.length,43);
  assert.equal(stored.kdf_iterations,310000);
  assert.match(stored.firebase_uid,/^student_[a-f0-9]{32}$/);
  assert.equal(stored.auth_version,1);

  const listed=await dataOf(await handleSyntheticUnitAccountAction(db,{action:'list'}));
  assert.equal(listed.accounts.length,1);
  assert.equal(listed.accounts[0].username,username);
  assert.equal(listed.accounts[0].active,false);
  assert.ok(!JSON.stringify(listed).includes(stored.password_hash));
  assert.ok(!JSON.stringify(listed).includes(stored.password_salt));
  assert.ok(!JSON.stringify(listed).includes(stored.firebase_uid));

  const oldHash = stored.password_hash;
  const oldSalt = stored.password_salt;
  const oldUid = stored.firebase_uid;
  const oldAuthVersion = stored.auth_version;
  assert.equal(
    (await handleSyntheticUnitAccountAction(db,{action:'reset-password',username:'admin'})).status,400
  );
  assert.equal(
    (await handleSyntheticUnitAccountAction(db,{action:'reset-password',username})).status,200
  );
  const passwordResponse=await dataOf(await handleSyntheticUnitAccountAction(db,{
    action:'reset-password',username
  }));
  assert.equal(passwordResponse.mode,'synthetic-only');
  assert.equal(passwordResponse.username,username);
  assert.match(passwordResponse.temporaryPassword,/^[A-Za-z0-9_-]{24}$/);
  assert.notEqual(stored.password_hash,oldHash);
  assert.notEqual(stored.password_salt,oldSalt);
  assert.equal(stored.firebase_uid,oldUid);
  assert.equal(stored.active,0);
  assert.equal(stored.password_reset_required,1);
  assert.equal(stored.auth_version,oldAuthVersion+2);
  assert.equal(stored.kdf_iterations,310000);
  assert.ok(!JSON.stringify(stored).includes(passwordResponse.temporaryPassword));
  assert.equal(
    (await handleSyntheticUnitAccountAction(db,{
      action:'reset-password',username:'test_unit_aaaaaaaaaaaa',
    })).status,404
  );

  assert.equal((await handleSyntheticUnitAccountAction(db,{action:'unlock',username:'admin'})).status,400);
  assert.equal((await handleSyntheticUnitAccountAction(db,{action:'lock',username:'hocvien01'})).status,400);
  assert.equal((await handleSyntheticUnitAccountAction(db,{action:'delete',username:'test_unit_../../admin'})).status,400);

  let result=await handleSyntheticUnitAccountAction(db,{action:'unlock',username});
  assert.equal(result.status,200);
  assert.equal(db.rows.get(username).active,1);
  assert.equal(db.rows.get(username).password_reset_required,1);
  assert.equal(db.rows.get(username).auth_version,oldAuthVersion+3);

  result=await handleSyntheticUnitAccountAction(db,{action:'lock',username});
  assert.equal(result.status,200);
  assert.equal(db.rows.get(username).active,0);
  assert.equal(db.rows.get(username).auth_version,oldAuthVersion+4);

  result=await handleSyntheticUnitAccountAction(db,{action:'delete',username});
  assert.equal(result.status,200);
  assert.equal(db.rows.size,0);
  assert.equal((await handleSyntheticUnitAccountAction(db,{action:'delete',username})).status,404);

  assert.ok(db.sqlStatements.every(sql => !sql.includes('demo_students') && !sql.includes('login_attempts')));
  assert.ok(db.sqlStatements.every(sql => /unit_accounts/.test(sql)));
});

test('new D1 manager never enables real account logins or exposes raw credentials in UI',()=>{
  const api=readFileSync(new URL('../functions/api/auth/admin/unit-accounts.js',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../src/components/SyntheticD1AccountsPanel.tsx',import.meta.url),'utf8');
  const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
  const existingLogin=readFileSync(new URL('../functions/api/auth/student/login.js',import.meta.url),'utf8');
  assert.ok(api.includes("if (!await verifiedGoogleAdmin(request))"));
  assert.ok(api.includes("const username = 'test_unit_'"));
  assert.ok(api.includes('randomPassword()'));
  assert.ok(api.includes('password_reset_required'));
  assert.ok(api.includes("action === 'reset-password'"));
  assert.ok(api.includes("if (!await verifiedGoogleAdmin(request))"));
  assert.ok(api.includes("active,password_reset_required"));
  assert.ok(ui.includes('CHƯA thể dùng để đăng nhập'));
  assert.ok(ui.includes('Cấp mật khẩu tạm (GIẢ)'));
  assert.ok(ui.includes("type={revealPassword ? 'text' : 'password'}"));
  assert.ok(ui.includes('Đóng và xóa khỏi màn hình'));
  assert.ok(ui.includes('onList: () => Promise<SyntheticD1Account[]>'));
  assert.ok(app.includes('IS_FIREBASE_STAGING && adminAccessAllowed ? handleListSyntheticD1Accounts : undefined'));
  assert.ok(app.includes('firebaseUser.uid !== BOOTSTRAPPED_ADMIN_UID'));
  assert.ok(!existingLogin.includes('unit_accounts'));
});
