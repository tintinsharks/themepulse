import { useEffect, useMemo, useState } from "react";
import {
  AdrFilter,
  Card,
  CopyTickersBtn,
  EPS_TIP,
  FlagButton,
  LayerLink,
  MONO,
  RslDot,
  TierMark,
  isHealthcareItem,
  rsLeads,
  stockThrust,
  td,
  th,
  useRvolProfiles,
  useScanQuotes,
  zvrFor,
} from "./core.jsx";
import {
  ALL_SCANS,
  CLASSIC_SCANS,
  ELITE_RS_SCANS,
  SCAN_NOTES,
  evalScanHits,
} from "./scannerMath.js";

// ── Scanner: Elite RS + preset momentum & Stockbee scans over ThemePulse ───
const VALID_SCANS = new Set(ALL_SCANS.map(([k]) => k));
const ELITE_IDS = new Set(ELITE_RS_SCANS.map(([k]) => k));

function ScannerPanel({ A, stockMap, onTicker, chartTicker, tickerLayer, onLayer, indexQuotes }) {
  const [scan, setScan] = useState(() => {
    try {
      const saved = localStorage.getItem("tp-scan-tab");
      if (VALID_SCANS.has(saved)) return saved;
    } catch { /* ignore */ }
    return "bluedot";
  });
  const [sort, setSort] = useState({ k: "thrust", d: -1 });
  const [minAdr, setMinAdr] = useState(null);
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

  const pick = (k) => {
    setScan(k);
    setSort({ k: k === "s20" ? "ago" : "thrust", d: k === "s20" ? 1 : -1 });
    try { localStorage.setItem("tp-scan-tab", k); } catch { /* ignore */ }
  };

  const profiles = useRvolProfiles();

  // Pass 1 on pipeline data (cheap) to know which names to quote live
  const pre = useMemo(() => {
    const m = {};
    Object.values(stockMap || {}).forEach((s) => {
      if (s?.ticker) {
        const h = evalScanHits(s, null, null);
        if (h) m[s.ticker] = h;
      }
    });
    return m;
  }, [stockMap]);

  // Quote all hits for active scan + wider candidate nets for live-driven scans (grnred, rsvol, antic, hot)
  const live = useMemo(() => {
    const set = new Set();
    for (const [t, h] of Object.entries(pre)) {
      if (h[scan]) { set.add(t); continue; }
      const s = stockMap?.[t];
      if (!s) continue;
      if (scan === "grnred" && (s.rs_rank ?? 0) >= 85 && (s.avg_dollar_vol_raw ?? 0) >= 20e6 && (s.sma50_pct ?? -1) > 0 && (s.off_52w_high ?? -99) >= -15) set.add(t);
      else if (scan === "rsvol" && (s.rs_rank ?? 0) >= 90 && (s.avg_dollar_vol_raw ?? 0) >= 20e6 && (s.sma50_pct ?? -1) > 0 && (s.off_52w_high ?? -99) >= -12) set.add(t);
      else if (scan === "antic" && (s.ti65 ?? 0) >= 1.05) set.add(t);
      else if (scan === "hot" && (s.return_1m ?? 0) > 30) set.add(t);
    }
    return [...set];
  }, [pre, scan, stockMap]);

  const { quotes, at } = useScanQuotes(live, true);

  const passesFilters = (s) => {
    if (!s?.ticker) return false;
    const L = tickerLayer?.[s.ticker];
    if (noHealth && isHealthcareItem({
      theme: L?.theme,
      themeId: L?.themeId,
      layer: L?.name,
      sector: s.sector,
      industry: s.industry,
    })) return false;
    if (minAdr != null) {
      const adr = s.adr20 ?? s.adr_pct ?? -1;
      if (adr < minAdr) return false;
    }
    return true;
  };

  const counts = useMemo(() => {
    const n = {};
    ALL_SCANS.forEach(([k]) => { n[k] = 0; });
    Object.entries(pre).forEach(([t, h]) => {
      const s = stockMap?.[t];
      if (!passesFilters(s)) return;
      const q = quotes.get(t);
      const zvr = q ? (zvrFor(s, q, profiles) ?? (s.rel_volume > 0 ? +s.rel_volume.toFixed(2) : null)) : null;
      const hh = q ? (evalScanHits(s, q, zvr) || h) : h;
      ALL_SCANS.forEach(([k]) => { if (hh[k]) n[k]++; });
    });
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pre, quotes, stockMap, profiles, tickerLayer, noHealth, minAdr]);

  const rows = useMemo(() => {
    const out = [];
    Object.values(stockMap || {}).forEach((s) => {
      if (!passesFilters(s)) return;
      const q = quotes.get(s.ticker);
      const zvr = zvrFor(s, q, profiles) ?? (s.rel_volume > 0 ? +s.rel_volume.toFixed(2) : null);
      const h = evalScanHits(s, q, zvr);
      if (!h?.[scan]) return;
      const L = tickerLayer?.[s.ticker];
      const px = q?.rthPrice ?? q?.price ?? s.close;
      const chg = q?.change ?? s.change_pct ?? null;
      const thrust = stockThrust(chg, zvr);
      const hi52 = Math.max(s.hi52_lvl || 0, q?.yearHigh || 0) || null;
      const off = hi52 && px ? ((px / hi52) - 1) * 100 : (s.off_52w_high ?? s.pct_from_high);
      out.push({
        t: s.ticker,
        company: s.company || "",
        tag: typeof h[scan] === "string" ? h[scan] : null,
        px,
        chg,
        zvr,
        thrust,
        r1w: s.return_1w,
        r1m: s.return_1m,
        r3m: s.return_3m,
        r6m: s.return_6m,
        adr: s.adr20 ?? s.adr_pct,
        adr5: s.adr5,
        off,
        rs: s.rs_rank,
        eps: s.eps_rating ?? null,
        epsTip: s.eps_tip,
        epsAcc: s.eps_accel,
        burst: s.burst20_pct,
        ago: s.burst20_ago,
        pb: s.burst20_pullback,
        ti65: s.ti65,
        rsl: rsLeads(s),
        rslAgo: s.rsl_hi_ago ?? null,
        p8w: s.pct_from_8w ?? null,
        pp30: s.pp_count_30d ?? null,
        udv: s.udv20 ?? null,
        layer: L?.name || s.industry || "",
        layerSt: L?.st,
      });
    });
    const { k, d } = sort;
    out.sort((x, y) => {
      const a = x[k], b = y[k];
      if (a == null && b == null) return x.t.localeCompare(y.t);
      if (a == null) return 1;
      if (b == null) return -1;
      return (a - b) * d || x.t.localeCompare(y.t);
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockMap, quotes, profiles, scan, sort, tickerLayer, noHealth, minAdr]);

  const spyChg = indexQuotes?.SPY?.change ?? stockMap?.SPY?.change_pct ?? null;
  const qqqChg = indexQuotes?.QQQ?.change ?? stockMap?.QQQ?.change_pct ?? null;
  const spyOff = stockMap?.SPY?.off_52w_high ?? null;
  const qqqOff = stockMap?.QQQ?.off_52w_high ?? null;
  const redTape = (spyChg != null && spyChg < 0) || (qqqChg != null && qqqChg < 0);

  const col = (k, label, title) => (
    <th
      key={k}
      style={{
        ...th(A, "right"),
        padding: "5px 5px",
        fontSize: 10,
        cursor: "pointer",
        userSelect: "none",
        color: sort.k === k ? A.text : A.textMuted,
      }}
      title={title}
      onClick={() => setSort((p) => ({ k, d: p.k === k ? -p.d : (k === "ago" || k === "rslAgo" ? 1 : -1) }))}
    >
      {label}{sort.k === k ? (sort.d < 0 ? "▼" : "▲") : ""}
    </th>
  );
  const std = (align = "left", extra) => ({ ...td(A, align), padding: "5px 5px", fontSize: 11, ...extra });
  const pct = (v, dg = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(dg)}%`);
  const pc = (v) => (v == null ? A.textMuted : v >= 0 ? A.green : A.red);

  const extra = scan === "s20"
    ? [["burst", "Burst", "5d burst %", (r) => pct(r.burst)], ["ago", "Ago", "Sessions since burst", (r) => r.ago ?? "—"], ["pb", "PB", "Pullback from burst high", (r) => pct(r.pb)]]
    : scan === "antic"
      ? [["ti65", "TI65", "7d ÷ 65d close ratio", (r) => (r.ti65 == null ? "—" : r.ti65.toFixed(2))]]
      : scan === "hot"
        ? [["adr5", "Vol 1W", "5d average daily range", (r) => (r.adr5 == null ? "—" : `${r.adr5.toFixed(1)}%`)]]
        : scan === "bluedot"
          ? [["rslAgo", "RSL", "Sessions since RS line 52w high", (r) => (r.rslAgo != null ? `${r.rslAgo}d` : "NH")], ["pp30", "PP30", "Pocket pivots in last 30 sessions", (r) => r.pp30 ?? "—"]]
          : scan === "resil"
            ? [["p8w", "vs 8w", "% above rising 8-week MA", (r) => pct(r.p8w)], ["pp30", "PP30", "Pocket pivots in last 30 sessions", (r) => r.pp30 ?? "—"]]
            : ELITE_IDS.has(scan)
              ? [["pp30", "PP30", "Pocket pivots in last 30 sessions", (r) => r.pp30 ?? "—"], ["udv", "U/D", "20-day up/down volume ratio", (r) => (r.udv != null ? `${r.udv.toFixed(1)}×` : "—")]]
              : [];

  return (
    <Card
      A={A}
      title="Scanner"
      sub={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontFamily: MONO, fontSize: 10.5 }}>
          <span>
            SPY <strong style={{ color: pc(spyChg) }}>{pct(spyChg, 2)}</strong>
            {spyOff != null && <span style={{ color: A.textMuted }}> ({pct(spyOff, 1)} H)</span>}
          </span>
          <span>
            QQQ <strong style={{ color: pc(qqqChg) }}>{pct(qqqChg, 2)}</strong>
            {qqqOff != null && <span style={{ color: A.textMuted }}> ({pct(qqqOff, 1)} H)</span>}
          </span>
          {at && <span style={{ color: A.textMuted }}>· Live {at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}
        </span>
      }
      right={<CopyTickersBtn A={A} tickers={rows.map((r) => r.t)} label="Copy TV" />}
    >
      {/* Row 1: Elite Relative Strength Scans */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5, marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: "#fbbf24", letterSpacing: 0.5, marginRight: 2 }}>ELITE RS</span>
        {ELITE_RS_SCANS.map(([k, label, accent]) => {
          const active = scan === k;
          const isHotRed = k === "grnred" && redTape;
          return (
            <button
              key={k}
              type="button"
              onClick={() => pick(k)}
              style={{
                background: active ? `${accent}20` : "transparent",
                border: `1px solid ${active ? accent : A.border}`,
                color: active ? accent : A.textDim,
                borderRadius: 14,
                padding: "3px 10px",
                fontSize: 11,
                fontWeight: active ? 700 : 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <span>{label}</span>
              <span style={{ color: active ? accent : A.textMuted, fontFamily: MONO, fontSize: 10.5, fontWeight: 500 }}>{counts[k]}</span>
              {isHotRed && (
                <span title="SPY or QQQ is red today — prime Green-on-Red Tape conditions" style={{ width: 6, height: 6, borderRadius: 3, background: "#f472b6", display: "inline-block" }} />
              )}
            </button>
          );
        })}
      </div>

      {/* Row 2: Classic Momentum & Stockbee Scans */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5, marginBottom: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: A.textMuted, letterSpacing: 0.5, marginRight: 2 }}>SCANS</span>
        {CLASSIC_SCANS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => pick(k)}
            style={{
              background: scan === k ? "rgba(13,145,99,0.14)" : "transparent",
              border: `1px solid ${scan === k ? A.green : A.border}`,
              color: scan === k ? A.green : A.textDim,
              borderRadius: 14,
              padding: "3px 10px",
              fontSize: 11,
              fontWeight: scan === k ? 700 : 600,
              cursor: "pointer",
            }}
          >
            {label} <span style={{ color: A.textMuted, fontFamily: MONO, fontSize: 10.5, fontWeight: 400 }}>{counts[k]}</span>
          </button>
        ))}
      </div>

      {/* Filter & Description Strip */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8, paddingBottom: 7, borderBottom: `1px solid ${A.border}` }}>
        <div style={{ fontSize: 10.5, color: A.textMuted, flex: "1 1 260px" }}>
          {SCAN_NOTES[scan]}
          {" "}· <span style={{ color: A.blue || "#3b82f6" }}>●</span> RS line new 52w high before price
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <button
            type="button"
            onClick={toggleNoHealth}
            title="Exclude all Healthcare stocks (Biotech, Pharma, MedTech, Providers, etc.)"
            style={{
              background: noHealth ? "rgba(244,114,182,0.18)" : "transparent",
              border: `1px solid ${noHealth ? "#f472b6" : A.border}`,
              color: noHealth ? "#f472b6" : A.textDim,
              borderRadius: 6,
              padding: "2px 8px",
              fontSize: 11,
              fontWeight: noHealth ? 700 : 600,
              cursor: "pointer",
            }}
          >
            No Health
          </button>
          <AdrFilter A={A} value={minAdr} onChange={setMinAdr} />
        </div>
      </div>

      {!rows.length ? (
        <div style={{ fontSize: 11, color: A.textMuted, padding: "6px 2px" }}>No names pass right now.</div>
      ) : (
        <div style={{ overflowX: "auto", maxHeight: "calc(100vh - 260px)", overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ position: "sticky", top: 0, background: A.bgCard, zIndex: 1 }}>
              <tr>
                <th style={{ ...th(A), padding: "5px 5px", fontSize: 10 }}>Ticker</th>
                {col("thrust", "Thr", "Stock Thrust: Chg% × ZVR")}
                {col("chg", "Chg%")}
                {col("zvr", "ZVR", "Zanger Volume Ratio vs 10d intraday profile (falls back to EOD RVol)")}
                {extra.map(([k, l, tip]) => col(k, l, tip))}
                {col("r1w", "1W")}
                {col("r1m", "1M")}
                {col("r3m", "3M")}
                {col("adr", "ADR")}
                {col("off", "52wH", "% off 52-week high")}
                {col("rs", "RS")}
                {col("eps", "EPS", EPS_TIP)}
                <th style={{ ...th(A), padding: "5px 5px", fontSize: 10 }}>Layer</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const on = chartTicker === r.t;
                return (
                  <tr
                    key={r.t}
                    data-nav={r.t}
                    className={on ? "tp-click-row tp-row-active" : "tp-click-row"}
                    onClick={() => onTicker(r.t)}
                    style={{
                      cursor: "pointer",
                      background: on ? A.bgHover : "transparent",
                      boxShadow: on ? `inset 2px 0 0 ${A.green}` : "none",
                    }}
                  >
                    <td style={std()}>
                      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                        <FlagButton t={r.t} A={A} />
                        <span style={{ color: on ? A.green : A.text, fontWeight: 700, fontFamily: MONO }}>{r.t}</span>
                        <TierMark t={r.t} />
                        {r.tag ? <span title={r.tag === "L" ? "$10B+ scan" : "under-$10B scan"} style={{ marginLeft: 3, fontSize: 10, color: A.textMuted, fontFamily: MONO }}>{r.tag}</span> : null}
                        <RslDot tip={r.rsl} A={A} />
                      </div>
                    </td>
                    <td style={std("right", { fontFamily: MONO, fontWeight: r.thrust != null && Math.abs(r.thrust) >= 5 ? 800 : 500, color: r.thrust == null ? A.textMuted : r.thrust > 0 ? A.green : r.thrust < 0 ? A.red : A.textMuted, whiteSpace: "nowrap" })}>
                      {r.thrust != null ? `${r.thrust > 0 ? "+" : ""}${r.thrust.toFixed(1)}` : "—"}
                    </td>
                    <td style={std("right", { fontFamily: MONO, color: pc(r.chg), fontWeight: 700, whiteSpace: "nowrap" })}>{pct(r.chg, 1)}</td>
                    <td style={std("right", { fontFamily: MONO, color: r.zvr == null ? A.textMuted : r.zvr >= 2 ? "#fbbf24" : r.zvr >= 1.5 ? A.green : A.textDim, fontWeight: (r.zvr ?? 0) >= 1.5 ? 700 : 400, whiteSpace: "nowrap" })}>
                      {r.zvr != null ? `${r.zvr.toFixed(1)}×` : "—"}
                    </td>
                    {extra.map(([k, , , f]) => (
                      <td key={k} style={std("right", { fontFamily: MONO, color: A.text, whiteSpace: "nowrap" })}>{f(r)}</td>
                    ))}
                    <td style={std("right", { fontFamily: MONO, color: pc(r.r1w), whiteSpace: "nowrap" })}>{pct(r.r1w)}</td>
                    <td style={std("right", { fontFamily: MONO, color: pc(r.r1m), whiteSpace: "nowrap" })}>{pct(r.r1m)}</td>
                    <td style={std("right", { fontFamily: MONO, color: pc(r.r3m), whiteSpace: "nowrap" })}>{pct(r.r3m)}</td>
                    <td style={std("right", { fontFamily: MONO, color: (r.adr ?? 0) >= 4 ? A.cyan : A.textDim, whiteSpace: "nowrap" })}>{r.adr == null ? "—" : `${r.adr.toFixed(1)}%`}</td>
                    <td style={std("right", { fontFamily: MONO, color: (r.off ?? -99) >= -5 ? A.green : A.textDim, whiteSpace: "nowrap" })}>{pct(r.off)}</td>
                    <td style={std("right", { fontFamily: MONO, fontWeight: 700, color: r.rs >= 90 ? A.green : r.rs >= 70 ? A.yellow : r.rs != null ? A.red : A.textMuted })}>{r.rs ?? "—"}</td>
                    <td title={r.epsTip || ""} style={std("right", { fontFamily: MONO, color: r.eps >= 80 ? A.green : r.eps >= 50 ? A.yellow : r.eps != null ? A.red : A.textMuted, whiteSpace: "nowrap" })}>
                      {r.eps ?? "—"}{r.epsAcc ? <span style={{ color: A.green, fontSize: 10 }}>▲</span> : null}
                    </td>
                    <td style={std("left", { fontSize: 10.5, maxWidth: 145, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>
                      <LayerLink r={r} A={A} onLayer={onLayer} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default ScannerPanel;
