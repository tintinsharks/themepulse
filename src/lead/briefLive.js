// Pure helpers for overlaying live intraday quotes & macro data onto static
// Written Brief snapshots (public/data/briefs/brief-*.json).
import { closingRange, scoreZangerCandidate, zvrFor } from "./math.js";

export function evalPivotStatus(price, { pivot, buyZoneMax, stop } = {}) {
  if (typeof price !== "number" || !Number.isFinite(price)) return null;
  if (typeof stop === "number" && price <= stop) {
    return {
      state: "stopped",
      label: "< STOP",
      detail: `${(((price / stop) - 1) * 100).toFixed(1)}% vs stop`,
      tone: "red",
    };
  }
  if (typeof pivot === "number" && pivot > 0) {
    const pctFromPivot = ((price / pivot) - 1) * 100;
    const maxBuy = typeof buyZoneMax === "number" && buyZoneMax >= pivot ? buyZoneMax : pivot * 1.05;
    if (price >= pivot && price <= maxBuy) {
      return {
        state: "buy_zone",
        label: "IN BUY ZONE",
        detail: `+${pctFromPivot.toFixed(1)}% above pivot`,
        tone: "green",
      };
    }
    if (price > maxBuy) {
      return {
        state: "extended",
        label: "EXTENDED",
        detail: `+${pctFromPivot.toFixed(1)}% above pivot`,
        tone: "yellow",
      };
    }
    const near = pctFromPivot >= -2.0;
    return {
      state: near ? "near_pivot" : "below_pivot",
      label: `${pctFromPivot.toFixed(1)}% to pivot`,
      detail: near ? "Approaching pivot" : "Below pivot",
      tone: near ? "cyan" : "muted",
    };
  }
  return null;
}

export function matchMacroLive(item, mq) {
  if (!item?.name || !mq) return null;
  const name = String(item.name).toLowerCase();
  const tape = Array.isArray(mq.tape) ? mq.tape : [];
  const futures = Array.isArray(mq.futures) ? mq.futures : [];
  const findTape = (tk) => tape.find((x) => x?.ticker === tk);
  const findFut = (re) => futures.find((x) => re.test(String(x?.name || "")));

  const fmtChg = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
  };

  if (/\bvix\b/.test(name)) {
    const t = findTape("VIX");
    if (t?.price != null) return { value: Number(t.price).toFixed(2), change: fmtChg(t.change) };
  }
  if (/10y|tnx|treasury|yield/.test(name)) {
    const t = findTape("TNX");
    if (t?.price != null) return { value: `${Number(t.price).toFixed(2)}%`, change: fmtChg(t.change) };
  }
  if (/dxy|dollar/.test(name)) {
    const t = findTape("DXY");
    if (t?.price != null) return { value: Number(t.price).toFixed(2), change: fmtChg(t.change) };
  }
  if (/wti|crude|oil/.test(name)) {
    const f = findFut(/crude|oil/i);
    if (typeof f?.price === "number") return { value: `$${f.price.toFixed(2)}`, change: fmtChg(f.changePct) };
  }
  if (/gold/.test(name)) {
    const f = findFut(/gold/i);
    if (typeof f?.price === "number") return { value: `$${f.price.toFixed(2)}`, change: fmtChg(f.changePct) };
  }
  if (/btc|bitcoin/.test(name)) {
    const f = findFut(/btc|bitcoin/i);
    if (typeof f?.price === "number") return { value: `$${Math.round(f.price).toLocaleString()}`, change: fmtChg(f.changePct) };
  }
  return null;
}

const MACRO_LABEL = {
  vix: "VIX",
  us10yyieldpct: "10Y Yield",
  us10y: "10Y Yield",
  wticrude: "WTI Crude",
  wti: "WTI Crude",
  dxy: "DXY",
};

const fmtSignedPct = (n) => (typeof n === "number" && Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${n.toFixed(2)}%` : "");

export function normalizeWrittenBrief(brief) {
  if (!brief || typeof brief !== "object") return null;
  const rg = brief.regime && typeof brief.regime === "object" ? brief.regime : {};

  // Normalize regime.indexes: supports Array, { SPY: {...}, QQQ: {...} } map, or direct regime.spy / regime.qqq / regime.iwm keys
  const normIdx = (sym, x) => ({
    ...x,
    symbol: String(x?.symbol || x?.ticker || sym || "").toUpperCase(),
    price: x?.price ?? x?.premarket ?? x?.priorClose ?? null,
    chgPct: x?.chgPct ?? x?.changePct ?? null,
    closingRangePct: x?.closingRangePct ?? null,
    offHighPct: x?.offHighPct ?? null,
    afterHours: x?.afterHours ?? null,
    note: x?.note || x?.status || null,
  });
  let indexes = [];
  if (Array.isArray(rg.indexes)) {
    indexes = rg.indexes.filter((x) => x && typeof x === "object").map((x) => normIdx(null, x));
  } else if (rg.indexes && typeof rg.indexes === "object") {
    indexes = Object.entries(rg.indexes)
      .filter(([, v]) => v && typeof v === "object")
      .map(([k, v]) => normIdx(k, v));
  } else {
    for (const k of ["spy", "qqq", "iwm", "dia"]) {
      if (rg[k] && typeof rg[k] === "object") indexes.push(normIdx(k.toUpperCase(), rg[k]));
    }
  }

  // Normalize macroTape: supports Array or Object map ({ VIX: {...} } or { vix: 29, vixChangePct: 10 })
  let macroTape = [];
  if (Array.isArray(brief.macroTape)) {
    macroTape = brief.macroTape.filter((m) => m && typeof m === "object");
  } else if (brief.macroTape && typeof brief.macroTape === "object") {
    for (const [k, v] of Object.entries(brief.macroTape)) {
      if (/changepct|changebps/i.test(k)) continue;
      const lk = k.toLowerCase();
      const name = MACRO_LABEL[lk] || k;
      if (v && typeof v === "object") {
        const chg = v.change != null
          ? String(v.change)
          : typeof v.changePct === "number"
            ? fmtSignedPct(v.changePct)
            : typeof v.changeBps === "number"
              ? `${v.changeBps >= 0 ? "+" : ""}${v.changeBps} bps`
              : "";
        const rawVal = v.value ?? "";
        const val = typeof rawVal === "number" && /10y|yield/i.test(lk) ? `${rawVal.toFixed(2)}%` : rawVal;
        macroTape.push({
          name,
          value: val,
          change: chg,
          impact: v.impact || v.note || "",
          sourceUrl: v.sourceUrl || null,
        });
      } else if (v != null) {
        const chgKey = Object.keys(brief.macroTape).find((ck) => ck.toLowerCase() === `${lk}changepct`);
        const chgNum = chgKey ? brief.macroTape[chgKey] : null;
        macroTape.push({
          name,
          value: typeof v === "number" && /10y|yield/i.test(lk) ? `${v.toFixed(2)}%` : v,
          change: fmtSignedPct(chgNum),
          impact: "",
          sourceUrl: null,
        });
      }
    }
  }

  // Normalize focusSetups (also accepts intradayMovers when focusSetups is absent)
  const rawFocus = Array.isArray(brief.focusSetups)
    ? brief.focusSetups
    : Array.isArray(brief.intradayMovers)
      ? brief.intradayMovers
      : [];
  const focusSetups = rawFocus.filter((f) => f && typeof f === "object").map((f) => ({
    ...f,
    price: f.price ?? f.premarket ?? f.priorClose ?? null,
    baseStage: f.baseStage || f.stageTag || f.status || "",
    sizing: f.sizing || f.grade || "",
    catalyst: f.catalyst || f.groupConfirmation || f.note || f.status || "",
    sourceUrl: f.sourceUrl || f.catalystUrl || null,
  }));

  const extendedMovers = (Array.isArray(brief.extendedMovers) ? brief.extendedMovers : [])
    .filter((m) => m && typeof m === "object")
    .map((m) => ({
      ...m,
      chgPct: m.chgPct ?? m.changePct ?? null,
      price: m.price ?? m.premarket ?? null,
      catalyst: m.catalyst || m.note || "",
      sourceUrl: m.sourceUrl || m.catalystUrl || null,
    }));

  const breakdowns = (Array.isArray(brief.breakdowns) ? brief.breakdowns : [])
    .filter((b) => b && typeof b === "object")
    .map((b) => ({
      ...b,
      chgPct: b.chgPct ?? b.changePct ?? null,
      catalyst: b.catalyst || b.note || "",
      sourceUrl: b.sourceUrl || b.catalystUrl || null,
    }));

  // Normalize ThemePulse-pulled Breakouts section (accepts breakouts / zangerBreakouts / volumeMovers)
  const rawBreakouts = Array.isArray(brief.breakouts)
    ? brief.breakouts
    : Array.isArray(brief.zangerBreakouts)
      ? brief.zangerBreakouts
      : Array.isArray(brief.volumeMovers)
        ? brief.volumeMovers
        : [];
  const breakouts = rawBreakouts
    .filter((x) => x && typeof x === "object" && x.ticker)
    .map((x) => ({
      ...x,
      ticker: String(x.ticker).trim().toUpperCase(),
      types: Array.isArray(x.types)
        ? x.types.map(String)
        : Array.isArray(x.breakoutTypes)
          ? x.breakoutTypes.map(String)
          : x.type
            ? [String(x.type)]
            : [],
      price: x.price ?? x.currentPrice ?? null,
      chgPct: x.chgPct ?? x.changePct ?? null,
      zvr: x.zvr ?? x.rvol ?? null,
      thrust: x.thrust ?? null,
      cr: x.cr ?? x.closingRangePct ?? null,
      rs: x.rs ?? x.rsRank ?? null,
      layer: x.layer || x.theme || "",
      note: x.note || x.catalyst || x.status || "",
    }));

  // Normalize ThemePulse-pulled Portfolio / Watchlist / Flagged updates
  const rawPortfolio = Array.isArray(brief.portfolioUpdates)
    ? brief.portfolioUpdates
    : Array.isArray(brief.portfolioPulse)
      ? brief.portfolioPulse
      : Array.isArray(brief.portfolio)
        ? brief.portfolio
        : [];
  const portfolioUpdates = rawPortfolio
    .filter((x) => x && typeof x === "object" && x.ticker)
    .map((x) => ({
      ...x,
      ticker: String(x.ticker).trim().toUpperCase(),
      list: String(x.list || x.bucket || "PORT").toUpperCase(),
      price: x.price ?? x.currentPrice ?? null,
      chgPct: x.chgPct ?? x.changePct ?? null,
      zvr: x.zvr ?? x.rvol ?? null,
      thrust: x.thrust ?? null,
      cr: x.cr ?? x.closingRangePct ?? null,
      rs: x.rs ?? x.rsRank ?? null,
      alerts: Array.isArray(x.alerts)
        ? x.alerts.map((a) => (typeof a === "string" ? a : String(a?.label || ""))).filter(Boolean)
        : Array.isArray(x.tags)
          ? x.tags.map((a) => (typeof a === "string" ? a : String(a?.label || ""))).filter(Boolean)
          : x.alert
            ? [String(x.alert)]
            : [],
      note: x.note || x.action || x.status || "",
    }));

  // Normalize ThemePulse-pulled Layer updates (accepts array of layer rows or object { summary, leading, rotating, weakening, rows })
  const rawLayers = brief.layerUpdates ?? brief.layers ?? brief.themeUpdates ?? null;
  let layerUpdates = null;
  const normLayerRow = (l, defaultStatus = "") => {
    if (!l || typeof l !== "object") return null;
    const name = l.layer || l.name || l.theme || "";
    if (!name) return null;
    return {
      layer: String(name),
      theme: String(l.theme || ""),
      status: String(l.status || defaultStatus || ""),
      rank: l.rank ?? l.now ?? null,
      delta1w: l.delta1w ?? l.w1 ?? null,
      delta1m: l.delta1m ?? l.m1 ?? null,
      todayPct: l.todayPct ?? l.dayPct ?? l.chgPct ?? null,
      thrust: l.thrust ?? null,
      leaders: Array.isArray(l.leaders)
        ? l.leaders.map(String)
        : Array.isArray(l.tickers)
          ? l.tickers.map(String)
          : [],
      note: String(l.note || l.change || ""),
    };
  };
  if (Array.isArray(rawLayers)) {
    const rows = rawLayers.map((l) => normLayerRow(l)).filter(Boolean);
    if (rows.length) layerUpdates = { summary: "", rows };
  } else if (rawLayers && typeof rawLayers === "object") {
    const rows = [];
    if (Array.isArray(rawLayers.rows)) {
      rawLayers.rows.forEach((l) => { const r = normLayerRow(l); if (r) rows.push(r); });
    }
    if (Array.isArray(rawLayers.leading)) {
      rawLayers.leading.forEach((l) => { const r = normLayerRow(l, "Leading"); if (r) rows.push(r); });
    }
    if (Array.isArray(rawLayers.emerging)) {
      rawLayers.emerging.forEach((l) => { const r = normLayerRow(l, "Emerging"); if (r) rows.push(r); });
    }
    if (Array.isArray(rawLayers.weakening)) {
      rawLayers.weakening.forEach((l) => { const r = normLayerRow(l, "Weakening"); if (r) rows.push(r); });
    }
    if (Array.isArray(rawLayers.breakingDown)) {
      rawLayers.breakingDown.forEach((l) => { const r = normLayerRow(l, "Breaking Down"); if (r) rows.push(r); });
    }
    if (Array.isArray(rawLayers.flips)) {
      rawLayers.flips.forEach((l) => { const r = normLayerRow(l, "Status Flip"); if (r) rows.push(r); });
    }
    const summary = String(rawLayers.summary || rawLayers.note || "");
    if (rows.length || summary) layerUpdates = { summary, rows };
  }

  const posture = rg.posture || rg.stance || rg.status || null;
  const note = rg.note || [
    rg.exposurePosture || (rg.grossExposure ? `Gross Exposure ${rg.grossExposure}` : null),
    rg.maxRiskPerTrade ? `Max Risk ${rg.maxRiskPerTrade}` : null,
  ].filter(Boolean).join(" · ") || null;

  return {
    ...brief,
    regime: {
      ...rg,
      posture,
      note,
      indexes,
      breadth: rg.breadth && typeof rg.breadth === "object" && !Array.isArray(rg.breadth) ? rg.breadth : {},
    },
    macroTape,
    focusSetups,
    focusTitle: Array.isArray(brief.focusSetups) ? "Focus setups" : "Intraday movers",
    extendedMovers,
    breakdowns,
    breakouts,
    portfolioUpdates,
    layerUpdates,
    radar: Array.isArray(brief.radar) ? brief.radar : [],
    skipTraps: brief.skipTraps ?? {},
    leadingPulse: brief.leadingPulse && typeof brief.leadingPulse === "object" && !Array.isArray(brief.leadingPulse) ? brief.leadingPulse : null,
  };
}

export function collectBriefTickers(brief) {
  const nb = normalizeWrittenBrief(brief);
  if (!nb) return [];
  const set = new Set();
  const add = (t) => {
    if (typeof t === "string" && /^[A-Z][A-Z0-9.-]{0,9}$/.test(t.trim().toUpperCase())) {
      set.add(t.trim().toUpperCase());
    }
  };
  for (const x of nb.regime.indexes) add(x?.symbol);
  for (const f of nb.focusSetups) add(f?.ticker);
  for (const m of nb.extendedMovers) add(m?.ticker);
  for (const b of nb.breakdowns) add(b?.ticker);
  for (const bo of nb.breakouts) add(bo?.ticker);
  for (const p of nb.portfolioUpdates) add(p?.ticker);
  if (nb.layerUpdates?.rows) {
    for (const l of nb.layerUpdates.rows) {
      for (const tk of l.leaders || []) add(tk);
    }
  }
  return [...set];
}

const MON_MAP = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// Parse date from Finviz ("Today 09:42AM", "Nov-23-26 08:30AM", "09:42AM"),
// pipeline bracket timestamps ("[5/18/2026 9:00 PM]"), or ISO strings.
// Returns { ts: number|null, bareTime: boolean }.
export function parseHeadlineDate(raw, now = new Date()) {
  const s = String(raw || "").trim();
  if (!s) return { ts: null, bareTime: false };
  if (/^today\b/i.test(s)) return { ts: now.getTime(), bareTime: false };
  if (/^\d{1,2}:\d{2}\s*(?:AM|PM)?$/i.test(s)) return { ts: null, bareTime: true };

  // Finviz: "Nov-23-26 08:30AM" or "Nov-23-26"
  const fv = s.match(/\b([A-Za-z]{3})-(\d{1,2})-(\d{2})\b/);
  if (fv) {
    const m = MON_MAP[fv[1].toLowerCase()];
    if (m != null) {
      const yr = 2000 + Number(fv[3]);
      return { ts: Date.UTC(yr, m, Number(fv[2]), 12, 0, 0), bareTime: false };
    }
  }

  // Bracketed or inline US numeric date: "[5/18/2026 9:00 PM]" or "11/23/2026"
  const us = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (us) {
    return { ts: Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2]), 12, 0, 0), bareTime: false };
  }

  // ISO date: "2026-11-23"
  const iso = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    return { ts: Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12, 0, 0), bareTime: false };
  }

  const parsed = Date.parse(s);
  return { ts: Number.isFinite(parsed) ? parsed : null, bareTime: false };
}

// Keep only headlines within maxDays of `now`. Finviz news tables list the date
// on the first headline of a day and bare times ("09:15AM") on subsequent rows,
// so bare times inherit the most recent prior row's date.
export function filterRecentHeadlines(items, now = new Date(), maxDays = 14) {
  if (!Array.isArray(items) || !items.length) return [];
  const cutoff = now.getTime() - maxDays * 86400000;
  let lastTs = null;
  const out = [];
  for (const item of items) {
    const isStr = typeof item === "string";
    const title = isStr ? item : (item?.title || item?.headline || "");
    if (!title) continue;
    const rawDate = isStr ? item : (item?.date || item?.time || title);
    const { ts, bareTime } = parseHeadlineDate(rawDate, now);
    const effTs = bareTime ? (lastTs ?? now.getTime()) : ts;
    if (ts != null) lastTs = ts;
    // Drop headlines that have a known date older than maxDays
    if (effTs != null && effTs < cutoff) continue;
    out.push(item);
  }
  return out;
}

function normTicker(x) {
  const raw = typeof x === "string" ? x : x?.ticker;
  const t = String(raw || "").trim().toUpperCase();
  return t || null;
}

// Compute live intraday alerts across the user's portfolio, watchlist & flagged tickers.
export function computeLivePortfolioPulse({
  portfolio = [],
  watchlist = [],
  flagged = [],
  stockMap = {},
  quotes = new Map(),
  profiles = null,
  tickerLayer = {},
  tiers = null,
  now = new Date(),
} = {}) {
  const portTickers = [...new Set((Array.isArray(portfolio) ? portfolio : []).map(normTicker).filter(Boolean))];
  const watchTickers = [...new Set((Array.isArray(watchlist) ? watchlist : []).map(normTicker).filter(Boolean))];
  const flagTickers = [...new Set((Array.isArray(flagged) ? flagged : []).map(normTicker).filter(Boolean))];

  const portSet = new Set(portTickers);
  const watchSet = new Set(watchTickers);
  const flagSet = new Set(flagTickers);

  const seen = new Set();
  const entries = [];
  for (const t of portTickers) {
    seen.add(t);
    entries.push([t, "PORT"]);
  }
  for (const t of watchTickers) {
    if (!seen.has(t)) {
      seen.add(t);
      entries.push([t, "WATCH"]);
    }
  }
  for (const t of flagTickers) {
    if (!seen.has(t)) {
      seen.add(t);
      entries.push([t, "FLAG"]);
    }
  }

  const scoredAlerts = [];
  const allItems = [];
  const upcomingEarnings = [];

  for (const [t, list] of entries) {
    const rawS = stockMap?.[t] || null;
    const s = rawS ? (rawS.ticker ? rawS : { ...rawS, ticker: t }) : null;
    const rawQ = quotes instanceof Map ? (quotes.get(t) || null) : (quotes?.[t] || null);
    let q = rawQ;
    if (rawQ && rawQ.change == null && rawQ.previousClose > 0) {
      const qPx = rawQ.rthPrice ?? rawQ.price ?? null;
      if (qPx != null && Number.isFinite(qPx)) {
        q = { ...rawQ, change: Math.round(((qPx / rawQ.previousClose) - 1) * 10000) / 100 };
      }
    }

    const layer = tickerLayer?.[t] || null;
    const tier = tiers?.leaders?.has(t) ? "lead" : tiers?.emerging?.has(t) ? "emerg" : null;
    const r = s ? scoreZangerCandidate({ s, q, layer, tier, profiles, now }) : null;

    const chg = r?.chg != null
      ? r.chg
      : (q?.change != null && Number.isFinite(q.change)
        ? q.change
        : (s?.change_pct != null && Number.isFinite(s.change_pct) ? s.change_pct : null));

    const cr = r?.cr != null ? r.cr : closingRange(q, s);

    let zvr = r?.zvr ?? null;
    if (zvr == null && s) {
      let rawZvr = q ? zvrFor(s, q, profiles, now) : null;
      if (rawZvr == null && s.rel_volume > 0) rawZvr = s.rel_volume;
      if (rawZvr != null && Number.isFinite(rawZvr)) {
        zvr = Math.round(rawZvr * 100) / 100;
      }
    }

    const rs = r?.rs ?? s?.rs_rank ?? null;
    const off52 = r?.off52 ?? s?.off_52w_high ?? s?.pct_from_high ?? null;
    const earningsDays = r?.earningsDays ?? s?.earnings_days ?? null;
    const earningsDisplay = r?.earningsDisplay || s?.earnings_display || "";

    if (earningsDays != null && earningsDays >= 0 && earningsDays <= 10) {
      const timingMatch = String(earningsDisplay).match(/\b(BMO|AMC)\b/i);
      upcomingEarnings.push({
        ticker: t,
        list,
        display: earningsDisplay,
        timing: timingMatch ? timingMatch[1].toUpperCase() : (s?.earnings_timing || ""),
        days: earningsDays,
      });
    }

    const tags = [];
    const isBo = Boolean(r?.isBreakout);
    if (isBo) {
      tags.push({
        label: r.breakoutTypes?.length ? `BO (${r.breakoutTypes.join("/")})` : "BREAKOUT",
        tone: "good",
      });
    } else if ((zvr ?? 0) >= 1.5 && (chg ?? 0) >= 2.0 && (cr ?? 100) >= 60) {
      tags.push({ label: "VOL SURGE", tone: "good" });
    }

    if ((chg ?? 0) > 0 && (zvr ?? 0) >= 1.5 && cr != null && cr <= 30) {
      tags.push({ label: "SQUATTING", tone: "warn" });
    }

    const isHeavySell = (chg ?? 0) <= -3.0 && ((zvr ?? 0) >= 1.5 || (cr != null && cr <= 30) || (chg ?? 0) <= -4.5);
    if (isHeavySell) {
      tags.push({ label: "HEAVY SELL", tone: "bad" });
    } else if ((chg ?? 0) <= -3.0) {
      tags.push({ label: "DOWN ≥3%", tone: "warn" });
    }

    if (earningsDays != null && earningsDays >= 0 && earningsDays <= 3) {
      tags.push({
        label: earningsDays === 0 ? "ER TODAY" : `ER ${earningsDays}d`,
        tone: "warn",
      });
    }

    const hasBad = tags.some((x) => x.tone === "bad");
    const hasWarn = tags.some((x) => x.tone === "warn");
    const severity = !tags.length ? 0 : hasBad ? 4 : isBo ? 3 : hasWarn ? 2 : 1;

    const item = {
      ticker: t,
      list,
      inPf: portSet.has(t),
      inWl: watchSet.has(t),
      inFlag: flagSet.has(t),
      chg,
      zvr,
      cr,
      rs,
      off52,
      tags,
    };
    allItems.push({ severity, item });

    if (tags.length) {
      scoredAlerts.push({
        severity,
        alert: { ticker: t, list, chg, zvr, cr, tags },
      });
    }
  }

  scoredAlerts.sort(
    (a, b) =>
      b.severity - a.severity ||
      Math.abs(b.alert.chg ?? 0) - Math.abs(a.alert.chg ?? 0) ||
      a.alert.ticker.localeCompare(b.alert.ticker)
  );

  const listRank = (l) => (l === "PORT" ? 0 : l === "WATCH" ? 1 : 2);
  allItems.sort(
    (a, b) =>
      (listRank(a.item.list) - listRank(b.item.list)) ||
      b.severity - a.severity ||
      (b.item.chg ?? -999) - (a.item.chg ?? -999) ||
      a.item.ticker.localeCompare(b.item.ticker)
  );

  upcomingEarnings.sort((a, b) => a.days - b.days || a.ticker.localeCompare(b.ticker));

  return {
    items: allItems.map((x) => x.item),
    alerts: scoredAlerts.map((x) => x.alert),
    upcomingEarnings,
    portfolioCount: portTickers.length,
    watchlistCount: watchTickers.length,
    flaggedCount: flagTickers.length,
    isLive: true,
  };
}
