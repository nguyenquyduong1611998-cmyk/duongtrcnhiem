// Phase 5B — real HTTP handler calls with in-memory SQLite + synthetic RSA.
// NO network, real Firebase, Cloudflare D1 or military/internal content.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PROJECT_ID} from '../functions/_shared/auth.mjs';
import {PHASE4_PILOT_PREVIEW_HOST,PHASE4_PINNED_STAGING_HOST}
  from '../functions/_shared/phase4-host-guard.mjs';
import {onRequestGet as listEndpoint}
  from '../functions/api/phase5/topics.js';
import {onRequestGet as detailEndpoint}
  from '../functions/api/phase5/topics/[topicId]/versions/[revision].js';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const NOW=Math.floor(Date.now()/1000);
const PREVIEW='https://'+PHASE4_PILOT_PREVIEW_HOST;
const A='student_'+'a'.repeat(32);
const B='student_'+'b'.repeat(32);
const LOCKED='student_'+'c'.repeat(32);
const UNLISTED='student_'+'d'.repeat(32);
const QUESTION='2 + 2 = ?';
const KID='phase5-inmemory-test-kid';
const keys=await crypto.subtle.generateKey(
  {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256',
    modulusLength:2048,publicExponent:new Uint8Array([1,0,1])},
  true,['sign','verify']
);
const jwk={...(await crypto.subtle.exportKey('jwk',keys.publicKey)),
  kid:KID,use:'sig'};
const encode=obj=>Buffer.from(JSON.stringify(obj)).toString('base64url');
async function token(uid=A,provider='custom',changes={}){
  const header=encode({alg:'RS256',kid:KID,typ:'JWT'});
  const body=encode({
    iss:'https://securetoken.google.com/'+PROJECT_ID,
    aud:PROJECT_ID,sub:uid,user_id:uid,
    iat:NOW,exp:NOW+3600,auth_time:NOW-30,
    firebase:{sign_in_provider:provider},...changes,
  });
  const prefix=header+'.'+body;
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',
    keys.privateKey,new TextEncoder().encode(prefix));
  return prefix+'.'+Buffer.from(sig).toString('base64url');
}
const tokens={
  A:await token(A),B:await token(B),locked:await token(LOCKED),
  unknown:await token(UNLISTED),wrongProject:await token(A,'custom',{aud:'other-project'}),
  wrongProvider:await token(A,'google.com')
};
const savedFetch=globalThis.fetch;
let fetches=0;
globalThis.fetch=async (url,init)=>{
  fetches++;
  assert.equal(url,
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  assert.equal(init?.redirect,'manual');
  return new Response(JSON.stringify({keys:[jwk]}),{status:200,
    headers:{'cache-control':'max-age=30'}});
};

function fixture({withSchema=true}={}){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync('serverless/d1-staging-schema.sql','utf8'));
  if(withSchema){
    sqlite.exec(readFileSync('serverless/d1-phase5-content-model-draft.sql','utf8'));
  }
  const run=(sql,...args)=>sqlite.prepare(sql).run(...args);
  const read=(sql,...args)=>sqlite.prepare(sql).get(...args)??null;
  for(const [idx,uid,active] of [[1,A,1],[2,B,1],[3,LOCKED,0]]){
    run('INSERT INTO demo_students '+
      '(username,firebase_uid,password_salt,password_hash,kdf_iterations,active,created_at)'+
      ' VALUES (?,?,?,?,310000,?,?)',
      'test_hv_p5_'+idx,uid,'synthetic-salt','synthetic-hash',active,NOW);
  }
  if(withSchema){
    const add=(topic,revision,state)=>{
      run('INSERT OR IGNORE INTO phase5_content_topics(topic_id,created_at) VALUES (?,?)',topic,NOW);
      run('INSERT INTO phase5_content_versions '+
        '(topic_id,revision,code,title,description,time_limit_seconds,state,created_at,published_at)'+
        ' VALUES (?,?,?,?,?,600,?,?,?)',
        topic,revision,'P5-DEMO','Synthetic math','Synthetic content only',
        'draft',NOW,null);
      run('INSERT INTO phase5_content_questions '+
        '(topic_id,revision,question_id,order_index,question_text,option_a,option_b,option_c,option_d)'+
        ' VALUES (?,?,?,1,?,?,?,?,?)',
        topic,revision,'q1',QUESTION,'3','4','5','6');
      run('INSERT INTO phase5_content_answer_keys '+
        '(topic_id,revision,question_id,correct_index,explanation) VALUES (?,?,?,?,?)',
        topic,revision,'q1',1,'PRIVATE ANSWER: never return to browser');
      if(state==='published')
        run("UPDATE phase5_content_versions SET state='published',published_at=? WHERE topic_id=? AND revision=?",
          NOW+1,topic,revision);
    };
    add('p5_demo_math',1,'published');
    add('p5_demo_math',2,'draft'); // Unpublished revision must be invisible.
    add('internal_math',1,'published'); // Even published, not DEMO namespace.
  }
  let statements=[];
  const d1={
    prepare(sql){
      statements.push(sql);
      assert.match(sql.trim(),/^SELECT\b/i,'Phase 5B may only SELECT');
      assert.doesNotMatch(sql,/phase5_content_answer_keys/i,'No answer key read');
      return {
        async all(){return {results:sqlite.prepare(sql).all()};},
        bind(...args){
          return {
            async first(){return read(sql,...args);},
            async all(){return {results:sqlite.prepare(sql).all(...args)};},
          };
        },
      };
    },
  };
  const env={
    AUTH_DB:{prepare(){throw new Error('CANONICAL_D1_MUST_NEVER_BE_READ');}},
    AUTH_DB_PREVIEW:d1,
    STAGING_AUTH_ENABLED:'true',FIREBASE_PROJECT_ID:PROJECT_ID,
    FIREBASE_SERVICE_ACCOUNT_EMAIL:'test-signer@'+PROJECT_ID+'.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY:'SYNTHETIC_NEVER_USED_IN_VERIFY',
    PHASE4_STAGING_HOSTNAME:PHASE4_PILOT_PREVIEW_HOST,
    PHASE4_PREVIEW_HOST_OPT_IN:'true',
    PHASE5_READONLY_TOPICS_ENABLED:'true',
  };
  function request(path,secret=tokens.A,{base=PREVIEW,method='GET',
      query='',origin=undefined,spoofHost=false}={}){
    return new Request(base+path+query,{
      method,headers:{
        ...(secret?{authorization:'Bearer '+secret}:{}),
        ...(origin?{origin}:{}),
        ...(spoofHost?{'x-forwarded-host':PHASE4_PILOT_PREVIEW_HOST,
          host:PHASE4_PILOT_PREVIEW_HOST}:{})
      }
    });
  }
  const list=(secret=tokens.A,opts={})=>listEndpoint({
    request:request('/api/phase5/topics',secret,opts),env
  });
  const detail=(secret=tokens.A,topic='p5_demo_math',rev='1',opts={})=>
    detailEndpoint({
      request:request('/api/phase5/topics/'+topic+'/versions/'+rev,secret,opts),
      params:{topicId:topic,revision:rev},env
    });
  return {sqlite,run,read,env,list,detail,request,
    get statements(){return statements;}};
}

test('A and B can read the same published fake topic, never answer key',async()=>{
  const f=fixture();
  try{
    for(const secret of [tokens.A,tokens.B]){
      const list=await f.list(secret);
      assert.equal(list.status,200);
      assert.equal(list.headers.get('cache-control'),'no-store, max-age=0');
      const body=await list.json();
      assert.deepEqual(body.topics.map(t=>[t.topicId,t.revision,t.questionCount]),
        [['p5_demo_math',1,1]]);
      const detail=await f.detail(secret);
      assert.equal(detail.status,200);
      const data=await detail.json();
      assert.equal(data.topic.questions[0].text,QUESTION);
      assert.deepEqual(data.topic.questions[0].options,['3','4','5','6']);
      for(const forbidden of ['correctIndex','correct_index','explanation',
          'answer_keys','PRIVATE ANSWER','student_uid','password','score']){
        assert.equal(JSON.stringify(body).includes(forbidden),false,forbidden);
        assert.equal(JSON.stringify(data).includes(forbidden),false,forbidden);
      }
    }
    assert.equal(f.read('SELECT COUNT(*) AS n FROM phase5_content_attempts').n,0);
    assert.ok(f.statements.some(x=>x.includes('phase5_content_questions')));
    assert.ok(f.statements.every(x=>/^SELECT\b/i.test(x.trim())));
  }finally{f.sqlite.close();}
});

test('draft revision, unpublished topic namespace and invalid identifiers denied',async()=>{
  const f=fixture();
  try{
    const draft=await f.detail(tokens.A,'p5_demo_math','2');
    assert.equal(draft.status,404);
    assert.equal((await draft.json()).error,'NOT_FOUND');
    const nonDemo=await f.detail(tokens.A,'internal_math','1');
    assert.equal(nonDemo.status,400);
    assert.equal((await nonDemo.json()).error,'INVALID_REQUEST');
    for(const revision of ['0','01','1 OR 1=1','999999','-3']){
      const response=await f.detail(tokens.A,'p5_demo_math',revision);
      assert.equal(response.status,400,revision);
    }
    const query=await f.list(tokens.A,{query:'?includeAnswers=true'});
    assert.equal(query.status,400);
    const wrongMethod=await f.list(tokens.A,{method:'POST'});
    assert.equal(wrongMethod.status,405);
  }finally{f.sqlite.close();}
});

test('flag defaults off and exact Preview host + opt-in required before D1 access',async()=>{
  const f=fixture();
  try{
    delete f.env.PHASE5_READONLY_TOPICS_ENABLED;
    let result=await f.list();
    assert.equal(result.status,404);
    assert.equal(f.statements.length,0);
    f.env.PHASE5_READONLY_TOPICS_ENABLED='true';
    f.env.PHASE4_PREVIEW_HOST_OPT_IN='false';
    result=await f.list();
    assert.equal(result.status,404);
    assert.equal(f.statements.length,0);
    f.env.PHASE4_PREVIEW_HOST_OPT_IN='true';
    for(const base of [
      'https://'+PHASE4_PINNED_STAGING_HOST,
      'https://some-other-branch.'+PHASE4_PINNED_STAGING_HOST,
      'https://12345.'+PHASE4_PINNED_STAGING_HOST,
      'https://example.org'
    ]){
      result=await f.list(tokens.A,{base,spoofHost:true});
      assert.equal(result.status,404,base);
    }
    assert.equal(f.statements.length,0);
    const crossed=await f.list(tokens.A,{origin:'https://other-site.example'});
    assert.equal(crossed.status,403);
    assert.equal(f.statements.length,0);
    delete f.env.AUTH_DB_PREVIEW;
    assert.equal((await f.list()).status,503);
    assert.equal(f.statements.length,0);
  }finally{f.sqlite.close();}
});

test('missing/forged/blocked Firebase identity cannot read published content',async()=>{
  const f=fixture();
  try{
    for(const [name,secret] of Object.entries({
      missing:'',unknown:tokens.unknown,locked:tokens.locked,
      wrongProject:tokens.wrongProject,wrongProvider:tokens.wrongProvider,
      malformed:'not.a.token'
    })){
      const r=await f.list(secret);
      assert.equal(r.status,401,name);
    }
    f.run('UPDATE demo_students SET active=0 WHERE firebase_uid=?',A);
    assert.equal((await f.detail()).status,401);
  }finally{f.sqlite.close();}
});

test('missing Phase 5 schema fails safely and creates no tables',async()=>{
  const f=fixture({withSchema:false});
  try{
    const list=await f.list();
    assert.equal(list.status,503);
    assert.deepEqual(await list.json(),{error:'PHASE5_SCHEMA_NOT_READY'});
    const details=await f.detail();
    assert.equal(details.status,503);
    assert.deepEqual(await details.json(),{error:'PHASE5_SCHEMA_NOT_READY'});
    assert.equal(f.read(
      "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='phase5_content_versions'"
    ).n,0);
  }finally{f.sqlite.close();}
});
test.after(()=>{
  globalThis.fetch=savedFetch;
  assert.ok(fetches>=1,'Test should exercise verified JWT public signing key retrieval');
});
