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

/**
 * Detect institutional breadth turning-point signals across historical daily data:
 *  1. 90% Up / 90% Down Days (adv/(adv+dec) >= 88% or <= 12% on >= 500 issues)
 *  2. Zweig Breadth Thrust (10-day EMA of adv/(adv+dec) rising from <40% to >61.5% within 10 sessions)
 *  3. McClellan Oversold / Overbought Hook (<= -60 turning up, or >= +60 turning down)
 *  4. SPX vs. Breadth Divergence (SPX near 20d high while Cum A/D or % > 50d SMA lags, or vice versa)
 *
 * @param {{
 *   adHistory?: Array<{date:string, adv:number, dec:number}>,
 *   history?: Array<{date:string, p50?:number}>,
 *   spxMap?: Map<string, number>|null,
 *   liveAdvDec?: {adv:number, dec:number, isLive?:boolean}|null,
 *   todayStr?: string|null,
 *   recentWindow?: number
 * }} params
 * @returns {{
 *   byDate: Map<string, Array<{type:string, short:string, label:string, tone:"good"|"warn"|"bad", chart:"ad"|"cum"|"mcclellan"|"p50", date:string, detail:string}>>,
 *   recent: Array<{type:string, short:string, label:string, tone:"good"|"warn"|"bad", chart:"ad"|"cum"|"mcclellan"|"p50", date:string, detail:string}>,
 *   all: Array<{type:string, short:string, label:string, tone:"good"|"warn"|"bad", chart:"ad"|"cum"|"mcclellan"|"p50", date:string, detail:string}>
 * }}
 */
export function detectBreadthSignals({
  adHistory = [],
  history = [],
  spxMap = null,
  liveAdvDec = null,
  todayStr = null,
  recentWindow = 10,
} = {}) {
  const byDate = new Map();
  const all = [];
  const pushSig = (sig) => {
    all.push(sig);
    const list = byDate.get(sig.date);
    if (list) list.push(sig);
    else byDate.set(sig.date, [sig]);
  };

  const cumSeries = buildCumulativeAdSeries(adHistory, liveAdvDec, todayStr);
  const mcSeries = buildMcClellanSeries(adHistory, liveAdvDec, todayStr);

  // 1 & 2. 90% Up/Down days + Zweig Breadth Thrust (10-day EMA of Adv / (Adv + Dec))
  const k10 = 2 / 11;
  let zbtEma = null;
  let lastBelow40Idx = -999;
  let lastZbtIdx = -999;

  for (let i = 0; i < cumSeries.length; i++) {
    const d = cumSeries[i];
    const tot = d.adv + d.dec;
    if (tot <= 0) continue;
    const ratio = d.adv / tot;
    const pct = Math.round(ratio * 1000) / 10;

    if (tot >= 500) {
      if (ratio >= 0.88) {
        pushSig({
          type: "ninety_up",
          short: "90↑",
          label: "90% Up Day",
          tone: "good",
          chart: "ad",
          date: d.date,
          detail: `${pct}% advancing (${d.adv.toLocaleString()} vs ${d.dec.toLocaleString()}) — institutional accumulation thrust`,
        });
      } else if (ratio <= 0.12) {
        pushSig({
          type: "ninety_down",
          short: "90↓",
          label: "90% Down Day",
          tone: "bad",
          chart: "ad",
          date: d.date,
          detail: `${(100 - pct).toFixed(1)}% declining (${d.dec.toLocaleString()} vs ${d.adv.toLocaleString()}) — capitulation/liquidation`,
        });
      }
    }

    zbtEma = zbtEma == null ? ratio : ratio * k10 + zbtEma * (1 - k10);
    if (zbtEma < 0.40) lastBelow40Idx = i;
    if (
      zbtEma > 0.615 &&
      i - lastBelow40Idx <= 10 &&
      i - lastBelow40Idx >= 1 &&
      i - lastZbtIdx > 15
    ) {
      lastZbtIdx = i;
      pushSig({
        type: "zbt",
        short: "ZBT",
        label: "Zweig Thrust",
        tone: "good",
        chart: "ad",
        date: d.date,
        detail: `10d breadth EMA surged from <40% to ${(zbtEma * 100).toFixed(1)}% within ${i - lastBelow40Idx}d — rare institutional thrust`,
      });
    }
  }

  // 3. McClellan Oversold / Overbought Hooks
  for (let i = 2; i < mcSeries.length; i++) {
    const prev2 = mcSeries[i - 2];
    const prev = mcSeries[i - 1];
    const cur = mcSeries[i];
    if (prev.osc <= -60 && prev.osc <= prev2.osc && cur.osc > prev.osc) {
      pushSig({
        type: "mc_os_hook",
        short: "MC↑",
        label: "McClellan Hook ↑",
        tone: "good",
        chart: "mcclellan",
        date: cur.date,
        detail: `McClellan turned up from oversold ${prev.osc.toFixed(1)} to ${cur.osc.toFixed(1)}`,
      });
    } else if (prev.osc >= 60 && prev.osc >= prev2.osc && cur.osc < prev.osc) {
      pushSig({
        type: "mc_ob_hook",
        short: "MC↓",
        label: "McClellan Hook ↓",
        tone: "warn",
        chart: "mcclellan",
        date: cur.date,
        detail: `McClellan rolled over from overbought +${prev.osc.toFixed(1)} to +${cur.osc.toFixed(1)}`,
      });
    }
  }

  // 4. SPX vs Breadth Divergences (Cum A/D and % Above 50d SMA)
  if (spxMap && spxMap.size >= 20 && cumSeries.length >= 20) {
    const p50ByDate = new Map();
    for (const h of Array.isArray(history) ? history : []) {
      if (h?.date && typeof h.p50 === "number" && Number.isFinite(h.p50)) {
        p50ByDate.set(h.date, h.p50);
      }
    }

    const aligned = [];
    for (const d of cumSeries) {
      const lookupDate = d.isLive ? todayStr : d.date;
      const spx = lookupDate ? spxMap.get(lookupDate) : null;
      if (typeof spx !== "number" || !Number.isFinite(spx)) continue;
      aligned.push({
        date: d.date,
        spx,
        cumAd: d.cumAd,
        p50: p50ByDate.get(d.date) ?? null,
      });
    }

    let lastBearIdx = -999;
    let lastBullIdx = -999;
    const win = 20;
    for (let i = win; i < aligned.length; i++) {
      const cur = aligned[i];
      const slice = aligned.slice(i - win, i + 1);
      let hiSpx = -Infinity, loSpx = Infinity;
      let hiAd = -Infinity, loAd = Infinity, hiAdIdx = -1, loAdIdx = -1;
      let hiP50 = -Infinity, loP50 = Infinity, hiP50Idx = -1, loP50Idx = -1;
      for (let j = 0; j < slice.length; j++) {
        const s = slice[j];
        if (s.spx > hiSpx) hiSpx = s.spx;
        if (s.spx < loSpx) loSpx = s.spx;
        if (s.cumAd > hiAd) { hiAd = s.cumAd; hiAdIdx = j; }
        if (s.cumAd < loAd) { loAd = s.cumAd; loAdIdx = j; }
        if (s.p50 != null) {
          if (s.p50 > hiP50) { hiP50 = s.p50; hiP50Idx = j; }
          if (s.p50 < loP50) { loP50 = s.p50; loP50Idx = j; }
        }
      }
      const adSpan = hiAd - loAd;
      const spxRising5 = cur.spx > aligned[i - 5].spx;
      const spxFalling5 = cur.spx < aligned[i - 5].spx;

      // Bearish divergence: SPX near 20d high while breadth lags meaningfully below 20d peak
      if (i - lastBearIdx >= 6 && cur.spx >= hiSpx * 0.995 && spxRising5) {
        const adLag = adSpan > 500 && hiAdIdx <= slice.length - 4 && (hiAd - cur.cumAd) >= adSpan * 0.25;
        const p50Lag = cur.p50 != null && hiP50 > -Infinity && hiP50Idx <= slice.length - 4 && (hiP50 - cur.p50) >= 6;
        if (adLag || p50Lag) {
          lastBearIdx = i;
          const why = [
            adLag ? "Cum A/D lagging 20d peak" : null,
            p50Lag ? `>50d SMA at ${cur.p50.toFixed(0)}% vs ${hiP50.toFixed(0)}% peak` : null,
          ].filter(Boolean).join(" & ");
          pushSig({
            type: "div_bear",
            short: "DIV↓",
            label: "SPX Bear Div",
            tone: "bad",
            chart: adLag ? "cum" : "p50",
            date: cur.date,
            detail: `SPX near 20d high while ${why}`,
          });
        }
      }

      // Bullish divergence: SPX near 20d low while breadth holds meaningfully above 20d trough
      if (i - lastBullIdx >= 6 && cur.spx <= loSpx * 1.005 && spxFalling5) {
        const adHold = adSpan > 500 && loAdIdx <= slice.length - 4 && (cur.cumAd - loAd) >= adSpan * 0.25;
        const p50Hold = cur.p50 != null && loP50 < Infinity && loP50Idx <= slice.length - 4 && (cur.p50 - loP50) >= 6;
        if (adHold || p50Hold) {
          lastBullIdx = i;
          const why = [
            adHold ? "Cum A/D holding higher low" : null,
            p50Hold ? `>50d SMA at ${cur.p50.toFixed(0)}% vs ${loP50.toFixed(0)}% low` : null,
          ].filter(Boolean).join(" & ");
          pushSig({
            type: "div_bull",
            short: "DIV↑",
            label: "SPX Bull Div",
            tone: "good",
            chart: adHold ? "cum" : "p50",
            date: cur.date,
            detail: `SPX near 20d low while ${why}`,
          });
        }
      }
    }
  }

  // Recent signals (within the last `recentWindow` trading dates in cumSeries, newest first, unique by type)
  const recentDates = new Set(cumSeries.slice(-recentWindow).map((d) => d.date));
  const seenTypes = new Set();
  const recent = [];
  for (let i = all.length - 1; i >= 0; i--) {
    const s = all[i];
    if (!recentDates.has(s.date) || seenTypes.has(s.type)) continue;
    seenTypes.add(s.type);
    recent.push(s);
  }

  return { byDate, recent, all };
}

/**
 * Merge Stockbee 4% movers history (archive + monitor.history + monitor.current + optional live reading)
 * into a chronologically sorted series with Net (up - down), rolling 5D & 10D Stockbee ratios,
 * and 300+ thrust/capitulation flags.
 *
 * @param {Array<{date:string, up_4pct:number, down_4pct:number, t2108?:number}>} archiveRows
 * @param {{history?:Array<object>, current?:object}|null} [monitor]
 * @param {{up:number, dn:number, isLive?:boolean}|null} [liveM4]
 * @param {string|null} [todayStr]
 * @returns {Array<{date:string, pos:number, neg:number, net:number, ratio5d:number|null, ratio10d:number|null, thrust:"up"|"down"|null, t2108:number|null, isLive:boolean}>}
 */
export function buildStockbee4PctSeries(archiveRows, monitor = null, liveM4 = null, todayStr = null) {
  const byDate = new Map();
  const ingest = (raw) => {
    if (!raw?.date || typeof raw.date !== "string") return;
    const up = Number(raw.up_4pct);
    const dn = Number(raw.down_4pct);
    if (!Number.isFinite(up) || !Number.isFinite(dn)) return;
    if (up === 0 && dn === 0) return;
    byDate.set(raw.date, {
      date: raw.date,
      pos: Math.max(0, Math.round(up)),
      neg: Math.max(0, Math.round(dn)),
      t2108: typeof raw.t2108 === "number" && Number.isFinite(raw.t2108) ? raw.t2108 : null,
      isLive: false,
    });
  };

  for (const r of Array.isArray(archiveRows) ? archiveRows : []) ingest(r);
  for (const r of Array.isArray(monitor?.history) ? monitor.history : []) ingest(r);
  if (monitor?.current) ingest(monitor.current);

  const sorted = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const lastDate = sorted.length ? sorted[sorted.length - 1].date : null;

  if (
    liveM4?.isLive &&
    typeof liveM4.up === "number" &&
    typeof liveM4.dn === "number" &&
    Number.isFinite(liveM4.up) &&
    Number.isFinite(liveM4.dn) &&
    (liveM4.up > 0 || liveM4.dn > 0) &&
    lastDate !== todayStr
  ) {
    sorted.push({
      date: "Today (Live)",
      pos: Math.max(0, Math.round(liveM4.up)),
      neg: Math.max(0, Math.round(liveM4.dn)),
      t2108: null,
      isLive: true,
    });
  }

  const rollRatio = (idx, win) => {
    const start = Math.max(0, idx - win + 1);
    let u = 0;
    let d = 0;
    for (let j = start; j <= idx; j++) {
      u += sorted[j].pos;
      d += sorted[j].neg;
    }
    if (d <= 0) return u > 0 ? 9.99 : null;
    return Math.round((u / d) * 100) / 100;
  };

  return sorted.map((r, i) => {
    const net = r.pos - r.neg;
    const thrust =
      r.pos >= 300 && r.pos >= r.neg * 2
        ? "up"
        : r.neg >= 300 && r.neg >= r.pos * 2
          ? "down"
          : null;
    return {
      ...r,
      net,
      ratio5d: rollRatio(i, 5),
      ratio10d: rollRatio(i, 10),
      thrust,
    };
  });
}
