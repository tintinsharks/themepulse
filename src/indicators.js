// ── RSI / MACD reversal signals for the wheel ──
//
// Pure functions over a daily close series: indicator math, signal-event
// detection, and a forward-return study that measures how each signal
// actually resolved on THIS ticker's own history.
//
// The study is the point. RSI(14) < 30 "means oversold" is folklore until
// it's checked against the instrument you trade — and any signal on a stock
// in a long uptrend will show positive forward returns simply because the
// stock went up. Every signal's forward return is therefore reported next to
// the unconditional baseline (same horizon, all days), and the honest readout
// is the EDGE over that baseline, not the raw number.

const r2 = (v) => Math.round(v * 100) / 100;

// ── Wilder RSI ──────────────────────────────────────────────────────────────
// Wilder smoothing (alpha = 1/period), the standard chart-package RSI.
// Returns an array aligned to closes; first `period` entries are null warmup.
export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

// ── EMA / MACD ──────────────────────────────────────────────────────────────
export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  // Seed with the SMA of the first `period` values — the common convention.
  let prev = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// MACD(12,26,9): line = EMA12 − EMA26, signal = EMA9 of the line,
// histogram = line − signal. All aligned to closes with null warmup.
export function macd(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const fastE = ema(closes, fast);
  const slowE = ema(closes, slow);
  const line = closes.map((_, i) =>
    fastE[i] != null && slowE[i] != null ? fastE[i] - slowE[i] : null
  );

  // The signal EMA runs over the line's non-null tail, then re-aligns.
  const start = line.findIndex((v) => v != null);
  const tail = line.slice(start);
  const sigTail = ema(tail, signalPeriod);
  const signal = new Array(closes.length).fill(null);
  for (let i = 0; i < sigTail.length; i++) {
    if (sigTail[i] != null) signal[start + i] = sigTail[i];
  }

  const hist = line.map((v, i) =>
    v != null && signal[i] != null ? v - signal[i] : null
  );
  return { line, signal, hist };
}

// ── Signal events ───────────────────────────────────────────────────────────
// Bullish reversal events (context for SELLING puts):
//   rsi-oversold-exit : RSI crosses back UP through 30 — the classic
//                       "oversold and turning" trigger, not merely being low.
//   macd-bull-cross   : MACD line crosses above its signal line.
// Bearish reversal events (context for BUYING puts):
//   rsi-overbought-exit : RSI crosses back DOWN through 70.
//   macd-bear-cross     : MACD line crosses below its signal line.
export const SIGNAL_DEFS = [
  { key: "rsi-oversold-exit",   dir: "bullish", label: "RSI crossed up through 30" },
  { key: "macd-bull-cross",     dir: "bullish", label: "MACD bullish cross" },
  { key: "rsi-overbought-exit", dir: "bearish", label: "RSI crossed down through 70" },
  { key: "macd-bear-cross",     dir: "bearish", label: "MACD bearish cross" },
];

export function detectSignals(closes, { rsiPeriod = 14, low = 30, high = 70 } = {}) {
  const r = rsi(closes, rsiPeriod);
  const m = macd(closes);
  const events = [];
  for (let i = 1; i < closes.length; i++) {
    if (r[i - 1] != null && r[i] != null) {
      if (r[i - 1] < low && r[i] >= low) events.push({ i, key: "rsi-oversold-exit" });
      if (r[i - 1] > high && r[i] <= high) events.push({ i, key: "rsi-overbought-exit" });
    }
    if (m.line[i - 1] != null && m.signal[i - 1] != null && m.line[i] != null && m.signal[i] != null) {
      const prevDiff = m.line[i - 1] - m.signal[i - 1];
      const diff = m.line[i] - m.signal[i];
      if (prevDiff <= 0 && diff > 0) events.push({ i, key: "macd-bull-cross" });
      if (prevDiff >= 0 && diff < 0) events.push({ i, key: "macd-bear-cross" });
    }
  }
  return { rsi: r, macd: m, events };
}

// ── Forward-return study ────────────────────────────────────────────────────
// For each signal type: forward return over `horizon` bars after every
// occurrence, versus the unconditional baseline over the same sample. The
// baseline subtraction is what separates "this signal worked" from "the
// stock went up while I watched it".
export function signalStudy(closes, horizons = [5, 10], opts = {}) {
  const { events } = detectSignals(closes, opts);

  const fwd = (i, h) =>
    i + h < closes.length ? ((closes[i + h] - closes[i]) / closes[i]) * 100 : null;

  const stats = (rets) => {
    const xs = rets.filter((v) => v != null).sort((a, b) => a - b);
    if (!xs.length) return null;
    return {
      n: xs.length,
      median: r2(xs[Math.floor(xs.length / 2)]),
      winPct: r2((xs.filter((v) => v > 0).length / xs.length) * 100),
    };
  };

  const out = { horizons, baseline: {}, signals: [] };
  for (const h of horizons) {
    out.baseline[h] = stats(closes.map((_, i) => fwd(i, h)));
  }
  for (const def of SIGNAL_DEFS) {
    const idxs = events.filter((e) => e.key === def.key).map((e) => e.i);
    const perH = {};
    for (const h of horizons) {
      const s = stats(idxs.map((i) => fwd(i, h)));
      perH[h] = s
        ? { ...s, edge: out.baseline[h] ? r2(s.median - out.baseline[h].median) : null }
        : null;
    }
    out.signals.push({ ...def, count: idxs.length, horizons: perH, lastIndex: idxs[idxs.length - 1] ?? null });
  }
  return out;
}

// ── Current state readout ───────────────────────────────────────────────────
// What the panel shows: where RSI and MACD are now, the most recent event of
// each direction, and how many bars ago it fired.
export function currentSignalState(closes, dates, opts = {}) {
  const { rsi: r, macd: m, events } = detectSignals(closes, opts);
  const i = closes.length - 1;
  const last = (dir) => {
    const keys = SIGNAL_DEFS.filter((d) => d.dir === dir).map((d) => d.key);
    const ev = [...events].reverse().find((e) => keys.includes(e.key));
    if (!ev) return null;
    const def = SIGNAL_DEFS.find((d) => d.key === ev.key);
    return { ...def, barsAgo: i - ev.i, date: dates?.[ev.i] ?? null };
  };
  return {
    rsi: r[i] != null ? r2(r[i]) : null,
    rsiPrev: r[i - 1] != null ? r2(r[i - 1]) : null,
    macdHist: m.hist[i] != null ? r2(m.hist[i]) : null,
    macdHistPrev: m.hist[i - 1] != null ? r2(m.hist[i - 1]) : null,
    macdAboveSignal: m.line[i] != null && m.signal[i] != null ? m.line[i] > m.signal[i] : null,
    lastBullish: last("bullish"),
    lastBearish: last("bearish"),
  };
}
