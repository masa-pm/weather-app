#!/usr/bin/env node
/**
 * send-notify.mjs
 * GitHub Actions から毎朝 JST 7:00 に実行される通知送信スクリプト。
 * Firestore からユーザー設定・PushSubscription・今日の予定を取得し、
 * JMA API で天気を取得して Web Push を送信する。
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore }        from 'firebase-admin/firestore';
import webpush                 from 'web-push';

// ─── Firebase Admin 初期化 ─────────────────────────────────────────────────────
const serviceAccount = {
  type: 'service_account',
  project_id:   process.env.FIREBASE_PROJECT_ID,
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  private_key:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
};

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ─── VAPID 設定 ───────────────────────────────────────────────────────────────
webpush.setVapidDetails(
  'mailto:example@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
);

// ─── JMA 都道府県テーブル [緯度, 経度, コード, 名称] ──────────────────────────
const JMA_PREFS = [
  [43.06, 141.35, '016000', '北海道'],  [40.82, 140.74, '020000', '青森県'],
  [39.70, 141.13, '030000', '岩手県'],  [38.27, 140.87, '040000', '宮城県'],
  [39.72, 140.10, '050000', '秋田県'],  [38.24, 140.36, '060000', '山形県'],
  [37.75, 140.47, '070000', '福島県'],  [36.34, 140.45, '080000', '茨城県'],
  [36.57, 139.88, '090000', '栃木県'],  [36.39, 139.06, '100000', '群馬県'],
  [35.86, 139.65, '110000', '埼玉県'],  [35.61, 140.12, '120000', '千葉県'],
  [35.69, 139.69, '130000', '東京都'],  [35.45, 139.64, '140000', '神奈川県'],
  [37.90, 139.02, '150000', '新潟県'],  [36.70, 137.21, '160000', '富山県'],
  [36.59, 136.63, '170000', '石川県'],  [36.06, 136.22, '180000', '福井県'],
  [35.66, 138.57, '190000', '山梨県'],  [36.65, 138.18, '200000', '長野県'],
  [35.39, 136.72, '210000', '岐阜県'],  [34.97, 138.38, '220000', '静岡県'],
  [35.18, 136.91, '230000', '愛知県'],  [34.73, 136.51, '240000', '三重県'],
  [35.00, 135.87, '250000', '滋賀県'],  [35.02, 135.76, '260000', '京都府'],
  [34.69, 135.50, '270000', '大阪府'],  [34.69, 135.18, '280000', '兵庫県'],
  [34.69, 135.83, '290000', '奈良県'],  [34.23, 135.17, '300000', '和歌山県'],
  [35.50, 134.24, '310000', '鳥取県'],  [35.47, 133.05, '320000', '島根県'],
  [34.66, 133.93, '330000', '岡山県'],  [34.40, 132.46, '340000', '広島県'],
  [34.19, 131.47, '350000', '山口県'],  [34.07, 134.56, '360000', '徳島県'],
  [34.34, 134.04, '370000', '香川県'],  [33.84, 132.77, '380000', '愛媛県'],
  [33.56, 133.53, '390000', '高知県'],  [33.61, 130.42, '400000', '福岡県'],
  [33.25, 130.30, '410000', '佐賀県'],  [32.74, 129.87, '420000', '長崎県'],
  [32.79, 130.74, '430000', '熊本県'],  [33.24, 131.61, '440000', '大分県'],
  [31.91, 131.42, '450000', '宮崎県'],  [31.56, 130.56, '460100', '鹿児島県'],
  [26.21, 127.68, '471000', '沖縄県'],
];

function getNearestPref(lat, lon) {
  let best = JMA_PREFS[0], bestD = Infinity;
  for (const p of JMA_PREFS) {
    const d = (lat - p[0]) ** 2 + (lon - p[1]) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  return { code: best[2], name: best[3] };
}

// ─── JMA から今日の天気予報を取得 ────────────────────────────────────────────
async function fetchWeather(lat, lon) {
  const pref = getNearestPref(lat, lon);
  const url  = `https://www.jma.go.jp/bosai/forecast/data/forecast/${pref.code}.json`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`JMA fetch failed: ${res.status}`);
  const fc   = await res.json();

  const today = fc[0]?.timeSeries?.[0];
  const wxDesc = today?.areas?.[0]?.weathers?.[0] || '';

  let rainProb = 0;
  try {
    const popSeries = fc[0]?.timeSeries?.find(ts => ts.areas?.[0]?.pops !== undefined);
    if (popSeries) {
      const pops = popSeries.areas[0].pops.slice(0, 4).filter(p => p !== '--');
      if (pops.length) rainProb = Math.max(...pops.map(Number));
    }
  } catch (_) { /* ignore */ }

  let wxTemp = '';
  try {
    const tmpSeries = fc[0]?.timeSeries?.find(ts => ts.areas?.[0]?.temps !== undefined);
    if (tmpSeries) {
      const temps = tmpSeries.areas[0].temps;
      if (temps.length >= 2 && temps[1] !== '--') wxTemp = temps[1];
      else if (temps[0] !== '--') wxTemp = temps[0];
    }
  } catch (_) { /* ignore */ }

  return { wxDesc: wxDesc.replace(/\s+/g, ' ').trim(), rainProb, wxTemp };
}

// ─── メイン処理 ───────────────────────────────────────────────────────────────
const snap = await db.doc('users/default').get();
if (!snap.exists) {
  console.log('No user data found in Firestore. Exiting.');
  process.exit(0);
}

const user = snap.data();
const { pushSubscription, notifRain, notifMorning, lat, lon, todaySchedule } = user;

if (!pushSubscription) {
  console.log('No push subscription. Exiting.');
  process.exit(0);
}

if (!notifRain && !notifMorning) {
  console.log('All notifications disabled. Exiting.');
  process.exit(0);
}

const userLat = lat ?? 35.6895;
const userLon = lon ?? 139.6917;

let weather;
try {
  weather = await fetchWeather(userLat, userLon);
} catch (e) {
  console.error('Weather fetch failed:', e.message);
  weather = { wxDesc: '', rainProb: 0, wxTemp: '' };
}

console.log('Weather:', weather);
console.log('notifRain:', notifRain, '  notifMorning:', notifMorning);
console.log('todaySchedule:', todaySchedule);

const payload = JSON.stringify({
  rainProb:      weather.rainProb,
  schedule:      todaySchedule || [],
  notifRain:     !!notifRain,
  notifSchedule: !!notifMorning,
  wxDesc:        weather.wxDesc,
  wxTemp:        weather.wxTemp,
});

try {
  const sub = JSON.parse(pushSubscription);
  await webpush.sendNotification(sub, payload);
  console.log('Web Push sent successfully.');
} catch (e) {
  console.error('Web Push send failed:', e.statusCode, e.message);
  // サブスクリプション無効の場合は Firestore をクリア
  if (e.statusCode === 404 || e.statusCode === 410) {
    await db.doc('users/default').update({ pushSubscription: null });
    console.log('Invalid subscription cleared from Firestore.');
  }
  process.exit(1);
}
