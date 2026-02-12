/* Viva Haven PWA Service Worker */

const VERSION = 'v4';
const STATIC_CACHE = `vh-static-${VERSION}`;
const HTML_CACHE = `vh-html-${VERSION}`;
const RUNTIME_CACHE = `vh-runtime-${VERSION}`;
const OFFLINE_URL = '/offline.html';

const PRECACHE_URLS = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/css/styles.css',
  '/js/app.js',
  '/js/app-shell.js',
  '/js/route-guard.js',
  '/js/auth.js',
  '/js/auth-mock.js',
  '/js/icons-sprite.js',
  '/js/a2hs.js',
  '/assets/logo.svg',
  '/assets/icons.svg',
  '/assets/familia.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('vh-') && ![STATIC_CACHE, HTML_CACHE, RUNTIME_CACHE].includes(k))
          .map((k) => caches.delete(k))
      );

      try {
        if (self.registration && self.registration.navigationPreload) {
          await self.registration.navigationPreload.enable();
        }
      } catch (e) {}

      await self.clients.claim();
    })()
  );
});

function isSameOrigin(requestUrl) {
  try {
    return new URL(requestUrl).origin === self.location.origin;
  } catch (e) {
    return false;
  }
}

function isHtmlRequest(request) {
  return request.mode === 'navigate' || request.destination === 'document';
}

function isAssetRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname.toLowerCase();
  const dest = request.destination;

  if (['style', 'script', 'image', 'font'].includes(dest)) return true;

  return (
    pathname.endsWith('.css') ||
    pathname.endsWith('.js') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.jpeg') ||
    pathname.endsWith('.webp') ||
    pathname.endsWith('.ico') ||
    pathname.endsWith('.woff2')
  );
}

async function networkFirst(request) {
  try {
    // Se navigation preload estiver habilitado
    const preload = request.mode === 'navigate' ? await eventPreloadResponseSafe() : null;
    if (preload) {
      if (preload && preload.ok) {
        const cache = await caches.open(HTML_CACHE);
        cache.put(request, preload.clone());
      }
      return preload;
    }

    const response = await fetch(request, { cache: 'no-store' });
    if (response && response.ok) {
      const cache = await caches.open(HTML_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    const cache = await caches.open(HTML_CACHE);
    const cached = await cache.match(request);
    return cached || caches.match(OFFLINE_URL);
  }
}

// Helper para ler preloadResponse sem quebrar em browsers antigos
let _lastFetchEvent = null;
async function eventPreloadResponseSafe() {
  try {
    if (!_lastFetchEvent || typeof _lastFetchEvent.preloadResponse === 'undefined') return null;
    return await _lastFetchEvent.preloadResponse;
  } catch (e) {
    return null;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);

  const fetchPromise = (async () => {
    try {
      const response = await fetch(request);
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    } catch (e) {
      return null;
    }
  })();

  return cached || (await fetchPromise) || caches.match(OFFLINE_URL);
}

self.addEventListener('fetch', (event) => {
  _lastFetchEvent = event;
  const { request } = event;

  // Não intercepta requests que não são do mesmo origin
  if (!isSameOrigin(request.url)) return;

  // Apenas GET
  if (request.method !== 'GET') return;

  if (isHtmlRequest(request)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isAssetRequest(request)) {
    // Assets (css/js/svg/png/etc): cache-first para shell; runtime para demais
    const url = new URL(request.url);
    const path = url.pathname.toLowerCase();

    // Shell assets: stale-while-revalidate para evitar ficar preso em versão antiga
    if (path.startsWith('/css/') || path.startsWith('/js/') || path.startsWith('/assets/') || path.startsWith('/icons/')) {
      event.respondWith(staleWhileRevalidate(request));
      return;
    }

    // Outros assets: SWR
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
});
