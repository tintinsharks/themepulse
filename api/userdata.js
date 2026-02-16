import { verifyToken } from "./auth.js";

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const DATA_KEY = "tp_userdata";

async function redisCmd(...args) {
  const resp = await fetch(UPSTASH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Upstash error ${resp.status}: ${text}`);
  }
  return resp.json();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Auth check
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  if (!verifyToken(token)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    console.error("Upstash env vars missing:", { url: !!UPSTASH_URL, token: !!UPSTASH_TOKEN });
    return res.status(500).json({ ok: false, error: "Upstash not configured" });
  }

  if (req.method === "GET") {
    try {
      const result = await redisCmd("GET", DATA_KEY);
      const data = result.result ? JSON.parse(result.result) : null;
      return res.status(200).json({
        ok: true,
        data: data || { portfolio: [], watchlist: [] },
      });
    } catch (err) {
      console.error("Upstash GET error:", err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const { portfolio, watchlist } = req.body || {};
      const payload = JSON.stringify({
        portfolio: portfolio || [],
        watchlist: watchlist || [],
        updated: new Date().toISOString(),
      });
      const result = await redisCmd("SET", DATA_KEY, payload);
      console.log("Upstash SET result:", result);
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("Upstash SET error:", err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
