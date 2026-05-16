// api/schwab-callback.js — Schwab OAuth callback handler
// Receives the authorization code, exchanges it for tokens, stores in Redis.
// Redirect URI: https://themepulse.vercel.app/api/schwab-callback
//
// Env vars: SCHWAB_CLIENT_ID, SCHWAB_CLIENT_SECRET, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN

export const config = { maxDuration: 15 };

const SCHWAB_TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";
const REDIS_KEY = "schwab:tokens";
const REDIRECT_URI = "https://themepulse.vercel.app/api/schwab-callback";

const redis = (cmd, ...args) =>
  fetch(process.env.UPSTASH_REDIS_REST_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify([cmd, ...args]),
  }).then((r) => r.json());

export default async function handler(req, res) {
  const { code, error } = req.query;

  if (error) {
    return res.status(400).send(`<h2>Schwab OAuth Error</h2><p>${error}</p>`);
  }

  if (!code) {
    // No code — redirect to Schwab authorize URL
    const clientId = process.env.SCHWAB_CLIENT_ID;
    const url = `https://api.schwabapi.com/v1/oauth/authorize?response_type=code&client_id=${clientId}&scope=readonly&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    return res.redirect(302, url);
  }

  // Exchange code for tokens
  try {
    const clientId = process.env.SCHWAB_CLIENT_ID;
    const clientSecret = process.env.SCHWAB_CLIENT_SECRET;
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const resp = await fetch(SCHWAB_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
    });

    if (!resp.ok) {
      const err = await resp.text();
      return res.status(resp.status).send(`<h2>Token exchange failed</h2><pre>${err}</pre>`);
    }

    const data = await resp.json();
    const tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in - 60) * 1000,
      updated: new Date().toISOString(),
    };

    await redis("SET", REDIS_KEY, JSON.stringify(tokens));

    return res.status(200).send(`
      <html>
      <body style="background:#121218;color:#c8c8d8;font-family:monospace;padding:40px;text-align:center">
        <h2 style="color:#0d9163">Schwab Connected</h2>
        <p>Access token expires in ${Math.round(data.expires_in / 60)} minutes.</p>
        <p>Refresh token stored — auto-renews for 7 days.</p>
        <p style="color:#5a5a6a;margin-top:20px">You can close this tab.</p>
      </body>
      </html>
    `);
  } catch (e) {
    return res.status(500).send(`<h2>Error</h2><pre>${e.message}</pre>`);
  }
}
