import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {PROJECT_ID,ADMIN_UID} from '../functions/_shared/auth.mjs';
import {
  verifyPilotReviewerIdToken,approvePilotReviewWithSignedAdmin,
} from '../functions/_shared/pilot-review-admin.mjs';
import {requestPilotUnlockReview}
  from '../functions/_shared/pilot-unlock-review.mjs';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const now=1800000000;
const reviewer='second_admin_01';
const uid='student_'+'a'.repeat(32);
const eventId='00000000-0000-4000-8000-000000000001';
const scopes=[
  'serverless/d1-phase3-session-registry.sql',
  'serverless/d1-phase3-session-audit.sql',
  'serverless/d1-phase3-session-mirror-outbox.sql',
  'serverless/d1-phase3-unlock-review.sql',
  'serverless/d1-phase3-review-admins.sql',
];
const pair=await crypto.subtle.generateKey({
  name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
  publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256',
},true,['sign','verify']);
const jwk={
  ...(await crypto.subtle.exportKey('jwk',pair.publicKey)),
  kid:'unit-test-reviewer-key',use:'sig',
};
const enc=s=>Buffer.from(typeof s==='string'?s:JSON.stringify(s)).toString('base64url');
const validClaims={
  iss:'https://securetoken.google.com/'+PROJECT_ID,
  aud:PROJECT_ID,sub:reviewer,user_id:reviewer,email_verified:true,
  iat:now,exp:now+3600,auth_time:now-60,
  firebase:{sign_in_provider:'google.com'},
};
async function signed(body=validClaims,header={
  alg:'RS256',kid:jwk.kid,typ:'JWT',
},key=pair.privateKey) {
  const unsigned=enc(header)+'.'+enc(body);
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,
    new TextEncoder().encode(unsigned));
  return unsigned+'.'+Buffer.from(signature).toString('base64url');
}
const req=token=>new Request('https://staging.example.test/pilot/review',{
  method:'POST',
  headers:{authorization:'Bearer '+token},
});
function fixture() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for(const f of scopes)sqlite.exec(readFileSync(f,'utf8'));
  const execute=(sql,...args)=>sqlite.prepare(sql).run(...args);
  const get=(sql,...args)=>sqlite.prepare(sql).get(...args);
  let beforeApproval=null;
  const db={
    prepare(sql){return {bind(...args){return {
      async first(){return get(sql,...args)??null;},
      async run(){
        if(beforeApproval && sql.startsWith('UPDATE student_pilot_unlock_reviews')) {
          const callback=beforeApproval;beforeApproval=null;callback();
        }
        return {success:true,meta:{changes:execute(sql,...args).changes}};
      },
    };}};},
  };
  execute(
    "INSERT INTO student_pilot_review_admins "+
    "(firebase_uid,active,role,tokens_valid_after,created_at,updated_at) "+
    "VALUES (?,0,'unlock_reviewer',0,?,?)",reviewer,now-1000,now-1000,
  );
  const readers={
    async readFirestoreState(checkUid){
      assert.equal(checkUid,uid);
      return {active:false,authVersion:3,revokeAfterSeconds:now-50};
    },
    async readFirebaseAuthUser(checkUid){
      assert.equal(checkUid,uid);
      return {firebaseUid:uid,disabled:true,validSince:now};
    },
  };
  function seedLock() {
    execute(
      'INSERT INTO student_auth_identities '+
      '(firebase_uid,active,auth_version,password_reset_required,'+
      'tokens_valid_after,last_block_event_id,created_at,updated_at) '+
      'VALUES (?,0,3,0,?,?,?,?)',
      uid,now-50,eventId,now-1000,now-1000,
    );
    execute(
      'INSERT INTO student_auth_block_audit '+
      '(event_id,firebase_uid,actor_uid,action,prior_auth_version,'+
      'new_auth_version,created_at) '+
      "VALUES (?,?,?,'server-access-blocked',2,3,?)",
      eventId,uid,ADMIN_UID,now-100,
    );
    execute(
      'INSERT INTO student_auth_mirror_outbox '+
      '(event_id,firebase_uid,auth_version,revoke_after_seconds,'+
      'state,attempts,next_attempt_at,delivered_at,created_at,updated_at) '+
      "VALUES (?,?,3,?,'delivered',1,0,?,?,?)",
      eventId,uid,now-50,now-40,now-100,now-40,
    );
  }
  return {
    sqlite,db,readers,execute,get,seedLock,
    enable(uidToEnable=reviewer){
      if(uidToEnable===reviewer){
        execute('UPDATE student_pilot_review_admins SET active=1 WHERE firebase_uid=?',
          reviewer);
      } else {
        execute(
          "INSERT INTO student_pilot_review_admins "+
          "(firebase_uid,active,role,tokens_valid_after,created_at,updated_at) "+
          "VALUES (?,1,'unlock_reviewer',0,?,?)",
          uidToEnable,now-1000,now-1000,
        );
      }
    },
    intercept(cb){beforeApproval=cb;},
  };
}

test('signed Google Firebase ID token and ACTIVE D1 role are both required',async()=>{
  const f=fixture();
  try {
    const token=await signed();
    assert.equal(await verifyPilotReviewerIdToken(req(token),f.db,
      {now,keys:[jwk]}),null);
    f.enable();
    assert.deepEqual(await verifyPilotReviewerIdToken(req(token),f.db,
      {now,keys:[jwk]}),{uid:reviewer,authTime:now-60});
    f.execute(
      'UPDATE student_pilot_review_admins SET active=0 WHERE firebase_uid=?',
      reviewer,
    );
    assert.equal(await verifyPilotReviewerIdToken(req(token),f.db,
      {now,keys:[jwk]}),null);
  } finally{f.sqlite.close();}
});

test('tampering, wrong key, wrong issuer/provider, stale login all fail closed',async()=>{
  const f=fixture();
  try {
    f.enable();
    const mutations=[
      {...validClaims,iss:'https://securetoken.google.com/not-the-staging-project'},
      {...validClaims,aud:'not-staging'},
      {...validClaims,sub:'student_'+'b'.repeat(32)},
      {...validClaims,user_id:'another-admin'},
      {...validClaims,email_verified:false},
      {...validClaims,firebase:{sign_in_provider:'custom'}},
      {...validClaims,auth_time:now-301},
      {...validClaims,iat:now+1},
      {...validClaims,exp:now},
      {...validClaims,auth_time:now+1},
      {...validClaims,nbf:now+1},
    ];
    for(const claim of mutations) {
      const verified=await verifyPilotReviewerIdToken(
        req(await signed(claim)),f.db,{now,keys:[jwk]});
      assert.equal(verified,null,JSON.stringify(claim));
    }
    assert.equal(await verifyPilotReviewerIdToken(
      req(await signed(validClaims,{alg:'none',kid:jwk.kid})),
      f.db,{now,keys:[jwk]}),null);
    assert.equal(await verifyPilotReviewerIdToken(
      req(await signed(validClaims,{alg:'RS256',kid:'unknown'})),
      f.db,{now,keys:[jwk]}),null);
    const wrong=await crypto.subtle.generateKey({
      name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
      publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256',
    },true,['sign','verify']);
    assert.equal(await verifyPilotReviewerIdToken(
      req(await signed(validClaims,undefined,wrong.privateKey)),
      f.db,{now,keys:[jwk]}),null);
    f.execute(
      'UPDATE student_pilot_review_admins SET tokens_valid_after=? WHERE firebase_uid=?',
      now-20,reviewer,
    );
    assert.equal(await verifyPilotReviewerIdToken(req(await signed()),f.db,
      {now,keys:[jwk]}),null);
  } finally{f.sqlite.close();}
});

test('signed second Admin can approve a delivered block but never activate user',async()=>{
  const f=fixture();
  try {
    f.enable();
    f.seedLock();
    const requested=await requestPilotUnlockReview(
      f.db,f.readers,uid,ADMIN_UID,{now});
    assert.equal(requested.reviewCreated,true);
    const result=await approvePilotReviewWithSignedAdmin(
      f.db,requested.reviewId,req(await signed()),{now,keys:[jwk]});
    assert.deepEqual(result,{
      approvedForManualReview:true,canEnableNow:false,
      accountStillDisabled:true,mode:'review-only',
    });
    assert.equal(f.get('SELECT active FROM student_auth_identities').active,0);
    assert.equal(f.get('SELECT approved_by FROM student_pilot_unlock_reviews').approved_by,
      reviewer);
    assert.equal((await approvePilotReviewWithSignedAdmin(
      f.db,requested.reviewId,req(await signed()),{now,keys:[jwk]}
    )).approvedForManualReview,false);
  }finally{f.sqlite.close();}
});

test('reviewer revoked between signature check and SQL write cannot approve',async()=>{
  const f=fixture();
  try {
    f.enable();
    f.seedLock();
    const requested=await requestPilotUnlockReview(
      f.db,f.readers,uid,ADMIN_UID,{now});
    f.intercept(()=>{
      f.execute('UPDATE student_pilot_review_admins SET active=0 WHERE firebase_uid=?',
        reviewer);
    });
    const result=await approvePilotReviewWithSignedAdmin(
      f.db,requested.reviewId,req(await signed()),{now,keys:[jwk]});
    assert.equal(result.approvedForManualReview,false);
    assert.equal(f.get('SELECT status FROM student_pilot_unlock_reviews').status,'pending');
  }finally{f.sqlite.close();}
});

test('recent-session revocation between verification and approval blocks SQL update',async()=>{
  const f=fixture();
  try {
    f.enable();
    f.seedLock();
    const requested=await requestPilotUnlockReview(
      f.db,f.readers,uid,ADMIN_UID,{now});
    assert.equal(requested.reviewCreated,true);
    f.intercept(()=>{
      f.execute('UPDATE student_pilot_review_admins SET tokens_valid_after=? '+
        'WHERE firebase_uid=?',now,reviewer);
    });
    const result=await approvePilotReviewWithSignedAdmin(
      f.db,requested.reviewId,req(await signed()),{now,keys:[jwk]});
    assert.equal(result.approvedForManualReview,false);
    assert.equal(f.get('SELECT status FROM student_pilot_unlock_reviews').status,
      'pending');
    assert.equal(f.get('SELECT active FROM student_auth_identities').active,0);
  }finally{f.sqlite.close();}
});

test('the requesting Admin cannot approve own review, even with second role',async()=>{
  const f=fixture();
  try {
    f.enable(ADMIN_UID);
    f.seedLock();
    const created=await requestPilotUnlockReview(
      f.db,f.readers,uid,ADMIN_UID,{now});
    const selfClaims={
      ...validClaims,sub:ADMIN_UID,user_id:ADMIN_UID,
    };
    const r=await approvePilotReviewWithSignedAdmin(
      f.db,created.reviewId,req(await signed(selfClaims)),{now,keys:[jwk]});
    assert.equal(r.approvedForManualReview,false);
    assert.equal(f.get('SELECT status FROM student_pilot_unlock_reviews').status,'pending');
  }finally{f.sqlite.close();}
});

test('empty D1 registry is deny-by-default and cannot insert student UID reviewer',()=>{
  const f=fixture();
  try {
    const entry=f.get('SELECT active,role FROM student_pilot_review_admins');
    assert.equal(entry.active,0);
    assert.equal(entry.role,'unlock_reviewer');
    assert.throws(()=>f.execute(
      "INSERT INTO student_pilot_review_admins "+
      "(firebase_uid,created_at,updated_at) VALUES (?,?,?)",
      'student_'+'c'.repeat(32),now,now,
    ));
  }finally{f.sqlite.close();}
});
