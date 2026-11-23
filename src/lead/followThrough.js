// Pure Breakout Follow-Through / Squat Tracker calculation engine.
// Kept JSX- and DOM-free so it can be unit-tested directly under Node.

import { closingRange } from "./math.js";

const PHASE_ORDER = {
  premarket: 0,
  open: 1,
  midday: 2,
  afternoon: 3,
  power: 4,
  close: 5,
  eod: 6,
};

const isFiniteNum = (v) => typeof v === "number" && Number.isFinite(v);

function extractDate(obj) {
  if (!obj) return null;
  const direct = obj.date || obj.stamp?.date || obj.clock?.session || obj.clock?.today || obj.pipelineDate;
  if (typeof direct === "string" && /^\d{4}-\d{2}-\d{2}$/.test(direct.trim())) {
    return direct.trim();
  }
  const fromStr = String(obj.et || obj.stamp?.pretty || obj.id || obj.file || "");
  const m = fromStr.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function extractPhaseId(obj) {
  if (!obj) return "";
  if (typeof obj.phase === "string") return obj.phase.toLowerCase();
  if (typeof obj.phase?.id === "string") return obj.phase.id.toLowerCase();
  return "";
}

function extractTimeMinutes(obj) {
  if (!obj) return -1;
  if (isFiniteNum(obj.stamp?.hours) && isFiniteNum(obj.stamp?.minutes)) {
    return obj.stamp.hours * 60 + obj.stamp.minutes;
  }
  const hhmm = String(obj.stamp?.hhmm || "");
  if (/^\d{4}$/.test(hhmm)) {
    return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2, 4));
  }
  const etStr = String(obj.et || obj.stamp?.pretty || "");
  const hm = etStr.match(/\b(\d{1,2}):(\d{2})\b/);
  if (hm) {
    return Number(hm[1]) * 60 + Number(hm[2]);
  }
  const idStr = String(obj.id || obj.file || "");
  const idHm = idStr.match(/-(\d{2})(\d{2})(?:\.json)?$/i);
  if (idHm) {
    return Number(idHm[1]) * 60 + Number(idHm[2]);
  }
  const ph = extractPhaseId(obj);
  if (ph in PHASE_ORDER) return PHASE_ORDER[ph];
  return -1;
}

function compareWithinDay(a, b) {
  const ta = extractTimeMinutes(a);
  const tb = extractTimeMinutes(b);
  if (ta !== tb) return ta - tb;
  const ga = Date.parse(a?.generatedAt || "");
  const gb = Date.parse(b?.generatedAt || "");
  if (Number.isFinite(ga) && Number.isFinite(gb) && ga !== gb) return ga - gb;
  return String(a?.id || a?.file || "").localeCompare(String(b?.id || b?.file || ""));
}

/**
 * Group zanger-index entries by date and pick, for each of the most recent
 * `maxDays` distinct dates, both:
 *  - `earliest`: first intraday/open scan of that day with breakouts
 *    (skipping `premarket` if later scans exist; falling back to the earliest
 *    scan in the day's eligible pool if none report breakouts)
 *  - `latest`: last scan of that day
 * Returns a deduplicated array of unique snapshot filenames to fetch (<= 2 * maxDays).
 */
export function selectDailySnapshots(indexList, maxDays = 5) {
  if (!Array.isArray(indexList) || !indexList.length || maxDays <= 0) return [];

  const byDate = new Map();
  for (const entry of indexList) {
    if (!entry || typeof entry.file !== "string" || !entry.file.trim()) continue;
    const date = extractDate(entry);
    if (!date) continue;
    let bucket = byDate.get(date);
    if (!bucket) {
      bucket = [];
      byDate.set(date, bucket);
    }
    bucket.push(entry);
  }

  const recentDates = [...byDate.keys()]
    .sort((a, b) => b.localeCompare(a))
    .slice(0, maxDays)
    .reverse(); // chronological oldest -> newest

  const seen = new Set();
  const files = [];
  const addFile = (entry) => {
    const f = entry?.file?.trim();
    if (f && !seen.has(f)) {
      seen.add(f);
      files.push(f);
    }
  };

  for (const date of recentDates) {
    const sorted = [...byDate.get(date)].sort(compareWithinDay);
    const nonPremarket = sorted.filter((e) => extractPhaseId(e) !== "premarket");
    const pool = nonPremarket.length > 0 ? nonPremarket : sorted;
    if (!pool.length) continue;

    const earliest = pool.find((e) => isFiniteNum(e.breakoutCount) && e.breakoutCount > 0) || pool[0];
    const latest = pool[pool.length - 1];

    addFile(earliest);
    addFile(latest);
  }

  return files;
}

export function classifyFollowThrough(chg, cr) {
  if ((chg ?? -99) > 0 && (cr == null || cr >= 60)) return "held";
  if ((cr != null && cr < 40) || (chg != null && chg <= 0)) return "squatted";
  return "mixed";
}

export function computeSizingVerdict(rollingTotal, rollingHoldRate) {
  if ((rollingTotal ?? 0) < 3 || rollingHoldRate == null) {
    return {
      label: "BUILDING SAMPLE",
      tone: "muted",
      advice: "Tracking hourly & daily breakout follow-through as snapshots accumulate.",
    };
  }
  if (rollingHoldRate >= 65) {
    return {
      label: "PRESS SIZE",
      tone: "good",
      advice: "Breakouts are sticking into the close — favorable environment for full size.",
    };
  }
  if (rollingHoldRate >= 45) {
    return {
      label: "SELECTIVE",
      tone: "warn",
      advice: "Mixed follow-through — focus only on top RS/theme leaders and trim into strength.",
    };
  }
  return {
    label: "DEFENSIVE / SQUAT TAPE",
    tone: "bad",
    advice: "High breakout squat rate — reduce size or wait for cleaner breadth.",
  };
}

function liveChangeFromQuote(q) {
  if (!q) return null;
  if (isFiniteNum(q.change)) return q.change;
  const px = q.rthPrice ?? q.price;
  const prev = q.prevClose ?? q.previousClose;
  if (isFiniteNum(px) && isFiniteNum(prev) && prev > 0) {
    return ((px / prev) - 1) * 100;
  }
  return null;
}

const STATUS_SORT_ORDER = { held: 0, mixed: 1, squatted: 2 };

/**
 * Evaluate daily and rolling 5-day breakout follow-through (held / mixed / squatted).
 */
export function evaluateBreakoutFollowThrough({
  snapshots = [],
  quotes = null,
  stockMap = null,
  todayStr = null,
  liveOn = false,
} = {}) {
  const byDate = new Map();
  for (const snap of Array.isArray(snapshots) ? snapshots : []) {
    if (!snap || typeof snap !== "object") continue;
    const date = extractDate(snap);
    if (!date) continue;
    let bucket = byDate.get(date);
    if (!bucket) {
      bucket = [];
      byDate.set(date, bucket);
    }
    bucket.push(snap);
  }

  // Chronological oldest -> newest, up to the 5 most recent dates
  const dates = [...byDate.keys()].sort((a, b) => a.localeCompare(b)).slice(-5);

  const days = dates.map((date) => {
    const daySnaps = [...byDate.get(date)].sort(compareWithinDay);
    const lastIdx = daySnaps.length - 1;

    // Pass 1: collect every unique breakout ticker seen in ANY snapshot that day
    const boMap = new Map();
    daySnaps.forEach((snap, idx) => {
      const movers = Array.isArray(snap?.zangerMovers) ? snap.zangerMovers : [];
      for (const m of movers) {
        if (!m?.ticker) continue;
        const isBo = Boolean(m.isBreakout || (Array.isArray(m.breakoutTypes) && m.breakoutTypes.length > 0));
        if (!isBo) continue;

        let entry = boMap.get(m.ticker);
        if (!entry) {
          entry = {
            ticker: m.ticker,
            firstRow: m,
            latestRow: m,
            latestSnapIdx: idx,
            inLastSnap: idx === lastIdx,
            breakoutTypes: [],
          };
          boMap.set(m.ticker, entry);
        } else {
          entry.latestRow = m;
          entry.latestSnapIdx = idx;
          if (idx === lastIdx) entry.inLastSnap = true;
        }
        for (const bt of m.breakoutTypes || []) {
          if (bt && !entry.breakoutTypes.includes(bt)) {
            entry.breakoutTypes.push(bt);
          }
        }
      }
    });

    // Pass 2: if a breakout ticker reappears in a later snapshot (even with isBreakout: false),
    // update its latestRow so intraday fade/recovery is captured accurately.
    daySnaps.forEach((snap, idx) => {
      const movers = Array.isArray(snap?.zangerMovers) ? snap.zangerMovers : [];
      for (const m of movers) {
        if (!m?.ticker) continue;
        const entry = boMap.get(m.ticker);
        if (!entry) continue;
        if (idx >= entry.latestSnapIdx) {
          entry.latestRow = m;
          entry.latestSnapIdx = idx;
          if (idx === lastIdx) entry.inLastSnap = true;
        }
      }
    });

    const isToday = Boolean(todayStr && date === todayStr);
    const tickers = [];
    let held = 0;
    let squatted = 0;
    let mixed = 0;

    for (const entry of boMap.values()) {
      const tk = entry.ticker;
      const s = stockMap?.[tk] || null;
      const q = isToday && liveOn && quotes && typeof quotes.get === "function" ? quotes.get(tk) : null;

      let chg = null;
      let cr = null;

      if (q) {
        const liveChg = liveChangeFromQuote(q);
        const liveCr = closingRange(q, s);
        chg = liveChg != null ? liveChg : (isFiniteNum(entry.latestRow?.chg) ? entry.latestRow.chg : null);
        cr = liveCr != null ? liveCr : (isFiniteNum(entry.latestRow?.cr) ? entry.latestRow.cr : null);
      } else {
        const fadedFromLatest = isToday && daySnaps.length > 1 && !entry.inLastSnap;
        if (fadedFromLatest && s) {
          chg = isFiniteNum(s.change_pct) ? s.change_pct : (isFiniteNum(entry.latestRow?.chg) ? entry.latestRow.chg : null);
          const sCr = closingRange(null, s);
          cr = sCr != null ? sCr : (isFiniteNum(entry.latestRow?.cr) ? entry.latestRow.cr : null);
        } else {
          chg = isFiniteNum(entry.latestRow?.chg)
            ? entry.latestRow.chg
            : (isToday && isFiniteNum(s?.change_pct) ? s.change_pct : null);
          cr = isFiniteNum(entry.latestRow?.cr)
            ? entry.latestRow.cr
            : (isToday && s ? closingRange(null, s) : null);
        }
      }

      const status = classifyFollowThrough(chg, cr);
      if (status === "held") held++;
      else if (status === "squatted") squatted++;
      else mixed++;

      tickers.push({
        ticker: tk,
        theme: entry.latestRow?.theme || entry.firstRow?.theme || s?.sector || "—",
        breakoutTypes: entry.breakoutTypes,
        chg,
        cr,
        status,
      });
    }

    tickers.sort(
      (a, b) =>
        STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status] ||
        (b.chg ?? -999) - (a.chg ?? -999) ||
        a.ticker.localeCompare(b.ticker)
    );

    const total = tickers.length;
    return {
      date,
      total,
      held,
      squatted,
      mixed,
      holdRate: total ? Math.round((held / total) * 100) : null,
      squatRate: total ? Math.round((squatted / total) * 100) : null,
      tickers,
    };
  });

  const rollingTotal = days.reduce((acc, d) => acc + d.total, 0);
  const rollingHeld = days.reduce((acc, d) => acc + d.held, 0);
  const rollingSquatted = days.reduce((acc, d) => acc + d.squatted, 0);
  const rollingMixed = days.reduce((acc, d) => acc + d.mixed, 0);
  const rollingHoldRate = rollingTotal ? Math.round((rollingHeld / rollingTotal) * 100) : null;
  const rollingSquatRate = rollingTotal ? Math.round((rollingSquatted / rollingTotal) * 100) : null;
  const verdict = computeSizingVerdict(rollingTotal, rollingHoldRate);
  const latestDay = (todayStr && days.find((d) => d.date === todayStr)) || (days.length ? days[days.length - 1] : null);

  return {
    days,
    latestDay,
    rollingTotal,
    rollingHeld,
    rollingSquatted,
    rollingMixed,
    rollingHoldRate,
    rollingSquatRate,
    verdict,
  };
}
