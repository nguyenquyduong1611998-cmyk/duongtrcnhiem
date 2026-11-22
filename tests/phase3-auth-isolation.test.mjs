// Phase 3: prevent accidental promotion of demo/synthetic auth to real students.
// Static guardrail tests only. These tests do NOT prove that production-ready
// identity, session revocation, Firestore rules or trusted grading exist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('existing D1 unit_accounts is synthetic-only and must not be repurposed in-place', () => {
  const schema = source('serverless/d1-phase2-staging-accounts.sql');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS unit_accounts/);
  assert.match(schema, /username GLOB 'test_unit_\*'/);
  assert.match(schema, /role = 'student'/);
  assert.match(schema, /password_salt GLOB 'cf-chain-v1\.\*'/);
  assert.match(schema, /password_reset_required INTEGER NOT NULL DEFAULT 1/);
  assert.match(schema, /active INTEGER NOT NULL DEFAULT 0/);
});

test('synthetic test_unit credential check does not create a login session', () => {
  const verify = source('functions/api/auth/student/unit-verify.js');
  assert.match(verify, /const TEST_USERNAME = \/\^test_unit_\[a-f0-9\]\{12\}\$\//);
  assert.match(verify, /PASSWORD_CHANGED_LOGIN_DISABLED/);
  assert.match(verify, /TEMPORARY_PASSWORD_VALID_RESET_REQUIRED/);
  assert.doesNotMatch(verify, /mintFirebaseToken\(/);
  assert.doesNotMatch(verify, /customToken\s*:/);

  const passwordChange = source('functions/api/auth/student/unit-change-password.js');
  assert.match(passwordChange, /loginEnabled:false/);
  assert.doesNotMatch(passwordChange, /mintFirebaseToken\(/);
  assert.doesNotMatch(passwordChange, /customToken\s*:/);
});

test('the working student login remains demo_students-only', () => {
  const api = source('functions/api/auth/student/login.js');
  assert.match(api, /FROM demo_students WHERE username=\?/);
  assert.doesNotMatch(api, /FROM unit_accounts/);
  const frontend = source('src/utils/serverlessAuth.ts');
  assert.match(frontend, /\^test_hv_\[a-f0-9\]\{12\}\$/);
  assert.match(frontend, /signInWithCustomToken\(auth, result\.customToken\)/);
});

test('the synthetic Admin API cannot create real student usernames', () => {
  const api = source('functions/api/auth/admin/unit-accounts.js');
  assert.match(api, /const SYNTHETIC_USERNAME = \/\^test_unit_\[a-f0-9\]\{12\}\$\//);
  assert.match(api, /const username = 'test_unit_'/);
  assert.match(api, /verifiedGoogleAdmin\(request\)/);
  assert.doesNotMatch(api, /mintFirebaseToken\(/);
});

test('real student synchronization stays disabled in existing staging UI', () => {
  const app = source('src/App.tsx');
  const cloud = source('src/components/CloudStorageModal.tsx');
  assert.match(app, /allowUploads: !IS_FIREBASE_STAGING/);
  assert.match(app, /disableBulkSync=\{IS_FIREBASE_STAGING\}/);
  assert.match(cloud, /đồng bộ tài khoản học viên thật đang bị khóa/);
});

test('pilot temporary password endpoints remain synthetic-only and unavailable by default', () => {
  const admin = source('functions/api/auth/admin/pilot-password-reset.js');
  const student = source('functions/api/auth/student/pilot-password-change.js');
  const flow = source('functions/_shared/pilot-password.mjs');
  const sql = source('serverless/d1-phase3-pilot-passwords.sql');
  for(const api of [admin,student]) {
    assert.match(api, /PHASE3_PILOT_PASSWORDS_ENABLED !== 'true'/);
    assert.match(api, /requireStaging\(env\)/);
    assert.doesNotMatch(api, /mintFirebaseToken|signInWithCustomToken|customToken/);
  }
  assert.match(admin, /verifiedGoogleAdmin\(request\)/);
  assert.match(flow, /PILOT_USERNAME = \/\^pilot_hv_/);
  assert.match(flow, /loginEnabled:false/);
  assert.match(flow, /password_reset_required=0/);
  assert.match(flow, /password_version=\?/);
  assert.doesNotMatch(flow, /mintFirebaseToken|signInWithCustomToken|customToken/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS student_pilot_credentials/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS student_pilot_password_attempts/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS student_pilot_password_audit/);
  assert.doesNotMatch(sql, /ALTER TABLE|DROP TABLE|INSERT INTO|UPDATE\s+|DELETE FROM/i);
});
