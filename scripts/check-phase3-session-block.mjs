// In-memory SQL integration test. Does not access Cloudflare D1 or Firebase.
// Includes a proof that an unexpired Firebase ID-token identity is denied once
// its matching D1 registry row is blocked. No refresh-token revocation claimed.
import assert from 'node:assert/strict';
import {Database} from 'bun:sqlite';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {
  blockStudentServerAccess,onRequestPost,
} from '../functions/api/auth/admin/session-block.js';
import {authorizeStudentIdentity} from '../functions/_shared/student-session.mjs';
import {ADMIN_UID} from '../functions/_shared/auth.mjs';

if(!globalThis.crypto)globalThis.crypto=webcrypto;

const sqlite=new Database(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON');
for(const path of [
  'serverless/d1-phase3-session-registry.sql',
  'serverless/d1-phase3-session-audit.sql',
  'serverless/d1-phase3-session-mirror-outbox.sql',
]) sqlite.exec(readFileSync(path,'utf8'));
const execute=(sql,args=[])=>sqlite.query(sql).run(...args);
const read=(sql,args=[])=>sqlite.query(sql).get(...args);
const db={
  prepare(sql) {
    return {
      bind(...args){
        return {
          async first(){return read(sql,args) || null;},
          async run(){return {success:true,meta:{changes:execute(sql,args).changes}};},
          sql,args,
        };
      },
    };
  },
  async batch(statements) {
    const tx=sqlite.transaction(
      list=>list.map(({sql,args})=>({
        success:true,meta:{changes:execute(sql,args).changes},
      })),
    );
    return tx(statements);
  },
};
const uid='student_'+'a'.repeat(32);
const actor=ADMIN_UID;
const now=Math.floor(Date.now()/1000);
const account=(value='1')=>({
  firebaseUid:uid,authVersion:2,authTime:now-100,
});
execute(
  'INSERT INTO student_auth_identities ' +
  '(firebase_uid,active,password_reset_required,auth_version,tokens_valid_after,created_at,updated_at) ' +
  'VALUES (?,1,0,2,0,?,?)',
  [uid,now-1000,now-1000],
);
assert.equal(await authorizeStudentIdentity(db,account()),true);

const unauthorized=await blockStudentServerAccess(db,{firebaseUid:uid},'not-admin');
assert.equal(unauthorized.status,400);
const malformed=await blockStudentServerAccess(db,{
  firebaseUid:uid,role:'admin',
},actor);
assert.equal(malformed.status,400);
const badUid=await blockStudentServerAccess(db,{
  firebaseUid:'student_without_valid_format',
},actor);
assert.equal(badUid.status,400);

const url='https://example.pages.dev/api/auth/admin/session-block';
const request=new Request(url,{
  method:'POST',headers:{
    origin:'https://example.pages.dev',
    'content-type':'application/json',
  },body:JSON.stringify({firebaseUid:uid}),
});
assert.equal((await onRequestPost({request,env:{AUTH_DB:db}})).status,404);
const enabledUnverified=await onRequestPost({request,env:{
  AUTH_DB:db,PHASE3_STUDENT_BLOCK_ENABLED:'true',
  STAGING_AUTH_ENABLED:'true',
  FIREBASE_PROJECT_ID:'duongtrcnhiem-staging',
  FIREBASE_SERVICE_ACCOUNT_EMAIL:'test@example.invalid',
  FIREBASE_PRIVATE_KEY:'not-a-real-private-key',
}});
assert.equal(enabledUnverified.status,403);
assert.equal(read(
  'SELECT active FROM student_auth_identities WHERE firebase_uid=?',
  [uid],
).active,1);

const result=await blockStudentServerAccess(db,{firebaseUid:uid},actor);
assert.equal(result.status,200);
assert.deepEqual(await result.json(),{
  blocked:true,alreadyBlocked:false,mode:'server-access-only',
  mirrorStatus:'pending',firestoreAccessConfirmedBlocked:false,
});
const current=read(
  'SELECT active,auth_version,tokens_valid_after,last_block_event_id ' +
  'FROM student_auth_identities WHERE firebase_uid=?',
  [uid],
);
assert.equal(current.active,0);
assert.equal(current.auth_version,3);
assert.ok(current.tokens_valid_after>=now);
assert.ok(current.last_block_event_id);
assert.equal(await authorizeStudentIdentity(db,account()),false);

const count=()=>read('SELECT COUNT(*) AS n FROM student_auth_block_audit').n;
assert.equal(count(),1);
const audit=read(
  'SELECT event_id,actor_uid,action,prior_auth_version,new_auth_version ' +
  'FROM student_auth_block_audit',
);
assert.equal(audit.event_id,current.last_block_event_id);
assert.equal(audit.actor_uid,actor);
assert.equal(audit.action,'server-access-blocked');
assert.equal(audit.prior_auth_version,2);
assert.equal(audit.new_auth_version,3);
const mirror=read(
  'SELECT event_id,firebase_uid,auth_version,revoke_after_seconds,state,attempts ' +
  'FROM student_auth_mirror_outbox',
);
assert.equal(mirror.event_id,audit.event_id);
assert.equal(mirror.firebase_uid,uid);
assert.equal(mirror.auth_version,3);
assert.ok(mirror.revoke_after_seconds>=now);
assert.equal(mirror.state,'pending');
assert.equal(mirror.attempts,0);
assert.equal(read('SELECT COUNT(*) AS n FROM student_auth_mirror_outbox').n,1);


const again=await blockStudentServerAccess(db,{firebaseUid:uid},actor);
assert.equal(again.status,200);
assert.deepEqual(await again.json(),{
  blocked:true,alreadyBlocked:true,mode:'server-access-only',
});
assert.equal(count(),1);
assert.equal(read('SELECT COUNT(*) AS n FROM student_auth_mirror_outbox').n,1);

const missing=await blockStudentServerAccess(db,{
  firebaseUid:'student_'+'b'.repeat(32),
},actor);
assert.equal(missing.status,404);

// Conditional update rejects a simulated concurrent version advance.
// The audit is tied to its own event id and must not be misattributed.
const raceUid='student_'+'c'.repeat(32);
execute(
  'INSERT INTO student_auth_identities ' +
  '(firebase_uid,active,password_reset_required,auth_version,tokens_valid_after,created_at,updated_at) ' +
  'VALUES (?,1,0,1,0,?,?)',
  [raceUid,now-1000,now-1000],
);
const raceDb={
  prepare:db.prepare,
  async batch(stmts) {
    execute(
      'UPDATE student_auth_identities SET auth_version=auth_version+1 ' +
      'WHERE firebase_uid=?',
      [raceUid],
    );
    return db.batch(stmts);
  },
};
const race=await blockStudentServerAccess(raceDb,{
  firebaseUid:raceUid,
},actor);
assert.equal(race.status,409);
assert.equal(count(),1);
assert.equal(read('SELECT COUNT(*) AS n FROM student_auth_mirror_outbox').n,1);
assert.equal(read(
  'SELECT active FROM student_auth_identities WHERE firebase_uid=?',
  [raceUid],
).active,1);
sqlite.close();
console.log('Phase 3 session guard and Admin block: isolated SQLite tests passed.');
