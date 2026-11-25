// Pure scan rules for ScannerPanel: 5 Elite Relative Strength scans + 9 classic momentum/Stockbee scans.
// Kept React/DOM-free so every filter rule can be unit-tested directly under Node.

import { pinReason, rsLeads } from "./math.js";

export const ELITE_RS_SCANS = [
  ["rs95", "RS 95+ Elite", "#fbbf24"],
  ["bluedot", "RS Blue Dot", "#38bdf8"],
  ["resil", "Correction Resilience", "#4ade80"],
  ["rsvol", "RS 90+ Inst Vol", "#c084fc"],
  ["grnred", "Green on Red Tape", "#f472b6"],
];

export const CLASSIC_SCANS = [
  ["m1w", "Momentum 1W"],
  ["m1m", "Momentum 1M"],
  ["m3m", "Momentum 3M"],
  ["m6m", "Momentum 6M"],
  ["strong", "Strongest Stock"],
  ["s20", "20% study"],
  ["antic", "Bullish Anticipation"],
  ["hot", "Hottest Stocks"],
  ["liquid", "Liquid Leaders"],
];

export const ALL_SCANS = [...ELITE_RS_SCANS, ...CLASSIC_SCANS];

export const SCAN_NOTES = {
  rs95: "Elite RS ≥ 95 (top 5% of market) · above 50d SMA · price ≥ $5 · avg $vol ≥ $20M · excludes buyout-pinned",
  bluedot: "RS Blue Dot (NH Before Price): RS ≥ 90 · RS line at new 52w high (≤5d ago) while price bases 2–15% off 52w high · above 50d SMA · avg $vol ≥ $20M",
  resil: "Correction Resilience: RS ≥ 90 · above rising 8-week MA & 20d EMA · within 10% of 52w high · avg $vol ≥ $20M",
  rsvol: "RS 90+ Institutional Footprint: RS ≥ 90 · within 12% of 52w high · above 50d SMA · ≥2 pocket pivots (30d), ZVR/RVol ≥ 1.5×, U/D vol ≥ 1.3× + PP, or Delayed-Entry PEG",
  grnred: "Green on Red Tape: RS ≥ 85 · flat/positive today (Chg ≥ 0%) on above-avg volume (ZVR/RVol ≥ 1.2×) · above 50d SMA · within 15% of 52w high — prime Inside Day / U&R watchlist",
  m1w: "Up 20%+ in a week · above 52w low ≥ 50% · avg vol ≥ 300K · <$10B: float ≤ 50M, 0–20% above SMA20 · $10B+: float ≤ 150M, 0–10% above SMA20",
  m1m: "Up 30%+ in a month · same base as 1W",
  m3m: "Up 70%+ in 3 months · ≥ 100% above the 52w low · ADR ≥ 3% · same base as 1W",
  m6m: "Up 100%+ in 6 months · ≥ 100% above the 52w low · ADR ≥ 3% · same base as 1W",
  strong: "≥ 70% above the 52w low · EPS & sales growth ≥ 25% · avg vol ≥ 500K · <$10B: float ≤ 50M, ADR ≥ 3% · $10B+: float ≤ 150M, ADR ≥ 2% · near SMA20, ≥ SMA50 −3%",
  s20: "Stockbee: up 20%+ in 5 sessions within the last 15 · still above the 50-day and within 25% of the high · price ≥ $3 · avg $vol ≥ $5M · Ago = sessions since the burst, Pullback = from the high since",
  antic: "Stockbee: quiet day (−1% to +1%) · TI65 (7d ÷ 65d avg close) ≥ 1.05 · above SMA20 & SMA50 · within 15% of the high · ADR ≥ 2.5% · price ≥ $5, avg $vol ≥ $10M",
  hot: "TradingView Hottest Stock: mkt cap > $25M · perf 1M > 30% · avg vol > 300K · vol > 100K · price > $1 · float < 75M · volatility 1W > 3% · perf 1W −10% to +10%",
  liquid: "Price > $10 · mkt cap ≥ $300M · avg vol ≥ 1M · avg $vol ≥ $100M · ADR > 3% · EPS growth this year > 20% or 5y sales growth > 15% · RS ≥ 70 · above the 50-day",
};

/**
 * Evaluate all 14 preset scans (5 Elite RS + 9 classic) for a single stock.
 * Accepts optional live quote `q` and precomputed `zvr` (falling back to s.rel_volume).
 */
export function evalScanHits(s, q = null, zvr = null) {
  if (!s) return null;
  const c = q?.rthPrice ?? q?.price ?? s.close ?? s.price;
  if (!c || !Number.isFinite(c)) return null;

  const mcap = s.market_cap_raw || 0;
  const av = s.avg_volume_raw || 0;
  const adv = s.avg_dollar_vol_raw || av * c;
  const adr = s.adr20 ?? s.adr_pct ?? 0;
  const fl = s.shares_float_raw ?? (mcap && s.close ? mcap / s.close : null);
  const sma20 = s.sma20_lvl ? ((c / s.sma20_lvl) - 1) * 100 : s.sma20_pct;
  const sma50 = s.sma50_lvl ? ((c / s.sma50_lvl) - 1) * 100 : s.sma50_pct;
  const ema20 = s.ema20_pct ?? sma20;
  const lo = s.above_52w_low ?? 0;
  const hi52 = Math.max(s.hi52_lvl || 0, q?.yearHigh || 0) || null;
  const off = hi52 ? ((c / hi52) - 1) * 100 : (s.off_52w_high ?? s.pct_from_high);
  const chg = q?.change ?? s.change_pct;
  const effVolRatio = zvr ?? (s.rel_volume > 0 ? s.rel_volume : null);
  const rs = s.rs_rank ?? 0;
  const pinned = Boolean(pinReason(s));
  const liquidRs = !pinned && c >= 5 && adv >= 20e6;
  const above50 = sma50 != null ? sma50 > 0 : Boolean(s.above_50ma);

  const out = {};

  // ── Elite RS Scans ──────────────────────────────────────────────────────
  // 1. Raw Elite RS >= 95
  if (liquidRs && rs >= 95 && above50) {
    out.rs95 = true;
  }

  // 2. RS Blue Dot (RS line new high before price while basing 2-15% off 52wH)
  const hasRsNh = Boolean(
    s.rs_line_new_high ||
    (s.rsl_hi_ago != null && s.rsl_hi_ago <= 5) ||
    rsLeads(s)
  );
  if (liquidRs && rs >= 90 && above50 && hasRsNh && off != null && off <= -2 && off >= -15) {
    out.bluedot = true;
  }

  // 3. Correction Resilience (RS >= 90, above rising 8w MA & 20d EMA, within 10% of 52wH)
  if (
    liquidRs &&
    rs >= 90 &&
    (s.pct_from_8w ?? -1) > 0 &&
    Boolean(s.ma8w_rising) &&
    (ema20 ?? -1) > 0 &&
    off != null &&
    off >= -10
  ) {
    out.resil = true;
  }

  // 4. RS 90+ Institutional Volume Footprint (pocket pivots, ZVR/RVol surge, U/D vol, or PEG/DE)
  const pp = s.pp_count_30d ?? 0;
  const udv = s.udv20 ?? 0;
  const hasInstVol =
    pp >= 2 ||
    (effVolRatio != null && effVolRatio >= 1.5) ||
    (udv >= 1.3 && pp >= 1) ||
    Boolean(s.de_ready);
  if (liquidRs && rs >= 90 && above50 && off != null && off >= -12 && hasInstVol) {
    out.rsvol = true;
  }

  // 5. Green on Red Tape (flat/green on above-avg volume, RS >= 85, above 50d, within 15% of 52wH)
  if (
    liquidRs &&
    rs >= 85 &&
    above50 &&
    off != null &&
    off >= -15 &&
    chg != null &&
    chg >= 0 &&
    effVolRatio != null &&
    effVolRatio >= 1.2
  ) {
    out.grnred = true;
  }

  // ── Classic Momentum / Stockbee Scans ───────────────────────────────────
  const big = mcap >= 10e9;
  const momBase = mcap >= 300e6 && av >= 300e3 && lo >= 50 && sma20 != null &&
    (big ? (fl == null || fl <= 150e6) && sma20 >= 0 && sma20 <= 10
         : (fl == null || fl <= 50e6) && sma20 >= 0 && sma20 <= 20);
  const tag = big ? "L" : "S";
  if (momBase && (s.return_1w ?? 0) >= 20) out.m1w = tag;
  if (momBase && (s.return_1m ?? 0) >= 30) out.m1m = tag;
  if (momBase && lo >= 100 && (s.return_3m ?? 0) >= 70 && adr >= 3) out.m3m = tag;
  if (momBase && lo >= 100 && (s.return_6m ?? 0) >= 100 && adr >= 3) out.m6m = tag;
  const eg = s.eps_yoy ?? s.eps_qq ?? -1, sg = s.sales_yoy ?? s.sales_qq ?? -1;
  if (mcap >= 300e6 && lo >= 70 && eg >= 25 && sg >= 25 && av >= 500e3 && (sma50 == null || sma50 >= -3) && sma20 != null) {
    if (!big && (fl == null || fl <= 50e6) && sma20 >= -2 && sma20 <= 18 && adr >= 3) out.strong = "S";
    else if (big && (fl == null || fl <= 150e6) && sma20 >= -2 && sma20 <= 12 && adr >= 2) out.strong = "L";
  }
  if (s.burst20_pct != null && c >= 3 && adv >= 5e6 && sma50 > 0 && off != null && off >= -25) out.s20 = true;
  if (chg != null && chg >= -1 && chg <= 1 && (s.ti65 ?? 0) >= 1.05 && sma20 > 0 && sma50 > 0 && adr >= 2.5 &&
      off != null && off >= -15 && c >= 5 && adv >= 10e6) out.antic = true;
  const vol = q?.volume;
  if (mcap > 25e6 && (s.return_1m ?? 0) > 30 && av > 300e3 && (vol == null || vol > 100e3) && c > 1 &&
      fl != null && fl < 75e6 && (s.adr5 ?? 0) > 3 && (s.return_1w ?? 99) >= -10 && (s.return_1w ?? 99) <= 10) out.hot = true;
  const epsY = s.eps_this_y ?? s.eps_past_5y;
  if (c > 10 && mcap >= 300e6 && av >= 1e6 && adv >= 100e6 && adr > 3 && rs >= 70 && sma50 > 0 &&
      ((epsY != null && epsY > 20) || (s.sales_past_5y != null && s.sales_past_5y > 15))) out.liquid = true;

  return out;
}
