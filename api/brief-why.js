// Vercel serverless function: POST /api/brief-why
// On-demand Gemini 2.5 Flash + Google Search grounding synthesis for Go-To theme clusters.
// Explains "why are N Cyber names / M Internet names leading today?" with real cited web sources.

import { requireAuth } from "./auth.js";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.5-flash";
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_ENTRIES = 32;
const FETCH_TIMEOUT_MS = 22_000;

const _cache = new Map();

function safeUrl(u) {
  return typeof u === "string" && /^https?:\/\//i.test(u.trim()) ? u.trim() : null;
}

function sanitizeClusters(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c && typeof c.theme === "string" && c.theme.trim())
    .slice(0, 6)
    .map((c) => ({
      theme: String(c.theme).trim().slice(0, 48),
      count: Number.isFinite(Number(c.count)) ? Math.round(Number(c.count)) : 0,
      aPlusACount: Number.isFinite(Number(c.aPlusACount)) ? Math.round(Number(c.aPlusACount)) : 0,
      avgChg: Number.isFinite(Number(c.avgChg)) ? +Number(c.avgChg).toFixed(2) : null,
      avgZvr: Number.isFinite(Number(c.avgZvr)) ? +Number(c.avgZvr).toFixed(2) : null,
      breakoutCount: Number.isFinite(Number(c.breakoutCount)) ? Math.round(Number(c.breakoutCount)) : 0,
      pp2Count: Number.isFinite(Number(c.pp2Count)) ? Math.round(Number(c.pp2Count)) : 0,
      rotationStatus: typeof c.rotationStatus === "string" ? c.rotationStatus.slice(0, 16) : null,
      rankNow: Number.isFinite(Number(c.rankNow)) ? Math.round(Number(c.rankNow)) : null,
      subLayers: Array.isArray(c.subLayers)
        ? c.subLayers.slice(0, 3).map((sl) => ({
            name: String(sl?.name || "").slice(0, 48),
            count: Number.isFinite(Number(sl?.count)) ? Math.round(Number(sl.count)) : 0,
          }))
        : [],
      topTickers: Array.isArray(c.topTickers)
        ? c.topTickers.slice(0, 5).map((t) => ({
            ticker: String(t?.ticker || t || "").toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 10),
            grade: String(t?.grade || "").slice(0, 4),
            aPlusScore: Number.isFinite(Number(t?.aPlusScore)) ? Math.round(Number(t.aPlusScore)) : null,
            chg: Number.isFinite(Number(t?.chg)) ? +Number(t.chg).toFixed(1) : null,
            zvr: Number.isFinite(Number(t?.zvr)) ? +Number(t.zvr).toFixed(1) : null,
          })).filter((t) => t.ticker)
        : [],
      catalysts: Array.isArray(c.catalysts)
        ? c.catalysts.slice(0, 2).map((h) => ({
            ticker: String(h?.ticker || "").slice(0, 10),
            title: String(h?.title || "").slice(0, 180),
          })).filter((h) => h.title)
        : [],
    }));
}

function sanitizeLeaders(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && typeof m.ticker === "string" && m.ticker.trim())
    .slice(0, 8)
    .map((m) => ({
      ticker: String(m.ticker).toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 10),
      grade: String(m.grade || "").slice(0, 4),
      aPlusScore: Number.isFinite(Number(m.aPlusScore)) ? Math.round(Number(m.aPlusScore)) : null,
      theme: String(m.theme || "").slice(0, 40),
      layer: String(m.layer || "").slice(0, 48),
      chg: Number.isFinite(Number(m.chg)) ? +Number(m.chg).toFixed(1) : null,
      zvr: Number.isFinite(Number(m.zvr)) ? +Number(m.zvr).toFixed(1) : null,
      cr: Number.isFinite(Number(m.cr)) ? Math.round(Number(m.cr)) : null,
      rs: Number.isFinite(Number(m.rs)) ? Math.round(Number(m.rs)) : null,
      ppCount: Number.isFinite(Number(m.ppCount)) ? Math.round(Number(m.ppCount)) : 0,
      earningsDays: Number.isFinite(Number(m.earningsDays)) ? Math.round(Number(m.earningsDays)) : null,
      topHeadline: typeof m.topHeadline === "string" ? m.topHeadline.slice(0, 180) : null,
    }));
}

export function buildCacheKey({ date = "", session = "", clusters = [] } = {}) {
  const sig = clusters
    .map((c) => `${c.theme}:${c.count}:${(c.topTickers || []).slice(0, 3).map((t) => t.ticker).join(",")}`)
    .join("|");
  return `${date || "live"}::${session || "intraday"}::${sig}`;
}

export function buildWhyPrompt({ date = "", session = "intraday", macro = null, clusters = [], topLeaders = [] } = {}) {
  const macroParts = [];
  if (macro && typeof macro === "object") {
    if (macro.spy != null) macroParts.push(`SPY ${macro.spy > 0 ? "+" : ""}${macro.spy}%`);
    if (macro.qqq != null) macroParts.push(`QQQ ${macro.qqq > 0 ? "+" : ""}${macro.qqq}%`);
    if (macro.iwm != null) macroParts.push(`IWM ${macro.iwm > 0 ? "+" : ""}${macro.iwm}%`);
    if (macro.vix != null) macroParts.push(`VIX ${macro.vix}`);
    if (macro.us10y != null) macroParts.push(`10Y ${macro.us10y}%`);
    if (macro.decision) macroParts.push(`Market Gate ${macro.decision}${macro.score != null ? ` (${macro.score}/100)` : ""}`);
  }

  const clusterLines = clusters.map((c) => {
    const subs = c.subLayers.map((sl) => `${sl.name} (${sl.count})`).join(", ") || "General";
    const tks = c.topTickers
      .map((t) => `${t.ticker} (${t.grade}${t.aPlusScore != null ? ` ${t.aPlusScore}` : ""}${t.chg != null ? `, ${t.chg >= 0 ? "+" : ""}${t.chg}%` : ""}${t.zvr != null ? `, ${t.zvr}x vol` : ""})`)
      .join("; ");
    const news = c.catalysts.map((h) => `${h.ticker}: "${h.title}"`).join(" | ");
    return `- ${c.theme}: ${c.count} Go-To names (${c.aPlusACount} A+/A, ${c.breakoutCount} breakouts, ${c.pp2Count} PP2+, avg ${c.avgChg != null ? `${c.avgChg >= 0 ? "+" : ""}${c.avgChg}%` : "—"}, ${c.avgZvr != null ? `${c.avgZvr}x vol` : "—"}) · Sub-layers: ${subs} · Leaders: ${tks}${news ? ` · Recent headlines: ${news}` : ""}`;
  }).join("\n");

  const leaderLines = topLeaders.map((m) =>
    `- ${m.ticker} (${m.grade} ${m.aPlusScore ?? ""}, ${m.theme} · ${m.layer}): ${m.chg != null ? `${m.chg >= 0 ? "+" : ""}${m.chg}%` : "—"}, ${m.zvr != null ? `${m.zvr}x vol` : "—"}, CR ${m.cr ?? "—"}%, RS ${m.rs ?? "—"}${m.ppCount >= 2 ? `, PP${m.ppCount}` : ""}${m.earningsDays != null && m.earningsDays >= 0 && m.earningsDays <= 7 ? `, ER in ${m.earningsDays}d` : ""}${m.topHeadline ? ` · "${m.topHeadline}"` : ""}`
  ).join("\n");

  return [
    `You are an institutional US equity momentum trading desk analyst writing a crisp, factual briefing for ${date || "today"} (${session === "pm" ? "Post-Market Close" : "Intraday"} session).`,
    `Use Google Search to check TODAY's and THIS WEEK's real market news, earnings reports, sector catalysts, analyst actions, and macro drivers explaining WHY these specific themes and stocks are clustering on the trader's Go-To breakout screen.`,
    macroParts.length ? `Macro tape: ${macroParts.join(" · ")}` : "",
    "",
    "Go-To Theme Clusters:",
    clusterLines,
    "",
    topLeaders.length ? `Top Graded Go-To Leaders:\n${leaderLines}` : "",
    "",
    "Return ONLY valid JSON (no markdown commentary outside JSON) with this exact schema:",
    `{
  "macroTakeaway": "1 punchy sentence on what is driving overall sector/theme rotation today (yields, VIX, earnings wave, macro data).",
  "themes": [
    {
      "theme": "Exact theme name from the input list",
      "why": "1-2 concise sentences explaining the real-world catalyst (earnings beats/sympathy, guidance raises, AI/security/consumer demand, upgrades, macro tailwinds) driving this cluster and naming 1-2 key leaders."
    }
  ],
  "standouts": [
    {
      "ticker": "TICKER",
      "kind": "leader | risk",
      "note": "1 crisp sentence: why this A+/A setup stands out OR a concrete risk/trap (e.g. imminent earnings, sympathy laggard, extended)."
    }
  ]
}`,
    "Rules:",
    "- Cover every theme listed in Go-To Theme Clusters using the exact same theme name string.",
    "- Include 3 standouts total (2 highest-conviction leaders + 1 key risk/trap if applicable, or 3 leaders).",
    "- Be concrete and factual — cite specific earnings, guidance, upgrades, or macro catalysts found via search. Never invent facts; if a cluster is mostly technical breadth/rotation without a single headline, say so plainly.",
    "- Keep every field tight and scannable for an active trader.",
  ].filter(Boolean).join("\n");
}

function extractJsonObject(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  let cleaned = text.trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) cleaned = fenced[1].trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try {
    return JSON.parse(cleaned.slice(first, last + 1));
  } catch {
    return null;
  }
}

export function extractGroundingSources(candidate) {
  const gm = candidate?.groundingMetadata;
  const chunks = Array.isArray(gm?.groundingChunks) ? gm.groundingChunks : [];
  const seen = new Set();
  const sources = [];
  for (const ch of chunks) {
    const web = ch?.web;
    const url = safeUrl(web?.uri);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    let host = "";
    try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* ignore */ }
    const title = String(web?.title || host || "Source").trim().slice(0, 90);
    sources.push({ title, url, host });
    if (sources.length >= 8) break;
  }
  return sources;
}

export function parseGeminiWhyResponse(rawJson, expectedThemes = []) {
  const candidate = rawJson?.candidates?.[0] || null;
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  const text = parts.map((p) => (typeof p?.text === "string" ? p.text : "")).filter(Boolean).join("\n");
  const parsed = extractJsonObject(text);
  const sources = extractGroundingSources(candidate);

  if (!parsed || typeof parsed !== "object") {
    return {
      ok: false,
      error: "parse_failed",
      rawText: text.slice(0, 400),
      sources,
    };
  }

  const macroTakeaway = typeof parsed.macroTakeaway === "string" ? parsed.macroTakeaway.trim().slice(0, 320) : "";
  const themeMap = new Map();
  if (Array.isArray(parsed.themes)) {
    for (const item of parsed.themes) {
      const name = typeof item?.theme === "string" ? item.theme.trim() : "";
      const why = typeof item?.why === "string" ? item.why.trim().slice(0, 420) : "";
      if (name && why) themeMap.set(name.toLowerCase(), { theme: name, why });
    }
  }

  // Align returned theme keys to exact input theme names when available
  const themes = [];
  const used = new Set();
  for (const tName of expectedThemes) {
    const hit = themeMap.get(String(tName).toLowerCase());
    if (hit) {
      themes.push({ theme: tName, why: hit.why });
      used.add(String(tName).toLowerCase());
    }
  }
  for (const [k, v] of themeMap.entries()) {
    if (!used.has(k)) themes.push(v);
  }

  const standouts = Array.isArray(parsed.standouts)
    ? parsed.standouts
        .filter((s) => s && typeof s.ticker === "string" && typeof s.note === "string" && s.note.trim())
        .slice(0, 4)
        .map((s) => ({
          ticker: String(s.ticker).toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 10),
          kind: s.kind === "risk" ? "risk" : "leader",
          note: String(s.note).trim().slice(0, 260),
        }))
        .filter((s) => s.ticker)
    : [];

  return {
    ok: true,
    macroTakeaway,
    themes,
    standouts,
    sources,
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (!requireAuth(req, res)) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      ok: false,
      error: "missing_api_key",
      message: "GEMINI_API_KEY is not configured in Vercel Environment Variables. Claim your Google AI Ultra credits in Google AI Studio → API Keys, add GEMINI_API_KEY in Vercel, and redeploy.",
    });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== "object") {
    return res.status(400).json({ ok: false, error: "invalid_body" });
  }

  const date = typeof body.date === "string" ? body.date.slice(0, 24) : "";
  const session = typeof body.session === "string" ? body.session.slice(0, 16) : "intraday";
  const force = Boolean(body.force);
  const clusters = sanitizeClusters(body.clusters);
  const topLeaders = sanitizeLeaders(body.topLeaders);
  if (!clusters.length) {
    return res.status(400).json({ ok: false, error: "no_clusters", message: "No Go-To theme clusters to analyze." });
  }

  const cacheKey = buildCacheKey({ date, session, clusters });
  const nowMs = Date.now();
  if (!force) {
    const hit = _cache.get(cacheKey);
    if (hit && nowMs - hit.ts < CACHE_TTL_MS) {
      return res.status(200).json({ ...hit.data, cached: true });
    }
  }

  const model = (process.env.GEMINI_WHY_MODEL || DEFAULT_MODEL).trim();
  const prompt = buildWhyPrompt({ date, session, macro: body.macro || null, clusters, topLeaders });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(
      `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1200,
          },
        }),
      }
    );

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      return res.status(resp.status === 429 ? 429 : 502).json({
        ok: false,
        error: resp.status === 429 ? "rate_limited" : "gemini_upstream_error",
        status: resp.status,
        message: resp.status === 429
          ? "Gemini API rate limit reached — wait a moment and try again."
          : `Gemini API returned ${resp.status}.`,
        detail: errBody.slice(0, 240),
      });
    }

    const raw = await resp.json();
    const parsed = parseGeminiWhyResponse(raw, clusters.map((c) => c.theme));
    if (!parsed.ok) {
      return res.status(502).json({
        ok: false,
        error: "parse_failed",
        message: "Gemini returned an unexpected format — try refreshing.",
      });
    }

    const payload = {
      ok: true,
      model,
      generatedAt: new Date().toISOString(),
      cacheKey,
      cached: false,
      macroTakeaway: parsed.macroTakeaway,
      themes: parsed.themes,
      standouts: parsed.standouts,
      sources: parsed.sources,
    };

    if (_cache.size >= CACHE_MAX_ENTRIES) _cache.delete(_cache.keys().next().value);
    _cache.set(cacheKey, { ts: Date.now(), data: payload });

    return res.status(200).json(payload);
  } catch (err) {
    const isAbort = err?.name === "AbortError";
    return res.status(isAbort ? 504 : 502).json({
      ok: false,
      error: isAbort ? "timeout" : "network_error",
      message: isAbort ? "Gemini web-grounded synthesis timed out — try again." : "Failed to reach Gemini API.",
    });
  } finally {
    clearTimeout(timer);
  }
}
