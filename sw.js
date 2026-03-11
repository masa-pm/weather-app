'use strict';

const CACHE_NAME = 'wx-app-v10';
const PRECACHE = [
  './manifest.json',
  './icon-192.svg',
  './icon-512.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  // HTMLはHTTPキャッシュも使わず常にサーバーから取得
  if (url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(url.href, { cache: 'no-store' }).catch(() => caches.match('./index.html'))
    );
    return;
  }
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

// ─── Notification Scheduling ───────────────────────────────────────────────────
let _timer = null;
let _savedPayload = null;

self.addEventListener('message', event => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'SCHEDULE_NOTIFICATION') {
    clearTimer();
    const { delay, payload } = data;
    if (!delay || delay <= 0) return;
    _savedPayload = payload;
    scheduleTimer(delay, payload);
  }

  if (data.type === 'CANCEL_NOTIFICATION') {
    clearTimer();
    _savedPayload = null;
  }
});

// SWが再起動した時に再スケジュール
self.addEventListener('activate', () => {
  // activate後に再スケジュールは不要（クライアントから再送される）
});

function clearTimer() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
}

function scheduleTimer(delay, payload) {
  _timer = setTimeout(() => {
    fireNotifications(payload);
    // 翌日同時刻に再スケジュール
    _timer = setTimeout(
      () => fireNotifications(payload),
      24 * 60 * 60 * 1000
    );
  }, delay);
}

function fireNotifications(payload) {
  const { rainProb, schedule, notifRain, notifSchedule, wxDesc, wxTemp } = payload;

  // 朝のまとめ通知
  if (notifSchedule) {
    let body = `${wxDesc || ''}　${wxTemp || ''}°C`;
    if (schedule && schedule.length > 0) {
      const evTexts = schedule.slice(0, 3).map(e => `${e.time ? e.time + ' ' : ''}${e.title}`).join('、');
      body += `\n📅 ${evTexts}`;
    } else {
      body += '\n📅 今日の予定はありません';
    }
    self.registration.showNotification('今日の天気と予定', {
      body,
      icon: './icon-192.svg',
      badge: './icon-192.svg',
      tag: 'wx-morning',
      vibrate: [200, 100, 200],
    });
  }

  // 雨の通知
  if (notifRain && rainProb >= 30) {
    self.registration.showNotification('☂️ 今日は雨の可能性があります', {
      body: `降水確率${rainProb}%。傘をお忘れなく！`,
      icon: './icon-192.svg',
      badge: './icon-192.svg',
      tag: 'wx-rain',
      vibrate: [200, 100, 200],
    });
  }
}

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
