import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {summarizePilotRevocationQueue}
  from '../functions/_shared/pilot-outbox-health.mjs';
import {onRequestPost}
  from '../functions/api/auth/admin/pilot-queue-health.js';

const now=1800000000;
const schema=[
  'serverless/d1-phase3-session-registry.sql',
  'serverless/d1-phase3-session-audit.sql',
  'serverless/d1-phase3-session-mirror-outbox.sql',
].map(x=>readFileSync(x,'utf8')).join('\n');
const make=()=>{
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(schema);
  const db={
    prepare(sql){
      return {bind(...args){
        return {async first(){return sqlite.prepare(sql).get(...args)??null;}};
      }};
    },
  };
  const insert=(i,state,createdAt,attempts=0,leaseUntil=null,nextAt=0)=>{
    const uid='student_'+i.toString(16).padStart(32,'0');
    const eventId='00000000-0000-4000-8000-'+i.toString(16).padStart(12,'0');
    const write=(sql,...args)=>sqlite.prepare(sql).run(...args);
    write(
      'INSERT INTO student_auth_identities '+
      '(firebase_uid,active,password_reset_required,auth_version,'+
      'tokens_valid_after,created_at,updated_at) '+
      'VALUES (?,0,1,2,?, ?, ?)',uid,createdAt,createdAt,createdAt,
    );
    write(
      'INSERT INTO student_auth_block_audit '+
      '(event_id,firebase_uid,actor_uid,action,prior_auth_version,'+
      'new_auth_version,created_at) '+
      "VALUES (?,?,?,'server-access-blocked',1,2,?)",
      eventId,uid,'synthetic-admin',createdAt,
    );
    write(
      'INSERT INTO student_auth_mirror_outbox '+
      '(event_id,firebase_uid,auth_version,revoke_after_seconds,'+
      'state,attempts,next_attempt_at,lease_owner,lease_until,'+
      'delivered_at,created_at,updated_at) '+
      'VALUES (?,?,2,?,?,?,?,?,?,?, ?, ?)',
      eventId,uid,createdAt,state,attempts,nextAt,
      state==='processing'?'00000000-0000-4000-8000-000000000000':null,
      leaseUntil,
      state==='delivered'?createdAt+1:null,createdAt,createdAt,
    );
  };
  return {db,insert,sqlite};
};

test('empty queue is clear and does not claim Firebase revocation',async()=>{
  const f=make();
  try{
    const report=await summarizePilotRevocationQueue(f.db,{now});
    assert.equal(report.severity,'clear');
    assert.equal(report.unresolved,0);
    assert.equal(report.delivered,0);
    assert.equal(report.oldestAgeSeconds,null);
    assert.equal(report.firebaseAccessConfirmedBlocked,false);
    assert.equal(JSON.stringify(report).includes('student_'),false);
  }finally{f.sqlite.close();}
});
test('queued events need action and stale/failed leases trigger critical',async()=>{
  const f=make();
  try{
    f.insert(1,'pending',now-100,0,null,now-10);
    let r=await summarizePilotRevocationQueue(f.db,{now});
    assert.equal(r.severity,'attention');
    assert.equal(r.pending,1);
    assert.equal(r.due,1);
    assert.equal(r.oldestAgeSeconds,100);

    f.insert(2,'pending',now-500,5,null,now+100);
    f.insert(3,'processing',now-200,2,now-1);
    f.insert(4,'delivered',now-1000);
    r=await summarizePilotRevocationQueue(f.db,{now});
    assert.equal(r.severity,'critical');
    assert.deepEqual({
      unresolved:r.unresolved,pending:r.pending,
      processing:r.processing,delivered:r.delivered,
      stale:r.stale,repeatFailures:r.repeatFailures,
      expiredLeases:r.expiredLeases,due:r.due,
      oldestAgeSeconds:r.oldestAgeSeconds,
    },{
      unresolved:3,pending:2,processing:1,delivered:1,
      stale:1,repeatFailures:1,expiredLeases:1,due:1,
      oldestAgeSeconds:500,
    });
    assert.equal(r.firebaseAccessConfirmedBlocked,false);
    const serialized=JSON.stringify(r);
    assert.equal(serialized.includes('student_'),false);
    assert.equal(serialized.includes('00000000-'),false);
    assert.equal(serialized.includes('synthetic-admin'),false);
  }finally{f.sqlite.close();}
});
test('fail closed on inconsistent/malformed results and invalid clock',async()=>{
  const f=make();
  try{
    await assert.rejects(
      summarizePilotRevocationQueue(f.db,{now:0}),/INVALID_MONITOR_CLOCK/
    );
    const fake={
      prepare(){return {bind(){return {async first(){return {
        total:1,pending:2,processing:0,delivered:0,
        stale:0,repeatFailures:0,expiredLeases:0,due:0,
        oldestUnresolvedAt:now-20,
      };}};}};},
    };
    await assert.rejects(
      summarizePilotRevocationQueue(fake,{now}),/INCONSISTENT_OUTBOX_COUNTER/
    );
  }finally{f.sqlite.close();}
});
test('monitor endpoint is disabled and cannot be called as an unauthenticated user',async()=>{
  const f=make();
  try{
    const request=new Request(
      'https://staging.example.test/api/auth/admin/pilot-queue-health',{
        method:'POST',headers:{
          'content-type':'application/json',
          origin:'https://staging.example.test',
        },body:JSON.stringify({action:'status'}),
      }
    );
    assert.equal((await onRequestPost({
      request,env:{AUTH_DB:f.db},
    })).status,404);
    assert.equal((await onRequestPost({request,env:{
      AUTH_DB:f.db,
      PHASE3_PILOT_QUEUE_MONITOR_ENABLED:'true',
      STAGING_AUTH_ENABLED:'true',
      FIREBASE_PROJECT_ID:'duongtrcnhiem-staging',
      FIREBASE_SERVICE_ACCOUNT_EMAIL:'synthetic@example.invalid',
      FIREBASE_PRIVATE_KEY:'synthetic-not-a-real-key',
    }})).status,403);
  }finally{f.sqlite.close();}
});
