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
    ondeck: [],
    listOps: {},
    updated_at: null,
  };
}

// ── LWW-element-set for the ticker lists ──────────────────────────────────
// `listOps` maps "field:TICKER" -> { op: "add"|"del", at: ISO }. Merges keep
// the NEWEST op per key and lists are filtered by it, so a stale client that
// POSTs an old list can't resurrect tickers deleted on another device.
const OPS_TTL_MS = 120 * 24 * 60 * 60 * 1000;
const OPS_MAX = 800;

function mergeListOps(a, b) {
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) {
    if (!v || !v.at) continue;
    if (!out[k] || v.at > out[k].at) out[k] = v;
  }
  const cutoff = new Date(Date.now() - OPS_TTL_MS).toISOString();
  return Object.fromEntries(
    Object.entries(out)
      .filter(([, v]) => v && v.at && v.at >= cutoff)
      .sort((x, y) => (y[1].at > x[1].at ? 1 : -1))
      .slice(0, OPS_MAX)
  );
}

function applyListOps(field, list, ops) {
  return (list || []).filter((t) => (ops || {})[`${field}:${t}`]?.op !== "del");
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

  // ── Scopes: pm-movers / ah-movers — the graded movers-scan routine's
  // results (6AM premarket / 8PM after-hours). GET returns the latest blob;
  // POST (bearer RVOL_SCANNER_TOKEN, same token as the old agent-picks cron)
  // stores { date, generated_at, rows[], top_setups[] }. Piggybacked here
  // because the api/ dir is at Vercel's 12-function cap.
  if (req.query && (req.query.scope === "pm-movers" || req.query.scope === "ah-movers")) {
    const kvKey = `themepulse:${req.query.scope}`;
    try {
      if (req.method === "GET") {
        res.setHeader("Cache-Control", "private, s-maxage=60, stale-while-revalidate=300");
        if (req.query.history) {
          const hr = await redisCmd("GET", `${kvKey}:history`);
          return res.status(200).json({ ok: true, history: hr.result ? JSON.parse(hr.result) : [] });
        }
        const r = await redisCmd("GET", kvKey);
        return res.status(200).json({ ok: true, data: r.result ? JSON.parse(r.result) : null });
      }
      if (req.method === "POST") {
        const auth = req.headers.authorization || "";
        const expected = process.env.RVOL_SCANNER_TOKEN;
        if (!expected || auth !== `Bearer ${expected}`) {
          return res.status(401).json({ ok: false, error: "unauthorized" });
        }
        const b = req.body || {};
        if (!b.date || !Array.isArray(b.rows)) {
          return res.status(400).json({ ok: false, error: "need { date, rows[] }" });
        }
        const blob = {
          date: String(b.date),
          generated_at: new Date().toISOString(),
          rows: b.rows.slice(0, 60),
          top_setups: Array.isArray(b.top_setups) ? b.top_setups.slice(0, 12) : [],
        };
        await redisCmd("SET", kvKey, JSON.stringify(blob));
        // Bank the blob into a capped per-scope history (last 30 sessions,
        // deduped by date — same-day re-pushes replace) so grade follow-
        // through can be audited later. Failures here never fail the POST.
        try {
          const histKey = `${kvKey}:history`;
          const hr = await redisCmd("GET", histKey);
          let hist = [];
          try { hist = JSON.parse(hr.result || "[]"); } catch { hist = []; }
          if (!Array.isArray(hist)) hist = [];
          hist = hist.filter((h) => h && h.date !== blob.date);
          hist.push(blob);
          hist.sort((a, b) => (a.date < b.date ? -1 : 1));
          await redisCmd("SET", histKey, JSON.stringify(hist.slice(-30)));
        } catch { /* history is best-effort */ }
        return res.status(200).json({ ok: true, count: blob.rows.length });
      }
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
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
      // Merge over defaults so newer fields (e.g. focus) always appear even for
      // states written before they existed.
      const state = { ...emptyState(), ...(stored || {}) };
      // Apply 1-week TTL filter to analyzed picks at read time
      state.analyzedPicks = applyAnalyzedTtl(state.analyzedPicks);
      // Honor deletes at read time too, in case a legacy write slipped a
      // tombstoned ticker back into a stored list.
      for (const f of ["watchlist", "portfolio", "focus", "ondeck"]) {
        state[f] = applyListOps(f, state[f], state.listOps);
      }
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

      const ops = mergeListOps(existing.listOps, body.listOps);
      const pick = (field) =>
        applyListOps(field, Array.isArray(body[field]) ? body[field] : existing[field], ops);
      const merged = {
        analyzedPicks: applyAnalyzedTtl(
          Array.isArray(body.analyzedPicks)
            ? body.analyzedPicks
            : existing.analyzedPicks
        ),
        watchlist: pick("watchlist"),
        portfolio: pick("portfolio"),
        focus: pick("focus"),
        ondeck: pick("ondeck"),
        listOps: ops,
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
