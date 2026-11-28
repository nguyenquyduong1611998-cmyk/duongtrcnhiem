// Phase 7E — guard against accidental UI state reuse after Firebase UID
// changes, and regression check that authenticated results bypass PWA cache.
// These assertions operate on source strings and do NOT claim a real browser
// installation or an end-to-end Cloudflare network test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync('src/App.tsx','utf8');
const exam=readFileSync('src/components/Phase6StudentExamPanel.tsx','utf8');
const refresh=readFileSync('src/utils/phase7SessionRefresh.ts','utf8');
const results=readFileSync('src/components/Phase6ResultsPanel.tsx','utf8');
const sw=readFileSync('public/phase6f-preview-sw.js','utf8');
const studentApi=readFileSync('src/utils/phase6StudentExam.ts','utf8');
const resultApi=readFileSync('src/utils/phase6Results.ts','utf8');

test('React account boundaries remount all student exam and role-specific score panels',()=>{
  assert.match(app,
    /<Phase6StudentExamPanel\s+key=\{firebaseUser\.uid\}\s+user=\{firebaseUser\}/);
  assert.match(app,
    /<Phase6ResultsPanel\s+key=\{firebaseUser\.uid\}\s+role="student"\s+user=\{firebaseUser\}/);
  assert.match(app,
    /<Phase6ResultsPanel\s+key=\{firebaseUser\.uid\}\s+role="admin"\s+user=\{firebaseUser\}/);
  assert.match(app,
    /currentUser\.id\s*===\s*firebaseUser\.uid/);
  assert.match(results,/setPage\(null\);setSummary\(null\);setNotice\(''\)/);
  assert.match(results,/\[role,user\?\.uid\]/);
});
test('exam clears local answers on new session; no offline durable score or JWT cache',()=>{
  assert.match(exam,/setAnswers\(current=>retainPhase6LocalSelections\(state,next,current\)\)/);
  assert.match(exam,/setState\(next\);setConfirmSubmit\(false\)/);
  assert.match(refresh,/a\.sessionId!==b\.sessionId/);
  assert.match(refresh,/a\.topicId!==b\.topicId/);
  assert.match(refresh,/a\.expiresAt!==b\.expiresAt/);
  assert.match(refresh,/next\.result/);
  assert.match(exam,/setResult\(next\.result\?\?null\)/);
  assert.doesNotMatch(exam,/localStorage\.|sessionStorage\.|indexedDB\./);
  assert.doesNotMatch(results,/localStorage\.|sessionStorage\.|indexedDB\./);
  assert.match(studentApi,/cache:'no-store',credentials:'same-origin',redirect:'error'/);
  assert.match(resultApi,/cache:'no-store',credentials:'same-origin',redirect:'error'/);
  // Lost-response path is an explicit error, NOT an auto-submission retry.
  assert.match(studentApi,/Hãy đọc lại kết quả trước khi nộp lại/);
});
test('service worker never caches API, authenticated result, POST or navigation HTML',()=>{
  assert.match(sw,/request\.method!=='GET'/);
  assert.match(sw,/request\.mode==='navigate'/);
  assert.match(sw,/request\.headers\.has\('authorization'\)/);
  assert.match(sw,/request\.headers\.has\('cookie'\)/);
  assert.match(sw,/request\.cache==='no-store'/);
  assert.match(sw,/url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(sw,/IMMUTABLE_ASSET\.test\(url\.pathname\)/);
});
