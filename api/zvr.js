// Vercel serverless function: /api/zvr?tickers=NVDA,AAPL,PLTR
// Zanger Volume Ratio — compares today's cumulative volume at time T
// to the average cumulative volume at time T across a 20-day lookback.
//
// Returns { ok: true, zvr: { NVDA: 245, AAPL: 112, ... }, meta: { slot, elapsed, sessionPct } }
// where each value is an integer % (245 = projected 245% of avg daily volume).
//
// FMP 5-min bars include volume. We fetch 20 trading days, build a cumulative
// volume profile per 5-min slot (0 = 9:30, 1 = 9:35, ... 77 = 3:55), average
// across days, then compare today's cumulative to that average at the current slot.

const FMP_BASE = "https://financialmodelingprep.com/stable";
const LOOKBACK_DAYS = 30; // calendar days to fetch (yields ~20 trading days)
const SLOTS_PER_DAY = 78; // 390 min / 5 min = 78 five-minute slots

// In-memory cache: { ticker -> { profile: Float64Array(78), today: string, fetchedAt } }
const profileCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — profile only changes once per day

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

  const tickerList = tickers.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean).slice(0, 50);

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

  // Process tickers in parallel (max 10 concurrent to respect FMP rate limits)
  const chunks = [];
  for (let i = 0; i < tickerList.length; i += 10) {
    chunks.push(tickerList.slice(i, i + 10));
  }

  for (const chunk of chunks) {
    await Promise.all(
      chunk.map(async (ticker) => {
        try {
          const zvr = await computeZVR(ticker, apiKey, currentSlot, todayStr, now);
          if (zvr != null) results[ticker] = zvr;
        } catch (e) {
          errors.push({ ticker, error: e.message });
        }
      })
    );
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

async function computeZVR(ticker, apiKey, currentSlot, todayStr, now) {
  // Check cache — reuse if profile was built today and is fresh
  const cached = profileCache.get(ticker);
  if (cached && cached.today === todayStr && (now.getTime() - cached.fetchedAt) < CACHE_TTL_MS) {
    return zvrFromProfile(cached.profile, cached.todayCumVol, currentSlot);
  }

  // Fetch 5-min bars for the last ~30 calendar days (≈20 trading days)
  const fromDate = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 3600 * 1000);
  const fromStr = fromDate.toISOString().split("T")[0];
  const url = `${FMP_BASE}/historical-chart/5min?symbol=${encodeURIComponent(ticker)}&from=${fromStr}&to=${todayStr}&apikey=${apiKey}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`FMP ${resp.status}`);
  const data = await resp.json();
  if (!Array.isArray(data) || data.length === 0) return null;

  // FMP returns newest-first. Group bars by trading day.
  // Each bar has: { date: "2026-06-09 10:35:00", volume: 1234567, ... }
  const dayBuckets = new Map(); // "2026-06-09" -> Array of { slot, volume }
  for (const bar of data) {
    if (!bar.date || bar.volume == null) continue;
    const [dateStr, timeStr] = bar.date.split(" ");
    if (!timeStr) continue;
    const [h, m] = timeStr.split(":").map(Number);
    const barMins = h * 60 + m;
    // Only RTH bars (9:30-15:55)
    if (barMins < 570 || barMins >= 960) continue;
    const slot = Math.floor((barMins - 570) / 5);
    if (slot < 0 || slot >= SLOTS_PER_DAY) continue;

    if (!dayBuckets.has(dateStr)) dayBuckets.set(dateStr, []);
    dayBuckets.get(dateStr).push({ slot, volume: Number(bar.volume) || 0 });
  }

  if (dayBuckets.size === 0) return null;

  // Separate today from historical days
  const todayBars = dayBuckets.get(todayStr) || [];
  const histDays = [];
  for (const [d, bars] of dayBuckets) {
    if (d !== todayStr) histDays.push(bars);
  }

  if (histDays.length === 0) return null; // need at least 1 historical day

  // Build average cumulative volume profile across historical days
  // For each day: sort bars by slot, compute cumulative volume at each slot
  // Then average across days at each slot
  const slotSums = new Float64Array(SLOTS_PER_DAY);
  const slotCounts = new Uint16Array(SLOTS_PER_DAY);

  for (const dayBars of histDays) {
    dayBars.sort((a, b) => a.slot - b.slot);
    let cumVol = 0;
    let barIdx = 0;
    for (let s = 0; s < SLOTS_PER_DAY; s++) {
      // Add volume for bars at this slot
      while (barIdx < dayBars.length && dayBars[barIdx].slot <= s) {
        cumVol += dayBars[barIdx].volume;
        barIdx++;
      }
      if (cumVol > 0) {
        slotSums[s] += cumVol;
        slotCounts[s]++;
      }
    }
  }

  // Average profile
  const avgProfile = new Float64Array(SLOTS_PER_DAY);
  for (let s = 0; s < SLOTS_PER_DAY; s++) {
    avgProfile[s] = slotCounts[s] > 0 ? slotSums[s] / slotCounts[s] : 0;
  }

  // Today's cumulative volume up to each slot
  const todayCumVol = new Float64Array(SLOTS_PER_DAY);
  if (todayBars.length > 0) {
    todayBars.sort((a, b) => a.slot - b.slot);
    let cumVol = 0;
    let barIdx = 0;
    for (let s = 0; s < SLOTS_PER_DAY; s++) {
      while (barIdx < todayBars.length && todayBars[barIdx].slot <= s) {
        cumVol += todayBars[barIdx].volume;
        barIdx++;
      }
      todayCumVol[s] = cumVol;
    }
  }

  // Cache
  profileCache.set(ticker, {
    profile: avgProfile,
    todayCumVol,
    today: todayStr,
    fetchedAt: now.getTime(),
  });

  return zvrFromProfile(avgProfile, todayCumVol, currentSlot);
}

function zvrFromProfile(avgProfile, todayCumVol, currentSlot) {
  const avgAtSlot = avgProfile[currentSlot];
  const todayAtSlot = todayCumVol[currentSlot];
  if (!avgAtSlot || avgAtSlot <= 0) return null;
  if (!todayAtSlot || todayAtSlot <= 0) return null;
  return Math.round((todayAtSlot / avgAtSlot) * 100); // integer %
}
