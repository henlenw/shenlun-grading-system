// Cache only a generic offline document. Never cache authenticated pages, answers, files or API responses.
const CACHE='kaoba-shell-v1';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.add('/offline.html')));self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('kaoba-shell-')&&k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',event=>{
 if(event.request.mode==='navigate'&&event.request.method==='GET'){event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html')))}
});
