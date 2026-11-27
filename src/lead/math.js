// Pure ranking, classification, ZVR, tier, EPS, and RS math for Leaders / Scanner / Brief.
// Kept JSX- and DOM-free so it can be unit-tested directly under Node.

export const LEAD = 88;          // layer leadership threshold (backtest)
export const PEAK_LOOKBACK = 40; // sessions to look back for "was leading"
export const SPARK_N = 60;       // sessions in each sparkline

export const STATUS = {
  lead:  { label: "Leading",        hint: `Rank ≥ ${LEAD} and held ≥ 80 a week ago` },
  emerg: { label: "Emerging",       hint: "Rank ≥ 70, up 20+ pts in a month, rising in 6+ of the last 10 sessions — unproven: early rotation backtested negative" },
  weak:  { label: "Weakening",      hint: `Led (≥ ${LEAD}) within ${PEAK_LOOKBACK} sessions, now 60–87 and falling` },
  brk:   { label: "Breaking down",  hint: `Led (≥ ${LEAD}) within ${PEAK_LOOKBACK} sessions, now below 60` },
  lag:   { label: "Lagging",        hint: "Not leading and no recent leadership" },
};

// Rank stability: sessions of the last 20 the rank held >= 80. Separates a
// layer that has sat in the top tier for a month from one that spiked there.
export function rankHeld(hist, n = 20, lvl = 80) {
  const v = hist.filter((x) => x != null).slice(-n);
  return { held: v.filter((x) => x >= lvl).length, of: v.length };
}

// Rank trend from the daily history, so one noisy session can't make or
// break a status: slope = least-squares points/session over the last 5
// sessions; ups = sessions out of the last 10 the rank rose.
export function rankTrend(hist) {
  const v = hist.filter((x) => x != null);
  const t5 = v.slice(-5);
  let slope = null;
  if (t5.length >= 3) {
    const n = t5.length, mx = (n - 1) / 2, my = t5.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    t5.forEach((y, i) => { num += (i - mx) * (y - my); den += (i - mx) ** 2; });
    slope = num / den;
  }
  const t10 = v.slice(-11);
  let ups = 0;
  for (let i = 1; i < t10.length; i++) if (t10[i] > t10[i - 1]) ups++;
  return { slope, ups, of: Math.max(0, t10.length - 1) };
}

export function classify({ now, w1, m1 }, hist) {
  const recent = hist.slice(-PEAK_LOOKBACK).filter((x) => x != null);
  const peak = recent.length ? Math.max(...recent) : now;
  const tr = rankTrend(hist);
  if (now >= LEAD && (w1 ?? now) >= 80) return { st: "lead", peak };
  if (peak >= LEAD && now < 60) return { st: "brk", peak };
  if (peak >= LEAD && now < LEAD && now <= peak - 10) return { st: "weak", peak };
  // Emerging also needs a steady climb — rising in 6+ of the last 10 sessions
  // and still rising over the last 5 — not one jump off a single day.
  if (now >= 70 && now - (m1 ?? now) >= 20 && (tr.of < 6 || (tr.ups >= 6 && (tr.slope ?? 0) > 0))) return { st: "emerg", peak };
  if (now >= LEAD) return { st: "lead", peak };
  return { st: "lag", peak };
}

// Breadth + volume inside a layer, from its members' per-stock fields:
//   a50 — % above their 50-day · rs80 — % with RS ≥ 80 · nh — % closing at a
//   20-session high · udv — median up-day ÷ down-day volume (20 sessions) ·
//   dv — median 5-day ÷ 20-day dollar volume.
export function layerStats(tickers, stockMap) {
  const S = tickers.map((t) => stockMap[t]).filter(Boolean);
  if (!S.length) return null;
  const pct = (f) => Math.round((S.filter(f).length / S.length) * 100);
  const med = (k) => {
    const v = S.map((s) => s[k]).filter((x) => x != null && isFinite(x)).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  };
  return {
    n: S.length,
    a50: pct((s) => (s.sma50_pct ?? -1) > 0),
    rs80: pct((s) => (s.rs_rank ?? 0) >= 80),
    nh: pct((s) => s.nh20 === 1),
    udv: med("udv20"),
    dv: med("dvol_ratio_5_20"),
    rsMed: med("rs_rank"),
  };
}

// Daily price breadth & dollar-volume flow across a layer or theme's members.
// Uses live intraday quotes (px_live, vol_live, chg_live) when isLive is true,
// otherwise falls back to last-session EOD rel_volume × avg_dollar_vol_raw.
export function computeLayerDayFlow(tickers, stockMap, { isLive = false, volFrac = 1 } = {}) {
  const frac = Math.max(0.08, Math.min(1, Number.isFinite(volFrac) ? volFrac : 1));
  const chgs = [];
  let green = 0;
  let dv = 0;
  let upDv = 0;
  let dnDv = 0;
  let measuredDv = 0;
  let expectedDv = 0;
  for (const t of tickers || []) {
    const s = stockMap?.[t];
    if (!s) continue;
    const chg = isLive && s.chg_live != null && Number.isFinite(s.chg_live)
      ? s.chg_live
      : (s.change_pct != null && Number.isFinite(s.change_pct) ? s.change_pct : null);
    if (chg != null) {
      chgs.push(chg);
      if (chg > 0) green++;
    }
    const avgDv = s.avg_dollar_vol_raw > 0
      ? s.avg_dollar_vol_raw
      : (s.avg_volume_raw > 0 && s.close > 0 ? s.avg_volume_raw * s.close : 0);
    let dayDv = 0;
    let expDv = 0;
    if (isLive && s.px_live > 0 && s.vol_live > 0) {
      dayDv = s.px_live * s.vol_live;
      if (avgDv > 0) expDv = avgDv * frac;
    } else if (s.rel_volume > 0 && avgDv > 0) {
      dayDv = s.rel_volume * avgDv;
      expDv = avgDv;
    } else if (avgDv > 0) {
      dayDv = avgDv;
    }
    if (dayDv > 0) {
      dv += dayDv;
      if (chg != null) {
        if (chg > 0) upDv += dayDv;
        else if (chg < 0) dnDv += dayDv;
      }
    }
    if (dayDv > 0 && expDv > 0) {
      measuredDv += dayDv;
      expectedDv += expDv;
    }
  }
  chgs.sort((a, b) => a - b);
  const m = chgs.length >> 1;
  const today = chgs.length ? (chgs.length % 2 ? chgs[m] : (chgs[m - 1] + chgs[m]) / 2) : null;
  const netDv = dv > 0 ? upDv - dnDv : null;
  const rvol = expectedDv > 0 ? +(measuredDv / expectedDv).toFixed(2) : null;
  const netDir = dv > 0 && netDv != null ? netDv / dv : 0;
  const align = today == null || today === 0 ? 0.5 : (1 + Math.sign(today) * netDir) / 2;
  const thrust = today != null && rvol != null ? +(today * rvol * align).toFixed(1) : null;
  return {
    today,
    green,
    n: chgs.length,
    pctGreen: chgs.length ? Math.round((green / chgs.length) * 100) : null,
    dv: dv > 0 ? dv : null,
    netDv,
    rvol,
    thrust,
  };
}

export function fmtDollarVol(v, signed = false) {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = signed ? (v > 0 ? "+" : v < 0 ? "-" : "") : (v < 0 ? "-" : "");
  const a = Math.abs(v);
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(a >= 100e9 ? 0 : 1)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 100e6 ? 0 : 1)}M`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}K`;
  return `${sign}$${Math.round(a)}`;
}

// Stock-level daily thrust: Chg% × ZVR (volume-weighted directional move).
// Preserves sign so high-volume green breakouts rank highest and heavy-volume selloffs lowest.
export function stockThrust(chg, zvr) {
  if (typeof chg !== "number" || !Number.isFinite(chg)) return null;
  if (typeof zvr !== "number" || !Number.isFinite(zvr) || zvr <= 0) return null;
  return +(chg * zvr).toFixed(1);
}

const HEALTH_RE = /^(healthcare|health care|biotech|biotech leaders|biotechnology|oncology|specialty pharma|pharma majors|drug manufacturers|medical\b|diagnostics|genomics|glp-1|managed care|cro \+ services|telemedicine|providers \+ facilities|distribution \+ supplies)/i;

export function isHealthcareItem(item) {
  if (!item) return false;
  if (typeof item === "string") return HEALTH_RE.test(item.trim());
  const { theme, themeId, layer, sector, industry } = item;
  if (String(themeId || "").toLowerCase() === "health") return true;
  if (/^health\s?care$/i.test(String(theme || "").trim())) return true;
  if (/^health\s?care$/i.test(String(sector || "").trim())) return true;
  if (HEALTH_RE.test(String(layer || "").trim())) return true;
  if (HEALTH_RE.test(String(industry || "").trim())) return true;
  return false;
}

// Volume / participation confirmation for a layer, from layer_breadth.json
// (pipeline 10f). Counts and ratios only.
export function layerConfirm(lbRow) {
  if (!lbRow || !lbRow.acc) return null;
  const lastOf = (arr, back = 0) => {
    if (!arr) return null;
    let i = arr.length - 1;
    while (i >= 0 && arr[i] == null) i--;
    i -= back;
    return i >= 0 ? arr[i] : null;
  };
  const acc = lastOf(lbRow.acc), dist = lastOf(lbRow.dist), dvs = lastOf(lbRow.dvs);
  const l90 = lastOf(lbRow.l90), l90p = lastOf(lbRow.l90, 5);
  const lx = lastOf(lbRow.lx), lxT = lbRow.lx_t || [];
  const checks = {
    acc: acc != null && acc >= 3 && acc >= 2 * (dist ?? 0),
    money: dvs != null && dvs >= 1.15,
    leaders: l90 != null && l90p != null && l90 - l90p >= 2,
  };
  const passed = Object.keys(checks).filter((k) => checks[k]);
  return {
    acc, dist, dvs, lx, lxT, l90,
    l90d: l90 != null && l90p != null ? l90 - l90p : null,
    passed,
    distHeavy: dist != null && dist >= 3 && dist >= 2 * (acc ?? 0),
  };
}
export const CONF_LABEL = { acc: "accumulation days", money: "money flowing in", leaders: "new RS 90+ leaders" };

export function layerFlags(l) {
  const b = l.stats;
  if (!b || b.n < 3) return [];
  const f = [];
  const hd = l.held;
  if (hd?.of >= 15) {
    if (l.now >= 80 && hd.held <= 5) f.push(["spiky", `Only ${hd.held} of the last ${hd.of} sessions at 80+ — a fresh spike, not established`]);
  }
  const cf = l.conf;
  if (cf && cf.lx >= 2) f.push(["exiting", `${cf.lx} leaders cracked this week (were RS 90+, now below the 50-day or under RS 80): ${cf.lxT.join(", ")}`]);
  if (cf) {
    if ((l.st === "lead" || l.st === "weak") && cf.distHeavy)
      f.push(["distrib", `Distribution: ${cf.dist} heavy-volume down days vs ${cf.acc} accumulation days across members over 10 sessions`]);
    const rising = l.st === "emerg" || (l.st !== "lead" && (l.now - (l.m1 ?? l.now)) >= 10 && (l.trend?.slope ?? 0) > 0);
    if (rising) {
      if (cf.passed.length >= 2) f.push(["confirmed", `Rank rising with ${cf.passed.length} of 3 confirmations: ${cf.passed.map((k) => CONF_LABEL[k]).join(", ")}`]);
      else f.push(["unconfirmed", `Rank rising without volume/participation confirmation${cf.passed.length ? ` (only ${CONF_LABEL[cf.passed[0]]})` : ""}`]);
    }
  } else if ((l.st === "lead" || l.st === "weak") && b.udv != null && b.udv < 0.8) {
    f.push(["distrib", "Down-day volume outweighs up-day volume over 20 sessions"]);
  }
  return f;
}

export function ema(vals, n) {
  const k = 2 / (n + 1);
  const out = [];
  let e = null;
  vals.forEach((v, i) => {
    e = e == null ? v : v * k + e * (1 - k);
    out.push(i >= n - 1 ? e : null);
  });
  return out;
}

export function sma(vals, n) {
  const out = [];
  let s = 0;
  vals.forEach((v, i) => {
    s += v;
    if (i >= n) s -= vals[i - n];
    out.push(i >= n - 1 ? s / n : null);
  });
  return out;
}

// Append/patch today's bar from the live quote when the OHLC feed lags.
export function withLive(bars, q) {
  if (!bars?.length || !q?.price) return bars;
  const last = bars[bars.length - 1];
  const near = (a, b) => a && b && Math.abs(a - b) / b < 0.0005;
  if (near(last.close, q.previousClose) && !near(q.price, q.previousClose)) {
    return [...bars, {
      date: "live", open: q.open ?? q.price, high: q.dayHigh ?? q.price, low: q.dayLow ?? q.price,
      close: q.price, volume: q.volume ?? 0,
    }];
  }
  return bars;
}

export function indexStats(rawBars, q) {
  const bars = withLive(rawBars, q);
  if (!bars || bars.length < 210) return null;
  const c = bars.map((b) => b.close);
  const n = c.length, i = n - 1, px = c[i];
  const e21 = ema(c, 21), s50 = sma(c, 50), s200 = sma(c, 200);
  const pct = (a, b) => (a != null && b ? ((a - b) / b) * 100 : null);
  const yr = String(new Date().getFullYear());
  const prevYearIdx = bars.findIndex((b) => b.date !== "live" && String(b.date).startsWith(yr)) - 1;
  const hi52 = Math.max(...bars.slice(-252).map((b) => b.high));
  // Distribution days: down ≥ 0.2% on higher volume than the prior session,
  // within the last 25 sessions; one drops off once the index closes 5% above it.
  let dd = 0;
  for (let j = Math.max(1, n - 25); j < n; j++) {
    const ch = (c[j] - c[j - 1]) / c[j - 1];
    if (ch <= -0.002 && bars[j].volume > bars[j - 1].volume) {
      const later = Math.max(...c.slice(j + 1).concat([c[j]]));
      if (later < c[j] * 1.05) dd++;
    }
  }
  const s50Rising = s50[i] != null && s50[i - 10] != null && s50[i] > s50[i - 10];
  let trend, tone;
  if (px > e21[i] && e21[i] > s50[i] && s50[i] > s200[i]) { trend = "Uptrend"; tone = "green"; }
  else if (px > s50[i] && px > s200[i]) { trend = "Pullback"; tone = "yellow"; }
  else if (px > s200[i]) { trend = "Correction"; tone = "orange"; }
  else { trend = "Downtrend"; tone = "red"; }
  const spark = bars.slice(-63);
  return {
    px,
    day: q?.change ?? pct(c[i], c[i - 1]),
    w1: pct(px, c[i - 5]), m1: pct(px, c[i - 21]),
    ytd: prevYearIdx >= 0 ? pct(px, c[prevYearIdx]) : null,
    off: pct(px, hi52),
    v21: pct(px, e21[i]), v50: pct(px, s50[i]), v200: pct(px, s200[i]),
    s50Rising, trend, tone, dd,
    spark: { c: spark.map((b) => b.close), e21: e21.slice(-63), s50: s50.slice(-63) },
    asOf: bars[i].date === "live" ? "live" : bars[i].date,
  };
}

// Zanger Volume Ratio intraday U-profile
export const VOL_PROFILE = [[0, 0], [5, 0.04], [15, 0.08], [30, 0.13], [60, 0.21], [90, 0.27], [120, 0.33], [150, 0.38], [180, 0.43], [210, 0.48], [240, 0.53], [270, 0.59], [300, 0.66], [330, 0.74], [360, 0.84], [375, 0.91], [390, 1]];

export function sessionElapsedFrac(now = new Date()) {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const m = et.getHours() * 60 + et.getMinutes() - 570;
  if (et.getDay() === 0 || et.getDay() === 6 || m < 0 || m >= 390) return 1;
  for (let i = 1; i < VOL_PROFILE.length; i++) {
    const [m1, f1] = VOL_PROFILE[i - 1], [m2, f2] = VOL_PROFILE[i];
    if (m <= m2) return Math.max(0.02, f1 + (f2 - f1) * (m - m1) / (m2 - m1));
  }
  return 1;
}

export function etClock(now = new Date()) {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const mins = et.getHours() * 60 + et.getMinutes();
  const wkday = et.getDay() >= 1 && et.getDay() <= 5;
  const rth = wkday && mins >= 570 && mins < 960;
  const last = new Date(et);
  if (!(wkday && mins >= 570)) {
    do { last.setDate(last.getDate() - 1); } while (last.getDay() === 0 || last.getDay() === 6);
  }
  return { rth, today: ymd(et), session: ymd(last) };
}

export function scanBase(s, session) {
  if (!s?.ticker) return null;
  const c = s.close || s.price;
  if (!c) return null;
  const lvl = (pct) => (pct == null ? null : c / (1 + pct / 100));
  const sma50 = s.sma50_lvl ?? lvl(s.sma50_pct);
  const sma200 = s.sma200_lvl ?? lvl(s.sma200_pct);
  const ema50 = s.ema50_lvl ?? lvl(s.ema50_pct);
  const hi52 = s.hi52_lvl ?? lvl(s.off_52w_high);
  const lo52 = s.lo52_lvl ?? lvl(s.above_52w_low);
  const adr = s.adr20 ?? s.adr_pct;
  const rev = s.last_earnings_actual_revenue ?? (Array.isArray(s.quarters) ? s.quarters[0]?.revenue : null);
  if ((s.market_cap_raw ?? 0) <= 300e6) return null;
  if ((adr ?? 0) <= 2) return null;
  if ((s.avg_volume_raw ?? 0) < 500e3) return null;
  const adv = s.avg_dollar_vol_raw ?? ((s.avg_volume_raw ?? 0) * c);
  if (adv < 25e6) return null;
  if (!(sma50 && sma200 && sma50 > sma200)) return null;
  if (!(rev > 0)) return null;
  const avg10 = (s.last_bar_date && s.last_bar_date === session && s.avg_vol_10d_prior) || s.avg_vol_10d || s.avg_volume_raw;
  return {
    t: s.ticker,
    sma200,
    ema50,
    hi52,
    lo52,
    avgVol: s.avg_volume_raw,
    avg10,
    avgDv: adv,
    adr,
    rs: s.rs_rank,
    eps: s.eps_rating ?? null,
    epsTip: s.eps_tip,
    epsAcc: s.eps_accel,
    earningsDays: s.earnings_days ?? null,
    earningsDisplay: s.earnings_display || "",
  };
}

export function rthMinute(now = new Date()) {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const m = et.getHours() * 60 + et.getMinutes() + et.getSeconds() / 60 - 570;
  return et.getDay() >= 1 && et.getDay() <= 5 && m > 0 && m < 390 ? m : null;
}

export function expectedVolAt(p, m) {
  if (!Array.isArray(p) || p.length < 78 || m == null) return null;
  const t = m / 5, k = Math.floor(t);
  const v = k === 0 ? p[0] * t : p[k - 1] + (p[Math.min(k, 77)] - p[k - 1]) * (t - k);
  return v > 0 ? v : null;
}

export function zvrFor(s, q, profiles, now = new Date()) {
  const vol = q?.volume;
  if (!s || !vol) return null;
  const clock = etClock(now);
  const avg10 = (s.last_bar_date && s.last_bar_date === clock.session && s.avg_vol_10d_prior) || s.avg_vol_10d || s.avg_volume_raw;
  if (clock.rth) {
    const exp = expectedVolAt(profiles?.p?.[s.ticker], rthMinute(now));
    if (exp) return vol / exp;
    return avg10 ? vol / (avg10 * sessionElapsedFrac(now)) : null;
  }
  return avg10 ? vol / avg10 : null;
}

export const PIN_ADR = 0.8;
export function pinReason(s) {
  if (!s) return null;
  const a20 = s.adr20 ?? s.adr_pct, a5 = s.adr5, lt = s.adr_pct, off = s.off_52w_high;
  const lo = Math.min(a20 ?? Infinity, a5 ?? Infinity);
  if (lo < PIN_ADR) return `ADR ${lo.toFixed(2)}% — pinned / no range`;
  if (a5 != null && lt && off != null && a5 < 1.5 && off >= -2 && a5 < 0.5 * lt)
    return `5-day ADR ${a5.toFixed(2)}% vs ${lt.toFixed(1)}% normal at the high — likely deal-pinned`;
  return null;
}

export const RSL_OFF = [-15, -5];
export function rsLeads(s) {
  if (!s || s.rsl_hi_ago !== 0) return null;
  const off = s.off_52w_high ?? s.pct_from_high;
  if (off == null || off > RSL_OFF[1] || off < RSL_OFF[0]) return null;
  if (s.change_pct == null || s.change_pct < 0) return null;
  return `RS line at a new 52-week high on ${s.change_pct > 0 ? `a +${s.change_pct.toFixed(1)}%` : "an unchanged"} close while price is ${off.toFixed(1)}% off its high — RS leading price`;
}

// Elite Relative Strength: top 5% of market (RS >= 95), above 50d SMA,
// liquid ($20M+ avg $vol, price >= $5 when known), and not buyout-pinned.
export function isEliteRs(s, q = null) {
  if (!s) return false;
  if (pinReason(s)) return false;
  const c = q?.rthPrice ?? q?.price ?? s.close ?? s.price;
  if (c != null && Number.isFinite(c) && c < 5) return false;
  const av = s.avg_volume_raw || 0;
  const adv = s.avg_dollar_vol_raw || (c ? av * c : 0);
  if (adv < 20e6) return false;
  if ((s.rs_rank ?? 0) < 95) return false;
  const sma50 = s.sma50_lvl && c ? ((c / s.sma50_lvl) - 1) * 100 : s.sma50_pct;
  return sma50 != null ? sma50 > 0 : Boolean(s.above_50ma);
}

export function computeTiers(stockMap, tickerLayer) {
  const leaders = new Set(), eliteRs = new Set(), em = [];
  Object.values(stockMap || {}).forEach((s) => {
    if (!s?.ticker) return;
    if (isEliteRs(s)) eliteRs.add(s.ticker);
    if ((s.avg_dollar_vol_raw ?? 0) < 20e6 || !s.above_50ma) return;
    const rs = s.rs_rank ?? 0, off = s.off_52w_high ?? -100;
    if (rs >= 90 && off >= -25 && !pinReason(s)) { leaders.add(s.ticker); return; }
    const st = tickerLayer?.[s.ticker]?.st;
    if (rs >= 75 && (st === "lead" || st === "emerg") && (off >= -8 || s.rs_line_new_high || rsLeads(s))) em.push(s);
  });
  em.sort((a, b) => (b.rs_rank ?? 0) - (a.rs_rank ?? 0) || (b.off_52w_high ?? -100) - (a.off_52w_high ?? -100));
  return { leaders, emerging: new Set(em.slice(0, 40).map((s) => s.ticker)), eliteRs };
}

export const EPS_TIP = "O'Neil-style EPS Rating 1-99: last two quarters' year-over-year EPS growth + 3-year annual growth, ranked vs the universe. ▲ = growth accelerating 3 quarters running";
export const capG = (x) => Math.max(-100, Math.min(200, x));
export function epsGrowth(cur, prev, pct) {
  if (cur == null) return null;
  if (cur <= 0) return -100;
  if (prev != null) return prev <= 0 ? 100 : capG((cur / prev - 1) * 100);
  return pct == null ? null : capG(pct);
}
export function epsRaw(s) {
  const Q = (s.quarters || []).filter((q) => q.eps != null)
    .sort((a, b) => String(b.report_date || "").localeCompare(String(a.report_date || "")));
  const Y = (s.annual || []).filter((a) => a.eps != null).sort((a, b) => b.year - a.year);
  if (Q.length < 2 || Y.length < 2) return null;
  let q1 = epsGrowth(Q[0].eps, null, Q[0].eps_yoy), q2 = epsGrowth(Q[1].eps, null, Q[1].eps_yoy);
  if (q1 == null && q2 == null) return null;
  q1 = q1 ?? q2; q2 = q2 ?? q1;
  const yg = Y.slice(0, 3).map((a, i) => (Y[i + 1] ? epsGrowth(a.eps, Y[i + 1].eps) : null)).filter((x) => x != null).sort((a, b) => a - b);
  let a3;
  if (Y[0].eps <= 0) a3 = -100;
  else a3 = yg.length ? yg[Math.floor(yg.length / 2)] : -100;
  const down = Y.slice(0, 3).filter((a, i) => Y[i + 1] && a.eps < Y[i + 1].eps).length;
  a3 -= 10 * down;
  const q3 = Q[2] ? epsGrowth(Q[2].eps, null, Q[2].eps_yoy) : null;
  const accel = q3 != null && q1 >= 25 && q1 > q2 && q2 > q3;
  return { raw: 0.35 * q1 + 0.25 * q2 + 0.4 * a3, q1, q2, a3, down, accel };
}
export function withEpsRating(stockMap) {
  const rows = [];
  for (const [t, s] of Object.entries(stockMap || {})) {
    const r = s?.ticker ? epsRaw(s) : null;
    if (r) rows.push([t, r]);
  }
  const sorted = rows.map(([, r]) => r.raw).sort((a, b) => a - b), n = sorted.length;
  const out = { ...stockMap };
  const fmt = (v) => `${v > 0 ? "+" : ""}${Math.round(v)}%`;
  for (const [t, r] of rows) {
    let lo = 0, hi = n;
    while (lo < hi) { const m = (lo + hi) >> 1; sorted[m] < r.raw ? (lo = m + 1) : (hi = m); }
    let up = lo; while (up < n && sorted[up] === r.raw) up++;
    const rating = Math.max(1, Math.min(99, Math.round(((lo + up + 1) / 2) / n * 98 + 1)));
    out[t] = { ...stockMap[t], eps_rating: rating, eps_accel: r.accel,
      eps_tip: `EPS Rating ${rating} — last qtr ${fmt(r.q1)} · prior qtr ${fmt(r.q2)} · 3-yr median ${fmt(r.a3)}/yr${r.down ? ` (incl. −${10 * r.down} for ${r.down} down yr)` : ""}${r.accel ? " · accelerating" : ""}` };
  }
  return out;
}

export const RS_W = [["return_1m", 0.4], ["return_3m", 0.2], ["return_6m", 0.2], ["return_1y", 0.2]];
export function rsScore(s, f) {
  let sum = 0, w = 0;
  for (const [k, wt] of RS_W) {
    const r = s[k];
    if (r == null || !isFinite(r)) continue;
    sum += ((1 + r / 100) * f - 1) * 100 * wt; w += wt;
  }
  return w ? sum / w : null;
}

export function layerRanksFrom(keys, members, stockMap, field) {
  const raw = {};
  for (const k of keys) {
    const v = (members[k] || []).map((t) => stockMap[t]?.[field]).filter((x) => x != null && isFinite(x)).sort((a, b) => a - b);
    if (!v.length) continue;
    const m = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
    raw[k] = [m, v.length];
  }
  const ks = Object.keys(raw);
  if (!ks.length) return {};
  const ms = ks.map((k) => raw[k][0]).sort((a, b) => a - b);
  const med = ms.length % 2 ? ms[(ms.length - 1) / 2] : (ms[ms.length / 2 - 1] + ms[ms.length / 2]) / 2;
  const adj = ks.map((k) => [k, med + (raw[k][0] - med) * (raw[k][1] / (raw[k][1] + 3))]).sort((a, b) => a[1] - b[1]);
  const denom = adj.length - 1 || 1, out = {};
  adj.forEach(([k], i) => { out[k] = (i / denom) * 100; });
  return out;
}

/**
 * Intraday / daily closing range 0..100: where regular-session price sits inside
 * the regular-session low..high range.
 * - Never mixes extended-hours price with regular-session dayHigh/dayLow.
 * - Never mixes pipeline s.close with a live quote's dayHigh/dayLow.
 * - Falls back to pipeline cr_pct → prev_close_range (for ETFs like SPY/QQQ) → s H/L.
 */
export function closingRange(q, s) {
  if (q) {
    const isExtOnly = q.rthPrice == null && (q.ext_change != null || Boolean(q.ext_session));
    const px = isExtOnly ? null : (q.rthPrice ?? q.price ?? null);
    const hi = q.dayHigh ?? q.high ?? null;
    const lo = q.dayLow ?? q.low ?? null;
    if (px != null && hi != null && lo != null && Number.isFinite(px) && Number.isFinite(hi) && Number.isFinite(lo) && hi > lo) {
      return Math.max(0, Math.min(100, Math.round(((px - lo) / (hi - lo)) * 100)));
    }
  }
  if (s?.cr_pct != null && Number.isFinite(s.cr_pct)) {
    return Math.max(0, Math.min(100, Math.round(s.cr_pct)));
  }
  if (s?.prev_close_range != null && Number.isFinite(s.prev_close_range)) {
    return Math.max(0, Math.min(100, Math.round(s.prev_close_range)));
  }
  const spx = s?.price ?? s?.close ?? null;
  if (spx != null && s?.day_high != null && s?.day_low != null && s.day_high > s.day_low) {
    return Math.max(0, Math.min(100, Math.round(((spx - s.day_low) / (s.day_high - s.day_low)) * 100)));
  }
  return null;
}

/**
 * Score a liquid above-50d stock on Dan Zanger intraday volume mover, Stockbee
 * 4% / $ breakout, Qullamaggie breakout, and theme leadership criteria.
 * Shared by the live ZANGER tab and scripts/zanger-scan.mjs.
 */
export function scoreZangerCandidate({ s, q, layer, tier, profiles, now = new Date(), unfiltered = false }) {
  if (!s?.ticker) return null;
  if (pinReason(s)) return null;
  const adv = s.avg_dollar_vol_raw ?? 0;
  const inStrongLayer = Boolean(layer && (layer.st === "lead" || layer.st === "emerg"));
  const rs = s.rs_rank ?? 0;
  const inCoreBase =
    adv >= 20e6 &&
    Boolean(s.above_50ma) &&
    (Boolean(tier) || rs >= 70 || inStrongLayer);

  if (!unfiltered) {
    if (adv < 20e6) return null;
    if (!s.above_50ma) return null;
  }

  const px = q?.rthPrice ?? q?.price ?? s.price ?? s.close ?? null;
  if (px == null || !(px > 0)) return null;
  const chg = q?.change ?? s.change_pct ?? null;
  const volume = (typeof q?.volume === "number" && Number.isFinite(q.volume) && q.volume > 0)
    ? q.volume
    : (typeof s.volume === "number" && Number.isFinite(s.volume) && s.volume > 0 ? s.volume : null);
  const is9M = volume != null && volume >= 8_900_000;
  const cr = closingRange(q, s);
  const adr = s.adr20 ?? s.adr_pct ?? null;
  const hi52 = Math.max(s.hi52_lvl || 0, q?.yearHigh || 0) || null;
  const off52 = hi52 && px ? ((px / hi52) - 1) * 100 : (s.off_52w_high ?? s.pct_from_high ?? null);
  const eps = s.eps_rating ?? null;
  const sma50Lvl = s.sma50_lvl ?? (s.close > 0 && s.sma50_pct != null ? s.close / (1 + s.sma50_pct / 100) : null);
  const reclaim50 = !s.above_50ma && Boolean(sma50Lvl && px >= sma50Lvl);
  const below50 = sma50Lvl ? px < sma50Lvl : !s.above_50ma;

  let zvr = q ? zvrFor(s, q, profiles, now) : null;
  if (zvr == null && s.rel_volume > 0) zvr = s.rel_volume;

  const rsl = Boolean(rsLeads(s));
  const fromOpen = q?.open > 0 && px > 0 ? ((px / q.open) - 1) * 100 : null;
  const dollarMove =
    q?.price != null && q?.previousClose > 0
      ? q.price - q.previousClose
      : px != null && chg != null && chg > -99
      ? px - px / (1 + chg / 100)
      : null;

  // 1. Dan Zanger Breakout: heavy volume surge + strong thrust + closing near highs within 10% of 52wH
  const isZangerBO =
    (inStrongLayer || rs >= 90) &&
    zvr != null && zvr >= 2.0 &&
    chg != null && chg >= 3.0 &&
    (cr == null || cr >= 70) &&
    (off52 == null || off52 >= -10) &&
    rs >= 75;

  // 2. Stockbee 4% Breakout (Momentum Burst): up >= 4% on >= 1x volume with strong close
  const isStockbee4 =
    px >= 3 &&
    chg != null && chg >= 4.0 &&
    (zvr == null || zvr >= 1.0) &&
    (cr == null || cr >= 60) &&
    (unfiltered || rs >= 70);

  // 3. Stockbee $ Breakout: >= $0.90 dollar expansion (>= +1.5% to filter $500+ noise) on >= 1.2x vol
  const isStockbeeDollar =
    dollarMove != null && dollarMove >= 0.9 &&
    chg != null && chg >= 1.5 &&
    zvr != null && zvr >= 1.2 &&
    (cr == null || cr >= 60) &&
    (unfiltered || rs >= 75);

  // 4. Qullamaggie Breakout: prior momentum leader + high ADR / tight structure breaking out on volume
  const qmagPriorMom =
    (s.return_1m ?? 0) >= 15 ||
    (s.return_3m ?? 0) >= 30 ||
    (s.return_6m ?? 0) >= 50 ||
    (s.qmag_score ?? 0) >= 5;
  const qmagStructure =
    Boolean(s.ema_stack || s.consol_valid || s.two_day_tight || (s.qmag_score ?? 0) >= 5) ||
    ((s.ema20_pct == null || (s.ema20_pct >= 0 && s.ema20_pct <= 12)) && (off52 == null || off52 >= -15));
  const notExtended = s.dist_20dma_atrx == null || s.dist_20dma_atrx <= 3.5;
  const isQmagBO =
    rs >= 80 &&
    qmagPriorMom &&
    qmagStructure &&
    notExtended &&
    ((adr ?? 0) >= 3.5 || (s.qmag_score ?? 0) >= 5) &&
    chg != null && chg >= Math.max(2.0, (adr ?? 4) * 0.7) &&
    zvr != null && zvr >= 1.3 &&
    (cr == null || cr >= 65);

  const breakoutTypes = [];
  if (isZangerBO) breakoutTypes.push("ZANGER");
  if (isStockbee4) breakoutTypes.push("SB4%");
  if (isStockbeeDollar) breakoutTypes.push("SB$");
  if (isQmagBO) breakoutTypes.push("QMAG");

  const isBreakout = breakoutTypes.length > 0;

  // Broader intraday volume mover (Dan Zanger volume surge OR any of the 4 breakouts)
  const qualifiesVolSurge =
    zvr != null && zvr >= 1.5 &&
    chg != null && chg >= Math.min(1.5, (adr ?? 3) * 0.6) &&
    (cr == null || cr >= 60) &&
    (unfiltered || ((inStrongLayer || rs >= 90) && (off52 == null || off52 >= -20) && rs >= 75));

  const qualifiesZanger = isBreakout || qualifiesVolSurge;

  const zvrPts = Math.min(35, (Math.min(zvr ?? 0, 4.0) / 4.0) * 35);
  const rsPts = (rs / 100) * 25;
  const layerPts = layer?.st === "lead" ? 15 : layer?.st === "emerg" ? 9 : 0;
  const crPts = cr != null ? (cr / 100) * 10 : 5;
  const epsPts = eps != null ? (eps / 100) * 10 : 4;
  const proxPts = off52 != null ? Math.max(0, 5 + off52 * 0.25) : 2;
  const confluencePts = Math.min(6, Math.max(0, breakoutTypes.length - 1) * 3);
  const score = Math.round((zvrPts + rsPts + layerPts + crPts + epsPts + proxPts + confluencePts) * 10) / 10;

  return {
    ticker: s.ticker,
    company: s.company || "",
    theme: layer?.theme || s.sector || "—",
    themeId: layer?.themeId || null,
    layer: layer?.name || s.industry || "—",
    layerStatus: layer?.st || "lag",
    layerRank: layer?.now ?? null,
    layerFlags: layer?.flags || [],
    tier,
    price: px,
    chg,
    volume,
    is9M,
    dollarMove: dollarMove != null ? Math.round(dollarMove * 100) / 100 : null,
    fromOpen,
    zvr: zvr != null ? Math.round(zvr * 100) / 100 : null,
    cr,
    rs,
    eps,
    epsTip: s.eps_tip || "",
    epsAccel: Boolean(s.eps_accel),
    earningsDays: s.earnings_days ?? null,
    earningsDisplay: s.earnings_display || "",
    adr: adr != null ? Math.round(adr * 10) / 10 : null,
    off52: off52 != null ? Math.round(off52 * 10) / 10 : null,
    rsl,
    rslTip: rsLeads(s),
    breakoutTypes,
    isBreakout,
    qualifiesZanger,
    inCoreBase,
    reclaim50,
    below50,
    score,
    pipelineNews: (s._newsPipe || []).slice(0, 2),
  };
}

// Stan Weinstein Stage Analysis (1 = Basing, 2 = Advancing, 3 = Topping, 4 = Declining)
// Uses 200-day (~30-week) and 50-day (~10-week) MA position plus 200d slope (tt_mask bit 2).
export function classifyWeinsteinStage(s) {
  if (!s) return null;
  const s200 = s.sma200_pct;
  const s50 = s.sma50_pct;
  if (s200 == null || s50 == null || !Number.isFinite(s200) || !Number.isFinite(s50)) return null;
  const above200 = s200 > 0;
  const above50 = s50 > 0;
  const ma200Rising = Boolean((s.tt_mask || 0) & 4);
  const ma50Above200 = (s.sma50_lvl && s.sma200_lvl)
    ? s.sma50_lvl > s.sma200_lvl
    : Boolean((s.tt_mask || 0) & 8);

  if (above200 && above50 && (ma200Rising || ma50Above200)) return 2;
  if (!above200 && !ma50Above200 && s200 >= -3.5 && above50 && s.ma8w_rising) return 1;
  if (above200) return 3;
  return 4;
}

export function computeStageDistribution(stockMap) {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const list = Array.isArray(stockMap) ? stockMap : Object.values(stockMap || {});
  let total = 0;
  for (const s of list) {
    const st = classifyWeinsteinStage(s);
    if (st != null) {
      counts[st]++;
      total++;
    }
  }
  const pctOf = (n) => (total > 0 ? Math.round((n / total) * 100) : 0);
  return {
    total,
    stages: [
      { stage: 1, label: "Stage 1", hint: "Basing", count: counts[1], pct: pctOf(counts[1]) },
      { stage: 2, label: "Stage 2", hint: "Advancing", count: counts[2], pct: pctOf(counts[2]) },
      { stage: 3, label: "Stage 3", hint: "Topping", count: counts[3], pct: pctOf(counts[3]) },
      { stage: 4, label: "Stage 4", hint: "Declining", count: counts[4], pct: pctOf(counts[4]) },
    ],
  };
}

// Reconstruct daily Stage 1-4 % history from breadth.json's daily MA breadth
// ({ date, p20, p50, p200 }), anchoring the latest date to exact stock-level counts.
export function estimateStageHistory(breadthHistory, currentDist = null, currentDate = null) {
  const rows = [];
  for (const d of Array.isArray(breadthHistory) ? breadthHistory : []) {
    if (!d?.date || d.p200 == null || d.p50 == null) continue;
    const p200 = Math.max(0, Math.min(100, d.p200));
    const p50 = Math.max(0, Math.min(100, d.p50));
    const p20 = Math.max(0, Math.min(100, d.p20 ?? p50));
    const below200 = 100 - p200;
    const lo = Math.max(0, p200 + p50 - 100);
    const hi = Math.min(p200, p50);
    const s2 = Math.round(lo + (hi - lo) * 0.72);
    const s3 = Math.max(0, Math.round(p200 - s2));
    const above50Below200 = Math.max(0, p50 - s2);
    const s1 = Math.max(0, Math.min(Math.round(below200), Math.round(above50Below200 * 0.45 + Math.max(0, p20 - p50) * 0.15)));
    const s4 = Math.max(0, 100 - s1 - s2 - s3);
    rows.push({ date: d.date, s1, s2, s3, s4, exact: false });
  }

  if (currentDist?.total > 0 && Array.isArray(currentDist.stages) && currentDist.stages.length === 4) {
    const [st1, st2, st3, st4] = currentDist.stages;
    const exactRow = {
      date: currentDate || (rows.length ? rows[rows.length - 1].date : "Today"),
      s1: st1.pct,
      s2: st2.pct,
      s3: st3.pct,
      s4: st4.pct,
      counts: { 1: st1.count, 2: st2.count, 3: st3.count, 4: st4.count },
      exact: true,
    };
    if (rows.length && rows[rows.length - 1].date === exactRow.date) {
      rows[rows.length - 1] = exactRow;
    } else {
      rows.push(exactRow);
    }
  }
  return rows;
}

// Compute current price extension from 10 / 21 / 50 EMA in both % and ATR multiples.
export function computeEmaAtrExtensions(ohlcBars, livePrice = null, atr = null) {
  if (!Array.isArray(ohlcBars) || ohlcBars.length < 10) return null;
  const closes = ohlcBars.map((b) => b?.close).filter((v) => typeof v === "number" && Number.isFinite(v) && v > 0);
  if (closes.length < 10) return null;
  const px = typeof livePrice === "number" && Number.isFinite(livePrice) && livePrice > 0
    ? livePrice
    : closes[closes.length - 1];
  const validAtr = typeof atr === "number" && Number.isFinite(atr) && atr > 0 ? atr : null;

  const calc = (period) => {
    if (closes.length < period) return null;
    const series = ema(closes, period);
    const val = series[series.length - 1];
    if (val == null || !Number.isFinite(val) || val <= 0) return null;
    const pct = ((px - val) / val) * 100;
    const atrX = validAtr ? (px - val) / validAtr : null;
    return {
      ema: Math.round(val * 100) / 100,
      pct: Math.round(pct * 10) / 10,
      atrX: atrX != null ? Math.round(atrX * 10) / 10 : null,
    };
  };

  return {
    price: px,
    atr: validAtr,
    ema10: calc(10),
    ema21: calc(21),
    ema50: calc(50),
  };
}

// Fallback Weinstein Stage 1-4 classifier from raw daily OHLC bars (for tickers outside stockMap, e.g. SPY/QQQ).
export function classifyWeinsteinStageFromBars(ohlcBars, livePrice = null) {
  if (!Array.isArray(ohlcBars) || ohlcBars.length < 50) return null;
  const closes = ohlcBars.map((b) => b?.close).filter((v) => typeof v === "number" && Number.isFinite(v) && v > 0);
  if (closes.length < 50) return null;
  const px = typeof livePrice === "number" && Number.isFinite(livePrice) && livePrice > 0
    ? livePrice
    : closes[closes.length - 1];
  const s50 = sma(closes, 50);
  const s200 = closes.length >= 200 ? sma(closes, 200) : null;
  const last50 = s50[s50.length - 1];
  const last200 = s200 ? s200[s200.length - 1] : null;
  const prev200 = s200 && s200.length > 20 ? s200[s200.length - 21] : null;
  const sma50_pct = last50 ? ((px - last50) / last50) * 100 : null;
  const sma200_pct = last200 ? ((px - last200) / last200) * 100 : null;
  const tt_mask = (last200 && prev200 && last200 > prev200) ? (1 << 2) : 0;
  return classifyWeinsteinStage({ sma50_pct, sma200_pct, tt_mask });
}
