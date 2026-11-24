/* Peachz Haus Studio — Service Worker
 * - App shell: precache แล้วใช้ cache-first (ออฟไลน์ได้)
 * - CDN (Tailwind / Google Fonts): stale-while-revalidate
 * - Gemini API และ request ที่ไม่ใช่ GET: ผ่านเน็ตตรง ๆ ไม่แคช
 * เปลี่ยนเลข VERSION ทุกครั้งที่แก้ไฟล์ เพื่อให้ผู้ใช้ได้เวอร์ชันใหม่
 */
const VERSION = 'v1.6.0';
const SHELL_CACHE = `peachz-shell-${VERSION}`;
const RUNTIME_CACHE = `peachz-runtime-${VERSION}`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/favicon.ico'
];

// ไฟล์จาก CDN ที่ต้องมีตอนออฟไลน์ (โหลดแบบ no-cors จึงเก็บเป็น opaque response)
const CDN_PRECACHE = [
  'https://cdn.tailwindcss.com'
];

const CDN_HOSTS = new Set([
  'cdn.tailwindcss.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
]);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL_ASSETS);

    const runtime = await caches.open(RUNTIME_CACHE);
    await Promise.all(CDN_PRECACHE.map(async (url) => {
      try {
        const res = await fetch(new Request(url, { mode: 'no-cors' }));
        await runtime.put(url, res);
      } catch (e) { /* ไม่มีเน็ตตอนติดตั้ง: จะแคชเองตอนเปิดครั้งถัดไป */ }
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, RUNTIME_CACHE]);
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('peachz-') && !keep.has(k)).map((k) => caches.delete(k)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.disable(); } catch (e) {}
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // ไม่แคช API ใด ๆ (เช่น Gemini ที่มี API key ใน query string)
  if (url.hostname === 'generativelanguage.googleapis.com') return;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // การเปิดหน้า: network-first เพื่อได้ไฟล์ล่าสุดเมื่อออนไลน์ แล้ว fallback เป็นแคช
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok && url.origin === self.location.origin) {
          const cache = await caches.open(SHELL_CACHE);
          cache.put('./index.html', fresh.clone());
        }
        return fresh;
      } catch (e) {
        const cached = await caches.match('./index.html', { ignoreSearch: true });
        return cached || new Response('ออฟไลน์อยู่ และยังไม่มีข้อมูลในแคช', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    })());
    return;
  }

  // ไฟล์ในโดเมนเดียวกัน: cache-first
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const cache = await caches.open(SHELL_CACHE);
          cache.put(req, res.clone());
        }
        return res;
      } catch (e) {
        return Response.error();
      }
    })());
    return;
  }

  // CDN: stale-while-revalidate
  if (CDN_HOSTS.has(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req);
      const network = fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      return cached || (await network) || Response.error();
    })());
  }
});
