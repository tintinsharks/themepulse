#!/usr/bin/env node
// Syncs daily Nasdaq-100 (QQQ) breadth history (p20, p50, p200, adv, dec, qqq close)
// into public/data/qqq_breadth_history.json.
//
// Usage:
//   node scripts/sync-qqq-breadth-history.mjs                  # merge current dashboard_data.json
//   node scripts/sync-qqq-breadth-history.mjs --backfill-yahoo # fetch 5y daily closes from Yahoo -> 3y exact history

import fs from "node:fs";
import path from "node:path";
import { NDX_TICKERS } from "../src/lead/qqqMath.js";

const ROOT = process.cwd();
const DASH_PATH = path.join(ROOT, "public", "dashboard_data.json");
const OUT_PATH = path.join(ROOT, "public", "data", "qqq_breadth_history.json");
const BACKFILL_YAHOO = process.argv.includes("--backfill-yahoo");
const KEEP_TRADING_DAYS = 780; // ~3.1 years of trading sessions

const NDX_SET = new Set(NDX_TICKERS);

function isValidDate(d) {
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
}

function isWeekday(d) {
  const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
  return dow !== 0 && dow !== 6;
}

function normalizeRow(r) {
  if (!r || !isValidDate(r.date) || !isWeekday(r.date)) return null;
  const p20 = Number(r.p20);
  const p50 = Number(r.p50);
  const p200 = Number(r.p200);
  if (!Number.isFinite(p50)) return null;
  return {
    date: r.date,
    qqq: typeof r.qqq === "number" && Number.isFinite(r.qqq) ? +r.qqq.toFixed(2) : null,
    p20: Number.isFinite(p20) ? +p20.toFixed(1) : null,
    p50: +p50.toFixed(1),
    p200: Number.isFinite(p200) ? +p200.toFixed(1) : null,
    adv: typeof r.adv === "number" && Number.isFinite(r.adv) ? Math.round(r.adv) : null,
    dec: typeof r.dec === "number" && Number.isFinite(r.dec) ? Math.round(r.dec) : null,
  };
}

async function fetchYahooSeries(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5y&interval=1d`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) {
        if (resp.status === 429) await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
        continue;
      }
      const json = await resp.json();
      const res = json?.chart?.result?.[0];
      const ts = res?.timestamp || [];
      const closes = res?.indicators?.quote?.[0]?.close || [];
      const out = [];
      for (let i = 0; i < ts.length; i++) {
        const c = closes[i];
        if (typeof c !== "number" || !Number.isFinite(c) || c <= 0) continue;
        // Convert UTC timestamp to ET calendar date
        const dt = new Date(ts[i] * 1000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
        if (!isValidDate(dt) || !isWeekday(dt)) continue;
        if (out.length && out[out.length - 1].date === dt) {
          out[out.length - 1].close = c;
        } else {
          out.push({ date: dt, close: c });
        }
      }
      return out;
    } catch {
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  return [];
}

async function backfillFromYahoo(byDate) {
  const tickers = ["QQQ", ...NDX_TICKERS];
  const seriesMap = new Map();
  const CONC = 8;
  let idx = 0;
  let okCount = 0;

  async function worker() {
    while (idx < tickers.length) {
      const tk = tickers[idx++];
      const rows = await fetchYahooSeries(tk);
      if (rows.length >= 30) {
        seriesMap.set(tk, rows);
        okCount++;
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, () => worker()));
  console.log(`Fetched Yahoo 5y daily closes for ${okCount}/${tickers.length} symbols`);

  const qqqRows = seriesMap.get("QQQ") || [];
  if (qqqRows.length < 250) {
    throw new Error(`Insufficient QQQ bars from Yahoo (${qqqRows.length})`);
  }

  // Build per-date accumulator using QQQ's trading calendar (last ~760 trading days)
  const calDates = qqqRows.slice(-KEEP_TRADING_DAYS).map((r) => r.date);
  const qqqByDate = new Map(qqqRows.map((r) => [r.date, r.close]));
  const acc = new Map();
  for (const dt of calDates) {
    acc.set(dt, { date: dt, qqq: qqqByDate.get(dt) ?? null, a20: 0, n20: 0, a50: 0, n50: 0, a200: 0, n200: 0, adv: 0, dec: 0 });
  }

  // Compute exact rolling 20/50/200 SMA & daily Adv/Dec for each constituent
  for (const tk of NDX_TICKERS) {
    const bars = seriesMap.get(tk);
    if (!bars || bars.length < 25) continue;
    let sum20 = 0, sum50 = 0, sum200 = 0;
    for (let i = 0; i < bars.length; i++) {
      const c = bars[i].close;
      sum20 += c;
      if (i >= 20) sum20 -= bars[i - 20].close;
      sum50 += c;
      if (i >= 50) sum50 -= bars[i - 50].close;
      sum200 += c;
      if (i >= 200) sum200 -= bars[i - 200].close;

      const bucket = acc.get(bars[i].date);
      if (!bucket) continue;
      if (i >= 19) {
        bucket.n20++;
        if (c > sum20 / 20) bucket.a20++;
      }
      if (i >= 49) {
        bucket.n50++;
        if (c > sum50 / 50) bucket.a50++;
      }
      if (i >= 199) {
        bucket.n200++;
        if (c > sum200 / 200) bucket.a200++;
      }
      if (i >= 1) {
        const prev = bars[i - 1].close;
        if (c > prev) bucket.adv++;
        else if (c < prev) bucket.dec++;
      }
    }
  }

  for (const b of acc.values()) {
    if (b.n50 < 60) continue;
    const row = normalizeRow({
      date: b.date,
      qqq: b.qqq,
      p20: b.n20 > 0 ? (b.a20 / b.n20) * 100 : null,
      p50: (b.a50 / b.n50) * 100,
      p200: b.n200 > 0 ? (b.a200 / b.n200) * 100 : null,
      adv: b.adv,
      dec: b.dec,
    });
    if (row) byDate.set(row.date, row);
  }
}

function mergeDashboardSnapshot(byDate) {
  if (!fs.existsSync(DASH_PATH)) return;
  try {
    const d = JSON.parse(fs.readFileSync(DASH_PATH, "utf8"));
    const stocks = d.stocks || [];
    const qqq = stocks.find((s) => s.ticker === "QQQ");
    const aapl = stocks.find((s) => s.ticker === "AAPL");
    const barDate = qqq?.last_bar_date || aapl?.last_bar_date || d.date;
    if (!isValidDate(barDate) || !isWeekday(barDate)) return;

    let n20 = 0, a20 = 0, n50 = 0, a50 = 0, n200 = 0, a200 = 0, adv = 0, dec = 0, cnt = 0;
    for (const s of stocks) {
      if (!NDX_SET.has(s.ticker)) continue;
      cnt++;
      if (s.sma20_pct != null) { n20++; if (s.sma20_pct > 0) a20++; }
      const p50 = s.sma50_pct ?? (s.above_50ma === 1 ? 1 : s.above_50ma === 0 ? -1 : null);
      if (p50 != null) { n50++; if (p50 > 0) a50++; }
      if (s.sma200_pct != null) { n200++; if (s.sma200_pct > 0) a200++; }
      if (s.change_pct != null) { if (s.change_pct > 0) adv++; else if (s.change_pct < 0) dec++; }
    }
    if (cnt < 70 || n50 < 60) return;

    const row = normalizeRow({
      date: barDate,
      qqq: qqq?.close ?? qqq?.price ?? null,
      p20: n20 > 0 ? (a20 / n20) * 100 : null,
      p50: (a50 / n50) * 100,
      p200: n200 > 0 ? (a200 / n200) * 100 : null,
      adv,
      dec,
    });
    if (row) byDate.set(row.date, row);
  } catch (err) {
    console.warn("Could not merge dashboard_data.json:", err.message);
  }
}

async function main() {
  const byDate = new Map();
  if (fs.existsSync(OUT_PATH)) {
    try {
      const existing = JSON.parse(fs.readFileSync(OUT_PATH, "utf8"));
      for (const r of existing?.history || []) {
        const row = normalizeRow(r);
        if (row) byDate.set(row.date, row);
      }
    } catch { /* start fresh */ }
  }

  if (BACKFILL_YAHOO) {
    await backfillFromYahoo(byDate);
  }
  mergeDashboardSnapshot(byDate);

  const history = [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-KEEP_TRADING_DAYS);

  const payload = {
    updated: history.length ? history[history.length - 1].date : null,
    count: history.length,
    history,
  };
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(
    `Wrote ${history.length} QQQ breadth sessions (${history[0]?.date || "—"} → ${history[history.length - 1]?.date || "—"}) to ${path.relative(ROOT, OUT_PATH)}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
