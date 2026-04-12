/* ══════════════════════════════════════════════════════
   BDAS Service Worker v2.0
   বাংলাদেশ দুর্যোগ সতর্কতা সিস্টেম
   Developer: Abdullah Al Fahim
   ══════════════════════════════════════════════════════ */

const VERSION    = 'bdas-v2.0';
const APP_CACHE  = 'bdas-app-v2';
const DATA_CACHE = 'bdas-data-v2';

const PRECACHE = [
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@300;400;500;600;700&family=Share+Tech+Mono&family=Exo+2:wght@400;500;600;700;800&display=swap'
];

const API_BASES = [
  'https://api.open-meteo.com/v1/forecast',
  'https://marine-api.open-meteo.com/v1/marine',
  'https://earthquake.usgs.gov/earthquakes/feed'
];

/* ── INSTALL ─────────────────────────────────────────────── */
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(APP_CACHE).then(c =>
      Promise.allSettled(PRECACHE.map(url => c.add(url).catch(() => null)))
    )
  );
});

/* ── ACTIVATE ────────────────────────────────────────────── */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== APP_CACHE && k !== DATA_CACHE)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ── FETCH STRATEGY ──────────────────────────────────────── */
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // API calls → Network-first, cache fallback (5s timeout)
  if (API_BASES.some(base => url.startsWith(base))) {
    e.respondWith(networkFirstWithTimeout(e.request, 8000));
    return;
  }

  // Google Fonts → Cache-first
  if (url.includes('fonts.googleapis') || url.includes('fonts.gstatic')) {
    e.respondWith(cacheFirst(e.request));
    return;
  }

  // App shell → Cache-first, network fallback
  e.respondWith(cacheFirst(e.request));
});

async function networkFirstWithTimeout(request, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(request.clone(), { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const cache = await caches.open(DATA_CACHE);
      cache.put(request, res.clone());
    }
    return res;
  } catch (_) {
    clearTimeout(timer);
    const cached = await caches.match(request);
    return cached || new Response('{"error":"offline"}', {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok) {
      const cache = await caches.open(APP_CACHE);
      cache.put(request, res.clone());
    }
    return res;
  } catch (_) {
    return new Response('Offline', { status: 503 });
  }
}

/* ── PERIODIC BACKGROUND SYNC ────────────────────────────── */
self.addEventListener('periodicsync', e => {
  if (e.tag === 'bdas-refresh') {
    e.waitUntil(backgroundRefresh());
  }
});

async function backgroundRefresh() {
  const urls = [
    'https://api.open-meteo.com/v1/forecast?latitude=23.7104,22.3569,24.3745,22.8456,24.8949,22.7010,25.7439,24.7471&longitude=90.4074,91.7832,88.6016,89.5403,91.8687,90.3533,89.2752,90.4203&current=temperature_2m,apparent_temperature,precipitation,rain,weathercode,windspeed_10m,winddirection_10m,relativehumidity_2m,surface_pressure&timezone=Asia%2FDhaka&forecast_days=1',
    'https://marine-api.open-meteo.com/v1/marine?latitude=21.5&longitude=91.8&current=wave_height,wave_direction,wave_period,wind_wave_height,swell_wave_height&timezone=Asia%2FDhaka',
    'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_month.geojson'
  ];
  const cache = await caches.open(DATA_CACHE);
  await Promise.allSettled(
    urls.map(async url => {
      try {
        const res = await fetch(url);
        if (res.ok) await cache.put(url, res);
      } catch (_) {}
    })
  );
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(c => c.postMessage({ type: 'BG_UPDATED', time: Date.now() }));
}

/* ── PUSH NOTIFICATIONS ──────────────────────────────────── */
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  const title = data.title || '⚠️ বাংলাদেশ দুর্যোগ সতর্কতা';
  const body  = data.body  || 'নতুন সতর্কতা জারি হয়েছে — অ্যাপ খুলুন।';
  const urgency = data.urgency || 'normal';
  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: urgency === 'high' ? [300,100,300,100,300,100,300] : [200,100,200],
      tag: 'bdas-alert-' + Date.now(),
      requireInteraction: urgency === 'high',
      actions: [
        { action: 'open',  title: '📱 বিস্তারিত দেখুন' },
        { action: 'close', title: '✕ বন্ধ করুন' }
      ],
      data: { url: '/index.html' }
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action !== 'close') {
    const target = (e.notification.data && e.notification.data.url) || '/index.html';
    e.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(clients => {
        const focused = clients.find(c => c.url.includes('/index.html') && 'focus' in c);
        return focused ? focused.focus() : self.clients.openWindow(target);
      })
    );
  }
});

/* ── ALERT CHECK MESSAGE HANDLER ─────────────────────────── */
self.addEventListener('message', e => {
  if (e.data?.type === 'CHECK_ALERT') checkWeatherAlert();
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

async function checkWeatherAlert() {
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=23.7104,22.3569,24.3745,22.8456,24.8949,22.7010,25.7439,24.7471&longitude=90.4074,91.7832,88.6016,89.5403,91.8687,90.3533,89.2752,90.4203&current=temperature_2m,precipitation,weathercode,windspeed_10m&timezone=Asia%2FDhaka&forecast_days=1';
    const res  = await fetch(url);
    const data = await res.json();
    const arr  = Array.isArray(data) ? data : [data];
    const storms = arr.filter(d => (d.current?.weathercode || 0) >= 95);
    const highWind = arr.filter(d => (d.current?.windspeed_10m || 0) > 65);
    if (storms.length > 0 || highWind.length > 0) {
      await self.registration.showNotification('⛈️ তীব্র আবহাওয়া সতর্কতা', {
        body: `${storms.length} বিভাগে বজ্রঝড় · ${highWind.length} বিভাগে ঝড়ো বাতাস। নিরাপদ স্থানে থাকুন।`,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        vibrate: [300,100,300,100,300],
        tag: 'bdas-storm',
        requireInteraction: true
      });
    }
  } catch (_) {}
}
