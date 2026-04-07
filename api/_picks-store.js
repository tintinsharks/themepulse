// ════════════════════════════════════════════════════════════════════════════
// Shared store for the three picks endpoints
// (api/agent-picks.js, api/pm-picks.js, api/ah-picks.js)
// ════════════════════════════════════════════════════════════════════════════
//
// All three endpoints share the same logic, only differing by the Redis key.
// They support:
//   POST  — validates Authorization: Bearer $RVOL_SCANNER_TOKEN, stores body
//   GET   — validates user session token (HMAC-signed via TP_PIN), returns body
//
// Env vars required in Vercel:
//   UPSTASH_REDIS_REST_URL    — same Upstash instance used by api/userdata.js
//   UPSTASH_REDIS_REST_TOKEN
//   RVOL_SCANNER_TOKEN        — shared secret for the local cron/scanner POSTs
//   TP_PIN                    — user PIN (already set; used by api/auth.js)
//   TP_SESSION_SECRET         — HMAC secret (already set; used by api/auth.js)
//
// During the Phase 3→5 migration window, GET also accepts requests with NO
// auth header so we can verify end-to-end before flipping the password wall on.
// Set REQUIRE_GET_AUTH=true in Vercel env to enforce strict GET auth.
// ════════════════════════════════════════════════════════════════════════════

import crypto from "crypto";

const SECRET =
  process.env.TP_SESSION_SECRET || "themepulse-default-secret-change-me";

// ── User session token verification (mirrors api/userdata.js) ─────────────
function verifyUserToken(token) {
  if (!token) return false;
  try {
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return false;
    const expected = crypto
      .createHmac("sha256", SECRET)
      .update(payload)
      .digest("base64url");
    if (sig !== expected) return false;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (Date.now() - data.ts > 30 * 24 * 60 * 60 * 1000) return false;
    return data.pin === process.env.TP_PIN;
  } catch {
    return false;
  }
}

// ── Scanner token verification (simple shared secret) ────────────────────
function verifyScannerToken(token) {
  const expected = process.env.RVOL_SCANNER_TOKEN;
  if (!expected) return false;
  return token === expected;
}

// ── Upstash Redis REST (same instance as userdata.js) ────────────────────
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

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

// ── Generic picks-store handler (factory) ────────────────────────────────
//
// Each endpoint file (agent-picks.js, pm-picks.js, ah-picks.js) calls this
// with its own Redis key. Returns a Vercel handler function.
export function makePicksHandler(redisKey) {
  return async function handler(req, res) {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );
    if (req.method === "OPTIONS") return res.status(200).end();

    if (!UPSTASH_URL || !UPSTASH_TOKEN) {
      return res.status(500).json({
        ok: false,
        error: "Upstash not configured (set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN)",
      });
    }

    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace(/^Bearer /i, "");

    try {
      // ── GET: return latest payload ────────────────────────────────────
      if (req.method === "GET") {
        // During migration window we allow unauthenticated GETs unless
        // REQUIRE_GET_AUTH=true is set. Once Phase 5 cutover is done, set
        // that env var to enforce password protection on the dashboard.
        const requireAuth = process.env.REQUIRE_GET_AUTH === "true";
        if (requireAuth && !verifyUserToken(token)) {
          return res.status(401).json({ ok: false, error: "Unauthorized" });
        }

        // Cache GETs at the Vercel CDN for 30s to reduce KV reads
        res.setHeader(
          "Cache-Control",
          "s-maxage=30, stale-while-revalidate=120"
        );

        const result = await redisCmd("GET", redisKey);
        const stored = result.result ? JSON.parse(result.result) : null;
        if (!stored) {
          return res.status(200).json({
            ok: true,
            picks: [],
            commentary: {},
            updated: null,
          });
        }
        return res.status(200).json({ ok: true, ...stored });
      }

      // ── POST: store new payload ───────────────────────────────────────
      if (req.method === "POST") {
        // POSTs always require the scanner token (no fallback)
        if (!verifyScannerToken(token)) {
          return res
            .status(401)
            .json({ ok: false, error: "Unauthorized (scanner token required)" });
        }

        const body = req.body || {};
        const payload = {
          picks: Array.isArray(body.picks) ? body.picks : [],
          commentary:
            body.commentary && typeof body.commentary === "object"
              ? body.commentary
              : {},
          updated: new Date().toISOString(),
        };
        await redisCmd("SET", redisKey, JSON.stringify(payload));
        return res
          .status(200)
          .json({ ok: true, count: payload.picks.length });
      }

      return res
        .status(405)
        .json({ ok: false, error: "Method not allowed" });
    } catch (err) {
      console.error(`picks-store error (${redisKey}):`, err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  };
}
