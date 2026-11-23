// Pure math and filtering helpers for MarketBreadthCard charts and Stage Analysis drawer.
// Kept JSX- and DOM-free so it can be unit-tested directly under Node.

import { classifyWeinsteinStage } from "../lead/math.js";

const MCCLELLAN_K19 = 2 / 20; // 0.10 (19-day EMA)
const MCCLELLAN_K39 = 2 / 40; // 0.05 (39-day EMA)

/**
 * Build a running cumulative Advance − Decline series from daily ad_history rows.
 * Appends a live point ("Today (Live)") when liveAdvDec?.isLive and today is not yet in adHistory.
 *
 * @param {Array<{date:string, adv:number, dec:number}>} adHistory
 * @param {{adv:number, dec:number, isLive?:boolean}|null} [liveAdvDec]
 * @param {string|null} [todayStr]
 * @returns {Array<{date:string, net:number, cumAd:number, adv:number, dec:number, isLive:boolean}>}
 */
export function buildCumulativeAdSeries(adHistory, liveAdvDec = null, todayStr = null) {
  const rows = [];
  let cumAd = 0;
  let lastDate = null;

  for (const d of Array.isArray(adHistory) ? adHistory : []) {
    if (!d?.date || typeof d.adv !== "number" || typeof d.dec !== "number") continue;
    if (!Number.isFinite(d.adv) || !Number.isFinite(d.dec)) continue;
    const net = d.adv - d.dec;
    cumAd += net;
    lastDate = d.date;
    rows.push({
      date: d.date,
      net,
      cumAd,
      adv: d.adv,
      dec: d.dec,
      isLive: false,
    });
  }

  if (
    liveAdvDec?.isLive &&
    typeof liveAdvDec.adv === "number" &&
    typeof liveAdvDec.dec === "number" &&
    Number.isFinite(liveAdvDec.adv) &&
    Number.isFinite(liveAdvDec.dec) &&
    lastDate !== todayStr
  ) {
    const net = liveAdvDec.adv - liveAdvDec.dec;
    cumAd += net;
    rows.push({
      date: "Today (Live)",
      net,
      cumAd,
      adv: liveAdvDec.adv,
      dec: liveAdvDec.dec,
      isLive: true,
    });
  }

  return rows;
}

/**
 * Build Ratio-Adjusted McClellan Oscillator (19-EMA − 39-EMA of 1000*(adv-dec)/(adv+dec))
 * and running McClellan Summation Index series, matching breadth.json's qulla.mcclellan.
 * Appends a live point ("Today (Live)") when liveAdvDec?.isLive and today is not yet in adHistory.
 *
 * @param {Array<{date:string, adv:number, dec:number}>} adHistory
 * @param {{adv:number, dec:number, isLive?:boolean}|null} [liveAdvDec]
 * @param {string|null} [todayStr]
 * @returns {Array<{date:string, osc:number, summation:number, isLive:boolean}>}
 */
export function buildMcClellanSeries(adHistory, liveAdvDec = null, todayStr = null) {
  const inputs = [];
  let lastDate = null;

  for (const d of Array.isArray(adHistory) ? adHistory : []) {
    if (!d?.date || typeof d.adv !== "number" || typeof d.dec !== "number") continue;
    if (!Number.isFinite(d.adv) || !Number.isFinite(d.dec)) continue;
    lastDate = d.date;
    inputs.push({ date: d.date, adv: d.adv, dec: d.dec, isLive: false });
  }

  if (
    liveAdvDec?.isLive &&
    typeof liveAdvDec.adv === "number" &&
    typeof liveAdvDec.dec === "number" &&
    Number.isFinite(liveAdvDec.adv) &&
    Number.isFinite(liveAdvDec.dec) &&
    lastDate !== todayStr
  ) {
    inputs.push({
      date: "Today (Live)",
      adv: liveAdvDec.adv,
      dec: liveAdvDec.dec,
      isLive: true,
    });
  }

  if (inputs.length === 0) return [];

  const out = [];
  let ema19 = 0;
  let ema39 = 0;
  let summation = 0;

  for (let i = 0; i < inputs.length; i++) {
    const { date, adv, dec, isLive } = inputs[i];
    const tot = adv + dec;
    const rana = tot > 0 ? (1000 * (adv - dec)) / tot : 0;
    if (i === 0) {
      ema19 = rana;
      ema39 = rana;
    } else {
      ema19 = rana * MCCLELLAN_K19 + ema19 * (1 - MCCLELLAN_K19);
      ema39 = rana * MCCLELLAN_K39 + ema39 * (1 - MCCLELLAN_K39);
    }
    const rawOsc = ema19 - ema39;
    summation += rawOsc;
    out.push({
      date,
      osc: Math.round(rawOsc * 10) / 10,
      summation: Math.round(summation),
      isLive,
    });
  }

  return out;
}

/**
 * Extract daily % above moving-average series ("p20" | "p50" | "p200") from breadth.history.
 * Appends a live point ("Today (Live)") when liveVal is finite and today is not yet in history.
 *
 * @param {Array<{date:string, p20?:number, p50?:number, p200?:number}>} history
 * @param {"p20"|"p50"|"p200"} key
 * @param {number|null} [liveVal]
 * @param {string|null} [todayStr]
 * @returns {Array<{date:string, pct:number, isLive:boolean}>}
 */
export function buildMaBreadthSeries(history, key, liveVal = null, todayStr = null) {
  if (!key) return [];
  const rows = [];
  let lastDate = null;

  for (const d of Array.isArray(history) ? history : []) {
    if (!d?.date) continue;
    const val = d[key];
    if (typeof val !== "number" || !Number.isFinite(val)) continue;
    lastDate = d.date;
    rows.push({
      date: d.date,
      pct: Math.max(0, Math.min(100, val)),
      isLive: false,
    });
  }

  if (typeof liveVal === "number" && Number.isFinite(liveVal) && lastDate !== todayStr) {
    rows.push({
      date: "Today (Live)",
      pct: Math.max(0, Math.min(100, liveVal)),
      isLive: true,
    });
  }

  return rows;
}

/**
 * Filter and sort stocks belonging to a Stan Weinstein stage (1 | 2 | 3 | 4).
 * Optionally filters to leading/emerging themes and minimum RS rank.
 * Sorted by rs_rank descending, then change_pct descending, then ticker ascending.
 *
 * @param {Record<string, object>|Array<object>} stockMap
 * @param {1|2|3|4} stageNum
 * @param {{tickerLayer?:Record<string, {theme?:string, themeId?:string, name?:string, st?:string}>, leadingOnly?:boolean, minRs?:number}} [opts]
 * @returns {Array<object>}
 */
export function filterStageStocks(stockMap, stageNum, opts = {}) {
  if (!stockMap || ![1, 2, 3, 4].includes(stageNum)) return [];
  const { tickerLayer = null, leadingOnly = false, minRs = 0 } = opts || {};

  const entries = Array.isArray(stockMap)
    ? stockMap.map((s) => [s?.ticker, s])
    : Object.entries(stockMap);

  const matches = [];
  for (const [key, s] of entries) {
    if (!s) continue;
    const ticker = s.ticker || key;
    if (!ticker) continue;
    if (classifyWeinsteinStage(s) !== stageNum) continue;

    const layer = tickerLayer?.[ticker] || null;
    if (leadingOnly && layer?.st !== "lead" && layer?.st !== "emerg") continue;

    if (typeof minRs === "number" && minRs > 0) {
      if (typeof s.rs_rank !== "number" || !Number.isFinite(s.rs_rank) || s.rs_rank < minRs) {
        continue;
      }
    }

    matches.push({
      ...s,
      ticker,
      stage: stageNum,
      layer,
    });
  }

  const numOrNegInf = (v) => (typeof v === "number" && Number.isFinite(v) ? v : -Infinity);
  matches.sort((a, b) => {
    const rsDiff = numOrNegInf(b.rs_rank) - numOrNegInf(a.rs_rank);
    if (rsDiff !== 0) return rsDiff;
    const chgDiff = numOrNegInf(b.change_pct) - numOrNegInf(a.change_pct);
    if (chgDiff !== 0) return chgDiff;
    return String(a.ticker).localeCompare(String(b.ticker));
  });

  return matches;
}
