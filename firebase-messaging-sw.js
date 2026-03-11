'use strict';

importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDZhSzqZ4pt6HZ3PeEzeYo-kd_3wh6m7Eo',
  authDomain: 'my-weather-app-77971.firebaseapp.com',
  projectId: 'my-weather-app-77971',
  storageBucket: 'my-weather-app-77971.firebasestorage.app',
  messagingSenderId: '896788626272',
  appId: '1:896788626272:web:af4c8a6eca51a036d7fc05',
});

const _fcmMessaging = firebase.messaging();

_fcmMessaging.onBackgroundMessage(payload => {
  const d = payload.data || {};
  const rainProb      = parseInt(d.rainProb || '0', 10);
  const schedule      = JSON.parse(d.schedule || '[]');
  const notifRain     = d.notifRain     === 'true';
  const notifSchedule = d.notifSchedule === 'true';
  const wxDesc        = d.wxDesc  || '';
  const wxTemp        = d.wxTemp  || '';

  if (notifSchedule) {
    let body = `${wxDesc}　${wxTemp}°C`;
    if (schedule.length > 0) {
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

  if (notifRain && rainProb >= 30) {
    self.registration.showNotification('☂️ 今日は雨の可能性があります', {
      body: `降水確率${rainProb}%。傘をお忘れなく！`,
      icon: './icon-192.svg',
      badge: './icon-192.svg',
      tag: 'wx-rain',
      vibrate: [200, 100, 200],
    });
  }
});
