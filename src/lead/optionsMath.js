// Pure Black-Scholes Greeks, key levels (Expected Move, Max Pain, Call/Put Walls,
// Net GEX, Gamma Flip, 25D Skew), Swing Call Finder, and Unusual Options Flow math.
// Kept React/DOM-free so every calculation can be unit-tested directly under Node.

export const RISK_FREE_RATE = 0.045;

// ── Normal distribution PDF / CDF (Abramowitz & Stegun 7.1.26, |err| < 7.5e-8) ──
const INV_SQRT_2PI = 1 / Math.sqrt(2 * Math.PI);

export function normPdf(x) {
  return INV_SQRT_2PI * Math.exp(-0.5 * x * x);
}

export function normCdf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * ax);
  const poly =
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = 1 - poly * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * erf);
}

// ── Black-Scholes Price & Greeks ─────────────────────────────────────────────
export function bsPrice(S, K, T, r, iv, type = "call") {
  if (!(S > 0 && K > 0)) return 0;
  const isCall = type === "call" || type === "C";
  if (!(T > 0 && iv > 0)) {
    return isCall ? Math.max(0, S - K) : Math.max(0, K - S);
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * iv * iv) * T) / (iv * sqrtT);
  const d2 = d1 - iv * sqrtT;
  const disc = Math.exp(-r * T);
  if (isCall) return Math.max(0, S * normCdf(d1) - K * disc * normCdf(d2));
  return Math.max(0, K * disc * normCdf(-d2) - S * normCdf(-d1));
}

export function bsGreeks(S, K, T, r, iv, type = "call") {
  const isCall = type === "call" || type === "C";
  if (!(S > 0 && K > 0 && iv > 0.005)) {
    const intrinsicDelta = isCall ? (S >= K ? 1 : 0) : (S <= K ? -1 : 0);
    return { delta: intrinsicDelta, gamma: 0, theta: 0, vega: 0 };
  }
  const effT = Math.max(T, 0.25 / 365);
  const sqrtT = Math.sqrt(effT);
  const d1 = (Math.log(S / K) + (r + 0.5 * iv * iv) * effT) / (iv * sqrtT);
  const d2 = d1 - iv * sqrtT;
  const pdf1 = normPdf(d1);
  const disc = Math.exp(-r * effT);

  const delta = isCall ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = pdf1 / (S * iv * sqrtT);
  const thetaAnn = isCall
    ? -(S * pdf1 * iv) / (2 * sqrtT) - r * K * disc * normCdf(d2)
    : -(S * pdf1 * iv) / (2 * sqrtT) + r * K * disc * normCdf(-d2);
  const theta = thetaAnn / 365;
  const vega = (S * pdf1 * sqrtT) / 100;

  return {
    delta: Math.round(delta * 1000) / 1000,
    gamma: Math.round(gamma * 100000) / 100000,
    theta: Math.round(theta * 1000) / 1000,
    vega: Math.round(vega * 1000) / 1000,
  };
}

// ── Contract Helpers ─────────────────────────────────────────────────────────
export function contractMid(c) {
  if (!c) return 0;
  const bid = Number.isFinite(c.bid) && c.bid > 0 ? c.bid : 0;
  const ask = Number.isFinite(c.ask) && c.ask > 0 ? c.ask : 0;
  if (bid > 0 && ask > 0) return Math.round(((bid + ask) / 2) * 100) / 100;
  if (Number.isFinite(c.last) && c.last > 0) return Math.round(c.last * 100) / 100;
  return Math.round((ask || bid || 0) * 100) / 100;
}

export function contractSpreadPct(c) {
  if (!c) return null;
  const bid = Number.isFinite(c.bid) && c.bid > 0 ? c.bid : 0;
  const ask = Number.isFinite(c.ask) && c.ask > 0 ? c.ask : 0;
  if (bid > 0 && ask >= bid) {
    const mid = (bid + ask) / 2;
    return mid > 0 ? Math.round(((ask - bid) / mid) * 1000) / 10 : null;
  }
  if (ask > 0 && bid === 0) return 100;
  return null;
}

export function liquidityGrade(spreadPct, oi, vol) {
  if (spreadPct != null && spreadPct <= 4 && (oi >= 500 || vol >= 250)) return "A";
  if (spreadPct != null && spreadPct <= 8 && (oi >= 100 || vol >= 50)) return "B";
  if ((spreadPct == null || spreadPct <= 15) && (oi >= 25 || vol >= 15)) return "C";
  return "D";
}

function validIv(iv) {
  return typeof iv === "number" && Number.isFinite(iv) && iv >= 0.02 && iv <= 5.0 ? iv : null;
}

// Estimate 20-day annualized historical volatility from 20d ADR (%)
export function hvFromAdr(adr20) {
  if (!(typeof adr20 === "number" && Number.isFinite(adr20) && adr20 > 0)) return null;
  // Parkinson / range-to-close factor ~1.35 converts daily high-low range to close-to-close σ
  return Math.round(((adr20 / 100) * Math.sqrt(252) / 1.35) * 1000) / 1000;
}

export function enrichContract(c, { spot, dte, type, fallbackIv = null, ticker = "", expDate = "" }) {
  const isCall = type === "call" || type === "C";
  const mid = contractMid(c);
  const spreadPct = contractSpreadPct(c);
  const effIv = validIv(c.iv) ?? validIv(fallbackIv);
  const T = Math.max(dte ?? 0, 0.25) / 365;
  const hasExchangeGreeks =
    typeof c.delta === "number" && Number.isFinite(c.delta) &&
    typeof c.gamma === "number" && Number.isFinite(c.gamma) &&
    typeof c.theta === "number" && Number.isFinite(c.theta) &&
    typeof c.vega === "number" && Number.isFinite(c.vega);
  const greeks = hasExchangeGreeks
    ? { delta: c.delta, gamma: c.gamma, theta: c.theta, vega: c.vega }
    : (effIv
      ? bsGreeks(spot, c.strike, T, RISK_FREE_RATE, effIv, isCall ? "call" : "put")
      : bsGreeks(spot, c.strike, T, RISK_FREE_RATE, 0, isCall ? "call" : "put"));

  const vol = c.vol || 0;
  const oi = c.oi || 0;
  const volOi = oi > 0 ? Math.round((vol / oi) * 100) / 100 : (vol >= 50 ? 99 : 0);
  const notional = Math.round(vol * mid * 100);
  const breakeven = isCall ? c.strike + mid : c.strike - mid;
  const breakevenPct = spot > 0 ? Math.round(((breakeven - spot) / spot) * 1000) / 10 : null;
  const leverage = mid > 0 && spot > 0 ? Math.round((Math.abs(greeks.delta) * spot / mid) * 10) / 10 : null;
  const grade = liquidityGrade(spreadPct, oi, vol);
  const unusual = vol >= 50 && (volOi >= 1.5 || notional >= 100_000);

  return {
    ...c,
    ticker,
    expDate,
    dte,
    type: isCall ? "call" : "put",
    mid,
    spreadPct,
    iv: effIv,
    ...greeks,
    vol,
    oi,
    volOi,
    notional,
    breakeven: Math.round(breakeven * 100) / 100,
    breakevenPct,
    leverage,
    grade,
    unusual,
  };
}

// ── Full Chain Key Levels & Structure Analytics ──────────────────────────────
export function analyzeOptionChain(chain, spot, { ticker = "", adr20 = null, earningsDays = null } = {}) {
  if (!chain || !(spot > 0)) return null;
  const rawCalls = Array.isArray(chain.calls) ? chain.calls : [];
  const rawPuts = Array.isArray(chain.puts) ? chain.puts : [];
  const dte = chain.dte ?? 0;
  const expDate = chain.date || "";

  // Find ATM strike (closest to spot across all strikes)
  const strikeSet = new Set();
  for (const c of rawCalls) if (c.strike != null) strikeSet.add(c.strike);
  for (const p of rawPuts) if (p.strike != null) strikeSet.add(p.strike);
  const allStrikes = [...strikeSet].sort((a, b) => a - b);
  if (!allStrikes.length) return null;

  let atmStrike = allStrikes[0];
  let bestDist = Infinity;
  for (const k of allStrikes) {
    const d = Math.abs(k - spot);
    if (d < bestDist) { bestDist = d; atmStrike = k; }
  }

  // Estimate ATM IV first so contracts with Yahoo's 0.00001 IV glitch get a clean fallback
  const nearCalls = rawCalls.filter((c) => Math.abs(c.strike - spot) / spot <= 0.04 && validIv(c.iv));
  const nearPuts = rawPuts.filter((p) => Math.abs(p.strike - spot) / spot <= 0.04 && validIv(p.iv));
  const atmIvVals = [];
  const pickNearestIv = (arr) => {
    if (!arr.length) return null;
    const sorted = [...arr].sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot));
    return sorted[0].iv;
  };
  const cAtmIv = pickNearestIv(nearCalls);
  const pAtmIv = pickNearestIv(nearPuts);
  if (cAtmIv != null) atmIvVals.push(cAtmIv);
  if (pAtmIv != null) atmIvVals.push(pAtmIv);
  const atmIv = atmIvVals.length
    ? Math.round((atmIvVals.reduce((a, b) => a + b, 0) / atmIvVals.length) * 1000) / 1000
    : null;

  const calls = rawCalls.map((c) => enrichContract(c, { spot, dte, type: "call", fallbackIv: atmIv, ticker, expDate }));
  const puts = rawPuts.map((p) => enrichContract(p, { spot, dte, type: "put", fallbackIv: atmIv, ticker, expDate }));

  const callByStrike = new Map(calls.map((c) => [c.strike, c]));
  const putByStrike = new Map(puts.map((p) => [p.strike, p]));

  // Expected Move (0.85 × ATM straddle mid, fallback to IV√T)
  const atmCall = callByStrike.get(atmStrike);
  const atmPut = putByStrike.get(atmStrike);
  let emDollars = null;
  if (atmCall?.mid > 0 && atmPut?.mid > 0) {
    emDollars = 0.85 * (atmCall.mid + atmPut.mid);
  } else if (atmIv != null) {
    emDollars = spot * atmIv * Math.sqrt(Math.max(dte, 1) / 365);
  }
  const expectedMove = emDollars != null && emDollars > 0
    ? {
        dollars: Math.round(emDollars * 100) / 100,
        pct: Math.round((emDollars / spot) * 1000) / 10,
        upper: Math.round((spot + emDollars) * 100) / 100,
        lower: Math.round((spot - emDollars) * 100) / 100,
      }
    : null;

  // HV20 from ADR20 & IV/HV ratio
  const hv20 = hvFromAdr(adr20);
  const ivHvRatio = atmIv != null && hv20 > 0 ? Math.round((atmIv / hv20) * 100) / 100 : null;

  // Totals, P/C ratios, Call/Put Walls, GEX per strike
  let totalCallVol = 0, totalPutVol = 0, totalCallOi = 0, totalPutOi = 0;
  let totalCallPrem = 0, totalPutPrem = 0;
  let callWall = null, putWall = null;
  let netGex = 0;

  for (const c of calls) {
    totalCallVol += c.vol;
    totalCallOi += c.oi;
    totalCallPrem += c.notional;
    if (c.strike >= spot * 0.995 && (!callWall || c.oi > callWall.oi)) {
      callWall = { strike: c.strike, oi: c.oi, vol: c.vol };
    }
  }
  if (!callWall && calls.length) {
    const best = [...calls].sort((a, b) => b.oi - a.oi)[0];
    if (best?.oi > 0) callWall = { strike: best.strike, oi: best.oi, vol: best.vol };
  }

  for (const p of puts) {
    totalPutVol += p.vol;
    totalPutOi += p.oi;
    totalPutPrem += p.notional;
    if (p.strike <= spot * 1.005 && (!putWall || p.oi > putWall.oi)) {
      putWall = { strike: p.strike, oi: p.oi, vol: p.vol };
    }
  }
  if (!putWall && puts.length) {
    const best = [...puts].sort((a, b) => b.oi - a.oi)[0];
    if (best?.oi > 0) putWall = { strike: best.strike, oi: best.oi, vol: best.vol };
  }

  // Per-strike OI & GEX profile (dealer gamma convention: +Call GEX, -Put GEX in $ per 1% move)
  const gexScale = 100 * spot * spot * 0.01;
  const fullProfile = allStrikes.map((k) => {
    const c = callByStrike.get(k);
    const p = putByStrike.get(k);
    const cGex = c ? c.oi * (c.gamma || 0) * gexScale : 0;
    const pGex = p ? -p.oi * (p.gamma || 0) * gexScale : 0;
    const net = cGex + pGex;
    netGex += net;
    return {
      strike: k,
      callOi: c?.oi || 0,
      putOi: p?.oi || 0,
      callVol: c?.vol || 0,
      putVol: p?.vol || 0,
      callGex: Math.round(cGex),
      putGex: Math.round(pGex),
      netGex: Math.round(net),
    };
  });

  // Gamma Flip: strike nearest spot where cumulative GEX (or adjacent strike netGex) crosses 0
  let gammaFlip = null;
  const nearProfile = fullProfile.filter((row) => Math.abs(row.strike - spot) / spot <= 0.15);
  let bestFlipDist = Infinity;
  for (let i = 1; i < nearProfile.length; i++) {
    const a = nearProfile[i - 1];
    const b = nearProfile[i];
    if ((a.netGex < 0 && b.netGex > 0) || (a.netGex > 0 && b.netGex < 0)) {
      const t = Math.abs(a.netGex) / (Math.abs(a.netGex) + Math.abs(b.netGex));
      const cross = a.strike + (b.strike - a.strike) * t;
      const dist = Math.abs(cross - spot);
      if (dist < bestFlipDist) {
        bestFlipDist = dist;
        gammaFlip = Math.round(cross * 100) / 100;
      }
    }
  }

  // Max Pain (strike minimizing total intrinsic payout across all open interest)
  let maxPain = null;
  if (totalCallOi + totalPutOi > 0) {
    // Only test strikes with some OI nearby (cap for speed on huge index chains)
    const testStrikes = allStrikes.filter((k) => Math.abs(k - spot) / spot <= 0.35);
    const candidates = testStrikes.length ? testStrikes : allStrikes;
    let minPayout = Infinity;
    let bestK = null;
    for (const k of candidates) {
      let payout = 0;
      for (const c of calls) if (c.oi > 0 && k > c.strike) payout += c.oi * (k - c.strike);
      for (const p of puts) if (p.oi > 0 && p.strike > k) payout += p.oi * (p.strike - k);
      if (payout < minPayout) {
        minPayout = payout;
        bestK = k;
      }
    }
    if (bestK != null) {
      maxPain = {
        strike: bestK,
        pctFromSpot: Math.round(((bestK - spot) / spot) * 1000) / 10,
      };
    }
  }

  // 25-Delta IV Skew (25D Put IV − 25D Call IV in percentage points)
  const findDeltaIv = (arr, targetDelta) => {
    const valid = arr.filter((x) => validIv(x.iv) && Number.isFinite(x.delta) && x.mid > 0);
    if (!valid.length) return null;
    const best = [...valid].sort((a, b) => Math.abs(a.delta - targetDelta) - Math.abs(b.delta - targetDelta))[0];
    return best && Math.abs(best.delta - targetDelta) <= 0.15 ? best.iv : null;
  };
  const put25Iv = findDeltaIv(puts, -0.25);
  const call25Iv = findDeltaIv(calls, 0.25);
  const ivSkew = put25Iv != null && call25Iv != null
    ? Math.round((put25Iv - call25Iv) * 1000) / 10
    : null;

  const pcVolRatio = totalCallVol > 0 ? Math.round((totalPutVol / totalCallVol) * 100) / 100 : null;
  const pcOiRatio = totalCallOi > 0 ? Math.round((totalPutOi / totalCallOi) * 100) / 100 : null;

  // Slice profile around ATM for chart (±14 strikes)
  const atmIdx = allStrikes.indexOf(atmStrike);
  const loIdx = Math.max(0, atmIdx - 14);
  const hiIdx = Math.min(allStrikes.length, atmIdx + 15);
  const strikeProfile = fullProfile.slice(loIdx, hiIdx);

  const earningsBeforeExpiry =
    earningsDays != null && Number.isFinite(earningsDays) && earningsDays >= 0 && earningsDays <= dte;

  return {
    ticker,
    spot,
    expDate,
    dte,
    atmStrike,
    atmIv,
    hv20,
    ivHvRatio,
    expectedMove,
    maxPain,
    callWall,
    putWall,
    netGex: Math.round(netGex),
    gammaFlip,
    ivSkew,
    pcVolRatio,
    pcOiRatio,
    totalCallVol,
    totalPutVol,
    totalCallOi,
    totalPutOi,
    totalCallPrem: Math.round(totalCallPrem),
    totalPutPrem: Math.round(totalPutPrem),
    netFlowPrem: Math.round(totalCallPrem - totalPutPrem),
    earningsBeforeExpiry,
    earningsDays,
    calls,
    puts,
    allStrikes,
    strikeProfile,
  };
}

// ── Breakout / Swing Call & Debit Spread Finder ──────────────────────────────
export function findSwingCallSetups(analysis, { earningsDays = null } = {}) {
  if (!analysis || !Array.isArray(analysis.calls) || !analysis.calls.length) return [];
  const { spot, dte, expDate, expectedMove, callWall, atmIv } = analysis;
  const emDollars = expectedMove?.dollars || (atmIv ? spot * atmIv * Math.sqrt(Math.max(dte, 7) / 365) : spot * 0.06);
  const targetSpot = spot + emDollars;
  // Remaining time if +1σ move happens within 1/3 of DTE
  const remT = Math.max(1, dte * 0.67) / 365;
  const earningsBeforeExpiry =
    earningsDays != null && Number.isFinite(earningsDays) && earningsDays >= 0 && earningsDays <= dte;

  // Liquid call pool
  const liquid = analysis.calls.filter(
    (c) => c.mid >= 0.1 && (c.oi >= 10 || c.vol >= 10) && (c.spreadPct == null || c.spreadPct <= 25)
  );
  const pool = liquid.length ? liquid : analysis.calls.filter((c) => c.mid >= 0.05);
  if (!pool.length) return [];

  const pickByDelta = (minD, maxD, targetD, exclude = null) => {
    const inRange = pool.filter(
      (c) => c.delta >= minD && c.delta <= maxD && (!exclude || !exclude.has(c.strike))
    );
    if (!inRange.length) return null;
    // Prefer tight spreads, good OI, and close to target delta
    return [...inRange].sort((a, b) => {
      const score = (c) => {
        const dErr = Math.abs(c.delta - targetD) * 40;
        const sprPen = Math.min(25, c.spreadPct ?? 12) * 1.2;
        const liqBonus = Math.min(10, Math.log10(Math.max(1, c.oi + c.vol * 2)) * 2.5);
        return dErr + sprPen - liqBonus;
      };
      return score(a) - score(b);
    })[0];
  };

  const buildSingle = (style, subtitle, accent, c) => {
    if (!c) return null;
    const projPrice = c.iv
      ? bsPrice(targetSpot, c.strike, remT, RISK_FREE_RATE, c.iv, "call")
      : Math.max(0, targetSpot - c.strike);
    const estGain1Em = c.mid > 0 ? Math.round(((projPrice - c.mid) / c.mid) * 100) : null;
    return {
      kind: "single",
      style,
      subtitle,
      accent,
      sym: c.sym,
      strike: c.strike,
      expDate,
      dte,
      bid: c.bid,
      ask: c.ask,
      mid: c.mid,
      spreadPct: c.spreadPct,
      delta: c.delta,
      theta: c.theta,
      iv: c.iv,
      oi: c.oi,
      vol: c.vol,
      grade: c.grade,
      breakeven: c.breakeven,
      breakevenPct: c.breakevenPct,
      leverage: c.leverage,
      maxRiskPerContract: Math.round(c.mid * 100),
      estGain1Em,
      earningsBeforeExpiry,
      earningsDays,
    };
  };

  const setups = [];
  const usedStrikes = new Set();

  const swing = pickByDelta(0.52, 0.72, 0.62);
  if (swing) {
    usedStrikes.add(swing.strike);
    setups.push(buildSingle("Momentum Swing", "0.55–0.70 Δ · Balanced trend ride", "#34d399", swing));
  }

  const breakout = pickByDelta(0.30, 0.54, 0.44, usedStrikes);
  if (breakout) {
    usedStrikes.add(breakout.strike);
    setups.push(buildSingle("Breakout Call", "0.35–0.50 Δ · Higher convexity", "#38bdf8", breakout));
  }

  const stockRep = pickByDelta(0.72, 0.88, 0.78, usedStrikes);
  if (stockRep) {
    usedStrikes.add(stockRep.strike);
    setups.push(buildSingle("Stock Replacement", "0.75–0.85 Δ · Low theta drag", "#fbbf24", stockRep));
  }

  // Bull Call Debit Spread: Long ~0.60Δ / Short ~0.30Δ (or near Call Wall / +1σ EM)
  const longLeg = swing || pickByDelta(0.50, 0.72, 0.60);
  if (longLeg) {
    const shortCandidates = pool.filter(
      (c) => c.strike > longLeg.strike && c.delta >= 0.18 && c.delta <= 0.42
    );
    const idealShortStrike = Math.max(
      longLeg.strike + 1,
      callWall?.strike && callWall.strike > longLeg.strike ? Math.min(callWall.strike, targetSpot * 1.04) : targetSpot
    );
    const shortLeg = [...shortCandidates].sort(
      (a, b) => Math.abs(a.strike - idealShortStrike) - Math.abs(b.strike - idealShortStrike)
    )[0];

    if (shortLeg) {
      const width = Math.round((shortLeg.strike - longLeg.strike) * 100) / 100;
      const debit = Math.round((longLeg.mid - shortLeg.mid) * 100) / 100;
      if (width > 0 && debit > 0.05 && debit < width * 0.85) {
        const maxProfit = Math.round((width - debit) * 100) / 100;
        const rr = Math.round((maxProfit / debit) * 100) / 100;
        const be = Math.round((longLeg.strike + debit) * 100) / 100;
        const bePct = spot > 0 ? Math.round(((be - spot) / spot) * 1000) / 10 : null;
        const netDelta = Math.round((longLeg.delta - shortLeg.delta) * 1000) / 1000;
        const netTheta = Math.round((longLeg.theta - shortLeg.theta) * 1000) / 1000;
        const spr = Math.max(longLeg.spreadPct ?? 0, shortLeg.spreadPct ?? 0);
        setups.push({
          kind: "spread",
          style: "Bull Call Spread",
          subtitle: `Long ${longLeg.strike}C / Short ${shortLeg.strike}C · Cuts IV drag`,
          accent: "#c084fc",
          strike: longLeg.strike,
          shortStrike: shortLeg.strike,
          width,
          expDate,
          dte,
          mid: debit,
          spreadPct: spr,
          delta: netDelta,
          theta: netTheta,
          iv: longLeg.iv,
          oi: Math.min(longLeg.oi, shortLeg.oi),
          vol: Math.min(longLeg.vol, shortLeg.vol),
          grade: longLeg.grade <= shortLeg.grade ? shortLeg.grade : longLeg.grade,
          breakeven: be,
          breakevenPct: bePct,
          maxRiskPerContract: Math.round(debit * 100),
          maxProfitPerContract: Math.round(maxProfit * 100),
          rr,
          estGain1Em: Math.round((maxProfit / debit) * 100),
          earningsBeforeExpiry,
          earningsDays,
        });
      }
    }
  }

  return setups.filter(Boolean);
}

// ── Horizon Expiration Picker (Short-Term / Swing / LEAPS) ───────────────────
function isThirdFriday(iso) {
  if (!iso || iso.length < 10) return false;
  const dt = new Date(`${iso}T12:00:00Z`);
  return dt.getUTCDay() === 5 && dt.getUTCDate() >= 15 && dt.getUTCDate() <= 21;
}

export function pickExpirationForHorizon(expirations, horizon = "swing") {
  if (!Array.isArray(expirations) || !expirations.length) return null;
  const pickClosest = (pool, target) =>
    [...pool].sort((a, b) => Math.abs(a.dte - target) - Math.abs(b.dte - target))[0] || null;

  if (horizon === "short") {
    const band = expirations.filter((e) => e.dte >= 5 && e.dte <= 21);
    return pickClosest(band.length ? band : expirations.filter((e) => e.dte >= 1), 12) || expirations[0];
  }
  if (horizon === "leaps") {
    const band = expirations.filter((e) => e.dte >= 120 && e.dte <= 400);
    const monthly = band.filter((e) => isThirdFriday(e.date));
    if (monthly.length) return pickClosest(monthly, 180);
    if (band.length) return pickClosest(band, 180);
    const fallback = expirations.filter((e) => e.dte >= 75);
    return pickClosest(fallback.length ? fallback : expirations, 180);
  }
  // Default: "swing" (24–70 DTE, strongly preferring monthly OPEX closest to 45 DTE)
  const band = expirations.filter((e) => e.dte >= 24 && e.dte <= 70);
  const monthly = band.filter((e) => isThirdFriday(e.date));
  if (monthly.length) return pickClosest(monthly, 45);
  if (band.length) return pickClosest(band, 45);
  const wider = expirations.filter((e) => e.dte >= 14 && e.dte <= 100);
  return pickClosest(wider.length ? wider : expirations, 45);
}

// ── Simplified Bullish / Bearish Playbook Recommender ────────────────────────
// Given a directional outlook ("bullish" | "bearish"), returns 3 plain-English
// trade choices (Primary Swing, Defined-Risk Spread, Aggressive) plus a clear
// ★ BEST FIT recommendation based on IV vs HV and upcoming earnings.
export function findDirectionalPlays(analysis, outlook = "bullish", { earningsDays = null } = {}) {
  if (!analysis || !(analysis.spot > 0)) return null;
  const isBull = outlook !== "bearish";
  const optType = isBull ? "call" : "put";
  const sideArr = isBull ? (analysis.calls || []) : (analysis.puts || []);
  if (!sideArr.length) return null;

  const { spot, dte, expDate, expectedMove, callWall, putWall, atmIv, ivHvRatio } = analysis;
  const emDollars = expectedMove?.dollars || (atmIv ? spot * atmIv * Math.sqrt(Math.max(dte, 7) / 365) : spot * 0.06);
  const targetSpot = isBull ? spot + emDollars : Math.max(0.5, spot - emDollars);
  const remT = Math.max(1, dte * 0.67) / 365;
  const earningsBeforeExpiry =
    earningsDays != null && Number.isFinite(earningsDays) && earningsDays >= 0 && earningsDays <= dte;

  const liquid = sideArr.filter(
    (c) => c.mid >= 0.1 && (c.oi >= 10 || c.vol >= 10) && (c.spreadPct == null || c.spreadPct <= 25)
  );
  const pool = liquid.length ? liquid : sideArr.filter((c) => c.mid >= 0.05);
  if (!pool.length) return null;

  const pickByAbsDelta = (minD, maxD, targetD, exclude = null) => {
    const inRange = pool.filter((c) => {
      const ad = Math.abs(c.delta);
      return ad >= minD && ad <= maxD && (!exclude || !exclude.has(c.strike));
    });
    if (!inRange.length) return null;
    return [...inRange].sort((a, b) => {
      const score = (c) => {
        const dErr = Math.abs(Math.abs(c.delta) - targetD) * 40;
        const sprPen = Math.min(25, c.spreadPct ?? 12) * 1.2;
        const liqBonus = Math.min(10, Math.log10(Math.max(1, c.oi + c.vol * 2)) * 2.5);
        return dErr + sprPen - liqBonus;
      };
      return score(a) - score(b);
    })[0];
  };

  const buildSingle = (id, title, whenToUse, accent, c) => {
    if (!c) return null;
    const projPrice = c.iv
      ? bsPrice(targetSpot, c.strike, remT, RISK_FREE_RATE, c.iv, optType)
      : (isBull ? Math.max(0, targetSpot - c.strike) : Math.max(0, c.strike - targetSpot));
    const estGain1Em = c.mid > 0 ? Math.round(((projPrice - c.mid) / c.mid) * 100) : null;
    return {
      id,
      kind: "single",
      type: optType,
      title,
      whenToUse,
      accent,
      sym: c.sym,
      strike: c.strike,
      expDate,
      dte,
      bid: c.bid,
      ask: c.ask,
      mid: c.mid,
      spreadPct: c.spreadPct,
      delta: c.delta,
      theta: c.theta,
      iv: c.iv,
      oi: c.oi,
      vol: c.vol,
      grade: c.grade,
      breakeven: c.breakeven,
      breakevenPct: c.breakevenPct,
      leverage: c.leverage,
      maxRisk: Math.round(c.mid * 100),
      estGain1Em,
      earningsBeforeExpiry,
      earningsDays,
    };
  };

  const used = new Set();
  const primaryLeg = pickByAbsDelta(0.52, 0.72, 0.62);
  if (primaryLeg) used.add(primaryLeg.strike);
  const primary = buildSingle(
    "primary",
    isBull ? "Swing Call" : "Swing Put",
    isBull
      ? "Cleanest trend ride — moves ~$0.60 per $1 rally with controlled time decay and uncapped upside."
      : "Cleanest downside ride — moves ~$0.60 per $1 drop with controlled time decay and full downside capture.",
    isBull ? "#34d399" : "#f87171",
    primaryLeg
  );

  // Defined-Risk Debit Spread (Bull Call Spread or Bear Put Spread)
  let spread = null;
  const longLeg = primaryLeg || pickByAbsDelta(0.50, 0.72, 0.60);
  if (longLeg) {
    const shortCandidates = pool.filter((c) => {
      const ad = Math.abs(c.delta);
      const validSide = isBull ? c.strike > longLeg.strike : c.strike < longLeg.strike;
      return validSide && ad >= 0.18 && ad <= 0.42;
    });
    const wallStrike = isBull ? callWall?.strike : putWall?.strike;
    const idealShort = isBull
      ? Math.max(longLeg.strike + 1, wallStrike && wallStrike > longLeg.strike ? Math.min(wallStrike, targetSpot * 1.04) : targetSpot)
      : Math.min(longLeg.strike - 1, wallStrike && wallStrike < longLeg.strike ? Math.max(wallStrike, targetSpot * 0.96) : targetSpot);
    const shortLeg = [...shortCandidates].sort(
      (a, b) => Math.abs(a.strike - idealShort) - Math.abs(b.strike - idealShort)
    )[0];

    if (shortLeg) {
      const width = Math.round(Math.abs(shortLeg.strike - longLeg.strike) * 100) / 100;
      const debit = Math.round((longLeg.mid - shortLeg.mid) * 100) / 100;
      if (width > 0 && debit > 0.05 && debit < width * 0.85) {
        const maxProfit = Math.round((width - debit) * 100) / 100;
        const rr = Math.round((maxProfit / debit) * 100) / 100;
        const be = isBull
          ? Math.round((longLeg.strike + debit) * 100) / 100
          : Math.round((longLeg.strike - debit) * 100) / 100;
        const bePct = spot > 0 ? Math.round(((be - spot) / spot) * 1000) / 10 : null;
        const costSavingsPct = longLeg.mid > 0 ? Math.round(((longLeg.mid - debit) / longLeg.mid) * 100) : null;
        const spr = Math.max(longLeg.spreadPct ?? 0, shortLeg.spreadPct ?? 0);
        spread = {
          id: "spread",
          kind: "spread",
          type: optType,
          title: isBull ? "Bull Call Spread" : "Bear Put Spread",
          whenToUse: isBull
            ? "Best when options are pricey or into earnings — cuts cost & IV crush by capping gains near resistance."
            : "Best when options are pricey or into earnings — cuts cost & IV crush by targeting support.",
          accent: "#c084fc",
          strike: longLeg.strike,
          shortStrike: shortLeg.strike,
          width,
          expDate,
          dte,
          mid: debit,
          spreadPct: spr,
          delta: Math.round((longLeg.delta - shortLeg.delta) * 1000) / 1000,
          theta: Math.round((longLeg.theta - shortLeg.theta) * 1000) / 1000,
          iv: longLeg.iv,
          oi: Math.min(longLeg.oi, shortLeg.oi),
          vol: Math.min(longLeg.vol, shortLeg.vol),
          grade: longLeg.grade <= shortLeg.grade ? shortLeg.grade : longLeg.grade,
          breakeven: be,
          breakevenPct: bePct,
          maxRisk: Math.round(debit * 100),
          maxProfit: Math.round(maxProfit * 100),
          rr,
          costSavingsPct,
          estGain1Em: Math.round((maxProfit / debit) * 100),
          earningsBeforeExpiry,
          earningsDays,
        };
      }
    }
  }

  const aggLeg = pickByAbsDelta(0.30, 0.54, 0.44, used);
  const aggressive = buildSingle(
    "aggressive",
    isBull ? "Aggressive Breakout Call" : "Aggressive Breakdown Put",
    isBull
      ? "Lower upfront cost (~0.42 Δ) for fast, explosive moves — loses value faster if the stock chops."
      : "Lower upfront cost (~-0.42 Δ) for sharp selloffs — loses value faster if the stock bounces.",
    "#38bdf8",
    aggLeg
  );

  const plays = [primary, spread, aggressive].filter(Boolean);
  if (!plays.length) return null;

  // Smart recommendation: when to pick outright vs spread
  const ivExpensive = ivHvRatio != null && ivHvRatio >= 1.25;
  const ivCheap = ivHvRatio != null && ivHvRatio <= 0.95;
  const ivRegime = ivCheap ? "cheap" : ivExpensive ? "expensive" : "fair";

  let bestId = primary ? "primary" : plays[0].id;
  let reason = "";
  const savingsTxt = spread?.costSavingsPct > 0 ? ` cuts your upfront cost by ${spread.costSavingsPct}% and` : "";
  const outrightName = isBull ? "Swing Call" : "Swing Put";
  const spreadName = isBull ? "Bull Call Spread" : "Bear Put Spread";

  if (earningsBeforeExpiry && spread) {
    bestId = "spread";
    reason = `Earnings in ${earningsDays}d fall before this expiration — the ${spreadName}${savingsTxt} shields you from post-earnings IV crush.`;
  } else if (ivExpensive && spread) {
    bestId = "spread";
    reason = `Options are priced expensive (IV is ${ivHvRatio.toFixed(2)}× recent volatility) — the ${spreadName}${savingsTxt} offsets high premium & IV drag.`;
  } else if (ivCheap && primary) {
    bestId = "primary";
    reason = `Options are priced cheap (IV is ${ivHvRatio.toFixed(2)}× recent volatility) with no earnings conflict — buy the ${outrightName} outright so upside isn't capped.`;
  } else if (primary) {
    bestId = "primary";
    reason = `Options are fairly priced with no earnings before expiry — the ${outrightName} gives the cleanest ${isBull ? "bullish" : "bearish"} exposure.`;
  }

  return {
    outlook: isBull ? "bullish" : "bearish",
    expDate,
    dte,
    ivRegime,
    ivHvRatio,
    atmIv,
    expectedMove,
    earningsBeforeExpiry,
    earningsDays,
    bestId,
    reason,
    plays: plays.map((p) => ({ ...p, recommended: p.id === bestId })),
  };
}

// ── Budget Position Sizing & Best-Contract-For-Budget Optimizer ──────────────
export function sizePlayForBudget(play, budget) {
  const b = Number(budget);
  if (!play || !(Number.isFinite(b) && b > 0) || !(play.maxRisk > 0)) return null;
  const qty = Math.floor(b / play.maxRisk);
  const totalCost = qty * play.maxRisk;
  const leftover = Math.max(0, Math.round(b - totalCost));
  const utilPct = Math.round((totalCost / b) * 100);
  const perContractGain = play.kind === "spread"
    ? (play.maxProfit ?? 0)
    : (play.estGain1Em != null ? Math.round(play.maxRisk * (play.estGain1Em / 100)) : 0);
  const estProfitDollars = qty > 0 ? qty * perContractGain : 0;
  return {
    qty,
    totalCost,
    leftover,
    utilPct,
    estProfitDollars,
    fits: qty >= 1,
  };
}

export function findBestForBudget(analysis, outlook = "bullish", budget = 0, { earningsDays = null } = {}) {
  const b = Number(budget);
  if (!analysis || !(analysis.spot > 0) || !(Number.isFinite(b) && b > 0)) return null;
  const isBull = outlook !== "bearish";
  const optType = isBull ? "call" : "put";
  const sideArr = isBull ? (analysis.calls || []) : (analysis.puts || []);
  if (!sideArr.length) return null;

  const { spot, dte, expDate, expectedMove, atmIv, ivHvRatio } = analysis;
  const emDollars = expectedMove?.dollars || (atmIv ? spot * atmIv * Math.sqrt(Math.max(dte, 7) / 365) : spot * 0.06);
  const targetSpot = isBull ? spot + emDollars : Math.max(0.5, spot - emDollars);
  const remT = Math.max(1, dte * 0.67) / 365;
  const earningsBeforeExpiry =
    earningsDays != null && Number.isFinite(earningsDays) && earningsDays >= 0 && earningsDays <= dte;
  const ivExpensive = ivHvRatio != null && ivHvRatio >= 1.25;
  const ivCheap = ivHvRatio != null && ivHvRatio <= 0.95;

  const liquid = sideArr.filter(
    (c) => c.mid >= 0.15 && (c.oi >= 10 || c.vol >= 10) && (c.spreadPct == null || c.spreadPct <= 20)
  );
  const pool = liquid.length ? liquid : sideArr.filter((c) => c.mid >= 0.1);
  if (!pool.length) return null;

  const gradeFactor = (g) => (g === "A" ? 1.0 : g === "B" ? 0.9 : g === "C" ? 0.75 : 0.55);
  const candidates = [];

  // 1. Evaluate all liquid single-leg contracts within 0.25..0.85 |Δ| that fit budget
  const singlePool = pool.filter((c) => {
    const ad = Math.abs(c.delta);
    return ad >= 0.25 && ad <= 0.85;
  });
  let minCost = Infinity;

  for (const c of singlePool) {
    const costPerContract = Math.round(c.mid * 100);
    if (costPerContract <= 0) continue;
    if (costPerContract < minCost) minCost = costPerContract;
    if (costPerContract > b) continue;

    const qty = Math.floor(b / costPerContract);
    const totalCost = qty * costPerContract;
    const leftover = Math.max(0, Math.round(b - totalCost));
    const util = totalCost / b;
    const projPrice = c.iv
      ? bsPrice(targetSpot, c.strike, remT, RISK_FREE_RATE, c.iv, optType)
      : (isBull ? Math.max(0, targetSpot - c.strike) : Math.max(0, c.strike - targetSpot));
    const gainPerSh = Math.max(0, projPrice - c.mid);
    const totalProjProfit = Math.round(qty * gainPerSh * 100);
    const totalProjRoiPct = totalCost > 0 ? Math.round((totalProjProfit / totalCost) * 100) : 0;

    // Probability/delta quality curve: peaks in 0.45..0.68 |Δ|, penalizes OTM lotto tickets
    const ad = Math.abs(c.delta);
    let deltaFit = 1.0;
    if (ad < 0.42) deltaFit = Math.max(0.45, 1 - (0.42 - ad) * 2.8);
    else if (ad > 0.72) deltaFit = Math.max(0.7, 1 - (ad - 0.72) * 1.4);

    const sprPenalty = 1 - Math.min(0.25, ((c.spreadPct ?? 6) / 100) * 1.2);
    const liqFactor = gradeFactor(c.grade) * sprPenalty;
    const utilFactor = 0.75 + 0.25 * util;
    const regimeFactor = (earningsBeforeExpiry || ivExpensive) ? 0.88 : ivCheap ? 1.12 : 1.0;
    const profitRatio = totalProjProfit / b;
    const score = profitRatio * deltaFit * liqFactor * utilFactor * regimeFactor;

    candidates.push({
      kind: "single",
      type: optType,
      title: isBull ? "Call" : "Put",
      sym: c.sym,
      strike: c.strike,
      shortStrike: null,
      expDate,
      dte,
      mid: c.mid,
      costPerContract,
      qty,
      totalCost,
      leftover,
      utilPct: Math.round(util * 100),
      totalProjProfit,
      totalProjRoiPct,
      maxProfitTotal: null,
      rr: null,
      delta: c.delta,
      theta: c.theta,
      iv: c.iv,
      breakeven: c.breakeven,
      breakevenPct: c.breakevenPct,
      spreadPct: c.spreadPct,
      grade: c.grade,
      oi: c.oi,
      vol: c.vol,
      score,
    });
  }

  // 2. Evaluate feasible debit spreads (long 0.45..0.72 |Δ|, short 0.18..0.42 |Δ|)
  const longLegs = pool.filter((c) => {
    const ad = Math.abs(c.delta);
    return ad >= 0.45 && ad <= 0.72;
  }).slice(0, 6);
  const shortLegs = pool.filter((c) => {
    const ad = Math.abs(c.delta);
    return ad >= 0.18 && ad <= 0.42;
  }).slice(0, 8);

  for (const lg of longLegs) {
    for (const sh of shortLegs) {
      const validSide = isBull ? sh.strike > lg.strike : sh.strike < lg.strike;
      if (!validSide) continue;
      const width = Math.round(Math.abs(sh.strike - lg.strike) * 100) / 100;
      const debit = Math.round((lg.mid - sh.mid) * 100) / 100;
      if (!(width > 0 && debit >= 0.2 && debit < width * 0.82)) continue;
      const costPerContract = Math.round(debit * 100);
      if (costPerContract < minCost) minCost = costPerContract;
      if (costPerContract > b) continue;

      const qty = Math.floor(b / costPerContract);
      const totalCost = qty * costPerContract;
      const leftover = Math.max(0, Math.round(b - totalCost));
      const util = totalCost / b;
      const maxProfitPerSh = Math.round((width - debit) * 100) / 100;
      const maxProfitTotal = Math.round(qty * maxProfitPerSh * 100);
      const rr = Math.round((maxProfitPerSh / debit) * 100) / 100;

      // Project spread value at ±1σ move (remT)
      const lgProj = lg.iv
        ? bsPrice(targetSpot, lg.strike, remT, RISK_FREE_RATE, lg.iv, optType)
        : (isBull ? Math.max(0, targetSpot - lg.strike) : Math.max(0, lg.strike - targetSpot));
      const shProj = sh.iv
        ? bsPrice(targetSpot, sh.strike, remT, RISK_FREE_RATE, sh.iv, optType)
        : (isBull ? Math.max(0, targetSpot - sh.strike) : Math.max(0, sh.strike - targetSpot));
      const spreadProj = Math.min(width, Math.max(0, lgProj - shProj));
      const totalProjProfit = Math.round(qty * Math.max(0, spreadProj - debit) * 100);
      const totalProjRoiPct = totalCost > 0 ? Math.round((totalProjProfit / totalCost) * 100) : 0;

      const worstGrade = lg.grade <= sh.grade ? sh.grade : lg.grade;
      const spr = Math.max(lg.spreadPct ?? 0, sh.spreadPct ?? 0);
      const sprPenalty = 1 - Math.min(0.25, (spr / 100) * 1.2);
      const liqFactor = gradeFactor(worstGrade) * sprPenalty;
      const utilFactor = 0.75 + 0.25 * util;
      const regimeFactor = (earningsBeforeExpiry || ivExpensive) ? 1.25 : ivCheap ? 0.92 : 1.02;
      const score = (totalProjProfit / b) * 0.96 * liqFactor * utilFactor * regimeFactor;

      const be = isBull
        ? Math.round((lg.strike + debit) * 100) / 100
        : Math.round((lg.strike - debit) * 100) / 100;

      candidates.push({
        kind: "spread",
        type: optType,
        title: isBull ? "Bull Call Spread" : "Bear Put Spread",
        sym: `${lg.sym}/${sh.sym}`,
        strike: lg.strike,
        shortStrike: sh.strike,
        width,
        expDate,
        dte,
        mid: debit,
        costPerContract,
        qty,
        totalCost,
        leftover,
        utilPct: Math.round(util * 100),
        totalProjProfit,
        totalProjRoiPct,
        maxProfitTotal,
        rr,
        delta: Math.round((lg.delta - sh.delta) * 1000) / 1000,
        theta: Math.round((lg.theta - sh.theta) * 1000) / 1000,
        iv: lg.iv,
        breakeven: be,
        breakevenPct: spot > 0 ? Math.round(((be - spot) / spot) * 1000) / 10 : null,
        spreadPct: spr,
        grade: worstGrade,
        oi: Math.min(lg.oi, sh.oi),
        vol: Math.min(lg.vol, sh.vol),
        score,
      });
    }
  }

  if (!candidates.length) {
    return {
      budget: b,
      best: null,
      alt: null,
      minRequired: Number.isFinite(minCost) ? minCost : null,
    };
  }

  candidates.sort((a, b2) => b2.score - a.score || b2.totalProjProfit - a.totalProjProfit);
  const best = candidates[0];
  const alt = candidates.find((c) => c.kind !== best.kind) || null;

  const moveTxt = isBull ? "+1σ rally" : "−1σ drop";
  const why =
    `Fits ${best.qty} contract${best.qty === 1 ? "" : "s"} ($${best.totalCost.toLocaleString()} of $${Math.round(b).toLocaleString()} · ${best.utilPct}% deployed), ` +
    `Grade ${best.grade} liquidity, est. +$${best.totalProjProfit.toLocaleString()} (+${best.totalProjRoiPct}%) on a ${moveTxt}` +
    (best.kind === "spread" && best.maxProfitTotal ? ` (max +$${best.maxProfitTotal.toLocaleString()} · ${best.rr.toFixed(1)}× R:R)` : "") +
    ".";

  return {
    budget: b,
    best: { ...best, why },
    alt,
    minRequired: Number.isFinite(minCost) ? minCost : null,
  };
}

// ── Unusual Options Activity / Flow Detector ─────────────────────────────────
export function detectUnusualFlow(analysis, { minVol = 50, minVolOi = 1.5, minNotional = 100_000, limit = 25 } = {}) {
  if (!analysis) return [];
  const all = [...(analysis.calls || []), ...(analysis.puts || [])];
  const hits = [];
  for (const c of all) {
    if (c.vol < minVol || c.mid <= 0.02) continue;
    const passesVolOi = c.volOi >= minVolOi;
    const passesBlock = c.notional >= minNotional;
    if (!passesVolOi && !passesBlock) continue;

    let tag = "UNUSUAL";
    if (c.volOi >= 3.0 && c.notional >= 75_000) {
      tag = c.type === "call" ? "CALL SWEEP" : "PUT SWEEP";
    } else if (c.notional >= 250_000) {
      tag = c.type === "call" ? "CALL BLOCK" : "PUT BLOCK";
    } else if (c.volOi >= 2.0) {
      tag = "HIGH V/OI";
    }

    const otmPct = analysis.spot > 0
      ? Math.round((((c.type === "call" ? c.strike - analysis.spot : analysis.spot - c.strike) / analysis.spot)) * 1000) / 10
      : null;

    hits.push({
      ticker: analysis.ticker,
      spot: analysis.spot,
      sym: c.sym,
      type: c.type,
      strike: c.strike,
      expDate: c.expDate || analysis.expDate,
      dte: c.dte ?? analysis.dte,
      mid: c.mid,
      bid: c.bid,
      ask: c.ask,
      spreadPct: c.spreadPct,
      vol: c.vol,
      oi: c.oi,
      volOi: c.volOi,
      notional: c.notional,
      iv: c.iv,
      delta: c.delta,
      itm: c.itm,
      otmPct,
      tag,
      pcVolRatio: analysis.pcVolRatio,
    });
  }
  hits.sort((a, b) => b.notional - a.notional || b.volOi - a.volOi);
  return hits.slice(0, limit);
}

// ── Multi-Ticker Batch Scan Aggregator (Swing Call Finder + Unusual Flow) ────
export function aggregateMultiTickerScan(items, stockMap = {}) {
  const swingRows = [];
  const flowRows = [];
  const tickerSummaries = [];

  for (const item of items || []) {
    if (!item?.ticker || !(item.spot > 0)) continue;
    const s = stockMap?.[item.ticker] || {};
    const adr20 = s.adr20 ?? s.adr_pct ?? null;
    const earningsDays = s.earnings_days ?? null;

    const nearAnalysis = item.selected
      ? analyzeOptionChain(item.selected, item.spot, { ticker: item.ticker, adr20, earningsDays })
      : null;
    const swingSource = item.swingChain || item.selected;
    const swingAnalysis = swingSource === item.selected
      ? nearAnalysis
      : analyzeOptionChain(swingSource, item.spot, { ticker: item.ticker, adr20, earningsDays });

    if (nearAnalysis) {
      const flow = detectUnusualFlow(nearAnalysis, { minVol: 100, minVolOi: 1.5, minNotional: 100_000, limit: 8 });
      flowRows.push(...flow);
      // Also check swing chain for unusual leaps/swing sweeps if distinct
      if (swingAnalysis && swingAnalysis !== nearAnalysis) {
        const sFlow = detectUnusualFlow(swingAnalysis, { minVol: 100, minVolOi: 1.5, minNotional: 150_000, limit: 5 });
        flowRows.push(...sFlow);
      }

      const totalPrem = nearAnalysis.totalCallPrem + nearAnalysis.totalPutPrem;
      const callShare = totalPrem > 0 ? Math.round((nearAnalysis.totalCallPrem / totalPrem) * 100) : null;
      const sentiment =
        callShare == null ? "NEUTRAL"
          : callShare >= 65 ? "BULLISH"
          : callShare <= 35 ? "BEARISH"
          : "MIXED";
      tickerSummaries.push({
        ticker: item.ticker,
        spot: item.spot,
        changePct: item.changePct,
        pcVolRatio: nearAnalysis.pcVolRatio,
        totalCallVol: nearAnalysis.totalCallVol,
        totalPutVol: nearAnalysis.totalPutVol,
        totalCallPrem: nearAnalysis.totalCallPrem,
        totalPutPrem: nearAnalysis.totalPutPrem,
        netFlowPrem: nearAnalysis.netFlowPrem,
        callShare,
        sentiment,
        atmIv: nearAnalysis.atmIv,
        ivHvRatio: nearAnalysis.ivHvRatio,
        expectedMovePct: nearAnalysis.expectedMove?.pct ?? null,
      });
    }

    if (swingAnalysis) {
      const setups = findSwingCallSetups(swingAnalysis, { earningsDays });
      const primary = setups.find((x) => x.kind === "single" && x.style === "Momentum Swing")
        || setups.find((x) => x.kind === "single");
      if (primary) {
        swingRows.push({
          ticker: item.ticker,
          company: s.company || item.name || "",
          spot: item.spot,
          changePct: item.changePct ?? s.change_pct ?? null,
          rs: s.rs_rank ?? null,
          adr: adr20,
          atmIv: swingAnalysis.atmIv,
          ivHvRatio: swingAnalysis.ivHvRatio,
          expectedMovePct: swingAnalysis.expectedMove?.pct ?? null,
          pcVolRatio: nearAnalysis?.pcVolRatio ?? swingAnalysis.pcVolRatio,
          setup: primary,
          spreadSetup: setups.find((x) => x.kind === "spread") || null,
        });
      }
    }
  }

  // Dedupe flow rows by contract symbol
  const seen = new Set();
  const dedupFlow = flowRows.filter((r) => {
    const k = r.sym || `${r.ticker}-${r.expDate}-${r.type}-${r.strike}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  dedupFlow.sort((a, b) => b.notional - a.notional || b.volOi - a.volOi);

  return { swingRows, flowRows: dedupFlow, tickerSummaries };
}
