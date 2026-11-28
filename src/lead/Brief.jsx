import React, { useEffect, useMemo, useState } from "react";
import { CONF_LABEL, Card, Delta, EPS_TIP, ExtHoursMovers, FlagButton, LayerLink, LayerMembers, MONO, StockTable, TierMark, closingRange, pinReason, scoreZangerCandidate, statusColor, td, th, useRvolProfiles, useScanQuotes, zvrFor } from "./core.jsx";
import { authFetch } from "../utils.js";
import { collectBriefTickers, evalPivotStatus, filterRecentHeadlines, matchMacroLive, normalizeWrittenBrief } from "./briefLive.js";
import { DEFAULT_GOTO_PRESET, GOTO_STORAGE_KEY, buildGoToBriefingAnalysis } from "./gotoAnalysis.js";
import { buildBriefWhyPayload, useBriefWhy } from "./briefWhyClient.js";
import AiDeskNotePanel from "./AiDeskNotePanel.jsx";
import { evalScanHits } from "./scannerMath.js";
import RotationView from "./Rotation.jsx";
import ZangerBriefSection from "./ZangerBriefSection.jsx";

// ── Written briefs (BRIEF → Written) ─────────────────────────────────────
// Dated snapshots in public/data/briefs/ (brief-index.json + <id>.json),
// committed by the Gmail → GitHub bridge. Everything is rendered as text —
// never as HTML — and links are limited to http(s). When viewing the latest
// brief, live intraday quotes & macro data overlay prices, Chg%, ZVR, CR%,
// and pivot/buy-zone/stop status automatically (toggleable to Snapshot).
const BRIEF_DIR = "/data/briefs/";
const safeUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : null);
const SESSION_LABEL = { am: "Premarket", pm: "Postmarket", intraday: "Intraday" };
const _goToBriefNewsCache = new Map();
const GOTO_BRIEF_NEWS_TTL_MS = 10 * 60 * 1000;

function readSavedGoToPreset() {
  try {
    const raw = JSON.parse(localStorage.getItem(GOTO_STORAGE_KEY) || "null");
    if (raw && typeof raw === "object") return { ...DEFAULT_GOTO_PRESET, ...raw };
  } catch { /* ignore */ }
  return DEFAULT_GOTO_PRESET;
}

function WrittenBrief({ A, stockMap, tickerLayer = {}, layers = [], themes = [], tiers, onTicker, chartTicker, modeSwitch }) {
  const [index, setIndex] = useState(null);
  const [sel, setSel] = useState(null);
  const [brief, setBrief] = useState(null);
  const [err, setErr] = useState(null);
  const [liveOn, setLiveOn] = useState(true);
  const [mq, setMq] = useState(null);
  const [focusSort, setFocusSort] = useState({ k: null, d: -1 });
  const [extSort, setExtSort] = useState({ k: null, d: -1 });
  const [brkSort, setBrkSort] = useState({ k: null, d: -1 });
  const [goToThemeFocus, setGoToThemeFocus] = useState(null);
  const [goToNews, setGoToNews] = useState({});
  const { data: whyData, loading: whyLoading, error: whyError, updatedAt: whyUpdatedAt, run: runBriefWhy } = useBriefWhy();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const v = localStorage.getItem("tp-written-collapsed");
      return v === "true" || v === "1";
    } catch {
      return false;
    }
  });
  const toggleCollapsed = () => setCollapsed((v) => {
    const next = !v;
    try { localStorage.setItem("tp-written-collapsed", String(next)); } catch { /* ignore */ }
    return next;
  });
  const profiles = useRvolProfiles();

  useEffect(() => {
    fetch(`${BRIEF_DIR}brief-index.json?t=${Date.now()}`).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((ix) => { const list = Array.isArray(ix?.briefs) ? ix.briefs : []; setIndex(list); setSel(list[0]?.file || ix?.latest || null); })
      .catch(() => setErr("No written briefs published yet."));
  }, []);
  useEffect(() => {
    if (!sel || !/^[a-z0-9_-]+\.json$/i.test(sel)) return;
    setBrief(null);
    const isLatest = !index?.length || index[0]?.file === sel;
    setLiveOn(isLatest);
    fetch(`${BRIEF_DIR}${sel}`).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((b) => { setBrief(b); setErr(null); }).catch(() => setErr(`Couldn't load ${sel}.`));
  }, [sel, index]);

  const normBrief = useMemo(() => normalizeWrittenBrief(brief), [brief]);
  const showGoToBrief = normBrief?.session === "intraday" || normBrief?.session === "pm";
  const goToPreset = useMemo(() => readSavedGoToPreset(), [sel]); // eslint-disable-line react-hooks/exhaustive-deps
  const goToPoolTickers = useMemo(() => {
    if (!showGoToBrief || !stockMap) return [];
    const out = [];
    for (const [t, s] of Object.entries(stockMap)) {
      if (!s?.ticker || !(s.close > 0) || pinReason(s)) continue;
      if (goToPreset.onlyNear52w && (s.off_52w_high ?? -99) < -15) continue;
      if (goToPreset.minDollarVol > 0 && (s.avg_dollar_vol_raw ?? 0) < goToPreset.minDollarVol) continue;
      if (goToPreset.minAdr != null && (s.adr20 ?? s.adr_pct ?? 0) < goToPreset.minAdr) continue;
      out.push(t);
    }
    return out;
  }, [showGoToBrief, stockMap, goToPreset]);

  const briefTickers = useMemo(
    () => [...new Set([...collectBriefTickers(normBrief), ...goToPoolTickers])],
    [normBrief, goToPoolTickers]
  );
  const { quotes, at } = useScanQuotes(briefTickers, liveOn && briefTickers.length > 0);

  const externalWhyByTheme = useMemo(() => {
    const raw = brief?.goToAnalysis?.themeClusters;
    if (!Array.isArray(raw)) return null;
    const map = {};
    for (const c of raw) {
      if (c?.theme && (c.why || c.aiWhy)) map[c.theme] = c.aiWhy || c.why;
    }
    return Object.keys(map).length ? map : null;
  }, [brief]);

  const goToAnalysis = useMemo(() => {
    if (!showGoToBrief || !goToPoolTickers.length) return null;
    const now = new Date();
    const hasLive = Boolean(liveOn && quotes && quotes.size > 0);
    const scored = [];
    for (const t of goToPoolTickers) {
      const s = stockMap?.[t];
      if (!s) continue;
      const q = hasLive ? (quotes.get(t) || null) : null;
      const layer = tickerLayer?.[t] || null;
      const tier = tiers?.leaders?.has(t) ? "lead" : tiers?.emerging?.has(t) ? "emerg" : null;
      const res = scoreZangerCandidate({ s, q, layer, tier, profiles, now, unfiltered: true });
      if (res) {
        res.inAdr5Liq = Boolean(evalScanHits(s, q, res.zvr)?.adr5liq);
        scored.push(res);
      }
    }
    return buildGoToBriefingAnalysis({
      allScored: scored,
      preset: goToPreset,
      stockMap,
      tickerLayer,
      layers,
      themes,
      headlines: goToNews,
      externalWhyByTheme,
      maxLeaders: 25,
      maxClusters: 8,
      now,
    });
  }, [showGoToBrief, goToPoolTickers, liveOn, quotes, stockMap, tickerLayer, tiers, profiles, goToPreset, layers, themes, goToNews, externalWhyByTheme]);

  const goToNewsKey = useMemo(
    () => (showGoToBrief && !collapsed && goToAnalysis?.newsTargets?.length ? goToAnalysis.newsTargets.slice(0, 10).join(",") : ""),
    [showGoToBrief, collapsed, goToAnalysis]
  );

  useEffect(() => {
    if (!goToNewsKey) return undefined;
    let alive = true;
    const tks = goToNewsKey.split(",").filter(Boolean);
    const nowMs = Date.now();
    const initial = {};
    const missing = [];
    for (const tk of tks) {
      const hit = _goToBriefNewsCache.get(tk);
      if (hit && nowMs - hit.ts < GOTO_BRIEF_NEWS_TTL_MS) initial[tk] = hit.items;
      else missing.push(tk);
    }
    if (Object.keys(initial).length) setGoToNews((prev) => ({ ...prev, ...initial }));
    if (!missing.length) return () => { alive = false; };
    Promise.all(
      missing.map(async (tk) => {
        try {
          const r = await authFetch(`/api/live?news=${encodeURIComponent(tk)}`, { cache: "no-store" });
          if (!r.ok) return [tk, []];
          const d = await r.json();
          const raw = (d?.news || []).map((n) => ({
            title: n.title || n.headline || "",
            source: n.source || "",
            date: n.date || n.time || "",
            url: n.url || "",
          })).filter((n) => n.title);
          const fresh = filterRecentHeadlines(raw, new Date(), 14).slice(0, 2);
          _goToBriefNewsCache.set(tk, { ts: Date.now(), items: fresh });
          return [tk, fresh];
        } catch {
          return [tk, []];
        }
      })
    ).then((pairs) => {
      if (!alive) return;
      const patch = {};
      for (const [tk, items] of pairs) patch[tk] = items;
      setGoToNews((prev) => ({ ...prev, ...patch }));
    });
    return () => { alive = false; };
  }, [goToNewsKey]);

  // Poll /api/market-quality every 60s when live overlay is active for live VIX / 10Y / Crude / DXY
  useEffect(() => {
    if (!liveOn || !brief) return;
    let alive = true;
    const pull = () => {
      authFetch("/api/market-quality", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (alive && d?.ok) setMq(d); })
        .catch(() => {});
    };
    pull();
    const id = setInterval(() => { if (!document.hidden) pull(); }, 60000);
    return () => { alive = false; clearInterval(id); };
  }, [liveOn, brief]);

  const num = (v, dg = 2) => (typeof v === "number" ? v.toFixed(dg) : "—");
  const pct = (v, dg = 1) => (typeof v === "number" ? `${v > 0 ? "+" : ""}${v.toFixed(dg)}%` : "—");
  const fmtVol = (v) => (typeof v !== "number" || !Number.isFinite(v) || v <= 0 ? "—" : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}K` : String(Math.round(v)));
  const pc = (v) => (typeof v !== "number" ? A.textMuted : v >= 0 ? A.green : A.red);
  const rsC = (v) => (v >= 90 ? A.green : v >= 70 ? A.yellow : typeof v === "number" ? A.red : A.textMuted);
  const arr = (x) => (Array.isArray(x) ? x : []);
  const td = (align = "left") => ({
    padding: "6px 7px",
    fontSize: 11.5,
    color: A.text,
    borderBottom: `1px solid ${A.border}`,
    textAlign: align,
    verticalAlign: "top",
    fontVariantNumeric: "tabular-nums",
    ...(align === "right" ? { fontFamily: MONO } : {}),
  });
  const Tk = ({ t }) => (typeof t === "string" && t
    ? <><span onClick={() => onTicker(t)} style={{ cursor: "pointer", fontFamily: MONO, fontWeight: 700, color: chartTicker === t ? A.green : A.text }}>{t}</span><TierMark t={t} /></>
    : null);
  const Src = ({ u }) => { const h = safeUrl(u); return h ? <a href={h} target="_blank" rel="noopener noreferrer" style={{ color: A.cyan, fontSize: 10, marginLeft: 4 }}>src</a> : null; };
  const label = (b) => `${b.label || b.date || b.id}${b.session ? ` · ${SESSION_LABEL[b.session] || b.session}` : ""}`;

  const liveInfo = (tk) => {
    if (!liveOn || !tk) return null;
    const q = quotes.get(tk);
    if (!q) return null;
    const s = stockMap?.[tk] || null;
    const px = q.rthPrice ?? q.price ?? null;
    const chg = q.change ?? (q.previousClose && px ? (px / q.previousClose - 1) * 100 : null);
    const cr = closingRange(q, s);
    const zvr = s ? zvrFor(s, q, profiles) : null;
    const hiLvl = s?.hi52_lvl ?? (s?.close && s?.off_52w_high != null ? s.close / (1 + s.off_52w_high / 100) : null);
    const hi = Math.max(hiLvl || 0, q.yearHigh || 0) || null;
    const offHi = hi && px ? (px / hi - 1) * 100 : null;
    const vs50 = s?.sma50_lvl && px ? (px / s.sma50_lvl - 1) * 100 : null;
    const extSession = q.ext_session || null;
    const extPx = extSession ? (q.price ?? null) : null;
    const extChg = extSession ? (q.ext_change ?? null) : null;
    const extVol = extSession ? (q.ext_volume ?? null) : null;
    return { q, px, chg, cr, zvr, offHi, vs50, extSession, extPx, extChg, extVol };
  };

  const toneColor = (tone) => (
    tone === "green" ? A.green
      : tone === "yellow" ? "#f59e0b"
        : tone === "red" ? A.red
          : tone === "cyan" ? A.cyan
            : A.textMuted
  );

  const STATUS_PRI = { buy_zone: 4, near_pivot: 3, extended: 2, below_pivot: 1, stopped: 0 };
  const makeSortTh = (sortState, setSortState) => (k, label, align = "right", textDefault = false) => (
    <th
      key={k}
      onClick={() => setSortState((p) => ({ k, d: p.k === k ? -p.d : (textDefault ? 1 : -1) }))}
      style={{
        ...th(A, align),
        cursor: "pointer",
        userSelect: "none",
        color: sortState.k === k ? A.text : A.textMuted,
      }}
    >
      {label}{sortState.k === k ? (sortState.d < 0 ? " ▼" : " ▲") : ""}
    </th>
  );
  const sortWith = (list, sortState, getVal) => {
    if (!sortState.k) return list;
    const { k, d } = sortState;
    return [...list].sort((a, b) => {
      const va = getVal(a, k), vb = getVal(b, k);
      if (va == null && vb == null) return String(a.ticker || "").localeCompare(String(b.ticker || ""));
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string" || typeof vb === "string") {
        return String(va).localeCompare(String(vb)) * d || String(a.ticker || "").localeCompare(String(b.ticker || ""));
      }
      return (va - vb) * d || String(a.ticker || "").localeCompare(String(b.ticker || ""));
    });
  };
  const focusTh = makeSortTh(focusSort, setFocusSort);
  const extTh = makeSortTh(extSort, setExtSort);
  const brkTh = makeSortTh(brkSort, setBrkSort);

  const picker = (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <button
        type="button"
        onClick={() => setLiveOn((v) => !v)}
        title={liveOn ? "Showing live intraday prices & pivot status — click for frozen brief snapshot" : "Showing original brief snapshot — click to overlay live intraday data"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          background: liveOn ? "rgba(34,197,94,0.14)" : "transparent",
          border: `1px solid ${liveOn ? A.green : (A.borderLight || A.border)}`,
          color: liveOn ? A.green : A.textMuted,
          borderRadius: 6,
          padding: "3px 8px",
          fontSize: liveOn ? 10.5 : 11,
          fontWeight: liveOn ? 700 : 600,
          fontFamily: liveOn ? MONO : undefined,
          fontVariantNumeric: "tabular-nums",
          cursor: "pointer",
          transition: "background 0.15s, border-color 0.15s, color 0.15s",
        }}
      >
        <span className={liveOn && at ? "tp-livedot" : undefined} style={{ width: 6, height: 6, borderRadius: 3, background: liveOn ? A.green : A.textMuted, display: "inline-block" }} />
        {liveOn ? (at ? `LIVE · ${at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : "LIVE") : "Snapshot"}
      </button>
      {index && index.length > 0 && (
        <select value={sel || ""} onChange={(e) => setSel(e.target.value)}
          style={{ background: A.bg, color: A.text, border: `1px solid ${A.borderLight || A.border}`, borderRadius: 6, fontSize: 11, padding: "3px 6px", maxWidth: 260, fontVariantNumeric: "tabular-nums" }}>
          {index.map((b) => <option key={b.id || b.file} value={b.file}>{label(b)}</option>)}
        </select>
      )}
      {brief && (
        <button
          type="button"
          onClick={toggleCollapsed}
          title={collapsed ? "Expand full Written Brief" : "Collapse Written Brief to compact summary"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            background: collapsed ? A.glowGreen : "transparent",
            border: `1px solid ${collapsed ? A.green : (A.borderLight || A.border)}`,
            color: collapsed ? A.green : A.textDim,
            borderRadius: 6,
            padding: "3px 9px",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            whiteSpace: "nowrap",
            transition: "background 0.15s, border-color 0.15s, color 0.15s",
          }}
        >
          {collapsed ? "Expand full brief ▾" : "Collapse ▴"}
        </button>
      )}
      {modeSwitch}
    </div>
  );
  if (err && !normBrief) return <Card A={A} title="Written brief" right={picker}><div style={{ fontSize: 12, color: A.textMuted }}>{err}</div></Card>;
  if (!normBrief) return <Card A={A} title="Written brief" right={picker}><div style={{ fontSize: 12, color: A.textMuted }}>Loading…</div></Card>;

  const rg = normBrief.regime;
  const br = rg.breadth;
  const st = normBrief.skipTraps;
  const skipIsArr = Array.isArray(st);
  const hasSkip = skipIsArr ? st.length > 0 : Object.keys(st || {}).length > 0;
  const pulseEntries = normBrief.leadingPulse
    ? Object.entries(normBrief.leadingPulse).filter(([k, v]) => k !== "tradingViewWatchlist" && Array.isArray(v) && v.length > 0)
    : [];
  const inBuyCount = liveOn
    ? arr(normBrief.focusSetups).filter((f) => {
        const li = liveInfo(f.ticker);
        const px = li?.px ?? f.price;
        return evalPivotStatus(px, f)?.state === "buy_zone";
      }).length
    : 0;

  return (
    <div>
      <Card
        A={A}
        title="Written brief"
        sub={`${SESSION_LABEL[normBrief.session] || normBrief.session || ""} · ${normBrief.date || ""}${normBrief.dataAsOf ? ` · written ${normBrief.dataAsOf}` : ""}${liveOn && at ? ` · intraday overlay active (60s refresh)` : ""}`}
        right={picker}
      >
        {normBrief.headline && <div style={{ fontSize: 16, fontWeight: 700, color: A.text, lineHeight: 1.35, marginBottom: collapsed ? 4 : 6 }}>{String(normBrief.headline)}</div>}
        {(rg.posture || (collapsed && (inBuyCount > 0 || arr(normBrief.focusSetups).length > 0))) && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {rg.posture && <div style={{ fontSize: 12, fontWeight: 700, color: /correction|defensive|risk off/i.test(rg.posture) ? A.red : A.green }}>{String(rg.posture)}</div>}
            {collapsed && inBuyCount > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, fontFamily: MONO, fontVariantNumeric: "tabular-nums", padding: "1px 6px", borderRadius: 4, background: "rgba(34,197,94,0.16)", border: `1px solid ${A.green}`, color: A.green }}>
                {inBuyCount} IN BUY ZONE
              </span>
            )}
            {collapsed && arr(normBrief.focusSetups).length > 0 && (
              <span style={{ fontSize: 10, fontWeight: 600, fontVariantNumeric: "tabular-nums", padding: "1px 6px", borderRadius: 4, border: `1px solid ${A.borderLight || A.border}`, color: A.textMuted }}>
                <span style={{ fontFamily: MONO }}>{arr(normBrief.focusSetups).length}</span> {normBrief.focusTitle.toLowerCase()}
              </span>
            )}
          </div>
        )}
        {!collapsed && rg.note && <div style={{ fontSize: 11, color: A.textDim, marginTop: 3, lineHeight: 1.45 }}>{String(rg.note)}</div>}
        {!collapsed && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 10, borderTop: `1px solid ${A.border}`, paddingTop: 10 }}>
            {arr(rg.indexes).map((x) => {
              const li = liveInfo(x.symbol);
              const px = li?.px ?? x.price;
              const chg = li?.chg ?? x.chgPct;
              const cr = li?.cr ?? x.closingRangePct;
              const offHi = li?.offHi ?? x.offHighPct;
              const snapTip = [li ? `Brief snapshot: ${num(x.price)} (${pct(x.chgPct, 2)})` : null, x.note].filter(Boolean).join(" — ") || undefined;
              return (
                <div key={x.symbol} title={snapTip} style={{ minWidth: 130 }}>
                  <div style={{ fontSize: 11, color: A.textMuted, display: "flex", alignItems: "center", gap: 4 }}>
                    <Tk t={x.symbol} />
                    {li && <span style={{ padding: "0 4px", borderRadius: 4, background: A.glowGreen, fontSize: 10, fontWeight: 700, color: A.green, fontFamily: MONO }}>LIVE</span>}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: pc(chg), fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
                    {num(px)} <span style={{ fontSize: 11 }}>{pct(chg, 2)}</span>
                  </div>
                  <div style={{ fontSize: 10, color: A.textMuted, fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
                    off high {pct(offHi)} · CR {typeof cr === "number" ? `${cr.toFixed(0)}%` : "—"}
                    {!li && typeof x.afterHours === "number" ? ` · AH ${num(x.afterHours)}` : ""}
                  </div>
                </div>
              );
            })}
            {Object.keys(br).length > 0 && (
              <div style={{ fontSize: 11, color: A.textDim, lineHeight: 1.6, fontVariantNumeric: "tabular-nums" }}>
                <span style={{ color: A.green }}><span style={{ fontFamily: MONO }}>{br.leadingLayers ?? "—"}</span> leading</span> · <span style={{ color: A.cyan }}><span style={{ fontFamily: MONO }}>{br.emergingLayers ?? "—"}</span> emerging</span><br />
                <span style={{ color: A.yellow }}><span style={{ fontFamily: MONO }}>{br.weakeningLayers ?? "—"}</span> weakening</span> · <span style={{ color: A.red }}><span style={{ fontFamily: MONO }}>{br.breakingDownLayers ?? "—"}</span> breaking down</span> · <span style={{ fontFamily: MONO }}>{br.laggingLayers ?? "—"}</span> lagging
              </div>
            )}
          </div>
        )}
      </Card>

      {!collapsed && arr(normBrief.macroTape).length > 0 && (
        <Card A={A} title="Macro tape" sub={liveOn && mq ? "Live VIX / 10Y / Crude / DXY overlaid from /api/market-quality" : undefined}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            {arr(normBrief.macroTape).map((m, i) => {
              const liveM = liveOn ? matchMacroLive(m, mq) : null;
              const val = liveM?.value ?? m.value ?? "";
              const chg = liveM?.change ?? m.change ?? "";
              return (
                <div key={i} title={liveM ? `Brief snapshot: ${m.value} (${m.change})` : undefined}>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: A.textMuted, display: "flex", alignItems: "center", gap: 4 }}>
                    <span>{String(m.name ?? "")}</span>
                    {liveM && <span style={{ padding: "0 4px", borderRadius: 4, background: A.glowGreen, fontSize: 10, fontWeight: 700, color: A.green, fontFamily: MONO }}>LIVE</span>}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: A.text, fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
                    {String(val)}{" "}
                    <span style={{ fontSize: 11, color: /^\+/.test(chg) ? A.green : /^-/.test(chg) ? A.red : A.textDim }}>{String(chg)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: A.textDim, lineHeight: 1.4, marginTop: 2 }}>{String(m.impact ?? "")}<Src u={m.sourceUrl} /></div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {!collapsed && arr(normBrief.focusSetups).length > 0 && (
        <Card
          A={A}
          title={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span>{normBrief.focusTitle}</span>
              {inBuyCount > 0 && (
                <span style={{ fontSize: 10, fontWeight: 800, fontFamily: MONO, fontVariantNumeric: "tabular-nums", padding: "1px 7px", borderRadius: 4, background: "rgba(34,197,94,0.18)", border: `1px solid ${A.green}`, color: A.green }}>
                  {inBuyCount} IN BUY ZONE
                </span>
              )}
            </span>
          }
          sub={liveOn ? "Live intraday Price, Chg%, ZVR, CR% & pivot status vs written buy zone/stop · click a ticker to chart" : "Pivot, buy zone and stop as written in the brief · click a ticker to chart"}
        >
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, background: A.bgCard, zIndex: 1 }}><tr>
                {focusTh("ticker", "Ticker", "left", true)}
                {focusTh("layer", "Layer", "left", true)}
                {focusTh("rs", "RS")}
                {focusTh("eps", "EPS")}
                {focusTh("px", liveOn ? "Live" : "Price")}
                {liveOn && focusTh("chg", "Chg%")}
                {liveOn && focusTh("zvr", "ZVR")}
                {liveOn && focusTh("cr", "CR%")}
                {focusTh("pivot", "Pivot")}
                {focusTh("buyZoneMax", "Buy ≤")}
                {focusTh("stop", "Stop")}
                {liveOn && focusTh("status", "Status", "left")}
                {focusTh("baseStage", "Stage", "left", true)}
                {focusTh("sizing", "Size", "left", true)}
                <th style={th(A)}>Catalyst</th>
              </tr></thead>
              <tbody>{sortWith(
                arr(normBrief.focusSetups).map((f) => {
                  const li = liveInfo(f.ticker);
                  const px = li?.px ?? f.price;
                  const status = liveOn ? evalPivotStatus(px, f) : null;
                  return { ...f, _li: li, _px: px, _status: status };
                }),
                focusSort,
                (r, k) => {
                  if (k === "px") return r._px;
                  if (k === "chg") return r._li?.chg ?? null;
                  if (k === "zvr") return r._li?.zvr ?? null;
                  if (k === "cr") return r._li?.cr ?? null;
                  if (k === "status") return r._status ? (STATUS_PRI[r._status.state] ?? -1) : null;
                  return r[k] ?? null;
                }
              ).map((f, i) => {
                const li = f._li;
                const px = f._px;
                const status = f._status;
                const stColor = status ? toneColor(status.tone) : A.textMuted;
                const isCharted = chartTicker === f.ticker;
                const rowBg = status?.state === "buy_zone"
                  ? "rgba(34,197,94,0.08)"
                  : status?.state === "stopped"
                    ? "rgba(239,68,68,0.08)"
                    : isCharted
                      ? A.bgHover
                      : "transparent";
                return (
                  <tr
                    key={`${f.ticker}-${i}`}
                    data-nav={f.ticker}
                    className={isCharted ? "tp-click-row tp-row-active" : "tp-click-row"}
                    onClick={() => onTicker(f.ticker)}
                    style={{
                      cursor: "pointer",
                      background: rowBg,
                      boxShadow: isCharted ? `inset 2px 0 0 ${A.green}` : "none",
                    }}
                  >
                    <td style={td()}><FlagButton t={f.ticker} A={A} /><Tk t={f.ticker} /><div style={{ fontSize: 10, color: A.textMuted }}>{String(f.company ?? "")}</div></td>
                    <td style={td()}>{String(f.layer ?? "")}<div style={{ fontSize: 10, color: A.textMuted }}>{String(f.theme ?? "")}</div></td>
                    <td style={{ ...td("right"), color: rsC(f.rs) }}>{f.rs ?? "—"}</td>
                    <td style={{ ...td("right"), color: rsC(f.eps) }}>{f.eps ?? "—"}</td>
                    <td style={{ ...td("right"), fontWeight: li ? 700 : 400 }} title={li ? `Brief price: ${num(f.price)}` : undefined}>{num(px)}</td>
                    {liveOn && <td style={{ ...td("right"), fontWeight: 700, color: pc(li?.chg) }}>{pct(li?.chg, 2)}</td>}
                    {liveOn && <td style={{ ...td("right"), fontWeight: (li?.zvr ?? 0) >= 1.5 ? 700 : 400, color: (li?.zvr ?? 0) >= 1.5 ? A.green : A.textDim }}>{li?.zvr != null ? `${li.zvr.toFixed(2)}x` : "—"}</td>}
                    {liveOn && <td style={{ ...td("right"), fontWeight: 600, color: li?.cr == null ? A.textMuted : li.cr >= 75 ? A.green : li.cr >= 50 ? "#f59e0b" : A.red }}>{li?.cr != null ? `${li.cr}%` : "—"}</td>}
                    <td style={td("right")}>{num(f.pivot)}</td>
                    <td style={td("right")}>{num(f.buyZoneMax)}</td>
                    <td style={{ ...td("right"), color: A.red }}>{num(f.stop)}</td>
                    {liveOn && (
                      <td style={td()}>
                        {status ? (
                          <span
                            title={status.detail}
                            style={{
                              display: "inline-block",
                              whiteSpace: "nowrap",
                              fontSize: 10,
                              fontWeight: 800,
                              fontFamily: MONO,
                              fontVariantNumeric: "tabular-nums",
                              padding: "2px 6px",
                              borderRadius: 4,
                              background: status.tone === "muted" ? "transparent" : `${stColor}20`,
                              border: `1px solid ${status.tone === "muted" ? A.border : stColor}`,
                              color: stColor,
                            }}
                          >
                            {status.label}
                          </span>
                        ) : "—"}
                      </td>
                    )}
                    <td style={td()}>{String(f.baseStage ?? "")}<div style={{ fontSize: 10, color: A.textMuted }}>{[f.continuity, f.rsLine].filter(Boolean).map(String).join(" · ")}</div></td>
                    <td style={td()}>{String(f.sizing ?? "")}</td>
                    <td style={{ ...td(), color: A.textDim, minWidth: 220 }}>{String(f.catalyst ?? "")}<Src u={f.sourceUrl} /></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </Card>
      )}

      {!collapsed && arr(normBrief.breakouts).length > 0 && (
        <Card
          A={A}
          title="ThemePulse Breakouts"
          sub={liveOn ? "Breakouts pulled from ThemePulse with live Price, Chg%, ZVR & CR% overlay · click a ticker to chart" : "Breakouts recorded from ThemePulse"}
        >
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, background: A.bgCard, zIndex: 1 }}>
                <tr>
                  <th style={th(A)}>Ticker</th>
                  <th style={th(A)}>Types</th>
                  <th style={th(A, "right")}>{liveOn ? "Live" : "Price"}</th>
                  <th style={th(A, "right")}>Chg%</th>
                  <th style={th(A, "right")}>ZVR</th>
                  <th style={th(A, "right")}>Thr</th>
                  <th style={th(A, "right")}>CR%</th>
                  <th style={th(A, "right")}>RS</th>
                  <th style={th(A)}>Layer</th>
                  <th style={th(A)}>Note</th>
                </tr>
              </thead>
              <tbody>
                {arr(normBrief.breakouts).map((bo, i) => {
                  const li = liveInfo(bo.ticker);
                  const px = li?.px ?? bo.price;
                  const chg = li?.chg ?? bo.chgPct;
                  const zvr = li?.zvr ?? bo.zvr;
                  const cr = li?.cr ?? bo.cr;
                  const thr = typeof chg === "number" && typeof zvr === "number" && zvr > 0 ? +(chg * zvr).toFixed(1) : bo.thrust;
                  const isCharted = chartTicker === bo.ticker;
                  return (
                    <tr
                      key={`${bo.ticker}-${i}`}
                      data-nav={bo.ticker}
                      className={isCharted ? "tp-click-row tp-row-active" : "tp-click-row"}
                      onClick={() => onTicker(bo.ticker)}
                      style={{
                        cursor: "pointer",
                        background: isCharted ? A.bgHover : "transparent",
                        boxShadow: isCharted ? `inset 2px 0 0 ${A.green}` : "none",
                      }}
                    >
                      <td style={td()}><FlagButton t={bo.ticker} A={A} /><Tk t={bo.ticker} /></td>
                      <td style={td()}>
                        {bo.types.length > 0 ? bo.types.map((t, j) => (
                          <span key={j} style={{ marginRight: 4, fontSize: 9.5, fontWeight: 800, fontFamily: MONO, padding: "1px 5px", borderRadius: 4, background: `${A.green}1c`, border: `1px solid ${A.green}55`, color: A.green }}>
                            {t}
                          </span>
                        )) : <span style={{ color: A.textMuted }}>—</span>}
                      </td>
                      <td style={td("right")}>{num(px)}</td>
                      <td style={{ ...td("right"), fontWeight: 700, color: pc(chg) }}>{pct(chg, 2)}</td>
                      <td style={{ ...td("right"), fontWeight: (zvr ?? 0) >= 1.5 ? 700 : 400, color: (zvr ?? 0) >= 2 ? "#fbbf24" : (zvr ?? 0) >= 1.5 ? A.green : A.textDim }}>
                        {typeof zvr === "number" ? `${zvr.toFixed(1)}x` : "—"}
                      </td>
                      <td style={{ ...td("right"), fontWeight: 700, color: pc(thr) }}>{typeof thr === "number" ? `${thr > 0 ? "+" : ""}${thr.toFixed(1)}` : "—"}</td>
                      <td style={{ ...td("right"), color: cr == null ? A.textMuted : cr >= 70 ? A.green : cr <= 30 ? A.red : A.textDim }}>{typeof cr === "number" ? `${Math.round(cr)}%` : "—"}</td>
                      <td style={{ ...td("right"), fontWeight: 700, color: rsC(bo.rs) }}>{bo.rs ?? "—"}</td>
                      <td style={{ ...td(), color: A.textDim }}>{bo.layer || "—"}</td>
                      <td style={{ ...td(), color: A.textDim, minWidth: 180 }}>{bo.note || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!collapsed && arr(normBrief.portfolioUpdates).length > 0 && (
        <Card
          A={A}
          title="Portfolio, Watchlist & Flagged Updates"
          sub={liveOn ? "Pulled from ThemePulse with live intraday overlay · click a ticker to chart" : "Pulled from ThemePulse snapshot"}
        >
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, background: A.bgCard, zIndex: 1 }}>
                <tr>
                  <th style={th(A)}>List</th>
                  <th style={th(A)}>Ticker</th>
                  <th style={th(A, "right")}>{liveOn ? "Live" : "Price"}</th>
                  <th style={th(A, "right")}>Chg%</th>
                  <th style={th(A, "right")}>ZVR</th>
                  <th style={th(A, "right")}>CR%</th>
                  <th style={th(A, "right")}>RS</th>
                  <th style={th(A)}>Alerts</th>
                  <th style={th(A)}>Action / Note</th>
                </tr>
              </thead>
              <tbody>
                {arr(normBrief.portfolioUpdates).map((p, i) => {
                  const li = liveInfo(p.ticker);
                  const px = li?.px ?? p.price;
                  const chg = li?.chg ?? p.chgPct;
                  const zvr = li?.zvr ?? p.zvr;
                  const cr = li?.cr ?? p.cr;
                  const isCharted = chartTicker === p.ticker;
                  const listColor = p.list.includes("PORT") ? A.green : p.list.includes("FLG") ? "#f97316" : A.cyan;
                  return (
                    <tr
                      key={`${p.ticker}-${i}`}
                      data-nav={p.ticker}
                      className={isCharted ? "tp-click-row tp-row-active" : "tp-click-row"}
                      onClick={() => onTicker(p.ticker)}
                      style={{
                        cursor: "pointer",
                        background: isCharted ? A.bgHover : "transparent",
                        boxShadow: isCharted ? `inset 2px 0 0 ${A.green}` : "none",
                      }}
                    >
                      <td style={{ ...td(), fontFamily: MONO, fontSize: 10, fontWeight: 700, color: listColor }}>{p.list}</td>
                      <td style={td()}><FlagButton t={p.ticker} A={A} /><Tk t={p.ticker} /></td>
                      <td style={td("right")}>{num(px)}</td>
                      <td style={{ ...td("right"), fontWeight: 700, color: pc(chg) }}>{pct(chg, 2)}</td>
                      <td style={{ ...td("right"), color: (zvr ?? 0) >= 1.5 ? A.green : A.textDim }}>{typeof zvr === "number" ? `${zvr.toFixed(1)}x` : "—"}</td>
                      <td style={{ ...td("right"), color: cr == null ? A.textMuted : cr >= 70 ? A.green : cr <= 30 ? A.red : A.textDim }}>{typeof cr === "number" ? `${Math.round(cr)}%` : "—"}</td>
                      <td style={{ ...td("right"), fontWeight: 700, color: rsC(p.rs) }}>{p.rs ?? "—"}</td>
                      <td style={td()}>
                        {p.alerts.length > 0 ? p.alerts.map((al, j) => {
                          const bad = /sell|stop|squat|brk|down/i.test(al);
                          const warn = /er|pb|warn|trim|ext/i.test(al);
                          const col = bad ? A.red : warn ? "#f59e0b" : A.green;
                          return (
                            <span key={j} style={{ marginRight: 4, fontSize: 9.5, fontWeight: 700, fontFamily: MONO, padding: "1px 5px", borderRadius: 4, border: `1px solid ${col}66`, color: col }}>
                              {al}
                            </span>
                          );
                        }) : <span style={{ color: A.textMuted }}>—</span>}
                      </td>
                      <td style={{ ...td(), color: A.textDim, minWidth: 180 }}>{p.note || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!collapsed && normBrief.layerUpdates && (normBrief.layerUpdates.summary || arr(normBrief.layerUpdates.rows).length > 0) && (
        <Card A={A} title="Layer & Theme Rotation Updates" sub="Pulled from ThemePulse Layers">
          {normBrief.layerUpdates.summary && (
            <div style={{ fontSize: 11.5, color: A.textDim, marginBottom: arr(normBrief.layerUpdates.rows).length ? 8 : 0, lineHeight: 1.45 }}>
              {normBrief.layerUpdates.summary}
            </div>
          )}
          {arr(normBrief.layerUpdates.rows).length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead style={{ position: "sticky", top: 0, background: A.bgCard, zIndex: 1 }}>
                  <tr>
                    <th style={th(A)}>Layer</th>
                    <th style={th(A)}>Status</th>
                    <th style={th(A, "right")}>Rank</th>
                    <th style={th(A, "right")}>1W</th>
                    <th style={th(A, "right")}>Today</th>
                    <th style={th(A, "right")}>Thr</th>
                    <th style={th(A)}>Leaders</th>
                    <th style={th(A)}>Update</th>
                  </tr>
                </thead>
                <tbody>
                  {arr(normBrief.layerUpdates.rows).map((l, i) => {
                    const stLow = l.status.toLowerCase();
                    const stCol = /lead/.test(stLow) ? A.green : /emerg|flip/.test(stLow) ? A.cyan : /weak/.test(stLow) ? "#f59e0b" : /brk|break/.test(stLow) ? A.red : A.textMuted;
                    return (
                      <tr key={`${l.layer}-${i}`}>
                        <td style={td()}>
                          <strong style={{ color: A.text }}>{l.layer}</strong>
                          {l.theme && l.theme !== l.layer && <div style={{ fontSize: 10, color: A.textMuted }}>{l.theme}</div>}
                        </td>
                        <td style={td()}>
                          {l.status ? (
                            <span style={{ fontSize: 10, fontWeight: 700, fontFamily: MONO, color: stCol }}>{l.status}</span>
                          ) : "—"}
                        </td>
                        <td style={{ ...td("right"), fontWeight: 700, color: rsC(l.rank) }}>{l.rank ?? "—"}</td>
                        <td style={{ ...td("right"), color: pc(l.delta1w) }}>{typeof l.delta1w === "number" ? `${l.delta1w > 0 ? "+" : ""}${l.delta1w}` : "—"}</td>
                        <td style={{ ...td("right"), fontWeight: 700, color: pc(l.todayPct) }}>{pct(l.todayPct, 2)}</td>
                        <td style={{ ...td("right"), color: pc(l.thrust) }}>{typeof l.thrust === "number" ? `${l.thrust > 0 ? "+" : ""}${l.thrust.toFixed(1)}` : "—"}</td>
                        <td style={td()}>
                          <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 6 }}>
                            {arr(l.leaders).map((tk) => <Tk key={tk} t={tk} />)}
                          </span>
                        </td>
                        <td style={{ ...td(), color: A.textDim, minWidth: 160 }}>{l.note || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {!collapsed && arr(normBrief.extendedMovers).length > 0 && (() => {
        const extRowsList = arr(normBrief.extendedMovers).map((m) => {
          const li = liveInfo(m.ticker);
          const isExt = Boolean(li?.extSession);
          const chg = isExt ? (li?.extChg ?? m.chgPct) : (li?.chg ?? m.chgPct);
          const px = isExt ? (li?.extPx ?? m.price) : (li?.px ?? m.price);
          const volNum = isExt ? (li?.extVol ?? null) : null;
          const volStr = isExt
            ? (li?.extVol != null ? fmtVol(li.extVol) : String(m.vol ?? "—"))
            : null;
          return { ...m, _li: li, _isExt: isExt, _chg: chg, _px: px, _volNum: volNum, _volStr: volStr };
        });
        const inExtNow = liveOn && extRowsList.some((r) => r._isExt);
        const extSessTag = extRowsList.find((r) => r._li?.extSession)?._li?.extSession === "premarket" ? "PM" : "AH";
        return (
        <Card
          A={A}
          title="Pre / after-market movers"
          sub={
            liveOn
              ? (inExtNow
                  ? `Showing live ${extSessTag === "PM" ? "pre-market" : "after-hours"} Chg% / Price / Vol (never mixed with prior RTH close)`
                  : "Showing live intraday Chg% / Price / ZVR vs original brief gap")
              : undefined
          }
        >
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, background: A.bgCard, zIndex: 1 }}><tr>
                {extTh("ticker", "Ticker", "left", true)}
                {extTh("session", "Session", "left", true)}
                {extTh("chg", liveOn ? (inExtNow ? `${extSessTag} Chg%` : "Live Chg") : "Chg")}
                {extTh("px", liveOn ? (inExtNow ? `${extSessTag} Px` : "Live Px") : "Price")}
                {extTh("zvr", liveOn ? (inExtNow ? `${extSessTag} Vol` : "ZVR / Vol") : "Vol")}
                {extTh("rs", "RS")}
                <th style={th(A)}>Catalyst</th><th style={th(A)}>Protocol</th>
              </tr></thead>
              <tbody>{sortWith(
                extRowsList,
                extSort,
                (r, k) => {
                  if (k === "chg") return r._chg ?? null;
                  if (k === "px") return r._px ?? null;
                  if (k === "zvr") return r._isExt ? r._volNum : (r._li?.zvr ?? null);
                  return r[k] ?? null;
                }
              ).map((m, i) => {
                const li = m._li;
                const isExt = m._isExt;
                const chg = m._chg;
                const px = m._px;
                const hasLiveChg = isExt ? li?.extChg != null : Boolean(li);
                const isCharted = chartTicker === m.ticker;
                return (
                  <tr
                    key={`${m.ticker}-${i}`}
                    data-nav={m.ticker}
                    className={isCharted ? "tp-click-row tp-row-active" : "tp-click-row"}
                    onClick={() => onTicker(m.ticker)}
                    style={{
                      cursor: "pointer",
                      background: isCharted ? A.bgHover : "transparent",
                      boxShadow: isCharted ? `inset 2px 0 0 ${A.green}` : "none",
                    }}
                  >
                    <td style={td()}><FlagButton t={m.ticker} A={A} /><Tk t={m.ticker} /></td>
                    <td style={td()}>{String(m.session ?? "")}</td>
                    <td style={{ ...td("right"), color: pc(chg), fontWeight: hasLiveChg ? 700 : 400 }}>
                      {pct(chg, 2)}
                      {hasLiveChg && typeof m.chgPct === "number" && Math.abs((chg ?? 0) - m.chgPct) >= 0.15 && (
                        <div style={{ fontSize: 10, color: A.textMuted }}>was {pct(m.chgPct, 1)}</div>
                      )}
                    </td>
                    <td style={td("right")}>{num(px)}</td>
                    <td style={td("right")}>
                      {isExt
                        ? m._volStr
                        : (li?.zvr != null ? <strong style={{ color: li.zvr >= 1.5 ? A.green : A.text }}>{li.zvr.toFixed(2)}x</strong> : String(m.vol ?? ""))}
                    </td>
                    <td style={{ ...td("right"), color: rsC(m.rs) }}>{m.rs ?? "—"}</td>
                    <td style={{ ...td(), color: A.textDim, minWidth: 200 }}>{String(m.catalyst ?? "")}<Src u={m.sourceUrl} /></td>
                    <td style={{ ...td(), color: A.textDim, minWidth: 200 }}>{String(m.protocol ?? "")}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </Card>
        );
      })()}

      {!collapsed && arr(normBrief.breakdowns).length > 0 && (
        <Card A={A} title="Breakdowns">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, background: A.bgCard, zIndex: 1 }}><tr>
                {brkTh("ticker", "Ticker", "left", true)}
                {brkTh("layer", "Layer", "left", true)}
                {liveOn && brkTh("chg", "Live Chg")}
                {brkTh("vs50", "vs 50d")}
                {brkTh("chg1mPct", "1M")}
                <th style={th(A)}>Catalyst</th>
              </tr></thead>
              <tbody>{sortWith(
                arr(normBrief.breakdowns).map((b) => {
                  const li = liveInfo(b.ticker);
                  return { ...b, _li: li, _vs50: li?.vs50 ?? b.vs50dPct };
                }),
                brkSort,
                (r, k) => {
                  if (k === "chg") return r._li?.chg ?? null;
                  if (k === "vs50") return r._vs50 ?? null;
                  return r[k] ?? null;
                }
              ).map((b, i) => {
                const li = b._li;
                const vs50 = b._vs50;
                const isCharted = chartTicker === b.ticker;
                return (
                  <tr
                    key={`${b.ticker}-${i}`}
                    data-nav={b.ticker}
                    className={isCharted ? "tp-click-row tp-row-active" : "tp-click-row"}
                    onClick={() => onTicker(b.ticker)}
                    style={{
                      cursor: "pointer",
                      background: isCharted ? A.bgHover : "transparent",
                      boxShadow: isCharted ? `inset 2px 0 0 ${A.green}` : "none",
                    }}
                  >
                    <td style={td()}><FlagButton t={b.ticker} A={A} /><Tk t={b.ticker} /></td>
                    <td style={td()}>{String(b.layer ?? "")}</td>
                    {liveOn && <td style={{ ...td("right"), color: pc(li?.chg), fontWeight: 700 }}>{pct(li?.chg, 2)}</td>}
                    <td style={{ ...td("right"), color: pc(vs50) }}>{pct(vs50)}</td>
                    <td style={{ ...td("right"), color: pc(b.chg1mPct) }}>{pct(b.chg1mPct)}</td>
                    <td style={{ ...td(), color: A.textDim, minWidth: 220 }}>{String(b.catalyst ?? "")}<Src u={b.sourceUrl} /></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </Card>
      )}

      {!collapsed && pulseEntries.length > 0 && (
        <Card A={A} title="Leading pulse">
          {pulseEntries.map(([k, list]) => {
            const niceLabel = k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
            return (
              <div key={k} style={{ fontSize: 11, padding: "4px 0", borderBottom: `1px solid ${A.border}` }}>
                <span style={{ color: A.textMuted, marginRight: 8, fontWeight: 600 }}>{niceLabel}</span>
                <span style={{ color: A.text }}>{list.map((x) => (typeof x === "string" ? x : String(x?.ticker || x?.note || ""))).filter(Boolean).join(" · ")}</span>
              </div>
            );
          })}
        </Card>
      )}

      {!collapsed && (arr(normBrief.radar).length > 0 || hasSkip) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {arr(normBrief.radar).length > 0 && (
            <div style={{ flex: "1 1 300px", minWidth: 0 }}>
              <Card A={A} title="Radar">
                {arr(normBrief.radar).map((r, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, fontSize: 11, padding: "4px 0", borderBottom: `1px solid ${A.border}` }}>
                    <span style={{ color: A.cyan, fontFamily: MONO, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{String(r.date ?? "")}</span>
                    <span style={{ color: A.text }}>{String(r.event ?? "")}</span>
                  </div>
                ))}
              </Card>
            </div>
          )}
          {hasSkip && (
            <div style={{ flex: "1 1 300px", minWidth: 0 }}>
              <Card A={A} title="Skip / traps">
                {skipIsArr ? (
                  st.map((item, i) => (
                    <div key={`${item?.ticker || i}`} style={{ fontSize: 11, padding: "4px 0", borderBottom: `1px solid ${A.border}` }}>
                      {item?.ticker && <span style={{ marginRight: 8 }}><Tk t={item.ticker} /></span>}
                      <span style={{ color: A.textDim }}>{String(item?.reason ?? item?.note ?? item ?? "")}</span>
                    </div>
                  ))
                ) : (
                  [["buyoutCapped", "Buyout-capped"], ["extended", "Extended"], ["stage4", "Stage 4"]].concat(
                    Object.keys(st).filter((k) => !["buyoutCapped", "extended", "stage4"].includes(k)).map((k) => [k, k]))
                    .filter(([k]) => arr(st[k]).length).map(([k, lab]) => (
                      <div key={k} style={{ fontSize: 11, padding: "4px 0", borderBottom: `1px solid ${A.border}` }}>
                        <span style={{ color: A.textMuted, marginRight: 8 }}>{lab}</span>
                        <span style={{ color: A.text }}>{arr(st[k]).map(String).join(" · ")}</span>
                      </div>
                    ))
                )}
              </Card>
            </div>
          )}
        </div>
      )}

      {!collapsed && showGoToBrief && goToAnalysis && goToAnalysis.totalMatched > 0 && (() => {
        const gc = goToAnalysis.gradeCounts || {};
        const gradeCol = (g) => (g === "A+" ? A.green : g === "A" ? A.cyan : g === "B" ? "#f59e0b" : A.textMuted);
        const visibleLeaders = goToThemeFocus
          ? goToAnalysis.leaders.filter((m) => m.theme === goToThemeFocus)
          : goToAnalysis.leaders;
        const aiWhyByTheme = new Map();
        if (Array.isArray(whyData?.themes)) {
          for (const item of whyData.themes) {
            if (item?.theme && item?.why) aiWhyByTheme.set(String(item.theme).toLowerCase(), item.why);
          }
        }
        const buildMacroForWhy = () => {
          const idxs = arr(rg.indexes);
          const findIdxChg = (sym) => {
            const li = liveInfo(sym);
            if (li?.chg != null) return +li.chg.toFixed(2);
            const hit = idxs.find((x) => String(x?.symbol || "").toUpperCase() === sym);
            return typeof hit?.chgPct === "number" ? +hit.chgPct.toFixed(2) : null;
          };
          const vixPx = mq?.macro?.vix?.price ?? mq?.quotes?.VIX?.price ?? null;
          const tnxPx = mq?.macro?.tnx?.price ?? mq?.quotes?.TNX?.price ?? null;
          return {
            spy: findIdxChg("SPY"),
            qqq: findIdxChg("QQQ"),
            iwm: findIdxChg("IWM"),
            vix: typeof vixPx === "number" ? +vixPx.toFixed(2) : null,
            us10y: typeof tnxPx === "number" ? +tnxPx.toFixed(2) : null,
            decision: rg.posture || mq?.decision || null,
            score: typeof mq?.score === "number" ? Math.round(mq.score) : null,
          };
        };
        const triggerWhy = (force = false) => {
          runBriefWhy(buildBriefWhyPayload({
            date: normBrief?.date || "",
            session: normBrief?.session || "intraday",
            macro: buildMacroForWhy(),
            analysis: goToAnalysis,
            force,
          }));
        };
        return (
          <Card
            A={A}
            title={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span>★ Go-To Screen Analysis — Theme Clusters &amp; Leading Tickers</span>
                <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 700, color: A.green }}>
                  {gc["A+"] || 0} A+
                </span>
                <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 700, color: A.cyan }}>
                  {gc.A || 0} A
                </span>
                <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 600, color: "#f59e0b" }}>
                  {gc.B || 0} B
                </span>
              </span>
            }
            sub={`${goToAnalysis.totalMatched} matched Go-To leaders · descending A+ Setup Grade & theme drivers${liveOn && at ? " · live quotes" : ""}`}
            right={
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <button
                  type="button"
                  disabled={whyLoading}
                  onClick={() => triggerWhy(Boolean(whyData))}
                  title="Run on-demand Gemini 2.5 Flash + Google Search synthesis explaining why these themes are leading today"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    background: whyData ? "rgba(168,85,247,0.16)" : "rgba(168,85,247,0.1)",
                    border: "1px solid rgba(168,85,247,0.5)",
                    color: "#c084fc",
                    borderRadius: 6,
                    padding: "3px 9px",
                    fontSize: 10.5,
                    fontWeight: 700,
                    cursor: whyLoading ? "wait" : "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {whyLoading ? "✨ Analyzing…" : whyData ? "↻ Refresh Why" : "✨ Analyze Why"}
                </button>
                {goToThemeFocus && (
                  <button
                    type="button"
                    onClick={() => setGoToThemeFocus(null)}
                    style={{
                      background: "transparent",
                      border: `1px solid ${A.border}`,
                      color: A.cyan,
                      borderRadius: 6,
                      padding: "2px 8px",
                      fontSize: 10.5,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Clear {goToThemeFocus} ✕
                  </button>
                )}
              </div>
            }
          >
            <AiDeskNotePanel
              A={A}
              data={whyData}
              loading={whyLoading}
              error={whyError}
              updatedAt={whyUpdatedAt}
              compact
              onTicker={onTicker}
              onRefresh={() => triggerWhy(true)}
            />
            {/* Theme Cluster "Why?" Cards */}
            {goToAnalysis.themeClusters.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 8, marginBottom: 12 }}>
                {goToAnalysis.themeClusters.slice(0, 6).map((c) => {
                  const focused = goToThemeFocus === c.theme;
                  const borderCol = c.aPlusCount > 0 ? A.green : c.aPlusACount > 0 ? A.cyan : A.border;
                  const aiWhy = aiWhyByTheme.get(String(c.theme || "").toLowerCase()) || null;
                  return (
                    <div
                      key={c.theme}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 8,
                        background: focused ? A.bgHover : A.bg,
                        border: `1px solid ${focused ? A.cyan : A.border}`,
                        borderLeft: `3px solid ${borderCol}`,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => setGoToThemeFocus((prev) => (prev === c.theme ? null : c.theme))}
                          title={`Click to filter the Go-To table below to ${c.theme}`}
                          style={{
                            background: "none",
                            border: "none",
                            padding: 0,
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "baseline",
                            gap: 5,
                            color: A.text,
                            fontWeight: 800,
                            fontSize: 12,
                          }}
                        >
                          <span>{c.theme}</span>
                          <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 700, color: A.textDim }}>
                            {c.count} {c.count === 1 ? "name" : "names"}
                          </span>
                          {c.aPlusACount > 0 && (
                            <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 800, color: c.aPlusCount > 0 ? A.green : A.cyan }}>
                              · {c.aPlusACount} A+/A
                            </span>
                          )}
                        </button>
                        <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 700, color: pc(c.avgChg) }}>
                          avg {pct(c.avgChg, 1)}
                          {c.breakoutCount > 0 && <span style={{ color: "#fbbf24", marginLeft: 5 }}>{c.breakoutCount} BO</span>}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: A.textDim, lineHeight: 1.45, marginTop: 4 }}>
                        <strong style={{ color: aiWhy ? "#c084fc" : A.text }}>
                          {aiWhy ? "✨ Why:" : "Why:"}
                        </strong>{" "}
                        {aiWhy || c.aiWhy || c.why}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                        {(c.topTickers || []).slice(0, 5).map((t) => (
                          <button
                            key={t.ticker}
                            type="button"
                            onClick={() => onTicker && onTicker(t.ticker)}
                            style={{
                              background: A.bgCard,
                              border: `1px solid ${chartTicker === t.ticker ? A.green : A.border}`,
                              borderRadius: 4,
                              padding: "1px 5px",
                              fontFamily: MONO,
                              fontSize: 10,
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              color: A.text,
                            }}
                          >
                            <strong>{t.ticker}</strong>
                            <span style={{ color: gradeCol(t.grade), fontWeight: 800 }}>{t.grade} {t.aPlusScore}</span>
                          </button>
                        ))}
                      </div>
                      {c.catalysts?.length > 0 && (
                        <div style={{ marginTop: 6, paddingTop: 5, borderTop: `1px solid ${A.border}`, display: "flex", flexDirection: "column", gap: 2 }}>
                          {c.catalysts.slice(0, 2).map((h, idx) => (
                            <div key={`${h.ticker}-${idx}`} style={{ fontSize: 10.5, color: A.textMuted, lineHeight: 1.35 }}>
                              <strong style={{ color: A.textDim, fontFamily: MONO }}>{h.ticker}:</strong> {h.title}
                              <Src u={h.url} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Leading Tickers by Descending Grade Table */}
            <div style={{ overflowX: "auto", maxHeight: 380, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead style={{ position: "sticky", top: 0, background: A.bgCard, zIndex: 1 }}>
                  <tr>
                    <th style={th(A, "left")}>Grade</th>
                    <th style={th(A, "left")}>Ticker</th>
                    <th style={th(A, "left")}>Theme · Layer</th>
                    <th style={th(A, "right")}>Chg%</th>
                    <th style={th(A, "right")}>Thr</th>
                    <th style={th(A, "right")}>ZVR</th>
                    <th style={th(A, "right")}>CR%</th>
                    <th style={th(A, "right")}>RS</th>
                    <th style={th(A, "left")}>Catalyst / Footprint</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLeaders.slice(0, 20).map((m) => {
                    const gcCol = gradeCol(m.grade);
                    const isCharted = chartTicker === m.ticker;
                    return (
                      <tr
                        key={m.ticker}
                        data-nav={m.ticker}
                        className={isCharted ? "tp-click-row tp-row-active" : "tp-click-row"}
                        onClick={() => onTicker && onTicker(m.ticker)}
                        style={{
                          cursor: "pointer",
                          background: isCharted ? A.bgHover : "transparent",
                          boxShadow: isCharted ? `inset 2px 0 0 ${A.green}` : "none",
                        }}
                      >
                        <td style={td()} title={m.aPlusTip}>
                          <span
                            style={{
                              fontFamily: MONO,
                              fontSize: 10,
                              fontWeight: 800,
                              padding: "1px 5px",
                              borderRadius: 4,
                              color: gcCol,
                              background: `${gcCol}1a`,
                              border: `1px solid ${gcCol}66`,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {m.grade} {m.aPlusScore}
                          </span>
                        </td>
                        <td style={{ ...td(), whiteSpace: "nowrap" }}>
                          <FlagButton t={m.ticker} A={A} />
                          <Tk t={m.ticker} />
                          {m.isBreakout ? <span title="Breakout" style={{ marginLeft: 3, fontSize: 10 }}>🔥</span> : m.qualifiesZanger ? <span title="Volume Mover" style={{ marginLeft: 3, fontSize: 10 }}>⚡</span> : null}
                          {m.inAdr5Liq && <span title="ADR 5%+ Liquid" style={{ marginLeft: 2, fontSize: 10 }}>💧</span>}
                        </td>
                        <td style={{ ...td(), fontSize: 11 }}>
                          <strong style={{ color: A.text }}>{m.theme}</strong>
                          {m.layer && m.layer !== "—" && <span style={{ color: A.textMuted }}> · {m.layer}</span>}
                        </td>
                        <td style={{ ...td("right"), color: pc(m.chg), fontWeight: 700 }}>{pct(m.chg, 1)}</td>
                        <td style={{ ...td("right"), color: m.thrust == null ? A.textMuted : m.thrust > 0 ? A.green : A.red, fontWeight: m.thrust != null && Math.abs(m.thrust) >= 1.5 ? 800 : 500 }}>
                          {m.thrust != null ? `${m.thrust > 0 ? "+" : ""}${m.thrust.toFixed(1)}` : "—"}
                        </td>
                        <td style={{ ...td("right"), color: (m.zvr ?? 0) >= 1.5 ? A.green : A.textDim }}>
                          {m.zvr != null ? `${m.zvr.toFixed(1)}x` : "—"}
                        </td>
                        <td style={{ ...td("right"), color: (m.cr ?? 0) >= 75 ? A.green : A.textDim }}>
                          {m.cr != null ? `${m.cr}%` : "—"}
                        </td>
                        <td style={{ ...td("right"), color: rsC(m.rs), fontWeight: 700 }}>{m.rs ?? "—"}</td>
                        <td style={{ ...td(), fontSize: 10.5, color: A.textDim, maxWidth: 260 }}>
                          {m.topHeadline ? (
                            <>
                              {m.topHeadline}
                              <Src u={m.topHeadlineUrl} />
                            </>
                          ) : (
                            <span style={{ fontFamily: MONO, color: A.textMuted }}>
                              {[
                                m.ppCount >= 2 ? `PP${m.ppCount}` : null,
                                m.emaStack ? "EMA Stack" : null,
                                m.breakoutTypes?.length ? m.breakoutTypes.join("+") : null,
                              ].filter(Boolean).join(" · ") || "—"}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })()}
    </div>
  );
}

function BriefPanel(props) {
  const { A } = props;
  const [mode, setMode] = useState("written");
  const [activeSec, setActiveSec] = useState("sec-written");
  const [breadthTab, setBreadthTab] = useState("breadth");
  const [breadthFocus, setBreadthFocus] = useState(null);

  const jumpSections = useMemo(() => [
    { id: "sec-written", scrollId: "sec-written", label: mode === "live" ? "Live Brief" : "Written" },
    { id: "sec-breadth", scrollId: "sec-breadth", label: "Breadth", cardTab: "breadth" },
    { id: "sec-layers", scrollId: "sec-layers", label: "Layers", cardTab: "layers" },
    { id: "sec-portfolio", scrollId: "sec-portfolio", label: "Portfolio" },
    { id: "sec-breakouts", scrollId: "sec-breakouts", label: "Breakouts" },
    { id: "sec-followthrough", scrollId: "sec-followthrough", label: "Follow-Through" },
  ], [mode]);

  useEffect(() => {
    let raf = 0;
    const scrollTargets = ["sec-written", "sec-breadth", "sec-layers", "sec-portfolio", "sec-breakouts", "sec-followthrough"];
    const updateActive = () => {
      raf = 0;
      const threshold = 116;
      let current = "sec-written";
      for (const domId of scrollTargets) {
        const el = document.getElementById(domId);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= threshold) current = domId;
      }
      if (current === "sec-layers" && breadthTab !== "layers") current = "sec-breadth";
      setActiveSec((prev) => (prev === current ? prev : current));
    };
    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(updateActive);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    updateActive();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [jumpSections, breadthTab]);

  const jumpTo = (sec) => {
    setActiveSec(sec.id);
    if (sec.cardTab) {
      setBreadthTab(sec.cardTab);
      setBreadthFocus({ tab: sec.cardTab, seq: Date.now() });
    }
    document.getElementById(sec.scrollId || sec.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const modeSwitch = (
    <div style={{ display: "inline-flex", border: `1px solid ${A.borderLight || A.border}`, borderRadius: 6, overflow: "hidden", background: A.bgRow }}>
      {[["written", "Written"], ["live", "Live"]].map(([k, l]) => {
        const active = mode === k;
        return (
          <button
            key={k}
            type="button"
            onClick={() => setMode(k)}
            style={{
              background: active ? A.bgHover : "transparent",
              color: active ? A.text : A.textMuted,
              border: "none",
              padding: "3px 10px",
              fontSize: 11,
              fontWeight: active ? 700 : 600,
              cursor: "pointer",
              transition: "background 0.15s, color 0.15s",
            }}
          >
            {l}
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      <div
        role="navigation"
        aria-label="Brief sections"
        style={{
          position: "sticky",
          top: 48,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          marginBottom: 10,
          background: A.bgCardGlass || A.bgCard,
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          border: `1px solid ${A.border}`,
          borderBottom: `1px solid ${A.borderLight || A.border}`,
          borderRadius: 8,
          boxShadow: A.shadow,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 4, overflowX: "auto", flexWrap: "nowrap", minWidth: 0 }}>
          {jumpSections.map((s) => {
            const active = activeSec === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => jumpTo(s)}
                style={{
                  background: active ? A.glowGreen : "transparent",
                  border: `1px solid ${active ? A.green : "transparent"}`,
                  color: active ? A.green : A.textDim,
                  borderRadius: 6,
                  padding: "3px 9px",
                  fontSize: 11,
                  fontWeight: active ? 700 : 600,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                  fontVariantNumeric: "tabular-nums",
                  transition: "background 0.15s, border-color 0.15s, color 0.15s",
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        <div style={{ marginLeft: "auto", flexShrink: 0 }}>
          {modeSwitch}
        </div>
      </div>
      <div id="sec-written" style={{ scrollMarginTop: 96 }}>
        {mode === "written"
          ? (
            <WrittenBrief
              A={A}
              stockMap={props.stockMap}
              tickerLayer={props.tickerLayer}
              layers={props.layers}
              themes={props.themes}
              tiers={props.tiers}
              onTicker={props.onTicker}
              chartTicker={props.chartTicker}
            />
          )
          : <LiveBrief {...props} />}
      </div>
      <ZangerBriefSection
        A={A}
        stockMap={props.stockMap}
        tickerLayer={props.tickerLayer}
        layers={props.layers}
        themes={props.themes}
        members={props.members}
        tiers={props.tiers}
        breadth={props.breadth}
        monitor={props.monitor}
        pipeline={props.pipeline}
        indexQuotes={props.indexQuotes}
        idxBars={props.idxBars}
        portfolio={props.portfolio}
        setPortfolio={props.setPortfolio}
        watchlist={props.watchlist}
        setWatchlist={props.setWatchlist}
        onTicker={props.onTicker}
        chartTicker={props.chartTicker}
        onLayer={props.layerOfTicker}
        onTheme={props.onTheme}
        breadthFocus={breadthFocus}
        onBreadthTabChange={setBreadthTab}
      />
    </>
  );
}

// ── Brief (BRIEF view) ────────────────────────────────────────────────────
// The market brief rebuilt from live ThemePulse data, in the order the static
// written brief uses: headline strip → strongest stocks in the strongest
// themes (RS & EPS >= 80) → pre/after-market → rotation → emerging layers
// (confirmed vs unconfirmed) → breakdowns (leaders cracking, leaders breaking
// down). Every ticker charts on click; every layer / theme opens its members.
const isRising = (l) => l.st === "emerg" || (l.st !== "lead" && (l.now - (l.m1 ?? l.now)) >= 10 && (l.trend?.slope ?? 0) > 0);

function LiveBrief({ A, themes, layers, stockMap, tickerLayer, members, brk, pipeline, dates, theme, lb,
  onTicker, chartTicker, onLayer, onTheme, layerOfTicker, modeSwitch }) {
  const [openLayerKey, setOpenLayerKey] = useState(null);
  const toggleInlineLayer = (l) => {
    if (!l) return;
    const next = openLayerKey === l.key ? null : l.key;
    setOpenLayerKey(next);
    if (next && onTicker) {
      const top = (members?.[l.key] || (l.holds || []).map((h) => h.t))
        .filter((t) => stockMap?.[t])
        .sort((a, b) => (stockMap[b]?.rs_rank ?? 0) - (stockMap[a]?.rs_rank ?? 0))[0];
      if (top) onTicker(top);
    }
  };
  const pct = (v, dg = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(dg)}%`);
  const pc = (v) => (v == null ? A.textMuted : v >= 0 ? A.green : A.red);
  const rsC = (v) => (v >= 90 ? A.green : v >= 70 ? A.yellow : v != null ? A.red : A.textMuted);
  const epsC = (v) => (v >= 80 ? A.green : v >= 50 ? A.yellow : v != null ? A.red : A.textMuted);
  const tks = (l) => members[l.key] || (l.holds || []).map((h) => h.t);

  const top = useMemo(() => [...themes].sort((a, b) => b.now - a.now).slice(0, 5), [themes]);
  const byM1 = useMemo(() => [...themes].filter((t) => t.m1 != null).sort((a, b) => (b.now - b.m1) - (a.now - a.m1)), [themes]);

  // strongest stocks in the strongest themes: RS >= 80 and EPS >= 80
  const strongest = useMemo(() => top.map((t) => {
    const set = [...new Set(t.layers.flatMap(tks))];
    const rows = set.map((x) => stockMap[x]).filter((s) => s && (s.rs_rank ?? 0) >= 80 && (s.eps_rating ?? 0) >= 80)
      .sort((a, b) => (b.rs_rank - a.rs_rank) || (b.eps_rating - a.eps_rating)).slice(0, 6);
    return { t, rows, leading: t.layers.filter((l) => l.st === "lead").length };
  }), [top, stockMap, members]); // eslint-disable-line react-hooks/exhaustive-deps

  const emerging = useMemo(() => layers.filter(isRising)
    .map((l) => ({ l, cf: l.conf, names: tks(l).map((x) => stockMap[x]).filter((s) => s && (s.rs_rank ?? 0) >= 80)
      .sort((a, b) => b.rs_rank - a.rs_rank).slice(0, 4) }))
    .sort((a, b) => ((b.cf?.passed.length ?? 0) - (a.cf?.passed.length ?? 0)) || ((b.l.now - b.l.m1) - (a.l.now - a.l.m1)))
    .slice(0, 12), [layers, stockMap, members]); // eslint-disable-line react-hooks/exhaustive-deps

  const exiting = useMemo(() => layers.filter((l) => (l.conf?.lx ?? 0) >= 2 && (l.st === "lead" || l.st === "weak" || l.now >= 70))
    .sort((a, b) => b.conf.lx - a.conf.lx).slice(0, 10), [layers]);
  const totalExits = layers.reduce((n, l) => n + (l.conf?.lx ?? 0), 0);
  const leadingN = layers.filter((l) => l.st === "lead").length;

  const H = ({ children, sub }) => (
    <div style={{ margin: "4px 0 8px" }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: A.text, letterSpacing: "-0.01em" }}>{children}</div>
      {sub && <div style={{ fontSize: 11, color: A.textMuted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
  const Tk = ({ t }) => (
    <><span onClick={(e) => { e.stopPropagation(); onTicker(t); }} style={{ cursor: "pointer", fontFamily: MONO, fontWeight: 700,
      color: chartTicker === t ? A.green : A.text }}>{t}</span><TierMark t={t} /></>
  );
  const Metric = ({ big, color, label, sub }) => (
    <div style={{ flex: "1 1 180px", minWidth: 0 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{big}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: A.text, marginTop: 2 }}>{label}</div>
      <div style={{ fontSize: 10, color: A.textMuted, marginTop: 2, lineHeight: 1.4 }}>{sub}</div>
    </div>
  );
  const up = byM1[0], dn = byM1[byM1.length - 1];

  return (
    <div>
      <Card A={A} title="Market brief" sub={`Live from ThemePulse · layers as of ${dates[dates.length - 1] || "—"}`}
        right={modeSwitch}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, borderTop: `1px solid ${A.border}`, borderBottom: `1px solid ${A.border}`, padding: "10px 0" }}>
          {top[0] && <Metric big={`${top[0].theme} ${Math.round(top[0].now)}`} color={A.green}
            label={`Strongest themes${top[1] ? ` · then ${top[1].theme} ${Math.round(top[1].now)}` : ""}`}
            sub={`${leadingN} layers leading (rank ≥ 88) across the universe`} />}
          {up && dn && <Metric big={`${up.theme} +${Math.round(up.now - up.m1)}`} color={A.cyan}
            label="Biggest 1-month rotation in"
            sub={`Out: ${dn.theme} ${Math.round(dn.now - dn.m1)} · rank change over a month`} />}
          <Metric big={`${totalExits} exits`} color={totalExits ? A.red : A.textMuted} label="Leaders cracking this week"
            sub={exiting[0] ? `Most in ${exiting[0].name} (${exiting[0].conf.lx}) — RS 90+ names now below the 50-day or under RS 80` : "No layer has 2+ leaders cracking"} />
        </div>
      </Card>

      <Card A={A} title="Strongest stocks in the strongest themes" sub="Top 5 themes by rank · members with RS ≥ 80 and EPS ≥ 80 · click a ticker to chart, a theme or layer to open its stocks">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ position: "sticky", top: 0, background: A.bgCard, zIndex: 1 }}><tr>
              <th style={th(A)}>Ticker</th><th style={th(A)}>Layer</th>
              <th style={th(A, "right")}>RS</th><th style={th(A, "right")} title={EPS_TIP}>EPS</th>
              <th style={th(A, "right")}>vs 50d</th><th style={th(A, "right")}>Off high</th><th style={th(A, "right")}>1M</th>
            </tr></thead>
            <tbody>
              {strongest.map(({ t, rows, leading }) => (
                <React.Fragment key={t.themeId}>
                  <tr className="tp-click-row" onClick={() => onTheme(t.themeId)} style={{ cursor: "pointer" }} title="Show every stock in this theme">
                    <td colSpan={7} style={{ ...td(A), paddingTop: 10, color: A.text, fontWeight: 700, borderBottom: `1px solid ${A.textDim}` }}>
                      {t.theme} <span style={{ color: statusColor(t.st, A), fontFamily: MONO }}>{Math.round(t.now)}</span>
                      <span style={{ color: A.textMuted, fontWeight: 400, fontSize: 11 }}> · <span style={{ fontFamily: MONO }}>{leading}/{t.layers.length}</span> layers leading · 1m <Delta v={t.now - t.m1} A={A} /></span>
                    </td>
                  </tr>
                  {rows.length ? rows.map((s) => {
                    const L = tickerLayer[s.ticker];
                    const isCharted = chartTicker === s.ticker;
                    return (
                      <tr
                        key={s.ticker}
                        data-nav={s.ticker}
                        className={isCharted ? "tp-click-row tp-row-active" : "tp-click-row"}
                        onClick={() => onTicker(s.ticker)}
                        style={{
                          cursor: "pointer",
                          background: isCharted ? A.bgHover : "transparent",
                          boxShadow: isCharted ? `inset 2px 0 0 ${A.green}` : "none",
                        }}
                      >
                        <td style={td(A)}><FlagButton t={s.ticker} A={A} /><Tk t={s.ticker} /></td>
                        <td style={{ ...td(A), fontSize: 11 }}><LayerLink r={{ t: s.ticker, layer: L?.name, layerSt: L?.st }} A={A} onLayer={layerOfTicker} /></td>
                        <td style={{ ...td(A, "right"), color: rsC(s.rs_rank), fontWeight: 700 }}>{s.rs_rank}</td>
                        <td title={s.eps_tip || ""} style={{ ...td(A, "right"), color: epsC(s.eps_rating) }}>{s.eps_rating}{s.eps_accel ? <span style={{ color: A.green, fontSize: 9.5 }}>▲</span> : null}</td>
                        <td style={{ ...td(A, "right"), color: pc(s.sma50_pct) }}>{pct(s.sma50_pct)}</td>
                        <td style={td(A, "right")}>{pct(s.off_52w_high)}</td>
                        <td style={{ ...td(A, "right"), color: pc(s.return_1m) }}>{pct(s.return_1m)}</td>
                      </tr>
                    );
                  }) : (
                    <tr><td colSpan={7} style={{ ...td(A), color: A.textMuted, fontSize: 11 }}>No member clears RS 80 and EPS 80.</td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card A={A} title="Pre-market & after-hours movers">
        <ExtHoursMovers A={A} pipeline={pipeline} stockMap={stockMap} tickerLayer={tickerLayer} onTicker={onTicker} chartTicker={chartTicker} onLayer={layerOfTicker} />
      </Card>

      <Card A={A} title="Rotation" sub="RS rank change by layer or theme">
        <RotationView A={A} layers={layers} themes={themes} dates={dates} theme={theme} lb={lb}
          onLayer={onLayer} onTheme={(id) => onTheme(id)} />
      </Card>

      <Card A={A} title="Emerging layers" sub="Rank rising (Emerging, or +10 in a month and still climbing) · confirmed = 2+ of accumulation days, money flowing in, new RS 90+ leaders · early rotation backtested negative, so unconfirmed is a watchlist only">
        {!emerging.length ? <div style={{ fontSize: 11, color: A.textMuted }}>None.</div> : emerging.map(({ l, cf, names }) => {
          const ok = (cf?.passed.length ?? 0) >= 2;
          const open = openLayerKey === l.key;
          const c = statusColor(l.st, A);
          return (
            <div key={l.key} style={{ borderBottom: `1px solid ${A.border}` }}>
              <div onClick={() => toggleInlineLayer(l)} title={open ? "Collapse members" : "Expand members below"}
                style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", padding: "6px 0", cursor: "pointer", background: open ? A.bgHover : "transparent", boxShadow: open ? `inset 3px 0 0 ${c}` : "none", paddingLeft: open ? 8 : 0 }}>
                <span style={{ minWidth: 170, color: A.text, fontWeight: 600, fontSize: 12 }}>
                  <span style={{ color: open ? c : A.textMuted, fontSize: 10, marginRight: 5, fontFamily: MONO }}>{open ? "▾" : "▸"}</span>
                  {l.name} <span style={{ color: A.textMuted, fontWeight: 400, fontSize: 10 }}>{l.theme}</span>
                </span>
                <span style={{ fontSize: 11, color: c, fontWeight: 700, minWidth: 70, fontVariantNumeric: "tabular-nums" }}><span style={{ fontFamily: MONO }}>{l.now}</span> <span style={{ color: A.textMuted, fontWeight: 400 }}>1m</span> <Delta v={l.now - l.m1} A={A} /></span>
                <span style={{ fontSize: 10, fontWeight: 700, fontFamily: MONO, padding: "1px 6px", borderRadius: 4, border: `1px solid ${ok ? A.green : A.textMuted}`, color: ok ? A.green : A.textMuted }}>
                  {cf ? (ok ? "confirmed" : "unconfirmed") : "no volume data"}
                </span>
                {cf?.passed.length ? <span style={{ fontSize: 10, color: A.textMuted }}>{cf.passed.map((k) => CONF_LABEL[k]).join(" · ")}</span> : null}
                <span style={{ fontSize: 11, marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>
                  {names.map((s) => <span key={s.ticker} style={{ marginLeft: 8 }}><Tk t={s.ticker} /> <span style={{ color: rsC(s.rs_rank), fontSize: 10, fontFamily: MONO }}>{s.rs_rank}</span></span>)}
                </span>
              </div>
              {open && (
                <div style={{ padding: "8px 10px 10px 12px", background: A.bg, boxShadow: `inset 3px 0 0 ${c}` }}>
                  <LayerMembers A={A} layer={l} tickers={tks(l)} stockMap={stockMap} onTicker={onTicker} chartTicker={chartTicker} maxHeight={340} onClose={() => setOpenLayerKey(null)} />
                </div>
              )}
            </div>
          );
        })}
      </Card>

      <Card A={A} title="Breakdowns" sub="Layers losing leaders this week (were RS 90+, now below the 50-day or under RS 80), then individual leaders breaking down">
        {exiting.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            {exiting.map((l) => {
              const open = openLayerKey === l.key;
              const c = statusColor(l.st, A);
              return (
                <div key={l.key} style={{ borderBottom: `1px solid ${A.border}` }}>
                  <div onClick={() => toggleInlineLayer(l)} title={open ? "Collapse members" : "Expand members below"}
                    style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", padding: "5px 0", cursor: "pointer", background: open ? A.bgHover : "transparent", boxShadow: open ? `inset 3px 0 0 ${c}` : "none", paddingLeft: open ? 8 : 0 }}>
                    <span style={{ minWidth: 170, color: A.text, fontWeight: 600, fontSize: 12 }}>
                      <span style={{ color: open ? c : A.textMuted, fontSize: 10, marginRight: 5, fontFamily: MONO }}>{open ? "▾" : "▸"}</span>
                      {l.name} <span style={{ color: A.textMuted, fontWeight: 400, fontSize: 10 }}>{l.theme}</span>
                    </span>
                    <span style={{ fontSize: 11, color: A.red, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}><span style={{ fontFamily: MONO }}>{l.conf.lx}</span> out</span>
                    <span style={{ fontSize: 11 }}>{l.conf.lxT.slice(0, 10).map((t) => <span key={t} style={{ marginRight: 8 }}><Tk t={t} /></span>)}</span>
                  </div>
                  {open && (
                    <div style={{ padding: "8px 10px 10px 12px", background: A.bg, boxShadow: `inset 3px 0 0 ${c}` }}>
                      <LayerMembers A={A} layer={l} tickers={tks(l)} stockMap={stockMap} onTicker={onTicker} chartTicker={chartTicker} maxHeight={340} onClose={() => setOpenLayerKey(null)} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <H sub="Held the top RS decile ≥ 40% of the quarter, now RS < 70 or ≥ 8% below the 50-day">Leaders breaking down</H>
        <StockTable rows={brk.slice(0, 20)} A={A} onTicker={onTicker} chartTicker={chartTicker} mode="brk" onLayer={layerOfTicker} />
      </Card>
    </div>
  );
}


export default BriefPanel;
