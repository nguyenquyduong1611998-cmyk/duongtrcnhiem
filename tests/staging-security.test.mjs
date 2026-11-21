// Static regression checks only. These do not replace Firestore Emulator tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const stagingRules = read('firestore.staging.rules');
const productionRules = read('firestore.rules');
const firebase = read('src/firebase.ts');
const sync = read('src/utils/firebaseSync.ts');
const app = read('src/App.tsx');
const storage = read('src/utils/storage.ts');
const resultProbe = read('src/utils/stagingResultProbe.ts');
const cloudModal = read('src/components/CloudStorageModal.tsx');

function between(text, start, end) {
  const i = text.indexOf(start);
  assert.ok(i >= 0, `Expected section: ${start}`);
  const j = text.indexOf(end, i + start.length);
  assert.ok(j >= 0, `Expected section end: ${end}`);
  return text.slice(i, j);
}

test('staging uses a separate admin UID without changing production UID', () => {
  assert.match(stagingRules, /request\.auth\.uid == 'aV2S9WYo4tg8XZQSE9snzjeBU203'/);
  assert.match(productionRules, /request\.auth\.uid == '3zPu6ZrPGLfDNsms17mxHrEwfUF2'/);
  assert.doesNotMatch(productionRules, /aV2S9WYo4tg8XZQSE9snzjeBU203/);
  assert.match(firebase, /export const IS_FIREBASE_STAGING = import\.meta\.env\.VITE_FIREBASE_ENV === 'staging'/);
});

test('staging managed accounts require password hashes, not plaintext', () => {
  const managedValidator = between(stagingRules, 'function isValidManagedAccount(', 'function isValidAccountDirectoryEntry(');
  assert.match(managedValidator, /data\.passwordHash is string/);
  // Guard against truncated patterns or duplicate validation fragments.
  assert.ok(managedValidator.includes("data.passwordHash.matches('^[a-f0-9]{64}$')"));
  assert.equal((managedValidator.match(/data\.fullName is string/g) || []).length, 1);
  assert.equal((managedValidator.match(/data\.updatedAt is timestamp/g) || []).length, 1);
  assert.doesNotMatch(managedValidator, /^\) &&$/m);
  assert.doesNotMatch(managedValidator, /data\.password is string/);
  assert.match(sync, /IS_FIREBASE_STAGING\s*\? \{ passwordHash \}\s*: \{ password:/);
  assert.match(sync, /IS_FIREBASE_STAGING && !acc\.password/);
});

test('account directory on staging is admin-only', () => {
  const block = between(stagingRules, 'match \/account_directory\/{accountId}', 'match \/topics\/{topicId}');
  assert.match(block, /allow get: if isValidId\(accountId\) && isAdmin\(\);/);
  assert.match(block, /allow list: if isBootstrappedAdmin\(\);/);
  assert.doesNotMatch(block, /allow list: if existing\(\)\.visibility == 'public'/);
});

test('personally identifiable honor entries require Google identity and owner or admin', () => {
  const block = stagingRules.slice(stagingRules.indexOf('match /honor_entries/{entryId}'));
  assert.match(block, /allow get: if isValidId\(entryId\) && isVerifiedUser\(\)/);
  assert.match(block, /existing\(\)\.ownerUid == request\.auth\.uid \|\| isAdmin\(\)/);
  assert.match(block, /allow list: if isVerifiedUser\(\)/);
  assert.match(sync, /if \(!IS_FIREBASE_STAGING\) \{/);
  assert.match(sync, /IS_FIREBASE_STAGING && !isCloudAdmin/);
});

test('staging does not auto-upload on sign-in or reconnect', () => {
  assert.match(app, /allowUploads: !IS_FIREBASE_STAGING/);
  assert.match(app, /!cloudState\.connected \|\| !firebaseUser \|\| IS_FIREBASE_STAGING/);
  assert.match(app, /IS_FIREBASE_STAGING && currentUser\?\.role !== 'admin'/);
  assert.ok(app.includes('Đồng bộ toàn bộ đang tắt trên staging'));
  assert.match(app, /void signOutGoogleCloud\(\)/);
});

test('staging smoke test uses isolated Admin-only sync_probes collection', () => {
  const probe = between(stagingRules, 'match /sync_probes/{probeId}', 'match /honor_entries/{entryId}');
  assert.match(probe, /allow create: if isBootstrappedAdmin\(\)/);
  assert.match(probe, /allow get: if isBootstrappedAdmin\(\)/);
  assert.match(probe, /allow list: if false;/);
  assert.match(probe, /allow update: if false;/);
  assert.match(probe, /allow delete: if isBootstrappedAdmin\(\)/);
  assert.match(sync, /export async function testStagingAdminWrite/);
  assert.match(sync, /doc\(db, 'sync_probes', nonce\)/);
  assert.match(sync, /await setDoc\(ref,/);
  assert.match(sync, /await getDoc\(ref\)/);
  assert.match(sync, /await deleteDoc\(ref\)/);
  assert.match(app, /onTestWrite=\{IS_FIREBASE_STAGING \? handleTestStagingWrite : undefined\}/);
});

test('synthetic topic does not replace or leak ordinary local study data', () => {
  assert.ok(sync.includes("STAGING_TEST_TOPIC_ID = 'staging_test_topic_20261121'"));
  assert.ok(sync.includes('IS_FIREBASE_STAGING && id === STAGING_TEST_TOPIC_ID'));
  assert.ok(sync.includes('IS_FIREBASE_STAGING && tDoc.id === STAGING_TEST_TOPIC_ID'));
  assert.ok(sync.includes('export async function createStagingTestTopic'));
  assert.ok(sync.includes('export async function readStagingTestTopic'));
  assert.ok(sync.includes('export async function deleteStagingTestTopic'));
  assert.ok(sync.includes("collection(db, 'managed_accounts')") || sync.includes("'managed_accounts'"));
  assert.match(app, /onCreateTestTopic=\{IS_FIREBASE_STAGING/);
  assert.match(app, /onReadTestTopic=\{IS_FIREBASE_STAGING \? readStagingTestTopic : undefined\}/);
});

test('staging synthetic topic never persists as a normal local topic or overwrites real topics', () => {
  assert.match(storage, /function withoutSyntheticTopic\(topics: Topic\[\]\)/);
  assert.ok(storage.includes("topics.filter((t) => t.id !== SYNTHETIC_TOPIC_ID)"));
  assert.ok(storage.includes('const recovered = cleaned.length > 0 ? cleaned : DEFAULT_TOPICS'));
  assert.ok(storage.includes('JSON.stringify(withoutSyntheticTopic(topics))'));
  assert.ok(app.includes('function mergeTopicsSafely(local: Topic[], cloud: Topic[])'));
  assert.ok(app.includes('if (topic.id !== STAGING_TEST_TOPIC_ID) byId.set(topic.id, topic)'));
  assert.ok(app.includes('const nextTopics = mergeTopicsSafely(topicsRef.current, cloudTopics)'));
  assert.ok(app.includes('topics={IS_FIREBASE_STAGING ? topics.filter((t) => t.id !== STAGING_TEST_TOPIC_ID) : topics}'));
});

test('synthetic account test contains no real credentials or sensitive fields', () => {
  const probeRule = between(stagingRules, 'match /account_sync_probes/{probeId}', 'match /topics/{topicId}');
  assert.ok(probeRule.includes("probeId == 'synthetic_student_01'"));
  assert.ok(probeRule.includes("incoming().username == 'hocvien_gia_lap_01'"));
  assert.ok(probeRule.includes("incoming().marker == 'SYNTHETIC_ONLY'"));
  assert.match(probeRule, /allow list: if false;/);
  assert.match(probeRule, /allow update: if false;/);
  assert.ok(probeRule.includes('isBootstrappedAdmin()'));
  assert.ok(probeRule.includes("request.resource.data.keys().hasOnly(["));
  assert.ok(!probeRule.includes("'password'"));
  assert.ok(!probeRule.includes("'passwordHash'"));
  assert.ok(!probeRule.includes("'fullName'"));
  assert.ok(!probeRule.includes("'defaultUnit'"));
  assert.ok(sync.includes("export async function createStagingAccountProbe"));
  assert.ok(sync.includes("export async function readStagingAccountProbe"));
  assert.ok(sync.includes("export async function deleteStagingAccountProbe"));
  assert.ok(sync.includes("doc(db, 'account_sync_probes', STAGING_ACCOUNT_PROBE_ID)"));
});

test('staging normal account, topic, result uploads and bulk sync stay blocked', () => {
  assert.ok(app.includes('if (!IS_FIREBASE_STAGING && cloudState.connected && firebaseUser)'));
  assert.ok(app.includes('if (IS_FIREBASE_STAGING) {\n      setCloudState((prev) => ({'));
  assert.ok(app.includes('onReadTestAccount={IS_FIREBASE_STAGING ? readStagingAccountProbe : undefined}'));
  assert.ok(app.includes('disableBulkSync={IS_FIREBASE_STAGING}'));
});

test('synthetic result permissions use strict custom-token UID and immutable fixed data', () => {
  const rule = between(stagingRules, 'match /demo_result_probes/{ownerUid}', 'match /topics/{topicId}');
  assert.equal((stagingRules.match(/match \/demo_result_probes\/\{ownerUid\}/g) || []).length, 1);
  assert.ok(rule.includes("request.auth.uid == ownerUid"));
  assert.ok(rule.includes("ownerUid.matches('^student_[a-f0-9]{32}$')"));
  assert.ok(rule.includes("request.auth.token.firebase.sign_in_provider == 'custom'"));
  assert.ok(rule.includes("allow list: if false;"));
  assert.ok(rule.includes("allow update: if false;"));
  assert.ok(rule.includes("request.resource.data.keys().hasOnly(["));
  assert.ok(rule.includes("request.resource.data.score == 7"));
  assert.ok(rule.includes("request.resource.data.marker == 'SYNTHETIC_ONLY'"));
  assert.ok(rule.includes('request.resource.data.createdAt == request.time'));
  assert.ok(rule.includes("resource.data.marker == 'SYNTHETIC_ONLY'"));
  assert.doesNotMatch(productionRules, /demo_result_probes/);
});

test('student UI result probe cannot touch real attempts, account directory or local cache', () => {
  assert.ok(resultProbe.includes("doc(db, 'demo_result_probes', user.uid)"));
  assert.ok(resultProbe.includes("getDocFromServer(refFor(student))"));
  assert.ok(resultProbe.includes("score: FAKE_SCORE"));
  assert.ok(resultProbe.includes("createdAt: serverTimestamp()"));
  assert.ok(resultProbe.includes("export async function deleteDemoResultProbe"));
  assert.ok(app.includes("currentUser.id === firebaseUser?.uid"));
  assert.ok(app.includes("currentUser?.role === 'student'"));
  assert.ok(cloudModal.includes('Kiểm thử kết quả GIẢ theo UID Firebase'));
  assert.ok(cloudModal.includes('Đọc kết quả GIẢ từ Firebase'));
  assert.doesNotMatch(resultProbe, /collection\(db, ['"]attempts['"]/);
  assert.doesNotMatch(resultProbe, /localStorage/);
});
