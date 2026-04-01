#!/usr/bin/env node
/**
 * fetch-market.mjs
 * 毎朝 GitHub Actions から実行。
 * Yahoo Finance 非公式APIで株価・為替を取得し、
 * Google News RSS を取得して Gemini API でマーケット分析を生成。
 * 結果を Firestore の market/latest ドキュメントに保存する。
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore }        from 'firebase-admin/firestore';

// ─── Firebase Admin 初期化 ─────────────────────────────────────────────────────
const serviceAccount = {
  type: 'service_account',
  project_id:   process.env.FIREBASE_PROJECT_ID,
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  private_key:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
};
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ─── JST 日付キー ──────────────────────────────────────────────────────────────
const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
const dateKey = jstNow.toISOString().slice(0, 10); // "YYYY-MM-DD"

// ─── 取得する銘柄・為替シンボル ────────────────────────────────────────────────
const SYMBOLS = {
  nikkei: '^N225',
  topix:  '^TPX',
  sp500:  '^GSPC',
  nasdaq: '^IXIC',
  dow:    '^DJI',
  usdjpy: 'USDJPY=X',
  wti:    'CL=F',
};

const SYMBOL_LABELS = {
  nikkei: '日経225',
  topix:  'TOPIX',
  sp500:  'S&P500',
  nasdaq: 'Nasdaq',
  dow:    'Dow',
  usdjpy: 'ドル円',
  wti:    'WTI原油',
};

// ─── Yahoo Finance 非公式APIで価格取得 ──────────────────────────────────────────
async function fetchPrice(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) throw new Error('No meta in response');
    const price = meta.regularMarketPrice ?? meta.previousClose;
    const prev  = meta.previousClose ?? meta.chartPreviousClose;
    const change = (prev && prev !== 0) ? ((price - prev) / prev * 100) : 0;
    return {
      value:  Math.round(price * 100) / 100,
      change: Math.round(change * 100) / 100,
    };
  } catch (e) {
    console.warn(`[price] ${symbol} failed:`, e.message);
    return null;
  }
}

// ─── Google News RSS からニュースタイトルを取得 ─────────────────────────────────
async function fetchNewsRSS(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const titles = [];
    // CDATA形式とプレーンテキスト形式の両方に対応
    const re = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const t = m[1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').trim();
      if (t && !t.includes('Google ニュース') && !t.includes('Google News') && t.length > 5) {
        titles.push(t);
        if (titles.length >= 10) break;
      }
    }
    return titles;
  } catch (e) {
    console.warn('[RSS] fetch failed:', e.message);
    return [];
  }
}

// ─── Gemini API 呼び出し ────────────────────────────────────────────────────────
async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini HTTP ${res.status}: ${errText}`);
  }
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ─── メイン処理 ───────────────────────────────────────────────────────────────
console.log(`[market] Starting for ${dateKey}...`);

// 株価・為替を並列取得
const priceResults = await Promise.all(
  Object.entries(SYMBOLS).map(async ([key, sym]) => [key, await fetchPrice(sym)])
);
const prices = Object.fromEntries(priceResults.filter(([, v]) => v !== null));
console.log('[market] Prices fetched:', Object.keys(prices).join(', '));

// Google News RSS を並列取得（日本語・英語）
const [jpNews, enNews] = await Promise.all([
  fetchNewsRSS('https://news.google.com/rss/search?q=日本株+東京市場+日経平均&hl=ja&gl=JP&ceid=JP:ja'),
  fetchNewsRSS('https://news.google.com/rss/search?q=japan+stock+market+nikkei+tokyo&hl=en-US&gl=US&ceid=US:en'),
]);
console.log(`[market] News: JP=${jpNews.length}, EN=${enNews.length}`);

// 株価を読みやすい形式に整形
const priceText = Object.entries(prices).map(([key, p]) => {
  const label = SYMBOL_LABELS[key] || key;
  const sign  = p.change >= 0 ? '+' : '';
  let valStr;
  if (key === 'usdjpy') valStr = `${p.value.toFixed(2)}円`;
  else if (key === 'wti') valStr = `$${p.value.toFixed(2)}`;
  else valStr = p.value.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
  return `${label}: ${valStr}（${sign}${p.change}%）`;
}).join('\n');

const newsText = [
  '【日本語ニュース】',
  ...jpNews.slice(0, 8).map(t => `・${t}`),
  '',
  '【英語ニュース】',
  ...enNews.slice(0, 6).map(t => `・${t}`),
].join('\n');

const prompt = `あなたは日本の金融アナリストです。以下の株価データと最新ニュースを元に、今日（${dateKey}）のマーケットを分析してください。

【本日の主要指標】
${priceText || '（データ取得中）'}

【関連ニュース】
${newsText || '（ニュース取得中）'}

以下のJSON形式のみで回答してください（説明文・マークダウン不要）：
{
  "summary": "今日のマーケット概況（3〜4行、一般投資家向けにわかりやすく、具体的な数字を含める）",
  "factors": "主な相場変動要因の解説（2〜3行）",
  "points": ["注目ポイント1（具体的に）", "注目ポイント2", "注目ポイント3", "注目ポイント4"]
}`;

let analysis = {
  summary: `${dateKey}のマーケットデータを分析しました。`,
  factors: '詳細な要因分析はデータ収集中です。',
  points: [],
};

try {
  const geminiRaw = await callGemini(prompt);
  console.log('[Gemini] Response length:', geminiRaw.length);
  const jsonMatch = geminiRaw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.summary) analysis = parsed;
  }
} catch (e) {
  console.error('[Gemini] Error:', e.message);
}

// Firestore に保存
const docData = {
  date:      dateKey,
  summary:   analysis.summary  || '',
  factors:   analysis.factors  || '',
  points:    Array.isArray(analysis.points) ? analysis.points : [],
  prices,
  updatedAt: new Date().toISOString(),
};

await db.doc('market/latest').set(docData);
console.log('[market] Saved to Firestore market/latest');
console.log('[market] Summary:', analysis.summary?.slice(0, 80) + '...');
