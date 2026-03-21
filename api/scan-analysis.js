// ── Scan Analysis API: stores/retrieves AI deep dive results from /scan ──
// POST: unauthenticated write (called by Claude Code /scan command)
// GET: public read (called by ThemePulse UI)

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const DATA_KEY = "tp_scan_analysis";

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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-cache");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    return res.status(500).json({ ok: false, error: "Not configured" });
  }

  try {
    if (req.method === "GET") {
      const result = await redisCmd("GET", DATA_KEY);
      const data = result.result ? JSON.parse(result.result) : { date: null, tickers: [], scans: [] };
      return res.status(200).json({ ok: true, ...data });
    }

    if (req.method === "POST") {
      const { ticker, decision, summary, scanNumber, filters, score, chg, rvol, theme } = req.body || {};
      if (!ticker || !decision) {
        return res.status(400).json({ ok: false, error: "ticker and decision required" });
      }

      // Read existing data
      const existing = await redisCmd("GET", DATA_KEY);
      const data = existing.result ? JSON.parse(existing.result) : { date: null, tickers: [], scans: [] };

      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

      // Reset if new day
      if (data.date !== today) {
        data.date = today;
        data.tickers = [];
        data.scans = [];
      }

      const now = new Date().toISOString();
      const entry = {
        ticker,
        decision,
        summary: summary || "",
        scanNumber: scanNumber || 0,
        filters: filters || {},
        score: score || 0,
        chg: chg || 0,
        rvol: rvol || 0,
        theme: theme || "",
        analyzedAt: now,
      };

      // Update or append ticker
      const idx = data.tickers.findIndex(t => t.ticker === ticker);
      if (idx >= 0) {
        data.tickers[idx] = entry;
      } else {
        data.tickers.push(entry);
      }

      // Append to scan history
      data.scans.push({ ticker, decision, scanNumber: scanNumber || 0, at: now });

      data.updated = now;

      await redisCmd("SET", DATA_KEY, JSON.stringify(data));
      return res.status(200).json({ ok: true });
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
