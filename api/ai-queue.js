// ── Public read-only endpoint for AI analysis queue ──
// Cowork reads this to know which tickers to analyze.
// Write happens via the authenticated userdata API.

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
  res.setHeader("Cache-Control", "no-cache");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    return res.status(500).json({ ok: false, error: "Not configured" });
  }

  try {
    const result = await redisCmd("GET", DATA_KEY);
    const data = result.result ? JSON.parse(result.result) : {};
    return res.status(200).json({
      ok: true,
      aiQueue: data.aiQueue || [],
      updated: data.updated || null,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
