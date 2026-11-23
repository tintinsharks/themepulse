import crypto from "crypto";

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function getSecret() {
  return process.env.TP_SESSION_SECRET || "";
}

function createToken(pin) {
  const secret = getSecret();
  if (!secret) throw new Error("TP_SESSION_SECRET not configured");
  const payload = Buffer.from(JSON.stringify({ pin, ts: Date.now() })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  const secret = getSecret();
  if (!token || !secret || !process.env.TP_PIN) return false;
  try {
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return false;
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
    if (!safeEqual(sig, expected)) return false;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (Date.now() - data.ts > 30 * 24 * 60 * 60 * 1000) return false;
    return safeEqual(String(data.pin ?? ""), process.env.TP_PIN);
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
  if (!process.env.TP_PIN || !getSecret()) {
    return res.status(500).json({ ok: false, error: "Auth not configured" });
  }
  if (!safeEqual(String(pin), process.env.TP_PIN)) {
    return res.status(401).json({ ok: false, error: "Invalid PIN" });
  }

  return res.status(200).json({ ok: true, token: createToken(pin) });
}

// Export for use — but since Vercel isolates each file,
// userdata.js will have its own copy of verify logic
export { verifyToken, createToken };
