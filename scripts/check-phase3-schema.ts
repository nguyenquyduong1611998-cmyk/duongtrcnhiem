// Local-only migration validation. Never connects to Cloudflare or Firebase.
// Run with: bun run scripts/check-phase3-schema.ts
// @ts-ignore -- Bun supplies bun:sqlite at runtime; this Vite project does not install Bun type declarations.
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new Database(':memory:');
db.exec('PRAGMA foreign_keys = ON');
db.exec(readFileSync('serverless/d1-phase3-pilot-enrollments.sql','utf8'));

const accountId = 'pilot_' + 'a'.repeat(32);
const username = 'pilot_hv_' + 'b'.repeat(12);
const insert = db.prepare(
  "INSERT INTO student_pilot_enrollments " +
  "(enrollment_id,username,status,auth_version,created_at,updated_at) " +
  "VALUES (?,?,'pending',1,?,?)"
);
insert.run(accountId,username,100,100);
assert.equal(
  (db.prepare('SELECT status FROM student_pilot_enrollments WHERE enrollment_id=?')
    .get(accountId) as {status:string}).status,
  'pending'
);

const reject = (action:()=>unknown) => {
  assert.throws(action);
};
reject(()=>insert.run('pilot_'+'c'.repeat(32),'admin',100,100));
reject(()=>insert.run('pilot_'+'c'.repeat(32),username.toUpperCase(),100,100));
reject(()=>db.prepare("UPDATE student_pilot_enrollments SET status='active'").run());
reject(()=>db.prepare(
  "INSERT INTO student_pilot_audit (event_id,enrollment_id,actor_uid,action,created_at) " +
  "VALUES (?,?,?,?,?)"
).run('fake-event','pilot_'+'c'.repeat(32),'fake-admin','created',100));

db.prepare(
  'INSERT INTO student_pilot_audit (event_id,enrollment_id,actor_uid,action,created_at) ' +
  'VALUES (?,?,?,?,?)'
).run('event-1',accountId,'synthetic-admin','created',100);

assert.equal((db.prepare('SELECT COUNT(*) AS n FROM student_pilot_enrollments')
  .get() as {n:number}).n,1);
assert.equal((db.prepare('SELECT COUNT(*) AS n FROM student_pilot_audit')
  .get() as {n:number}).n,1);
db.close();
console.log('Phase 3 pilot schema: in-memory SQLite validation passed');
