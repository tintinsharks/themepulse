// Pure 30-Minute Pivot, Opening Range, and Floor Pivot / CPR analytics.
// Zero React/DOM dependencies — safe for browser, tests, and Node scripts.

const ET_PARTS_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function round2(v) {
  return typeof v === "number" && Number.isFinite(v)
    ? Math.round(v * 100) / 100
    : null;
}

/**
 * Convert unix timestamp (seconds) into America/New_York calendar/clock parts.
 * @param {number} unixSec
 * @returns {{ date: string, hhmm: string, hour: number, minute: number, label: string } | null}
 */
export function formatEtTime(unixSec) {
  if (typeof unixSec !== "number" || !Number.isFinite(unixSec)) return null;
  const d = new Date(unixSec * 1000);
  if (Number.isNaN(d.getTime())) return null;

  const parts = ET_PARTS_FMT.formatToParts(d);
  let year = "";
  let month = "";
  let day = "";
  let hourStr = "";
  let minStr = "";

  for (const p of parts) {
    if (p.type === "year") year = p.value;
    else if (p.type === "month") month = p.value;
    else if (p.type === "day") day = p.value;
    else if (p.type === "hour") hourStr = p.value;
    else if (p.type === "minute") minStr = p.value;
  }

  if (!year || !month || !day || !hourStr || !minStr) return null;

  const hour = Number(hourStr) % 24;
  const minute = Number(minStr);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");

  return {
    date: `${year}-${month}-${day}`,
    hhmm: `${hh}:${mm}`,
    hour,
    minute,
    label: `${hour}:${mm}`,
  };
}

/**
 * Standard EMA on bar.close, seeded by SMA of first `period` bars.
 * Returns an array of length `bars.length` with `null` before `period - 1`.
 * @param {Array<{ close: number }>} bars
 * @param {number} period
 * @returns {Array<number | null>}
 */
export function computeEmaSeries(bars, period) {
  if (!Array.isArray(bars) || bars.length === 0) return [];
  const out = new Array(bars.length).fill(null);
  if (!Number.isInteger(period) || period < 1 || bars.length < period) {
    return out;
  }

  let sum = 0;
  for (let i = 0; i < period; i++) {
    const c = bars[i]?.close;
    if (typeof c !== "number" || !Number.isFinite(c)) return out;
    sum += c;
  }

  let ema = sum / period;
  out[period - 1] = round2(ema);
  const k = 2 / (period + 1);

  for (let i = period; i < bars.length; i++) {
    const c = bars[i]?.close;
    if (typeof c !== "number" || !Number.isFinite(c)) {
      out[i] = null;
      continue;
    }
    ema = c * k + ema * (1 - k);
    out[i] = round2(ema);
  }

  return out;
}

/**
 * Compute Classic Floor Pivots + Central Pivot Range (CPR) from prior session H/L/C.
 * @param {number} high
 * @param {number} low
 * @param {number} close
 * @param {number} [currentPrice]
 */
export function computeFloorPivots(high, low, close, currentPrice) {
  if (
    typeof high !== "number" || !Number.isFinite(high) || high <= 0 ||
    typeof low !== "number" || !Number.isFinite(low) || low <= 0 ||
    typeof close !== "number" || !Number.isFinite(close) || close <= 0 ||
    high < low
  ) {
    return null;
  }

  const pRaw = (high + low + close) / 3;
  const bcRaw = (high + low) / 2;
  const tcRaw = (pRaw - bcRaw) + pRaw;
  const bcNum = Math.min(bcRaw, tcRaw);
  const tcNum = Math.max(bcRaw, tcRaw);
  const r1Num = 2 * pRaw - low;
  const s1Num = 2 * pRaw - high;
  const r2Num = pRaw + (high - low);
  const s2Num = pRaw - (high - low);

  const p = round2(pRaw);
  const bc = round2(bcNum);
  const tc = round2(tcNum);
  const r1 = round2(r1Num);
  const r2 = round2(r2Num);
  const s1 = round2(s1Num);
  const s2 = round2(s2Num);
  const cprWidthPct = pRaw > 0 ? round2(((tcNum - bcNum) / pRaw) * 100) : null;

  let bias = null;
  if (typeof currentPrice === "number" && Number.isFinite(currentPrice)) {
    if (currentPrice > tc) bias = "ABOVE_CPR";
    else if (currentPrice < bc) bias = "BELOW_CPR";
    else bias = "INSIDE_CPR";
  }

  return { p, bc, tc, r1, r2, s1, s2, cprWidthPct, bias };
}

/**
 * Compute 30-minute Opening Range (09:30 ET bar) for the most recent session in bars30m.
 * @param {Array<{ time: number, open: number, high: number, low: number, close: number }>} bars30m
 * @param {number} [livePrice]
 */
export function computeOpeningRange(bars30m, livePrice) {
  if (!Array.isArray(bars30m) || bars30m.length === 0) return null;

  const annotated = [];
  for (let idx = 0; idx < bars30m.length; idx++) {
    const bar = bars30m[idx];
    const et = formatEtTime(bar?.time);
    if (!et) continue;
    annotated.push({ idx, bar, et, mins: et.hour * 60 + et.minute });
  }
  if (annotated.length === 0) return null;

  // Most recent trading session date present in bars30m.
  let sessionDate = annotated[annotated.length - 1].et.date;
  for (const row of annotated) {
    if (row.et.date > sessionDate) sessionDate = row.et.date;
  }

  const sessionBars = annotated.filter((r) => r.et.date === sessionDate);
  // First RTH 30m bar: exact 09:30 ET, or earliest bar between 09:30 and 10:00 ET.
  let openRow = sessionBars.find((r) => r.et.hhmm === "09:30") || null;
  if (!openRow) {
    const windowBars = sessionBars
      .filter((r) => r.mins >= 9 * 60 + 30 && r.mins <= 10 * 60)
      .sort((a, b) => a.mins - b.mins);
    openRow = windowBars[0] || null;
  }
  if (!openRow) return null;

  const orh = round2(openRow.bar.high);
  const orl = round2(openRow.bar.low);
  if (orh == null || orl == null) return null;

  const mid = round2((orh + orl) / 2);
  const rangePct = orl > 0 ? round2(((orh - orl) / orl) * 100) : null;

  const laterBars = sessionBars.filter((r) => r.idx > openRow.idx).map((r) => r.bar);
  const lastSessionBar = sessionBars[sessionBars.length - 1].bar;
  const lastPrice =
    typeof livePrice === "number" && Number.isFinite(livePrice)
      ? livePrice
      : lastSessionBar.close;

  let status = "INSIDE";
  let label = "INSIDE OR";

  if (lastPrice > orh) {
    status = "ORH_BO";
    label = "ORH BO";
  } else if (lastPrice < orl) {
    status = "ORL_BD";
    label = "ORL BD";
  } else if (laterBars.some((b) => b.high > orh) && lastPrice <= orh) {
    status = "FAILED_HIGH";
    label = "FAILED HI";
  } else if (laterBars.some((b) => b.low < orl) && lastPrice >= orl) {
    status = "FAILED_LOW";
    label = "FAILED LO";
  }

  return {
    sessionDate,
    barIdx: openRow.idx,
    orh,
    orl,
    mid,
    rangePct,
    status,
    label,
  };
}

function emptyPivot() {
  return {
    state: "NONE",
    label: "NO SETUP",
    shortLabel: "NONE",
    tone: "muted",
    redCount: 0,
    nearEma: false,
    pivotBarIdx: null,
    pivotTime: null,
    triggerBarIdx: null,
    triggerTime: null,
    entry: null,
    stop: null,
    riskPct: null,
    target2R: null,
    target3R: null,
    rMultipleNow: null,
    barsSincePivot: null,
    distToEntryPct: null,
  };
}

function isRedBar(bars, idx) {
  const b = bars[idx];
  if (!b) return false;
  if (b.close < b.open) return true;
  if (b.close === b.open && idx > 0 && bars[idx - 1]) {
    return b.close < bars[idx - 1].close;
  }
  return false;
}

function isBarNearEma(bar, emaVal, tol = 0.006) {
  if (!bar || typeof emaVal !== "number" || !Number.isFinite(emaVal) || emaVal <= 0) {
    return false;
  }
  const upper = emaVal * (1 + tol);
  const lower = emaVal * (1 - tol);
  return (bar.low <= upper && bar.low >= lower) || (bar.low <= emaVal && bar.high >= emaVal);
}

function extractPriorSessionHlc(bars30m) {
  const byDate = new Map();
  for (const bar of bars30m) {
    const et = formatEtTime(bar?.time);
    if (!et) continue;
    let agg = byDate.get(et.date);
    if (!agg) {
      agg = { high: bar.high, low: bar.low, close: bar.close };
      byDate.set(et.date, agg);
    } else {
      if (bar.high > agg.high) agg.high = bar.high;
      if (bar.low < agg.low) agg.low = bar.low;
      agg.close = bar.close;
    }
  }
  const dates = Array.from(byDate.keys()).sort();
  if (dates.length < 2) return null;
  return byDate.get(dates[dates.length - 2]);
}

/**
 * Analyze 30-minute bars for momentum pullback pivots, opening range, and floor pivots.
 * @param {Array<{ time: number, open: number, high: number, low: number, close: number, volume?: number }>} bars30m
 * @param {{ livePrice?: number, priorDailyBar?: { high: number, low: number, close: number }, emaFast?: number, emaSlow?: number, maxWindowBars?: number }} [opts]
 */
export function analyze30mPivot(bars30m, opts = {}) {
  if (!Array.isArray(bars30m) || bars30m.length === 0) {
    return {
      ok: false,
      lastPrice: null,
      ema10: [],
      ema20: [],
      trendUp: false,
      pivot: emptyPivot(),
      openingRange: null,
      floorPivots: null,
      summary: "No 30m bars available.",
    };
  }

  const {
    livePrice,
    priorDailyBar,
    emaFast = 10,
    emaSlow = 20,
    maxWindowBars = 5,
    maxTriggeredLookback = 18,
  } = opts;

  const lastIdx = bars30m.length - 1;
  const lastBar = bars30m[lastIdx];
  const lastPrice =
    typeof livePrice === "number" && Number.isFinite(livePrice)
      ? round2(livePrice)
      : round2(lastBar.close);

  const ema10 = computeEmaSeries(bars30m, emaFast);
  const ema20 = computeEmaSeries(bars30m, emaSlow);

  const latestEma10 = ema10[lastIdx];
  const latestEma20 = ema20[lastIdx];
  let trendUp = false;
  if (latestEma20 != null) {
    trendUp =
      lastBar.close >= latestEma20 ||
      (latestEma10 != null && latestEma10 >= latestEma20);
  } else if (latestEma10 != null) {
    trendUp = lastBar.close >= latestEma10;
  }

  const priorHlc =
    priorDailyBar &&
    typeof priorDailyBar.high === "number" &&
    typeof priorDailyBar.low === "number" &&
    typeof priorDailyBar.close === "number"
      ? priorDailyBar
      : extractPriorSessionHlc(bars30m);

  const floorPivots = priorHlc
    ? computeFloorPivots(priorHlc.high, priorHlc.low, priorHlc.close, lastPrice)
    : null;

  const openingRange = computeOpeningRange(bars30m, livePrice);

  let pivot = null;
  const minScanIdx = Math.max(0, lastIdx - Math.max(maxWindowBars + 2, maxTriggeredLookback));

  // Scan backward for the most recent valid 30m pullback pivot (@1ChartMaster style):
  // The pivot candle is the LAST RED BAR of a red pullback sequence (≥2 red bars, or ≥1 red bar near 10/20 EMA).
  // Entry triggers on a break above that pivot bar's HIGH; initial stop sits below its LOW.
  // Untriggered ARMED setups expire after maxWindowBars; active TRIGGERED trades stay tracked across the session.
  for (let i = lastIdx; i >= minScanIdx; i--) {
    if (!isRedBar(bars30m, i)) continue;
    // Only evaluate the terminal (last) red bar of a consecutive red sequence.
    if (i < lastIdx && isRedBar(bars30m, i + 1)) continue;

    let redCount = 0;
    for (let k = i; k >= 0; k--) {
      if (isRedBar(bars30m, k)) redCount++;
      else break;
    }
    if (redCount === 0) continue;

    const pbStart = i - redCount + 1;
    let nearEma = false;
    for (let k = pbStart; k <= i; k++) {
      if (
        isBarNearEma(bars30m[k], ema10[k]) ||
        isBarNearEma(bars30m[k], ema20[k]) ||
        isBarNearEma(bars30m[k], ema10[i]) ||
        isBarNearEma(bars30m[k], ema20[i])
      ) {
        nearEma = true;
        break;
      }
    }

    if (!(redCount >= 2 || (redCount >= 1 && nearEma))) continue;

    const entry = round2(bars30m[i].high);
    let stop = round2(bars30m[i].low);
    if (entry != null && (stop == null || entry - stop <= 0)) {
      let minLow = Infinity;
      for (let k = pbStart; k <= i; k++) {
        if (bars30m[k].low < minLow) minLow = bars30m[k].low;
      }
      stop = round2(minLow);
    }
    if (entry == null || stop == null || entry - stop <= 0) continue;

    const risk = entry - stop;
    const riskPct = round2((risk / entry) * 100);
    const target2R = round2(entry + 2 * risk);
    const target3R = round2(entry + 3 * risk);
    const barsSincePivot = lastIdx - i;
    const distToEntryPct =
      entry != null && lastPrice != null && lastPrice > 0
        ? round2(((entry - lastPrice) / lastPrice) * 100)
        : null;

    const laterBars = bars30m.slice(i + 1);
    const brokeStop =
      laterBars.some((b) => b.low < stop) || (lastPrice != null && lastPrice < stop);
    const firstTriggerRel = laterBars.findIndex((b) => b.high > entry);
    const brokeEntry =
      (lastPrice != null && lastPrice > entry) || firstTriggerRel >= 0;

    let state = null;
    let shortLabel = null;
    let label = null;
    let tone = null;
    let rMultipleNow = null;
    let triggerBarIdx = null;
    let triggerTime = null;

    if (i === lastIdx) {
      // Active pullback ending on the current bar
      if (lastPrice != null && lastPrice > entry) {
        state = "TRIGGERED";
        shortLabel = "TRIGGERED";
        label = "TRIGGERED";
        tone = "green";
        rMultipleNow = round2((lastPrice - entry) / risk);
        triggerBarIdx = lastIdx;
        triggerTime = bars30m[lastIdx]?.time ?? null;
      } else if (lastPrice != null && lastPrice < stop) {
        state = "PULLBACK";
        shortLabel = "PULLBACK";
        label = `PULLBACK (${redCount} red)`;
        tone = "cyan";
      } else if (riskPct <= 2.5 || (distToEntryPct != null && distToEntryPct <= 1.2)) {
        state = "ARMED";
        shortLabel = "ARMED";
        label = `BUY > $${entry.toFixed(2)}`;
        tone = "amber";
      } else {
        state = "PULLBACK";
        shortLabel = "PULLBACK";
        label = `PULLBACK (${redCount} red)`;
        tone = "cyan";
      }
    } else if (brokeStop) {
      if (barsSincePivot <= maxWindowBars) {
        state = "STOPPED";
        shortLabel = "STOPPED";
        label = "STOPPED";
        tone = "red";
      } else {
        continue;
      }
    } else if (brokeEntry) {
      state = "TRIGGERED";
      shortLabel = "TRIGGERED";
      label = "TRIGGERED";
      tone = "green";
      rMultipleNow = lastPrice != null ? round2((lastPrice - entry) / risk) : null;
      triggerBarIdx = firstTriggerRel >= 0 ? i + 1 + firstTriggerRel : lastIdx;
      triggerTime = bars30m[triggerBarIdx]?.time ?? null;
    } else if (barsSincePivot <= maxWindowBars) {
      state = "ARMED";
      shortLabel = "ARMED";
      label = `BUY > $${entry.toFixed(2)}`;
      tone = "amber";
    } else {
      // Stale pivot that never triggered within maxWindowBars
      continue;
    }

    pivot = {
      state,
      label,
      shortLabel,
      tone,
      redCount,
      nearEma,
      pivotBarIdx: i,
      pivotTime: bars30m[i].time ?? null,
      triggerBarIdx,
      triggerTime,
      entry,
      stop,
      riskPct,
      target2R,
      target3R,
      rMultipleNow,
      barsSincePivot,
      distToEntryPct,
    };
    break;
  }

  if (!pivot) {
    pivot = emptyPivot();
  }

  let summary = "No active 30m pullback pivot.";
  if (pivot.state === "TRIGGERED") {
    const rTxt =
      pivot.rMultipleNow != null
        ? `${pivot.rMultipleNow >= 0 ? "+" : ""}${pivot.rMultipleNow.toFixed(2)}R, `
        : "";
    summary = `30m pivot triggered above $${pivot.entry.toFixed(2)} (${rTxt}stop $${pivot.stop.toFixed(2)}).`;
  } else if (pivot.state === "ARMED") {
    summary = `30m pivot armed after ${pivot.redCount} red bar${pivot.redCount === 1 ? "" : "s"} — buy > $${pivot.entry.toFixed(2)}, stop $${pivot.stop.toFixed(2)} (-${pivot.riskPct.toFixed(1)}%), +2R $${pivot.target2R.toFixed(2)}.`;
  } else if (pivot.state === "PULLBACK") {
    const emaNote = pivot.nearEma ? " near EMA" : "";
    const trigNote = pivot.entry != null ? ` — watch reversal above $${pivot.entry.toFixed(2)}` : "";
    summary = `Active ${pivot.redCount}-bar 30m pullback${emaNote}${trigNote}.`;
  } else if (pivot.state === "STOPPED") {
    summary = `Recent 30m pivot stopped below $${pivot.stop.toFixed(2)}.`;
  } else if (openingRange?.status === "ORH_BO") {
    summary = `Opening range breakout above $${openingRange.orh.toFixed(2)}; no active pullback pivot.`;
  }

  return {
    ok: true,
    lastPrice,
    ema10,
    ema20,
    trendUp,
    pivot,
    openingRange,
    floorPivots,
    summary,
  };
}

/**
 * Rank a 30m setup for the Scanner table.
 * @param {ReturnType<typeof analyze30mPivot>} analysis
 * @param {{ rs_rank?: number, rs?: number }} [stock]
 * @returns {{ score: number, badge: string, tone: string, actionable: boolean }}
 */
export function score30mSetup(analysis, stock = {}) {
  const rsRaw =
    typeof stock?.rs_rank === "number" && Number.isFinite(stock.rs_rank)
      ? stock.rs_rank
      : typeof stock?.rs === "number" && Number.isFinite(stock.rs)
        ? stock.rs
        : 0;
  const rs = Math.max(0, Math.min(100, rsRaw));
  const rsBonus = rs / 10;

  if (!analysis || !analysis.ok) {
    return {
      score: round2(10 + rsBonus),
      badge: "WATCH",
      tone: "muted",
      actionable: false,
    };
  }

  const p = analysis.pivot;
  const orStatus = analysis.openingRange?.status;

  if (p?.state === "TRIGGERED") {
    const r = p.rMultipleNow;
    if (r != null && r >= 0 && r <= 2.5) {
      return {
        score: round2(90 + rsBonus),
        badge: "TRIGGERED",
        tone: "green",
        actionable: true,
      };
    }
    if (r != null && r < 0) {
      return {
        score: round2(76 + rsBonus * 0.4),
        badge: "TRIGGERED",
        tone: "green",
        actionable: true,
      };
    }
    return {
      score: round2(62 + rsBonus * 0.5),
      badge: "TRIGGERED",
      tone: "green",
      actionable: true,
    };
  }

  if (p?.state === "ARMED") {
    const withinRange = p.distToEntryPct != null && p.distToEntryPct <= 2.5;
    if (withinRange) {
      return {
        score: round2(80 + rsBonus * 0.8),
        badge: "ARMED",
        tone: "amber",
        actionable: true,
      };
    }
    return {
      score: round2(64 + rsBonus * 0.5),
      badge: "ARMED",
      tone: "amber",
      actionable: true,
    };
  }

  if (orStatus === "ORH_BO") {
    return {
      score: round2(70 + rsBonus * 0.7),
      badge: "ORH BO",
      tone: "green",
      actionable: true,
    };
  }

  if (p?.state === "PULLBACK") {
    return {
      score: round2(55 + rsBonus * 0.6),
      badge: "PULLBACK",
      tone: "cyan",
      actionable: true,
    };
  }

  return {
    score: round2(10 + rsBonus),
    badge: "WATCH",
    tone: "muted",
    actionable: false,
  };
}
