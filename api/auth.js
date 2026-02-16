import crypto from "crypto";

const SECRET = process.env.TP_SESSION_SECRET || "themepulse-default-secret-change-me";

export function createToken(pin) {
  const payload = Buffer.from(JSON.stringify({ pin, ts: Date.now() })).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyToken(token) {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  if (sig !== expected) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    // Token valid for 30 days
    if (Date.now() - data.ts > 30 * 24 * 60 * 60 * 1000) return false;
    return data.pin === process.env.TP_PIN;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { pin } = req.body || {};
  if (!pin) return res.status(400).json({ ok: false, error: "PIN required" });

  const expected = process.env.TP_PIN;
  if (!expected) return res.status(500).json({ ok: false, error: "TP_PIN not configured" });

  if (pin !== expected) {
    return res.status(401).json({ ok: false, error: "Invalid PIN" });
  }

  const token = createToken(pin);
  return res.status(200).json({ ok: true, token });
}
