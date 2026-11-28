// Pure briefing intelligence & email/markdown formatters for ThemePulse Zanger Scan.
// Zero I/O or network dependencies — imported and re-exported by scripts/zanger-scan.mjs.

import { closingRange } from "../src/lead/math.js";

export const INDEX_META = [
  ["SPY", "S&P 500"],
  ["QQQ", "Nasdaq 100"],
  ["IWM", "Russell 2000"],
  ["DIA", "Dow 30"],
];

const BO_EMAIL_COLORS = {
  ZANGER: { bg: "#fef3c7", fg: "#92400e", bd: "#f59e0b" },
  "SB4%": { bg: "#dcfce7", fg: "#166534", bd: "#22c55e" },
  "SB$":  { bg: "#cffafe", fg: "#155e75", bd: "#06b6d4" },
  QMAG:   { bg: "#f3e8ff", fg: "#6b21a8", bd: "#a855f7" },
};

export function fmtPct(v, digits = 1) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

function parseNum(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function escHtml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtVol(v) {
  if (v == null || !Number.isFinite(v) || v <= 0) return "—";
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}K`;
  return String(Math.round(v));
}

export const FUTURES_ORDER = [
  "S&P 500",
  "Nasdaq 100",
  "Russell 2000",
  "Dow",
  "Crude Oil",
  "Gold",
  "BTC/USD",
];

function fmtPrice(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 10000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (Math.abs(v) >= 1000) return v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return v.toFixed(2);
}

// 1. Session-aware briefing phase (Pre-Market vs Open vs Midday vs Closing Bell Wrap)
export function getBriefingPhase(stamp) {
  const h = stamp?.hours ?? 12;
  const m = stamp?.minutes ?? 0;
  const mins = h * 60 + m;
  if (mins >= 8 * 60 && mins < 9 * 60 + 30) {
    return {
      id: "premarket",
      label: "PRE-MARKET BRIEF",
      subtitle: "Overnight futures, pre-market gappers & today's watchlist focus",
      accent: "#fbbf24",
    };
  }
  if (mins >= 9 * 60 + 30 && mins < 11 * 60) {
    return {
      id: "open",
      label: "OPENING RANGE SCAN",
      subtitle: "First-hour volume leaders & EP gap-and-go movers",
      accent: "#38bdf8",
    };
  }
  if (mins >= 15 * 60 + 45 && mins <= 17 * 60) {
    return {
      id: "close",
      label: "CLOSING BELL WRAP",
      subtitle: "End-of-day breakout hold check & tomorrow's focus list",
      accent: "#a78bfa",
    };
  }
  return {
    id: "midday",
    label: "INTRADAY UPDATE",
    subtitle: "Fresh breakouts, volume flow & tape health check",
    accent: "#4ade80",
  };
}

// 2. Hourly delta: brand-new breakouts since prior hour + faded/squatted breakouts + hold rate
export function computeHourlyDelta({ prevState = null, today = "", zangerMovers = [], scoredMap = new Map(), liveQuotes = new Map() } = {}) {
  const sameDay = Boolean(prevState && prevState.date === today);
  const seenBoSet = new Set(sameDay ? (prevState.seenBreakouts || []) : []);
  const seenMoverSet = new Set(sameDay ? (prevState.seenMovers || []) : []);
  const priorBoMap = sameDay ? { ...(prevState.priorBreakouts || {}) } : {};

  const currentBos = zangerMovers.filter((m) => m.isBreakout);
  const currentBoSet = new Set(currentBos.map((m) => m.ticker));

  const enrichedMovers = zangerMovers.map((m) => ({
    ...m,
    isNew: sameDay && m.isBreakout && !seenBoSet.has(m.ticker),
    isNewMover: sameDay && !seenMoverSet.has(m.ticker),
  }));

  const newBreakouts = enrichedMovers.filter((m) => m.isNew);

  // Track earlier breakouts from today that dropped out or squatted (CR < 50%)
  const fadedBreakouts = [];
  if (sameDay) {
    for (const tk of seenBoSet) {
      const s = scoredMap.get(tk);
      const q = liveQuotes instanceof Map ? liveQuotes.get(tk) : liveQuotes?.[tk];
      const cr = s?.cr ?? (q ? closingRange(q, null) : null);
      const chg = s?.chg ?? q?.change ?? null;
      const stillBo = currentBoSet.has(tk);
      if (!stillBo || (cr != null && cr < 50)) {
        fadedBreakouts.push({
          ticker: tk,
          theme: s?.theme || priorBoMap[tk]?.theme || "—",
          prevChg: priorBoMap[tk]?.chg ?? null,
          chg,
          cr,
          reason: !stillBo ? "dropped from breakout" : `squatted (CR ${cr}%)`,
        });
      }
    }
  }

  // Merge state for next hourly run
  const nextSeenBos = new Set(seenBoSet);
  const nextSeenMovers = new Set(seenMoverSet);
  const nextPriorBos = { ...priorBoMap };
  for (const m of zangerMovers) {
    nextSeenMovers.add(m.ticker);
    if (m.isBreakout) {
      nextSeenBos.add(m.ticker);
      if (!nextPriorBos[m.ticker]) {
        nextPriorBos[m.ticker] = { chg: m.chg, cr: m.cr, zvr: m.zvr, theme: m.theme, types: m.breakoutTypes };
      }
    }
  }

  // Breakout hold rate across all breakouts active or seen today
  const holdingNow = currentBos.filter((m) => m.cr == null || m.cr >= 70).length;
  const totalToday = Math.max(nextSeenBos.size, currentBos.length);
  const holdRate = totalToday > 0 ? {
    holding: holdingNow,
    active: currentBos.length,
    totalToday,
    pct: Math.round((holdingNow / totalToday) * 100),
  } : null;

  return {
    hasPriorState: sameDay,
    enrichedMovers,
    newBreakouts,
    fadedBreakouts: fadedBreakouts.slice(0, 12),
    holdRate,
    nextState: {
      date: today,
      updatedAt: new Date().toISOString(),
      seenBreakouts: [...nextSeenBos],
      seenMovers: [...nextSeenMovers],
      priorBreakouts: nextPriorBos,
    },
  };
}

// 3. Portfolio & Watchlist Alert Strip (from /api/market-quality userdata)
export function buildPortfolioAlerts({ mq = null, stockMap = {}, liveQuotes = new Map(), scoredMap = new Map() } = {}) {
  const port = Array.isArray(mq?.portfolio) ? mq.portfolio : [];
  const watch = Array.isArray(mq?.watchlist) ? mq.watchlist : [];
  const seen = new Set();
  const alerts = [];

  const checkRow = (row, listType) => {
    const tk = row?.ticker;
    if (!tk || seen.has(tk)) return;
    seen.add(tk);
    const scored = scoredMap.get(tk) || null;
    const s = stockMap[tk] || {};
    const q = liveQuotes instanceof Map ? liveQuotes.get(tk) : liveQuotes?.[tk];
    const chg = scored?.chg ?? q?.change ?? row.chg ?? s.change_pct ?? null;
    const zvr = scored?.zvr ?? (row.rvol || null);
    const cr = scored?.cr ?? (q ? closingRange(q, null) : null);
    const erDays = s.earnings_days ?? scored?.earningsDays ?? null;

    const tags = [];
    let severity = 0;
    if (scored?.isBreakout) {
      tags.push({ label: `🔥 ${scored.breakoutTypes.join("+")}`, tone: "good" });
      severity += 3;
    } else if (zvr != null && zvr >= 1.5 && chg != null && chg >= 1.5) {
      tags.push({ label: `⚡ Vol ${zvr.toFixed(1)}x`, tone: "good" });
      severity += 2;
    }
    if (chg != null && (chg <= -3 || (chg <= -2 && zvr != null && zvr >= 1.5))) {
      tags.push({ label: "🔻 Heavy Sell", tone: "bad" });
      severity += 4;
    } else if (cr != null && cr <= 30 && chg != null && chg < 0) {
      tags.push({ label: `⚠️ Weak Close (CR ${cr}%)`, tone: "warn" });
      severity += 2;
    }
    if (erDays != null && erDays >= 0 && erDays <= 5) {
      tags.push({ label: `📅 ER ${erDays === 0 ? "Today" : `${erDays}d`}`, tone: "warn" });
      severity += 1;
    }

    if (tags.length) {
      alerts.push({
        ticker: tk,
        list: listType,
        theme: scored?.theme || row.theme || s.sector || "—",
        chg,
        zvr,
        cr,
        rs: scored?.rs ?? row.rs ?? s.rs_rank ?? null,
        tags,
        severity,
      });
    }
  };

  for (const r of port) checkRow(r, "PORT");
  for (const r of watch) checkRow(r, "WATCH");
  alerts.sort((a, b) => (a.list === "PORT" ? -1 : 1) - (b.list === "PORT" ? -1 : 1) || b.severity - a.severity || Math.abs(b.chg ?? 0) - Math.abs(a.chg ?? 0));

  return {
    portfolioCount: port.length,
    watchlistCount: watch.length,
    alerts: alerts.slice(0, 12),
  };
}

// 3b. 10-Day Earnings Calendar for Portfolio & Watchlist
export function buildPortfolioEarnings({ mq = null, stockMap = {} } = {}) {
  const port = Array.isArray(mq?.portfolio) ? mq.portfolio : [];
  const watch = Array.isArray(mq?.watchlist) ? mq.watchlist : [];
  const seen = new Set();
  const rows = [];

  const checkRow = (row, list) => {
    const tk = typeof row === "string" ? row : row?.ticker;
    if (!tk || seen.has(tk)) return;
    seen.add(tk);
    const s = stockMap?.[tk];
    if (!s) return;
    const days = parseNum(s.earnings_days);
    if (days == null || days < 0 || days > 10) return;
    const rawDisp = String(s.earnings_display || "").trim();
    let timing = "";
    if (/\/b(?:\b|$)/i.test(rawDisp)) timing = "BMO";
    else if (/\/a(?:\b|$)/i.test(rawDisp)) timing = "AMC";
    else if (s.er_timing) timing = String(s.er_timing).trim().toUpperCase();
    const display = rawDisp.replace(/\/[ab]$/i, "").trim();
    rows.push({
      ticker: tk,
      list,
      days,
      display,
      timing,
    });
  };

  for (const r of port) checkRow(r, "PORT");
  for (const r of watch) checkRow(r, "WATCH");

  rows.sort(
    (a, b) =>
      a.days - b.days ||
      (a.list === "PORT" ? 0 : 1) - (b.list === "PORT" ? 0 : 1) ||
      a.ticker.localeCompare(b.ticker)
  );

  return rows;
}

// 4. EP / High-Volume Gap-and-Go Movers
export function buildEpList({ mq = null, dash = null } = {}) {
  const src = Array.isArray(mq?.epCandidates) && mq.epCandidates.length
    ? mq.epCandidates
    : [
        ...(dash?.pm_earnings_movers || []),
        ...(dash?.ah_earnings_movers || []),
        ...(dash?.pm_sip_movers || []),
        ...(dash?.ah_sip_movers || []),
      ].map((m) => ({
        ticker: m.ticker,
        company: m.company || "",
        chg: m.change_pct ?? m.ext_hours_change_pct ?? null,
        volume: m.volume || 0,
        category: m.category || ((m.volume || 0) >= 8_900_000 ? "LAVA" : "SIP"),
        headlines: (m.recent_headlines || m.headlines || []).slice(0, 1).map((h) => (typeof h === "string" ? h : h.title || h.text || "")),
      }));

  const seen = new Set();
  const out = [];
  for (const item of src) {
    if (!item?.ticker || seen.has(item.ticker)) continue;
    const chg = parseNum(item.chg);
    if (chg == null || chg < 3) continue;
    seen.add(item.ticker);
    out.push({
      ticker: item.ticker,
      company: item.company || "",
      chg,
      volume: item.volume || 0,
      category: item.category || "SIP",
      headline: (item.headlines || [])[0] || "",
    });
  }
  return out.sort((a, b) => b.chg - a.chg).slice(0, 6);
}

// 5. Today's Intraday Theme Money Flow (rotation today, before 20d rank catches up)
export function buildThemeFlow({ stockMap = {}, tickerLayer = {}, liveQuotes = new Map(), zangerMovers = [] } = {}) {
  const boByTheme = new Map();
  for (const m of zangerMovers) {
    if (!m.isBreakout || !m.theme || m.theme === "—") continue;
    boByTheme.set(m.theme, (boByTheme.get(m.theme) || 0) + 1);
  }

  const buckets = new Map();
  for (const [tk, s] of Object.entries(stockMap)) {
    if ((s.avg_dollar_vol_raw ?? 0) < 20e6) continue;
    const theme = tickerLayer[tk]?.theme;
    if (!theme) continue;
    const q = liveQuotes instanceof Map ? liveQuotes.get(tk) : liveQuotes?.[tk];
    const chg = q?.change ?? s.change_pct;
    if (chg == null || !Number.isFinite(chg)) continue;
    let b = buckets.get(theme);
    if (!b) {
      b = { theme, sum: 0, count: 0, green: 0, best: null };
      buckets.set(theme, b);
    }
    b.sum += chg;
    b.count++;
    if (chg > 0) b.green++;
    if (!b.best || chg > b.best.chg) b.best = { ticker: tk, chg };
  }

  const rows = [];
  for (const b of buckets.values()) {
    if (b.count < 4) continue;
    rows.push({
      theme: b.theme,
      avgChg: Math.round((b.sum / b.count) * 100) / 100,
      pctGreen: Math.round((b.green / b.count) * 100),
      count: b.count,
      breakouts: boByTheme.get(b.theme) || 0,
      topMover: b.best,
    });
  }
  rows.sort((a, b) => b.avgChg - a.avgChg);
  return {
    hottest: rows.slice(0, 5),
    coldest: rows.length > 5 ? rows.slice(-3).reverse() : [],
  };
}

// 6. Leader Damage / Distribution Watch ("Generals Getting Hit")
export function buildLeaderDamage({ scored = [], layers = [] } = {}) {
  const damagedLeaders = scored
    .filter((r) => {
      if (r.rs < 90 && r.tier !== "lead") return false;
      if (r.chg == null || r.chg > -3.0) return false;
      const heavyVol = r.zvr != null && r.zvr >= 1.5;
      const weakClose = r.cr != null && r.cr <= 30;
      return heavyVol || weakClose || r.chg <= -4.5;
    })
    .sort((a, b) => a.chg - b.chg || (b.zvr ?? 0) - (a.zvr ?? 0))
    .slice(0, 8);

  const warnLayers = (layers || [])
    .filter((l) => l.st === "lead" && (l.flags || []).some(([k]) => k === "distrib" || k === "exiting"))
    .map((l) => ({
      theme: l.theme,
      layer: l.name,
      rank: l.now,
      flags: l.flags.map(([k]) => k),
    }))
    .slice(0, 6);

  return { damagedLeaders, warnLayers };
}

// 7. "On Deck" Basing Leaders (RS-line 52w highs basing near highs)
export function buildOnDeckRsl({ scored = [] } = {}) {
  return scored
    .filter((r) => r.rsl && !r.isBreakout && r.rs >= 85)
    .sort((a, b) => b.rs - a.rs || (b.off52 ?? -99) - (a.off52 ?? -99))
    .slice(0, 8);
}

function indexMaPosture(price, ma) {
  if (!ma) return null;
  const p = price ?? ma.price;
  if (p == null) return null;
  const a10 = ma.ema10 ? p >= ma.ema10 : ma.above_ema10;
  const a21 = ma.ema21 ? p >= ma.ema21 : ma.above_ema21;
  const a50 = ma.sma50 ? p >= ma.sma50 : ma.above_sma50;
  const a200 = ma.sma200 ? p >= ma.sma200 : ma.above_sma200;
  if (a10 && a21 && a50 && a200) return "Above all MAs";
  if (!a10 && a21 && a50 && a200) return "<10EMA, >21/50/200";
  if (!a21 && a50 && a200) return "<21EMA, >50/200";
  if (!a50 && a200) return "<50SMA, >200";
  if (!a50 && !a200) return "Below 50 & 200";
  const parts = [];
  if (a21) parts.push(">21");
  if (a50) parts.push(">50");
  if (a200) parts.push(">200");
  return parts.length ? parts.join("/") : "Below key MAs";
}

export function buildMarketSummary({
  mq = null,
  monitor = null,
  liveQuotes = null,
  dashStocks = [],
  zangerMovers = [],
  delta = null,
  leaderDamage = null,
} = {}) {
  const tapeMap = new Map();
  for (const item of mq?.tape || []) {
    if (item?.ticker) {
      tapeMap.set(item.ticker, {
        price: parseNum(item.price),
        change: parseNum(item.change),
      });
    }
  }

  const getLive = (tk) => (liveQuotes instanceof Map ? liveQuotes.get(tk) : liveQuotes?.[tk]) || null;

  const indices = INDEX_META.map(([ticker, name]) => {
    const q = getLive(ticker);
    const t = tapeMap.get(ticker);
    const ma = monitor?.indices?.[ticker] || null;
    const price = q?.rthPrice ?? q?.price ?? t?.price ?? ma?.price ?? null;
    const change = q?.change ?? t?.change ?? null;
    const cr = q ? closingRange(q, null) : null;
    const maStatus = indexMaPosture(price, ma);
    return { ticker, name, price, change, cr, maStatus };
  });

  const vixTape = tapeMap.get("VIX");
  const vixLevel = vixTape?.price ?? parseNum(mq?.scores?.volatility?.details?.vix_level?.value);
  const vixChange = vixTape?.change ?? parseNum(String(mq?.scores?.volatility?.details?.vix_trend?.value || "").replace("%", ""));
  const vix = vixLevel != null ? {
    price: vixLevel,
    change: vixChange,
    label: mq?.scores?.volatility?.details?.vix_level?.label || (vixLevel < 16 ? "Low" : vixLevel < 22 ? "Normal" : vixLevel < 28 ? "Elevated" : "Extreme"),
  } : null;

  const tnxTape = tapeMap.get("TNX");
  const tnx = tnxTape?.price != null ? { price: tnxTape.price, change: tnxTape.change } : null;

  const totalStocks = dashStocks.length || 0;
  const pctAbove50 = mq?.breadthStats?.sma50Above?.pct
    ?? (totalStocks ? Math.round(dashStocks.filter((s) => s.above_50ma === 1 || s.sma50_above === 1).length / totalStocks * 100) : null);
  const pctAbove200 = mq?.breadthStats?.sma200Above?.pct
    ?? (totalStocks ? Math.round(dashStocks.filter((s) => s.above_200ma === 1 || s.sma200_above === 1).length / totalStocks * 100) : null);

  let liveAdv = 0, liveDec = 0;
  if (liveQuotes instanceof Map) {
    for (const [tk, q] of liveQuotes.entries()) {
      if (INDEX_META.some(([i]) => i === tk)) continue;
      if (q?.change == null) continue;
      if (q.change > 0) liveAdv++;
      else if (q.change < 0) liveDec++;
    }
  }
  const liveTotal = liveAdv + liveDec;
  const livePctAdv = liveTotal >= 20 ? Math.round((liveAdv / liveTotal) * 100) : null;

  const cur = monitor?.current || {};
  const breadth = {
    pctAbove50,
    pctAbove200,
    up4: cur.up_4pct ?? null,
    down4: cur.down_4pct ?? null,
    t2108: cur.t2108 ?? null,
    ratio5d: cur.ratio_5d ?? null,
    liveAdv,
    liveDec,
    livePctAdv,
  };

  const secList = Array.isArray(mq?.sectors) ? mq.sectors : [];
  const sectors = secList.length ? {
    positive: secList.filter((s) => (s.change ?? 0) > 0).length,
    total: secList.length,
    leaders: secList.slice(0, 3),
    laggards: secList.slice(-3).reverse(),
  } : null;

  const decision = mq?.decision ?? null;
  const score = mq?.total ?? null;
  const positionSize = mq?.position_size ?? null;
  const regime = mq?.scores?.trend?.details?.regime?.value ?? null;
  const fomc = mq?.scores?.macro?.details?.fomc ?? null;

  const commentary = [];
  const spy = indices.find((i) => i.ticker === "SPY");
  const qqq = indices.find((i) => i.ticker === "QQQ");
  const iwm = indices.find((i) => i.ticker === "IWM");

  if (score != null && decision) {
    const tone = decision === "YES"
      ? "Constructive tape — favors active swing exposure with normal sizing."
      : decision === "CAUTION"
        ? "Mixed/selective tape — stick to A+ leaders and reduced sizing."
        : "Defensive tape — capital preservation mode; avoid forcing breakouts.";
    commentary.push(`Market Quality ${score}/100 (${decision}${positionSize ? ` · ${positionSize} size` : ""}${regime ? ` · ${regime}` : ""}). ${tone}`);
  } else if (spy?.maStatus) {
    commentary.push(`Index posture: SPY is ${spy.maStatus}${qqq?.maStatus ? `, QQQ is ${qqq.maStatus}` : ""}${iwm?.maStatus ? `, IWM is ${iwm.maStatus}` : ""}.`);
  }

  const idxChgs = indices.filter((i) => i.change != null);
  if (idxChgs.length) {
    const sorted = [...idxChgs].sort((a, b) => b.change - a.change);
    const best = sorted[0], worst = sorted[sorted.length - 1];
    const parts = indices
      .filter((i) => i.change != null)
      .map((i) => `${i.ticker} ${fmtPct(i.change, 2)}${i.cr != null ? ` (CR ${i.cr}%)` : ""}`);
    let tapeNote = `Index action: ${parts.join(" · ")}.`;
    if (best.change - worst.change >= 0.4) {
      tapeNote += ` ${best.ticker} leading vs ${worst.ticker} lagging.`;
    }
    const avgCr = idxChgs.filter((i) => i.cr != null);
    if (avgCr.length >= 2) {
      const meanCr = avgCr.reduce((a, b) => a + b.cr, 0) / avgCr.length;
      if (meanCr >= 72) tapeNote += " Buyers are in control near session highs.";
      else if (meanCr <= 32) tapeNote += " Indices are fading near session lows — watch for failed breakouts.";
    }
    commentary.push(tapeNote);
  }

  const bParts = [];
  if (livePctAdv != null) bParts.push(`${livePctAdv}% of liquid leaders green intraday (${liveAdv}↑ / ${liveDec}↓)`);
  if (sectors) {
    const topStr = sectors.leaders.slice(0, 2).map((s) => `${s.ticker} ${fmtPct(s.change, 1)}`).join(", ");
    const botStr = sectors.laggards.slice(0, 2).map((s) => `${s.ticker} ${fmtPct(s.change, 1)}`).join(", ");
    bParts.push(`${sectors.positive}/${sectors.total} sectors positive (leaders: ${topStr}; laggards: ${botStr})`);
  }
  if (pctAbove50 != null) bParts.push(`${pctAbove50}% of stocks >50MA`);
  if (breadth.up4 != null && breadth.down4 != null) {
    bParts.push(`Stockbee 4% movers ${breadth.up4}↑ vs ${breadth.down4}↓${breadth.t2108 != null ? ` (T2108 ${breadth.t2108}%)` : ""}`);
  }
  if (bParts.length) commentary.push(`Breadth & rotation: ${bParts.join("; ")}.`);

  const mParts = [];
  if (vix) {
    mParts.push(`VIX ${vix.price.toFixed(2)}${vix.change != null ? ` (${fmtPct(vix.change, 1)})` : ""} — ${vix.label.toLowerCase()} volatility`);
  }
  if (tnx) {
    mParts.push(`10Y yield ${tnx.price.toFixed(2)}%${tnx.change != null ? ` (${fmtPct(tnx.change, 1)})` : ""}`);
  }
  if (fomc && (fomc.label === "Event risk!" || fomc.label === "Caution")) {
    mParts.push(`FOMC ${fomc.value} (${fomc.label})`);
  }
  if (delta?.holdRate && delta.hasPriorState) {
    mParts.push(`Breakout hold rate ${delta.holdRate.holding}/${delta.holdRate.totalToday} (${delta.holdRate.pct}%)`);
  }
  const dmgCount = leaderDamage?.damagedLeaders?.length || 0;
  if (dmgCount >= 3) {
    mParts.push(`⚠️ ${dmgCount} RS 90+ leaders hit hard on volume`);
  }
  const boCount = (zangerMovers || []).filter((m) => m.isBreakout).length;
  if (boCount > 0 && decision === "NO") {
    mParts.push(`${boCount} breakout${boCount === 1 ? "" : "s"} firing against a weak tape — demand top RS/CR and tight risk`);
  } else if (boCount >= 8 && decision === "YES") {
    mParts.push(`${boCount} breakouts confirming healthy risk-on participation`);
  }
  if (mParts.length) commentary.push(`Tape & risk: ${mParts.join(" · ")}.`);

  const rawFutures = Array.isArray(mq?.futures) ? mq.futures : [];
  const futByName = new Map();
  const validFutures = [];
  for (const f of rawFutures) {
    const name = String(f?.name || f?.label || "").trim();
    if (!name) continue;
    const price = parseNum(f.price ?? f.last);
    const change = parseNum(f.change);
    const changePct = parseNum(
      typeof f.changePct === "string"
        ? f.changePct.replace("%", "")
        : typeof f.change_pct === "string"
          ? f.change_pct.replace("%", "")
          : (f.changePct ?? f.change_pct)
    );
    if (price == null && changePct == null) continue;
    const norm = { name, price, change, changePct };
    futByName.set(name.toLowerCase(), norm);
    validFutures.push(norm);
  }
  const orderedFutures = FUTURES_ORDER
    .map((label) => futByName.get(label.toLowerCase()))
    .filter(Boolean);
  const futures = orderedFutures.length ? orderedFutures : validFutures.slice(0, 7);

  return {
    decision,
    score,
    positionSize,
    regime,
    indices,
    futures,
    vix,
    tnx,
    sectors,
    breadth,
    fomc,
    commentary,
  };
}

function buildTradingViewLists({ zangerMovers = [], onDeckRsl = [] } = {}) {
  const movers = zangerMovers || [];
  const boTickers = [...new Set(movers.filter((m) => m.isBreakout).map((m) => m.ticker).filter(Boolean))];
  const allMoverTickers = [...new Set(movers.map((m) => m.ticker).filter(Boolean))];
  const onDeckTickers = [...new Set((onDeckRsl || []).map((r) => r.ticker).filter(Boolean))];

  const rows = [];
  if (boTickers.length) {
    rows.push({ label: "Breakouts", tickers: boTickers.join(",") });
  }
  if (allMoverTickers.length && allMoverTickers.join(",") !== boTickers.join(",")) {
    rows.push({ label: "All Movers", tickers: allMoverTickers.join(",") });
  }
  if (onDeckTickers.length) {
    rows.push({ label: "On Deck (RSL)", tickers: onDeckTickers.join(",") });
  }
  return rows;
}

export function buildEmailSubject({ stamp, zangerMovers, market, phase, delta, leaderDamage, epMovers, onDeckRsl }) {
  const bos = (zangerMovers || []).filter((m) => m.isBreakout);
  const timeShort = stamp?.pretty ? stamp.pretty.slice(11) : "";
  const spy = market?.indices?.find((i) => i.ticker === "SPY");
  const qqq = market?.indices?.find((i) => i.ticker === "QQQ");
  const idxBits = [
    spy?.change != null ? `SPY ${fmtPct(spy.change, 1)}` : null,
    qqq?.change != null ? `QQQ ${fmtPct(qqq.change, 1)}` : null,
  ].filter(Boolean);
  const idxTag = idxBits.length ? ` | ${idxBits.join(" ")}` : "";
  const newCount = delta?.newBreakouts?.length || 0;
  const newTag = newCount > 0 ? ` (${newCount} NEW)` : "";

  if (phase?.id === "premarket") {
    const futs = market?.futures || [];
    const spFut = futs.find((f) => f.name.toLowerCase() === "s&p 500");
    const nqFut = futs.find((f) => f.name.toLowerCase() === "nasdaq 100");
    const futBits = [
      spFut?.changePct != null ? `S&P ${fmtPct(spFut.changePct, 1)}` : null,
      nqFut?.changePct != null ? `NQ ${fmtPct(nqFut.changePct, 1)}` : null,
    ].filter(Boolean);
    const mktTag = futBits.length ? ` | ${futBits.join(" ")}` : idxTag;
    const focusBits = [];
    if (epMovers?.length) focusBits.push(`${epMovers.length} Gapper${epMovers.length === 1 ? "" : "s"}`);
    if (onDeckRsl?.length) focusBits.push(`${onDeckRsl.length} On Deck`);
    if (!focusBits.length && bos.length > 0) focusBits.push(`${bos.length} BO`);
    const focusText = focusBits.length ? focusBits.join(" · ") : "Morning Focus";
    return `☀️ Pre-Market Brief: ${focusText}${mktTag} — ${timeShort}`;
  }

  const prefix = phase?.id === "close"
    ? "🏁 EOD Zanger Wrap"
    : phase?.id === "open"
      ? "🔔 Open Zanger"
      : bos.length > 0 ? "🔥 Zanger" : "⚡ Zanger";

  if (bos.length > 0) {
    const top = bos.slice(0, 3).map((m) => m.ticker).join(", ");
    const more = bos.length > 3 ? ` +${bos.length - 3}` : "";
    return `${prefix}: ${bos.length} BO${newTag} (${top}${more}) · ${zangerMovers.length} Movers${idxTag} — ${timeShort}`;
  }
  if ((zangerMovers || []).length > 0) {
    const top = zangerMovers.slice(0, 3).map((m) => m.ticker).join(", ");
    return `${prefix}: ${zangerMovers.length} Mover${zangerMovers.length === 1 ? "" : "s"} (${top})${idxTag} — ${timeShort}`;
  }
  const dmg = leaderDamage?.damagedLeaders?.length || 0;
  if (dmg > 0) {
    return `⚠️ Zanger Risk Alert: ${dmg} Core Leaders Hit${idxTag} — ${timeShort}`;
  }
  return `${prefix} (0 Movers)${idxTag} — ${timeShort}`;
}

export function buildEmailHtml(
  {
    stamp,
    mode,
    clock,
    pipelineDate,
    leadingLayers,
    emergingLayers,
    zangerMovers,
    headlines,
    market,
    phase,
    delta,
    portfolioAlerts,
    portfolioEarnings,
    epMovers,
    themeFlow,
    leaderDamage,
    onDeckRsl,
    goToAnalysis = null,
  },
  { baseUrl = "https://themepulse.vercel.app" } = {}
) {
  const url = baseUrl.replace(/\/$/, "");
  const movers = zangerMovers || [];
  const bos = movers.filter((m) => m.isBreakout);
  const leadCount = (leadingLayers || []).length;
  const emergCount = (emergingLayers || []).length;
  const ph = phase || getBriefingPhase(stamp);
  const isPremarket = ph.id === "premarket";
  const tLink = (tk) => `${url}/?view=brief&ticker=${encodeURIComponent(tk)}`;

  // Overnight Futures & Macro strip
  const futuresHtml = (() => {
    const futures = Array.isArray(market?.futures) ? market.futures : [];
    if (!futures.length) return "";
    if (isPremarket) {
      const cells = futures.map((f) => {
        const chgColor = f.changePct == null ? "#64748b" : f.changePct >= 0 ? "#15803d" : "#dc2626";
        return `<div style="flex:1 1 105px;min-width:100px;padding:7px 9px;background:#ffffff;border:1px solid #fde68a;border-radius:6px;">
          <div style="font-size:10px;color:#64748b;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escHtml(f.name)}</div>
          <div style="margin-top:2px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
            <span style="font-size:13px;font-weight:800;color:${chgColor};">${f.changePct != null ? escHtml(fmtPct(f.changePct, 2)) : "—"}</span>
            ${f.price != null ? `<span style="font-size:10px;color:#475569;margin-left:4px;">${escHtml(fmtPrice(f.price))}</span>` : ""}
          </div>
        </div>`;
      }).join("");
      return `<div style="margin-bottom:18px;padding:12px 14px;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;">
        <div style="font-size:13px;font-weight:800;color:#92400e;margin-bottom:8px;">☀️ Overnight Futures &amp; Macro</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${cells}</div>
      </div>`;
    }
    const items = futures.map((f) => {
      const chgColor = f.changePct == null ? "#64748b" : f.changePct >= 0 ? "#15803d" : "#dc2626";
      const pct = f.changePct != null ? `<strong style="color:${chgColor};">${escHtml(fmtPct(f.changePct, 2))}</strong>` : "—";
      return `${escHtml(f.name)} ${pct}`;
    }).join(" &nbsp;·&nbsp; ");
    return `<div style="margin-bottom:14px;padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:11px;color:#334155;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
      <strong style="color:#0f172a;">Overnight Futures &amp; Macro:</strong> ${items}
    </div>`;
  })();

  const badgeHtml = (m) => {
    const parts = [];
    if (m.isNew) {
      parts.push(`<span style="display:inline-block;padding:2px 5px;margin:1px 2px 1px 0;border-radius:3px;font-size:9px;font-weight:800;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#0f172a;color:#38bdf8;border:1px solid #38bdf8;">NEW</span>`);
    }
    if (m.breakoutTypes?.length) {
      for (const k of m.breakoutTypes) {
        const c = BO_EMAIL_COLORS[k] || { bg: "#fef3c7", fg: "#92400e", bd: "#f59e0b" };
        parts.push(`<span style="display:inline-block;padding:2px 5px;margin:1px 2px 1px 0;border-radius:3px;font-size:10px;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:${c.bg};color:${c.fg};border:1px solid ${c.bd};">${escHtml(k)}</span>`);
      }
    } else if (m.rsl) {
      parts.push(`<span style="display:inline-block;padding:2px 6px;border-radius:3px;font-size:10px;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#e0f2fe;color:#075985;border:1px solid #38bdf8;">RSL</span>`);
    } else {
      parts.push(`<span style="display:inline-block;padding:2px 6px;border-radius:3px;font-size:10px;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#dcfce7;color:#166534;border:1px solid #4ade80;">VOL</span>`);
    }
    return parts.join("");
  };

  // General Market card
  const marketSectionHtml = (() => {
    if (!market) return "";
    const dec = market.decision;
    const decStyle = dec === "YES"
      ? { bg: "#dcfce7", fg: "#166534", bd: "#22c55e" }
      : dec === "CAUTION"
        ? { bg: "#fef3c7", fg: "#92400e", bd: "#f59e0b" }
        : { bg: "#fee2e2", fg: "#991b1b", bd: "#ef4444" };

    const indexCells = (market.indices || []).map((idx) => {
      const chgColor = idx.change == null ? "#64748b" : idx.change >= 0 ? "#15803d" : "#dc2626";
      const crTxt = idx.cr != null ? `CR ${idx.cr}%` : "";
      const subBits = [crTxt, idx.maStatus].filter(Boolean).join(" · ");
      return `<td style="width:25%;padding:8px 10px;background:#ffffff;border:1px solid #e2e8f0;border-radius:6px;vertical-align:top;">
        <div style="font-size:10px;color:#64748b;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;">${escHtml(idx.ticker)} <span style="font-weight:400;">${escHtml(idx.name)}</span></div>
        <div style="margin-top:3px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
          <span style="font-size:15px;font-weight:800;color:${chgColor};">${idx.change != null ? escHtml(fmtPct(idx.change, 2)) : "—"}</span>
          ${idx.price != null ? `<span style="font-size:11px;color:#475569;margin-left:4px;">${idx.price.toFixed(2)}</span>` : ""}
        </div>
        ${subBits ? `<div style="margin-top:2px;font-size:10px;color:#64748b;">${escHtml(subBits)}</div>` : ""}
      </td>`;
    }).join("");

    const macroBits = [
      market.vix ? `VIX <strong>${market.vix.price.toFixed(2)}</strong>${market.vix.change != null ? ` (${escHtml(fmtPct(market.vix.change, 1))})` : ""}` : null,
      market.tnx ? `10Y <strong>${market.tnx.price.toFixed(2)}%</strong>` : null,
      market.breadth?.pctAbove50 != null ? `&gt;50MA <strong>${market.breadth.pctAbove50}%</strong>` : null,
      market.breadth?.up4 != null && market.breadth?.down4 != null ? `4% Movers <strong>${market.breadth.up4}↑ / ${market.breadth.down4}↓</strong>` : null,
      market.breadth?.t2108 != null ? `T2108 <strong>${market.breadth.t2108}%</strong>` : null,
      market.sectors ? `Sectors <strong>${market.sectors.positive}/${market.sectors.total}</strong> green` : null,
    ].filter(Boolean);

    const sectorStrip = market.sectors ? `
      <div style="margin-top:8px;font-size:11px;color:#475569;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
        <span style="color:#15803d;font-weight:700;">Top Sectors:</span>
        ${market.sectors.leaders.map((s) => `${escHtml(s.ticker)} ${escHtml(fmtPct(s.change, 1))}`).join(" · ")}
        &nbsp;&nbsp;|&nbsp;&nbsp;
        <span style="color:#dc2626;font-weight:700;">Laggards:</span>
        ${market.sectors.laggards.map((s) => `${escHtml(s.ticker)} ${escHtml(fmtPct(s.change, 1))}`).join(" · ")}
      </div>` : "";

    const bullets = (market.commentary || []).map((c) =>
      `<li style="margin-bottom:5px;line-height:1.45;color:#1e293b;">${escHtml(c)}</li>`
    ).join("");

    return `
      <div style="margin-bottom:18px;padding:14px 16px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
          <h2 style="margin:0;font-size:15px;color:#0f172a;">General Market &amp; Commentary</h2>
          ${dec ? `<span style="display:inline-block;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:800;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:${decStyle.bg};color:${decStyle.fg};border:1px solid ${decStyle.bd};">
            ${escHtml(dec)}${market.score != null ? ` · ${market.score}/100` : ""}${market.positionSize ? ` · ${escHtml(market.positionSize)}` : ""}
          </span>` : ""}
        </div>
        ${indexCells ? `<table style="width:100%;border-collapse:separate;border-spacing:6px 0;margin:0 -6px 8px;"><tr>${indexCells}</tr></table>` : ""}
        ${macroBits.length ? `<div style="font-size:11px;color:#334155;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin-top:4px;">${macroBits.join(" &nbsp;·&nbsp; ")}</div>` : ""}
        ${sectorStrip}
        ${bullets ? `<ul style="margin:10px 0 0;padding-left:18px;font-size:12px;">${bullets}</ul>` : ""}
      </div>`;
  })();

  // Portfolio & Watchlist Pulse card
  const portfolioHtml = (() => {
    if (!portfolioAlerts || (!portfolioAlerts.portfolioCount && !portfolioAlerts.watchlistCount)) return "";
    if (!portfolioAlerts.alerts.length) {
      return `<div style="margin-bottom:16px;padding:10px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:12px;color:#166534;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
        ✅ <strong>Portfolio &amp; Watchlist Pulse:</strong> All ${portfolioAlerts.portfolioCount} holdings &amp; ${portfolioAlerts.watchlistCount} watched names quiet (no breakouts, heavy selling, or imminent earnings).
      </div>`;
    }
    const rows = portfolioAlerts.alerts.map((a) => {
      const chgColor = a.chg == null ? "#64748b" : a.chg >= 0 ? "#15803d" : "#dc2626";
      const tagHtml = a.tags.map((t) => {
        const bg = t.tone === "bad" ? "#fee2e2" : t.tone === "warn" ? "#fef3c7" : "#dcfce7";
        const fg = t.tone === "bad" ? "#991b1b" : t.tone === "warn" ? "#92400e" : "#166534";
        return `<span style="display:inline-block;padding:1px 6px;margin-right:4px;border-radius:3px;font-size:10px;font-weight:700;background:${bg};color:${fg};">${escHtml(t.label)}</span>`;
      }).join("");
      return `<tr style="border-bottom:1px solid #e2e8f0;">
        <td style="padding:5px 6px;font-size:10px;font-weight:700;color:${a.list === "PORT" ? "#1d4ed8" : "#64748b"};font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${a.list}</td>
        <td style="padding:5px 6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:800;"><a href="${tLink(a.ticker)}" style="color:#0f172a;text-decoration:none;">${escHtml(a.ticker)}</a></td>
        <td style="padding:5px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;color:${chgColor};">${escHtml(fmtPct(a.chg, 2))}</td>
        <td style="padding:5px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#334155;">${a.zvr != null ? `${a.zvr.toFixed(1)}x` : "—"}</td>
        <td style="padding:5px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#475569;">${a.cr != null ? `${a.cr}%` : "—"}</td>
        <td style="padding:5px 6px;">${tagHtml}</td>
      </tr>`;
    }).join("");
    return `<div style="margin-bottom:18px;padding:12px 14px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;">
      <div style="font-size:13px;font-weight:800;color:#1e3a8a;margin-bottom:6px;">Portfolio &amp; Watchlist Pulse <span style="font-weight:400;font-size:11px;color:#3b82f6;">(${portfolioAlerts.alerts.length} active across ${portfolioAlerts.portfolioCount} holdings / ${portfolioAlerts.watchlistCount} watchlist)</span></div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;background:#ffffff;border-radius:6px;overflow:hidden;">
        <thead><tr style="background:#f8fafc;border-bottom:1px solid #cbd5e1;font-size:10px;color:#475569;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase;">
          <th style="padding:5px 6px;text-align:left;">List</th>
          <th style="padding:5px 6px;text-align:left;">Ticker</th>
          <th style="padding:5px 6px;text-align:right;">Chg%</th>
          <th style="padding:5px 6px;text-align:right;">ZVR</th>
          <th style="padding:5px 6px;text-align:right;">CR%</th>
          <th style="padding:5px 6px;text-align:left;">Alert</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  })();

  // Upcoming Earnings Calendar (Portfolio & Watchlist · Next 10d)
  const portfolioEarningsHtml = (() => {
    if (!portfolioEarnings?.length) return "";
    const rows = portfolioEarnings.map((e) => {
      const whenLabel = e.days === 0 ? "Today" : `${e.days}d`;
      const whenStyle = e.days === 0
        ? "background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;"
        : e.days <= 3
          ? "background:#fef3c7;color:#92400e;border:1px solid #f59e0b;"
          : "background:#f1f5f9;color:#334155;border:1px solid #cbd5e1;";
      const timingPill = e.timing
        ? `<span style="display:inline-block;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:${e.timing === "BMO" ? "#e0f2fe" : "#f3e8ff"};color:${e.timing === "BMO" ? "#075985" : "#6b21a8"};">${escHtml(e.timing)}</span>`
        : `<span style="color:#94a3b8;">—</span>`;
      return `<tr style="border-bottom:1px solid #e2e8f0;">
        <td style="padding:5px 6px;font-size:10px;font-weight:700;color:${e.list === "PORT" ? "#1d4ed8" : "#64748b"};font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escHtml(e.list)}</td>
        <td style="padding:5px 6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:800;"><a href="${tLink(e.ticker)}" style="color:#0f172a;text-decoration:none;">${escHtml(e.ticker)}</a></td>
        <td style="padding:5px 6px;"><span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;${whenStyle}">${escHtml(whenLabel)}</span></td>
        <td style="padding:5px 6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#334155;">${escHtml(e.display || "—")}</td>
        <td style="padding:5px 6px;">${timingPill}</td>
      </tr>`;
    }).join("");
    return `<div style="margin-bottom:18px;padding:12px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;">
      <div style="font-size:13px;font-weight:800;color:#92400e;margin-bottom:6px;">📅 Upcoming Earnings (Portfolio &amp; Watchlist · Next 10d)</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;background:#ffffff;border-radius:6px;overflow:hidden;">
        <thead><tr style="background:#fef9c3;border-bottom:1px solid #fde68a;font-size:10px;color:#854d0e;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase;">
          <th style="padding:5px 6px;text-align:left;">List</th>
          <th style="padding:5px 6px;text-align:left;">Ticker</th>
          <th style="padding:5px 6px;text-align:left;">In</th>
          <th style="padding:5px 6px;text-align:left;">Date</th>
          <th style="padding:5px 6px;text-align:left;">Timing</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  })();

  // EP / Gap-and-Go Movers card
  const epHtml = (() => {
    if (!epMovers?.length) return "";
    const epTitle = isPremarket ? "⚡ EP / Pre-Market Gappers &amp; Gap-and-Go Movers" : "⚡ EP / Gap-and-Go Movers";
    const items = epMovers.map((e) => `
      <li style="margin-bottom:5px;line-height:1.4;">
        <span style="display:inline-block;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:800;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:${e.category === "LAVA" ? "#fee2e2" : "#fef3c7"};color:${e.category === "LAVA" ? "#991b1b" : "#92400e"};">${escHtml(e.category)}</span>
        <a href="${tLink(e.ticker)}" style="color:#0f172a;font-weight:800;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;text-decoration:none;margin-left:4px;">${escHtml(e.ticker)}</a>
        <strong style="color:#15803d;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin-left:4px;">${escHtml(fmtPct(e.chg, 1))}</strong>
        ${e.volume ? `<span style="color:#64748b;font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">(vol ${escHtml(fmtVol(e.volume))})</span>` : ""}
        ${e.headline ? `<span style="color:#475569;">— ${escHtml(e.headline)}</span>` : ""}
      </li>`).join("");
    return `<div style="margin-bottom:18px;padding:12px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;">
      <div style="font-size:13px;font-weight:800;color:#92400e;margin-bottom:6px;">${epTitle} <span style="font-weight:400;font-size:11px;color:#b45309;">(High-momentum catalyst gaps ≥ +3%)</span></div>
      <ul style="margin:0;padding-left:18px;font-size:12px;">${items}</ul>
    </div>`;
  })();

  // Closing Bell Wrap callout (4:00 PM ET only)
  const closeWrapHtml = (() => {
    if (ph.id !== "close") return "";
    const strongCloses = bos.filter((m) => m.cr != null && m.cr >= 75);
    const faded = delta?.fadedBreakouts || [];
    return `<div style="margin-bottom:18px;padding:12px 14px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:8px;font-size:12px;color:#4c1d95;">
      <div style="font-size:13px;font-weight:800;margin-bottom:6px;">🏁 Closing Bell Wrap</div>
      <div><strong>Strong Breakout Closes (CR ≥ 75%):</strong> ${strongCloses.length ? strongCloses.slice(0, 10).map((m) => `<a href="${tLink(m.ticker)}" style="color:#5b21b6;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;text-decoration:none;">${escHtml(m.ticker)}</a> (${escHtml(fmtPct(m.chg, 1))}, CR ${m.cr}%)`).join(" · ") : "None"}</div>
      ${faded.length ? `<div style="margin-top:4px;"><strong>Failed / Squatted Breakouts:</strong> ${faded.slice(0, 8).map((f) => `${escHtml(f.ticker)} (${escHtml(f.reason)})`).join(" · ")}</div>` : ""}
    </div>`;
  })();

  // Movers table
  const moverRows = movers.slice(0, 25).map((m) => {
    const tierBadge = m.tier === "lead" ? " ⭐" : m.tier === "emerg" ? " 🌱" : "";
    const erBadge = m.earningsDays != null && m.earningsDays >= 0 && m.earningsDays <= 5
      ? `<span style="display:inline-block;padding:1px 4px;margin-left:3px;border-radius:3px;font-size:9px;font-weight:700;background:#fef3c7;color:#92400e;border:1px solid #f59e0b;">ER ${m.earningsDays === 0 ? "0d" : `${m.earningsDays}d`}</span>`
      : "";
    const chgColor = m.chg == null ? "#64748b" : m.chg >= 0 ? "#15803d" : "#dc2626";
    const zvrColor = (m.zvr ?? 0) >= 2.5 ? "#b45309" : (m.zvr ?? 0) >= 1.8 ? "#15803d" : "#334155";
    const crColor = (m.cr ?? 0) >= 75 ? "#15803d" : (m.cr ?? 0) >= 50 ? "#b45309" : "#dc2626";
    const dollarSub = m.dollarMove != null && m.dollarMove >= 0.9
      ? `<div style="font-size:10px;color:#0e7490;font-weight:500;">+$${m.dollarMove.toFixed(2)}</div>`
      : "";
    const epsStr = m.eps != null ? `${m.eps}${m.epsAccel ? "▲" : ""}` : "—";
    const rowBg = m.isNew ? "#f0f9ff" : m.isBreakout ? "#fffbeb" : "#ffffff";
    return `<tr style="background:${rowBg};border-bottom:1px solid #e2e8f0;">
      <td style="padding:7px 6px;vertical-align:middle;">${badgeHtml(m)}</td>
      <td style="padding:7px 6px;vertical-align:middle;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
        <a href="${tLink(m.ticker)}" style="color:#0f172a;font-weight:800;text-decoration:none;">${escHtml(m.ticker)}</a>${tierBadge}${erBadge}
        ${m.company ? `<div style="font-size:10px;color:#64748b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(m.company)}</div>` : ""}
      </td>
      <td style="padding:7px 6px;vertical-align:middle;font-size:11px;color:#334155;">
        <strong style="color:#0f172a;">${escHtml(m.theme)}</strong> <span style="color:#94a3b8;">·</span> ${escHtml(m.layer)}
      </td>
      <td style="padding:7px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:${m.adr != null && m.adr >= 4 ? "#0e7490" : "#475569"};">${m.adr != null ? `${m.adr.toFixed(1)}%` : "—"}</td>
      <td style="padding:7px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;color:${chgColor};">${escHtml(fmtPct(m.chg, 2))}${dollarSub}</td>
      <td style="padding:7px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;color:${zvrColor};">${m.zvr != null ? `${m.zvr.toFixed(2)}x` : "—"}</td>
      <td style="padding:7px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;color:${crColor};">${m.cr != null ? `${m.cr}%` : "—"}</td>
      <td style="padding:7px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;color:${m.rs >= 90 ? "#15803d" : "#334155"};">${m.rs}</td>
      <td style="padding:7px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#475569;">${escHtml(epsStr)}</td>
      <td style="padding:7px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:${m.off52 != null && m.off52 >= -5 ? "#15803d" : "#64748b"};">${escHtml(fmtPct(m.off52))}</td>
      <td style="padding:7px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:800;color:${m.score >= 70 ? "#b45309" : "#0f172a"};">${m.score.toFixed(1)}</td>
    </tr>`;
  }).join("");

  const fadedHtml = delta?.fadedBreakouts?.length ? `
    <div style="margin-top:10px;padding:8px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;font-size:11px;color:#991b1b;">
      <strong>Faded / Squatted since last hour:</strong>
      ${delta.fadedBreakouts.map((f) => `<a href="${tLink(f.ticker)}" style="color:#991b1b;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;text-decoration:none;">${escHtml(f.ticker)}</a> (${f.chg != null ? escHtml(fmtPct(f.chg, 1)) : "—"}, ${escHtml(f.reason)})`).join(" · ")}
    </div>` : "";

  const catalystItems = movers.slice(0, 8).map((m) => {
    const liveH = headlines instanceof Map ? headlines.get(m.ticker) : headlines?.[m.ticker];
    const items = liveH?.length
      ? liveH.map((h) => `${escHtml(h.title)}${h.source ? ` <span style="color:#64748b;">(${escHtml(h.source)})</span>` : ""}`)
      : (m.pipelineNews || []).map((t) => escHtml(t));
    return `<li style="margin-bottom:6px;line-height:1.45;">
      <a href="${tLink(m.ticker)}" style="color:#0f172a;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;text-decoration:none;">${escHtml(m.ticker)}</a>
      <span style="color:#64748b;">(${escHtml(m.theme)} · ${escHtml(fmtPct(m.chg))}, ZVR ${m.zvr != null ? `${m.zvr.toFixed(2)}x` : "—"}, RS ${m.rs}):</span>
      ${items.length ? items.join(" &nbsp;|&nbsp; ") : `<em style="color:#94a3b8;">No live headline returned</em>`}
    </li>`;
  }).join("");

  // Today's Intraday Theme Money Flow
  const themeFlowHtml = (() => {
    if (!themeFlow?.hottest?.length) return "";
    const row = (t, isHot) => `<tr style="border-bottom:1px solid #e2e8f0;">
      <td style="padding:5px 6px;font-weight:700;color:#0f172a;">${escHtml(t.theme)}</td>
      <td style="padding:5px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:800;color:${t.avgChg >= 0 ? "#15803d" : "#dc2626"};">${escHtml(fmtPct(t.avgChg, 2))}</td>
      <td style="padding:5px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#475569;">${t.pctGreen}% <span style="color:#94a3b8;">(${t.count})</span></td>
      <td style="padding:5px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:${t.breakouts > 0 ? "#b45309" : "#94a3b8"};font-weight:${t.breakouts > 0 ? "700" : "400"};">${t.breakouts || "—"}</td>
      <td style="padding:5px 6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:${isHot ? "#15803d" : "#64748b"};">${t.topMover ? `<a href="${tLink(t.topMover.ticker)}" style="color:inherit;text-decoration:none;font-weight:700;">${escHtml(t.topMover.ticker)}</a> ${escHtml(fmtPct(t.topMover.chg, 1))}` : "—"}</td>
    </tr>`;
    const hotRows = themeFlow.hottest.map((t) => row(t, true)).join("");
    const coldRows = (themeFlow.coldest || []).map((t) => row(t, false)).join("");
    return `
      <h2 style="margin:20px 0 8px;font-size:15px;color:#0f172a;">3. Today&apos;s Intraday Theme Money Flow</h2>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr style="background:#f8fafc;border-bottom:2px solid #cbd5e1;color:#475569;font-size:10px;text-transform:uppercase;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
            <th style="padding:6px;text-align:left;">Theme</th>
            <th style="padding:6px;text-align:right;">Avg Chg%</th>
            <th style="padding:6px;text-align:right;">% Green</th>
            <th style="padding:6px;text-align:right;">BOs</th>
            <th style="padding:6px;text-align:left;">Top Mover</th>
          </tr></thead>
          <tbody>
            ${hotRows}
            ${coldRows ? `<tr><td colspan="5" style="padding:4px 6px;background:#fef2f2;font-size:10px;font-weight:700;color:#991b1b;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase;">Coldest Themes Today</td></tr>${coldRows}` : ""}
          </tbody>
        </table>
      </div>`;
  })();

  // Leader Damage / Distribution Watch
  const damageHtml = (() => {
    const dmg = leaderDamage?.damagedLeaders || [];
    const warns = leaderDamage?.warnLayers || [];
    if (!dmg.length && !warns.length) {
      return `<div style="margin-top:18px;padding:10px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:12px;color:#166534;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
        ✅ <strong>Leader Damage Watch:</strong> 0 RS 90+ leaders down ≥3% on heavy volume.
      </div>`;
    }
    const items = dmg.map((d) => `<tr style="border-bottom:1px solid #fecaca;">
      <td style="padding:5px 6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:800;"><a href="${tLink(d.ticker)}" style="color:#991b1b;text-decoration:none;">${escHtml(d.ticker)}</a></td>
      <td style="padding:5px 6px;font-size:11px;color:#7f1d1d;">${escHtml(d.theme)} · ${escHtml(d.layer)}</td>
      <td style="padding:5px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:800;color:#dc2626;">${escHtml(fmtPct(d.chg, 2))}</td>
      <td style="padding:5px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;color:#991b1b;">${d.zvr != null ? `${d.zvr.toFixed(2)}x` : "—"}</td>
      <td style="padding:5px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#7f1d1d;">${d.cr != null ? `${d.cr}%` : "—"}</td>
      <td style="padding:5px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#7f1d1d;">${d.rs}</td>
    </tr>`).join("");
    const warnStrip = warns.length ? `<div style="margin-top:8px;font-size:11px;color:#991b1b;"><strong>Distribution / Exiting Flags in Leading Layers:</strong> ${warns.map((w) => `${escHtml(w.theme)} · ${escHtml(w.layer)} (${escHtml(w.flags.join(", "))})`).join(" · ")}</div>` : "";
    return `<div style="margin-top:18px;padding:12px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;">
      <div style="font-size:13px;font-weight:800;color:#991b1b;margin-bottom:6px;">🚨 Leader Damage / Distribution Watch <span style="font-weight:400;font-size:11px;color:#b91c1c;">(RS 90+ leaders hit hard on volume)</span></div>
      ${dmg.length ? `<table style="width:100%;border-collapse:collapse;font-size:12px;background:#ffffff;border-radius:6px;overflow:hidden;">
        <thead><tr style="background:#fee2e2;font-size:10px;color:#991b1b;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase;">
          <th style="padding:5px 6px;text-align:left;">Ticker</th>
          <th style="padding:5px 6px;text-align:left;">Theme · Layer</th>
          <th style="padding:5px 6px;text-align:right;">Chg%</th>
          <th style="padding:5px 6px;text-align:right;">ZVR</th>
          <th style="padding:5px 6px;text-align:right;">CR%</th>
          <th style="padding:5px 6px;text-align:right;">RS</th>
        </tr></thead>
        <tbody>${items}</tbody>
      </table>` : ""}
      ${warnStrip}
    </div>`;
  })();

  // On Deck (RS-Line New Highs basing near highs)
  const onDeckHtml = (() => {
    if (!onDeckRsl?.length) return "";
    const rows = onDeckRsl.map((r) => `<tr style="border-bottom:1px solid #e2e8f0;">
      <td style="padding:5px 6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:800;"><a href="${tLink(r.ticker)}" style="color:#0369a1;text-decoration:none;">${escHtml(r.ticker)}</a></td>
      <td style="padding:5px 6px;font-size:11px;color:#334155;">${escHtml(r.theme)} · ${escHtml(r.layer)}</td>
      <td style="padding:5px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#0e7490;">${r.adr != null ? `${r.adr.toFixed(1)}%` : "—"}</td>
      <td style="padding:5px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:${(r.chg ?? 0) >= 0 ? "#15803d" : "#dc2626"};">${escHtml(fmtPct(r.chg, 1))}</td>
      <td style="padding:5px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;color:#15803d;">${r.rs}</td>
      <td style="padding:5px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#475569;">${escHtml(fmtPct(r.off52, 1))}</td>
    </tr>`).join("");
    const marginStyle = isPremarket ? "margin-bottom:18px;" : "margin-top:18px;";
    return `<div style="${marginStyle}padding:12px 14px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;">
      <div style="font-size:13px;font-weight:800;color:#075985;margin-bottom:6px;">🔵 On Deck — RS-Line New Highs Basing Near Highs <span style="font-weight:400;font-size:11px;color:#0284c7;">(Watch for next breakout)</span></div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;background:#ffffff;border-radius:6px;overflow:hidden;">
        <thead><tr style="background:#e0f2fe;font-size:10px;color:#075985;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase;">
          <th style="padding:5px 6px;text-align:left;">Ticker</th>
          <th style="padding:5px 6px;text-align:left;">Theme · Layer</th>
          <th style="padding:5px 6px;text-align:right;">ADR</th>
          <th style="padding:5px 6px;text-align:right;">Chg%</th>
          <th style="padding:5px 6px;text-align:right;">RS</th>
          <th style="padding:5px 6px;text-align:right;">Off 52wH</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  })();

  // Quick Copy (TradingView) monospace strip
  const quickCopyHtml = (() => {
    const tvLists = buildTradingViewLists({ zangerMovers: movers, onDeckRsl });
    if (!tvLists.length) return "";
    const rows = tvLists.map((item) => `
      <div style="margin-top:6px;">
        <div style="font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escHtml(item.label)}</div>
        <div style="margin-top:2px;padding:6px 8px;background:#ffffff;border:1px solid #e2e8f0;border-radius:5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#0f172a;word-break:break-all;user-select:all;">${escHtml(item.tickers)}</div>
      </div>`).join("");
    return `<div style="margin-top:18px;padding:12px 14px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;">
      <div style="font-size:13px;font-weight:800;color:#0f172a;">📋 Quick Copy (TradingView)</div>
      ${rows}
    </div>`;
  })();

  const layerRows = [...(leadingLayers || []), ...(emergingLayers || [])].slice(0, 10).map((l) => {
    const st = l.st === "lead" ? "🟢 Leading" : "🔵 Emerging";
    const w1 = l.now - (l.w1 ?? l.now);
    const fl = (l.flags || []).map((x) => (Array.isArray(x) ? x[0] : x)).join(", ") || "—";
    return `<tr style="border-bottom:1px solid #e2e8f0;">
      <td style="padding:5px 6px;font-weight:600;color:#0f172a;">${escHtml(l.theme)}</td>
      <td style="padding:5px 6px;color:#334155;">${escHtml(l.name ?? l.layer)}</td>
      <td style="padding:5px 6px;font-size:11px;">${st}</td>
      <td style="padding:5px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;">${l.now ?? l.rank}</td>
      <td style="padding:5px 6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:${w1 >= 0 ? "#15803d" : "#dc2626"};">${w1 >= 0 ? "+" : ""}${w1}</td>
      <td style="padding:5px 6px;font-size:11px;color:#64748b;">${escHtml(fl)}</td>
    </tr>`;
  }).join("");

  const goToHtml = (() => {
    if (isPremarket || !goToAnalysis || !goToAnalysis.totalMatched) return "";
    const gc = goToAnalysis.gradeCounts || {};
    const gradeBadge = (grade, score) => {
      const style = grade === "A+"
        ? "background:#dcfce7;color:#166534;border:1px solid #22c55e;"
        : grade === "A"
          ? "background:#cffafe;color:#155e75;border:1px solid #06b6d4;"
          : grade === "B"
            ? "background:#fef3c7;color:#92400e;border:1px solid #f59e0b;"
            : "background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;";
      return `<span style="${style}font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;font-weight:800;padding:1px 5px;border-radius:4px;white-space:nowrap;">${escHtml(grade)} ${score}</span>`;
    };
    const clusterCards = (goToAnalysis.themeClusters || []).slice(0, 6).map((c) => {
      const chgCol = c.avgChg == null ? "#64748b" : c.avgChg >= 0 ? "#15803d" : "#dc2626";
      const topTks = (c.topTickers || []).slice(0, 5).map((t) =>
        `<a href="${tLink(t.ticker)}" style="color:#0f172a;text-decoration:none;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#f8fafc;border:1px solid #cbd5e1;border-radius:4px;padding:1px 5px;font-size:11px;margin-right:4px;display:inline-block;">${escHtml(t.ticker)} <span style="color:${t.grade === "A+" ? "#15803d" : t.grade === "A" ? "#0e7490" : "#64748b"};">${escHtml(t.grade)}</span></a>`
      ).join("");
      const catLines = (c.catalysts || []).slice(0, 2).map((h) =>
        `<div style="font-size:11px;color:#475569;margin-top:3px;"><strong>${escHtml(h.ticker)}:</strong> ${escHtml(h.title)}${h.source ? ` <span style="color:#94a3b8;">(${escHtml(h.source)})</span>` : ""}</div>`
      ).join("");
      return `<div style="padding:10px 12px;margin-bottom:8px;background:#f8fafc;border:1px solid #e2e8f0;border-left:3px solid ${c.aPlusACount > 0 ? "#16a34a" : "#0ea5e9"};border-radius:6px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
          <strong style="font-size:13px;color:#0f172a;">${escHtml(c.theme)} <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:#475569;">(${c.count} ${c.count === 1 ? "name" : "names"}${c.aPlusACount ? ` · ${c.aPlusACount} A+/A` : ""})</span></strong>
          <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:${chgCol};font-weight:700;">avg ${escHtml(fmtPct(c.avgChg, 1))}${c.breakoutCount ? ` · ${c.breakoutCount} BO` : ""}${c.pp2Count ? ` · ${c.pp2Count} PP2+` : ""}</span>
        </div>
        <div style="font-size:12px;color:#334155;margin-top:4px;line-height:1.45;"><strong>Why:</strong> ${escHtml(c.aiWhy || c.why)}</div>
        <div style="margin-top:5px;">${topTks}</div>
        ${catLines}
      </div>`;
    }).join("");

    const leaderRows = (goToAnalysis.leaders || []).slice(0, 15).map((m) => {
      const chgCol = m.chg == null ? "#64748b" : m.chg >= 0 ? "#15803d" : "#dc2626";
      const logos = `${m.isBreakout ? "🔥" : m.qualifiesZanger ? "⚡" : ""}${m.tier === "lead" ? "⭐" : m.tier === "emerg" ? "🌱" : ""}${m.inAdr5Liq ? "💧" : ""}`;
      return `<tr style="border-bottom:1px solid #e2e8f0;">
        <td style="padding:6px;">${gradeBadge(m.grade, m.aPlusScore)}</td>
        <td style="padding:6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;"><a href="${tLink(m.ticker)}" style="color:#0f172a;text-decoration:none;">${escHtml(m.ticker)}</a>${logos ? ` <span style="font-size:10px;">${logos}</span>` : ""}</td>
        <td style="padding:6px;font-size:11px;color:#334155;"><strong>${escHtml(m.theme)}</strong> · <span style="color:#64748b;">${escHtml(m.layer)}</span></td>
        <td style="padding:6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:${chgCol};font-weight:700;">${escHtml(fmtPct(m.chg, 1))}</td>
        <td style="padding:6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;">${m.thrust != null ? `${m.thrust > 0 ? "+" : ""}${m.thrust.toFixed(1)}` : "—"}</td>
        <td style="padding:6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${m.zvr != null ? `${m.zvr.toFixed(1)}x` : "—"}</td>
        <td style="padding:6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${m.cr != null ? `${m.cr}%` : "—"}</td>
        <td style="padding:6px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;">${m.rs ?? "—"}</td>
        <td style="padding:6px;font-size:11px;color:#475569;">${m.topHeadline ? escHtml(m.topHeadline) : (m.ppCount >= 2 ? `PP${m.ppCount}${m.emaStack ? " · EMA Stack" : ""}` : m.emaStack ? "EMA Stack" : "—")}</td>
      </tr>`;
    }).join("");

    return `<div style="margin-top:22px;padding-top:16px;border-top:2px solid #cbd5e1;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
        <h2 style="margin:0;font-size:15px;color:#0f172a;">★ Go-To Screen: Theme Clusters &amp; Leading Tickers <span style="font-weight:400;font-size:12px;color:#64748b;">(${goToAnalysis.totalMatched} matched · ${gc["A+"] || 0} A+ · ${gc.A || 0} A · ${gc.B || 0} B)</span></h2>
        <a href="${url}/?preset=goto" style="font-size:11px;color:#0284c7;text-decoration:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;">Open Go-To Screen →</a>
      </div>
      ${clusterCards}
      ${leaderRows ? `<div style="overflow-x:auto;margin-top:10px;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="background:#f8fafc;border-bottom:2px solid #cbd5e1;color:#475569;font-size:10px;text-transform:uppercase;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
              <th style="padding:6px;text-align:left;">Grade</th>
              <th style="padding:6px;text-align:left;">Ticker</th>
              <th style="padding:6px;text-align:left;">Theme · Layer</th>
              <th style="padding:6px;text-align:right;">Chg%</th>
              <th style="padding:6px;text-align:right;">Thr</th>
              <th style="padding:6px;text-align:right;">ZVR</th>
              <th style="padding:6px;text-align:right;">CR%</th>
              <th style="padding:6px;text-align:right;">RS</th>
              <th style="padding:6px;text-align:left;">Catalyst / Footprint</th>
            </tr>
          </thead>
          <tbody>${leaderRows}</tbody>
        </table>
      </div>` : ""}
    </div>`;
  })();

  const holdRateKpi = delta?.holdRate
    ? ` &nbsp;·&nbsp; Hold Rate <strong style="color:${delta.holdRate.pct >= 70 ? "#4ade80" : delta.holdRate.pct >= 50 ? "#fbbf24" : "#f87171"};">${delta.holdRate.holding}/${delta.holdRate.totalToday} (${delta.holdRate.pct}%)</strong>`
    : "";

  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:16px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <div style="max-width:860px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #cbd5e1;">
    <div style="background:#0f172a;color:#f8fafc;padding:18px 20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div>
          <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${ph.accent};font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;">ThemePulse · ${escHtml(ph.label)}</div>
          <h1 style="margin:4px 0 0;font-size:20px;font-weight:800;color:#ffffff;">${escHtml(stamp?.pretty || "")}</h1>
          <div style="margin-top:3px;font-size:11px;color:#94a3b8;">${escHtml(ph.subtitle)}</div>
        </div>
        <a href="${url}/?view=brief" style="display:inline-block;background:#22c55e;color:#052e16;font-weight:800;font-size:12px;padding:9px 14px;border-radius:6px;text-decoration:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">Open Live Brief →</a>
      </div>
      <div style="margin-top:12px;font-size:12px;color:#cbd5e1;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
        <strong style="color:#fbbf24;">${bos.length}</strong> Breakouts${delta?.newBreakouts?.length ? ` (<strong style="color:#38bdf8;">${delta.newBreakouts.length} NEW</strong>)` : ""} &nbsp;·&nbsp;
        <strong style="color:#4ade80;">${movers.length}</strong> All Movers &nbsp;·&nbsp;
        <strong style="color:#38bdf8;">${leadCount}</strong> Leading Layers &nbsp;·&nbsp;
        <strong style="color:#a78bfa;">${emergCount}</strong> Emerging${holdRateKpi}
      </div>
    </div>

    <div style="padding:18px 20px;">
      ${futuresHtml}
      ${isPremarket ? epHtml : ""}
      ${isPremarket ? onDeckHtml : ""}
      ${marketSectionHtml}
      ${portfolioHtml}
      ${portfolioEarningsHtml}
      ${closeWrapHtml}
      ${ph.id === "open" ? epHtml : ""}

      <h2 style="margin:0 0 10px;font-size:15px;color:#0f172a;">1. Breakouts &amp; Volume Movers <span style="font-weight:400;font-size:12px;color:#64748b;">(Zanger · SB 4% · SB $ · QMAG)</span></h2>
      ${movers.length === 0
        ? `<p style="color:#64748b;font-size:13px;background:#f8fafc;padding:14px;border-radius:6px;border:1px solid #e2e8f0;">No stocks currently pass breakout or ZVR ≥ 1.5x volume surge criteria.</p>`
        : `<div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead>
              <tr style="background:#f8fafc;border-bottom:2px solid #cbd5e1;color:#475569;font-size:10px;text-transform:uppercase;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
                <th style="padding:7px 6px;text-align:left;">Sig</th>
                <th style="padding:7px 6px;text-align:left;">Ticker</th>
                <th style="padding:7px 6px;text-align:left;">Theme · Layer</th>
                <th style="padding:7px 6px;text-align:right;">ADR</th>
                <th style="padding:7px 6px;text-align:right;">Chg%</th>
                <th style="padding:7px 6px;text-align:right;">ZVR</th>
                <th style="padding:7px 6px;text-align:right;">CR%</th>
                <th style="padding:7px 6px;text-align:right;">RS</th>
                <th style="padding:7px 6px;text-align:right;">EPS</th>
                <th style="padding:7px 6px;text-align:right;">Off 52wH</th>
                <th style="padding:7px 6px;text-align:right;">Score</th>
              </tr>
            </thead>
            <tbody>${moverRows}</tbody>
          </table>
        </div>`}
      ${fadedHtml}

      ${movers.length > 0 ? `
      <h2 style="margin:20px 0 8px;font-size:15px;color:#0f172a;">2. Catalyst Check <span style="font-weight:400;font-size:12px;color:#64748b;">(Top Movers)</span></h2>
      <ul style="margin:0;padding-left:18px;font-size:12px;color:#334155;">${catalystItems}</ul>` : ""}

      ${ph.id !== "open" && !isPremarket && epHtml ? `<div style="margin-top:18px;">${epHtml}</div>` : ""}
      ${themeFlowHtml}

      ${layerRows ? `
      <h2 style="margin:20px 0 8px;font-size:15px;color:#0f172a;">4. Multi-Week Leading Themes &amp; Layers</h2>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="background:#f8fafc;border-bottom:2px solid #cbd5e1;color:#475569;font-size:10px;text-transform:uppercase;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
              <th style="padding:6px;text-align:left;">Theme</th>
              <th style="padding:6px;text-align:left;">Layer</th>
              <th style="padding:6px;text-align:left;">Status</th>
              <th style="padding:6px;text-align:right;">Rank</th>
              <th style="padding:6px;text-align:right;">1W Δ</th>
              <th style="padding:6px;text-align:left;">Flags</th>
            </tr>
          </thead>
          <tbody>${layerRows}</tbody>
        </table>
      </div>` : ""}

      ${damageHtml}
      ${!isPremarket ? onDeckHtml : ""}
      ${goToHtml}
      ${quickCopyHtml}
    </div>

    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:12px 20px;font-size:11px;color:#64748b;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
      ${escHtml(mode || "")} &nbsp;·&nbsp; Session ${escHtml(clock?.session || "")} &nbsp;·&nbsp; Pipeline ${escHtml(pipelineDate || "unknown")}
    </div>
  </div>
</body>
</html>`;
}

export function buildMarkdown({
  stamp,
  mode,
  clock,
  pipelineDate,
  leadingLayers,
  emergingLayers,
  zangerMovers,
  themeLeaders,
  headlines,
  market,
  phase,
  delta,
  portfolioAlerts,
  portfolioEarnings,
  epMovers,
  themeFlow,
  leaderDamage,
  onDeckRsl,
  goToAnalysis = null,
}) {
  const ph = phase || getBriefingPhase(stamp);
  const isPremarket = ph.id === "premarket";
  const futures = Array.isArray(market?.futures) ? market.futures : [];
  const lines = [];
  lines.push(`# ThemePulse ${ph.label} — ${stamp.pretty}`);
  lines.push("");
  lines.push(`- **Mode**: ${mode}`);
  lines.push(`- **Session**: ${clock.session} (${clock.rth ? "RTH Live" : "Outside RTH"}) · **Pipeline**: ${pipelineDate || "unknown"}`);
  lines.push(`- **Summary**: ${leadingLayers.length} leading layers · ${emergingLayers.length} confirmed emerging layers · ${zangerMovers.length} movers${delta?.holdRate ? ` · Hold rate ${delta.holdRate.holding}/${delta.holdRate.totalToday} (${delta.holdRate.pct}%)` : ""}`);
  lines.push("");

  if (isPremarket && futures.length) {
    lines.push("## Overnight Futures & Macro");
    lines.push("");
    lines.push("| Contract | Price | Chg% |");
    lines.push("|----------|------:|-----:|");
    for (const f of futures) {
      lines.push(`| **${f.name}** | ${fmtPrice(f.price)} | ${f.changePct != null ? fmtPct(f.changePct, 2) : "—"} |`);
    }
    lines.push("");
  }

  const appendEpMd = () => {
    if (!epMovers?.length) return;
    lines.push(isPremarket ? "## EP / Pre-Market Gappers & Gap-and-Go Movers" : "## EP / Gap-and-Go Movers");
    lines.push("");
    for (const e of epMovers) {
      lines.push(`- **[${e.category}] ${e.ticker}** ${fmtPct(e.chg, 1)} (vol ${fmtVol(e.volume)})${e.headline ? ` — ${e.headline}` : ""}`);
    }
    lines.push("");
  };

  const appendOnDeckMd = (heading) => {
    if (!onDeckRsl?.length) return;
    lines.push(heading);
    lines.push("");
    for (const r of onDeckRsl) {
      lines.push(`- **${r.ticker}** (${r.theme} · ${r.layer}): RS ${r.rs}, ADR ${r.adr != null ? `${r.adr.toFixed(1)}%` : "—"}, Chg ${fmtPct(r.chg, 1)}, Off 52wH ${fmtPct(r.off52, 1)}`);
    }
    lines.push("");
  };

  if (isPremarket) {
    appendEpMd();
    appendOnDeckMd("## On Deck — RS-Line New Highs Basing Near Highs");
  }

  if (market) {
    lines.push("## 0. General Market & Commentary");
    lines.push("");
    if (!isPremarket && futures.length) {
      lines.push(`- **Overnight Futures & Macro**: ${futures.map((f) => `${f.name} ${f.changePct != null ? fmtPct(f.changePct, 2) : "—"}`).join(" · ")}`);
      lines.push("");
    }
    if (market.indices?.length) {
      lines.push("| Index | Price | Chg% | CR% | MA Posture |");
      lines.push("|-------|------:|-----:|----:|------------|");
      for (const i of market.indices) {
        lines.push(`| **${i.ticker}** (${i.name}) | ${i.price != null ? i.price.toFixed(2) : "—"} | ${i.change != null ? fmtPct(i.change, 2) : "—"} | ${i.cr != null ? `${i.cr}%` : "—"} | ${i.maStatus || "—"} |`);
      }
      lines.push("");
    }
    for (const c of market.commentary || []) lines.push(`- ${c}`);
    lines.push("");
  }

  if (portfolioAlerts?.alerts?.length) {
    lines.push("## Portfolio & Watchlist Pulse");
    lines.push("");
    for (const a of portfolioAlerts.alerts) {
      lines.push(`- **[${a.list}] ${a.ticker}** (${fmtPct(a.chg, 2)}, ZVR ${a.zvr != null ? `${a.zvr.toFixed(1)}x` : "—"}, CR ${a.cr != null ? `${a.cr}%` : "—"}): ${a.tags.map((t) => t.label).join(" · ")}`);
    }
    lines.push("");
  }

  if (portfolioEarnings?.length) {
    lines.push("## Upcoming Earnings (Portfolio & Watchlist · Next 10d)");
    lines.push("");
    for (const e of portfolioEarnings) {
      const when = e.days === 0 ? "Today" : `in ${e.days}d`;
      const detail = [e.display, e.timing].filter(Boolean).join(" ");
      lines.push(`- **[${e.list}] ${e.ticker}** — ${when}${detail ? ` (${detail})` : ""}`);
    }
    lines.push("");
  }

  if (!isPremarket) appendEpMd();

  lines.push("## 1. Breakouts & Intraday Volume Movers (Zanger · Stockbee 4% / $ · Qullamaggie)");
  lines.push("");
  if (!zangerMovers.length) {
    lines.push("_No stocks currently pass Zanger, Stockbee 4%/$, Qullamaggie breakout, or ZVR ≥ 1.5x volume surge criteria._");
  } else {
    lines.push("| Signal | Ticker | Theme · Layer | ADR | Chg% | ZVR | CR% | RS | EPS | Off 52wH | Score |");
    lines.push("|--------|--------|---------------|----:|-----:|----:|----:|---:|----:|---------:|------:|");
    for (const m of zangerMovers.slice(0, 25)) {
      const newTag = m.isNew ? "🆕 " : "";
      const sig = `${newTag}${m.breakoutTypes?.length ? `🔥 ${m.breakoutTypes.join("+")}` : m.rsl ? "🔵 RSL" : "⚡ VOL"}`;
      const tierBadge = m.tier === "lead" ? " ⭐" : m.tier === "emerg" ? " 🌱" : "";
      const erTag = m.earningsDays != null && m.earningsDays >= 0 && m.earningsDays <= 5 ? ` ⚠️ER${m.earningsDays}d` : "";
      const epsStr = m.eps != null ? `${m.eps}${m.epsAccel ? "▲" : ""}` : "—";
      lines.push(
        `| ${sig} | **${m.ticker}**${tierBadge}${erTag} | ${m.theme} · ${m.layer} | ${m.adr != null ? m.adr.toFixed(1) + "%" : "—"} | ${fmtPct(m.chg)} | **${m.zvr != null ? m.zvr.toFixed(2) + "x" : "—"}** | ${m.cr != null ? m.cr + "%" : "—"} | ${m.rs} | ${epsStr} | ${fmtPct(m.off52)} | ${m.score.toFixed(1)} |`
      );
    }
  }
  lines.push("");

  if (delta?.fadedBreakouts?.length) {
    lines.push(`**Faded / Squatted since last hour:** ${delta.fadedBreakouts.map((f) => `${f.ticker} (${fmtPct(f.chg, 1)}, ${f.reason})`).join(" · ")}`);
    lines.push("");
  }

  if (zangerMovers.length) {
    lines.push("### Catalyst Check (Top Movers)");
    lines.push("");
    for (const m of zangerMovers.slice(0, 8)) {
      const liveH = headlines instanceof Map ? headlines.get(m.ticker) : headlines?.[m.ticker];
      const items = liveH?.length ? liveH.map((h) => `${h.title}${h.source ? ` _(${h.source})_` : ""}`) : m.pipelineNews;
      lines.push(`- **${m.ticker}** (${m.theme} · ${m.layer}, ${fmtPct(m.chg)}, ZVR ${m.zvr?.toFixed(2)}x, RS ${m.rs}): ${items?.length ? items.join(" | ") : "_No live headline returned — check news/earnings_"}`);
    }
    lines.push("");
  }

  if (themeFlow?.hottest?.length) {
    lines.push("## 2. Today's Intraday Theme Money Flow");
    lines.push("");
    lines.push("| Theme | Avg Chg% | % Green | BOs | Top Mover |");
    lines.push("|-------|---------:|--------:|----:|-----------|");
    for (const t of themeFlow.hottest) {
      lines.push(`| ${t.theme} | ${fmtPct(t.avgChg, 2)} | ${t.pctGreen}% (${t.count}) | ${t.breakouts || "—"} | ${t.topMover ? `${t.topMover.ticker} ${fmtPct(t.topMover.chg, 1)}` : "—"} |`);
    }
    if (themeFlow.coldest?.length) {
      for (const t of themeFlow.coldest) {
        lines.push(`| ❄️ ${t.theme} | ${fmtPct(t.avgChg, 2)} | ${t.pctGreen}% (${t.count}) | ${t.breakouts || "—"} | ${t.topMover ? `${t.topMover.ticker} ${fmtPct(t.topMover.chg, 1)}` : "—"} |`);
      }
    }
    lines.push("");
  }

  lines.push("## 3. Leading Themes & Layers");
  lines.push("");
  if (!leadingLayers.length) {
    lines.push("_No layers currently meet the rank ≥ 88 leadership threshold._");
  } else {
    lines.push("| Theme | Layer | Status | Rank | 1W Δ | 1M Δ | Held (20d) | >50d | RS≥80 | Flags |");
    lines.push("|-------|-------|--------|-----:|-----:|-----:|-----------:|-----:|------:|-------|");
    for (const l of [...leadingLayers, ...emergingLayers].slice(0, 15)) {
      const st = l.st === "lead" ? "🟢 Leading" : "🔵 Emerging";
      const fl = l.flags.map(([k]) => k).join(", ") || "—";
      lines.push(
        `| ${l.theme} | ${l.name} | ${st} | ${l.now} | ${l.now - (l.w1 ?? l.now) >= 0 ? "+" : ""}${l.now - (l.w1 ?? l.now)} | ${l.now - (l.m1 ?? l.now) >= 0 ? "+" : ""}${l.now - (l.m1 ?? l.now)} | ${l.held.held}/${l.held.of} | ${l.stats?.a50 ?? "—"}% | ${l.stats?.rs80 ?? "—"}% | ${fl} |`
      );
    }
  }
  lines.push("");

  if (leaderDamage?.damagedLeaders?.length) {
    lines.push("## 4. Leader Damage / Distribution Watch");
    lines.push("");
    for (const d of leaderDamage.damagedLeaders) {
      lines.push(`- **${d.ticker}** (${d.theme} · ${d.layer}): ${fmtPct(d.chg, 2)}, ZVR ${d.zvr != null ? `${d.zvr.toFixed(2)}x` : "—"}, CR ${d.cr != null ? `${d.cr}%` : "—"}, RS ${d.rs}`);
    }
    lines.push("");
  }

  if (!isPremarket) appendOnDeckMd("## 5. On Deck — RS-Line New Highs Basing Near Highs");

  if (themeLeaders?.length) {
    lines.push("## 6. Top Leading Stocks in Leading Themes (Core Focus List)");
    lines.push("");
    lines.push("| Ticker | Theme · Layer | ADR | Chg% | ZVR | RS | EPS | Off 52wH | Notes |");
    lines.push("|--------|---------------|----:|-----:|----:|---:|----:|---------:|-------|");
    for (const m of themeLeaders.slice(0, 20)) {
      const epsStr = m.eps != null ? `${m.eps}${m.epsAccel ? "▲" : ""}` : "—";
      const notes = [m.isBreakout && "Breakout", !m.isBreakout && m.qualifiesZanger && "ZVR Surge", m.rsl && "RS Line New High"].filter(Boolean).join(", ") || "—";
      lines.push(
        `| **${m.ticker}** ⭐ | ${m.theme} · ${m.layer} | ${m.adr != null ? m.adr.toFixed(1) + "%" : "—"} | ${fmtPct(m.chg)} | ${m.zvr != null ? m.zvr.toFixed(2) + "x" : "—"} | ${m.rs} | ${epsStr} | ${fmtPct(m.off52)} | ${notes} |`
      );
    }
    lines.push("");
  }

  if (!isPremarket && goToAnalysis && goToAnalysis.totalMatched > 0) {
    const gc = goToAnalysis.gradeCounts || {};
    lines.push(`## 7. ★ Go-To Screen — Leading Tickers by Grade & Theme Clusters`);
    lines.push("");
    lines.push(`- **Pool**: ${goToAnalysis.totalMatched} fresh liquid growth leaders · **Grades**: ${gc["A+"] || 0} A+ · ${gc.A || 0} A · ${gc.B || 0} B · ${gc.C || 0} C`);
    lines.push("");
    if (goToAnalysis.themeClusters?.length) {
      lines.push("### Theme Cluster Breakdown (Why They're Leading)");
      lines.push("");
      for (const c of goToAnalysis.themeClusters.slice(0, 8)) {
        const topStr = (c.topTickers || []).slice(0, 5).map((t) => `${t.ticker} (${t.grade} ${t.aPlusScore})`).join(", ");
        lines.push(`- **${c.theme} (${c.count} ${c.count === 1 ? "name" : "names"} · ${c.aPlusACount} A+/A · avg ${fmtPct(c.avgChg, 1)})** — **Why:** ${c.aiWhy || c.why}`);
        lines.push(`  - Leaders: ${topStr}`);
        for (const h of (c.catalysts || []).slice(0, 2)) {
          lines.push(`  - Catalyst (${h.ticker}): ${h.title}${h.source ? ` _(${h.source})_` : ""}`);
        }
      }
      lines.push("");
    }
    if (goToAnalysis.leaders?.length) {
      lines.push("### Leading Go-To Tickers (Descending Grade)");
      lines.push("");
      lines.push("| Grade | Ticker | Theme · Layer | Chg% | Thr | ZVR | CR% | RS | PP | Catalyst / Notes |");
      lines.push("|-------|--------|---------------|-----:|----:|----:|----:|---:|---:|------------------|");
      for (const m of goToAnalysis.leaders.slice(0, 20)) {
        const logos = `${m.isBreakout ? "🔥" : m.qualifiesZanger ? "⚡" : ""}${m.tier === "lead" ? "⭐" : m.tier === "emerg" ? "🌱" : ""}${m.inAdr5Liq ? "💧" : ""}`;
        const note = m.topHeadline || (m.emaStack ? "EMA Stack" : "—");
        lines.push(
          `| **${m.grade} ${m.aPlusScore}** | **${m.ticker}**${logos ? ` ${logos}` : ""} | ${m.theme} · ${m.layer} | ${fmtPct(m.chg, 1)} | ${m.thrust != null ? `${m.thrust > 0 ? "+" : ""}${m.thrust.toFixed(1)}` : "—"} | ${m.zvr != null ? `${m.zvr.toFixed(1)}x` : "—"} | ${m.cr != null ? `${m.cr}%` : "—"} | ${m.rs ?? "—"} | ${m.ppCount >= 2 ? `PP${m.ppCount}` : "—"} | ${note} |`
        );
      }
      lines.push("");
    }
  }

  const tvLists = buildTradingViewLists({ zangerMovers, onDeckRsl });
  if (tvLists.length) {
    lines.push("## Quick Copy (TradingView)");
    lines.push("");
    for (const item of tvLists) {
      lines.push(`- **${item.label}**: \`${item.tickers}\``);
    }
    lines.push("");
  }

  return lines.join("\n");
}
