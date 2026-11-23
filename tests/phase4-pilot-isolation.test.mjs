// A narrow DEMO-only branch must not import experimental Phase 3 auth,
// enable real student access, run database migrations, or deploy anything.
// This is a code-scope guard, not a replacement for infrastructure review.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';

const text=path=>readFileSync(path,'utf8');
test('standalone DEMO quiz does not depend on Phase 3 real student work',()=>{
  assert.equal(existsSync('functions/_shared/student-session.mjs'),false);
  const server=text('functions/_shared/synthetic-quiz.mjs');
  assert.match(server,/from '\.\/demo-quiz-token\.mjs'/);
  assert.doesNotMatch(server,/phase3|pilot-enrollments|unitAuthVersion|student_auth_identities/i);
  assert.equal(existsSync('serverless/d1-phase3-unlock-preparation.sql'),false);
  assert.equal(existsSync('functions/api/auth/admin/pilot-enrollments.js'),false);
});
test('all new Cloudflare handlers must fail closed until staging flag enabled',()=>{
  for(const [path,flag] of [
    ['functions/api/demo-quiz/student.js','PHASE4_SYNTHETIC_QUIZ_ENABLED'],
    ['functions/api/demo-quiz/admin.js','PHASE4_SYNTHETIC_QUIZ_ENABLED'],
    ['functions/api/demo-quiz/preflight.js','PHASE4_STAGING_PREFLIGHT_ENABLED'],
  ]){
    const route=text(path);
    assert.ok(route.includes(flag),path);
    assert.match(route,/requireStaging\(env\)/,path);
    assert.match(route,/onRequestPost/);
    assert.match(route,/NOT_FOUND/);
    assert.doesNotMatch(route,/\bonRequestGet\b|\bonRequestDelete\b/);
  }
});
test('quiz SQL is additive, synthetic-only and does not alter old tables',()=>{
  const sql=text('serverless/d1-phase4-synthetic-graded-quiz.sql');
  assert.match(sql,/CREATE TABLE IF NOT EXISTS synthetic_graded_attempts/);
  assert.match(sql,/SYNTHETIC_ONLY/);
  assert.match(sql,/SYNTHETIC_GRADE_IMMUTABLE/);
  assert.doesNotMatch(sql,/\bDROP TABLE\b|\bALTER TABLE\b|\bDELETE FROM\b/);
});
test('no job deploys, runs wrangler or enables server flags',()=>{
  const workflow=text('.github/workflows/test-staging-demo-quiz.yml');
  assert.match(workflow,/feature\/staging-demo-quiz-pilot/);
  assert.doesNotMatch(workflow,/wrangler|cloudflare\/|secrets\.|environment: production|deploy(ment)?:/i);
  assert.doesNotMatch(workflow,/PHASE4_SYNTHETIC_QUIZ_ENABLED\s*[:=]\s*true/);
});
