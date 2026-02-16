import { verifyToken } from "./auth.js";

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const DATA_KEY = "tp:userdata";

async function redisGet(key) {
  const resp = await fetch(`${UPSTASH_URL}/get/${key}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const data = await resp.json();
  return data.result ? JSON.parse(data.result) : null;
}

async function redisSet(key, value) {
  const resp = await fetch(`${UPSTASH_URL}/set/${key}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(JSON.stringify(value)),
  });
  return resp.ok;
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
    return res.status(500).json({ ok: false, error: "Upstash not configured" });
  }

  if (req.method === "GET") {
    try {
      const data = await redisGet(DATA_KEY);
      return res.status(200).json({
        ok: true,
        data: data || { portfolio: [], watchlist: [] },
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const { portfolio, watchlist } = req.body || {};
      await redisSet(DATA_KEY, {
        portfolio: portfolio || [],
        watchlist: watchlist || [],
        updated: new Date().toISOString(),
      });
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
