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
//   node scripts/zanger-scan.mjs --market-hours-only   # exit 0 quietly outside Mon-Fri 10:00-16:00 ET / NYSE holidays
//   node scripts/zanger-scan.mjs --email-out <dir>     # write email.html, email.txt, meta.json to <dir>
//   node scripts/zanger-scan.mjs --force-send          # set shouldSend=true even when 0 movers
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
  etClock,
  scoreZangerCandidate,
} from "../src/lead/math.js";

export { scoreZangerCandidate };

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

function formatEtStamp(now = new Date()) {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const p2 = (n) => String(n).padStart(2, "0");
  const date = `${et.getFullYear()}-${p2(et.getMonth() + 1)}-${p2(et.getDate())}`;
  const hhmm = `${p2(et.getHours())}${p2(et.getMinutes())}`;
  const pretty = `${date} ${p2(et.getHours())}:${p2(et.getMinutes())} ET`;
  return { date, hhmm, pretty, hours: et.getHours(), minutes: et.getMinutes(), day: et.getDay() };
}

function utcYmd(dt) {
  const p2 = (n) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p2(dt.getUTCMonth() + 1)}-${p2(dt.getUTCDate())}`;
}

function observedFixedHoliday(year, month, day) {
  const dt = new Date(Date.UTC(year, month - 1, day));
  const dow = dt.getUTCDay();
  if (dow === 6) dt.setUTCDate(dt.getUTCDate() - 1); // Saturday -> Friday
  else if (dow === 0) dt.setUTCDate(dt.getUTCDate() + 1); // Sunday -> Monday
  return utcYmd(dt);
}

function nthWeekdayHoliday(year, month, weekday, n) {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const offset = (weekday - firstDow + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  return utcYmd(new Date(Date.UTC(year, month - 1, day)));
}

function lastWeekdayHoliday(year, month, weekday) {
  const last = new Date(Date.UTC(year, month, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  last.setUTCDate(last.getUTCDate() - offset);
  return utcYmd(last);
}

function goodFridayHoliday(year) {
  // Anonymous Gregorian Easter algorithm, minus 2 days
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() - 2);
  return utcYmd(dt);
}

export function isUsMarketHoliday(etYmd) {
  if (!etYmd || typeof etYmd !== "string") return false;
  const year = Number(etYmd.slice(0, 4));
  if (!Number.isFinite(year)) return false;
  const holidays = new Set([
    observedFixedHoliday(year, 1, 1),      // New Year's Day
    observedFixedHoliday(year + 1, 1, 1),  // Next New Year's observed on Dec 31 if Jan 1 is Saturday
    nthWeekdayHoliday(year, 1, 1, 3),      // MLK Day (3rd Mon Jan)
    nthWeekdayHoliday(year, 2, 1, 3),      // Presidents' Day (3rd Mon Feb)
    goodFridayHoliday(year),               // Good Friday
    lastWeekdayHoliday(year, 5, 1),        // Memorial Day (last Mon May)
    observedFixedHoliday(year, 6, 19),     // Juneteenth
    observedFixedHoliday(year, 7, 4),      // Independence Day
    nthWeekdayHoliday(year, 9, 1, 1),      // Labor Day (1st Mon Sep)
    nthWeekdayHoliday(year, 11, 4, 4),     // Thanksgiving (4th Thu Nov)
    observedFixedHoliday(year, 12, 25),    // Christmas
  ]);
  return holidays.has(etYmd);
}

// Hourly RTH email window: Mon-Fri, non-holiday, 09:55-16:25 ET.
// Covers 10:00 AM-4:00 PM ET across both EDT and EST when triggered by UTC cron
// (0 14-21 * * 1-5), tolerating up to 25m GitHub Actions cron jitter at the 4:00 PM close
// while cleanly skipping 9:00 AM EST and 5:00 PM EDT.
export function isMarketScanWindow(now = new Date()) {
  const s = formatEtStamp(now);
  const mins = s.hours * 60 + s.minutes;
  if (s.day === 0 || s.day === 6) return { open: false, reason: "weekend", et: s.pretty };
  if (isUsMarketHoliday(s.date)) return { open: false, reason: "us_market_holiday", et: s.pretty };
  if (mins < 595 || mins > 985) return { open: false, reason: "outside_market_hours", et: s.pretty };
  return { open: true, reason: "rth_window", et: s.pretty };
}

function fmtPct(v, digits = 1) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

function escHtml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const BO_EMAIL_COLORS = {
  ZANGER: { bg: "#fef3c7", fg: "#92400e", bd: "#f59e0b" },
  "SB4%": { bg: "#dcfce7", fg: "#166534", bd: "#22c55e" },
  "SB$":  { bg: "#cffafe", fg: "#155e75", bd: "#06b6d4" },
  QMAG:   { bg: "#f3e8ff", fg: "#6b21a8", bd: "#a855f7" },
};

export function buildEmailSubject({ stamp, zangerMovers }) {
  const bos = (zangerMovers || []).filter((m) => m.isBreakout);
  const timeShort = stamp?.pretty ? stamp.pretty.slice(11) : "";
  if (bos.length > 0) {
    const top = bos.slice(0, 4).map((m) => m.ticker).join(", ");
    const more = bos.length > 4 ? ` +${bos.length - 4}` : "";
    return `🔥 ThemePulse Zanger: ${bos.length} Breakout${bos.length === 1 ? "" : "s"} (${top}${more}) · ${zangerMovers.length} Movers — ${timeShort}`;
  }
  if ((zangerMovers || []).length > 0) {
    const top = zangerMovers.slice(0, 4).map((m) => m.ticker).join(", ");
    return `⚡ ThemePulse Zanger: ${zangerMovers.length} Volume Mover${zangerMovers.length === 1 ? "" : "s"} (${top}) — ${timeShort}`;
  }
  return `ThemePulse Zanger Scan (0 Movers) — ${timeShort}`;
}

export function buildEmailHtml({ stamp, mode, clock, pipelineDate, leadingLayers, emergingLayers, zangerMovers, headlines }, { baseUrl = BASE_URL } = {}) {
  const url = baseUrl.replace(/\/$/, "");
  const movers = zangerMovers || [];
  const bos = movers.filter((m) => m.isBreakout);
  const leadCount = (leadingLayers || []).length;
  const emergCount = (emergingLayers || []).length;

  const badgeHtml = (m) => {
    if (m.breakoutTypes?.length) {
      return m.breakoutTypes.map((k) => {
        const c = BO_EMAIL_COLORS[k] || { bg: "#fef3c7", fg: "#92400e", bd: "#f59e0b" };
        return `<span style="display:inline-block;padding:2px 5px;margin:1px 2px 1px 0;border-radius:3px;font-size:10px;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:${c.bg};color:${c.fg};border:1px solid ${c.bd};">${escHtml(k)}</span>`;
      }).join("");
    }
    if (m.rsl) {
      return `<span style="display:inline-block;padding:2px 6px;border-radius:3px;font-size:10px;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#e0f2fe;color:#075985;border:1px solid #38bdf8;">RSL</span>`;
    }
    return `<span style="display:inline-block;padding:2px 6px;border-radius:3px;font-size:10px;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#dcfce7;color:#166534;border:1px solid #4ade80;">VOL</span>`;
  };

  const moverRows = movers.slice(0, 25).map((m) => {
    const tUrl = `${url}/?view=zanger&ticker=${encodeURIComponent(m.ticker)}`;
    const tierBadge = m.tier === "lead" ? " ⭐" : m.tier === "emerg" ? " 🌱" : "";
    const chgColor = m.chg == null ? "#64748b" : m.chg >= 0 ? "#15803d" : "#dc2626";
    const zvrColor = (m.zvr ?? 0) >= 2.5 ? "#b45309" : (m.zvr ?? 0) >= 1.8 ? "#15803d" : "#334155";
    const crColor = (m.cr ?? 0) >= 75 ? "#15803d" : (m.cr ?? 0) >= 50 ? "#b45309" : "#dc2626";
    const dollarSub = m.dollarMove != null && m.dollarMove >= 0.9
      ? `<div style="font-size:10px;color:#0e7490;font-weight:500;">+$${m.dollarMove.toFixed(2)}</div>`
      : "";
    const epsStr = m.eps != null ? `${m.eps}${m.epsAccel ? "▲" : ""}` : "—";
    const rowBg = m.isBreakout ? "#fffbeb" : "#ffffff";
    return `<tr style="background:${rowBg};border-bottom:1px solid #e2e8f0;">
      <td style="padding:7px 6px;vertical-align:middle;">${badgeHtml(m)}</td>
      <td style="padding:7px 6px;vertical-align:middle;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
        <a href="${tUrl}" style="color:#0f172a;font-weight:800;text-decoration:none;">${escHtml(m.ticker)}</a>${tierBadge}
        ${m.company ? `<div style="font-size:10px;color:#64748b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(m.company)}</div>` : ""}
      </td>
      <td style="padding:7px 6px;vertical-align:middle;font-size:11px;color:#334155;">
        <strong style="color:#0f172a;">${escHtml(m.theme)}</strong> <span style="color:#94a3b8;">·</span> ${escHtml(m.layer)}
      </td>
      <td style="padding:7px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:${m.adr != null && m.adr >= 4 ? "#0e7490" : "#475569"};">${m.adr != null ? `${m.adr.toFixed(1)}%` : "—"}</td>
      <td style="padding:7px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;color:${chgColor};">${escHtml(fmtPct(m.chg, 2))}${dollarSub}</td>
      <td style="padding:7px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;color:${zvrColor};">${m.zvr != null ? `${m.zvr.toFixed(2)}x` : "—"}</td>
      <td style="padding:7px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;color:${crColor};">${m.cr != null ? `${m.cr}%` : "—"}</td>
      <td style="padding:7px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;color:${m.rs >= 90 ? "#15803d" : "#334155"};">${m.rs}</td>
      <td style="padding:7px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#475569;">${escHtml(epsStr)}</td>
      <td style="padding:7px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:${m.off52 != null && m.off52 >= -5 ? "#15803d" : "#64748b"};">${escHtml(fmtPct(m.off52))}</td>
      <td style="padding:7px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:800;color:${m.score >= 70 ? "#b45309" : "#0f172a"};">${m.score.toFixed(1)}</td>
    </tr>`;
  }).join("");

  const catalystItems = movers.slice(0, 8).map((m) => {
    const liveH = headlines instanceof Map ? headlines.get(m.ticker) : headlines?.[m.ticker];
    const items = liveH?.length
      ? liveH.map((h) => `${escHtml(h.title)}${h.source ? ` <span style="color:#64748b;">(${escHtml(h.source)})</span>` : ""}`)
      : (m.pipelineNews || []).map((t) => escHtml(t));
    const tUrl = `${url}/?view=zanger&ticker=${encodeURIComponent(m.ticker)}`;
    return `<li style="margin-bottom:6px;line-height:1.45;">
      <a href="${tUrl}" style="color:#0f172a;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;text-decoration:none;">${escHtml(m.ticker)}</a>
      <span style="color:#64748b;">(${escHtml(m.theme)} · ${escHtml(fmtPct(m.chg))}, ZVR ${m.zvr != null ? `${m.zvr.toFixed(2)}x` : "—"}, RS ${m.rs}):</span>
      ${items.length ? items.join(" &nbsp;|&nbsp; ") : `<em style="color:#94a3b8;">No live headline returned</em>`}
    </li>`;
  }).join("");

  const layerRows = [...(leadingLayers || []), ...(emergingLayers || [])].slice(0, 12).map((l) => {
    const st = l.st === "lead" ? "🟢 Leading" : "🔵 Emerging";
    const w1 = l.now - (l.w1 ?? l.now);
    const fl = (l.flags || []).map((x) => (Array.isArray(x) ? x[0] : x)).join(", ") || "—";
    return `<tr style="border-bottom:1px solid #e2e8f0;">
      <td style="padding:5px 6px;font-weight:600;color:#0f172a;">${escHtml(l.theme)}</td>
      <td style="padding:5px 6px;color:#334155;">${escHtml(l.name ?? l.layer)}</td>
      <td style="padding:5px 6px;font-size:11px;">${st}</td>
      <td style="padding:5px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;">${l.now ?? l.rank}</td>
      <td style="padding:5px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:${w1 >= 0 ? "#15803d" : "#dc2626"};">${w1 >= 0 ? "+" : ""}${w1}</td>
      <td style="padding:5px 6px;font-size:11px;color:#64748b;">${escHtml(fl)}</td>
    </tr>`;
  }).join("");

  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:16px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <div style="max-width:860px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #cbd5e1;">
    <div style="background:#0f172a;color:#f8fafc;padding:18px 20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div>
          <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#38bdf8;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;">ThemePulse · Intraday Zanger Scan</div>
          <h1 style="margin:4px 0 0;font-size:20px;font-weight:800;color:#ffffff;">${escHtml(stamp?.pretty || "")}</h1>
        </div>
        <a href="${url}/?view=zanger" style="display:inline-block;background:#22c55e;color:#052e16;font-weight:800;font-size:12px;padding:9px 14px;border-radius:6px;text-decoration:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">Open Live Zanger Tab →</a>
      </div>
      <div style="margin-top:12px;font-size:12px;color:#cbd5e1;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
        <strong style="color:#fbbf24;">${bos.length}</strong> Breakouts &nbsp;·&nbsp;
        <strong style="color:#4ade80;">${movers.length}</strong> All Movers &nbsp;·&nbsp;
        <strong style="color:#38bdf8;">${leadCount}</strong> Leading Layers &nbsp;·&nbsp;
        <strong style="color:#a78bfa;">${emergCount}</strong> Emerging Layers
      </div>
    </div>

    <div style="padding:18px 20px;">
      <h2 style="margin:0 0 10px;font-size:15px;color:#0f172a;">1. Breakouts &amp; Volume Movers <span style="font-weight:400;font-size:12px;color:#64748b;">(Zanger · SB 4% · SB $ · QMAG)</span></h2>
      ${movers.length === 0
        ? `<p style="color:#64748b;font-size:13px;background:#f8fafc;padding:14px;border-radius:6px;border:1px solid #e2e8f0;">No stocks currently pass breakout or ZVR ≥ 1.5x volume surge criteria.</p>`
        : `<div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead>
              <tr style="background:#f8fafc;border-bottom:2px solid #cbd5e1;color:#475569;font-size:10px;text-transform:uppercase;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
                <th style="padding:7px 6px;text-align:left;">Sig</th>
                <th style="padding:7px 6px;text-align:left;">Ticker</th>
                <th style="padding:7px 6px;text-align:left;">Theme · Layer</th>
                <th style="padding:7px 6px;text-align:right;">ADR</th>
                <th style="padding:7px 6px;text-align:right;">Chg%</th>
                <th style="padding:7px 6px;text-align:right;">ZVR</th>
                <th style="padding:7px 6px;text-align:right;">CR%</th>
                <th style="padding:7px 6px;text-align:right;">RS</th>
                <th style="padding:7px 6px;text-align:right;">EPS</th>
                <th style="padding:7px 6px;text-align:right;">Off 52wH</th>
                <th style="padding:7px 6px;text-align:right;">Score</th>
              </tr>
            </thead>
            <tbody>${moverRows}</tbody>
          </table>
        </div>`}

      ${movers.length > 0 ? `
      <h2 style="margin:20px 0 8px;font-size:15px;color:#0f172a;">2. Catalyst Check <span style="font-weight:400;font-size:12px;color:#64748b;">(Top Movers)</span></h2>
      <ul style="margin:0;padding-left:18px;font-size:12px;color:#334155;">${catalystItems}</ul>` : ""}

      ${layerRows ? `
      <h2 style="margin:20px 0 8px;font-size:15px;color:#0f172a;">3. Leading Themes &amp; Layers</h2>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="background:#f8fafc;border-bottom:2px solid #cbd5e1;color:#475569;font-size:10px;text-transform:uppercase;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
              <th style="padding:6px;text-align:left;">Theme</th>
              <th style="padding:6px;text-align:left;">Layer</th>
              <th style="padding:6px;text-align:left;">Status</th>
              <th style="padding:6px;text-align:right;">Rank</th>
              <th style="padding:6px;text-align:right;">1W Δ</th>
              <th style="padding:6px;text-align:left;">Flags</th>
            </tr>
          </thead>
          <tbody>${layerRows}</tbody>
        </table>
      </div>` : ""}
    </div>

    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:12px 20px;font-size:11px;color:#64748b;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
      ${escHtml(mode || "")} &nbsp;·&nbsp; Session ${escHtml(clock?.session || "")} &nbsp;·&nbsp; Pipeline ${escHtml(pipelineDate || "unknown")}
    </div>
  </div>
</body>
</html>`;
}

function buildMarkdown({ stamp, mode, clock, pipelineDate, leadingLayers, emergingLayers, zangerMovers, themeLeaders, headlines }) {
  const lines = [];
  lines.push(`# ThemePulse Zanger & Leadership Scan — ${stamp.pretty}`);
  lines.push("");
  lines.push(`- **Mode**: ${mode}`);
  lines.push(`- **Session**: ${clock.session} (${clock.rth ? "RTH Live" : "Outside RTH"}) · **Pipeline**: ${pipelineDate || "unknown"}`);
  lines.push(`- **Summary**: ${leadingLayers.length} leading layers · ${emergingLayers.length} confirmed emerging layers · ${zangerMovers.length} Dan Zanger volume movers`);
  lines.push("");

  lines.push("## 1. Breakouts & Intraday Volume Movers (Zanger · Stockbee 4% / $ · Qullamaggie)");
  lines.push("");
  if (!zangerMovers.length) {
    lines.push("_No stocks currently pass Zanger, Stockbee 4%/$, Qullamaggie breakout, or ZVR ≥ 1.5x volume surge criteria._");
  } else {
    lines.push("| Signal | Ticker | Theme · Layer | ADR | Chg% | ZVR | CR% | RS | EPS | Off 52wH | Score |");
    lines.push("|--------|--------|---------------|----:|-----:|----:|----:|---:|----:|---------:|------:|");
    for (const m of zangerMovers.slice(0, 25)) {
      const sig = m.breakoutTypes?.length ? `🔥 ${m.breakoutTypes.join("+")}` : m.rsl ? "🔵 RSL" : "⚡ VOL";
      const tierBadge = m.tier === "lead" ? " ⭐" : m.tier === "emerg" ? " 🌱" : "";
      const epsStr = m.eps != null ? `${m.eps}${m.epsAccel ? "▲" : ""}` : "—";
      lines.push(
        `| ${sig} | **${m.ticker}**${tierBadge} | ${m.theme} · ${m.layer} | ${m.adr != null ? m.adr.toFixed(1) + "%" : "—"} | ${fmtPct(m.chg)} | **${m.zvr != null ? m.zvr.toFixed(2) + "x" : "—"}** | ${m.cr != null ? m.cr + "%" : "—"} | ${m.rs} | ${epsStr} | ${fmtPct(m.off52)} | ${m.score.toFixed(1)} |`
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
    lines.push("| Ticker | Theme · Layer | ADR | Chg% | ZVR | RS | EPS | Off 52wH | Notes |");
    lines.push("|--------|---------------|----:|-----:|----:|---:|----:|---------:|-------|");
    for (const m of themeLeaders.slice(0, 25)) {
      const epsStr = m.eps != null ? `${m.eps}${m.epsAccel ? "▲" : ""}` : "—";
      const notes = [m.isBreakout && "Breakout", !m.isBreakout && m.qualifiesZanger && "ZVR Surge", m.rsl && "RS Line New High"].filter(Boolean).join(", ") || "—";
      lines.push(
        `| **${m.ticker}** ⭐ | ${m.theme} · ${m.layer} | ${m.adr != null ? m.adr.toFixed(1) + "%" : "—"} | ${fmtPct(m.chg)} | ${m.zvr != null ? m.zvr.toFixed(2) + "x" : "—"} | ${m.rs} | ${epsStr} | ${fmtPct(m.off52)} | ${notes} |`
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
    if (tiers.leaders.has(t) || tiers.emerging.has(t) || (s.rs_rank ?? 0) >= 70 || l?.st === "lead" || l?.st === "emerg") {
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
    .sort((a, b) => (b.breakoutTypes?.length || 0) - (a.breakoutTypes?.length || 0) || b.score - a.score);

  const themeLeaders = scored
    .filter((r) => r.tier === "lead" && r.layerStatus === "lead")
    .sort((a, b) => b.rs - a.rs || (b.eps ?? 0) - (a.eps ?? 0) || (b.zvr ?? 0) - (a.zvr ?? 0));

  const headlines = token && zangerMovers.length
    ? await fetchTickerHeadlines(zangerMovers.slice(0, 8).map((m) => m.ticker), token)
    : new Map();

  const stamp = formatEtStamp(now);
  const clock = etClock(now);
  const scanCtx = {
    stamp,
    mode,
    clock,
    pipelineDate: dash.date,
    leadingLayers,
    emergingLayers,
    zangerMovers,
    themeLeaders,
    headlines,
  };
  const markdown = buildMarkdown(scanCtx);
  const emailSubject = buildEmailSubject(scanCtx);
  const emailHtml = buildEmailHtml(scanCtx);

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
    breakoutCount: zangerMovers.filter((m) => m.isBreakout).length,
    moverCount: zangerMovers.length,
    emailSubject,
    emailHtml,
    markdown,
  };
}

function parseCliArgs(argv) {
  const flags = new Set();
  let emailOut = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--email-out" && argv[i + 1]) {
      emailOut = argv[++i];
    } else if (a.startsWith("--email-out=")) {
      emailOut = a.slice("--email-out=".length);
    } else {
      flags.add(a);
    }
  }
  return { flags, emailOut };
}

// CLI entrypoint
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { flags, emailOut } = parseCliArgs(process.argv.slice(2));
  const forceSend = flags.has("--force-send");

  if (flags.has("--market-hours-only") && !forceSend) {
    const win = isMarketScanWindow(new Date());
    if (!win.open) {
      console.error(`Skipping scan (${win.reason} at ${win.et}).`);
      if (emailOut) {
        fs.mkdirSync(emailOut, { recursive: true });
        fs.writeFileSync(
          path.join(emailOut, "meta.json"),
          JSON.stringify({ shouldSend: false, reason: win.reason, subject: "", breakoutCount: 0, moverCount: 0, et: win.et }, null, 2),
          "utf8"
        );
      }
      process.exit(0);
    }
  }

  const res = await runZangerScan({
    offline: flags.has("--offline"),
    write: !flags.has("--no-write"),
  });

  if (emailOut) {
    fs.mkdirSync(emailOut, { recursive: true });
    const shouldSend = forceSend || res.moverCount > 0;
    const reason = res.moverCount > 0 ? "movers_found" : forceSend ? "forced" : "no_movers";
    fs.writeFileSync(path.join(emailOut, "email.html"), res.emailHtml, "utf8");
    fs.writeFileSync(path.join(emailOut, "email.txt"), res.markdown, "utf8");
    fs.writeFileSync(
      path.join(emailOut, "meta.json"),
      JSON.stringify({
        shouldSend,
        reason,
        subject: res.emailSubject,
        breakoutCount: res.breakoutCount,
        moverCount: res.moverCount,
        et: res.stamp.pretty,
      }, null, 2),
      "utf8"
    );
    console.error(`Email bundle written to ${emailOut} (shouldSend=${shouldSend}, reason=${reason}, movers=${res.moverCount}, breakouts=${res.breakoutCount})`);
  }

  if (flags.has("--json")) {
    console.log(JSON.stringify({ ...res, markdown: undefined, emailHtml: undefined }, null, 2));
  } else {
    console.log(res.markdown);
    if (res.reportPath) console.error(`\nSaved report: ${res.reportPath}`);
  }
}
