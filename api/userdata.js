import crypto from "crypto";

// ── Inline token verification (can't import from sibling in Vercel serverless) ──
const SECRET = process.env.TP_SESSION_SECRET || "themepulse-default-secret-change-me";

function verifyToken(token) {
  if (!token) return false;
  try {
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return false;
    const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
    if (sig !== expected) return false;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (Date.now() - data.ts > 30 * 24 * 60 * 60 * 1000) return false;
    return data.pin === process.env.TP_PIN;
  } catch {
    return false;
  }
}

// ── Upstash Redis REST ──
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
  const result = await resp.json();
  if (result.error) throw new Error(result.error);
  return result;
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
    console.error("Missing env vars - UPSTASH_REDIS_REST_URL:", !!UPSTASH_URL, "UPSTASH_REDIS_REST_TOKEN:", !!UPSTASH_TOKEN);
    return res.status(500).json({ ok: false, error: "Upstash not configured" });
  }

  try {
    if (req.method === "GET") {
      const result = await redisCmd("GET", DATA_KEY);
      const data = result.result ? JSON.parse(result.result) : null;
      return res.status(200).json({
        ok: true,
        data: data || { portfolio: [], watchlist: [] },
      });
    }

    if (req.method === "POST") {
      const { portfolio, watchlist } = req.body || {};
      const payload = JSON.stringify({
        portfolio: portfolio || [],
        watchlist: watchlist || [],
        updated: new Date().toISOString(),
      });
      await redisCmd("SET", DATA_KEY, payload);
      return res.status(200).json({ ok: true });
    }
  } catch (err) {
    console.error("Upstash error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
