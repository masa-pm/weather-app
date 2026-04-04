#!/usr/bin/env node
/**
 * test-seed.mjs
 * テスト用：今日の日付のdateフィールド付きtodayScheduleをFirestoreに書き込む
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore }        from 'firebase-admin/firestore';

const serviceAccount = {
  type: 'service_account',
  project_id:   process.env.FIREBASE_PROJECT_ID,
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  private_key:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
};

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
const todayKey = jstNow.toISOString().slice(0, 10);

const todaySchedule = [
  { title: 'テスト予定A', time: '09:00', date: todayKey },
  { title: 'テスト予定B', time: '14:00', date: todayKey },
];

await db.doc('users/default').update({ todaySchedule });
console.log(`[seed] today=${todayKey}, ${todaySchedule.length}件を書き込みました`);
console.log(todaySchedule);
