// ════════════════════════════════════════════════════════════════════════════
// api/setup-log.js — Setup-badge firing journal (ACC / EP / VCP / DIST)
// ════════════════════════════════════════════════════════════════════════════
//
// The frontend posts badge firings as they happen during RTH; this endpoint
// dedupes (one event per ticker+badge per day) and stores them in Upstash so
// signal quality can be analyzed later (forward returns per badge type).
//
// POST /api/setup-log  { events: [{ ticker, badge, zvr, eif, cr, chg, price, ts }] }
//   → { ok, logged: n, skipped: n }   (skipped = already logged today)
// GET  /api/setup-log?days=7
//   → { ok, days: { "2026-06-10": [events...], ... } }
//
// Storage: one Redis hash per day — setuplog:{YYYY-MM-DD}, field "TICKER:BADGE",
// value = event JSON. 90-day TTL.
//
// Env vars: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const TTL_SECONDS = 90 * 24 * 3600;
const BADGES = new Set(["ACC", "EP", "VCP", "DIST"]);

async function redisCmd(...args) {
  const resp = await fetch(UPSTASH_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const result = await resp.json();
  if (result.error) throw new Error(result.error);
  return result.result;
}

function etDateStr(d = new Date()) {
  return new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" })).toISOString().split("T")[0];
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    return res.status(500).json({ ok: false, error: "Upstash not configured" });
  }

  try {
    if (req.method === "POST") {
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
        if (!ticker || !BADGES.has(badge)) { skipped++; continue; }
        const field = `${ticker}:${badge}`;
        const payload = JSON.stringify({
          ticker, badge,
          zvr: ev.zvr ?? null, eif: ev.eif ?? null, cr: ev.cr ?? null,
          chg: ev.chg ?? null, price: ev.price ?? null,
          ts: ev.ts || new Date().toISOString(),
        });
        // HSETNX: only the FIRST firing of a ticker+badge per day is recorded
        const wasSet = await redisCmd("HSETNX", key, field, payload);
        if (wasSet === 1) logged++; else skipped++;
      }
      if (logged > 0) await redisCmd("EXPIRE", key, String(TTL_SECONDS));
      return res.json({ ok: true, logged, skipped, day });
    }

    if (req.method === "GET") {
      const days = Math.min(parseInt(req.query.days || "7", 10) || 7, 90);
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

    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
