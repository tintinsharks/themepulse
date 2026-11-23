#!/usr/bin/env node
// ThemePulse — Leading Stocks in Leading Themes + Dan Zanger Intraday Volume Movers
//
// Uses ThemePulse's own pure scoring engine (src/lead/math.js) over public/ data
// plus live intraday quotes/news from https://themepulse.vercel.app/api/live.
//
// Usage:
//   node scripts/zanger-scan.mjs                # live if TP_PIN set, else pipeline EOD fallback
//   node scripts/zanger-scan.mjs --offline      # skip network calls, use local pipeline JSON
//   node scripts/zanger-scan.mjs --no-write     # print report to stdout without writing reports/
//   node scripts/zanger-scan.mjs --json         # print structured JSON summary to stdout
//
// Env (optional, for live intraday quotes & headlines):
//   TP_PIN            ThemePulse PIN (read from env or .env.local)
//   TP_BASE_URL       Defaults to https://themepulse.vercel.app

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PEAK_LOOKBACK,
  classify,
  rankHeld,
  rankTrend,
  layerStats,
  layerConfirm,
  layerFlags,
  withEpsRating,
  computeTiers,
  pinReason,
  rsLeads,
  zvrFor,
  etClock,
} from "../src/lead/math.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE_URL = (process.env.TP_BASE_URL || "https://themepulse.vercel.app").replace(/\/$/, "");

function loadEnvLocal() {
  const envPath = path.join(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

function readJson(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function getToken() {
  if (process.env.TP_AUTH_TOKEN) return process.env.TP_AUTH_TOKEN;
  const pin = process.env.TP_PIN;
  if (!pin) return null;
  try {
    const r = await fetch(`${BASE_URL}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
      signal: AbortSignal.timeout(10000),
    });
    const d = await r.json().catch(() => ({}));
    return r.ok && d.ok && d.token ? d.token : null;
  } catch {
    return null;
  }
}

async function fetchLiveQuotes(tickers, token) {
  const map = new Map();
  if (!token || !tickers.length) return map;
  const unique = [...new Set(tickers)];
  for (let i = 0; i < unique.length; i += 450) {
    const chunk = unique.slice(i, i + 450);
    try {
      const r = await fetch(`${BASE_URL}/api/live?universe=${encodeURIComponent(chunk.join(","))}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) continue;
      const d = await r.json();
      for (const q of d?.theme_universe || d?.universe || []) {
        if (q?.ticker) map.set(q.ticker, q);
      }
    } catch { /* partial failure ok */ }
  }
  return map;
}

async function fetchTickerHeadlines(tickers, token) {
  const out = new Map();
  if (!token || !tickers.length) return out;
  await Promise.all(
    tickers.map(async (t) => {
      try {
        const r = await fetch(`${BASE_URL}/api/live?news=${encodeURIComponent(t)}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        });
        if (!r.ok) return;
        const d = await r.json();
        const items = (d?.news || []).slice(0, 3).map((n) => ({
          title: n.title || n.headline || "",
          source: n.source || "",
          date: n.date || n.time || "",
        })).filter((n) => n.title);
        if (items.length) out.set(t, items);
      } catch { /* ignore */ }
    })
  );
  return out;
}

function closingRange(q, s) {
  const px = q?.price ?? s?.price ?? s?.close ?? null;
  const hi = q?.dayHigh ?? q?.high ?? null;
  const lo = q?.dayLow ?? q?.low ?? null;
  if (px != null && hi != null && lo != null && hi > lo) {
    return Math.max(0, Math.min(100, Math.round(((px - lo) / (hi - lo)) * 100)));
  }
  return s?.cr_pct != null ? Math.round(s.cr_pct) : null;
}

function formatEtStamp(now = new Date()) {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const p2 = (n) => String(n).padStart(2, "0");
  const date = `${et.getFullYear()}-${p2(et.getMonth() + 1)}-${p2(et.getDate())}`;
  const hhmm = `${p2(et.getHours())}${p2(et.getMinutes())}`;
  const pretty = `${date} ${p2(et.getHours())}:${p2(et.getMinutes())} ET`;
  return { date, hhmm, pretty };
}

export function scoreZangerCandidate({ s, q, layer, tier, profiles, now = new Date() }) {
  if (!s?.ticker) return null;
  if (pinReason(s)) return null;
  if ((s.avg_dollar_vol_raw ?? 0) < 20e6) return null;
  if (!s.above_50ma) return null;

  const px = q?.price ?? s.price ?? s.close ?? null;
  const chg = q?.change ?? s.change_pct ?? null;
  const cr = closingRange(q, s);
  const adr = s.adr20 ?? s.adr_pct ?? null;
  const off52 = s.off_52w_high ?? s.pct_from_high ?? null;
  const rs = s.rs_rank ?? 0;
  const eps = s.eps_rating ?? null;

  // Zanger Volume Ratio (1.0 = normal pace, 2.0 = 200% pace)
  let zvr = q ? zvrFor(s, q, profiles, now) : null;
  if (zvr == null && s.rel_volume > 0) zvr = s.rel_volume;

  const rsl = Boolean(rsLeads(s));
  const fromOpen = q?.open > 0 && px > 0 ? ((px / q.open) - 1) * 100 : null;

  // Dan Zanger intraday volume mover filter:
  //   - In a leading or emerging layer (or RS 90+ leader)
  //   - Volume surge: ZVR >= 1.5x normal pace
  //   - Price expansion: green on the day (>= +1.5% or >= 0.75x ADR)
  //   - Strong close/intraday location: CR >= 60% (if available)
  //   - Breakout zone: within 20% of 52-week high & RS >= 75
  const inStrongLayer = layer && (layer.st === "lead" || layer.st === "emerg");
  const qualifiesZanger =
    (inStrongLayer || rs >= 90) &&
    zvr != null && zvr >= 1.5 &&
    chg != null && chg >= Math.min(1.5, (adr ?? 3) * 0.6) &&
    (cr == null || cr >= 60) &&
    (off52 == null || off52 >= -20) &&
    rs >= 75;

  const isBreakout =
    qualifiesZanger &&
    zvr >= 2.0 &&
    chg >= 3.0 &&
    (cr == null || cr >= 70) &&
    (off52 == null || off52 >= -10);

  // Composite score: ZVR pace + RS + Layer strength + CR + EPS + 52w proximity
  const zvrPts = Math.min(35, (Math.min(zvr ?? 0, 4.0) / 4.0) * 35);
  const rsPts = (rs / 100) * 25;
  const layerPts = layer?.st === "lead" ? 15 : layer?.st === "emerg" ? 9 : 0;
  const crPts = cr != null ? (cr / 100) * 10 : 5;
  const epsPts = eps != null ? (eps / 100) * 10 : 4;
  const proxPts = off52 != null ? Math.max(0, 5 + off52 * 0.25) : 2;
  const score = Math.round((zvrPts + rsPts + layerPts + crPts + epsPts + proxPts) * 10) / 10;

  return {
    ticker: s.ticker,
    company: s.company || "",
    theme: layer?.theme || s.sector || "—",
    layer: layer?.name || s.industry || "—",
    layerStatus: layer?.st || "lag",
    layerRank: layer?.now ?? null,
    tier,
    price: px,
    chg,
    fromOpen,
    zvr: zvr != null ? Math.round(zvr * 100) / 100 : null,
    cr,
    rs,
    eps,
    epsAccel: Boolean(s.eps_accel),
    adr: adr != null ? Math.round(adr * 10) / 10 : null,
    off52: off52 != null ? Math.round(off52 * 10) / 10 : null,
    rsl,
    qualifiesZanger,
    isBreakout,
    score,
    pipelineNews: (s._newsPipe || []).slice(0, 2),
  };
}

function fmtPct(v, digits = 1) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

function buildMarkdown({ stamp, mode, clock, pipelineDate, leadingLayers, emergingLayers, zangerMovers, themeLeaders, headlines }) {
  const lines = [];
  lines.push(`# ThemePulse Zanger & Leadership Scan — ${stamp.pretty}`);
  lines.push("");
  lines.push(`- **Mode**: ${mode}`);
  lines.push(`- **Session**: ${clock.session} (${clock.rth ? "RTH Live" : "Outside RTH"}) · **Pipeline**: ${pipelineDate || "unknown"}`);
  lines.push(`- **Summary**: ${leadingLayers.length} leading layers · ${emergingLayers.length} confirmed emerging layers · ${zangerMovers.length} Dan Zanger volume movers`);
  lines.push("");

  lines.push("## 1. Dan Zanger Intraday Volume Movers (ZVR ≥ 1.5x)");
  lines.push("");
  if (!zangerMovers.length) {
    lines.push("_No stocks currently pass all Dan Zanger breakout/volume criteria (ZVR ≥ 1.5x, green, CR ≥ 60%, RS ≥ 75, within 20% of 52w high, above 50d MA, $20M+ adv)._");
  } else {
    lines.push("| Signal | Ticker | Theme · Layer | Price | Chg% | ZVR | CR% | RS | EPS | Off 52wH | ADR | Score |");
    lines.push("|--------|--------|---------------|------:|-----:|----:|----:|---:|----:|---------:|----:|------:|");
    for (const m of zangerMovers.slice(0, 25)) {
      const sig = m.isBreakout ? "🔥 BO" : m.rsl ? "🔵 RSL" : "⚡ VOL";
      const tierBadge = m.tier === "lead" ? " ⭐" : m.tier === "emerg" ? " 🌱" : "";
      const epsStr = m.eps != null ? `${m.eps}${m.epsAccel ? "▲" : ""}` : "—";
      lines.push(
        `| ${sig} | **${m.ticker}**${tierBadge} | ${m.theme} · ${m.layer} | ${m.price != null ? m.price.toFixed(2) : "—"} | ${fmtPct(m.chg)} | **${m.zvr != null ? m.zvr.toFixed(2) + "x" : "—"}** | ${m.cr != null ? m.cr + "%" : "—"} | ${m.rs} | ${epsStr} | ${fmtPct(m.off52)} | ${m.adr != null ? m.adr.toFixed(1) + "%" : "—"} | ${m.score.toFixed(1)} |`
      );
    }
  }
  lines.push("");

  if (zangerMovers.length) {
    lines.push("### Catalyst Check (Top Movers)");
    lines.push("");
    for (const m of zangerMovers.slice(0, 8)) {
      const liveH = headlines.get(m.ticker);
      const items = liveH?.length ? liveH.map((h) => `${h.title}${h.source ? ` _(${h.source})_` : ""}`) : m.pipelineNews;
      lines.push(`- **${m.ticker}** (${m.theme} · ${m.layer}, ${fmtPct(m.chg)}, ZVR ${m.zvr?.toFixed(2)}x, RS ${m.rs}): ${items?.length ? items.join(" | ") : "_No live headline returned — check news/earnings_"}`);
    }
    lines.push("");
  }

  lines.push("## 2. Leading Themes & Layers");
  lines.push("");
  if (!leadingLayers.length) {
    lines.push("_No layers currently meet the rank ≥ 88 leadership threshold._");
  } else {
    lines.push("| Theme | Layer | Status | Rank | 1W Δ | 1M Δ | Held (20d) | >50d | RS≥80 | Flags |");
    lines.push("|-------|-------|--------|-----:|-----:|-----:|-----------:|-----:|------:|-------|");
    for (const l of [...leadingLayers, ...emergingLayers].slice(0, 20)) {
      const st = l.st === "lead" ? "🟢 Leading" : "🔵 Emerging";
      const fl = l.flags.map(([k]) => k).join(", ") || "—";
      lines.push(
        `| ${l.theme} | ${l.name} | ${st} | ${l.now} | ${l.now - (l.w1 ?? l.now) >= 0 ? "+" : ""}${l.now - (l.w1 ?? l.now)} | ${l.now - (l.m1 ?? l.now) >= 0 ? "+" : ""}${l.now - (l.m1 ?? l.now)} | ${l.held.held}/${l.held.of} | ${l.stats?.a50 ?? "—"}% | ${l.stats?.rs80 ?? "—"}% | ${fl} |`
      );
    }
  }
  lines.push("");

  lines.push("## 3. Top Leading Stocks in Leading Themes (Core Focus List)");
  lines.push("");
  if (!themeLeaders.length) {
    lines.push("_No qualifying RS 90+ leaders found in leading layers._");
  } else {
    lines.push("| Ticker | Theme · Layer | Price | Chg% | ZVR | RS | EPS | Off 52wH | ADR | Notes |");
    lines.push("|--------|---------------|------:|-----:|----:|---:|----:|---------:|----:|-------|");
    for (const m of themeLeaders.slice(0, 25)) {
      const epsStr = m.eps != null ? `${m.eps}${m.epsAccel ? "▲" : ""}` : "—";
      const notes = [m.isBreakout && "Zanger BO", !m.isBreakout && m.qualifiesZanger && "ZVR Surge", m.rsl && "RS Line New High"].filter(Boolean).join(", ") || "—";
      lines.push(
        `| **${m.ticker}** ⭐ | ${m.theme} · ${m.layer} | ${m.price != null ? m.price.toFixed(2) : "—"} | ${fmtPct(m.chg)} | ${m.zvr != null ? m.zvr.toFixed(2) + "x" : "—"} | ${m.rs} | ${epsStr} | ${fmtPct(m.off52)} | ${m.adr != null ? m.adr.toFixed(1) + "%" : "—"} | ${notes} |`
      );
    }
  }
  lines.push("");

  return lines.join("\n");
}

export async function runZangerScan({ offline = false, write = true, now = new Date() } = {}) {
  loadEnvLocal();
  const dash = readJson("public/dashboard_data.json");
  const rot = readJson("public/data/rs_rotation.json");
  const hist = readJson("public/data/rank_history.json") || {};
  const chain = readJson("public/data/chain_layers.json") || [];
  const lb = readJson("public/data/layer_breadth.json") || {};
  const profiles = readJson("public/data/rvol_profiles.json") || null;

  if (!dash?.stocks || !rot?.layers) {
    throw new Error("Missing public/dashboard_data.json or public/data/rs_rotation.json");
  }

  const rawMap = {};
  for (const s of dash.stocks) {
    if (s?.ticker) rawMap[s.ticker] = s;
  }
  const hlMap = dash.headlines || {};
  for (const [t, v] of Object.entries(hlMap)) {
    if (rawMap[t] && Array.isArray(v?.headlines)) rawMap[t]._newsPipe = v.headlines.slice(0, 3);
  }
  const stockMap = withEpsRating(rawMap);

  const members = {};
  for (const c of Array.isArray(chain) ? chain : []) {
    members[`${c.themeId}|${c.layer}`] = c.tickers || [];
  }

  const dates = Object.keys(hist).sort();
  const peakDates = dates.slice(-PEAK_LOOKBACK);
  const layers = rot.layers.map((l) => {
    const key = `${l.themeId}|${l.name}`;
    const tks = members[key] || (l.holds || []).map((x) => x.t);
    const ph = peakDates.map((d) => hist?.[d]?.layers?.[key] ?? null);
    const { st, peak } = classify(l, ph.length ? ph : [l.now, l.w1, l.m1]);
    const stats = layerStats(tks, stockMap);
    const conf = layerConfirm(lb?.layers?.[key]);
    const held = rankHeld(ph);
    const trend = rankTrend(ph);
    const row = { ...l, key, tks, st, peak, stats, conf, held, trend };
    row.flags = layerFlags(row);
    return row;
  });

  // Map each ticker to its strongest layer (highest rank, preferring lead/emerg)
  const tickerLayer = {};
  const stPri = { lead: 3, emerg: 2, weak: 1, lag: 0, brk: -1 };
  for (const l of layers) {
    for (const t of l.tks) {
      const prev = tickerLayer[t];
      if (!prev || stPri[l.st] > stPri[prev.st] || (stPri[l.st] === stPri[prev.st] && l.now > prev.now)) {
        tickerLayer[t] = l;
      }
    }
  }

  const tiers = computeTiers(stockMap, tickerLayer);
  const leadingLayers = layers.filter((l) => l.st === "lead").sort((a, b) => b.now - a.now);
  const emergingLayers = layers
    .filter((l) => l.st === "emerg" && (l.conf?.passed?.length ?? 0) >= 2)
    .sort((a, b) => b.now - a.now);

  // Build candidate pool to quote live: liquid above-50d names in leading/emerging layers + all RS>=85 leaders
  const poolSet = new Set();
  for (const [t, s] of Object.entries(stockMap)) {
    if ((s.avg_dollar_vol_raw ?? 0) < 20e6 || !s.above_50ma || pinReason(s)) continue;
    const l = tickerLayer[t];
    if (tiers.leaders.has(t) || tiers.emerging.has(t) || (s.rs_rank ?? 0) >= 80 || l?.st === "lead" || l?.st === "emerg") {
      poolSet.add(t);
    }
  }

  let liveQuotes = new Map();
  let token = null;
  let mode = "Pipeline EOD (offline)";
  if (!offline) {
    token = await getToken();
    if (token) {
      liveQuotes = await fetchLiveQuotes([...poolSet], token);
      mode = liveQuotes.size > 0
        ? `Live Intraday (${liveQuotes.size} quotes from ${BASE_URL})`
        : "Pipeline EOD (live endpoint returned 0 quotes)";
    } else {
      mode = "Pipeline EOD (set TP_PIN in env/.env.local for live intraday quotes)";
    }
  }

  const scored = [];
  for (const t of poolSet) {
    const s = stockMap[t];
    const q = liveQuotes.get(t) || null;
    const layer = tickerLayer[t] || null;
    const tier = tiers.leaders.has(t) ? "lead" : tiers.emerging.has(t) ? "emerg" : null;
    const res = scoreZangerCandidate({ s, q, layer, tier, profiles, now });
    if (res) scored.push(res);
  }

  const zangerMovers = scored
    .filter((r) => r.qualifiesZanger)
    .sort((a, b) => Number(b.isBreakout) - Number(a.isBreakout) || b.score - a.score);

  const themeLeaders = scored
    .filter((r) => r.tier === "lead" && r.layerStatus === "lead")
    .sort((a, b) => b.rs - a.rs || (b.eps ?? 0) - (a.eps ?? 0) || (b.zvr ?? 0) - (a.zvr ?? 0));

  const headlines = token && zangerMovers.length
    ? await fetchTickerHeadlines(zangerMovers.slice(0, 8).map((m) => m.ticker), token)
    : new Map();

  const stamp = formatEtStamp(now);
  const clock = etClock(now);
  const markdown = buildMarkdown({
    stamp,
    mode,
    clock,
    pipelineDate: dash.date,
    leadingLayers,
    emergingLayers,
    zangerMovers,
    themeLeaders,
    headlines,
  });

  let reportPath = null;
  if (write) {
    const reportsDir = path.join(ROOT, "reports");
    fs.mkdirSync(reportsDir, { recursive: true });
    reportPath = path.join(reportsDir, `zanger-${stamp.date}-${stamp.hhmm}-ET.md`);
    fs.writeFileSync(reportPath, markdown, "utf8");
    fs.writeFileSync(path.join(reportsDir, "latest.md"), markdown, "utf8");
  }

  return {
    stamp,
    mode,
    pipelineDate: dash.date,
    reportPath,
    leadingLayers: leadingLayers.map((l) => ({ theme: l.theme, layer: l.name, rank: l.now, w1: l.w1, m1: l.m1, flags: l.flags.map(([k]) => k) })),
    emergingLayers: emergingLayers.map((l) => ({ theme: l.theme, layer: l.name, rank: l.now, w1: l.w1, m1: l.m1 })),
    zangerMovers: zangerMovers.slice(0, 25),
    themeLeaders: themeLeaders.slice(0, 25),
    markdown,
  };
}

// CLI entrypoint
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Set(process.argv.slice(2));
  const res = await runZangerScan({
    offline: args.has("--offline"),
    write: !args.has("--no-write"),
  });
  if (args.has("--json")) {
    console.log(JSON.stringify({ ...res, markdown: undefined }, null, 2));
  } else {
    console.log(res.markdown);
    if (res.reportPath) console.error(`\nSaved report: ${res.reportPath}`);
  }
}
