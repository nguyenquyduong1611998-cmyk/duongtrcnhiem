// Phase 6F PREVIEW-ONLY service worker.
// This worker MUST NEVER serve authenticated HTML, API replies, Firebase
// tokens, profile data, student answers, grades, exam submissions or D1 data
// from cache. Offline exams are NOT allowed. Fail with network error offline.
const CACHE_NAME='phase6f-preview-immutable-assets-v2';
const CACHE_PREFIX='phase6f-preview-immutable-assets-';
const IMMUTABLE_ASSET=/^\/assets\/[A-Za-z0-9_./-]+-[A-Za-z0-9_-]{8,}\.(?:js|css|svg|png|webp|avif|woff2?)$/;

// Static, identity-free notice. Constructed only on failed navigation fetch.
// Never cache navigation, authenticated HTML, exam data or credentials.
const OFFLINE_NOTICE=`<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>Tiểu đoàn 3 — Ngoại tuyến</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f6f4;color:#193b2b;font:16px/1.55 system-ui,-apple-system,sans-serif;padding:24px}
main{width:min(100%,430px);background:#fff;border:1px solid #dde3dc;border-radius:16px;padding:30px 24px;text-align:center}
h1{font-size:1.5rem;margin:0 0 10px}p{margin:10px 0;color:#44574a}.brand{font-weight:800;letter-spacing:.08em;color:#1f4d36;font-size:.9rem;margin-bottom:20px}
</style>
</head>
<body><main><div class="brand">TIỂU ĐOÀN 3 — DEMO</div>
<h1>Bạn đang ngoại tuyến</h1>
<p>Hãy bật Wi-Fi hoặc dữ liệu di động, sau đó mở lại ứng dụng để tiếp tục.</p>
<p>Không thể làm bài, nộp bài hoặc xem điểm khi mất kết nối.</p>
</main></body></html>`;

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
  // Exact root only: iOS standalone PWA may open without connectivity.
  // Always try the network; only a thrown network error yields static text.
  // Even navigation carrying Access cookies must never be cached.
  if(request.mode==='navigate'){
    const target=new URL(request.url);
    if(request.method!=='GET'||target.origin!==self.location.origin||
       target.pathname!=='/'||target.search)return;
    event.respondWith((async()=>{
      try{
        return await fetch(request,{cache:'no-store'});
      }catch{
        return new Response(OFFLINE_NOTICE,{
          status:503,
          headers:{
            'content-type':'text/html; charset=utf-8',
            'cache-control':'no-store, max-age=0',
            'x-content-type-options':'nosniff',
            'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
          },
        });
      }
    })());
    return;
  }
  if(request.method!=='GET'||request.mode==='navigate'||
     request.headers.has('authorization')||
     request.headers.has('cookie')||
     request.cache==='no-store')
    return;
  const url=new URL(request.url);
  // Even a hash-named static asset must not cache query parameters:
  // query strings may carry session data and are not immutable asset IDs.
  if(url.origin!==self.location.origin||url.search||
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
