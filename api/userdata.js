// ════════════════════════════════════════════════════════════════════════════
// api/userdata.js — Server-side persistence for watchlist + portfolio + analyzed picks
// ════════════════════════════════════════════════════════════════════════════
//
// Personal-dashboard model: single-user, no auth required (URL is the
// security boundary). Stores three lists in one Upstash Redis key:
//
//   {
//     analyzedPicks: [...],   // 1-week TTL applied at read time
//     watchlist:     [...],   // persists until manually deleted
//     portfolio:     [...],   // persists until manually deleted
//     updated_at:    "ISO8601"
//   }
//
// GET   /api/userdata        → returns the full state (filtered for stale picks)
// POST  /api/userdata {...}  → replaces the full state (frontend sends complete blob)
//
// Env vars: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
// ════════════════════════════════════════════════════════════════════════════

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const DATA_KEY = "tp_user_state";
const ANALYZED_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week
const ANALYZED_MAX = 50;

async function redisCmd(...args) {
  const resp = await fetch(UPSTASH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const result = await resp.json();
  if (result.error) throw new Error(result.error);
  return result;
}

function applyAnalyzedTtl(picks) {
  if (!Array.isArray(picks)) return [];
  const cutoff = Date.now() - ANALYZED_TTL_MS;
  return picks
    .filter((p) => {
      if (!p || !p.analyzed_at) return false;
      const t = Date.parse(p.analyzed_at);
      return Number.isFinite(t) && t >= cutoff;
    })
    .slice(0, ANALYZED_MAX);
}

function emptyState() {
  return {
    analyzedPicks: [],
    watchlist: [],
    portfolio: [],
    focus: [],
    updated_at: null,
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    return res.status(500).json({
      ok: false,
      error: "Upstash not configured (set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN)",
    });
  }

  try {
    if (req.method === "GET") {
      // Short cache so multiple browser tabs don't hammer KV
      res.setHeader(
        "Cache-Control",
        "private, s-maxage=10, stale-while-revalidate=60"
      );
      const result = await redisCmd("GET", DATA_KEY);
      const stored = result.result ? JSON.parse(result.result) : null;
      const state = stored || emptyState();
      // Apply 1-week TTL filter to analyzed picks at read time
      state.analyzedPicks = applyAnalyzedTtl(state.analyzedPicks);
      return res.status(200).json({ ok: true, ...state });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      // Pull current state so we can merge instead of clobber if caller
      // sends a partial blob (e.g., just a watchlist update)
      let existing = emptyState();
      try {
        const cur = await redisCmd("GET", DATA_KEY);
        if (cur.result) existing = { ...emptyState(), ...JSON.parse(cur.result) };
      } catch {
        /* fall through with empty */
      }

      const merged = {
        analyzedPicks: applyAnalyzedTtl(
          Array.isArray(body.analyzedPicks)
            ? body.analyzedPicks
            : existing.analyzedPicks
        ),
        watchlist: Array.isArray(body.watchlist)
          ? body.watchlist
          : existing.watchlist,
        portfolio: Array.isArray(body.portfolio)
          ? body.portfolio
          : existing.portfolio,
        focus: Array.isArray(body.focus) ? body.focus : existing.focus,
        updated_at: new Date().toISOString(),
      };

      await redisCmd("SET", DATA_KEY, JSON.stringify(merged));
      return res.status(200).json({ ok: true, ...merged });
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err) {
    console.error("userdata error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
