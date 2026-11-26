// Phase 7F: PWA offline/account-switch checks in Node VM only.
// No browser registration, devices, Cloudflare, Firebase or network traffic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {readFileSync} from 'node:fs';

const SOURCE=readFileSync('public/phase6f-preview-sw.js','utf8');
const ORIGIN='https://feature-staging-demo-quiz-pi.duongtrcnhiem-test.pages.dev';
function sandbox(){
  const listeners=new Map(),cachesStore=new Map(),puts=[];
  let offline=false,networkCalls=0;
  const ctx={
    URL,Promise,
    self:{
      location:{origin:ORIGIN},
      addEventListener:(type,fn)=>listeners.set(type,fn),
      skipWaiting:async()=>{},
      clients:{claim:async()=>{}},
    },
    caches:{
      keys:async()=>[...cachesStore.keys()],
      delete:async name=>cachesStore.delete(name),
      open:async name=>{
        if(!cachesStore.has(name))cachesStore.set(name,new Map());
        const cache=cachesStore.get(name);
        return {
          match:async request=>cache.get(request.url),
          put:async(request,response)=>{
            puts.push({url:request.url,body:response.body});
            cache.set(request.url,response);
          },
        };
      },
    },
    fetch:async request=>{
      networkCalls++;
      if(offline)throw new Error('OFFLINE_ASSET_FETCH_FAILED');
      const url=new URL(request.url);
      const privateResponse=url.pathname.includes('do-not-cache-private');
      return {
        ok:true,status:200,type:'basic',
        body:privateResponse?'SYNTHETIC_PRIVATE_RESULT':'STATIC_HASHED_ASSET',
        headers:{get:()=>privateResponse
          ?'private, no-store':'public,max-age=31536000,immutable'},
        clone(){return this;},
      };
    },
  };
  runInNewContext(SOURCE,ctx,{timeout:2000});
  function dispatch(path,{method='GET',mode='cors',authorization=false,
    cookie=false,cache='default'}={}){
    let owned;
    const request={
      url:path.startsWith('https://')?path:ORIGIN+path,
      method,mode,cache,
      headers:{has:key=>(key==='authorization'&&authorization)||
        (key==='cookie'&&cookie)},
    };
    listeners.get('fetch')({
      request,respondWith:promise=>{owned=promise;},
    });
    return owned;
  }
  async function activate(){
    await new Promise((resolve,reject)=>listeners.get('activate')({
      waitUntil:promise=>Promise.resolve(promise).then(resolve,reject),
    }));
  }
  return {
    dispatch,activate,puts,cachesStore,
    setOffline:v=>{offline=v;},
    networkCalls:()=>networkCalls,
  };
}
test('offline A→B switch never serves an authenticated exam/grade/HTML from SW',async()=>{
  const sw=sandbox();
  const privateCalls=[
    ['/api/phase6/exam',{method:'POST',authorization:true}],
    ['/api/phase6/exam',{method:'GET'}],
    ['/api/phase6/results/student',{method:'POST',authorization:true}],
    ['/api/phase6/results/admin',{method:'POST',cookie:true}],
    ['/api/phase5/attempts/student',{method:'POST'}],
    ['/__/auth/handler',{method:'GET'}],
    ['/',{mode:'navigate'}],
    ['/index.html',{mode:'navigate'}],
    ['/phase6f-preview.webmanifest',{}],
  ];
  for(const [path,options] of privateCalls)
    assert.equal(sw.dispatch(path,options),undefined,path);
  const asset='/assets/index-abcDEF1234.js';
  const response=await sw.dispatch(asset);
  assert.equal(response.body,'STATIC_HASHED_ASSET');
  assert.equal(sw.puts.length,1);
  sw.setOffline(true);
  // A logs out; B logs in using a distinct Firebase JWT, but SW is the same.
  for(const [path,options] of privateCalls)
    assert.equal(sw.dispatch(path,options),undefined,path);
  assert.equal(sw.dispatch(asset,{authorization:true}),undefined);
  assert.equal(sw.dispatch(asset,{cookie:true}),undefined);
  assert.equal(sw.dispatch(asset,{cache:'no-store'}),undefined);
  const reused=await sw.dispatch(asset);
  assert.equal(reused.body,'STATIC_HASHED_ASSET',
    'Only safe hashed public assets can survive an offline account change');
  assert.equal(sw.puts.length,1);
  assert.equal(sw.cachesStore.size,1);
  assert.equal(sw.networkCalls(),1);
  const cachedContent=JSON.stringify([...sw.cachesStore.values()].map(x=>
    [...x.entries()].map(([key,value])=>[key,value.body])));
  for(const forbidden of ['/api/','Bearer','student_uid','answers_json',
    'score_tenths','SYNTHETIC_PRIVATE_RESULT']){
    assert.equal(cachedContent.includes(forbidden),false,forbidden);
  }
});
test('private HTTP cache controls cannot cause even hash-named assets to be cached',async()=>{
  const sw=sandbox();
  const privateAsset='/assets/do-not-cache-private-abcDEF1234.js';
  const first=await sw.dispatch(privateAsset);
  assert.equal(first.body,'SYNTHETIC_PRIVATE_RESULT');
  assert.equal(sw.puts.length,0);
  sw.setOffline(true);
  await assert.rejects(sw.dispatch(privateAsset),/OFFLINE_ASSET_FETCH_FAILED/);
  assert.equal(sw.puts.length,0);
});
test('only valid hashed immutable same-origin GET assets are intercepted',async()=>{
  const sw=sandbox();
  for(const path of [
    '/assets/unversioned.js',
    '/assets/not-hashed.js',
    '/assets/runtime-abcdef1234.json',
    '/assets/secret-abcdef1234.html',
    '/assets/index-abcDEF1234.js?token=PRIVATE_TOKEN_SHOULD_NOT_CACHE',
    '/assets/index-abcDEF1234.js?score=10',
    'https://outside.example/assets/index-abcDEF1234.js',
  ]){
    assert.equal(sw.dispatch(path),undefined,path);
  }
  assert.equal(sw.networkCalls(),0);
  assert.equal(sw.puts.length,0);
});
test('activation purges older public SW cache entries, never restores API state',async()=>{
  const sw=sandbox();
  sw.cachesStore.set('phase6f-preview-immutable-assets-v1',new Map());
  sw.cachesStore.set('phase6f-preview-immutable-assets-old',new Map());
  sw.cachesStore.set('unrelated-cache',new Map());
  await sw.activate();
  assert.equal(sw.cachesStore.has('phase6f-preview-immutable-assets-old'),false);
  assert.equal(sw.cachesStore.has('phase6f-preview-immutable-assets-v1'),false);
  assert.equal(sw.cachesStore.has('unrelated-cache'),true);
  assert.equal(sw.networkCalls(),0);
});
