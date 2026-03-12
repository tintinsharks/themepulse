// ── Trigger AI analysis run ──
// Sets a flag in Redis that the local watcher picks up.
// POST /api/trigger-analysis (requires auth token)
// GET  /api/trigger-analysis (check status, public)

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const AUTH_TOKEN = process.env.TP_AUTH_TOKEN;
const TRIGGER_KEY = "tp_ai_trigger";

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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    return res.status(500).json({ ok: false, error: "Not configured" });
  }

  // GET — check trigger status
  if (req.method === "GET") {
    try {
      const result = await redisCmd("GET", TRIGGER_KEY);
      const data = result.result ? JSON.parse(result.result) : null;
      return res.status(200).json({ ok: true, trigger: data });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  // POST — set trigger
  if (req.method === "POST") {
    // Auth check
    const auth = req.headers.authorization?.replace("Bearer ", "");
    if (!AUTH_TOKEN || auth !== AUTH_TOKEN) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      const action = body.action || "trigger";

      if (action === "clear") {
        await redisCmd("DEL", TRIGGER_KEY);
        return res.status(200).json({ ok: true, action: "cleared" });
      }

      const trigger = {
        requested_at: new Date().toISOString(),
        status: "pending",
        requested_by: "dashboard",
      };
      // Set with 1 hour TTL (auto-clears if watcher doesn't pick it up)
      await redisCmd("SET", TRIGGER_KEY, JSON.stringify(trigger), "EX", 3600);
      return res.status(200).json({ ok: true, trigger });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
