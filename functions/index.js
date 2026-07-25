const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

// Web Push の送信先(endpoint)として正当なプッシュサービスのみ許可する。
// これが無いと、任意のURLをendpointに仕込まれ、通知送信バッチ(scripts/send-notify.mjs)が
// そのURLへ勝手にPOSTしてしまうSSRF（踏み台）の踏み台にされてしまう。
function isAllowedPushEndpoint(urlString) {
  let u;
  try {
    u = new URL(urlString);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname;
  const allowedExact = ['fcm.googleapis.com', 'updates.push.services.mozilla.com'];
  const allowedSuffixes = ['.push.apple.com', '.notify.windows.com'];
  return allowedExact.includes(host) || allowedSuffixes.some((suf) => host.endsWith(suf));
}

// クライアントは直接 users/default に書き込めない（Firestoreルールで拒否）。
// この関数だけが Admin SDK 経由で書き込みを行う。
exports.syncUserSettings = onCall({ region: 'us-central1', enforceAppCheck: true }, async (request) => {
  const data = request.data || {};

  const lat = Number(data.lat);
  const lon = Number(data.lon);
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) {
    throw new HttpsError('invalid-argument', 'invalid lat');
  }
  if (!Number.isFinite(lon) || Math.abs(lon) > 180) {
    throw new HttpsError('invalid-argument', 'invalid lon');
  }

  const payload = {
    lat,
    lon,
    notifRain: !!data.notifRain,
    notifMorning: !!data.notifMorning,
    todaySchedule: Array.isArray(data.todaySchedule) ? data.todaySchedule.slice(0, 20) : [],
  };

  if (typeof data.pushSubscription === 'string' && data.pushSubscription.length < 2000) {
    let sub;
    try {
      sub = JSON.parse(data.pushSubscription);
    } catch {
      throw new HttpsError('invalid-argument', 'invalid pushSubscription JSON');
    }
    if (!sub || !isAllowedPushEndpoint(sub.endpoint)) {
      throw new HttpsError('invalid-argument', 'invalid push endpoint');
    }
    if (!sub.keys || typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string') {
      throw new HttpsError('invalid-argument', 'invalid push keys');
    }
    payload.pushSubscription = data.pushSubscription;
  }

  await db.doc('users/default').set(payload, { merge: true });
  return { ok: true };
});
