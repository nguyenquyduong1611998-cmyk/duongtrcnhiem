// Phase 6F PREVIEW-ONLY service worker.
// This worker MUST NEVER serve authenticated HTML, API replies, Firebase
// tokens, profile data, student answers, grades, exam submissions or D1 data
// from cache. Offline exams are NOT allowed. Fail with network error offline.
const CACHE_NAME='phase6f-preview-immutable-assets-v1';
const CACHE_PREFIX='phase6f-preview-immutable-assets-';
const IMMUTABLE_ASSET=/^\/assets\/[A-Za-z0-9_./-]+-[A-Za-z0-9_-]{8,}\.(?:js|css|svg|png|webp|avif|woff2?)$/;

self.addEventListener('install',event=>{
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(name=>
      name.startsWith(CACHE_PREFIX)&&name!==CACHE_NAME
    ).map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET'||request.mode==='navigate'||
     request.headers.has('authorization')||
     request.headers.has('cookie')||
     request.cache==='no-store')
    return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin||
     url.pathname.startsWith('/api/')||
     url.pathname.startsWith('/__/auth/')||
     !IMMUTABLE_ASSET.test(url.pathname))
    return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE_NAME);
    const saved=await cache.match(request);
    if(saved)return saved;
    const reply=await fetch(request);
    if(reply.ok&&reply.status===200&&reply.type==='basic'&&
       !/(?:no-store|private)/i.test(reply.headers.get('cache-control')||'')){
      try{await cache.put(request,reply.clone());}
      catch{/* Cache quota errors never alter the network response. */}
    }
    return reply;
  })());
});
