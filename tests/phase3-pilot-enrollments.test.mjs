import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import {
  handlePilotEnrollmentAction,onRequestPost,
} from '../functions/api/auth/admin/pilot-enrollments.js';
import { ADMIN_UID } from '../functions/_shared/auth.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');

function mockD1() {
  const accounts = new Map();
  const audit = [];
  let reads = 0;
  let writes = 0;
  const db = {
    accounts,audit,
    get reads(){return reads;},
    get writes(){return writes;},
    prepare(sql) {
      return {
        sql,
        values:[],
        bind(...values){ this.values=values; return this; },
        async all(){
          reads++;
          assert.match(sql,/FROM student_pilot_enrollments/);
          return {results:[...accounts.values()]
            .sort((a,b)=>b.created_at-a.created_at)
            .slice(0,this.values[0])};
        },
      };
    },
    async batch(statements) {
      writes++;
      assert.equal(statements.length,2);
      const [insert,writeAudit]=statements;
      assert.match(insert.sql,/INSERT INTO student_pilot_enrollments/);
      assert.match(insert.sql,/status,auth_version,created_at,updated_at/);
      assert.match(insert.sql,/COUNT\(\*\) FROM student_pilot_enrollments/);
      assert.match(writeAudit.sql,/INSERT INTO student_pilot_audit/);
      const [id,username,created,updated,max]=insert.values;
      let changes=0;
      if (accounts.size < max) {
        assert.ok(!accounts.has(id));
        assert.ok(![...accounts.values()].some(x=>x.username===username));
        accounts.set(id,{
          enrollment_id:id,username,status:'pending',
          auth_version:1,created_at:created,updated_at:updated,
        });
        changes=1;
      }
      const [eventId,actorUid,at,accountId]=writeAudit.values;
      let auditChanges=0;
      if(accounts.has(accountId)) {
        audit.push({eventId,actorUid,at,accountId,action:'created'});
        auditChanges=1;
      }
      return [
        {success:true,meta:{changes}},
        {success:true,meta:{changes:auditChanges}},
      ];
    },
  };
  return db;
}

test('API is inactive by default, and writes nothing',async()=>{
  const db=mockD1();
  const url='https://example.pages.dev/api/auth/admin/pilot-enrollments';
  const request=new Request(url,{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({action:'create'}),
  });
  const response=await onRequestPost({request,env:{AUTH_DB:db}});
  assert.equal(response.status,404);
  assert.equal(db.reads,0);
  assert.equal(db.writes,0);
});

test('cross-origin and unauthorized requests cannot access pilot backend',async()=>{
  const db=mockD1();
  const url='https://example.pages.dev/api/auth/admin/pilot-enrollments';
  const env={
    PHASE3_PILOT_ENROLLMENT_ENABLED:'true',
    STAGING_AUTH_ENABLED:'true',
    FIREBASE_PROJECT_ID:'duongtrcnhiem-staging',
    FIREBASE_SERVICE_ACCOUNT_EMAIL:'synthetic@example.invalid',
    FIREBASE_PRIVATE_KEY:'synthetic-placeholder',
    AUTH_DB:db,
  };
  const make=(origin)=>new Request(url,{
    method:'POST',headers:{'content-type':'application/json','origin':origin},
    body:JSON.stringify({action:'create'}),
  });
  assert.equal((await onRequestPost({request:make('https://other.test'),env})).status,403);
  assert.equal((await onRequestPost({request:make('https://example.pages.dev'),env})).status,403);
  assert.equal(db.writes,0);
});

test('create emits pending account only, with transactionally recorded audit',async()=>{
  const db=mockD1();
  const response=await handlePilotEnrollmentAction(db,{action:'create'},ADMIN_UID);
  assert.equal(response.status,201);
  const body=await response.json();
  assert.equal(body.mode,'pilot-no-login');
  assert.equal(body.loginEnabled,false);
  assert.match(body.account.username,/^pilot_hv_[a-f0-9]{12}$/);
  assert.match(body.account.enrollmentId,/^pilot_[a-f0-9]{32}$/);
  assert.equal(body.account.status,'pending');
  assert.equal(db.accounts.size,1);
  assert.equal(db.audit.length,1);
  assert.equal(db.audit[0].actorUid,ADMIN_UID);
  assert.deepEqual(Object.keys(body.account).sort(),
    ['createdAt','enrollmentId','status','username']);
  assert.doesNotMatch(JSON.stringify(body),/password|firebase_uid|customToken|idToken/i);

  const list=await handlePilotEnrollmentAction(db,{action:'list'},ADMIN_UID);
  assert.equal(list.status,200);
  const returned=await list.json();
  assert.equal(returned.accounts.length,1);
  assert.deepEqual(returned.accounts[0],body.account);
  assert.equal(db.writes,1);
});

test('rejects extra fields and actors, enforces 100-record pilot cap',async()=>{
  const db=mockD1();
  const wrongInputs=[
    {action:'create',username:'hocvien01'},
    {action:'create',password:'do-not-use'},
    {action:'create',role:'admin'},
    {action:'delete'},
    {action:'disable',username:'pilot_hv_example'},
  ];
  for(const input of wrongInputs) {
    assert.equal((await handlePilotEnrollmentAction(db,input,ADMIN_UID)).status,400);
  }
  assert.equal((await handlePilotEnrollmentAction(db,{action:'create'},'other-admin')).status,400);
  assert.equal(db.writes,0);
  for(let i=0;i<100;i++) {
    assert.equal((await handlePilotEnrollmentAction(db,{action:'create'},ADMIN_UID)).status,201);
  }
  assert.equal(db.accounts.size,100);
  assert.equal(db.audit.length,100);
  const full=await handlePilotEnrollmentAction(db,{action:'create'},ADMIN_UID);
  assert.equal(full.status,409);
  assert.equal((await full.json()).error,'PILOT_CAPACITY_REACHED');
  assert.equal(db.accounts.size,100);
  assert.equal(db.audit.length,100);
});

test('pilot schema is isolated and cannot store credentials or active accounts',()=>{
  const schema=read('serverless/d1-phase3-pilot-enrollments.sql');
  assert.match(schema,/CREATE TABLE IF NOT EXISTS student_pilot_enrollments/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS student_pilot_audit/);
  assert.match(schema,/status IN \('pending', 'disabled'\)/);
  assert.doesNotMatch(schema,/ALTER TABLE|DROP TABLE|INSERT INTO|UPDATE\s+|DELETE FROM/i);
  assert.doesNotMatch(schema,/CREATE TABLE IF NOT EXISTS (?:unit_accounts|demo_students|login_attempts)/);
  const api=read('functions/api/auth/admin/pilot-enrollments.js');
  assert.match(api,/PHASE3_PILOT_ENROLLMENT_ENABLED !== 'true'/);
  assert.match(api,/verifiedGoogleAdmin\(request\)/);
  assert.match(api,/return json\(\{error:'NOT_FOUND'\},404\)/);
  assert.doesNotMatch(api,/mintFirebaseToken\(|signInWithCustomToken\(|FROM unit_accounts|FROM demo_students/);
});
