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
