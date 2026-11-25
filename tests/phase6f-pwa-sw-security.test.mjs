// Phase 6F: service worker security tests run inside a local VM only.
// No browser registration, Cloudflare access, network or real cache storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const script=readFileSync('public/phase6f-preview-sw.js','utf8');
const origin='https://feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev';
function harness(){
  const listeners=new Map();
  const stored=new Map();
  const cacheOps=[];
  const network=[];
  const scope={
    URL,Promise,
    self:{
      location:{origin},
      addEventListener:(name,handler)=>listeners.set(name,handler),
      skipWaiting:async()=>{},
      clients:{claim:async()=>{}},
    },
    caches:{
      keys:async()=>Array.from(stored.keys()),
      delete:async key=>stored.delete(key),
      open:async key=>{
        if(!stored.has(key))stored.set(key,new Map());
        const cache=stored.get(key);
        return {
          match:async req=>cache.get(req.url),
          put:async(req,reply)=>{
            cacheOps.push(req.url);
            cache.set(req.url,reply);
          },
        };
      },
    },
    fetch:async req=>{
      network.push(req.url);
      const url=new URL(req.url);
      return {
        ok:true,status:200,type:'basic',
        headers:{get:name=>name==='cache-control'?'public, max-age=31536000, immutable':null},
        clone(){return this;},
        url:url.href,
      };
    },
  };
  runInNewContext(script,scope,{timeout:2000});
  const eventFor=(path,overrides={})=>{
    let response;
    let waited;
    const url=path.startsWith('http')?path:origin+path;
    const request={
      method:'GET',mode:'cors',cache:'default',url,
      headers:{has:()=>false},
      ...overrides,
    };
    listeners.get('fetch')({
      request,respondWith:promise=>{response=promise;},
    });
    return response;
  };
  const lifecycle=(name)=>new Promise((resolve,reject)=>{
    listeners.get(name)({
      waitUntil:promise=>Promise.resolve(promise).then(resolve,reject),
    });
  });
  return {eventFor,network,cacheOps,lifecycle,stored};
}

test('Phase6F SW never intercepts exams, API results, POST, auth or navigation',()=>{
  const h=harness();
  const paths=[
    '/api/phase6/exam','/api/phase6/results/student',
    '/api/phase6/results/admin','/api/phase5/attempts/student',
    '/__/auth/firebase','/','/index.html',
    '/phase6f-preview.webmanifest','/phase6f-preview-icon.svg',
    '/assets/index.js','/src/assets/personal.png',
    'https://fonts.googleapis.com/assets/index-abcdef123.js',
  ];
  for(const path of paths)
    assert.equal(h.eventFor(path),undefined,path);
  for(const overrides of [
    {method:'POST'},
    {mode:'navigate'},
    {headers:{has:key=>key==='authorization'}},
    {headers:{has:key=>key==='cookie'}},
    {cache:'no-store'},
  ]){
    assert.equal(h.eventFor('/assets/index-abcdef123.js',overrides),
      undefined,JSON.stringify({...overrides,headers:undefined}));
  }
  assert.equal(h.network.length,0);
  assert.equal(h.cacheOps.length,0);
});

test('SW only caches immutable, public hashed assets and keeps response unchanged',async()=>{
  const h=harness();
  const path='/assets/index-abcdef1234.js';
  const first=h.eventFor(path);
  assert.ok(first,'only hashed assets are intercepted');
  const networkReply=await first;
  assert.equal(networkReply.url,origin+path);
  assert.equal(h.network.length,1);
  assert.equal(h.cacheOps.length,1);
  const second=await h.eventFor(path);
  assert.equal(second,networkReply);
  assert.equal(h.network.length,1,'repeat asset is cache-first');
  assert.equal(h.eventFor('/assets/index.js'),undefined);
  assert.equal(h.eventFor('/api/phase6/results/admin'),undefined);
  await h.lifecycle('install');
  await h.lifecycle('activate');
  assert.equal(h.stored.size,1);
});

test('manifest declares installable shell but SW never provides fake offline exams',()=>{
  const manifest=JSON.parse(readFileSync('public/phase6f-preview.webmanifest','utf8'));
  assert.equal(manifest.display,'standalone');
  assert.equal(manifest.start_url,'/');
  assert.equal(manifest.scope,'/');
  assert.match(manifest.name,/DEMO/);
  assert.ok(manifest.icons.some(icon=>
    icon.src==='/phase6f-preview-icon.svg'&&
    icon.type==='image/svg+xml'&&icon.sizes==='any'));
  assert.doesNotMatch(script,/addEventListener\s*\(\s*['"]message|new Response\s*\(/);
  assert.doesNotMatch(script,/caches\s*\.\s*open\s*\(\s*['"](?:api|answers|grades)/);
  assert.doesNotMatch(script,/localStorage|indexedDB|Bearer|firebase_uid|answers_json/i);
});
