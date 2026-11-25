import { useEffect, useMemo, useState } from "react";
import { authFetch } from "../utils.js";
import {
  AdrFilter,
  Card,
  CopyTickersBtn,
  FlagButton,
  MONO,
  RslDot,
  TierMark,
  th,
  td,
  useRvolProfiles,
  useScanQuotes,
  zvrFor,
} from "./core.jsx";
import {
  NDX_CONSTITUENTS,
  NDX_GROUPS,
  NDX_TICKERS,
  computeNdxInternals,
  computeQqqTechnicals,
} from "./qqqMath.js";

const BENCH_TKS = ["QQQ", "QQQE", "SPY", "IWM", "TQQQ", "SQQQ"];
const ALL_QUOTE_TKS = [...new Set([...BENCH_TKS, ...NDX_TICKERS])];
const STAGE_COLOR = { 1: "#64748b", 2: "#3b82f6", 3: "#eab308", 4: "#ec4899" };
const GROUP_COLOR = Object.fromEntries(NDX_GROUPS.map((g) => [g.id, g.color]));
const GROUP_SHORT = { mag7: "MAG7", semi: "SEMI", soft: "SOFT", cons: "CONS", health: "HLTH", ind: "IND" };

const fmtPx = (v) => (typeof v === "number" && Number.isFinite(v) ? `$${v.toFixed(2)}` : "—");
const fmtPct = (v, dg = 1) => (typeof v === "number" && Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(dg)}%` : "—");
const fmtBps = (v) => (typeof v === "number" && Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(1)}` : "—");

function MiniBar({ title, pct, left, right, color, A }) {
  const safe = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: A.text }}>{title}</span>
        <span style={{ fontSize: 12, fontWeight: 800, color, fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
          {Number.isFinite(pct) ? `${Math.round(pct)}%` : "—"}
        </span>
      </div>
      <div style={{ height: 7, width: "100%", borderRadius: 999, background: A.border, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${safe}%`, background: color, borderRadius: 999, transition: "width 0.3s ease" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: 10.5, color: A.textMuted, fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </div>
  );
}

export default function QqqPanel({
  A,
  stockMap,
  tickerLayer = {},
  indexQuotes,
  portfolio = [],
  setPortfolio,
  watchlist = [],
  setWatchlist,
  onTicker,
  chartTicker,
}) {
  const { quotes, at } = useScanQuotes(ALL_QUOTE_TKS, true);
  const profiles = useRvolProfiles();
  const [qqqBars, setQqqBars] = useState([]);
  const [mq, setMq] = useState(null);
  const [groupFilter, setGroupFilter] = useState("all"); // all | mag7 | semi | soft | cons | health | ind | bo | weak
  const [minAdr, setMinAdr] = useState(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState({ k: "thrust", d: -1 });
  const [activeSec, setActiveSec] = useState("qqq-tech");
  const [noHealth, setNoHealth] = useState(() => {
    try { return (localStorage.getItem("tp-no-health") ?? localStorage.getItem("tp-no-bio")) === "1"; } catch { return false; }
  });

  const toggleNoHealth = () => {
    setNoHealth((prev) => {
      const next = !prev;
      try { localStorage.setItem("tp-no-health", next ? "1" : "0"); } catch { /* ignore */ }
      try { window.dispatchEvent(new CustomEvent("tp-no-health", { detail: next })); } catch { /* ignore */ }
      return next;
    });
  };
  useEffect(() => {
    const onSync = (e) => setNoHealth(Boolean(e?.detail));
    window.addEventListener("tp-no-health", onSync);
    return () => window.removeEventListener("tp-no-health", onSync);
  }, []);

  // Fetch daily QQQ OHLC bars for exact 8/10/21 EMA, 50/200 SMA, ATR14, and key swing levels
  useEffect(() => {
    let alive = true;
    authFetch("/api/ohlc?ticker=QQQ&interval=1d", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && Array.isArray(d?.ohlc)) setQqqBars(d.ohlc);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Poll /api/market-quality every 60s for live NQ=F futures & VIX
  useEffect(() => {
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
  }, []);

  const getBench = (tk) => quotes.get(tk) || indexQuotes?.[tk] || null;
  const qqqQ = getBench("QQQ");
  const qqqeQ = getBench("QQQE");
  const spyQ = getBench("SPY");
  const iwmQ = getBench("IWM");
  const tqqqQ = getBench("TQQQ");
  const sqqqQ = getBench("SQQQ");

  const tech = useMemo(
    () => computeQqqTechnicals(qqqBars, qqqQ, stockMap?.QQQ || null),
    [qqqBars, qqqQ, stockMap]
  );
  const qqqZvr = useMemo(
    () => (stockMap?.QQQ ? zvrFor(stockMap.QQQ, qqqQ, profiles) : null),
    [stockMap, qqqQ, profiles]
  );

  const internals = useMemo(
    () => computeNdxInternals({ constituents: NDX_CONSTITUENTS, stockMap, quotes, tickerLayer, profiles }),
    [stockMap, quotes, tickerLayer, profiles]
  );

  const nqFut = useMemo(() => {
    const futs = Array.isArray(mq?.futures) ? mq.futures : [];
    return futs.find((f) => /nasdaq|nq/i.test(String(f?.name || f?.ticker || ""))) || null;
  }, [mq]);

  const vixTape = useMemo(() => {
    const tape = Array.isArray(mq?.tape) ? mq.tape : [];
    return tape.find((t) => t?.ticker === "VIX") || null;
  }, [mq]);

  const pfSet = useMemo(() => new Set(portfolio || []), [portfolio]);
  const wlSet = useMemo(() => new Set(watchlist || []), [watchlist]);
  const toggleList = (t, target) => {
    const setter = target === "pf" ? setPortfolio : setWatchlist;
    if (!setter) return;
    setter((prev) => ((prev || []).includes(t) ? prev.filter((x) => x !== t) : [...(prev || []), t]));
  };

  const boCount = useMemo(() => internals.rows.filter((r) => r.isBreakout).length, [internals.rows]);
  const weakCount = useMemo(() => internals.rows.filter((r) => (r.chg ?? 0) <= -2 || (r.sma50 ?? 0) < -5).length, [internals.rows]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return internals.rows.filter((r) => {
      if (noHealth && r.isHealth) return false;
      if (minAdr != null && (r.adr ?? -1) < minAdr) return false;
      if (groupFilter === "bo" && !r.isBreakout) return false;
      else if (groupFilter === "weak" && !((r.chg ?? 0) <= -2 || (r.sma50 ?? 0) < -5)) return false;
      else if (groupFilter !== "all" && groupFilter !== "bo" && groupFilter !== "weak" && !r.groups.includes(groupFilter)) return false;
      if (q && !r.ticker.toLowerCase().includes(q) && !r.company.toLowerCase().includes(q) && !r.layer.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [internals.rows, groupFilter, minAdr, noHealth, query]);

  const sortedRows = useMemo(() => {
    const { k, d } = sort;
    return [...filteredRows].sort((a, b) => {
      const va = a[k], vb = b[k];
      if (va == null && vb == null) return a.ticker.localeCompare(b.ticker);
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string" || typeof vb === "string") {
        return String(va).localeCompare(String(vb)) * d || a.ticker.localeCompare(b.ticker);
      }
      return (va - vb) * d || a.ticker.localeCompare(b.ticker);
    });
  }, [filteredRows, sort]);

  const pc = (v) => (v == null ? A.textMuted : v > 0 ? A.green : v < 0 ? A.red : A.textDim);
  const rsC = (v) => (v >= 90 ? A.green : v >= 70 ? A.yellow : v != null ? A.red : A.textMuted);

  const chipStyle = (active, accent = A.green) => ({
    background: active ? `${accent}20` : "transparent",
    border: `1px solid ${active ? accent : A.border}`,
    color: active ? accent : A.textDim,
    borderRadius: 6,
    padding: "2px 8px",
    fontSize: 11,
    fontWeight: active ? 700 : 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "background-color 140ms ease, border-color 140ms ease, color 140ms ease",
  });

  const col = (k, label, align = "right", title, textDefault = false) => (
    <th
      key={k}
      title={title}
      onClick={() => setSort((p) => ({ k, d: p.k === k ? -p.d : (textDefault ? 1 : -1) }))}
      style={{
        ...th(A, align),
        padding: "5px 4px",
        fontSize: 10,
        letterSpacing: 0.25,
        cursor: "pointer",
        userSelect: "none",
        color: sort.k === k ? A.text : A.textMuted,
      }}
    >
      {label}{sort.k === k ? (sort.d < 0 ? "▼" : "▲") : ""}
    </th>
  );
  const mtd = (align = "left", extra) => ({ ...td(A, align), padding: "5px 4px", fontSize: 11, ...extra });

  const jumpTo = (id) => {
    setActiveSec(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const qqqChg = tech.chgPct;
  const qqqeChg = qqqeQ?.change ?? null;
  const spyChg = spyQ?.change ?? null;
  const iwmChg = iwmQ?.change ?? null;
  const vsQqqe = qqqChg != null && qqqeChg != null ? +(qqqChg - qqqeChg).toFixed(2) : null;
  const vsSpy = qqqChg != null && spyChg != null ? +(qqqChg - spyChg).toFixed(2) : null;
  const vsIwm = qqqChg != null && iwmChg != null ? +(qqqChg - iwmChg).toFixed(2) : null;

  const stackTone = tech.emaStack === "BULLISH" ? A.green : tech.emaStack === "BEARISH" ? A.red : "#f59e0b";
  const spreadLabel = internals.concentrationSpread == null
    ? null
    : internals.concentrationSpread >= 0.6
      ? { text: "Mega-Cap Led", color: "#f59e0b" }
      : internals.concentrationSpread <= -0.6
        ? { text: "Broadening", color: A.green }
        : { text: "Balanced", color: A.cyan };

  return (
    <div>
      {/* Sticky section jump bar */}
      <div
        role="navigation"
        aria-label="QQQ sections"
        style={{
          position: "sticky",
          top: 48,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: 6,
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
        {[
          ["qqq-tech", "Technicals"],
          ["qqq-internals", "NDX Breadth"],
          ["qqq-leverage", "TQQQ & Levels"],
          ["qqq-holdings", `Holdings (${internals.count})`],
        ].map(([id, lbl]) => {
          const active = activeSec === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => jumpTo(id)}
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
              }}
            >
              {lbl}
            </button>
          );
        })}
        <span style={{ marginLeft: "auto", fontSize: 10, fontFamily: MONO, color: A.textMuted, whiteSpace: "nowrap" }}>
          {at ? `LIVE · ${at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : "Loading quotes…"}
        </span>
      </div>

      {/* 1. QQQ Technical Dashboard & Levels */}
      <div id="qqq-tech" style={{ scrollMarginTop: 96 }}>
        <Card
          A={A}
          title={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span>QQQ Command Center</span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  fontFamily: MONO,
                  padding: "1px 6px",
                  borderRadius: 4,
                  background: `${stackTone}20`,
                  border: `1px solid ${stackTone}88`,
                  color: stackTone,
                }}
              >
                EMA {tech.emaStack}
              </span>
              {tech.stage != null && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    fontFamily: MONO,
                    padding: "1px 6px",
                    borderRadius: 4,
                    background: `${STAGE_COLOR[tech.stage]}20`,
                    border: `1px solid ${STAGE_COLOR[tech.stage]}88`,
                    color: STAGE_COLOR[tech.stage],
                  }}
                >
                  STAGE {tech.stage}
                </span>
              )}
            </span>
          }
          right={
            <button
              type="button"
              onClick={() => onTicker && onTicker("QQQ")}
              style={chipStyle(chartTicker === "QQQ", A.green)}
            >
              Chart QQQ
            </button>
          }
        >
          {/* Hero QQQ Live Readout + Cross-Index Comparison Strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(118px, 1fr))", gap: 6, marginBottom: 10 }}>
            {[
              {
                t: "QQQ",
                label: "QQQ",
                px: tech.price,
                chg: qqqChg,
                sub: `Opn ${fmtPct(tech.fromOpenPct, 1)} · CR ${tech.cr != null ? `${tech.cr}%` : "—"}${qqqZvr != null ? ` · ${qqqZvr.toFixed(1)}×` : ""}`,
                accent: A.green,
                clickable: true,
              },
              {
                t: "QQQ",
                label: "NQ=F",
                px: typeof nqFut?.price === "number" ? nqFut.price : null,
                chg: typeof nqFut?.changePct === "number" ? nqFut.changePct : null,
                sub: "Nasdaq-100 Futures",
                accent: A.cyan,
                clickable: true,
              },
              {
                t: "QQQE",
                label: "QQQE (EqWt)",
                px: qqqeQ?.price ?? null,
                chg: qqqeChg,
                sub: vsQqqe != null ? `QQQ ${vsQqqe >= 0 ? "+" : ""}${vsQqqe.toFixed(2)}% vs EqWt` : "Equal-Weight NDX",
                accent: "#c084fc",
                clickable: true,
              },
              {
                t: "SPY",
                label: "SPY",
                px: spyQ?.price ?? null,
                chg: spyChg,
                sub: vsSpy != null ? `QQQ ${vsSpy >= 0 ? "+" : ""}${vsSpy.toFixed(2)}% vs SPY` : "S&P 500",
                accent: A.textDim,
                clickable: true,
              },
              {
                t: "IWM",
                label: "IWM",
                px: iwmQ?.price ?? null,
                chg: iwmChg,
                sub: vsIwm != null ? `QQQ ${vsIwm >= 0 ? "+" : ""}${vsIwm.toFixed(2)}% vs IWM` : "Russell 2000",
                accent: A.textDim,
                clickable: true,
              },
              {
                t: "VIXY",
                label: "VIX",
                px: vixTape?.price != null ? Number(vixTape.price) : null,
                chg: vixTape?.change != null ? Number(vixTape.change) : null,
                sub: "Volatility (click VIXY)",
                invert: true,
                accent: "#f472b6",
                clickable: true,
              },
            ].map((item) => {
              const chgColor = item.chg == null
                ? A.textMuted
                : item.invert
                  ? (item.chg > 0 ? A.red : A.green)
                  : (item.chg >= 0 ? A.green : A.red);
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => item.clickable && onTicker && onTicker(item.t)}
                  className="tp-pill"
                  style={{
                    textAlign: "left",
                    padding: "7px 9px",
                    borderRadius: 8,
                    background: A.bg,
                    border: `1px solid ${chartTicker === item.t && item.label === item.t ? A.green : A.border}`,
                    cursor: item.clickable ? "pointer" : "default",
                    minWidth: 0,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: item.accent, fontFamily: MONO }}>{item.label}</span>
                    <span style={{ fontSize: 11, fontWeight: 800, color: chgColor, fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
                      {fmtPct(item.chg, 2)}
                    </span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: A.text, fontFamily: MONO, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
                    {item.px != null ? (item.label === "VIX" ? item.px.toFixed(2) : item.px >= 1000 ? Math.round(item.px).toLocaleString() : `$${item.px.toFixed(2)}`) : "—"}
                  </div>
                  <div style={{ fontSize: 9.5, color: A.textMuted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: MONO }}>
                    {item.sub}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Moving Average & ATR Extension Strip */}
          <div style={{ fontSize: 10, fontWeight: 700, color: A.textMuted, letterSpacing: 0.45, textTransform: "uppercase", marginBottom: 5 }}>
            Moving Averages &amp; ATR Extension (14d ATR: {tech.atr14 != null ? `$${tech.atr14.toFixed(2)} / ${tech.atrPct?.toFixed(2)}%` : "—"})
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(105px, 1fr))", gap: 6 }}>
            {tech.mas.map((m) => {
              const extWarn = m.label === "21 EMA" && m.atrX != null && Math.abs(m.atrX) >= 3.0;
              const colr = m.above == null ? A.textMuted : m.above ? A.green : A.red;
              return (
                <div
                  key={m.label}
                  title={m.atrX != null ? `${m.label}: $${m.level} (${fmtPct(m.pct, 2)} · ${m.atrX > 0 ? "+" : ""}${m.atrX.toFixed(2)}× ATR)` : undefined}
                  style={{
                    padding: "6px 8px",
                    borderRadius: 6,
                    background: A.bg,
                    border: `1px solid ${extWarn ? "#f59e0b88" : A.border}`,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: A.textMuted, fontWeight: 700 }}>
                    <span>{m.label}</span>
                    <span style={{ color: colr, fontFamily: MONO }}>{fmtPct(m.pct, 1)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 2, fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: A.text }}>{fmtPx(m.level)}</span>
                    <span style={{ fontSize: 10, fontWeight: extWarn ? 800 : 600, color: extWarn ? "#f59e0b" : colr }}>
                      {m.atrX != null ? `${m.atrX > 0 ? "+" : ""}${m.atrX.toFixed(1)}×` : "—"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* 2. Nasdaq-100 Internals & Breadth */}
      <div id="qqq-internals" style={{ scrollMarginTop: 96 }}>
        <Card
          A={A}
          title={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span>Nasdaq-100 Internals &amp; Breadth</span>
              {spreadLabel && (
                <span
                  title={`Top-10 weighted avg (${fmtPct(internals.top10Chg, 2)}) minus remaining holdings avg (${fmtPct(internals.restChg, 2)})`}
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    fontFamily: MONO,
                    padding: "1px 6px",
                    borderRadius: 4,
                    background: `${spreadLabel.color}1e`,
                    border: `1px solid ${spreadLabel.color}66`,
                    color: spreadLabel.color,
                  }}
                >
                  {spreadLabel.text} ({fmtPct(internals.concentrationSpread, 2)})
                </span>
              )}
            </span>
          }
          sub={`${internals.count} holdings · ${internals.up4}↑ / ${internals.dn4}↓ 4% movers · ${internals.nearHighs} within 5% of 52wH`}
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
            <div>
              <MiniBar
                A={A}
                title="QQQ Advancers vs Decliners"
                pct={internals.advPct}
                left={`${internals.adv} Adv`}
                right={`${internals.dec} Dec`}
                color={internals.advPct >= 50 ? "#3b82f6" : "#ec4899"}
              />
              <MiniBar
                A={A}
                title="Above 20-Day SMA"
                pct={internals.ma20.pct}
                left={`${internals.ma20.above} Above`}
                right={`${internals.ma20.below} Below`}
                color={internals.ma20.pct >= 50 ? "#3b82f6" : "#ec4899"}
              />
            </div>
            <div>
              <MiniBar
                A={A}
                title="Above 50-Day SMA"
                pct={internals.ma50.pct}
                left={`${internals.ma50.above} Above`}
                right={`${internals.ma50.below} Below`}
                color={internals.ma50.pct >= 50 ? "#3b82f6" : "#ec4899"}
              />
              <MiniBar
                A={A}
                title="Above 200-Day SMA"
                pct={internals.ma200.pct}
                left={`${internals.ma200.above} Above`}
                right={`${internals.ma200.below} Below`}
                color={internals.ma200.pct >= 50 ? "#3b82f6" : "#ec4899"}
              />
            </div>
          </div>

          {/* Stage 1-4 Bar across NDX */}
          {internals.stageDist.total > 0 && (
            <div style={{ marginTop: 4, marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                <span style={{ fontWeight: 700, color: A.text }}>NDX Weinstein Stages (1–4)</span>
                <span style={{ fontSize: 10.5, fontFamily: MONO, color: A.textMuted }}>
                  {internals.stageDist.stages.map((s) => `S${s.stage} ${s.pct}%`).join(" · ")}
                </span>
              </div>
              <div style={{ display: "flex", height: 7, borderRadius: 999, overflow: "hidden", background: A.border }}>
                {internals.stageDist.stages.map((st) => (
                  <div
                    key={st.stage}
                    title={`${st.label} (${st.hint}): ${st.count} stocks (${st.pct}%)`}
                    style={{ width: `${(st.count / internals.stageDist.total) * 100}%`, background: STAGE_COLOR[st.stage] }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Concentration + Top Contributors */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, paddingTop: 8, borderTop: `1px solid ${A.border}` }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: A.textMuted, letterSpacing: 0.4, marginBottom: 5 }}>
                TOP-10 WEIGHT ({internals.top10Weight}%) VS REST
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11, fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
                <span>Top 10 <strong style={{ color: pc(internals.top10Chg) }}>{fmtPct(internals.top10Chg, 2)}</strong></span>
                <span>Rest <strong style={{ color: pc(internals.restChg) }}>{fmtPct(internals.restChg, 2)}</strong></span>
                <span>EqWt <strong style={{ color: pc(internals.eqWeightChg) }}>{fmtPct(internals.eqWeightChg, 2)}</strong></span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                {internals.groupPerf.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setGroupFilter((cur) => (cur === g.id ? "all" : g.id))}
                    title={`${g.label} (${g.count} stocks): median ${fmtPct(g.medianChg, 2)}, ${g.pctGreen ?? 0}% green, ${fmtBps(g.bps)} bps impact — click to filter table`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "2px 7px",
                      borderRadius: 6,
                      fontSize: 10.5,
                      fontFamily: MONO,
                      cursor: "pointer",
                      background: groupFilter === g.id ? `${g.color}22` : A.bg,
                      border: `1px solid ${groupFilter === g.id ? g.color : A.border}`,
                      color: A.textDim,
                    }}
                  >
                    <span style={{ color: g.color, fontWeight: 700 }}>{g.label}</span>
                    <strong style={{ color: pc(g.medianChg) }}>{fmtPct(g.medianChg, 1)}</strong>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: A.textMuted, letterSpacing: 0.4, marginBottom: 5 }}>
                TOP QQQ CONTRIBUTORS (EST. BPS)
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 5 }}>
                {internals.topPositive.map((r) => (
                  <button
                    key={r.ticker}
                    type="button"
                    onClick={() => onTicker && onTicker(r.ticker)}
                    title={`${r.ticker} (${r.weightPct}% wt × ${fmtPct(r.chg, 2)})`}
                    style={{ background: "rgba(34,197,94,0.12)", border: `1px solid ${A.green}55`, color: A.green, borderRadius: 5, padding: "1px 6px", fontSize: 10.5, fontFamily: MONO, fontWeight: 700, cursor: "pointer" }}
                  >
                    {r.ticker} {fmtBps(r.contribBps)}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {internals.topNegative.map((r) => (
                  <button
                    key={r.ticker}
                    type="button"
                    onClick={() => onTicker && onTicker(r.ticker)}
                    title={`${r.ticker} (${r.weightPct}% wt × ${fmtPct(r.chg, 2)})`}
                    style={{ background: "rgba(239,68,68,0.12)", border: `1px solid ${A.red}55`, color: A.red, borderRadius: 5, padding: "1px 6px", fontSize: 10.5, fontFamily: MONO, fontWeight: 700, cursor: "pointer" }}
                  >
                    {r.ticker} {fmtBps(r.contribBps)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* 3. QQQ Leverage (TQQQ / SQQQ) & Swing Levels / Expected Move */}
      <div id="qqq-leverage" style={{ scrollMarginTop: 96 }}>
        <Card A={A} title="Leverage, Expected Move &amp; Key Levels" sub="3× ETFs, ATR expected ranges &amp; swing stop zones for QQQ">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))", gap: 8, marginBottom: 10 }}>
            {[
              { tk: "TQQQ", desc: "3× Bull QQQ", q: tqqqQ, accent: A.green },
              { tk: "SQQQ", desc: "3× Bear QQQ", q: sqqqQ, accent: A.red },
            ].map(({ tk, desc, q, accent }) => {
              const px = q?.price ?? null;
              const chg = q?.change ?? null;
              const opn = q?.open && px ? ((px / q.open) - 1) * 100 : null;
              const cr = q?.dayHigh && q?.dayLow && q.dayHigh > q.dayLow && px != null
                ? Math.round(((px - q.dayLow) / (q.dayHigh - q.dayLow)) * 100)
                : null;
              return (
                <button
                  key={tk}
                  type="button"
                  onClick={() => onTicker && onTicker(tk)}
                  className="tp-pill"
                  style={{
                    textAlign: "left",
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: A.bg,
                    border: `1px solid ${chartTicker === tk ? accent : A.border}`,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontFamily: MONO, fontWeight: 800, fontSize: 12, color: accent }}>
                      {tk} <span style={{ fontWeight: 500, fontSize: 10, color: A.textMuted }}>{desc}</span>
                    </span>
                    <span style={{ fontFamily: MONO, fontWeight: 800, fontSize: 12, color: pc(chg) }}>{fmtPct(chg, 2)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 3, fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: A.text }}>{fmtPx(px)}</span>
                    <span style={{ fontSize: 10, color: A.textMuted }}>
                      Opn {fmtPct(opn, 1)} · CR {cr != null ? `${cr}%` : "—"}
                    </span>
                  </div>
                </button>
              );
            })}
            <div style={{ padding: "8px 10px", borderRadius: 8, background: A.bg, border: `1px solid ${A.border}`, fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: A.textMuted }}>EXPECTED MOVE (ATR)</div>
              <div style={{ fontSize: 11.5, color: A.text, marginTop: 3 }}>
                1D: <strong style={{ color: A.cyan }}>±{fmtPx(tech.expectedDayMove)}</strong>{" "}
                <span style={{ color: A.textMuted, fontSize: 10 }}>({tech.atrPct != null ? `±${tech.atrPct.toFixed(1)}%` : "—"})</span>
              </div>
              <div style={{ fontSize: 11.5, color: A.text, marginTop: 2 }}>
                1W: <strong style={{ color: "#fbbf24" }}>±{fmtPx(tech.expectedWeekMove)}</strong>{" "}
                <span style={{ color: A.textMuted, fontSize: 10 }}>
                  ({tech.expectedWeekMove && tech.price ? `±${((tech.expectedWeekMove / tech.price) * 100).toFixed(1)}%` : "—"})
                </span>
              </div>
            </div>
            <div style={{ padding: "8px 10px", borderRadius: 8, background: A.bg, border: `1px solid ${A.border}`, fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: A.textMuted }}>KEY PRICE LEVELS</div>
              <div style={{ fontSize: 10.5, color: A.textDim, marginTop: 3 }}>
                Prev H/L: <strong style={{ color: A.text }}>{fmtPx(tech.prevHigh)}</strong> / <strong style={{ color: A.text }}>{fmtPx(tech.prevLow)}</strong>
              </div>
              <div style={{ fontSize: 10.5, color: A.textDim, marginTop: 2 }}>
                20d H/L: <strong style={{ color: A.text }}>{fmtPx(tech.high20)}</strong> / <strong style={{ color: A.text }}>{fmtPx(tech.low20)}</strong>
              </div>
              <div style={{ fontSize: 10.5, color: A.textDim, marginTop: 2 }}>
                52wH: <strong style={{ color: A.green }}>{fmtPx(tech.high52)}</strong>{" "}
                <span style={{ color: pc(tech.off52Pct) }}>({fmtPct(tech.off52Pct, 1)})</span>
              </div>
            </div>
          </div>

          {/* Swing Stop Zones */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(95px, 1fr))", gap: 6 }}>
            {tech.stops.map((s) => (
              <div key={s.label} style={{ padding: "5px 8px", borderRadius: 6, background: A.bg, border: `1px solid ${A.border}`, fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
                <div style={{ fontSize: 9.5, fontWeight: 700, color: A.textMuted }}>{s.label}</div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: A.text, marginTop: 1 }}>{fmtPx(s.price)}</div>
                <div style={{ fontSize: 10, color: (s.distPct ?? 0) <= 0 ? A.red : A.green }}>{fmtPct(s.distPct, 1)}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* 4. Live Nasdaq-100 Holdings & Contributors Table */}
      <div id="qqq-holdings" style={{ scrollMarginTop: 96 }}>
        <Card
          A={A}
          title={`Nasdaq-100 Holdings (${sortedRows.length}/${internals.count})`}
          sub="Default sorted by Thrust (Chg% × ZVR) · click any row to chart · ↑/↓ to step through"
          right={<CopyTickersBtn A={A} tickers={sortedRows.map((r) => r.ticker)} label="Copy TV" />}
        >
          {/* Group & Quick Filter Pills */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, marginBottom: 8 }}>
            <button type="button" onClick={() => setGroupFilter("all")} style={chipStyle(groupFilter === "all", A.green)}>
              All <span style={{ opacity: 0.75, fontFamily: MONO }}>{internals.count}</span>
            </button>
            {NDX_GROUPS.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setGroupFilter((cur) => (cur === g.id ? "all" : g.id))}
                style={chipStyle(groupFilter === g.id, g.color)}
              >
                {g.label}
              </button>
            ))}
            <button type="button" onClick={() => setGroupFilter((cur) => (cur === "bo" ? "all" : "bo"))} style={chipStyle(groupFilter === "bo", "#fbbf24")}>
              🔥 Breakouts <span style={{ opacity: 0.75, fontFamily: MONO }}>{boCount}</span>
            </button>
            <button type="button" onClick={() => setGroupFilter((cur) => (cur === "weak" ? "all" : "weak"))} style={chipStyle(groupFilter === "weak", A.red)}>
              Weakest <span style={{ opacity: 0.75, fontFamily: MONO }}>{weakCount}</span>
            </button>
          </div>

          {/* Secondary Filter Bar: Search, No Health, ADR >= */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${A.border}` }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter ticker / company…"
              aria-label="Filter QQQ holdings"
              style={{
                background: A.bg,
                color: A.text,
                border: `1px solid ${A.border}`,
                borderRadius: 6,
                padding: "3px 8px",
                fontSize: 11,
                width: 170,
                outline: "none",
              }}
            />
            <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={toggleNoHealth}
                title="Exclude Healthcare / Biotech stocks"
                style={chipStyle(noHealth, "#f472b6")}
              >
                No Health
              </button>
              <AdrFilter A={A} value={minAdr} onChange={setMinAdr} />
            </div>
          </div>

          <div style={{ overflowX: "auto", maxHeight: 560, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, background: A.bgCard, zIndex: 1 }}>
                <tr>
                  {col("ticker", "Ticker", "left", "Symbol & company", true)}
                  {col("group", "Grp", "left", "Nasdaq-100 sector group", true)}
                  {col("thrust", "Thr", "right", "Stock Thrust: Chg% × ZVR")}
                  {col("contribBps", "bps", "right", "Estimated QQQ basis points contribution (Weight% × Chg%)")}
                  {col("weightPct", "Wt%", "right", "Estimated Nasdaq-100 weight %")}
                  {col("chg", "Chg%")}
                  {col("fromOpen", "Opn%", "right", "Intraday move from today's open")}
                  {col("zvr", "ZVR", "right", "Zanger Volume Ratio vs 10d intraday profile")}
                  {col("cr", "CR", "right", "Closing Range %")}
                  {col("rs", "RS")}
                  {col("sma50", "50d", "right", "% distance vs 50-day SMA")}
                  {col("off52", "52wH", "right", "% off 52-week high")}
                  {(setPortfolio || setWatchlist) && (
                    <th style={{ ...th(A, "right"), padding: "5px 4px", fontSize: 10, letterSpacing: 0.25 }}>List</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r) => {
                  const on = chartTicker === r.ticker;
                  const inPf = pfSet.has(r.ticker);
                  const inWl = wlSet.has(r.ticker);
                  const gc = GROUP_COLOR[r.group] || A.textMuted;
                  return (
                    <tr
                      key={r.ticker}
                      data-nav={r.ticker}
                      className={on ? "tp-click-row tp-row-active" : "tp-click-row"}
                      onClick={() => onTicker && onTicker(r.ticker)}
                      style={{
                        cursor: "pointer",
                        background: on ? A.bgHover : "transparent",
                        boxShadow: on ? `inset 2px 0 0 ${A.green}` : "none",
                      }}
                    >
                      <td style={mtd()}>
                        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                          <FlagButton t={r.ticker} A={A} />
                          <span style={{ color: on ? A.green : A.text, fontWeight: 700, fontFamily: MONO }}>{r.ticker}</span>
                          <TierMark t={r.ticker} />
                          <RslDot tip={r.rsl} A={A} />
                        </div>
                        {r.company && (
                          <div title={r.company} style={{ fontSize: 10, color: A.textMuted, maxWidth: 96, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {r.company}
                          </div>
                        )}
                      </td>
                      <td style={mtd()}>
                        <span style={{ fontSize: 9.5, fontWeight: 700, fontFamily: MONO, padding: "1px 4px", borderRadius: 3, background: `${gc}1c`, color: gc, border: `1px solid ${gc}44` }}>
                          {GROUP_SHORT[r.group] || r.group}
                        </span>
                      </td>
                      <td style={mtd("right", { fontFamily: MONO, fontWeight: r.thrust != null && Math.abs(r.thrust) >= 5 ? 800 : 500, color: pc(r.thrust), whiteSpace: "nowrap" })}>
                        {r.thrust != null ? `${r.thrust > 0 ? "+" : ""}${r.thrust.toFixed(1)}` : "—"}
                      </td>
                      <td style={mtd("right", { fontFamily: MONO, fontWeight: r.contribBps != null && Math.abs(r.contribBps) >= 5 ? 700 : 400, color: pc(r.contribBps), whiteSpace: "nowrap" })}>
                        {fmtBps(r.contribBps)}
                      </td>
                      <td style={mtd("right", { fontFamily: MONO, color: A.textMuted, whiteSpace: "nowrap" })}>
                        {r.weightPct > 0 ? `${r.weightPct.toFixed(1)}%` : "—"}
                      </td>
                      <td style={mtd("right", { fontFamily: MONO, fontWeight: 700, color: pc(r.chg), whiteSpace: "nowrap" })}>
                        {fmtPct(r.chg, 1)}
                      </td>
                      <td style={mtd("right", { fontFamily: MONO, color: pc(r.fromOpen), whiteSpace: "nowrap" })}>
                        {fmtPct(r.fromOpen, 1)}
                      </td>
                      <td style={mtd("right", { fontFamily: MONO, color: r.zvr == null ? A.textMuted : r.zvr >= 2 ? "#fbbf24" : r.zvr >= 1.5 ? A.green : A.textDim, fontWeight: (r.zvr ?? 0) >= 1.5 ? 700 : 400, whiteSpace: "nowrap" })}>
                        {r.zvr != null ? `${r.zvr.toFixed(1)}×` : "—"}
                      </td>
                      <td style={mtd("right", { fontFamily: MONO, color: r.cr == null ? A.textMuted : r.cr >= 75 ? A.green : r.cr <= 30 ? A.red : A.textDim })}>
                        {r.cr != null ? `${r.cr}%` : "—"}
                      </td>
                      <td style={mtd("right", { fontFamily: MONO, fontWeight: 700, color: rsC(r.rs) })}>
                        {r.rs ?? "—"}
                      </td>
                      <td style={mtd("right", { fontFamily: MONO, color: pc(r.sma50), whiteSpace: "nowrap" })}>
                        {fmtPct(r.sma50, 1)}
                      </td>
                      <td style={mtd("right", { fontFamily: MONO, color: (r.off52 ?? -99) >= -5 ? A.green : A.textDim, whiteSpace: "nowrap" })}>
                        {fmtPct(r.off52, 1)}
                      </td>
                      {(setPortfolio || setWatchlist) && (
                        <td style={mtd("right")} onClick={(e) => e.stopPropagation()}>
                          <span style={{ display: "inline-flex", gap: 2 }}>
                            {setPortfolio && (
                              <button
                                type="button"
                                title={inPf ? "Remove from Portfolio" : "Add to Portfolio"}
                                onClick={() => toggleList(r.ticker, "pf")}
                                style={{ background: inPf ? `${A.green}22` : "transparent", border: `1px solid ${inPf ? A.green : A.border}`, color: inPf ? A.green : A.textMuted, borderRadius: 3, padding: "1px 3px", fontSize: 10, fontFamily: MONO, fontWeight: inPf ? 700 : 500, cursor: "pointer" }}
                              >
                                PF
                              </button>
                            )}
                            {setWatchlist && (
                              <button
                                type="button"
                                title={inWl ? "Remove from Watchlist" : "Add to Watchlist"}
                                onClick={() => toggleList(r.ticker, "wl")}
                                style={{ background: inWl ? `${A.cyan}22` : "transparent", border: `1px solid ${inWl ? A.cyan : A.border}`, color: inWl ? A.cyan : A.textMuted, borderRadius: 3, padding: "1px 3px", fontSize: 10, fontFamily: MONO, fontWeight: inWl ? 700 : 500, cursor: "pointer" }}
                              >
                                WL
                              </button>
                            )}
                          </span>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
