'use strict';

const CACHE_NAME = 'wx-app-v5';
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.svg',
  './icon-512.svg',
];

// ─── Install: precache static assets ──────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// ─── Activate: delete old caches ──────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ─── Fetch: cache-first, network fallback ─────────────────────────────────────
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});

// ─── Notification Scheduling ──────────────────────────────────────────────────
// Note: SW setTimeout is best-effort. For guaranteed background delivery,
// a backend push server (Web Push Protocol) would be needed.
let _rainTimer = null;
let _schedTimer = null;

self.addEventListener('message', event => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'SCHEDULE_NOTIFICATION') {
    clearTimers();
    const { delay, payload } = data;
    if (!delay || delay <= 0) return;
    scheduleTimers(delay, payload);
  }

  if (data.type === 'CANCEL_NOTIFICATION') {
    clearTimers();
  }
});

function clearTimers() {
  if (_rainTimer)   { clearTimeout(_rainTimer);   _rainTimer = null; }
  if (_schedTimer)  { clearTimeout(_schedTimer);  _schedTimer = null; }
}

function scheduleTimers(delay, payload) {
  const { rainProb, schedule, notifRain, notifSchedule } = payload;

  if (notifRain && rainProb >= 30) {
    _rainTimer = setTimeout(() => {
      self.registration.showNotification('今日の天気', {
        body: `🌧 今日は雨の可能性があります（降水確率${rainProb}%）。傘を忘れずに！`,
        icon: './icon-192.svg',
        badge: './icon-192.svg',
        tag: 'wx-rain',
        vibrate: [200, 100, 200],
      });
      // Reschedule for next day
      _rainTimer = setTimeout(
        () => self.registration.showNotification('今日の天気', {
          body: `🌧 今日は雨の可能性があります（降水確率${rainProb}%）。傘を忘れずに！`,
          icon: './icon-192.svg', badge: './icon-192.svg', tag: 'wx-rain',
        }),
        24 * 60 * 60 * 1000
      );
    }, delay);
  }

  if (notifSchedule && schedule && schedule.length > 0) {
    const ev = schedule[0];
    const timeStr = ev.time ? ` ${ev.time}` : '';
    _schedTimer = setTimeout(() => {
      self.registration.showNotification('今日の予定', {
        body: `📅 今日の予定：${ev.title}${timeStr}`,
        icon: './icon-192.svg',
        badge: './icon-192.svg',
        tag: 'wx-schedule',
        vibrate: [200],
      });
      // Reschedule for next day
      _schedTimer = setTimeout(
        () => self.registration.showNotification('今日の予定', {
          body: `📅 今日の予定：${ev.title}${timeStr}`,
          icon: './icon-192.svg', badge: './icon-192.svg', tag: 'wx-schedule',
        }),
        24 * 60 * 60 * 1000
      );
    }, delay);
  }
}

// ─── Notification click: focus or open app ────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(list => {
        const existing = list.find(c => c.url.includes('index.html') && 'focus' in c);
        if (existing) return existing.focus();
        return clients.openWindow('./index.html');
      })
  );
});
