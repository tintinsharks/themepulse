// Pure Nasdaq-100 (QQQ) constituent universe, weight estimation, technicals,
// internals/breadth, and contribution math. Kept React/DOM-free for Node testing.

import {
  classifyWeinsteinStage,
  classifyWeinsteinStageFromBars,
  closingRange,
  ema,
  isHealthcareItem,
  rsLeads,
  sma,
  stockThrust,
  zvrFor,
} from "./math.js";
import { computeRvolAtTime } from "./pivot30mMath.js";

// Nasdaq-100 constituents with functional group tags for quick filtering & breakdown.
// Groups: mag7 | semi | soft | cons | health | ind
export const NDX_CONSTITUENTS = [
  // Mega-Cap / Mag 7
  { t: "NVDA", g: "mag7", also: ["semi"] },
  { t: "AAPL", g: "mag7" },
  { t: "MSFT", g: "mag7", also: ["soft"] },
  { t: "AMZN", g: "mag7", also: ["cons"] },
  { t: "META", g: "mag7", also: ["soft"] },
  { t: "GOOGL", g: "mag7", also: ["soft"], capShare: 0.5 },
  { t: "GOOG", g: "mag7", also: ["soft"], capShare: 0.5 },
  { t: "TSLA", g: "mag7", also: ["cons"] },

  // Semiconductors & Hardware
  { t: "AVGO", g: "semi" },
  { t: "AMD", g: "semi" },
  { t: "ASML", g: "semi" },
  { t: "QCOM", g: "semi" },
  { t: "TXN", g: "semi" },
  { t: "AMAT", g: "semi" },
  { t: "MU", g: "semi" },
  { t: "LRCX", g: "semi" },
  { t: "KLAC", g: "semi" },
  { t: "ADI", g: "semi" },
  { t: "INTC", g: "semi" },
  { t: "ARM", g: "semi" },
  { t: "MRVL", g: "semi" },
  { t: "NXPI", g: "semi" },
  { t: "MPWR", g: "semi" },
  { t: "MCHP", g: "semi" },
  { t: "ON", g: "semi" },
  { t: "GFS", g: "semi" },
  { t: "STX", g: "semi" },
  { t: "WDC", g: "semi" },
  { t: "CSCO", g: "semi" },
  { t: "CDW", g: "semi" },

  // Software, Cloud, Cyber & Internet
  { t: "PLTR", g: "soft" },
  { t: "NFLX", g: "soft", also: ["cons"] },
  { t: "INTU", g: "soft" },
  { t: "ADBE", g: "soft" },
  { t: "PANW", g: "soft" },
  { t: "CRWD", g: "soft" },
  { t: "APP", g: "soft" },
  { t: "SHOP", g: "soft", also: ["cons"] },
  { t: "SNPS", g: "soft" },
  { t: "CDNS", g: "soft" },
  { t: "FTNT", g: "soft" },
  { t: "ADSK", g: "soft" },
  { t: "WDAY", g: "soft" },
  { t: "TEAM", g: "soft" },
  { t: "DDOG", g: "soft" },
  { t: "ZS", g: "soft" },
  { t: "TTD", g: "soft" },
  { t: "MSTR", g: "soft" },
  { t: "ADP", g: "soft" },
  { t: "PAYX", g: "soft" },
  { t: "CTSH", g: "soft" },
  { t: "PYPL", g: "soft" },
  { t: "TTWO", g: "soft", also: ["cons"] },
  { t: "ROP", g: "soft" },
  { t: "VRSK", g: "soft" },
  { t: "CSGP", g: "soft" },
  { t: "TRI", g: "soft" },
  { t: "COIN", g: "soft" },

  // Consumer, Retail, Travel & Comms
  { t: "COST", g: "cons" },
  { t: "TMUS", g: "cons" },
  { t: "PEP", g: "cons" },
  { t: "BKNG", g: "cons" },
  { t: "MELI", g: "cons" },
  { t: "DASH", g: "cons" },
  { t: "ABNB", g: "cons" },
  { t: "MAR", g: "cons" },
  { t: "ORLY", g: "cons" },
  { t: "MDLZ", g: "cons" },
  { t: "ROST", g: "cons" },
  { t: "MNST", g: "cons" },
  { t: "SBUX", g: "cons" },
  { t: "PDD", g: "cons" },
  { t: "KDP", g: "cons" },
  { t: "KHC", g: "cons" },
  { t: "CCEP", g: "cons" },
  { t: "LULU", g: "cons" },
  { t: "CHTR", g: "cons" },
  { t: "CMCSA", g: "cons" },
  { t: "CPRT", g: "cons" },

  // Healthcare & Biotech
  { t: "ISRG", g: "health" },
  { t: "AMGN", g: "health" },
  { t: "GILD", g: "health" },
  { t: "VRTX", g: "health" },
  { t: "REGN", g: "health" },
  { t: "ALNY", g: "health" },
  { t: "INSM", g: "health" },
  { t: "IDXX", g: "health" },
  { t: "GEHC", g: "health" },
  { t: "DXCM", g: "health" },
  { t: "BIIB", g: "health" },
  { t: "AZN", g: "health" },

  // Industrials, Energy & Utilities
  { t: "LIN", g: "ind" },
  { t: "HON", g: "ind" },
  { t: "CEG", g: "ind" },
  { t: "AXON", g: "ind" },
  { t: "CTAS", g: "ind" },
  { t: "PCAR", g: "ind" },
  { t: "CSX", g: "ind" },
  { t: "FAST", g: "ind" },
  { t: "ODFL", g: "ind" },
  { t: "AEP", g: "ind" },
  { t: "XEL", g: "ind" },
  { t: "EXC", g: "ind" },
  { t: "FANG", g: "ind" },
  { t: "BKR", g: "ind" },
  { t: "FER", g: "ind" },
];

export const NDX_GROUPS = [
  { id: "mag7", label: "Mag 7", color: "#fbbf24" },
  { id: "semi", label: "Semis", color: "#38bdf8" },
  { id: "soft", label: "Software", color: "#c084fc" },
  { id: "cons", label: "Consumer", color: "#4ade80" },
  { id: "health", label: "Health", color: "#f472b6" },
  { id: "ind", label: "Ind / Energy", color: "#fb923c" },
];

export const NDX_TICKERS = NDX_CONSTITUENTS.map((c) => c.t);

// Compute normalized percentage weights from live/pipeline market caps.
// Applies Nasdaq-100 single-stock cap (~11.5%) and splits dual-class Alphabet (GOOGL/GOOG).
export function computeNdxWeights(constituents = NDX_CONSTITUENTS, stockMap = {}) {
  const raw = [];
  let total = 0;
  for (const c of constituents) {
    const s = stockMap?.[c.t];
    const mc = s?.market_cap_raw;
    const eff = typeof mc === "number" && Number.isFinite(mc) && mc > 0 ? mc * (c.capShare ?? 1) : 0;
    if (eff > 0) {
      raw.push({ t: c.t, eff });
      total += eff;
    }
  }
  const weights = {};
  if (total <= 0) {
    const eq = constituents.length ? +(100 / constituents.length).toFixed(2) : 0;
    for (const c of constituents) weights[c.t] = eq;
    return weights;
  }

  // Iterative cap at 11.5% so mega-cap weights stay close to Nasdaq-100 modified cap weighting
  const CAP = 11.5;
  const pct = {};
  for (const r of raw) pct[r.t] = (r.eff / total) * 100;
  for (let iter = 0; iter < 12; iter++) {
    let excess = 0;
    let uncappedSum = 0;
    for (const r of raw) {
      if (pct[r.t] > CAP) {
        excess += pct[r.t] - CAP;
        pct[r.t] = CAP;
      } else if (pct[r.t] < CAP) {
        uncappedSum += pct[r.t];
      }
    }
    if (excess <= 0.01 || uncappedSum <= 0) break;
    for (const r of raw) {
      if (pct[r.t] < CAP) pct[r.t] += excess * (pct[r.t] / uncappedSum);
    }
  }

  for (const c of constituents) {
    weights[c.t] = pct[c.t] != null ? +pct[c.t].toFixed(2) : 0;
  }
  return weights;
}

// Compute 14-day Wilder/simple ATR from OHLC bars
export function computeAtr14(bars) {
  if (!Array.isArray(bars) || bars.length < 2) return null;
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const cur = bars[i];
    const prev = bars[i - 1];
    if (cur?.high == null || cur?.low == null || prev?.close == null) continue;
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close)
    );
    if (Number.isFinite(tr)) trs.push(tr);
  }
  if (!trs.length) return null;
  const tail = trs.slice(-14);
  return tail.reduce((a, b) => a + b, 0) / tail.length;
}

// Compute comprehensive QQQ technicals, EMA/SMA levels, ATR extensions, expected moves, and stops
export function computeQqqTechnicals(bars, liveQuote = null, stockEntry = null) {
  const cleanBars = Array.isArray(bars) ? bars.filter((b) => b && typeof b.close === "number" && Number.isFinite(b.close)) : [];
  const closes = cleanBars.map((b) => b.close);
  const lastBar = cleanBars.length ? cleanBars[cleanBars.length - 1] : null;
  const prevBar = cleanBars.length >= 2 ? cleanBars[cleanBars.length - 2] : null;

  const px = liveQuote?.rthPrice ?? liveQuote?.price ?? lastBar?.close ?? stockEntry?.close ?? null;
  const prevClose = liveQuote?.previousClose ?? prevBar?.close ?? null;
  const chgPct = liveQuote?.change ?? (px != null && prevClose ? ((px / prevClose) - 1) * 100 : stockEntry?.change_pct ?? null);
  const openPx = liveQuote?.open ?? lastBar?.open ?? null;
  const fromOpenPct = px != null && openPx ? ((px / openPx) - 1) * 100 : null;
  const dayHigh = liveQuote?.dayHigh ?? lastBar?.high ?? null;
  const dayLow = liveQuote?.dayLow ?? lastBar?.low ?? null;
  const cr = closingRange(liveQuote, stockEntry) ?? (dayHigh != null && dayLow != null && dayHigh > dayLow && px != null
    ? Math.round(((px - dayLow) / (dayHigh - dayLow)) * 100)
    : null);

  const lastVal = (arr) => (arr && arr.length ? arr[arr.length - 1] : null);
  const ema8 = closes.length >= 8 ? lastVal(ema(closes, 8)) : null;
  const ema10 = closes.length >= 10 ? lastVal(ema(closes, 10)) : null;
  const ema21 = closes.length >= 21 ? lastVal(ema(closes, 21)) : null;
  const sma50 = closes.length >= 50 ? lastVal(sma(closes, 50)) : (stockEntry?.sma50_lvl ?? null);
  const sma200 = closes.length >= 200 ? lastVal(sma(closes, 200)) : (stockEntry?.sma200_lvl ?? null);

  const atr14 = computeAtr14(cleanBars) ?? (px && stockEntry?.adr20 ? (px * stockEntry.adr20) / 100 : null);
  const atrPct = atr14 != null && px ? (atr14 / px) * 100 : (stockEntry?.adr20 ?? null);

  const maStat = (label, lvl) => {
    if (lvl == null || px == null || lvl === 0) return { label, level: lvl, pct: null, atrX: null, above: null };
    const pct = ((px / lvl) - 1) * 100;
    const atrX = atr14 && atr14 > 0 ? (px - lvl) / atr14 : null;
    return {
      label,
      level: +lvl.toFixed(2),
      pct: +pct.toFixed(2),
      atrX: atrX != null ? +atrX.toFixed(2) : null,
      above: px >= lvl,
    };
  };

  const mas = [
    maStat("8 EMA", ema8),
    maStat("10 EMA", ema10),
    maStat("21 EMA", ema21),
    maStat("50 SMA", sma50),
    maStat("200 SMA", sma200),
  ];

  let emaStack = "MIXED";
  if (px != null && ema8 != null && ema21 != null && sma50 != null) {
    if (px > ema8 && ema8 > ema21 && ema21 > sma50) emaStack = "BULLISH";
    else if (px < ema8 && ema8 < ema21 && ema21 < sma50) emaStack = "BEARISH";
  }

  const stage = cleanBars.length >= 200
    ? classifyWeinsteinStageFromBars(cleanBars)
    : classifyWeinsteinStage(stockEntry);

  const recent20 = cleanBars.slice(-20);
  const high20 = recent20.length ? Math.max(...recent20.map((b) => b.high ?? b.close)) : null;
  const low20 = recent20.length ? Math.min(...recent20.map((b) => b.low ?? b.close)) : null;
  const recent252 = cleanBars.slice(-252);
  const high52 = Math.max(
    recent252.length ? Math.max(...recent252.map((b) => b.high ?? b.close)) : 0,
    liveQuote?.yearHigh || 0,
    stockEntry?.hi52_lvl || 0
  ) || null;
  const low52 = Math.min(
    ...[
      recent252.length ? Math.min(...recent252.map((b) => b.low ?? b.close)) : Infinity,
      liveQuote?.yearLow || Infinity,
      stockEntry?.lo52_lvl || Infinity,
    ].filter((v) => v > 0 && Number.isFinite(v))
  );
  const off52Pct = high52 && px ? ((px / high52) - 1) * 100 : (stockEntry?.off_52w_high ?? null);

  // Use yesterday's completed bar for Prev High / Prev Low (if live quote is from today, lastBar may be yesterday or today)
  const refPrevBar = prevBar || lastBar;
  const prevHigh = refPrevBar?.high ?? null;
  const prevLow = refPrevBar?.low ?? null;

  const expectedDayMove = atr14 != null ? +atr14.toFixed(2) : null;
  const expectedWeekMove = atr14 != null ? +(atr14 * Math.sqrt(5)).toFixed(2) : null;

  const stopZone = (label, stopPx) => {
    if (stopPx == null || px == null || !Number.isFinite(stopPx)) return { label, price: null, distPct: null };
    return {
      label,
      price: +stopPx.toFixed(2),
      distPct: +(((stopPx / px) - 1) * 100).toFixed(2),
    };
  };

  const stops = [
    stopZone("0.5× ATR", px != null && atr14 != null ? px - 0.5 * atr14 : null),
    stopZone("1× ATR", px != null && atr14 != null ? px - atr14 : null),
    stopZone("2× ATR", px != null && atr14 != null ? px - 2 * atr14 : null),
    stopZone("Day Low", dayLow),
    stopZone("Prev Low", prevLow),
    stopZone("21 EMA", ema21),
  ];

  return {
    price: px != null ? +px.toFixed(2) : null,
    chgPct: chgPct != null ? +chgPct.toFixed(2) : null,
    fromOpenPct: fromOpenPct != null ? +fromOpenPct.toFixed(2) : null,
    dayHigh: dayHigh != null ? +dayHigh.toFixed(2) : null,
    dayLow: dayLow != null ? +dayLow.toFixed(2) : null,
    prevHigh: prevHigh != null ? +prevHigh.toFixed(2) : null,
    prevLow: prevLow != null ? +prevLow.toFixed(2) : null,
    high20: high20 != null ? +high20.toFixed(2) : null,
    low20: low20 != null ? +low20.toFixed(2) : null,
    high52: high52 != null ? +high52.toFixed(2) : null,
    low52: Number.isFinite(low52) ? +low52.toFixed(2) : null,
    off52Pct: off52Pct != null ? +off52Pct.toFixed(2) : null,
    cr,
    atr14: atr14 != null ? +atr14.toFixed(2) : null,
    atrPct: atrPct != null ? +atrPct.toFixed(2) : null,
    expectedDayMove,
    expectedWeekMove,
    emaStack,
    stage,
    mas,
    stops,
  };
}

// Compute live Nasdaq-100 rows + aggregate breadth, stage distribution, mega-cap concentration, and group perf
export function computeNdxInternals({
  constituents = NDX_CONSTITUENTS,
  stockMap = {},
  quotes = new Map(),
  tickerLayer = {},
  profiles = null,
} = {}) {
  const weights = computeNdxWeights(constituents, stockMap);
  const rows = [];
  let adv = 0, dec = 0, unch = 0, up4 = 0, dn4 = 0;
  let above20 = 0, total20 = 0;
  let above50 = 0, total50 = 0;
  let above200 = 0, total200 = 0;
  let nearHighs = 0;
  const stageCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let stageTotal = 0;

  for (const c of constituents) {
    const s = stockMap?.[c.t] || null;
    const q = quotes instanceof Map ? quotes.get(c.t) : quotes?.[c.t];
    if (!s && !q) continue;

    const px = q?.rthPrice ?? q?.price ?? s?.close ?? s?.price ?? null;
    const chg = q?.change ?? (q?.previousClose && px ? ((px / q.previousClose) - 1) * 100 : s?.change_pct ?? null);
    const fromOpen = q?.open && px ? ((px / q.open) - 1) * 100 : null;
    const zvr = s ? (zvrFor(s, q, profiles) ?? (s.rel_volume > 0 ? +s.rel_volume.toFixed(2) : null)) : null;
    const thrust = stockThrust(chg, zvr);
    const cr = closingRange(q, s);

    const sma20 = s?.sma20_lvl && px ? ((px / s.sma20_lvl) - 1) * 100 : (s?.sma20_pct ?? null);
    const sma50 = s?.sma50_lvl && px ? ((px / s.sma50_lvl) - 1) * 100 : (s?.sma50_pct ?? null);
    const sma200 = s?.sma200_lvl && px ? ((px / s.sma200_lvl) - 1) * 100 : (s?.sma200_pct ?? null);
    const hiLvl = s?.hi52_lvl ?? (s?.close && s?.off_52w_high != null ? s.close / (1 + s.off_52w_high / 100) : null);
    const hi52 = Math.max(hiLvl || 0, q?.yearHigh || 0) || null;
    const off52 = hi52 && px ? ((px / hi52) - 1) * 100 : (s?.off_52w_high ?? s?.pct_from_high ?? null);
    const adr = s?.adr20 ?? s?.adr_pct ?? null;
    const rs = s?.rs_rank ?? null;
    const eps = s?.eps_rating ?? null;
    const stage = s ? classifyWeinsteinStage(s) : null;
    const L = tickerLayer?.[c.t] || null;
    const weightPct = weights[c.t] ?? 0;
    // Basis points contribution to QQQ: weightPct (%) * chg (%) = bps (e.g. 10% weight * +2% = +20 bps = +0.20%)
    const contribBps = chg != null && weightPct > 0 ? +(weightPct * chg).toFixed(1) : null;
    const isBreakout = Boolean(
      (chg ?? 0) >= 3.0 && (zvr ?? 0) >= 1.5 && (cr ?? 0) >= 65 && (off52 ?? -99) >= -15
    );
    const rsl = s ? rsLeads(s) : null;
    const isHealth = c.g === "health" || isHealthcareItem({
      theme: L?.theme,
      themeId: L?.themeId,
      layer: L?.name,
      sector: s?.sector,
      industry: s?.industry,
    });

    if (chg != null) {
      if (chg > 0.01) adv++;
      else if (chg < -0.01) dec++;
      else unch++;
      if (chg >= 4) up4++;
      if (chg <= -4) dn4++;
    }
    if (sma20 != null) { total20++; if (sma20 > 0) above20++; }
    if (sma50 != null) { total50++; if (sma50 > 0) above50++; }
    if (sma200 != null) { total200++; if (sma200 > 0) above200++; }
    if (off52 != null && off52 >= -5) nearHighs++;
    if (stage != null) { stageCounts[stage]++; stageTotal++; }

    rows.push({
      ticker: c.t,
      company: s?.company || "",
      group: c.g,
      groups: [c.g, ...(c.also || [])],
      weightPct,
      contribBps,
      price: px != null ? +px.toFixed(2) : null,
      chg: chg != null ? +chg.toFixed(2) : null,
      fromOpen: fromOpen != null ? +fromOpen.toFixed(2) : null,
      zvr,
      thrust,
      cr,
      adr: adr != null ? +adr.toFixed(1) : null,
      sma20: sma20 != null ? +sma20.toFixed(1) : null,
      sma50: sma50 != null ? +sma50.toFixed(1) : null,
      sma200: sma200 != null ? +sma200.toFixed(1) : null,
      off52: off52 != null ? +off52.toFixed(1) : null,
      rs,
      eps,
      epsTip: s?.eps_tip || "",
      epsAcc: Boolean(s?.eps_accel),
      stage,
      rsl,
      isBreakout,
      isHealth,
      layer: L?.name || s?.industry || "",
      layerSt: L?.st || null,
      theme: L?.theme || s?.sector || "",
    });
  }

  const advTot = adv + dec;
  const byWeight = [...rows].sort((a, b) => (b.weightPct || 0) - (a.weightPct || 0));
  const top10 = byWeight.slice(0, 10);
  const rest = byWeight.slice(10);

  const avgChg = (arr) => {
    const valid = arr.map((r) => r.chg).filter((v) => v != null && Number.isFinite(v));
    if (!valid.length) return null;
    return +(valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(2);
  };
  const weightedChg = (arr) => {
    let wSum = 0, wcSum = 0;
    for (const r of arr) {
      if (r.chg != null && r.weightPct > 0) {
        wSum += r.weightPct;
        wcSum += r.weightPct * r.chg;
      }
    }
    return wSum > 0 ? +(wcSum / wSum).toFixed(2) : null;
  };

  const top10Chg = weightedChg(top10);
  const top10Weight = +top10.reduce((a, r) => a + (r.weightPct || 0), 0).toFixed(1);
  const restChg = avgChg(rest);
  const eqWeightChg = avgChg(rows);
  const capWeightEstChg = weightedChg(rows);
  const concentrationSpread = top10Chg != null && restChg != null ? +(top10Chg - restChg).toFixed(2) : null;

  const withContrib = rows.filter((r) => r.contribBps != null);
  const topPositive = [...withContrib].filter((r) => r.contribBps > 0).sort((a, b) => b.contribBps - a.contribBps).slice(0, 5);
  const topNegative = [...withContrib].filter((r) => r.contribBps < 0).sort((a, b) => a.contribBps - b.contribBps).slice(0, 5);

  const groupPerf = NDX_GROUPS.map((g) => {
    const members = rows.filter((r) => r.groups.includes(g.id));
    const chgs = members.map((r) => r.chg).filter((v) => v != null).sort((a, b) => a - b);
    const m = chgs.length >> 1;
    const med = chgs.length ? +(chgs.length % 2 ? chgs[m] : (chgs[m - 1] + chgs[m]) / 2).toFixed(2) : null;
    const green = chgs.filter((v) => v > 0).length;
    const bps = +members.reduce((a, r) => a + (r.contribBps || 0), 0).toFixed(1);
    return {
      ...g,
      count: members.length,
      medianChg: med,
      pctGreen: chgs.length ? Math.round((green / chgs.length) * 100) : null,
      bps,
    };
  });

  const pctOf = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
  const stageDist = {
    total: stageTotal,
    stages: [
      { stage: 1, label: "Stage 1", hint: "Basing", count: stageCounts[1], pct: pctOf(stageCounts[1], stageTotal) },
      { stage: 2, label: "Stage 2", hint: "Uptrend", count: stageCounts[2], pct: pctOf(stageCounts[2], stageTotal) },
      { stage: 3, label: "Stage 3", hint: "Topping", count: stageCounts[3], pct: pctOf(stageCounts[3], stageTotal) },
      { stage: 4, label: "Stage 4", hint: "Downtrend", count: stageCounts[4], pct: pctOf(stageCounts[4], stageTotal) },
    ],
  };

  return {
    rows,
    count: rows.length,
    adv,
    dec,
    unch,
    advPct: advTot > 0 ? (adv / advTot) * 100 : 50,
    up4,
    dn4,
    ma20: { above: above20, below: Math.max(0, total20 - above20), pct: total20 > 0 ? (above20 / total20) * 100 : 0 },
    ma50: { above: above50, below: Math.max(0, total50 - above50), pct: total50 > 0 ? (above50 / total50) * 100 : 0 },
    ma200: { above: above200, below: Math.max(0, total200 - above200), pct: total200 > 0 ? (above200 / total200) * 100 : 0 },
    nearHighs,
    stageDist,
    top10Chg,
    top10Weight,
    restChg,
    eqWeightChg,
    capWeightEstChg,
    concentrationSpread,
    topPositive,
    topNegative,
    groupPerf,
  };
}

// Build chronological QQQ breadth series with 10d/20d EMAs of >50d SMA and running Cumulative NDX A/D.
// Appends a "Today (Live)" point when liveInternals is provided and todayStr is newer than the archive's latest date.
export function buildQqqBreadthSeries(archiveRows, liveInternals = null, liveQqqPx = null, todayStr = null) {
  const clean = [];
  let lastDate = null;
  for (const r of Array.isArray(archiveRows) ? archiveRows : []) {
    if (!r?.date || typeof r.p50 !== "number" || !Number.isFinite(r.p50)) continue;
    lastDate = r.date;
    clean.push({
      date: r.date,
      qqq: typeof r.qqq === "number" && Number.isFinite(r.qqq) ? r.qqq : null,
      p20: typeof r.p20 === "number" && Number.isFinite(r.p20) ? r.p20 : null,
      p50: r.p50,
      p200: typeof r.p200 === "number" && Number.isFinite(r.p200) ? r.p200 : null,
      adv: typeof r.adv === "number" && Number.isFinite(r.adv) ? r.adv : null,
      dec: typeof r.dec === "number" && Number.isFinite(r.dec) ? r.dec : null,
      isLive: false,
    });
  }

  if (liveInternals && liveInternals.count >= 60 && todayStr && lastDate !== todayStr) {
    clean.push({
      date: "Today (Live)",
      qqq: typeof liveQqqPx === "number" && Number.isFinite(liveQqqPx) ? +liveQqqPx.toFixed(2) : null,
      p20: +liveInternals.ma20.pct.toFixed(1),
      p50: +liveInternals.ma50.pct.toFixed(1),
      p200: +liveInternals.ma200.pct.toFixed(1),
      adv: liveInternals.adv,
      dec: liveInternals.dec,
      isLive: true,
    });
  }

  if (!clean.length) return [];

  const k10 = 2 / 11;
  const k20 = 2 / 21;
  let e10 = clean[0].p50;
  let e20 = clean[0].p50;
  let cumAd = 0;

  return clean.map((r, i) => {
    if (i > 0) {
      e10 = r.p50 * k10 + e10 * (1 - k10);
      e20 = r.p50 * k20 + e20 * (1 - k20);
    }
    const net = r.adv != null && r.dec != null ? r.adv - r.dec : 0;
    cumAd += net;
    return {
      ...r,
      net,
      cumAd,
      p50Ema10: +e10.toFixed(1),
      p50Ema20: +e20.toFixed(1),
    };
  });
}

function linSlope(vals) {
  const n = vals.length;
  if (n < 2) return 0;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += vals[i];
    sxy += i * vals[i];
    sxx += i * i;
  }
  const denom = n * sxx - sx * sx;
  return denom ? +((n * sxy - sx * sy) / denom).toFixed(2) : 0;
}

// Classify QQQ breadth trend (UPTREND / BOUNCE HOOK / ROLLING OVER / DOWNTREND)
// using short-term momentum (5d), intermediate trend (20d slope & EMA), and 3Y percentile context.
export function computeQqqBreadthTrend(series) {
  if (!Array.isArray(series) || series.length < 5) return null;
  const n = series.length;
  const cur = series[n - 1];
  const back = (k) => series[Math.max(0, n - 1 - k)];
  const delta = (k, field) => {
    const a = cur[field];
    const b = back(k)[field];
    return a != null && b != null ? +(a - b).toFixed(1) : null;
  };

  const d5 = { p20: delta(5, "p20"), p50: delta(5, "p50"), p200: delta(5, "p200") };
  const d10 = { p20: delta(10, "p20"), p50: delta(10, "p50"), p200: delta(10, "p200") };
  const d20 = { p20: delta(20, "p20"), p50: delta(20, "p50"), p200: delta(20, "p200") };
  const d60 = { p20: delta(60, "p20"), p50: delta(60, "p50"), p200: delta(60, "p200") };

  const tail20 = series.slice(-20).map((r) => r.p50).filter((v) => v != null);
  const slope20 = linSlope(tail20);
  const tail5 = series.slice(-5).map((r) => r.p50).filter((v) => v != null);
  const slope5 = linSlope(tail5);

  const all50 = series.map((r) => r.p50).filter((v) => v != null).sort((a, b) => a - b);
  const pctile = all50.length
    ? Math.round((all50.filter((x) => x <= cur.p50).length / all50.length) * 100)
    : null;
  const med = all50.length ? all50[Math.floor(all50.length / 2)] : null;
  const min50 = all50.length ? all50[0] : null;
  const max50 = all50.length ? all50[all50.length - 1] : null;

  // Recent 5d trough for detecting sharp bounce hooks off oversold lows
  const minRecent20 = Math.min(...series.slice(-6).map((r) => r.p20 ?? 100));
  const bounce20 = cur.p20 != null ? +(cur.p20 - minRecent20).toFixed(1) : 0;

  let state = "DOWNTREND";
  let label = "Breadth Downtrend";
  let tone = "bad";
  let summary = `>50d SMA at ${cur.p50}% (below 50% & 20d EMA ${cur.p50Ema20}%)`;

  if (cur.p50 >= 50 && cur.p50 >= cur.p50Ema20 && slope20 >= 0 && (d10.p50 ?? 0) > -6) {
    state = "UPTREND";
    label = "Breadth Uptrend";
    tone = "good";
    summary = `>50d SMA at ${cur.p50}% — above 50% & rising 20d EMA (${cur.p50Ema20}%)`;
  } else if (cur.p50 >= 50) {
    state = "ROLLING_OVER";
    label = "Breadth Rolling Over";
    tone = "warn";
    summary = `>50d SMA still ${cur.p50}% but softening vs 10d/20d trend (${d10.p50 >= 0 ? "+" : ""}${d10.p50} pts 10d)`;
  } else if (bounce20 >= 12 || ((d5.p50 ?? 0) >= 4 && cur.p50 >= cur.p50Ema10)) {
    state = "BOUNCE_HOOK";
    label = "Downtrend · Hook Up";
    tone = "cyan";
    summary = `Intermediate trend down (${cur.p50}% < 50%), short-term hook (+${bounce20} pts off 5d >20d low)`;
  } else {
    state = "DOWNTREND";
    label = "Breadth Downtrend";
    tone = "bad";
    summary = `>50d SMA at ${cur.p50}% — below 50% with negative 20d slope (${slope20}%/d)`;
  }

  return {
    state,
    label,
    tone,
    summary,
    date: cur.date,
    p20: cur.p20,
    p50: cur.p50,
    p200: cur.p200,
    p50Ema10: cur.p50Ema10,
    p50Ema20: cur.p50Ema20,
    slope5,
    slope20,
    d5,
    d10,
    d20,
    d60,
    pctile,
    med,
    min50,
    max50,
    sessions: n,
  };
}

const ANCHOR_TICKERS = new Set(["NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "GOOG", "META", "TSLA", "AVGO"]);

// ── Live QQQ Intraday Reversal / Recovery Predictor ──────────────────────────
// Combines opening gap structure (Broad Panic 83% 2Y bounce vs Narrow Mega Shock 31%)
// with 4 live constituent internals: New-Low Exhaustion, Open-Reclaim Breadth,
// Top-8 Weight Anchor Hold (~65% of QQQ), and QQQ Intraday Closing Range.
export function computeQqqIntradayPredictor({ qqqQ, qqqeQ, internals, quotes, stockMap } = {}) {
  const rows = internals?.rows || [];
  if (!rows.length) return null;

  const qPx = qqqQ?.rthPrice ?? qqqQ?.price ?? stockMap?.QQQ?.close ?? null;
  const qPrev = qqqQ?.previousClose ?? (qPx && qqqQ?.change != null ? qPx / (1 + qqqQ.change / 100) : null);
  const qOpen = qqqQ?.open ?? null;
  const qLow = qqqQ?.dayLow ?? null;
  const qHigh = qqqQ?.dayHigh ?? null;

  const qqqGapPct = qOpen && qPrev ? +(((qOpen / qPrev) - 1) * 100).toFixed(2) : null;
  const qqqFromOpenPct = qPx && qOpen ? +(((qPx / qOpen) - 1) * 100).toFixed(2) : null;
  const qqqCr = qPx != null && qHigh != null && qLow != null && qHigh > qLow
    ? Math.max(0, Math.min(100, Math.round(((qPx - qLow) / (qHigh - qLow)) * 100)))
    : (stockMap?.QQQ?.cr_pct ?? null);

  let validOpen = 0, greenFromOpen = 0;
  let validRange = 0, nearLow = 0, nearHigh = 0;
  let eqGapSum = 0, eqGapN = 0;
  let fromOpenBps = 0;
  let anchorTotalW = 0, anchorHoldingLowW = 0, anchorGreenOpenW = 0;
  const anchorDrivers = [];

  for (const r of rows) {
    const q = quotes?.get?.(r.ticker);
    const px = q?.rthPrice ?? q?.price ?? r.price;
    const open = q?.open ?? null;
    const prev = q?.previousClose ?? (px && r.chg != null ? px / (1 + r.chg / 100) : null);
    const lo = q?.dayLow ?? null;
    const hi = q?.dayHigh ?? null;
    const w = r.weightPct || 0;

    if (open && prev) {
      eqGapSum += ((open / prev) - 1) * 100;
      eqGapN++;
    }

    const fromOpen = r.fromOpen ?? (px && open ? ((px / open) - 1) * 100 : null);
    if (fromOpen != null && Number.isFinite(fromOpen)) {
      validOpen++;
      if (fromOpen > 0) greenFromOpen++;
      if (w > 0) fromOpenBps += w * fromOpen;
    }

    let offLowPct = null;
    if (px && lo && hi && hi > lo) {
      validRange++;
      offLowPct = ((px / lo) - 1) * 100;
      const offHiPct = ((hi / px) - 1) * 100;
      if (offLowPct <= 0.35) nearLow++;
      if (offHiPct <= 0.35) nearHigh++;
    }

    if (ANCHOR_TICKERS.has(r.ticker) && w > 0) {
      anchorTotalW += w;
      const holdingLow = (offLowPct != null && offLowPct >= 0.75) || (fromOpen != null && fromOpen > 0);
      if (holdingLow) anchorHoldingLowW += w;
      if (fromOpen != null && fromOpen > 0) anchorGreenOpenW += w;
      anchorDrivers.push({
        ticker: r.ticker,
        weightPct: +w.toFixed(1),
        chg: r.chg,
        fromOpen: fromOpen != null ? +fromOpen.toFixed(2) : null,
        offLowPct: offLowPct != null ? +offLowPct.toFixed(2) : null,
        fromOpenBps: fromOpen != null ? +(w * fromOpen).toFixed(1) : null,
        holdingLow,
      });
    }
  }

  // Equal-weight opening gap (prefer QQQE quote if open+prevClose present, else NDX average)
  const qqqeGap = qqqeQ?.open && qqqeQ?.previousClose
    ? ((qqqeQ.open / qqqeQ.previousClose) - 1) * 100
    : null;
  const eqGapPct = qqqeGap != null
    ? +qqqeGap.toFixed(2)
    : (eqGapN >= 10 ? +(eqGapSum / eqGapN).toFixed(2) : null);
  const eqMinusCapGap = eqGapPct != null && qqqGapPct != null ? +(eqGapPct - qqqGapPct).toFixed(2) : null;

  const pctNearLow = validRange > 0 ? Math.round((nearLow / validRange) * 100) : null;
  const pctNearHigh = validRange > 0 ? Math.round((nearHigh / validRange) * 100) : null;
  const pctGreenFromOpen = validOpen > 0 ? Math.round((greenFromOpen / validOpen) * 100) : internals.pctAdv;
  const anchorHoldPct = anchorTotalW > 0 ? Math.round((anchorHoldingLowW / anchorTotalW) * 100) : null;
  const anchorGreenPct = anchorTotalW > 0 ? Math.round((anchorGreenOpenW / anchorTotalW) * 100) : null;

  // Gap regime classification (2-year 107-session study)
  let gapRegime = "FLAT_OPEN";
  let gapLabel = "Normal Open";
  let gapHint = "No major overnight gap — watch live breadth & open-reclaim thrust.";
  let gapTone = "muted";
  if (qqqGapPct != null && qqqGapPct <= -1.0) {
    if (eqMinusCapGap != null && eqMinusCapGap < 0.30) {
      gapRegime = "BROAD_PANIC_GAP";
      gapLabel = "Broad Panic Gap Down";
      gapHint = "Indiscriminate gap down (Eq−Cap < +0.30%) — 83% 2Y historical open-to-close bounce rate.";
      gapTone = "cyan";
    } else {
      gapRegime = "NARROW_SHOCK_GAP";
      gapLabel = "Narrow Mega/Semi Shock";
      gapHint = "Mega-cap/Semi-driven gap (Eq−Cap ≥ +0.30%) — only 31% bounce at open; require intraday confirmation below.";
      gapTone = "warn";
    }
  } else if (qqqGapPct != null && qqqGapPct <= -0.4) {
    gapRegime = "GAP_DOWN";
    gapLabel = "Mild Gap Down";
    gapHint = "Watch for New-Low Exhaustion (<15%) and >50% NDX green from open.";
    gapTone = "warn";
  } else if (qqqGapPct != null && qqqGapPct >= 0.4) {
    gapRegime = "GAP_UP";
    gapLabel = "Gap Up Open";
    gapHint = "Watch for >50% holding above open to confirm continuation vs. gap-fade risk.";
    gapTone = "good";
  }

  // 4-Signal 0..100 Intraday Recovery / Strength Score
  // 1. New-Low Exhaustion (0..30)
  const lowExhPts = pctNearLow != null
    ? Math.round(Math.max(0, Math.min(30, ((45 - pctNearLow) / 35) * 30)))
    : (qqqCr != null ? Math.round((qqqCr / 100) * 30) : 15);
  // 2. Open-Reclaim Breadth (0..25)
  const openBreadthPts = pctGreenFromOpen != null
    ? Math.round(Math.max(0, Math.min(25, ((pctGreenFromOpen - 15) / 55) * 25)))
    : 12;
  // 3. Top-8 Weight Anchor Hold (0..25)
  const anchorPts = anchorHoldPct != null
    ? Math.round(Math.max(0, Math.min(25, (anchorHoldPct / 100) * 17 + ((anchorGreenPct ?? 0) / 100) * 8)))
    : 12;
  // 4. QQQ Tape Confirmation (0..20)
  const crPts = qqqCr != null ? Math.round((qqqCr / 100) * 14) : 7;
  const openPts = qqqFromOpenPct != null ? (qqqFromOpenPct >= 0.3 ? 6 : qqqFromOpenPct > 0 ? 4 : qqqFromOpenPct > -0.5 ? 2 : 0) : 3;
  const tapePts = Math.min(20, crPts + openPts);

  const score = Math.max(0, Math.min(100, lowExhPts + openBreadthPts + anchorPts + tapePts));

  let state = "BALANCED";
  let verdict = "Balanced Tape";
  let tone = "muted";
  if (gapRegime === "BROAD_PANIC_GAP" || gapRegime === "NARROW_SHOCK_GAP" || gapRegime === "GAP_DOWN") {
    if (score >= 68 && (pctGreenFromOpen ?? 0) >= 50) {
      state = "RECOVERY_TRIGGERED";
      verdict = "Recovery Triggered";
      tone = "good";
    } else if (score >= 48) {
      state = "BUILDING_REVERSAL";
      verdict = "Building Reversal";
      tone = "cyan";
    } else {
      state = "SELLOFF_ACTIVE";
      verdict = "Wait — Selloff Active";
      tone = "bad";
    }
  } else if (gapRegime === "GAP_UP") {
    if (score >= 65 && (pctGreenFromOpen ?? 0) >= 50) {
      state = "BULL_CONTINUATION";
      verdict = "Bullish Continuation";
      tone = "good";
    } else if (score <= 38 && (pctGreenFromOpen ?? 100) < 42) {
      state = "FADE_WARNING";
      verdict = "Gap-Up Fade Warning";
      tone = "bad";
    } else {
      state = "DIGESTING_GAP";
      verdict = "Digesting Gap Up";
      tone = "cyan";
    }
  } else {
    if (score >= 68) { state = "ACCUMULATION"; verdict = "Intraday Accumulation"; tone = "good"; }
    else if (score <= 32) { state = "DISTRIBUTION"; verdict = "Intraday Distribution"; tone = "bad"; }
    else { state = "BALANCED"; verdict = "Balanced Tape"; tone = "muted"; }
  }

  anchorDrivers.sort((a, b) => (b.fromOpenBps ?? -999) - (a.fromOpenBps ?? -999));

  return {
    score,
    state,
    verdict,
    tone,
    gapRegime,
    gapLabel,
    gapHint,
    gapTone,
    qqqGapPct,
    eqGapPct,
    eqMinusCapGap,
    qqqFromOpenPct,
    qqqCr,
    pctNearLow,
    pctNearHigh,
    pctGreenFromOpen,
    fromOpenBps: +fromOpenBps.toFixed(1),
    anchorHoldPct,
    anchorGreenPct,
    anchorDrivers,
    components: [
      { key: "lowExh", label: "New-Low Exhaustion", pts: lowExhPts, max: 30, value: pctNearLow != null ? `${pctNearLow}% at low` : "—", ok: pctNearLow != null && pctNearLow <= 15 },
      { key: "openBreadth", label: "Open-Reclaim Breadth", pts: openBreadthPts, max: 25, value: pctGreenFromOpen != null ? `${pctGreenFromOpen}% > open` : "—", ok: (pctGreenFromOpen ?? 0) >= 50 },
      { key: "anchors", label: "Top-8 Weight Anchors", pts: anchorPts, max: 25, value: anchorHoldPct != null ? `${anchorHoldPct}% holding` : "—", ok: (anchorHoldPct ?? 0) >= 65 },
      { key: "tape", label: "QQQ Tape / CR", pts: tapePts, max: 20, value: qqqCr != null ? `CR ${qqqCr}%` : "—", ok: (qqqCr ?? 0) >= 65 },
    ],
  };
}

// ── Anchored VWAP, Unfilled Gaps & Options Magnet Price Ladder ───────────────
function calcAvwap(bars, startIdx) {
  if (!Array.isArray(bars) || startIdx < 0 || startIdx >= bars.length) return null;
  let pv = 0, vSum = 0;
  for (let i = startIdx; i < bars.length; i++) {
    const b = bars[i];
    if (!b || !(b.close > 0)) continue;
    const typ = ((b.high ?? b.close) + (b.low ?? b.close) + b.close) / 3;
    const vol = b.volume > 0 ? b.volume : 1;
    pv += typ * vol;
    vSum += vol;
  }
  return vSum > 0 ? +(pv / vSum).toFixed(2) : null;
}

function findUnfilledGaps(bars, spot) {
  if (!Array.isArray(bars) || bars.length < 3 || !(spot > 0)) return { above: null, below: null };
  const start = Math.max(1, bars.length - 35);
  let nearestAbove = null, nearestBelow = null;
  for (let i = bars.length - 1; i >= start; i--) {
    const cur = bars[i], prev = bars[i - 1];
    if (!cur || !prev || !(cur.low > 0) || !(prev.high > 0)) continue;
    // Gap down (open gap above current price: prev.low > cur.high)
    if (prev.low > cur.high * 1.003) {
      let maxHighAfter = cur.high;
      for (let j = i + 1; j < bars.length; j++) if (bars[j]?.high > maxHighAfter) maxHighAfter = bars[j].high;
      if (maxHighAfter < prev.low * 0.999 && prev.low > spot * 1.002) {
        const edge = +prev.low.toFixed(2);
        if (!nearestAbove || edge < nearestAbove.price) nearestAbove = { price: edge, date: cur.date };
      }
    }
    // Gap up (open gap below current price: cur.low > prev.high)
    if (cur.low > prev.high * 1.003) {
      let minLowAfter = cur.low;
      for (let j = i + 1; j < bars.length; j++) if (bars[j]?.low < minLowAfter) minLowAfter = bars[j].low;
      if (minLowAfter > prev.high * 1.001 && prev.high < spot * 0.998) {
        const edge = +prev.high.toFixed(2);
        if (!nearestBelow || edge > nearestBelow.price) nearestBelow = { price: edge, date: cur.date };
      }
    }
  }
  return { above: nearestAbove, below: nearestBelow };
}

export function computeQqqPriceLadder({ qqqBars = [], qqqQ = null, tech = null, optionsAnalysis = null } = {}) {
  const bars = Array.isArray(qqqBars) ? qqqBars.filter((b) => b?.close > 0) : [];
  const spot = tech?.price ?? qqqQ?.rthPrice ?? qqqQ?.price ?? (bars.length ? bars[bars.length - 1].close : null);
  if (!(spot > 0)) return null;

  const vwap5d = bars.length >= 5 ? calcAvwap(bars, bars.length - 5) : null;

  // 52w High AVWAP (anchored from highest high over last 252 bars)
  let avwap52wHigh = null;
  if (bars.length >= 20) {
    const start252 = Math.max(0, bars.length - 252);
    let hiIdx = start252;
    for (let i = start252 + 1; i < bars.length; i++) {
      if ((bars[i].high ?? bars[i].close) >= (bars[hiIdx].high ?? bars[hiIdx].close)) hiIdx = i;
    }
    avwap52wHigh = calcAvwap(bars, hiIdx);
  }

  // Recent 30-session Swing Low AVWAP
  let avwapSwingLow = null;
  if (bars.length >= 10) {
    const start30 = Math.max(0, bars.length - 30);
    let loIdx = start30;
    for (let i = start30 + 1; i < bars.length; i++) {
      if ((bars[i].low ?? bars[i].close) <= (bars[loIdx].low ?? bars[loIdx].close)) loIdx = i;
    }
    avwapSwingLow = calcAvwap(bars, loIdx);
  }

  const gaps = findUnfilledGaps(bars, spot);
  const prevBar = bars.length >= 2 ? bars[bars.length - 2] : null;

  const raw = [];
  const add = (label, price, kind, priority, hint) => {
    if (!(typeof price === "number" && Number.isFinite(price) && price > 0)) return;
    const pct = +(((price / spot) - 1) * 100).toFixed(2);
    if (Math.abs(pct) > 18) return; // keep ladder focused on actionable near-term levels
    raw.push({ label, price: +price.toFixed(2), pct, kind, priority, hint });
  };

  // Options Magnets (highest institutional relevance)
  if (optionsAnalysis?.callWall?.strike) add("Call Wall", optionsAnalysis.callWall.strike, "options", 1, "Highest Call OI resistance magnet");
  if (optionsAnalysis?.putWall?.strike) add("Put Wall", optionsAnalysis.putWall.strike, "options", 1, "Highest Put OI support floor");
  if (optionsAnalysis?.gammaFlip) add("Gamma Flip", optionsAnalysis.gammaFlip, "options", 1, "Dealer +GEX / −GEX volatility pivot");
  if (optionsAnalysis?.expectedMove?.upper) add("+1σ Exp Move", optionsAnalysis.expectedMove.upper, "options", 2, "Options-implied upper 1σ boundary");
  if (optionsAnalysis?.expectedMove?.lower) add("−1σ Exp Move", optionsAnalysis.expectedMove.lower, "options", 2, "Options-implied lower 1σ boundary");

  // VWAPs
  if (vwap5d) add("5d VWAP", vwap5d, "vwap", 1, "5-day institutional trendline");
  if (avwap52wHigh) add("52wH AVWAP", avwap52wHigh, "vwap", 2, "Avg cost basis since 52w high");
  if (avwapSwingLow) add("Swing-Low AVWAP", avwapSwingLow, "vwap", 2, "Dip-buyers' avg cost off 30d low");

  // Unfilled Daily Gaps
  if (gaps.above) add("Gap Fill", gaps.above.price, "gap", 2, `Unfilled daily gap from ${gaps.above.date}`);
  if (gaps.below) add("Gap Support", gaps.below.price, "gap", 2, `Unfilled daily gap from ${gaps.below.date}`);

  // Key Moving Averages & Prior Day Extremes
  if (tech?.ema10?.val) add("10 EMA", tech.ema10.val, "ma", 2, "Short-term momentum EMA");
  if (tech?.ema21?.val) add("21 EMA", tech.ema21.val, "ma", 1, "Swing trendline EMA");
  if (tech?.sma50?.val) add("50 SMA", tech.sma50.val, "ma", 1, "Institutional intermediate trend");
  if (prevBar?.high) add("Prior Day High", prevBar.high, "price", 3, "Yesterday's session high");
  if (prevBar?.low) add("Prior Day Low", prevBar.low, "price", 3, "Yesterday's session low");

  // Dedupe levels sitting right on top of each other (<0.20% apart), keeping higher priority
  const dedupeSide = (arr) => {
    const picked = [];
    for (const item of arr) {
      const clash = picked.find((p) => Math.abs(p.price - item.price) / spot < 0.002);
      if (!clash) picked.push(item);
      else if (item.priority < clash.priority) {
        picked[picked.indexOf(clash)] = item;
      }
    }
    return picked;
  };

  const aboveAll = dedupeSide(
    raw.filter((r) => r.price > spot * 1.0015).sort((a, b) => a.price - b.price || a.priority - b.priority)
  );
  const belowAll = dedupeSide(
    raw.filter((r) => r.price < spot * 0.9985).sort((a, b) => b.price - a.price || a.priority - b.priority)
  );

  // Pick top 4 nearest resistance (ordered high → low for visual ladder) and top 4 nearest support (high → low)
  const resistance = aboveAll.slice(0, 4).reverse();
  const support = belowAll.slice(0, 4);

  return {
    spot: +spot.toFixed(2),
    vwap5d,
    avwap52wHigh,
    avwapSwingLow,
    nearestResistance: aboveAll[0] || null,
    nearestSupport: belowAll[0] || null,
    resistance,
    support,
    expectedMove: optionsAnalysis?.expectedMove || null,
  };
}

// ── Live QQQ & NDX Volume Confirmation Engine ────────────────────────────────
// Answers: "Is institutional volume confirming the move in QQQ?"
// Combines 4 orthogonal signals:
//   1. QQQ ETF volume pace (30m cumulative RVol@T -> ZVR -> daily 20d ratio) + 10d accum/distrib count
//   2. NDX constituent Up-$Vol vs Down-$Vol (dollar-volume weighted breadth & divergence vs Adv%)
//   3. Heavy-volume movers balance (NDX stocks >=1.5x ZVR green vs red)
//   4. Top-8 Mega-Cap anchor volume weight
export function computeQqqVolumeConfirmation({
  qqqBars = [],
  qqqBars30m = [],
  qqqQ = null,
  qqqZvr = null,
  tech = null,
  internals = null,
  quotes = new Map(),
  stockMap = {},
  rvol30Summary = null,
} = {}) {
  const rows = internals?.rows || [];
  const cleanDaily = (Array.isArray(qqqBars) ? qqqBars : []).filter(
    (b) => b && typeof b.close === "number" && Number.isFinite(b.close)
  );
  const volBars = cleanDaily.filter((b) => typeof b.volume === "number" && Number.isFinite(b.volume) && b.volume > 0);
  const lastDaily = volBars.length ? volBars[volBars.length - 1] : null;
  const qVol = typeof qqqQ?.volume === "number" && Number.isFinite(qqqQ.volume) && qqqQ.volume > 0 ? qqqQ.volume : null;
  const todayVol = qVol ?? lastDaily?.volume ?? null;

  // 20-day average daily volume (exclude trailing partial live bar if qVol is active)
  const histVolSlice = volBars.length >= 21 && qVol != null
    ? volBars.slice(-21, -1)
    : volBars.slice(-20);
  const avg20Vol = histVolSlice.length >= 5
    ? Math.round(histVolSlice.reduce((a, b) => a + b.volume, 0) / histVolSlice.length)
    : (typeof stockMap?.QQQ?.avg_volume_raw === "number" && stockMap.QQQ.avg_volume_raw > 0
      ? Math.round(stockMap.QQQ.avg_volume_raw)
      : null);

  // 30m RVol@T summary (precomputed or computed on the fly from qqqBars30m)
  const r30 = rvol30Summary || (Array.isArray(qqqBars30m) && qqqBars30m.length >= 20
    ? computeRvolAtTime(qqqBars30m)?.summary || null
    : null);

  const dailyRatio = todayVol != null && avg20Vol > 0 ? +(todayVol / avg20Vol).toFixed(2) : null;
  const rvolSource = r30?.cumRvol != null
    ? "rvol30m"
    : qqqZvr != null
      ? "zvr"
      : dailyRatio != null
        ? "daily"
        : null;
  const qqqRvol = r30?.cumRvol != null
    ? +r30.cumRvol.toFixed(2)
    : qqqZvr != null
      ? +qqqZvr.toFixed(2)
      : dailyRatio;
  const projVol = qqqRvol != null && avg20Vol > 0 ? Math.round(avg20Vol * qqqRvol) : todayVol;

  // Recent 10-session IBD/O'Neil style accumulation vs distribution days on QQQ daily bars
  let accumDays10 = 0;
  let distribDays10 = 0;
  if (cleanDaily.length >= 2) {
    const startIdx = Math.max(1, cleanDaily.length - 10);
    for (let i = startIdx; i < cleanDaily.length; i++) {
      const cur = cleanDaily[i];
      const prev = cleanDaily[i - 1];
      if (!(cur.volume > 0) || !(prev.volume > 0) || !(prev.close > 0)) continue;
      if (cur.volume <= prev.volume) continue;
      const pct = ((cur.close / prev.close) - 1) * 100;
      if (pct >= 0.2) accumDays10++;
      else if (pct <= -0.2) distribDays10++;
    }
  }

  // NDX constituent Up-$Vol vs Down-$Vol, Heavy-Vol Movers (>=1.5x), and Top-8 Mega-Cap volume weight
  let upDollarVol = 0;
  let downDollarVol = 0;
  let totalDollarVol = 0;
  let liveVolCount = 0;
  const heavyUp = [];
  const heavyDown = [];

  const qqqChg = tech?.chgPct ?? qqqQ?.change ?? internals?.capWeightEstChg ?? 0;
  const qqqCr = tech?.cr ?? (qqqQ?.dayHigh > qqqQ?.dayLow && qqqQ?.price != null
    ? Math.round(((qqqQ.price - qqqQ.dayLow) / (qqqQ.dayHigh - qqqQ.dayLow)) * 100)
    : null);
  const qqqDir = qqqChg >= 0.2 ? 1 : qqqChg <= -0.2 ? -1 : 0;

  let top8W = 0;
  let top8WZvr = 0;
  let top8Confirming = 0;
  let top8Total = 0;

  for (const r of rows) {
    const s = stockMap?.[r.ticker] || null;
    const q = quotes instanceof Map ? quotes.get(r.ticker) : quotes?.[r.ticker];
    const px = q?.rthPrice ?? q?.price ?? r.price ?? s?.close ?? null;
    const liveShareVol = typeof q?.volume === "number" && Number.isFinite(q.volume) && q.volume > 0 ? q.volume : null;
    const baseDvol = typeof s?.avg_dollar_vol_raw === "number" && Number.isFinite(s.avg_dollar_vol_raw) && s.avg_dollar_vol_raw > 0
      ? s.avg_dollar_vol_raw
      : (typeof s?.avg_volume_raw === "number" && px > 0 ? s.avg_volume_raw * px : null);

    let dvol = null;
    if (liveShareVol != null && px > 0) {
      dvol = liveShareVol * px;
      liveVolCount++;
    } else if (baseDvol != null) {
      dvol = baseDvol * (r.zvr != null && r.zvr > 0 ? r.zvr : 1);
    }

    if (dvol != null && dvol > 0 && r.chg != null) {
      totalDollarVol += dvol;
      if (r.chg > 0.01) upDollarVol += dvol;
      else if (r.chg < -0.01) downDollarVol += dvol;
    }

    if (r.zvr != null && r.zvr >= 1.5 && r.chg != null) {
      if (r.chg >= 0.5) {
        heavyUp.push({ ticker: r.ticker, chg: r.chg, zvr: r.zvr, thrust: +(r.chg * r.zvr).toFixed(1) });
      } else if (r.chg <= -0.5) {
        heavyDown.push({ ticker: r.ticker, chg: r.chg, zvr: r.zvr, thrust: +(Math.abs(r.chg) * r.zvr).toFixed(1) });
      }
    }

    if (ANCHOR_TICKERS.has(r.ticker)) {
      top8Total++;
      const w = r.weightPct > 0 ? r.weightPct : 1;
      if (r.zvr != null && r.zvr > 0) {
        top8W += w;
        top8WZvr += w * r.zvr;
      }
      const aligned = qqqDir >= 0 ? (r.chg ?? 0) > 0 : (r.chg ?? 0) < 0;
      if (aligned && (r.zvr ?? 0) >= 1.15) top8Confirming++;
    }
  }

  heavyUp.sort((a, b) => b.thrust - a.thrust);
  heavyDown.sort((a, b) => b.thrust - a.thrust);

  const upDollarVolPct = totalDollarVol > 0 ? +((upDollarVol / totalDollarVol) * 100).toFixed(1) : null;
  const downDollarVolPct = upDollarVolPct != null ? +(100 - upDollarVolPct).toFixed(1) : null;
  const advPct = internals?.advPct ?? null;
  const volMinusAdvPct = upDollarVolPct != null && advPct != null ? +(upDollarVolPct - advPct).toFixed(1) : null;
  const heavyTotal = heavyUp.length + heavyDown.length;
  const heavyUpPct = heavyTotal > 0 ? Math.round((heavyUp.length / heavyTotal) * 100) : 50;
  const top8Rvol = top8W > 0 ? +(top8WZvr / top8W).toFixed(2) : null;

  // Effective session pace: prefer QQQ ETF RVol, fallback to Top-8 weighted RVol
  const pace = qqqRvol ?? top8Rvol ?? null;
  const heavyPace = pace != null && pace >= 1.1;
  const veryHeavyPace = pace != null && pace >= 1.25;
  const lightPace = pace != null && pace < 0.85;
  const upPct = upDollarVolPct ?? advPct ?? 50;

  let state = "NEUTRAL";
  let label = "Normal Vol";
  let shortLabel = "Normal Vol";
  let tone = "muted";
  let confirmsMove = null;
  let biasPts = 0; // -10 .. +10 contribution to short-term bias
  let summary = "Volume pace is near normal with no strong directional skew.";

  const paceTxt = pace != null ? `${pace.toFixed(2)}×` : "—";
  const upTxt = upDollarVolPct != null ? `${Math.round(upDollarVolPct)}% Up $Vol` : "—";
  const dnTxt = downDollarVolPct != null ? `${Math.round(downDollarVolPct)}% Down $Vol` : "—";

  if (qqqDir > 0) {
    if (
      upPct < 50 ||
      (veryHeavyPace && qqqCr != null && qqqCr <= 40) ||
      (heavyDown.length >= heavyUp.length + 3 && heavyDown.length >= 4)
    ) {
      state = "CHURN_DIVERGENCE";
      label = "Churn / Vol Divergence";
      shortLabel = "Vol Divergence";
      tone = "warn";
      confirmsMove = false;
      biasPts = -5;
      summary = upPct < 50
        ? `QQQ green (${qqqChg >= 0 ? "+" : ""}${qqqChg.toFixed(2)}%), but only ${upTxt} — money is flowing into decliners.`
        : `Heavy ${paceTxt} volume with weak closing range (CR ${qqqCr ?? "—"}%) — supply stalling the rally.`;
    } else if (
      !lightPace &&
      upPct >= 65 &&
      (heavyPace || upPct >= 80 || (heavyUp.length >= 4 && heavyUp.length >= heavyDown.length * 2))
    ) {
      state = "CONFIRMED_ACCUM";
      const isThrust = upPct >= 80 && heavyPace;
      label = isThrust ? "Confirmed Vol Thrust" : "Confirmed Accumulation";
      shortLabel = isThrust ? "Vol Thrust" : "Confirmed Accum";
      tone = "good";
      confirmsMove = true;
      biasPts = isThrust ? 10 : Math.min(9, 6 + (heavyPace ? 2 : 0) + (upPct >= 75 ? 1 : 0));
      summary = `Institutional buying confirms move: ${upTxt} at ${paceTxt} pace (${heavyUp.length}↑ / ${heavyDown.length}↓ heavy-vol).`;
    } else if (lightPace || upPct < 55 || (heavyUp.length === 0 && (top8Rvol ?? 1) < 0.9)) {
      state = "HOLLOW_RALLY";
      label = "Hollow Rally (Light Vol)";
      shortLabel = "Light Vol Rally";
      tone = "warn";
      confirmsMove = false;
      biasPts = -4;
      summary = `Unconfirmed upside: QQQ green on light ${paceTxt} pace (${upTxt}) — watch for fade without volume pickup.`;
    } else {
      state = "MODERATE_CONFIRM";
      label = "Normal Vol Advance";
      shortLabel = "Vol OK";
      tone = "cyan";
      confirmsMove = true;
      biasPts = 3;
      summary = `Healthy advance on normal ${paceTxt} pace with ${upTxt} backing breadth.`;
    }
  } else if (qqqDir < 0) {
    if (upPct > 52 || (veryHeavyPace && qqqCr != null && qqqCr >= 65)) {
      state = "ABSORPTION";
      label = "Dip Absorption";
      shortLabel = "Absorption";
      tone = "cyan";
      confirmsMove = false;
      biasPts = 4;
      summary = `QQQ red, but ${veryHeavyPace && qqqCr >= 65 ? `heavy ${paceTxt} vol closing high (CR ${qqqCr}%)` : `${upTxt}`} signals dip-buyer absorption.`;
    } else if (
      !lightPace &&
      upPct <= 35 &&
      (heavyPace || upPct <= 20 || (heavyDown.length >= 4 && heavyDown.length >= heavyUp.length * 2))
    ) {
      state = "CONFIRMED_DISTRIB";
      const isHeavy = upPct <= 20 && heavyPace;
      label = isHeavy ? "Heavy Distribution" : "Confirmed Distribution";
      shortLabel = isHeavy ? "Heavy Distrib" : "Confirmed Distrib";
      tone = "bad";
      confirmsMove = true;
      biasPts = isHeavy ? -10 : Math.max(-9, -6 - (heavyPace ? 2 : 0) - (upPct <= 25 ? 1 : 0));
      summary = `Institutional selling confirms drop: ${dnTxt} at ${paceTxt} pace (${heavyDown.length}↓ / ${heavyUp.length}↑ heavy-vol).`;
    } else if (lightPace || (upPct > 42 && heavyDown.length <= 2)) {
      state = "LIGHT_PULLBACK";
      label = "Light-Vol Pullback";
      shortLabel = "Light Pullback";
      tone = "cyan";
      confirmsMove = false;
      biasPts = 3;
      summary = `Orderly dip on light ${paceTxt} pace (${heavyDown.length} heavy-vol sellers) — digestion, not panic.`;
    } else {
      state = "MODERATE_SELL";
      label = "Normal Vol Pullback";
      shortLabel = "Normal Dip";
      tone = "warn";
      confirmsMove = true;
      biasPts = -3;
      summary = `Pullback on normal ${paceTxt} pace with ${dnTxt}.`;
    }
  } else {
    if (veryHeavyPace) {
      state = "CHURN_FLAT";
      label = "High-Vol Churn";
      shortLabel = "Vol Churn";
      tone = "warn";
      confirmsMove = false;
      biasPts = -2;
      summary = `Flat price on heavy ${paceTxt} volume (${upTxt}) — battle between buyers and sellers.`;
    } else if (upPct >= 65 && heavyUp.length > heavyDown.length) {
      state = "QUIET_ACCUM";
      label = "Quiet Accumulation";
      shortLabel = "Quiet Accum";
      tone = "good";
      confirmsMove = true;
      biasPts = 5;
      summary = `Under-the-hood accumulation (${upTxt}, ${heavyUp.length}↑ / ${heavyDown.length}↓ heavy-vol) despite flat index.`;
    } else if (upPct <= 35 && heavyDown.length > heavyUp.length) {
      state = "QUIET_DISTRIB";
      label = "Quiet Distribution";
      shortLabel = "Quiet Distrib";
      tone = "bad";
      confirmsMove = true;
      biasPts = -5;
      summary = `Under-the-hood distribution (${dnTxt}, ${heavyDown.length}↓ / ${heavyUp.length}↑ heavy-vol) despite flat index.`;
    }
  }

  return {
    state,
    label,
    shortLabel,
    tone,
    confirmsMove,
    biasPts,
    summary,
    qqqRvol,
    rvolSource,
    barRvol: r30?.barRvol ?? null,
    cumPctile: r30?.cumPctile ?? null,
    cumPctileLabel: r30?.cumPctileLabel ?? null,
    barsAbove: r30?.barsAbove ?? null,
    barsToday: r30?.barsToday ?? null,
    barsAbovePct: r30?.barsAbovePct ?? null,
    upBarVolPct: r30?.upVolPct ?? null,
    todayVol,
    avg20Vol,
    projVol,
    accumDays10,
    distribDays10,
    upDollarVol,
    downDollarVol,
    totalDollarVol,
    upDollarVolPct,
    downDollarVolPct,
    volMinusAdvPct,
    isLiveVol: liveVolCount >= Math.max(1, Math.floor(rows.length * 0.25)),
    is80UpVol: upDollarVolPct != null && upDollarVolPct >= 80,
    is80DownVol: upDollarVolPct != null && upDollarVolPct <= 20,
    heavyUp,
    heavyDown,
    heavyTotal,
    heavyUpPct,
    top8Rvol,
    top8Confirming,
    top8Total,
  };
}

// ── Short-Term Trend (3–15d) & QQQ Options Bias Engine ───────────────────────
// Combines 6 orthogonal factors (-100..+100), plus optional Volume Confirmation (±10):
//   1. Price vs 5d VWAP & Short-Term EMAs (5/10/21) (±20)
//   2. 5D/10D NDX Breadth Thrust & Hook (±20)
//   3. Mag-7 + Semi Weight (~78%) + SMH/QQQ Canary (±15)
//   4. Dealer Gamma (+GEX/-GEX) & Options Flow (±15)
//   5. Macro Tailwind (VIX + 10Y Yield) (±15)
//   6. Live Intraday Reversal / Tape Confirmation (±15)
//   7. Volume Confirmation (optional, ±10)
export function computeQqqShortTermBias({
  qqqBars = [],
  qqqQ = null,
  tech = null,
  internals = null,
  breadthTrend = null,
  intradayPredictor = null,
  volumeConfirmation = null,
  optionsAnalysis = null,
  vix = null,
  us10y = null,
  smhChg = null,
  priceLadder = null,
  stockMap = {},
} = {}) {
  if (!tech && !internals && !breadthTrend) return null;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));

  // 1. Price vs 5d VWAP & Short-Term EMAs (±20)
  let emaPts = 0;
  let emaDetail = "No bar history";
  const closes = (Array.isArray(qqqBars) ? qqqBars : [])
    .map((b) => b?.close)
    .filter((v) => typeof v === "number" && Number.isFinite(v) && v > 0);
  const px = tech?.price ?? qqqQ?.rthPrice ?? qqqQ?.price ?? (closes.length ? closes[closes.length - 1] : null);
  let ema5 = null, ret5d = null;
  if (closes.length >= 10 && px) {
    const e5Series = ema(closes, 5);
    ema5 = e5Series[e5Series.length - 1];
    const c5Ago = closes[Math.max(0, closes.length - 6)];
    ret5d = c5Ago ? +(((px / c5Ago) - 1) * 100).toFixed(2) : null;
  }
  const vwap5d = priceLadder?.vwap5d ?? (qqqBars.length >= 5 ? calcAvwap(qqqBars, qqqBars.length - 5) : null);
  const ema10 = tech?.ema10?.val ?? null;
  const ema21 = tech?.ema21?.val ?? null;
  if (px && ema10 && ema21) {
    if (vwap5d && px > vwap5d) emaPts += 5; else if (vwap5d) emaPts -= 5;
    if (ema5 && px > ema5) emaPts += 4; else if (ema5) emaPts -= 4;
    if (px > ema10) emaPts += 5; else emaPts -= 5;
    if (px > ema21) emaPts += 4; else emaPts -= 4;
    if (ret5d != null) emaPts += ret5d >= 1.5 ? 2 : ret5d <= -1.5 ? -2 : 0;
    emaPts = clamp(emaPts, -20, 20);
    const aboveList = [vwap5d && px > vwap5d ? "5dVWAP" : null, px > ema10 ? "10E" : null, px > ema21 ? "21E" : null].filter(Boolean);
    emaDetail = aboveList.length ? `Above ${aboveList.join("/")} · 5d ${ret5d != null ? `${ret5d >= 0 ? "+" : ""}${ret5d}%` : "—"}` : `Below 5dVWAP/10E/21E`;
  }

  // 2. Short-Term NDX Breadth Thrust & Velocity (±20)
  let breadthPts = 0;
  let breadthDetail = "No breadth history";
  if (breadthTrend) {
    const p20 = breadthTrend.p20 ?? 50;
    const d5p20 = breadthTrend.d5?.p20 ?? 0;
    const d5p50 = breadthTrend.d5?.p50 ?? 0;
    breadthPts += ((p20 - 50) / 50) * 10;
    breadthPts += Math.max(-8, Math.min(8, d5p20 * 0.6));
    breadthPts += Math.max(-4, Math.min(4, d5p50 * 0.4));
    breadthPts = clamp(breadthPts, -20, 20);
    breadthDetail = `>20d ${p20}% (${d5p20 >= 0 ? "+" : ""}${d5p20} 5d)`;
  }

  // 3. Mag-7 + Semi Weight (~78%) + SMH/QQQ Canary (±15)
  let enginePts = 0;
  let engineDetail = "—";
  const rows = internals?.rows || [];
  let engTotalW = 0, engAbove20W = 0, engUp1wW = 0;
  for (const r of rows) {
    if (r.group !== "mag7" && r.group !== "semi") continue;
    const w = r.weightPct || 0;
    if (!(w > 0)) continue;
    engTotalW += w;
    if ((r.sma20 ?? -1) > 0) engAbove20W += w;
    const r1w = stockMap?.[r.ticker]?.return_1w;
    if ((r1w ?? (r.chg ?? 0)) > 0) engUp1wW += w;
  }
  const engineAbove20Pct = engTotalW > 0 ? Math.round((engAbove20W / engTotalW) * 100) : null;
  const engineUp1wPct = engTotalW > 0 ? Math.round((engUp1wW / engTotalW) * 100) : null;
  const qqqChg = tech?.chgPct ?? qqqQ?.change ?? null;
  const smhSpread = smhChg != null && qqqChg != null ? +(smhChg - qqqChg).toFixed(2) : null;
  if (engineAbove20Pct != null) {
    let rawEng = ((engineAbove20Pct - 50) / 50) * 9 + (((engineUp1wPct ?? 50) - 50) / 50) * 4;
    if (smhSpread != null) rawEng += smhSpread >= 0.4 ? 2 : smhSpread <= -0.4 ? -2 : 0;
    enginePts = clamp(rawEng, -15, 15);
    engineDetail = `${engineAbove20Pct}% >20d${smhSpread != null ? ` · SMH ${smhSpread >= 0 ? "+" : ""}${smhSpread}% vs Q` : ""}`;
  }

  // 4. Dealer Gamma (+GEX/-GEX) & Live Options Flow (±15)
  let optPts = 0;
  let optDetail = "Loading QQQ options…";
  let gammaRegime = null;
  if (optionsAnalysis) {
    const posGex = (optionsAnalysis.netGex ?? 0) >= 0;
    gammaRegime = posGex
      ? { state: "POSITIVE_GEX", label: "+GEX Pinning", hint: "Dealers dampen swings — favor spreads & range levels", tone: "cyan" }
      : { state: "NEGATIVE_GEX", label: "−GEX Trend/Volatile", hint: "Dealers amplify moves — favor outright Calls/Puts on breaks", tone: "warn" };
    const totPrem = (optionsAnalysis.totalCallPrem || 0) + (optionsAnalysis.totalPutPrem || 0);
    const callShare = totPrem > 0 ? Math.round((optionsAnalysis.totalCallPrem / totPrem) * 100) : 50;
    // Call flow dominance (+8..-8), P/C ratio (+4..-4), above Gamma Flip (+3..-3)
    optPts += ((callShare - 50) / 50) * 8;
    if (optionsAnalysis.pcVolRatio != null) {
      optPts += optionsAnalysis.pcVolRatio <= 0.75 ? 4 : optionsAnalysis.pcVolRatio >= 1.25 ? -4 : 0;
    }
    if (optionsAnalysis.gammaFlip && px) {
      optPts += px > optionsAnalysis.gammaFlip ? 3 : -3;
    }
    optPts = clamp(optPts, -15, 15);
    optDetail = `${gammaRegime.label} · ${callShare}% Call $`;
  } else if (internals) {
    // Fallback to Equal-Wt vs Cap-Wt if QQQ options haven't loaded yet
    const advPct = internals.pctAdv ?? 50;
    optPts = clamp(((advPct - 50) / 50) * 15, -15, 15);
    optDetail = `${advPct}% NDX advancing`;
  }

  // 5. Macro Tailwind: VIX & 10Y Treasury Yield (±15)
  let macroPts = 0;
  let macroDetail = "Neutral macro";
  const vixVal = typeof vix?.price === "number" ? vix.price : null;
  const vixChg = typeof vix?.changePct === "number" ? vix.changePct : null;
  const tnxChg = typeof us10y?.changePct === "number" ? us10y.changePct : null;
  if (vixVal != null || tnxChg != null) {
    if (vixVal != null) {
      macroPts += vixVal < 16 ? 5 : vixVal < 20 ? 2 : vixVal > 28 ? -5 : vixVal > 22 ? -2 : 0;
    }
    if (vixChg != null) {
      macroPts += vixChg <= -5 ? 5 : vixChg <= -2 ? 2 : vixChg >= 8 ? -5 : vixChg >= 3 ? -2 : 0;
    }
    if (tnxChg != null) {
      // Falling 10Y yields are bullish for long-duration QQQ tech
      macroPts += tnxChg <= -1.2 ? 5 : tnxChg <= -0.4 ? 2 : tnxChg >= 1.5 ? -5 : tnxChg >= 0.5 ? -2 : 0;
    }
    macroPts = clamp(macroPts, -15, 15);
    const parts = [];
    if (vixVal != null) parts.push(`VIX ${vixVal.toFixed(1)}${vixChg != null ? ` (${vixChg >= 0 ? "+" : ""}${vixChg.toFixed(1)}%)` : ""}`);
    if (us10y?.price != null) parts.push(`10Y ${us10y.price.toFixed(2)}%`);
    macroDetail = parts.join(" · ") || "Neutral macro";
  }

  // 6. Live Intraday Reversal / Tape Confirmation (±15)
  let intraPts = 0;
  let intraDetail = "—";
  if (intradayPredictor) {
    intraPts = clamp(((intradayPredictor.score - 50) / 50) * 15, -15, 15);
    intraDetail = `${intradayPredictor.verdict} (${intradayPredictor.score}/100)`;
  }

  // 7. Volume Confirmation (optional, ±10)
  const volPts = volumeConfirmation ? clamp(volumeConfirmation.biasPts ?? 0, -10, 10) : 0;
  const volDetail = volumeConfirmation
    ? `${volumeConfirmation.shortLabel}${volumeConfirmation.upDollarVolPct != null ? ` · ${Math.round(volumeConfirmation.upDollarVolPct)}% Up $Vol` : ""}${volumeConfirmation.qqqRvol != null ? ` · ${volumeConfirmation.qqqRvol.toFixed(2)}×` : ""}`
    : null;

  const score = clamp(emaPts + breadthPts + enginePts + optPts + macroPts + intraPts + volPts, -100, 100);

  let bias = "NEUTRAL";
  let label = "Neutral / Chop";
  let outlook = "bullish";
  let suggestedHorizon = "swing";
  let tone = "muted";
  let optionPlay = "Mixed signals — wait for price to clear resistance or break support before sizing up.";
  const gexAdvice = gammaRegime?.state === "NEGATIVE_GEX"
    ? " (−GEX tape favors outright contracts over spreads)"
    : gammaRegime?.state === "POSITIVE_GEX"
      ? " (+GEX pinning tape — take profits near walls or use spreads)"
      : "";

  if (score >= 40) {
    bias = "STRONG_BULLISH";
    label = "Strong Bullish";
    outlook = "bullish";
    suggestedHorizon = "swing";
    tone = "good";
    optionPlay = `Lean Bullish: QQQ Swing Calls (30–60d)${gexAdvice}.`;
  } else if (score >= 15) {
    bias = "TACTICAL_BULLISH";
    label = "Tactical Bullish";
    outlook = "bullish";
    suggestedHorizon = "short";
    tone = "cyan";
    optionPlay = `Lean Tactical Bullish: Calls on pullbacks / confirmation${gexAdvice}.`;
  } else if (score <= -40) {
    bias = "STRONG_BEARISH";
    label = "Strong Bearish";
    outlook = "bearish";
    suggestedHorizon = "swing";
    tone = "bad";
    optionPlay = `Lean Bearish: QQQ Swing Puts (30–60d)${gexAdvice}.`;
  } else if (score <= -15) {
    bias = "TACTICAL_BEARISH";
    label = "Tactical Bearish";
    outlook = "bearish";
    suggestedHorizon = "short";
    tone = "warn";
    optionPlay = `Lean Tactical Bearish: Puts on failed bounces into resistance${gexAdvice}.`;
  }

  // Actionable trigger & invalidation levels (prefer unified priceLadder when present)
  const bullTrigger = priceLadder?.nearestResistance
    ? { label: priceLadder.nearestResistance.label, px: priceLadder.nearestResistance.price }
    : (px && ema10 && ema10 > px ? { label: "10 EMA", px: +ema10.toFixed(2) } : null);
  const bearTrigger = priceLadder?.nearestSupport
    ? { label: priceLadder.nearestSupport.label, px: priceLadder.nearestSupport.price }
    : (px && ema21 && ema21 < px ? { label: "21 EMA", px: +ema21.toFixed(2) } : null);

  const factors = [
    { key: "ema", label: "5d VWAP & EMAs", pts: emaPts, max: 20, detail: emaDetail },
    { key: "breadth", label: "5D Breadth Thrust", pts: breadthPts, max: 20, detail: breadthDetail },
    { key: "engine", label: "Mag-7 + SMH Canary", pts: enginePts, max: 15, detail: engineDetail },
    { key: "options", label: "Dealer Gamma & Flow", pts: optPts, max: 15, detail: optDetail },
    { key: "macro", label: "VIX & 10Y Macro", pts: macroPts, max: 15, detail: macroDetail },
    { key: "intra", label: "Intraday Reversal", pts: intraPts, max: 15, detail: intraDetail },
  ];
  if (volumeConfirmation) {
    factors.push({ key: "volume", label: "Volume Confirmation", pts: volPts, max: 10, detail: volDetail });
  }

  return {
    score,
    bias,
    label,
    outlook,
    suggestedHorizon,
    tone,
    optionPlay,
    gammaRegime,
    ret5d,
    engineAbove20Pct,
    engineUp1wPct,
    bullTrigger,
    bearTrigger,
    factors,
  };
}

// ── Dead-Simple 1-Glance QQQ Action Signal ───────────────────────────────────
// Synthesizes bias + intraday tape + volume confirmation + price ladder into ONE clear call:
//   BUY CALLS | BUY PUTS | WAIT
// plus just 3 plain numbers (Spot/Trigger, Target, Stop) and 1 plain sentence.
export function buildSimpleQqqSignal({ shortTermBias, intradayPred, priceLadder, volumeConfirmation } = {}) {
  if (!shortTermBias) return null;
  const factors = shortTermBias.factors || [];
  const bullCount = factors.filter((f) => f.pts >= 3).length;
  const bearCount = factors.filter((f) => f.pts <= -3).length;
  const total = factors.length || 6;

  const spot = priceLadder?.spot ?? null;
  const res = priceLadder?.nearestResistance || null;
  const sup = priceLadder?.nearestSupport || null;
  // Pick a meaningful Target at least ~1.2% away if available, else nearest level
  const pickTarget = (list, fallback) => {
    const arr = Array.isArray(list) ? list : [];
    const far = arr.find((x) => Math.abs(x.pct) >= 1.2);
    return far || fallback || arr[0] || null;
  };
  const bullTarget = pickTarget([...(priceLadder?.resistance || [])].reverse(), res);
  const bearTarget = pickTarget(priceLadder?.support || [], sup);

  const sellingHard = intradayPred?.state === "SELLOFF_ACTIVE";
  const fadingHard = intradayPred?.state === "FADE_WARNING";
  const recovering = intradayPred?.state === "RECOVERY_TRIGGERED";

  let action = "WAIT";
  let headline = "WAIT — NO CLEAR EDGE";
  let tone = "warn";
  let outlook = shortTermBias.outlook || "bullish";
  let why = "";
  let trigger = res ? `Above $${res.price.toFixed(2)} (${res.label})` : "Wait for breakout";
  let target = bullTarget;
  let stop = sup;

  if (shortTermBias.score >= 20 && !sellingHard && !fadingHard) {
    action = "BUY_CALLS";
    headline = "BUY CALLS (BULLISH)";
    tone = "good";
    outlook = "bullish";
    trigger = recovering
      ? `Active now (~$${spot?.toFixed(2) ?? "—"})`
      : (res && Math.abs(res.pct) <= 0.8 ? `Break $${res.price.toFixed(2)}` : `Dips toward $${sup?.price?.toFixed(2) ?? spot?.toFixed(2) ?? "—"}`);
    target = bullTarget;
    stop = sup;
    why = `${bullCount} of ${total} signals are bullish` +
      (recovering ? " and intraday buyers just triggered a reversal." : " with trend, mega-caps, and tape supporting upside.");
  } else if (shortTermBias.score <= -20 && !recovering) {
    action = "BUY_PUTS";
    headline = "BUY PUTS (BEARISH)";
    tone = "bad";
    outlook = "bearish";
    trigger = sellingHard || fadingHard
      ? `Active now (~$${spot?.toFixed(2) ?? "—"})`
      : (sup && Math.abs(sup.pct) <= 0.8 ? `Break $${sup.price.toFixed(2)}` : `Bounces near $${res?.price?.toFixed(2) ?? spot?.toFixed(2) ?? "—"}`);
    target = bearTarget;
    stop = res;
    why = `${bearCount} of ${total} signals are bearish` +
      (sellingHard ? " and sellers are still in control intraday." : " with short-term trend and breadth pointing lower.");
  } else {
    action = "WAIT";
    headline = "WAIT — STAY PATIENT";
    tone = "warn";
    if (sellingHard && shortTermBias.score > -20) {
      why = "Selloff is still active intraday — wait for >50% of Nasdaq-100 to turn green from the open before buying calls.";
    } else if (recovering && shortTermBias.score < 20) {
      why = "Intraday bounce is underway, but broader short-term trend is still mixed — wait for confirmation above resistance.";
    } else {
      why = `Mixed tape (${bullCount} bullish vs ${bearCount} bearish out of ${total}) — no forced QQQ trade until price breaks a key level.`;
    }
    trigger = res && sup
      ? `Calls > $${res.price.toFixed(2)} · Puts < $${sup.price.toFixed(2)}`
      : "Wait for directional break";
    target = bullTarget;
    stop = sup;
  }

  // Append concise volume confirmation clause to plain-English `why`
  if (volumeConfirmation) {
    const vPace = volumeConfirmation.qqqRvol != null ? `${volumeConfirmation.qqqRvol.toFixed(2)}× vol` : "vol";
    const vUp = volumeConfirmation.upDollarVolPct != null ? `${Math.round(volumeConfirmation.upDollarVolPct)}% Up $Vol` : null;
    if (action === "BUY_CALLS") {
      if (volumeConfirmation.state === "CONFIRMED_ACCUM") {
        why += vUp ? ` Volume confirms (${vUp} at ${vPace}).` : ` Volume confirms (${vPace}).`;
      } else if (volumeConfirmation.state === "HOLLOW_RALLY" || volumeConfirmation.state === "CHURN_DIVERGENCE") {
        why += ` Caution: ${volumeConfirmation.label.toLowerCase()} (${vPace}${vUp ? `, ${vUp}` : ""}).`;
      }
    } else if (action === "BUY_PUTS") {
      if (volumeConfirmation.state === "CONFIRMED_DISTRIB") {
        why += ` Selling volume confirms (${vPace}${volumeConfirmation.downDollarVolPct != null ? `, ${Math.round(volumeConfirmation.downDollarVolPct)}% Down $Vol` : ""}).`;
      } else if (volumeConfirmation.state === "LIGHT_PULLBACK" || volumeConfirmation.state === "ABSORPTION") {
        why += ` Note: ${volumeConfirmation.label.toLowerCase()} (${vPace}) — don't chase shorts blindly.`;
      }
    }
  }

  return {
    action,
    headline,
    tone,
    outlook,
    why,
    bullCount,
    bearCount,
    total,
    spot,
    trigger,
    target,
    stop,
    volTag: volumeConfirmation
      ? {
          state: volumeConfirmation.state,
          label: volumeConfirmation.shortLabel,
          tone: volumeConfirmation.tone,
          confirmsMove: volumeConfirmation.confirmsMove,
          summary: volumeConfirmation.summary,
        }
      : null,
  };
}
