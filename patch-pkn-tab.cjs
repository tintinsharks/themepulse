#!/usr/bin/env node
/**
 * patch-pkn-tab.js — Add PKN tab (clone of Live) with PKN + PKN Watch lists
 * 
 * Edits:
 *   1. Add pkn/pknWatch state + localStorage + server persistence
 *   2. Add addToPkn/removeFromPkn/addToPknWatch/removeFromPknWatch callbacks
 *   3. Add "PKN" tab to nav bar
 *   4. Add PknView component (clone of LiveView, PKN + PKN Watch only)
 *   5. Render PknView when view === "pkn"
 *   6. Pass pkn/pknWatch to ChartPanel + render buttons
 * 
 * Usage:
 *   node patch-pkn-tab.js src/App.jsx
 */

const fs = require("fs");
const path = process.argv[2];
if (!path) { console.error("Usage: node patch-pkn-tab.js <path-to-App.jsx>"); process.exit(1); }

let code = fs.readFileSync(path, "utf-8");
let edits = 0;

function apply(name, anchor, replacement, mode = "after") {
  const idx = code.indexOf(anchor);
  if (idx === -1) { console.error(`❌ Edit ${name}: anchor not found`); return; }
  if (mode === "after") {
    code = code.slice(0, idx + anchor.length) + replacement + code.slice(idx + anchor.length);
  } else if (mode === "replace") {
    code = code.slice(0, idx) + replacement + code.slice(idx + anchor.length);
  }
  edits++;
  console.log(`✅ Edit ${name}`);
}

// ─── EDIT 1: Add pkn + pknWatch state alongside portfolio/watchlist ───
apply("1-state",
  `const [watchlist, setWatchlist] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tp_watchlist") || "[]"); } catch { return []; }
  });`,
  `
  const [pkn, setPkn] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tp_pkn") || "[]"); } catch { return []; }
  });
  const [pknWatch, setPknWatch] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tp_pkn_watch") || "[]"); } catch { return []; }
  });`
);

// ─── EDIT 2: Add localStorage persistence for pkn/pknWatch ───
apply("2-localstorage",
  `useEffect(() => { localStorage.setItem("tp_watchlist", JSON.stringify(watchlist)); }, [watchlist]);`,
  `
  useEffect(() => { localStorage.setItem("tp_pkn", JSON.stringify(pkn)); }, [pkn]);
  useEffect(() => { localStorage.setItem("tp_pkn_watch", JSON.stringify(pknWatch)); }, [pknWatch]);`
);

// ─── EDIT 3: Add server load for pkn/pknWatch ───
apply("3-server-load",
  `if (d.data.manualEPs) setManualEPs(d.data.manualEPs);`,
  `
          if (d.data.pkn) setPkn(d.data.pkn);
          if (d.data.pknWatch) setPknWatch(d.data.pknWatch);`
);

// ─── EDIT 4: Add pkn/pknWatch to server save body ───
apply("4-server-save",
  `body: JSON.stringify({ portfolio, watchlist, manualEPs, trades }),`,
  `body: JSON.stringify({ portfolio, watchlist, manualEPs, trades, pkn, pknWatch }),`,
  "replace"
);

// ─── EDIT 5: Add pkn/pknWatch to server save dependency array ───
apply("5-server-save-deps",
  `}, [portfolio, watchlist, trades, manualEPs, authToken, serverLoaded]);`,
  `}, [portfolio, watchlist, trades, manualEPs, pkn, pknWatch, authToken, serverLoaded]);`,
  "replace"
);

// ─── EDIT 6: Add add/remove callbacks for pkn/pknWatch ───
apply("6-callbacks",
  `const removeFromPortfolio = useCallback((t) => setPortfolio(p => p.filter(x => x !== t)), []);`,
  `
  const addToPkn = useCallback((t) => { const u = t.toUpperCase(); if (!pkn.includes(u)) setPkn(p => [...p, u]); }, [pkn]);
  const removeFromPkn = useCallback((t) => setPkn(p => p.filter(x => x !== t)), []);
  const addToPknWatch = useCallback((t) => { const u = t.toUpperCase(); if (!pknWatch.includes(u)) setPknWatch(p => [...p, u]); }, [pknWatch]);
  const removeFromPknWatch = useCallback((t) => setPknWatch(p => p.filter(x => x !== t)), []);`
);

// ─── EDIT 7: Add PKN tab to nav bar ───
apply("7-nav-tab",
  `[["live","Live"],["scan","Scan Watch"],["ep","EP"],["grid","Research"],["exec","Execution"],["perf","Performance"]]`,
  `[["live","Live"],["pkn","PKN"],["scan","Scan Watch"],["ep","EP"],["grid","Research"],["exec","Execution"],["perf","Performance"]]`,
  "replace"
);

// ─── EDIT 8: Add PknView render alongside LiveView ───
apply("8-pkn-render",
  `{view === "live" && <LiveView stockMap={stockMap} onTickerClick={openChart} activeTicker={chartTicker} onVisibleTickers={onVisibleTickers}
            portfolio={portfolio} setPortfolio={setPortfolio} watchlist={watchlist} setWatchlist={setWatchlist}
            addToWatchlist={addToWatchlist} removeFromWatchlist={removeFromWatchlist}
            addToPortfolio={addToPortfolio} removeFromPortfolio={removeFromPortfolio}
            liveThemeData={liveThemeData} homepage={homepage} />}`,
  `{view === "live" && <LiveView stockMap={stockMap} onTickerClick={openChart} activeTicker={chartTicker} onVisibleTickers={onVisibleTickers}
            portfolio={portfolio} setPortfolio={setPortfolio} watchlist={watchlist} setWatchlist={setWatchlist}
            addToWatchlist={addToWatchlist} removeFromWatchlist={removeFromWatchlist}
            addToPortfolio={addToPortfolio} removeFromPortfolio={removeFromPortfolio}
            liveThemeData={liveThemeData} homepage={homepage} />}
          {view === "pkn" && <PknView stockMap={stockMap} onTickerClick={openChart} activeTicker={chartTicker} onVisibleTickers={onVisibleTickers}
            pkn={pkn} setPkn={setPkn} pknWatch={pknWatch} setPknWatch={setPknWatch}
            addToPkn={addToPkn} removeFromPkn={removeFromPkn}
            addToPknWatch={addToPknWatch} removeFromPknWatch={removeFromPknWatch}
            liveThemeData={liveThemeData} />}`,
  "replace"
);

// ─── EDIT 9: Pass pkn/pknWatch to ChartPanel (non-exec) ───
apply("9-chart-pkn",
  `<ChartPanel ticker={chartTicker} stock={stockMap[chartTicker]} onClose={closeChart} onTickerClick={openChart}
                watchlist={watchlist} onAddWatchlist={addToWatchlist} onRemoveWatchlist={removeFromWatchlist}
                portfolio={portfolio} onAddPortfolio={addToPortfolio} onRemovePortfolio={removeFromPortfolio}
                manualEPs={manualEPs} onAddEP={addToEP} onRemoveEP={removeFromEP}
                liveThemeData={liveThemeData} />`,
  `<ChartPanel ticker={chartTicker} stock={stockMap[chartTicker]} onClose={closeChart} onTickerClick={openChart}
                watchlist={watchlist} onAddWatchlist={addToWatchlist} onRemoveWatchlist={removeFromWatchlist}
                portfolio={portfolio} onAddPortfolio={addToPortfolio} onRemovePortfolio={removeFromPortfolio}
                pkn={pkn} onAddPkn={addToPkn} onRemovePkn={removeFromPkn}
                pknWatch={pknWatch} onAddPknWatch={addToPknWatch} onRemovePknWatch={removeFromPknWatch}
                manualEPs={manualEPs} onAddEP={addToEP} onRemoveEP={removeFromEP}
                liveThemeData={liveThemeData} />`,
  "replace"
);

// ─── EDIT 10: Pass pkn/pknWatch to ChartPanel (exec view) ───
apply("10-chart-pkn-exec",
  `<ChartPanel ticker={chartTicker} stock={stockMap[chartTicker]} onClose={closeChart} onTickerClick={openChart}
                watchlist={watchlist} onAddWatchlist={addToWatchlist} onRemoveWatchlist={removeFromWatchlist}
                portfolio={portfolio} onAddPortfolio={addToPortfolio} onRemovePortfolio={removeFromPortfolio}
                manualEPs={manualEPs} onAddEP={addToEP} onRemoveEP={removeFromEP}
                liveThemeData={liveThemeData}
                lwChartProps`,
  `<ChartPanel ticker={chartTicker} stock={stockMap[chartTicker]} onClose={closeChart} onTickerClick={openChart}
                watchlist={watchlist} onAddWatchlist={addToWatchlist} onRemoveWatchlist={removeFromWatchlist}
                portfolio={portfolio} onAddPortfolio={addToPortfolio} onRemovePortfolio={removeFromPortfolio}
                pkn={pkn} onAddPkn={addToPkn} onRemovePkn={removeFromPkn}
                pknWatch={pknWatch} onAddPknWatch={addToPknWatch} onRemovePknWatch={removeFromPknWatch}
                manualEPs={manualEPs} onAddEP={addToEP} onRemoveEP={removeFromEP}
                liveThemeData={liveThemeData}
                lwChartProps`,
  "replace"
);

// ─── EDIT 11: Update ChartPanel signature to accept pkn/pknWatch props ───
apply("11-chart-sig",
  `function ChartPanel({ ticker, stock, onClose, onTickerClick, watchlist, onAddWatchlist, onRemoveWatchlist, portfolio, onAddPortfolio, onRemovePortfolio, manualEPs, onAddEP, onRemoveEP, liveThemeData, lwChartProps }) {`,
  `function ChartPanel({ ticker, stock, onClose, onTickerClick, watchlist, onAddWatchlist, onRemoveWatchlist, portfolio, onAddPortfolio, onRemovePortfolio, pkn, onAddPkn, onRemovePkn, pknWatch, onAddPknWatch, onRemovePknWatch, manualEPs, onAddEP, onRemoveEP, liveThemeData, lwChartProps }) {`,
  "replace"
);

// ─── EDIT 12: Add PKN + PKN Watch buttons in ChartPanel header ───
apply("12-chart-buttons",
  `{manualEPs && (
            manualEPs.some(e => e.ticker === ticker)`,
  `{pkn && (
            pkn.includes(ticker)
              ? <button onClick={() => onRemovePkn(ticker)} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
                  background: "#e879f920", border: "1px solid #e879f940", color: "#e879f9" }}>✓ PKN</button>
              : <button onClick={() => onAddPkn(ticker)} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
                  background: "transparent", border: "1px solid #3a3a4a", color: "#787888" }}>+ PKN</button>
          )}
          {pknWatch && (
            pknWatch.includes(ticker)
              ? <button onClick={() => onRemovePknWatch(ticker)} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
                  background: "#a78bfa20", border: "1px solid #a78bfa40", color: "#a78bfa" }}>✓ PKN W</button>
              : <button onClick={() => onAddPknWatch(ticker)} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
                  background: "transparent", border: "1px solid #3a3a4a", color: "#787888" }}>+ PKN W</button>
          )}
          {manualEPs && (
            manualEPs.some(e => e.ticker === ticker)`,
  "replace"
);

// ─── EDIT 13: Add PknView component (before LiveView) ───
// Insert the full PknView component right before the LiveView function definition
apply("13-pkn-component",
  `function LiveView({ stockMap, onTickerClick, activeTicker, onVisibleTickers, portfolio, setPortfolio, watchlist, setWatchlist, addToWatchlist, removeFromWatchlist, addToPortfolio, removeFromPortfolio, liveThemeData, homepage }) {`,
  `// ── PKN TAB ── (Pradeep/Kristjan/Nicolas pattern tracking)
function PknView({ stockMap, onTickerClick, activeTicker, onVisibleTickers, pkn, setPkn, pknWatch, setPknWatch, addToPkn, removeFromPkn, addToPknWatch, removeFromPknWatch, liveThemeData }) {
  const [liveData, setLiveData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [addTickerP, setAddTickerP] = useState("");
  const [addTickerW, setAddTickerW] = useState("");
  const [pSort, setPSort] = useState("change");
  const [wlSort, setWlSort] = useState("change");

  const allTickers = useMemo(() => [...new Set([...pkn, ...pknWatch])], [pkn, pknWatch]);

  const fetchLive = useCallback(async () => {
    if (allTickers.length === 0) { setLoading(false); return; }
    try {
      const params = new URLSearchParams();
      params.set("tickers", allTickers.join(","));
      const resp = await fetch(\`/api/live?\${params}\`);
      if (!resp.ok) throw new Error(\`HTTP \${resp.status}\`);
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || "API error");
      setLiveData(json);
      setLastUpdate(new Date());
      setError(null);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [allTickers]);

  useEffect(() => { fetchLive(); const iv = setInterval(fetchLive, 60000); return () => clearInterval(iv); }, [fetchLive]);

  const liveLookup = useMemo(() => {
    const m = {};
    if (liveThemeData) liveThemeData.forEach(s => { if (s.ticker) m[s.ticker] = s; });
    (liveData?.watchlist || []).forEach(s => { if (s.ticker) m[s.ticker] = { ...m[s.ticker], ...s }; });
    return m;
  }, [liveData?.watchlist, liveThemeData]);

  const mergeStock = useCallback((ticker) => {
    const live = liveLookup[ticker] || {};
    const pipe = stockMap?.[ticker] || {};
    const { quality, q_factors } = computeStockQuality(pipe);
    return {
      ticker,
      price: live.price ?? pipe.price,
      change: live.change,
      rel_volume: live.rel_volume ?? pipe.rel_volume,
      avg_volume_raw: pipe.avg_volume_raw,
      grade: pipe.grade,
      rs_rank: pipe.rs_rank,
      return_1m: live.perf_month ?? pipe.return_1m,
      return_3m: live.perf_quart ?? pipe.return_3m,
      pct_from_high: live.high_52w ?? pipe.pct_from_high,
      atr_to_50: pipe.atr_to_50,
      adr_pct: pipe.adr_pct,
      eps_past_5y: pipe.eps_past_5y,
      eps_this_y: pipe.eps_this_y,
      eps_qq: pipe.eps_qq,
      eps_yoy: pipe.eps_yoy,
      sales_past_5y: pipe.sales_past_5y,
      sales_qq: pipe.sales_qq,
      sales_yoy: pipe.sales_yoy,
      pe: live.pe ?? pipe.pe,
      roe: pipe.roe,
      profit_margin: pipe.profit_margin,
      rsi: live.rsi ?? pipe.rsi,
      themes: pipe.themes || [],
      theme: pipe.themes?.[0]?.theme || live.sector || "",
      subtheme: pipe.themes?.[0]?.subtheme || "",
      company: live.company || pipe.company || "",
      vcs: pipe.vcs,
      vcs_components: pipe.vcs_components,
      mf: pipe.mf,
      mf_components: pipe.mf_components,
      _mfPct: pipe._mfPct,
      avg_dollar_vol: pipe.avg_dollar_vol,
      avg_dollar_vol_raw: pipe.avg_dollar_vol_raw,
      dvol_accel: pipe.dvol_accel,
      dvol_ratio_5_20: pipe.dvol_ratio_5_20,
      dvol_wow_chg: pipe.dvol_wow_chg,
      earnings_days: pipe.earnings_days,
      earnings_display: pipe.earnings_display,
      earnings_date: pipe.earnings_date,
      er: pipe.er,
      _scanHits: pipe._scanHits || [],
      _epsScore: pipe._epsScore,
      _msScore: pipe._msScore,
      _quality: quality,
      _q_factors: q_factors,
    };
  }, [liveLookup, stockMap]);

  const handleAddP = () => { const t = addTickerP.trim().toUpperCase(); if (t) addToPkn(t); setAddTickerP(""); };
  const handleAddW = () => { const t = addTickerW.trim().toUpperCase(); if (t) addToPknWatch(t); setAddTickerW(""); };

  const sortFn = (key, desc = true) => (a, b) => {
    const av = a[key] ?? (desc ? -Infinity : Infinity);
    const bv = b[key] ?? (desc ? -Infinity : Infinity);
    return desc ? bv - av : av - bv;
  };

  const makeSorters = () => ({
    ticker: (a, b) => a.ticker.localeCompare(b.ticker),
    quality: sortFn("_quality"),
    eps_score: sortFn("_epsScore"),
    ms_score: sortFn("_msScore"),
    hits: (a, b) => ((b._scanHits?.length || 0) - (a._scanHits?.length || 0)) || ((b.rs_rank ?? 0) - (a.rs_rank ?? 0)),
    vcs: sortFn("vcs"),
    mf: sortFn("mf"),
    change: sortFn("change"), rs: sortFn("rs_rank"), ret3m: sortFn("return_3m"),
    fromhi: (a, b) => (b.pct_from_high ?? -999) - (a.pct_from_high ?? -999),
    atr50: sortFn("atr_to_50"), adr: sortFn("adr_pct"),
    dvol: sortFn("avg_dollar_vol_raw"),
    vol: (a, b) => {
      const av = a.avg_volume_raw && a.rel_volume ? a.avg_volume_raw * a.rel_volume : 0;
      const bv = b.avg_volume_raw && b.rel_volume ? b.avg_volume_raw * b.rel_volume : 0;
      return bv - av;
    },
    rel_volume: sortFn("rel_volume"),
    volume: sortFn("avg_volume_raw"),
    pe: (a, b) => (a.pe ?? 9999) - (b.pe ?? 9999),
    roe: sortFn("roe"), margin: sortFn("profit_margin"),
    rsi: sortFn("rsi"), price: sortFn("price"),
    theme: (a, b) => (a.theme || "").localeCompare(b.theme || ""),
    subtheme: (a, b) => (a.subtheme || "").localeCompare(b.subtheme || ""),
  });

  const sortList = (list, sortKey) => {
    const sorters = makeSorters();
    const sorted = [...list];
    if (sorters[sortKey]) sorted.sort(sorters[sortKey]);
    return sorted;
  };

  const pknMerged = useMemo(() => sortList(pkn.map(mergeStock), pSort), [pkn, mergeStock, pSort, liveLookup]);
  const pknWatchMerged = useMemo(() => sortList(pknWatch.map(mergeStock), wlSort), [pknWatch, mergeStock, wlSort, liveLookup]);

  useEffect(() => {
    if (!onVisibleTickers) return;
    const pTickers = pknMerged.map(s => s.ticker);
    const wTickers = pknWatchMerged.map(s => s.ticker);
    const combined = [...pTickers, ...wTickers.filter(t => !pTickers.includes(t))];
    onVisibleTickers(combined);
  }, [pSort, wlSort, pkn, pknWatch, liveData]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      {/* Status bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: loading ? "#fbbf24" : "#2bb886" }}>●</span>
          <span style={{ fontSize: 12, color: "#9090a0" }}>
            {loading ? "Loading..." : lastUpdate ? \`Updated \${lastUpdate.toLocaleTimeString()}\` : ""}
          </span>
          <span style={{ fontSize: 11, color: "#686878" }}>Auto-refresh 60s</span>
          <button onClick={fetchLive} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
            background: "#222230", border: "1px solid #3a3a4a", color: "#9090a0" }}>↻ Refresh</button>
        </div>
        {error && <span style={{ fontSize: 11, color: "#f87171" }}>Error: {error}</span>}
      </div>

      {/* ── 1. PKN ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ color: "#e879f9", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>
            PKN ({pkn.length})
          </span>
          <TickerInput value={addTickerP} setValue={setAddTickerP} onAdd={handleAddP} />
        </div>
        {pkn.length === 0 ? (
          <div style={{ color: "#686878", fontSize: 12, padding: 10, background: "#141420", borderRadius: 6, border: "1px solid #222230" }}>
            Add tickers above or click <span style={{ color: "#e879f9" }}>+ PKN</span> on charts.
          </div>
        ) : (
          <LiveSectionTable activeTicker={activeTicker} onTickerClick={onTickerClick} data={pknMerged} sortKey={pSort} setter={setPSort} onRemove={removeFromPkn} />
        )}
      </div>

      {/* ── 2. PKN Watch ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ color: "#a78bfa", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>
            PKN Watch ({pknWatch.length})
          </span>
          <TickerInput value={addTickerW} setValue={setAddTickerW} onAdd={handleAddW} />
        </div>
        {pknWatch.length === 0 ? (
          <div style={{ color: "#686878", fontSize: 12, padding: 10, background: "#141420", borderRadius: 6, border: "1px solid #222230" }}>
            Add tickers above or click <span style={{ color: "#a78bfa" }}>+ PKN W</span> on charts.
          </div>
        ) : (
          <div style={{ maxHeight: 464, overflowY: "auto", border: "1px solid #222230", borderRadius: 4 }}>
            <LiveSectionTable activeTicker={activeTicker} onTickerClick={onTickerClick} data={pknWatchMerged} sortKey={wlSort} setter={setWlSort} onRemove={removeFromPknWatch} />
          </div>
        )}
      </div>
    </div>
  );
}

function LiveView({ stockMap, onTickerClick, activeTicker, onVisibleTickers, portfolio, setPortfolio, watchlist, setWatchlist, addToWatchlist, removeFromWatchlist, addToPortfolio, removeFromPortfolio, liveThemeData, homepage }) {`,
  "replace"
);

// ─── EDIT 14: Highlight PKN items in Scan table (left border) ───
// Add pkn/pknWatch border indicator alongside portfolio/watchlist
apply("14-scan-border",
  `const inPortfolio = portfolio?.includes(s.ticker);
          const inWatchlist = watchlist?.includes(s.ticker);`,
  `const inPortfolio = portfolio?.includes(s.ticker);
          const inWatchlist = watchlist?.includes(s.ticker);
          const inPkn = false; // PKN border handled via chart panel`,
  "replace"
);

fs.writeFileSync(path, code);
console.log(`\n✅ Done — ${edits}/14 edits applied to ${path}`);
console.log("\nColors:");
console.log("  PKN:       #e879f9 (pink/fuchsia)");
console.log("  PKN Watch: #a78bfa (purple)");
console.log("\nDeploy:");
console.log("  git add src/App.jsx && git commit -m 'add PKN tab with PKN + PKN Watch lists' && git push");
