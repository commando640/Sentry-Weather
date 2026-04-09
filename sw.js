/* ══════════════════════════════════════════════════
   BDAS Service Worker · বাংলাদেশ দুর্যোগ সতর্কতা
   ══════════════════════════════════════════════════ */

const VERSION = 'bdas-v1.2';
const CACHE = 'bdas-cache-v1';
const DATA_CACHE = 'bdas-data-v1';

/* যা ক্যাশ হবে (অফলাইনে কাজ করবে) */
const PRECACHE = [
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap'
];

/* API গুলো যা পর্যায়ক্রমে আপডেট হবে */
const API_URLS = [
  'https://api.open-meteo.com/v1/forecast?latitude=23.71,22.36,24.89,22.85,24.37,22.70,25.74,24.75&longitude=90.41,91.78,91.87,89.54,88.60,90.35,89.28,90.42&current=temperature_2m,precipitation,windspeed_10m,winddirection_10m,weathercode,relativehumidity_2m&timezone=Asia%2FDhaka',
  'https://marine-api.open-meteo.com/v1/marine?latitude=21.5&longitude=91.8&current=wave_height,wave_direction,wave_period,wind_wave_height,swell_wave_height&timezone=Asia%2FDhaka',
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_month.geojson'
];

/* ── INSTALL ─────────────────────────────────────── */
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => {
      return Promise.allSettled(
        PRECACHE.map(url => c.add(url).catch(() => {}))
      );
    })
  );
});

/* ── ACTIVATE ────────────────────────────────────── */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE && k !== DATA_CACHE)
            .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── FETCH STRATEGY ──────────────────────────────── */
self.addEventListener('fetch', e => {
  const url = e.request.url;

  /* API calls → Network first, cache fallback */
  if (API_URLS.some(api => url.startsWith(api.split('?')[0]))) {
    e.respondWith(
      fetch(e.request.clone())
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(DATA_CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  /* Google Fonts → Cache first */
  if (url.includes('fonts.googleapis') || url.includes('fonts.gstatic')) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
    return;
  }

  /* App shell → Cache first, network fallback */
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

/* ── BACKGROUND SYNC (পর্যায়ক্রমে ডেটা আপডেট) ──── */
self.addEventListener('periodicsync', e => {
  if (e.tag === 'bdas-refresh') {
    e.waitUntil(backgroundRefresh());
  }
});

async function backgroundRefresh() {
  const cache = await caches.open(DATA_CACHE);
  for (const url of API_URLS) {
    try {
      const res = await fetch(url);
      if (res.ok) await cache.put(url, res);
    } catch (_) {}
  }
  /* ক্লায়েন্টদের জানাও */
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(c => c.postMessage({ type: 'BG_UPDATED', time: Date.now() }));
}

/* ── PUSH NOTIFICATION ───────────────────────────── */
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  const title = data.title || '⚠️ দুর্যোগ সতর্কতা';
  const body  = data.body  || 'নতুন সতর্কতা জারি হয়েছে';
  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [200, 100, 200, 100, 200],
      tag: 'bdas-alert',
      requireInteraction: true,
      actions: [
        { action: 'open', title: 'বিস্তারিত দেখুন' },
        { action: 'close', title: 'বন্ধ করুন' }
      ]
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'open' || !e.action) {
    e.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(clients => {
        if (clients.length) return clients[0].focus();
        return self.clients.openWindow('/index.html');
      })
    );
  }
});

/* ── WEATHER ALERT CHECK (প্রতি ১০ মিনিটে) ─────── */
self.addEventListener('message', e => {
  if (e.data?.type === 'CHECK_ALERT') checkWeatherAlert();
});

async function checkWeatherAlert() {
  try {
    const url = API_URLS[0];
    const res = await fetch(url);
    const data = await res.json();
    const arr = Array.isArray(data) ? data : [data];
    const extremeCodes = arr.filter(d => (d.current?.weathercode || 0) >= 95);
    if (extremeCodes.length > 0) {
      await self.registration.showNotification('⛈️ তীব্র বজ্রঝড় সতর্কতা', {
        body: `${extremeCodes.length}টি বিভাগে তীব্র বজ্রঝড় চলছে। নিরাপদ স্থানে থাকুন।`,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        vibrate: [300, 100, 300, 100, 300],
        tag: 'bdas-storm',
        requireInteraction: true
      });
    }
  } catch (_) {}
}
