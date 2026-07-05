// Vercel serverless function: /api/zvr?tickers=NVDA,AAPL,PLTR
// Zanger Volume Ratio — today's cumulative volume vs the expected cumulative
// volume at this time of day.
//
// Returns { ok: true, zvr: { NVDA: 245, AAPL: 112, ... }, meta: { slot, elapsed, sessionPct } }
// where each value is an integer % (245 = pacing 245% of avg daily volume).
//
// DATA-BUDGET REWRITE (was blowing the FMP 150GB/mo cap): the old version
// fetched 30 calendar days of 5-min bars PER TICKER (~150KB each) to build a
// per-ticker cumulative profile, cached only in instance memory — with the
// frontend polling 50-ticker chunks every 60s across recycled serverless
// instances, that was multi-GB/day. Now: ONE batch-quote call per request
// (~300B/ticker) supplies today's cumulative volume + 50-day avg volume, and
// the expected fraction comes from the standard U-shaped session curve (the
// same VOL_PROFILE the frontend's fallback uses). ~1000x fewer FMP bytes for
// a near-identical number.

const FMP_BASE = "https://financialmodelingprep.com/stable";
const SLOTS_PER_DAY = 78; // 390 min / 5 min = 78 five-minute slots

// Intraday cumulative volume profile (U-shaped): expected fraction of a full
// day's volume traded N minutes after the open. Mirrors App.jsx VOL_PROFILE.
const VOL_PROFILE = [[0, 0.02], [5, 0.04], [15, 0.08], [30, 0.13], [60, 0.21], [90, 0.27], [120, 0.33], [150, 0.38], [180, 0.43], [210, 0.48], [240, 0.53], [270, 0.59], [300, 0.66], [330, 0.74], [360, 0.84], [375, 0.91], [390, 1]];
function sessionVolFraction(minsSinceOpen) {
  const m = Math.max(0, Math.min(390, minsSinceOpen));
  for (let i = 1; i < VOL_PROFILE.length; i++) {
    const [m1, f1] = VOL_PROFILE[i - 1], [m2, f2] = VOL_PROFILE[i];
    if (m <= m2) return f1 + (f2 - f1) * (m - m1) / (m2 - m1);
  }
  return 1;
}

// ── Setup-badge journal (folded in here to stay under Vercel's 12-function limit) ──
// POST /api/zvr  { events: [{ ticker, badge, zvr, eif, cr, chg, price, ts }] }
//   → dedupe-logs badge firings (one per ticker+badge per ET day), 90d TTL
// GET  /api/zvr?journal=7  → { ok, days: { date: [events...] } }
const JOURNAL_TTL = 90 * 24 * 3600;
const JOURNAL_BADGES = new Set(["ACC", "EP", "VCP", "DIST"]);

const redisCmd = async (...args) => {
  const resp = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const result = await resp.json();
  if (result.error) throw new Error(result.error);
  return result.result;
};

const etDateStr = (d = new Date()) =>
  new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" })).toISOString().split("T")[0];

async function handleJournalPost(req, res) {
  // Maintenance: { purge: { day: "YYYY-MM-DD", beforeUtc: "HH:MM" } }
  // removes that day's entries whose ts is before the cutoff (or all, if no cutoff)
  if (req.body?.purge) {
    const { day, beforeUtc, fields } = req.body.purge;
    if (!day) return res.status(400).json({ ok: false, error: "purge.day required" });
    const key = `setuplog:${day}`;
    if (Array.isArray(fields) && fields.length) {
      const n = await redisCmd("HDEL", key, ...fields.slice(0, 100));
      return res.json({ ok: true, purged: n });
    }
    const flat = await redisCmd("HGETALL", key);
    if (!Array.isArray(flat) || flat.length === 0) return res.json({ ok: true, purged: 0 });
    const toDelete = [];
    for (let i = 0; i < flat.length; i += 2) {
      try {
        const ev = JSON.parse(flat[i + 1]);
        const t = (ev.ts || "").slice(11, 16);
        if (!beforeUtc || t < beforeUtc) toDelete.push(flat[i]);
      } catch { toDelete.push(flat[i]); }
    }
    for (let i = 0; i < toDelete.length; i += 100) {
      await redisCmd("HDEL", key, ...toDelete.slice(i, i + 100));
    }
    return res.json({ ok: true, purged: toDelete.length, remaining: flat.length / 2 - toDelete.length });
  }
  // Maintenance: { stampClose: { day: "YYYY-MM-DD", closes: { TICKER: px } } }
  // writes each event's closing price + close-to-fire return (for forward-
  // returns analytics). Idempotent — events already stamped are skipped.
  if (req.body?.stampClose) {
    const { day, closes } = req.body.stampClose;
    if (!day || !closes) return res.status(400).json({ ok: false, error: "stampClose.day and .closes required" });
    const key = `setuplog:${day}`;
    const flat = await redisCmd("HGETALL", key);
    if (!Array.isArray(flat) || flat.length === 0) return res.json({ ok: true, stamped: 0 });
    const updates = [];
    for (let i = 0; i < flat.length; i += 2) {
      try {
        const ev = JSON.parse(flat[i + 1]);
        const c = closes[ev.ticker];
        if (c != null && ev.close == null) {
          ev.close = c;
          ev.retClose = (ev.price > 0) ? Math.round(((c - ev.price) / ev.price) * 10000) / 100 : null;
          updates.push(flat[i], JSON.stringify(ev));
        }
      } catch {}
    }
    for (let i = 0; i < updates.length; i += 200) {
      await redisCmd("HSET", key, ...updates.slice(i, i + 200));
    }
    return res.json({ ok: true, stamped: updates.length / 2 });
  }
  const events = req.body?.events;
  if (!Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ ok: false, error: "events array required" });
  }
  const day = etDateStr();
  const key = `setuplog:${day}`;
  let logged = 0, skipped = 0;
  for (const ev of events.slice(0, 100)) {
    const ticker = (ev.ticker || "").toUpperCase();
    const badge = (ev.badge || "").toUpperCase();
    if (!ticker || !JOURNAL_BADGES.has(badge)) { skipped++; continue; }
    const payload = JSON.stringify({
      ticker, badge,
      zvr: ev.zvr ?? null, eif: ev.eif ?? null, cr: ev.cr ?? null,
      chg: ev.chg ?? null, price: ev.price ?? null,
      ts: ev.ts || new Date().toISOString(),
    });
    const wasSet = await redisCmd("HSETNX", key, `${ticker}:${badge}`, payload);
    if (wasSet === 1) logged++; else skipped++;
  }
  if (logged > 0) await redisCmd("EXPIRE", key, String(JOURNAL_TTL));
  return res.json({ ok: true, logged, skipped, day });
}

async function handleJournalGet(req, res) {
  const days = Math.min(parseInt(req.query.journal || "7", 10) || 7, 90);
  const out = {};
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = etDateStr(new Date(now.getTime() - i * 86400000));
    const flat = await redisCmd("HGETALL", `setuplog:${d}`);
    if (Array.isArray(flat) && flat.length > 0) {
      const events = [];
      for (let j = 1; j < flat.length; j += 2) {
        try { events.push(JSON.parse(flat[j])); } catch {}
      }
      if (events.length) out[d] = events.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
    }
  }
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
  return res.json({ ok: true, days: out });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  // Journal routes (need Upstash)
  if (req.method === "POST" || req.query.journal != null) {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      return res.status(500).json({ ok: false, error: "Upstash not configured" });
    }
    try {
      return req.method === "POST" ? await handleJournalPost(req, res) : await handleJournalGet(req, res);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  const { tickers } = req.query;
  if (!tickers) return res.status(400).json({ ok: false, error: "Missing tickers param" });

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return res.status(500).json({ ok: false, error: "FMP_API_KEY not configured" });

  const tickerList = tickers.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean).slice(0, 400);

  // Current ET time info
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const etMins = et.getHours() * 60 + et.getMinutes();
  const todayStr = et.toISOString().split("T")[0];
  // Current 5-min slot index (0 = 9:30, 77 = 3:55)
  const currentSlot = Math.min(SLOTS_PER_DAY - 1, Math.max(0, Math.floor((etMins - 570) / 5)));
  const isRTH = etMins >= 570 && etMins < 960;
  const sessionPct = isRTH ? Math.round(((etMins - 570) / 390) * 100) : 100;

  const results = {};
  const errors = [];

  // ONE batch-quote call for the whole request: volume = today's cumulative,
  // avgVolume = 50-day average. ZVR = volume / (avgVolume × expected fraction).
  try {
    const url = `${FMP_BASE}/batch-quote?symbols=${encodeURIComponent(tickerList.join(","))}&apikey=${apiKey}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`FMP ${resp.status}`);
    const quotes = await resp.json();
    const frac = isRTH ? Math.max(0.02, sessionVolFraction(etMins - 570)) : 1.0;
    if (Array.isArray(quotes)) {
      for (const q of quotes) {
        const sym = (q.symbol || "").toUpperCase();
        const vol = Number(q.volume) || 0;
        const avg = Number(q.avgVolume) || 0;
        if (!sym || vol <= 0 || avg <= 0) continue;
        results[sym] = Math.round((vol / (avg * frac)) * 100);
      }
    }
  } catch (e) {
    errors.push({ error: e.message });
  }

  // Best-effort intraday snapshot to Upstash every 30 min (slot % 6 === 0)
  // for EOD review — key zvrhist:{date}, field "TICKER:slot", 14-day TTL.
  if (isRTH && currentSlot % 6 === 0 && process.env.UPSTASH_REDIS_REST_URL && Object.keys(results).length) {
    try {
      const key = `zvrhist:${todayStr}`;
      const args = ["HSET", key];
      for (const [tk, val] of Object.entries(results)) args.push(`${tk}:${currentSlot}`, String(val));
      const hdrs = { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, "Content-Type": "application/json" };
      await fetch(process.env.UPSTASH_REDIS_REST_URL, { method: "POST", headers: hdrs, body: JSON.stringify(args) });
      await fetch(process.env.UPSTASH_REDIS_REST_URL, { method: "POST", headers: hdrs, body: JSON.stringify(["EXPIRE", key, String(14 * 24 * 3600)]) });
    } catch { /* snapshot is best-effort */ }
  }

  // Cache for 30s during RTH, 5min outside
  const maxAge = isRTH ? 30 : 300;
  res.setHeader("Cache-Control", `s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 2}`);

  return res.json({
    ok: true,
    zvr: results,
    meta: {
      slot: currentSlot,
      elapsed: sessionPct + "%",
      isRTH,
      tickers: tickerList.length,
      computed: Object.keys(results).length,
      errors: errors.length > 0 ? errors : undefined,
    },
  });
}
