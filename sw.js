/* =============================================================================
 * مصروفي — sw.js   (Service Worker بلا أي مكتبة خارجية)
 * -----------------------------------------------------------------------------
 * كيف يُحدَّث الكاش؟ (مهم)
 *   1) عندما تُطلق نسخة جديدة من التطبيق: غيّر رقم الإصدار في `C.VERSION`
 *      داخل assets/js/constants.js، ثم غيّر هنا `CACHE` (والثابت `APP_VERSION`)
 *      إلى نفس الرقم — مثال: 'masrofi-v1.0.1'.
 *   2) تغيير الاسم يجعل المتصفح: يثبّت كاشاً جديداً في install، ويحذف كل
 *      الكاشات القديمة في activate، ثم يستلم الصفحات فوراً عبر clients.claim.
 *   3) لا تُعِد استخدام اسم كاش قديم مع محتوى جديد، وإلا بقي المستخدم على
 *      نسخة قديمة (stale-while-revalidate للـ assets).
 * -----------------------------------------------------------------------------
 * الاستراتيجية:
 *   • install  : تخزين مسبق لقائمة صريحة (بلا glob) بـ Promise.allSettled حتى
 *                لا يفشل التثبيت لو غاب ملف، ثم skipWaiting.
 *   • activate : حذف الكاشات القديمة + clients.claim.
 *   • fetch    : GET فقط + نفس الأصل فقط (DeepSeek وأي أصل خارجي → شبكة مباشرة).
 *                - assets/       → stale-while-revalidate
 *                - app shell     → network-first مع رجوع للكاش، و index.html
 *                                  للطلبات التنقّلية عند الفشل.
 *                - أي طلب فيه Authorization → لا يُخزَّن ولا يُتدخَّل فيه.
 * ========================================================================== */

'use strict';

/* ⚠️ حدّث هذا السطر مع C.VERSION في assets/js/constants.js عند كل إصدار */
const APP_VERSION = '1.0.0';
const CACHE = 'masrofi-v1.1.1';

/* قائمة التخزين المسبق — مكتوبة صراحةً (بدون glob) لتطابق ملفات المشروع فعلياً */
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/theme.css',
  './assets/css/app.css',
  './assets/css/domains.css',
  './assets/css/lock.css',
  './assets/js/constants.js',
  './assets/js/icons.js',
  './assets/js/util.js',
  './assets/js/finance.js',
  './assets/js/store.js',
  './assets/js/ui.js',
  './assets/js/vault.js',
  './assets/js/agent.js',
  './assets/js/app.js',
  './assets/js/views/lock.js',
  './assets/js/views/dashboard.js',
  './assets/js/views/expenses.js',
  './assets/js/views/income.js',
  './assets/js/views/accounts.js',
  './assets/js/views/reports.js',
  './assets/js/views/domains.js',
  './assets/js/views/settings.js',
  './assets/js/views/agent.js',
  './assets/img/icon-192.png',
  './assets/img/icon-512.png',
  './assets/img/icon-maskable-192.png',
  './assets/img/icon-maskable-512.png',
  './assets/img/apple-touch-icon.png',
  './assets/img/favicon-32.png',
  './assets/img/favicon.ico'
];

/* مسارات مطلقة محسوبة من نطاق الـ Service Worker:
   تعمل تحت https://user.github.io/repo/ وتحت دومين مخصص بلا أي تعديل. */
const BASE = new URL('./', self.location.href);
const SHELL_URL = new URL('./index.html', BASE).href;
const SW_URL = new URL('./sw.js', BASE).href;
const abs = (p) => new URL(p, BASE).href;

/* ------------------------------------------------------------------ install */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const urls = PRECACHE.map(abs);
    const results = await Promise.allSettled(
      urls.map((url) => cache.add(new Request(url, { cache: 'reload' })))
    );
    const missing = [];
    results.forEach((r, i) => { if (r.status === 'rejected') missing.push(PRECACHE[i]); });
    if (missing.length) {
      console.warn('[مصروفي sw] ملفات لم تُخزَّن مسبقاً (تجاهلناها): ' + missing.join(', '));
    }
    await self.skipWaiting();
  })());
});

/* ----------------------------------------------------------------- activate */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => (key === CACHE ? Promise.resolve(false) : caches.delete(key))));
    await self.clients.claim();
  })());
});

/* -------------------------------------------------------------------- أدوات */
function offlineResponse(isDocument) {
  if (isDocument) {
    const html = '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>مصروفي — بلا اتصال</title></head>' +
      '<body style="margin:0;min-height:100vh;display:grid;place-items:center;text-align:center;' +
      'background:#0b1020;color:#e8ecf6;font-family:system-ui,-apple-system,Segoe UI,Tahoma,sans-serif">' +
      '<div style="padding:24px"><h1 style="margin:0 0 8px">مصروفي</h1>' +
      '<p style="color:#9fb0d0;margin:0 0 6px">هذه الصفحة ليست محفوظة أوفلاين بعد.</p>' +
      '<p style="color:#9fb0d0;margin:0">اتصل بالإنترنت مرة واحدة ثم أعد الفتح، أو افتح التطبيق من الشاشة الرئيسية.</p>' +
      '</div></body></html>';
    return new Response(html, {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
  return new Response('', { status: 504, statusText: 'Offline' });
}

/** يخزّن الرد فقط إن كان رداً أساسياً ناجحاً (لا opaqueredirect ولا 206 ولا أخطاء). */
function putInCache(req, res) {
  try {
    if (!res || !res.ok || res.status === 206) return;
    if (res.type === 'opaqueredirect' || res.type === 'opaque') return;
    caches.open(CACHE)
      .then((cache) => cache.put(req, res))
      .catch(() => { /* التخزين غير حرج — لا نُفشل الطلب */ });
  } catch (e) { /* تجاهل */ }
}

/** بحث في الكاش: مطابقة تامة ثم مطابقة بلا query. */
async function matchAny(req) {
  const cache = await caches.open(CACHE);
  return (await cache.match(req)) || (await cache.match(req, { ignoreSearch: true })) || null;
}

/** شبكة أولاً، ثم الكاش، ثم (للتنقّل) هيكل التطبيق، ثم صفحة بلا اتصال. */
async function networkFirst(req) {
  const isNavigate = req.mode === 'navigate';
  try {
    const res = await fetch(req);
    if (res && res.ok) putInCache(req, res.clone());
    return res;
  } catch (e) {
    const cached = await matchAny(req);
    if (cached) return cached;
    if (isNavigate) {
      const shell = await matchAny(new Request(SHELL_URL));
      if (shell) return shell;
    }
    return offlineResponse(isNavigate);
  }
}

/** ملفات ثابتة: الكاش فوراً + تحديث في الخلفية. */
function staleWhileRevalidate(event) {
  const req = event.request;
  const revalidate = fetch(req).then((res) => {
    if (res && res.ok) putInCache(req, res.clone());
    return res;
  });
  /* نُبقي التحديث حياً حتى لا يقتله المتصفح بعد انتهاء الحدث */
  event.waitUntil(revalidate.catch(() => {}));
  event.respondWith((async () => {
    const cached = await matchAny(req);
    if (cached) return cached;
    try {
      return await revalidate;
    } catch (e) {
      return offlineResponse(false);
    }
  })());
}

/* -------------------------------------------------------------------- fetch */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  /* 1) غير GET → لا نتدخّل */
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  /* 2) أي أصل خارجي (مثل api.deepseek.com) → شبكة مباشرة بلا وسيط */
  if (url.origin !== self.location.origin) return;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  /* 3) طلبات API/مصادقة → لا كاش أبداً */
  if (req.headers.has('authorization')) return;

  /* 4) لا نتدخّل في sw.js نفسه */
  if (url.href === SW_URL) return;

  /* 5) الملفات الثابتة */
  if (url.pathname.indexOf('/assets/') !== -1) {
    staleWhileRevalidate(event);
    return;
  }

  /* 6) ما تبقّى من نفس الأصل (الصفحة/الهيكل/تنقّل) */
  event.respondWith(networkFirst(req));
});

/* ------------------------------------------------------------------ رسائل */
self.addEventListener('message', (event) => {
  const data = event.data;
  if (data === 'SKIP_WAITING' || (data && data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  } else if (data && data.type === 'VERSION') {
    const reply = { type: 'VERSION', version: APP_VERSION, cache: CACHE };
    if (event.ports && event.ports[0]) event.ports[0].postMessage(reply);
    else if (event.source && event.source.postMessage) event.source.postMessage(reply);
  }
});
