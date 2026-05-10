// api/theme-analysis.js — Store and retrieve EOD theme analysis
//
// GET  /api/theme-analysis        → returns latest analysis from KV (public)
// POST /api/theme-analysis {...}  → saves new analysis (requires TP_API_KEY header)
//
// The remote Cowork agent POSTs structured JSON after each EOD run.
// The ThemePulse UI GETs it to display the Theme Intel tab.
//
// Env vars: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, TP_API_KEY

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const API_KEY       = process.env.TP_API_KEY;
const DATA_KEY      = "tp_theme_analysis";

async function redisCmd(...args) {
  const resp = await fetch(UPSTASH_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const result = await resp.json();
  if (result.error) throw new Error(result.error);
  return result;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  if (req.method === "OPTIONS") return res.status(200).end();

  // ── GET: return latest analysis ─────────────────────────────────────────
  if (req.method === "GET") {
    try {
      const result = await redisCmd("GET", DATA_KEY);
      if (!result.result) return res.status(200).json({ analysis: null });
      const data = JSON.parse(result.result);
      return res.status(200).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── POST: save new analysis (requires API key) ──────────────────────────
  if (req.method === "POST") {
    const key = req.headers["x-api-key"];
    if (!API_KEY || key !== API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const body = req.body;
      if (!body || typeof body !== "object") {
        return res.status(400).json({ error: "Body must be JSON" });
      }
      const payload = JSON.stringify({ ...body, saved_at: new Date().toISOString() });
      await redisCmd("SET", DATA_KEY, payload);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
