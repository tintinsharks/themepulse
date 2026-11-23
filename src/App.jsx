// ════════════════════════════════════════════════════════════════════════════
// ThemePulse — Aria Trading Dashboard (Vercel-hosted)
// ════════════════════════════════════════════════════════════════════════════
// Migration plan: ~/.claude/plans/lively-zooming-meteor.md
// Legacy file: src/App.jsx.legacy.bak (12,597 lines)
//
// Phase 1 ✓ — Scaffolding + data hooks
// Phase 2.1 (current) — Market Breadth Bar + Scan Watch (Scan view)
// Phase 2.2 — PM/AH/EP/ETF/QQQ subviews
// Phase 2.3 — Agent Picks panel
// Phase 2.4 — Lightweight Charts panel + Watchlist + Ticker Info
// Phase 3   — Vercel KV picks endpoints
// Phase 4   — Repoint local cron to Vercel
// Phase 5   — Cutover
// ════════════════════════════════════════════════════════════════════════════

import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { ARIA_DARK, ARIA_LIGHT, ARIA } from "./styles.js";
import { isPipelineStale, getAuthToken, setAuthToken, authHeaders, authFetch } from "./utils.js";
import { quoteStore } from "./liveQuotes.js";
import { mergeTrades, applyClearTombstone, newestStamp } from "./wheelTrades.js";
import LeadershipView, { LEAD_INDEXES, zvrFor, useRvolProfiles, useJson, TierMark } from "./LeadershipView.jsx";
import { closingRange } from "./lead/math.js";

// One-time cleanup: preferences saved by the retired Dash tab (Scan Watch,
// rotation board, chain table, earnings calendar). Nothing reads them now.
try {
  if (!localStorage.getItem("tp_dash_cleanup_v1")) {
    ["themepulse-scan-width2", "tp-breadth-sym", "tp-chain-crp-only", "tp-chain-fc-only", "tp-chain-heat-alpha", "tp-chain-leaders-only", "tp-chain-pf-only", "tp-chain-pos-only", "tp-chain-setups-only", "tp-chain-sort", "tp-er-cal-mode", "tp-er-cal-open", "tp-exthours-collapsed", "tp-funnel-layers", "tp-holdings-w", "tp-regime-collapsed", "tp-regime-h2", "tp-rs-board-open", "tp-scan-height", "tp-scan-panel-h", "tp-tags-open", "tp-stack-snapshot"].forEach((k) => localStorage.removeItem(k));
    localStorage.setItem("tp_dash_cleanup_v1", "1");
  }
} catch { /* storage blocked — nothing to clean */ }
const LEAD_INDEX_TICKERS = LEAD_INDEXES.map((x) => x.t);

// ──────────────────────────────────────────────────────────────────────────
// Theme system: Aria light/dark palettes via React context
// ──────────────────────────────────────────────────────────────────────────
//
// The App root reads themepulse-theme from localStorage and provides the
// active palette + toggle via AriaThemeContext. Each component starts with
//   const ARIA = useAriaTheme();
// then references ARIA.bg, ARIA.text, etc. as before — the values flip when
// the user toggles theme.
//
// NOTE: the legacy chart components (LWChartLegacy.jsx) use hardcoded dark
// hex colors and don't yet respect this theme. Phase 2.8b will thread the
// palette into them.

const AriaThemeContext = React.createContext({
  ARIA: ARIA_DARK,
  themeMode: "dark",
  toggleTheme: () => {},
  zoom: 1,
  changeZoom: () => {},
});

function useAriaTheme() {
  return React.useContext(AriaThemeContext).ARIA;
}
function useAriaThemeControls() {
  return React.useContext(AriaThemeContext);
}

// ──────────────────────────────────────────────────────────────────────────
// Constants — ported from Aria's scan-watch defaults
// ──────────────────────────────────────────────────────────────────────────

// ── Minervini Trend Template helpers — 7 price criteria arrive from the
// pipeline as a bitmask (tt_mask); the 8th (RS rank ≥ 70) is applied here
// where the cross-sectional rank lives. ttCount → 0-8 or null (no data yet).
const TT_LABELS = [
  "price > 150d & 200d MAs", "150d MA > 200d MA", "200d MA rising ≥1 month",
  "50d > 150d > 200d", "price > 50d MA", "≥30% above 52w low",
  "within 25% of 52w high", "RS rank ≥ 70",
];
function ttCount(s) {
  if (s?.tt_mask == null) return null;
  let n = 0;
  for (let i = 0; i < 7; i++) if (s.tt_mask & (1 << i)) n++;
  return n + ((s.rs_rank || 0) >= 70 ? 1 : 0);
}
function ttFails(s) {
  const out = [];
  for (let i = 0; i < 7; i++) if (!(s?.tt_mask & (1 << i))) out.push(TT_LABELS[i]);
  if ((s?.rs_rank || 0) < 70) out.push(TT_LABELS[7]);
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Style helpers (used by Scan Watch + future panels)
// ──────────────────────────────────────────────────────────────────────────

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, err: null, info: null };
  }
  static getDerivedStateFromError(err) {
    return { hasError: true, err };
  }
  componentDidCatch(err, info) {
    console.error("ErrorBoundary caught:", err, info);
    // Capture the component stack so we can display it
    this.setState({ info });
  }
  render() {
    if (this.state.hasError) {
      const stack = this.state.info?.componentStack || "";
      // Find the most-derived (first) custom component name in the stack
      // Lines look like: "    at ChartPanelInline (https://...)"
      const lines = stack.split("\n").filter((l) => l.trim().startsWith("at "));
      const firstLine = lines[0] || "";
      const m = firstLine.match(/at\s+(\w+)/);
      const culprit = m ? m[1] : "unknown";
      return (
        <div style={{ padding: 16, color: ARIA.red, fontFamily: "monospace" }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
            Render error in <span style={{ color: ARIA.yellow }}>{culprit}</span>
          </div>
          <div style={{ fontSize: 10, color: ARIA.textDim, marginBottom: 8 }}>
            {String(this.state.err)}
          </div>
          {stack && (
            <details style={{ marginBottom: 8 }}>
              <summary
                style={{
                  fontSize: 9,
                  color: ARIA.textMuted,
                  cursor: "pointer",
                }}
              >
                Component stack (top 8)
              </summary>
              <pre
                style={{
                  fontSize: 9,
                  color: ARIA.textDim,
                  background: ARIA.bg,
                  padding: 8,
                  borderRadius: 4,
                  overflow: "auto",
                  maxHeight: 200,
                  marginTop: 4,
                  whiteSpace: "pre-wrap",
                }}
              >
                {lines.slice(0, 8).join("\n")}
              </pre>
            </details>
          )}
          <button
            onClick={() =>
              this.setState({ hasError: false, err: null, info: null })
            }
            style={{
              padding: "6px 14px",
              background: "transparent",
              border: `1px solid ${ARIA.green}`,
              color: ARIA.green,
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 11,
              fontFamily: "monospace",
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Data fetching hooks
// ──────────────────────────────────────────────────────────────────────────

function useDashboardData() {
  const [data, setData] = useState({
    loading: true,
    error: null,
    pipeline: null,
  });
  const [retryNonce, setRetryNonce] = useState(0);
  const retry = useCallback(() => {
    setData({ loading: true, error: null, pipeline: null });
    setRetryNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let lastFetchMs = 0;
    // The pipeline refreshes dashboard_data.json every ~30 min, 6:00 AM–5:30 PM
    // ET Mon–Fri. Poll on that cadence so an open tab picks up new movers/EP/
    // scan data without a manual reload; skip polls outside the pipeline window.
    const inPipelineWindow = () => {
      const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
      const day = et.getDay(), mins = et.getHours() * 60 + et.getMinutes();
      return day >= 1 && day <= 5 && mins >= 360 && mins <= 1050; // 6:00–17:30 ET
    };
    const load = (isRefresh = false) => {
      lastFetchMs = Date.now();
      fetch("/dashboard_data.json", { cache: "no-cache" })
        .then((r) => (r.ok ? r.json() : null))
        .then((pipeline) => {
          if (cancelled) return;
          setData((prev) => {
            // On background refreshes, only re-render when the pipeline
            // actually produced a new run (avoids churn on no-op polls).
            if (isRefresh && pipeline && prev.pipeline &&
                pipeline.pipeline_meta?.last_run === prev.pipeline.pipeline_meta?.last_run) return prev;
            if (isRefresh && !pipeline) return prev; // keep stale data over an error blip
            return { loading: false, error: pipeline ? null : "Failed to load dashboard_data.json", pipeline };
          });
        })
        .catch(() => {
          if (cancelled) return;
          setData((prev) => (isRefresh && prev.pipeline) ? prev
            : { loading: false, error: "Failed to load dashboard_data.json", pipeline: null });
        });
    };
    load();
    const iv = setInterval(() => { if (inPipelineWindow()) load(true); }, 30 * 60 * 1000);
    // Coming back to the tab after a while → catch up immediately.
    const onVis = () => {
      if (document.visibilityState === "visible" && inPipelineWindow() && Date.now() - lastFetchMs > 10 * 60 * 1000) load(true);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [retryNonce]);

  return { ...data, retry };
}


// Polls the three picks endpoints (Phase 4). Falls back to static JSON files
// in /public/ if the live endpoints return empty/error — useful for local dev
// before the Vercel KV env vars are set up.

// ── Centralized live-quote hook (backed by shared src/liveQuotes.js store) ──
function useLiveQuotes(tickers, _intervalMs) {
  const [tick, forceUpdate] = useState(0);
  const idRef = useRef(null);

  const tickerList = useMemo(
    () => (tickers || []).filter(Boolean),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [(tickers || []).slice().sort().join(",")]
  );

  useEffect(() => {
    if (tickerList.length === 0) return;
    idRef.current = quoteStore.register(tickerList, { rthMs: 30000, extMs: 120000, offMs: 0 });
    const unsub = quoteStore.subscribe(() => forceUpdate((n) => n + 1));
    return () => {
      unsub();
      if (idRef.current != null) {
        quoteStore.unregister(idRef.current);
        idRef.current = null;
      }
    };
  }, [tickerList]);

  const quotes = useMemo(() => {
    void tick;
    return quoteStore.getMap(tickerList);
  }, [tickerList, tick]);

  return { quotes, updated: quoteStore.getUpdated() };
}

// Cached daily OHLC fetch (shared across chart selections).
const _ohlcCache = new Map();
async function fetchOhlcBars(ticker) {
  if (_ohlcCache.has(ticker)) return _ohlcCache.get(ticker);
  try {
    const r = await authFetch(`/api/ohlc?ticker=${encodeURIComponent(ticker)}`);
    const d = r.ok ? await r.json() : null;
    const bars = (d?.ohlc || []).filter((x) => x.close != null);
    _ohlcCache.set(ticker, bars);
    return bars;
  } catch {
    _ohlcCache.set(ticker, []);
    return [];
  }
}

// ──────────────────────────────────────────────────────────────────────────
// RS Rotation Board — sector/industry relative-strength rank rotation
// ──────────────────────────────────────────────────────────────────────────
// Reads /data/rs_rotation.json (pipeline 10c_rs_rotation.py). Collapsible.
// SPY daily closes (date -> close), cached once — RS-line denominator (stock / SPY)
// for the IBD-style RS line on the ticker chart.
let _spyClosesCache = null, _spyClosesFetching = false; const _spyClosesListeners = [];
function useSpyCloses() {
  const [m, setM] = useState(_spyClosesCache);
  useEffect(() => {
    if (_spyClosesCache) { setM(_spyClosesCache); return; }
    if (_spyClosesFetching) { _spyClosesListeners.push(setM); return; }
    _spyClosesFetching = true;
    fetchOhlcBars("SPY").then((bars) => {
      const map = new Map((bars || []).map((b) => [b.date, b.close]));
      _spyClosesCache = map; setM(map);
      _spyClosesListeners.forEach((fn) => fn(map)); _spyClosesListeners.length = 0;
    }).catch(() => { _spyClosesFetching = false; });
  }, []);
  return m;
}

function useRsRotation() { return useJson("/data/rs_rotation.json"); }

// ── Intraday cumulative volume profile (U-shaped) ──
// Expected fraction of a typical day's volume traded N minutes after the
// open. Linear elapsed time badly overstates early-session ZVR (the first
// hour carries ~21% of daily volume in 15% of session time).
const VOL_PROFILE = [[0, 0], [5, 0.04], [15, 0.08], [30, 0.13], [60, 0.21], [90, 0.27], [120, 0.33], [150, 0.38], [180, 0.43], [210, 0.48], [240, 0.53], [270, 0.59], [300, 0.66], [330, 0.74], [360, 0.84], [375, 0.91], [390, 1]];
function sessionVolFraction(minsSinceOpen) {
  const m = Math.max(0, Math.min(390, minsSinceOpen));
  for (let i = 1; i < VOL_PROFILE.length; i++) {
    const [m1, f1] = VOL_PROFILE[i - 1], [m2, f2] = VOL_PROFILE[i];
    if (m <= m2) return f1 + (f2 - f1) * (m - m1) / (m2 - m1);
  }
  return 1;
}

// ── useChainLayers: shares useJson's in-memory cache with LeadershipView ──
function useChainLayers() { return useJson("/data/chain_layers.json"); }




// (LWChart loader removed in Phase 2.7 — the legacy LWChart in
//  src/LWChartLegacy.jsx has its own loadLW() helper that we delegate to.)

// ──────────────────────────────────────────────────────────────────────────
// Server-side persistent state: analyzedPicks + watchlist + portfolio
// ──────────────────────────────────────────────────────────────────────────
//
// All three lists live in Vercel KV under one key, fetched/written via
// /api/userdata. localStorage is used as an offline cache so the UI loads
// instantly and survives offline reads, but the server is the source of
// truth across browser tabs/devices.
//
// Write strategy: optimistic local update → localStorage → debounced 1.5s
// server POST. Multiple updates within the debounce window collapse to a
// single round trip.

const SERVER_STATE_KEY = "themepulse-server-state";
const SERVER_DEBOUNCE_MS = 1500;
const ANALYZED_TTL_MS = 7 * 24 * 60 * 60 * 1000; // mirrors server-side filter
const ANALYZED_MAX = 50;

function emptyServerState() {
  return { analyzedPicks: [], watchlist: [], portfolio: [], focus: [], ondeck: [], listOps: {}, wheelTrades: [], wheelClearedAt: null, updated_at: null };
}

function loadCachedState() {
  try {
    const raw = JSON.parse(localStorage.getItem(SERVER_STATE_KEY) || "null");
    if (raw && typeof raw === "object") {
      // Mirror server TTL on the cached read so stale picks vanish even
      // before the next server GET fires.
      const cutoff = Date.now() - ANALYZED_TTL_MS;
      raw.analyzedPicks = (raw.analyzedPicks || []).filter((p) => {
        if (!p || !p.analyzed_at) return false;
        const t = Date.parse(p.analyzed_at);
        return Number.isFinite(t) && t >= cutoff;
      });
      return { ...emptyServerState(), ...raw };
    }
  } catch {}
  return emptyServerState();
}

function saveCachedState(state) {
  try {
    localStorage.setItem(SERVER_STATE_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent("tp-server-state-changed"));
  } catch {}
}

// ── List sync: LWW-element-set ────────────────────────────────────────────
// Lists used to merge by UNION, which meant a delete could never propagate:
// any device/tab holding a stale cached list would re-add every ticker you
// had deleted and push it back to the server ("names I deleted keep coming
// back"). Now every add/remove writes a timestamped op to `listOps` keyed
// "field:TICKER"; merges take the NEWEST op per key and drop anything whose
// latest op is a delete. Adds still never get lost — a re-add is simply a
// newer op than the delete it supersedes.
const OPS_TTL_MS = 120 * 24 * 60 * 60 * 1000; // forget ops after ~4 months
const OPS_MAX = 800;

function mergeListOps(a, b) {
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) {
    if (!out[k] || (v?.at || "") > (out[k]?.at || "")) out[k] = v;
  }
  const cutoff = new Date(Date.now() - OPS_TTL_MS).toISOString();
  const kept = Object.entries(out)
    .filter(([, v]) => v && v.at && v.at >= cutoff)
    .sort((x, y) => (y[1].at > x[1].at ? 1 : -1))
    .slice(0, OPS_MAX);
  return Object.fromEntries(kept);
}

// Drop items whose most recent op for this field is a delete.
function applyListOps(field, list, ops) {
  if (!ops) return list || [];
  return (list || []).filter((t) => ops[`${field}:${t}`]?.op !== "del");
}

// Record adds/removes by diffing a list mutation.
function opsForChange(field, prev, next, ops) {
  const before = new Set(prev || []);
  const after = new Set(next || []);
  const at = new Date().toISOString();
  const out = { ...(ops || {}) };
  before.forEach((t) => { if (!after.has(t)) out[`${field}:${t}`] = { op: "del", at }; });
  after.forEach((t) => { if (!before.has(t)) out[`${field}:${t}`] = { op: "add", at }; });
  return mergeListOps(out, {});
}

// Module-level singleton so all components share the same in-memory state.
//
// Race fix: a local mutation tick (`_localTick`) is bumped on every _setState.
// Any in-flight server response (pull OR push) that started before the tick
// was bumped is discarded — local edits win. This prevents the common race
// where the user clicks +WL right after page load and the initial /api/userdata
// GET returns a moment later with a stale state and clobbers the click.
let _moduleState = null;
let _moduleSubs = new Set();
let _debounceTimer = null;
let _localTick = 0;
let _pullPromise = null;

function _getState() {
  if (_moduleState === null) _moduleState = loadCachedState();
  return _moduleState;
}

function _notify() {
  for (const fn of _moduleSubs) fn(_moduleState);
}

function _setState(updater) {
  const cur = _getState();
  const next = typeof updater === "function" ? updater(cur) : updater;
  // Apply TTL on every write
  next.analyzedPicks = (next.analyzedPicks || [])
    .filter((p) => {
      if (!p || !p.analyzed_at) return false;
      const t = Date.parse(p.analyzed_at);
      return Number.isFinite(t) && t >= Date.now() - ANALYZED_TTL_MS;
    })
    .slice(0, ANALYZED_MAX);
  _moduleState = { ...cur, ...next, updated_at: new Date().toISOString() };
  _localTick++;
  saveCachedState(_moduleState);
  _notify();
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(_pushToServer, SERVER_DEBOUNCE_MS);
}

let _pendingAuthRetry = false;
if (typeof window !== "undefined") {
  window.addEventListener("tp-auth-changed", (e) => {
    if (e?.detail?.unlocked && _pendingAuthRetry) {
      _pendingAuthRetry = false;
      _pushToServer();
    }
  });
}

async function _pushToServer() {
  _debounceTimer = null;
  const s = _getState();
  const tickAtStart = _localTick;
  try {
    const r = await authFetch("/api/userdata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        analyzedPicks: s.analyzedPicks,
        watchlist: s.watchlist,
        portfolio: s.portfolio,
        focus: s.focus,
        ondeck: s.ondeck,
        listOps: s.listOps,
        wheelTrades: s.wheelTrades,
        wheelClearedAt: s.wheelClearedAt,
      }),
    });
    if (r.status === 401) {
      _pendingAuthRetry = true;
      return;
    }
    if (!r.ok) return;
    const d = await r.json();
    if (!d.ok) return;
    // Discard server echo if local state has been mutated again since we
    // started this push (avoids losing rapid sequential clicks).
    if (_localTick !== tickAtStart) return;
    _moduleState = {
      ...emptyServerState(),
      analyzedPicks: d.analyzedPicks || [],
      watchlist: d.watchlist || [],
      portfolio: d.portfolio || [],
      focus: d.focus || [],
      ondeck: d.ondeck || [],
      listOps: d.listOps || {},
      wheelTrades: d.wheelTrades || [],
      wheelClearedAt: d.wheelClearedAt || null,
      updated_at: d.updated_at || null,
    };
    saveCachedState(_moduleState);
    _notify();
  } catch {
    /* offline — keep optimistic local state */
  }
}

function _pullFromServer() {
  if (_pullPromise) return _pullPromise; // dedupe across mounts
  const tickAtStart = _localTick;
  _pullPromise = (async () => {
    try {
      const r = await authFetch("/api/userdata", { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      if (!d.ok) return;
      // If user mutated state while we were fetching, discard server snapshot.
      if (_localTick !== tickAtStart) return;
      const local = _getState();
      // Union the lists so an add is never lost, then let the merged op log
      // decide membership: anything whose newest op is a delete is dropped,
      // so a stale device can no longer resurrect deleted tickers (and a
      // re-add, being newer than its delete, still wins).
      const ops = mergeListOps(d.listOps, local.listOps);
      const union = (a, b) => { const s = new Set(a || []); (b || []).forEach((t) => s.add(t)); return [...s]; };
      const resolve = (field) => applyListOps(field, union(d[field], local[field]), ops);
      const mergedWl = resolve("watchlist");
      const mergedPf = resolve("portfolio");
      const mergedOd = resolve("ondeck");
      const mergedFocus = resolve("focus").filter((t) => !mergedOd.includes(t));
      // Push back if our view differs from the server's in either direction
      // (extra items to add, or deletes the server hasn't applied yet).
      const differs = (mine, theirs) => mine.length !== (theirs || []).length || mine.some((t) => !(theirs || []).includes(t));
      // Wheel trades are records, not tickers, so the op log doesn't apply:
      // union them with the same claim-once merge the import path uses, then
      // honour whichever device cleared most recently.
      const wheelClearedAt = newestStamp(d.wheelClearedAt, local.wheelClearedAt);
      const mergedWheel = applyClearTombstone(
        mergeTrades(d.wheelTrades || [], local.wheelTrades || []).trades,
        wheelClearedAt
      );
      const serverStale =
        differs(mergedWl, d.watchlist) || differs(mergedPf, d.portfolio) ||
        differs(mergedFocus, d.focus) || differs(mergedOd, d.ondeck) ||
        mergedWheel.length !== (d.wheelTrades || []).length ||
        wheelClearedAt !== (d.wheelClearedAt || null);
      _moduleState = {
        ...emptyServerState(),
        analyzedPicks: d.analyzedPicks || [],
        watchlist: mergedWl,
        portfolio: mergedPf,
        focus: mergedFocus,
        ondeck: mergedOd,
        listOps: ops,
        wheelTrades: mergedWheel,
        wheelClearedAt,
        updated_at: d.updated_at || null,
      };
      saveCachedState(_moduleState);
      _notify();
      if (serverStale) {
        if (_debounceTimer) clearTimeout(_debounceTimer);
        _debounceTimer = setTimeout(_pushToServer, 800);
      }
    } catch {
      /* offline — keep cached state */
    }
  })();
  return _pullPromise;
}

function useServerState() {
  const [state, setStateLocal] = useState(_getState);
  useEffect(() => {
    _moduleSubs.add(setStateLocal);
    // Pull once per page-load (module-scoped promise dedupes).
    _pullFromServer();
    const onStorage = () => {
      _moduleState = loadCachedState();
      setStateLocal(_moduleState);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("tp-server-state-changed", onStorage);
    return () => {
      _moduleSubs.delete(setStateLocal);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("tp-server-state-changed", onStorage);
    };
  }, []);
  return state;
}

// ──────────────────────────────────────────────────────────────────────────
// Analyzed picks: on-demand 4-agent analysis stored in localStorage
// ──────────────────────────────────────────────────────────────────────────
//
// User clicks "Analyze" on a ticker → POST to /api/analyze-ticker → result
// is prepended to the local list (cap 50, dedupe by ticker, newest first).
// The Agent Picks subtab renders this list under a new "Analyzed" tab.



// Cross-component pub/sub for portfolio + watchlist sync. Whenever any
// component mutates `themepulse-portfolio` or `themepulse-watchlist` in
// localStorage, it dispatches `tp-pw-changed` so all subscribers re-read.
function useLocalStorageList(key) {
  const state = useServerState();
  const field =
    key === "themepulse-watchlist"
      ? "watchlist"
      : key === "themepulse-portfolio"
      ? "portfolio"
      : key === "themepulse-focus"
      ? "focus"
      : key === "themepulse-ondeck"
      ? "ondeck"
      : null;
  const list = field ? state[field] || [] : [];
  const update = useCallback(
    (next) => {
      if (!field) return;
      _setState((s) => {
        const cur = s[field] || [];
        const value = typeof next === "function" ? next(cur) : next;
        return { ...s, [field]: value, listOps: opsForChange(field, cur, value, s.listOps) };
      });
    },
    [field]
  );
  return [list, update];
}

// Aria-style colored mini-badge (used in chart header for 9M / VOL / HI / Grade)
const badgeStyle = (color) => ({
  fontSize: 9,
  padding: "0 3px",
  borderRadius: 2,
  fontWeight: 700,
  color,
  border: `1px solid ${color}`,
  background: `${color}26`,
  marginLeft: 3,
});


// ── CANSLIM scorecard helpers ──
// gradeBand maps a numeric value to a letter using descending thresholds
// [A+, A, B, C, D]. Anything below D → F; null/NaN → "—".
const CANSLIM_LETTERS = ["A+", "A", "B", "C", "D", "F"];
function gradeBand(v, t) {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= t[0]) return "A+";
  if (v >= t[1]) return "A";
  if (v >= t[2]) return "B";
  if (v >= t[3]) return "C";
  if (v >= t[4]) return "D";
  return "F";
}
function avgLetter(grades) {
  const ord = { "A+": 5, A: 4, B: 3, C: 2, D: 1, F: 0 };
  const nums = grades.map((g) => ord[g]).filter((n) => n != null);
  if (nums.length === 0) return "—";
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  const idx = Math.max(0, Math.min(5, 5 - Math.round(avg)));
  return CANSLIM_LETTERS[idx];
}
// Compact CANSLIM composite (letter A+..F) from synchronously-available
// fields — same gradeBand thresholds as the full IBD scorecard, dropping
// the async 12mo-RS and CF-vs-EPS criteria. Used in the chart panel's perf bar.
function canslimComposite(stockInfo, annuals, stockMap) {
  if (!stockInfo) return "—";
  const epsYoy = stockInfo.eps_yoy ?? null;
  const epsYoyPrev = stockInfo.eps_yoy_prev ?? null;
  const accel = (epsYoy != null && epsYoyPrev != null) ? epsYoy - epsYoyPrev : null;
  let eps5y = null;
  const tryW = (n) => {
    if (!Array.isArray(annuals) || annuals.length < n) return null;
    const a = annuals.slice(-n); const f = a[0]?.eps, l = a[a.length - 1]?.eps;
    if (f == null || l == null || f <= 0 || l <= 0) return null;
    return (Math.pow(l / f, 1 / (a.length - 1)) - 1) * 100;
  };
  for (const n of [5, 4, 3]) { const v = tryW(n); if (v != null) { eps5y = v; break; } }
  if (eps5y == null) eps5y = stockInfo.eps_past_5y ?? null;
  const salesYoy = stockInfo.sales_yoy ?? null;
  const margin = (() => { const m = stockInfo.profit_margin ?? null; return m != null ? (m < 1 ? m * 100 : m) : null; })();
  const roe = (() => { const r = stockInfo.roe ?? null; return r != null ? (Math.abs(r) < 5 ? r * 100 : r) : null; })();
  const instTrans = stockInfo.inst_trans_pct ?? null;
  const pctFromHigh = stockInfo.pct_from_high ?? stockInfo.off_52w_high ?? null;
  const distFromHigh = pctFromHigh != null ? Math.abs(pctFromHigh) : null;
  let industryPct = null;
  const industry = stockInfo.industry, myRs = stockInfo.rs_rank;
  if (industry && myRs != null && stockMap) {
    const peers = Object.values(stockMap).filter((s) => s && s.industry === industry && s.rs_rank != null);
    if (peers.length >= 3) { const better = peers.filter((s) => s.rs_rank > myRs).length; industryPct = Math.round((1 - better / peers.length) * 100); }
  }
  return avgLetter([
    gradeBand(epsYoy, [100, 50, 25, 10, 0]),
    gradeBand(accel, [30, 10, 0, -10, -25]),
    gradeBand(eps5y, [40, 25, 15, 10, 0]),
    gradeBand(salesYoy, [40, 25, 15, 10, 0]),
    gradeBand(margin, [25, 18, 12, 7, 2]),
    gradeBand(roe, [30, 17, 12, 8, 0]),
    gradeBand(instTrans, [2, 1, 0.3, 0, -1]),
    gradeBand(distFromHigh != null ? -distFromHigh : null, [-3, -10, -20, -35, -50]),
    gradeBand(industryPct, [95, 85, 70, 50, 30]),
  ]);
}


// Mini bar chart — one series (EPS or Revenue) across N quarters. Pure CSS:
// each quarter is a flex column with value on top, bar, YoY%, and quarter
// label beneath. Scales proportionally; baseline drops below zero when any
// value is negative (handles EPS loss quarters).
// ── EarningsBox — quarterly + annual fundamentals as one compact grid ─────
// Replaces the four MiniQBars charts. Oldest → newest left to right, next
// quarter's consensus as an orange "Est" column. Cell colors: green = strong
// (YoY ≥ 25%, net margin ≥ 15%), red = negative, blue fill = best in row.
function EarningsBox({ quarters, annuals, est, ARIA, source }) {
  // Compact mode when the chart column is narrow, so no cell ever truncates.
  const boxRef = useRef(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((es) => setW(es[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const compact = w < 520;
  const dark = (ARIA.bg || "").toLowerCase() !== "#f8f9fc";
  const C = {
    box: dark ? "#0b0b0e" : "#ffffff",
    head: dark ? "#26262b" : "#eceef3",
    line: dark ? "#000000" : "#dfe2ea",
    label: dark ? "#e4e4e7" : "#1f2937",
    text: dark ? "#f4f4f5" : "#111827",
    green: dark ? "#4ade80" : "#16a34a",
    red: dark ? "#f87171" : "#dc2626",
    orange: dark ? "#f5a524" : "#d97706",
    blue: "#2643c9",
  };
  const fmtSales = (m) => (m == null ? "—" : Math.abs(m) >= 1000 ? `${(m / 1000).toFixed(1)} B` : `${Math.round(m)} M`);
  const fmtPct = (v) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(compact && Math.abs(v) >= 100 ? 0 : 1)}%`);
  const fmtEps = (v) => (v == null || !Number.isFinite(v) ? "—" : String(+v.toFixed(2)));
  const rows = [
    { k: "eps", label: "EPS ($)", fmt: fmtEps, kind: "eps" },
    { k: "eps_yoy", label: "EPS YoY %", fmt: fmtPct, kind: "growth" },
    { k: "revenue", label: "Sales ($)", fmt: fmtSales, kind: "plain" },
    { k: "revenue_yoy", label: "Sales YoY %", fmt: fmtPct, kind: "growth" },
    { k: "net_margin", label: compact ? "Net Mgn %" : "Net Margin %", fmt: fmtPct, kind: "margin" },
  ];
  const cell = { padding: compact ? "6px 2px" : "7px 6px", textAlign: "center", fontSize: compact ? 11 : 13, borderBottom: `1px solid ${C.line}`, borderLeft: `1px solid ${C.line}`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" };
  const color = (row, v, isMax, isEst) => {
    if (v == null || !Number.isFinite(v)) return { color: C.label, opacity: 0.45 };
    if (isMax) return { background: C.blue, color: "#fff" };
    if (isEst) return { color: C.orange };
    if (v < 0) return { color: C.red };
    if (row.kind === "growth" && v >= 25) return { color: C.green };
    if (row.kind === "margin" && v >= 15) return { color: C.green };
    return { color: C.text };
  };
  const section = (title, cols) => {
    if (!cols.length) return null;
    const pad = Array.from({ length: Math.max(0, 6 - cols.length) }, () => null);
    return (
      <>
        <tr style={{ background: C.head }}>
          <td style={{ ...cell, textAlign: "left", borderLeft: "none", color: C.label, fontWeight: 500 }}>{title}</td>
          {cols.map((c, i) => <td key={i} title={c._label} style={{ ...cell, color: c._est ? C.orange : C.label, fontWeight: 500 }}>{compact && c._est ? "Est" : c._label}</td>)}
          {pad.map((_, i) => <td key={`p${i}`} style={cell} />)}
        </tr>
        {rows.map((row) => {
          const actual = cols.filter((c) => !c._est).map((c) => c[row.k]).filter((v) => v != null && Number.isFinite(v));
          const max = (row.kind === "growth" || row.kind === "margin") && actual.length > 1 ? Math.max(...actual) : null;
          return (
            <tr key={row.k}>
              <td style={{ ...cell, textAlign: "left", borderLeft: "none", color: C.label }}>{row.label}</td>
              {cols.map((c, i) => {
                const v = c[row.k];
                const isMax = max != null && max > 0 && v === max && !c._est;
                return <td key={i} style={{ ...cell, ...color(row, v, isMax, c._est) }}>{row.fmt(v)}</td>;
              })}
              {pad.map((_, i) => <td key={`p${i}`} style={cell} />)}
            </tr>
          );
        })}
      </>
    );
  };
  return (
    <div ref={boxRef} title={source} style={{ background: C.box, border: `1px solid ${C.line}`, borderRadius: 6, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed",
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif" }}>
        <colgroup><col style={{ width: compact ? "19.6%" : "22%" }} />{Array.from({ length: 6 }, (_, i) => <col key={i} style={{ width: compact ? "13.4%" : "13%" }} />)}</colgroup>
        <tbody>
          {section("Quarterly", [...(est ? quarters.slice(-5) : quarters.slice(-6)), ...(est ? [est] : [])])}
          {section("Annual", annuals.slice(-6))}
        </tbody>
      </table>
    </div>
  );
}



// ──────────────────────────────────────────────────────────────────────────
// DailyChartSVG — inline SVG candlestick chart with MAs, volume overlays,
// Wilder's smoothed ATR — identical to ThinkScript ta.atr / Pine ta.atr.
function calcWilderATR(bars, period = 14) {
  if (!bars || bars.length < period) return null;
  const tr = bars.map((b, i) =>
    i === 0
      ? b.high - b.low
      : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close))
  );
  let atr = null;
  for (let i = 0; i < tr.length; i++) {
    if (i < period - 1) continue;
    if (i === period - 1) atr = tr.slice(0, period).reduce((s, v) => s + v, 0) / period;
    else atr = (atr * (period - 1) + tr[i]) / period;
  }
  return atr;
}

// Risk position-sizing — port of ThinkScript calc_size().
function calcRiskSize(stopPrice, entryPrice, accountSize, riskPct, maxAllocPct) {
  const dist = entryPrice - stopPrice;
  if (dist <= 0 || entryPrice <= 0) return null;
  const riskUsd = accountSize * (riskPct / 100);
  const maxPosUsd = accountSize * (maxAllocPct / 100);
  const distPct = (dist / entryPrice) * 100;
  const rawShares = Math.floor(riskUsd / dist);
  const rawInvested = rawShares * entryPrice;
  const capped = rawInvested > maxPosUsd;
  const finalShares = capped ? Math.floor(maxPosUsd / entryPrice) : rawShares;
  const actInvested = finalShares * entryPrice;
  const actRisk = finalShares * dist;
  const investedPct = (actInvested / accountSize) * 100;
  return { shares: finalShares, risk: actRisk, investedPct, capped, distPct, stopPrice };
}

// ──────────────────────────────────────────────────────────────────────────
// pocket pivots, VCP tightness, +4% breakout hatching, dry-up dots, and
// earnings markers. Ported from theme-leaderboard.html renderDailyChart.
// ──────────────────────────────────────────────────────────────────────────
function DailyChartSVG({ ohlc, quarters, height = 400, stopLines = [], owned = false, rsRating = null, rsRatingColor = null }) {
  const MAX_BARS = 375;
  const DEFAULT_BARS = 168;   // ~8 months of sessions (was 113 ≈ 5.5 months)
  const MIN_VISIBLE = 30;

  // Visible window: endIdx is always the right edge (exclusive), visibleCount is how many bars to show
  const [visibleCount, setVisibleCount] = useState(DEFAULT_BARS);
  const [endIdx, setEndIdx] = useState(null);
  const svgRef = React.useRef(null);
  const containerRef = React.useRef(null);
  const dragRef = React.useRef(null);
  const [containerW, setContainerW] = useState(900);
  const [containerH, setContainerH] = useState(380);
  const [volSubTab, setVolSubTab] = useState("vol");
  const [hoverI, setHoverI] = useState(null); // crosshair bar index (visible window)
  const CH_ARIA = useAriaTheme();
  const [showRS, setShowRS] = useState(() => { try { return localStorage.getItem("tp-chart-rs") !== "0"; } catch { return true; } });
  const benchMap = useSpyCloses();

  // Measure container width + height (chart price panel grows to fill height)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      const h = entries[0]?.contentRect?.height;
      if (w && w > 0) setContainerW(Math.round(w));
      if (h && h > 0) setContainerH(Math.round(h));
    });
    ro.observe(el);
    setContainerW(Math.round(el.offsetWidth) || 900);
    if (el.offsetHeight > 0) setContainerH(Math.round(el.offsetHeight));
    return () => ro.disconnect();
  }, []);

  // Reset view when ticker changes (ohlc reference changes)
  useEffect(() => {
    setVisibleCount(DEFAULT_BARS);
    setEndIdx(null);
  }, [ohlc]);

  // Pre-compute MAs and VCP scores on the full dataset (expensive, only when ohlc changes)
  const precomputed = useMemo(() => {
    if (!ohlc || !ohlc.length) return null;
    const calcEMA = (arr, n) => {
      const k = 2 / (n + 1), out = [];
      let prev = null;
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] == null) { out.push(null); continue; }
        if (prev == null) {
          if (i < n - 1) { out.push(null); continue; }
          let s = 0; for (let j = i - n + 1; j <= i; j++) s += arr[j];
          prev = s / n; out.push(prev);
        } else { prev = arr[i] * k + prev * (1 - k); out.push(prev); }
      }
      return out;
    };
    const calcSMA = (arr, n) => {
      const out = [];
      for (let i = 0; i < arr.length; i++) {
        if (i < n - 1) { out.push(null); continue; }
        let s = 0; for (let j = i - n + 1; j <= i; j++) s += arr[j];
        out.push(s / n);
      }
      return out;
    };
    const fullC = ohlc.map(b => b.close), fullH = ohlc.map(b => b.high), fullL = ohlc.map(b => b.low);
    const fullV = ohlc.map(b => b.volume || 0);

    // VCP scores for the full dataset
    const vcpScores = new Array(ohlc.length).fill(null);
    const TIGHT_LB = 5, ADR_LB = 20, HIST_LB = 50;
    for (let i = 0; i < ohlc.length; i++) {
      if (i < Math.max(TIGHT_LB, ADR_LB) - 1) continue;
      let adrSum = 0, adrCount = 0;
      for (let j = i - ADR_LB + 1; j <= i; j++) {
        if (j < 0) continue;
        const mid = (ohlc[j].high + ohlc[j].low) / 2;
        if (mid > 0) { adrSum += (ohlc[j].high - ohlc[j].low) / mid * 100; adrCount++; }
      }
      if (adrCount === 0) continue;
      const adr = adrSum / adrCount;
      if (adr <= 0) continue;
      let hiC = -Infinity, loC = Infinity, hiH = -Infinity, loL = Infinity;
      for (let j = i - TIGHT_LB + 1; j <= i; j++) {
        if (j < 0) continue;
        hiC = Math.max(hiC, ohlc[j].close); loC = Math.min(loC, ohlc[j].close);
        hiH = Math.max(hiH, ohlc[j].high); loL = Math.min(loL, ohlc[j].low);
      }
      const midC = (hiC + loC) / 2, midHL = (hiH + loL) / 2;
      if (midC <= 0 || midHL <= 0) continue;
      const closeSpread = (hiC - loC) / midC * 100 / adr;
      const swingSpread = (hiH - loL) / midHL * 100 / adr;
      const rawScore = (closeSpread + swingSpread) / 2;
      let histMin = rawScore, histMax = rawScore;
      for (let h = i - HIST_LB + 1; h <= i; h++) {
        if (h < Math.max(TIGHT_LB, ADR_LB) - 1 || h < 0) continue;
        let hAdrSum = 0, hAdrN = 0;
        for (let j2 = h - ADR_LB + 1; j2 <= h; j2++) {
          if (j2 < 0) continue;
          const mid = (ohlc[j2].high + ohlc[j2].low) / 2;
          if (mid > 0) { hAdrSum += (ohlc[j2].high - ohlc[j2].low) / mid * 100; hAdrN++; }
        }
        if (hAdrN === 0) continue;
        const hAdr = hAdrSum / hAdrN;
        if (hAdr <= 0) continue;
        let hHiC = -Infinity, hLoC = Infinity, hHiH = -Infinity, hLoL = Infinity;
        for (let j2 = h - TIGHT_LB + 1; j2 <= h; j2++) {
          if (j2 < 0) continue;
          hHiC = Math.max(hHiC, ohlc[j2].close); hLoC = Math.min(hLoC, ohlc[j2].close);
          hHiH = Math.max(hHiH, ohlc[j2].high); hLoL = Math.min(hLoL, ohlc[j2].low);
        }
        const hMidC = (hHiC + hLoC) / 2, hMidHL = (hHiH + hLoL) / 2;
        if (hMidC <= 0 || hMidHL <= 0) continue;
        const hRaw = ((hHiC - hLoC) / hMidC * 100 / hAdr + (hHiH - hLoL) / hMidHL * 100 / hAdr) / 2;
        histMin = Math.min(histMin, hRaw);
        histMax = Math.max(histMax, hRaw);
      }
      const range = histMax - histMin;
      vcpScores[i] = range > 0 ? Math.max(0, Math.min(100, (rawScore - histMin) / range * 100)) : 50;
    }

    // 14-period Wilder RSI
    const rsiVals = new Array(ohlc.length).fill(null);
    if (ohlc.length > 14) {
      const rp = 14;
      let avgG = 0, avgL = 0;
      for (let i = 1; i <= rp; i++) {
        const d = fullC[i] - fullC[i - 1];
        if (d >= 0) avgG += d; else avgL -= d;
      }
      avgG /= rp; avgL /= rp;
      rsiVals[rp] = avgL === 0 ? 100 : avgG === 0 ? 0 : 100 - 100 / (1 + avgG / avgL);
      for (let i = rp + 1; i < ohlc.length; i++) {
        const d = fullC[i] - fullC[i - 1];
        avgG = (avgG * (rp - 1) + Math.max(d, 0)) / rp;
        avgL = (avgL * (rp - 1) + Math.max(-d, 0)) / rp;
        rsiVals[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
      }
    }

    return {
      ema10: calcEMA(fullC, 10),
      ema21hi: calcEMA(fullH, 21),
      ema21close: calcEMA(fullC, 21),
      ema21lo: calcEMA(fullL, 21),
      sma20: calcSMA(fullC, 20),
      sma50: calcSMA(fullC, 50),
      ema200: calcEMA(fullC, 200),
      volMA: calcSMA(fullV, 50),
      volMA20: calcSMA(fullV, 20),
      vcpScores,
      rsiVals,
      totalBars: ohlc.length,
    };
  }, [ohlc]);

  // Render the visible window
  const chartData = useMemo(() => {
    if (!precomputed || !ohlc || !ohlc.length) return null;
    const total = ohlc.length;
    const count = Math.min(visibleCount, total);
    const end = endIdx != null ? Math.min(endIdx, total) : total;
    const start = Math.max(0, end - count);
    const bars = ohlc.slice(start, end);
    if (bars.length === 0) return null;

    const W = containerW, volH = 80, yAxisW = 48, pad = { l: 0, r: yAxisW, t: 16, b: 0 };
    const volGap = 6;
    // Price panel fills the available container height so the chart grows into
    // the panel (the ~24px reserve is the legend row + x-axis below the SVG).
    const priceH = Math.max(220, Math.min(900, (containerH || 380) - volH - volGap - pad.t - pad.b - 24));
    const totalH = priceH + volGap + volH + pad.t + pad.b;
    const chartRight = W - pad.r;
    const bw = Math.max(2, (chartRight - pad.l) / bars.length - 1);
    const gap = 1;
    const pMax = Math.max(...bars.map(b => b.high));
    const pMin = Math.min(...bars.map(b => b.low));
    const pRange = pMax - pMin || 1;
    const vMax = Math.max(...bars.map(b => b.volume)) || 1;
    const py = (v) => pad.t + (1 - (v - pMin) / pRange) * priceH;
    const volTop = pad.t + priceH + volGap;

    // Sell-discipline violation marker (held names only): the most recent bar
    // where price closed below a key MA while still above the 200-day — a leader
    // cracking support. Drawn as a 🔻 above that candle if it's in view.
    let violMarker = null;
    if (owned && total > 50) {
      const s50 = precomputed.sma50, s20 = precomputed.sma20, e200 = precomputed.ema200;
      const N = total - 1, lastC = ohlc[N].close;
      const above200 = e200[N] != null && lastC > e200[N];
      if (above200) {
        let maArr = null, label = null;
        if (s50[N] != null && lastC < s50[N]) { maArr = s50; label = "50-day"; }
        else if (s20[N] != null && lastC < s20[N]) { maArr = s20; label = "20-day"; }
        if (maArr) {
          let crossFull = -1;
          for (let i = N; i > 0; i--) {
            if (maArr[i] != null && maArr[i - 1] != null && ohlc[i].close < maArr[i] && ohlc[i - 1].close >= maArr[i - 1]) { crossFull = i; break; }
          }
          if (crossFull < 0) crossFull = N;
          const visIdx = crossFull - start;
          if (visIdx >= 0 && visIdx < bars.length) {
            violMarker = { x: pad.l + visIdx * (bw + gap) + bw / 2, y: py(ohlc[crossFull].high) - 6, label };
          }
        }
      }
    }

    // Slice MAs to visible window
    const sliceMA = (ma) => ma.slice(start, end);
    const ema10 = sliceMA(precomputed.ema10);
    const ema21hi = sliceMA(precomputed.ema21hi);
    const ema21close = sliceMA(precomputed.ema21close);
    const ema21lo = sliceMA(precomputed.ema21lo);
    const sma50 = sliceMA(precomputed.sma50);
    const ema200 = sliceMA(precomputed.ema200);
    const volMA = sliceMA(precomputed.volMA);
    const volMA20 = sliceMA(precomputed.volMA20);
    const vcpScores = precomputed.vcpScores.slice(start, end);

    const maPoints = (vals) => {
      const pts = [];
      vals.forEach((v, i) => { if (v != null) pts.push(`${pad.l + i * (bw + gap) + bw / 2},${py(v)}`); });
      return pts.length >= 2 ? pts.join(" ") : null;
    };
    const volMaPoints = () => {
      const pts = [];
      volMA.forEach((v, i) => { if (v != null) pts.push(`${pad.l + i * (bw + gap) + bw / 2},${volTop + (1 - v / vMax) * volH}`); });
      return pts.length >= 2 ? pts.join(" ") : null;
    };

    const candleElements = [];
    const volElements = [];
    bars.forEach((b, i) => {
      const gi = start + i;
      const x = pad.l + i * (bw + gap);
      const isUp = b.close >= b.open;
      const candleColor = isUp ? "#2bb886" : "#f87171";
      const bodyTop = py(Math.max(b.open, b.close));
      const bodyBot = py(Math.min(b.open, b.close));
      const bodyH = Math.max(1, bodyBot - bodyTop);
      const wickX = x + bw / 2;
      candleElements.push(
        <line key={`w${i}`} x1={wickX} y1={py(b.high)} x2={wickX} y2={py(b.low)} stroke={candleColor} strokeWidth={0.9} opacity={0.9} />,
        <rect key={`b${i}`} x={x} y={bodyTop} width={bw} height={bodyH} fill={candleColor} rx={Math.min(1, bw / 4)} stroke="rgba(0,0,0,0.35)" strokeWidth={0.4} />
      );
      const vol = b.volume || 0;
      const chLight = CH_ARIA.bg === "#f8f9fc";
      let vColor;
      if (!isUp) {
        vColor = chLight ? "#94a3b8cc" : "#6b7280cc";
      } else {
        const downVols = [];
        for (let j = gi - 1; j >= 0 && downVols.length < 10; j--) {
          if (ohlc[j].close < ohlc[j].open) downVols.push(ohlc[j].volume || 0);
        }
        if (downVols.length >= 10 && vol > Math.max(...downVols.slice(0, 10))) {
          vColor = "#2563eb";
        } else if (downVols.length >= 5 && vol > Math.max(...downVols.slice(0, 5))) {
          vColor = "#0d9488";
        } else {
          vColor = chLight ? "#64748bcc" : "#ffffffcc";
        }
      }
      const vh = Math.max(0.5, (vol / vMax) * volH);
      const vy = volTop + volH - vh;
      volElements.push(
        <rect key={`v${i}`} x={x} y={vy} width={bw} height={vh} fill={vColor} opacity={0.7} rx={0.3} />
      );
      const prevClose = gi > 0 ? ohlc[gi - 1].close : b.open;
      const prevVol = gi > 0 ? (ohlc[gi - 1].volume || 0) : 0;
      const chg = prevClose > 0 ? (b.close - prevClose) / prevClose * 100 : 0;
      if (chg >= 4 && vol > prevVol && vol > 100000) {
        const slope = bw * 0.4;
        for (let dy = 3; dy < vh - 1; dy += 5) {
          const y1 = vy + dy, y2 = y1 - slope;
          if (y2 >= vy) volElements.push(<line key={`bo${i}_${dy}`} x1={x} y1={y1} x2={x + bw} y2={y2} stroke={chLight ? "#a16207" : "#fbbf24"} strokeWidth={0.8} opacity={0.85} />);
        }
      } else if (chg <= -4 && vol > prevVol && vol > 100000) {
        const slope = bw * 0.4;
        for (let dy = 3; dy < vh - 1; dy += 5) {
          const y1 = vy + dy, y2 = y1 + slope;
          if (y2 <= vy + vh) volElements.push(<line key={`bd${i}_${dy}`} x1={x} y1={y1} x2={x + bw} y2={y2} stroke={chLight ? "#b91c1ccc" : "#f8717180"} strokeWidth={0.8} />);
        }
      }
      const vAvg20 = volMA20[i] || 0;
      if (vAvg20 > 0 && vol < vAvg20 * 0.5 && vol > 0) {
        volElements.push(<circle key={`du${i}`} cx={x + bw / 2} cy={vy - 3} r={1.5} fill={chLight ? "#0f766e" : "#2dd4bf"} opacity={0.9} />);
      }
      const vScore = vcpScores[i];
      if (vScore != null && vScore <= 10) {
        volElements.push(<text key={`t${i}`} x={x + bw / 2} y={vy + vh - 1} textAnchor="middle" fontSize={Math.min(bw + 1, 7)} fontWeight={900} fontFamily="monospace" fill={chLight ? "#92400e" : "#fbbf24"} opacity={0.95}>T</text>);
      }
    });

    const erMarkers = [];
    if (quarters && quarters.length) {
      const chLight = CH_ARIA.bg === "#f8f9fc";
      const barDateIdx = {};
      bars.forEach((b, i) => { barDateIdx[b.date] = i; });
      for (const q of quarters) {
        if (!q.report_date) continue;
        let bestIdx = barDateIdx[q.report_date] ?? -1;
        if (bestIdx < 0) {
          const d = new Date(q.report_date + "T00:00:00");
          for (let j = 1; j <= 5; j++) {
            d.setDate(d.getDate() + 1);
            const ds = d.toISOString().slice(0, 10);
            if (barDateIdx[ds] != null) { bestIdx = barDateIdx[ds]; break; }
          }
        }
        if (bestIdx < 0) continue;
        const x = pad.l + bestIdx * (bw + gap) + bw / 2;
        const ePct = q.eps_yoy != null ? `${q.eps_yoy > 0 ? "+" : ""}${q.eps_yoy.toFixed(0)}%` : "—";
        const sPct = q.sales_yoy != null ? `${q.sales_yoy > 0 ? "+" : ""}${q.sales_yoy.toFixed(0)}%` : "—";
        const dotColor = bars[bestIdx].close >= bars[bestIdx].open ? "#4ade80" : "#f87171";
        erMarkers.push(
          <line key={`erl${q.report_date}`} x1={x} y1={pad.t} x2={x} y2={pad.t + priceH} stroke={dotColor} strokeWidth={0.5} strokeDasharray="2,3" opacity={0.5} />,
          <text key={`ert${q.report_date}`} x={x} y={pad.t + priceH - 10} textAnchor="middle" fontSize={7} fontWeight={700} fill={dotColor} opacity={0.9} fontFamily="ui-monospace,monospace">{q.label || ""}</text>,
          <text key={`ers${q.report_date}`} x={x} y={pad.t + priceH - 2} textAnchor="middle" fontSize={6.5} fontWeight={600} opacity={0.9} fontFamily="ui-monospace,monospace">
            <tspan fill={q.eps_yoy == null ? "#c0c0d8" : q.eps_yoy >= 0 ? (chLight ? "#059669" : "#34d399") : (chLight ? "#dc2626" : "#f87171")}>{ePct}</tspan>
            <tspan fill="#8a8a9a"> | </tspan>
            <tspan fill={q.sales_yoy == null ? "#c0c0d8" : q.sales_yoy >= 0 ? (chLight ? "#059669" : "#34d399") : (chLight ? "#dc2626" : "#f87171")}>{sPct}</tspan>
          </text>
        );
      }
    }

    // Y-axis price ticks — pick ~5-7 nice round values
    const niceStep = (range) => {
      const rough = range / 6;
      const mag = Math.pow(10, Math.floor(Math.log10(rough)));
      const residual = rough / mag;
      const nice = residual <= 1.5 ? 1 : residual <= 3 ? 2 : residual <= 7 ? 5 : 10;
      return nice * mag;
    };
    const step = niceStep(pRange);
    const tickStart = Math.ceil(pMin / step) * step;
    const yAxisElements = [];
    const fmtPrice = (v) => v >= 1000 ? v.toFixed(0) : v >= 100 ? v.toFixed(1) : v.toFixed(2);
    for (let v = tickStart; v <= pMax; v += step) {
      const y = py(v);
      if (y < pad.t + 8 || y > pad.t + priceH - 4) continue;
      yAxisElements.push(
        <line key={`yg${v}`} x1={pad.l} y1={y} x2={chartRight} y2={y} stroke={CH_ARIA.border} strokeWidth={0.5} />,
        <text key={`yl${v}`} x={chartRight + 4} y={y + 3} fontSize={8} fill={CH_ARIA.textMuted} fontFamily="ui-monospace,monospace">${fmtPrice(v)}</text>
      );
    }

    // X-axis month labels at the top
    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const xAxisElements = [];
    let prevMonth = null;
    bars.forEach((b, i) => {
      if (!b.date) return;
      const d = new Date(b.date + "T00:00:00");
      const m = d.getMonth();
      const y = d.getFullYear();
      const key = `${y}-${m}`;
      if (key !== prevMonth) {
        prevMonth = key;
        const x = pad.l + i * (bw + gap) + bw / 2;
        if (x > pad.l + 10 && x < chartRight - 20) {
          const label = m === 0 ? `${MONTHS[m]} '${String(y).slice(2)}` : MONTHS[m];
          xAxisElements.push(
            <line key={`xg${key}`} x1={x} y1={pad.t} x2={x} y2={pad.t + priceH} stroke={CH_ARIA.border} strokeWidth={0.5} strokeDasharray="2,4" />,
            <text key={`xl${key}`} x={x} y={pad.t - 4} fontSize={8} fill="#6a6a7a" fontFamily="ui-monospace,monospace" textAnchor="start">{label}</text>
          );
        }
      }
    });

    const sepY = pad.t + priceH + volGap / 2;

    // RSI path for the indicator pane
    const rsiSlice = precomputed.rsiVals.slice(start, end);
    let rsiPathD = "", prevNull = true, lastRsiX = null, lastRsiY = null, lastRsi = null;
    for (let i = 0; i < rsiSlice.length; i++) {
      const v = rsiSlice[i];
      if (v == null) { prevNull = true; continue; }
      const rx = pad.l + i * (bw + gap) + bw / 2;
      const ry = volTop + (1 - v / 100) * volH;
      rsiPathD += `${prevNull ? "M" : "L"}${rx.toFixed(1)},${ry.toFixed(1)} `;
      prevNull = false;
      lastRsiX = rx; lastRsiY = ry; lastRsi = v;
    }

    // Gradient fill paths — overbought (above 60) and oversold (below 40)
    const y60 = volTop + (1 - 60 / 100) * volH;
    const y40 = volTop + (1 - 40 / 100) * volH;
    const rsiXOf = (i) => pad.l + i * (bw + gap) + bw / 2;
    // Overbought: trace RSI clamped to [60,100] along top, return along y60
    const obTopPts = rsiSlice.map((v, i) => `${rsiXOf(i).toFixed(1)},${(volTop + (1 - Math.max(v ?? 60, 60) / 100) * volH).toFixed(1)}`);
    const rsiOverboughtPathD = rsiSlice.some(v => v != null && v > 60)
      ? `M${rsiXOf(0).toFixed(1)},${y60.toFixed(1)} ${obTopPts.join(" ")} L${rsiXOf(rsiSlice.length - 1).toFixed(1)},${y60.toFixed(1)} Z`
      : null;
    // Oversold: trace RSI clamped to [0,40] along bottom, return along y40
    const osBottomPts = rsiSlice.map((v, i) => `${rsiXOf(i).toFixed(1)},${(volTop + (1 - Math.min(v ?? 40, 40) / 100) * volH).toFixed(1)}`);
    const rsiOversoldPathD = rsiSlice.some(v => v != null && v < 40)
      ? `M${rsiXOf(0).toFixed(1)},${y40.toFixed(1)} ${osBottomPts.join(" ")} L${rsiXOf(rsiSlice.length - 1).toFixed(1)},${y40.toFixed(1)} Z`
      : null;

    // ── Mansfield RS oscillator: (stock/SPY) ÷ its own 21-day MA − 1, drawn
    // zero-centered in a bottom band of the price panel. Above zero (green
    // fill) = in an outperformance trend; below (red fill) = underperforming.
    // The zero-cross IS the turn: ▲ = fresh cross into leadership, ▼ = lost it.
    // Pink dots = RS New High Before Price (raw RS leading price — bullish).
    let rsLinePts = "", rsDots = [], rsCross = [], rsLabelY = null, rsEnd = null, rsBandTop = null, rsBandBot = null, divTint = [], rsPosD = null, rsNegD = null, rsZeroY = null;
    if (benchMap && benchMap.size) {
      let lastSpy = null;
      const rsRaw = bars.map((b) => {
        const sp = benchMap.get(b.date);
        if (sp != null) lastSpy = sp;
        const use = sp != null ? sp : lastSpy;
        return (use != null && use > 0 && b.close != null) ? b.close / use : null;
      });
      // Mansfield transform: % distance of the RS ratio from its 21d SMA.
      const MW = 21;
      let mSum = 0, mN = 0;
      const osc = rsRaw.map((v, i) => {
        if (v == null) return null;
        mSum += v; mN++;
        if (mN > MW) { const old = rsRaw[i - MW]; if (old != null) { mSum -= old; mN--; } }
        if (mN < MW) return null;
        const ma = mSum / mN;
        return ma > 0 ? (v / ma - 1) * 100 : null;
      });
      const validO = osc.filter((v) => v != null);
      if (validO.length > 2) {
        const amp = Math.max(1, ...validO.map((v) => Math.abs(v))); // symmetric scale keeps zero centered
        const bandBot = pad.t + priceH - 3, bandTop = pad.t + priceH * 0.70;
        const mid = (bandTop + bandBot) / 2, half = (bandBot - bandTop) / 2;
        const rsY = (v) => mid - (v / amp) * half;
        const xC = (i) => pad.l + i * (bw + gap) + bw / 2;
        rsLabelY = bandTop; rsBandTop = bandTop; rsBandBot = bandBot; rsZeroY = mid;
        rsLinePts = osc.map((v, i) => (v == null ? null : `${xC(i).toFixed(1)},${rsY(v).toFixed(1)}`)).filter(Boolean).join(" ");
        for (let i = osc.length - 1; i >= 0; i--) { if (osc[i] != null) { rsEnd = { x: xC(i), y: rsY(osc[i]) }; break; } }
        // Sign fills: area between the osc curve (clamped to one side) and zero.
        let firstO = -1;
        for (let i = 0; i < osc.length; i++) { if (osc[i] != null) { firstO = i; break; } }
        if (firstO >= 0 && rsEnd) {
          const side = (clampFn) => osc.map((v, i) => (v == null ? null : `${xC(i).toFixed(1)},${rsY(clampFn(v)).toFixed(1)}`)).filter(Boolean).join(" L");
          rsPosD = `M${xC(firstO).toFixed(1)},${mid.toFixed(1)} L${side((v) => Math.max(0, v))} L${rsEnd.x.toFixed(1)},${mid.toFixed(1)} Z`;
          rsNegD = `M${xC(firstO).toFixed(1)},${mid.toFixed(1)} L${side((v) => Math.min(0, v))} L${rsEnd.x.toFixed(1)},${mid.toFixed(1)} Z`;
        }
        // Zero-cross turn markers — require ≥3 bars on the prior side so
        // whipsaw flicker around zero doesn't spray arrows.
        let above = 0, below = 0;
        osc.forEach((v, i) => {
          if (v == null) return;
          if (v > 0) {
            if (below >= 3) rsCross.push({ x: xC(i), y: rsY(v), up: true });
            above++; below = 0;
          } else {
            if (above >= 3) rsCross.push({ x: xC(i), y: rsY(v), up: false });
            below++; above = 0;
          }
        });
        // RSNHBP dots (kept from the old line): raw RS at a new visible-window
        // high while price is NOT — relative strength leading price.
        let rsRunMax = -Infinity, pxRunMax = -Infinity;
        rsRaw.forEach((v, i) => {
          const px = bars[i].close;
          const rsNewHigh = v != null && v > rsRunMax + 1e-9 && i >= 10;
          const priceNewHigh = px != null && px > pxRunMax - 1e-9;
          if (rsNewHigh && !priceNewHigh && osc[i] != null) rsDots.push({ x: xC(i), y: rsY(osc[i]), rsnhbp: true });
          if (v != null && v > rsRunMax) rsRunMax = v;
          if (px != null && px > pxRunMax) pxRunMax = px;
        });
        // Slope divergence: over a ~21-bar window compare price % change vs RS
        // % change. Opposite signs (each ≥ 3%) = divergence. Tint the RS band —
        // green = bullish (price down / RS up), amber = bearish (price up / RS down).
        const DW = 21, MINP = 0.03, MINR = 0.03;
        const raw = [];
        let runType = null, runStart = -1;
        for (let i = 0; i < rsRaw.length; i++) {
          let type = null;
          if (i >= DW && rsRaw[i] != null && rsRaw[i - DW] != null && rsRaw[i - DW] > 0) {
            const pSlope = (bars[i].close - bars[i - DW].close) / bars[i - DW].close;
            const rSlope = (rsRaw[i] - rsRaw[i - DW]) / rsRaw[i - DW];
            if (pSlope > MINP && rSlope < -MINR) type = "bear";
            else if (pSlope < -MINP && rSlope > MINR) type = "bull";
          }
          if (type !== runType) {
            if (runType && runStart >= 0) raw.push({ type: runType, from: runStart, to: i - 1 });
            runType = type; runStart = type ? i : -1;
          }
        }
        if (runType && runStart >= 0) raw.push({ type: runType, from: runStart, to: rsRaw.length - 1 });
        // Bridge same-type segments split by brief threshold flicker into one zone.
        const merged = [];
        for (const seg of raw) {
          const last = merged[merged.length - 1];
          if (last && last.type === seg.type && seg.from - last.to <= 5) last.to = seg.to;
          else merged.push({ ...seg });
        }
        divTint = merged.map((m) => ({ x0: xC(m.from) - bw / 2, x1: xC(m.to) + bw / 2, type: m.type }));
      }
    }

    return {
      W, totalH, sepY, barCount: bars.length, totalBars: total, chartRight,
      rsLinePts, rsDots, rsCross, rsLabelY, rsEnd, rsBandTop, rsBandBot, divTint, rsPosD, rsNegD, rsZeroY,
      barsVis: bars, bwPx: bw, gapPx: gap,
      lastDot: bars.length ? { x: pad.l + (bars.length - 1) * (bw + gap) + bw / 2, y: py(bars[bars.length - 1].close), color: bars[bars.length - 1].close >= bars[bars.length - 1].open ? "#2bb886" : "#f87171" } : null,
      candleElements, volElements, erMarkers, yAxisElements, xAxisElements,
      maEma21hi: maPoints(ema21hi), maEma21lo: maPoints(ema21lo),
      maEma21close: maPoints(ema21close), maEma10: maPoints(ema10),
      maSma50: maPoints(sma50), maEma200: maPoints(ema200),
      volMaPts: volMaPoints(),
      startDate: bars[0]?.date, endDate: bars[bars.length - 1]?.date,
      pMin, pMax, pRange, padT: pad.t, padL: pad.l, priceH, violMarker,
      volTop, volH, y60, y40, rsiPathD, lastRsiX, lastRsiY, lastRsi,
      rsiOverboughtPathD, rsiOversoldPathD,
    };
  }, [ohlc, precomputed, quarters, visibleCount, endIdx, containerW, containerH, benchMap, owned, CH_ARIA]);

  // Wheel zoom — LightweightCharts style: right edge stays pinned,
  // ~3 bars per wheel tick (deltaY normalized to ±1 for trackpad smoothness)
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    if (!ohlc || !ohlc.length) return;
    // Normalize: mouse wheel gives ±100–120, trackpad gives small floats
    const ticks = Math.sign(e.deltaY) * Math.max(1, Math.min(5, Math.abs(e.deltaY) / 30));
    const delta = Math.round(ticks * 3);
    setVisibleCount((prev) => Math.max(MIN_VISIBLE, Math.min(MAX_BARS, prev + delta)));
  }, [ohlc]);

  // Drag to pan — LightweightCharts style: drag right = see older data
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const total = ohlc?.length || 0;
    dragRef.current = { startX: e.clientX, startEndIdx: endIdx != null ? endIdx : total, accumulated: 0 };
    const onMove = (ev) => {
      if (!dragRef.current || !svgRef.current || !ohlc) return;
      const rect = svgRef.current.getBoundingClientRect();
      const pxPerBar = rect.width / visibleCount;
      const dx = ev.clientX - dragRef.current.startX;
      const barShift = Math.round(dx / pxPerBar);
      const t = ohlc.length;
      const newEnd = Math.max(visibleCount, Math.min(t, dragRef.current.startEndIdx - barShift));
      setEndIdx(newEnd);
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [endIdx, visibleCount, ohlc]);

  // Double-click to reset view
  const handleDblClick = useCallback(() => {
    setVisibleCount(DEFAULT_BARS);
    setEndIdx(null);
  }, []);

  if (!chartData) {
    return (
      <div ref={containerRef} style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center", justifyContent: "center", height: height || 400, color: CH_ARIA.textMuted, fontSize: 11, fontFamily: "monospace", width: "100%" }}>
        <svg width="120" height="36" viewBox="0 0 120 36" style={{ opacity: 0.35 }}>
          <polyline points="2,28 18,22 32,26 46,14 60,18 74,8 90,13 104,5 118,9" fill="none" stroke={CH_ARIA.textMuted} strokeWidth="1.6" strokeLinecap="round" strokeDasharray="3,3" />
        </svg>
        No chart data
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", padding: "0 4px" }}>
      <svg ref={svgRef} width={chartData.W} height={chartData.totalH}
        style={{ display: "block", cursor: dragRef.current ? "grabbing" : "grab" }}
        onWheel={handleWheel} onMouseDown={handleMouseDown} onDoubleClick={handleDblClick}
        onMouseMove={(e) => {
          if (dragRef.current) return;
          const rect = svgRef.current?.getBoundingClientRect();
          if (!rect) return;
          const mx = e.clientX - rect.left;
          const i = Math.floor((mx - chartData.padL) / (chartData.bwPx + chartData.gapPx));
          setHoverI(i >= 0 && i < chartData.barCount ? i : null);
        }}
        onMouseLeave={() => setHoverI(null)}>
        <defs>
          <filter id="tpGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="1.6" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <linearGradient id="rsiObGrad" x1="0" y1={chartData.volTop} x2="0" y2={chartData.y60} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#4ade80" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#4ade80" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="rsiOsGrad" x1="0" y1={chartData.y40} x2="0" y2={chartData.volTop + chartData.volH} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#f87171" stopOpacity="0" />
            <stop offset="100%" stopColor="#f87171" stopOpacity="0.45" />
          </linearGradient>
        </defs>
        {chartData.xAxisElements}
        {chartData.yAxisElements}
        <line x1={0} y1={chartData.sepY} x2={chartData.chartRight} y2={chartData.sepY} stroke={CH_ARIA.borderLight} strokeWidth={0.5} />
        <line x1={chartData.chartRight} y1={0} x2={chartData.chartRight} y2={chartData.totalH} stroke={CH_ARIA.borderLight} strokeWidth={0.5} />
        {chartData.maEma21hi && <polyline points={chartData.maEma21hi} fill="none" stroke="#80808060" strokeWidth={1} />}
        {chartData.maEma21lo && <polyline points={chartData.maEma21lo} fill="none" stroke="#80808060" strokeWidth={1} />}
        {chartData.maEma21close && <polyline points={chartData.maEma21close} fill="none" stroke="#808080" strokeWidth={1.5} />}
        {chartData.maEma10 && <polyline points={chartData.maEma10} fill="none" stroke="#ff828c" strokeWidth={1} />}
        {chartData.maSma50 && <polyline points={chartData.maSma50} fill="none" stroke="#2dd4bf" strokeWidth={1} strokeDasharray="4,2" />}
        {chartData.maEma200 && <polyline points={chartData.maEma200} fill="none" stroke="#8232c8" strokeWidth={1} />}
        {chartData.candleElements}
        {chartData.lastDot && (
          <circle cx={chartData.lastDot.x} cy={chartData.lastDot.y} r={2.6} fill={chartData.lastDot.color} filter="url(#tpGlow)">
            <animate attributeName="opacity" values="1;0.35;1" dur="2.2s" repeatCount="indefinite" />
          </circle>
        )}
        {hoverI != null && chartData.barsVis[hoverI] && (() => {
          const b = chartData.barsVis[hoverI];
          const cx = chartData.padL + hoverI * (chartData.bwPx + chartData.gapPx) + chartData.bwPx / 2;
          const pyv = (v) => chartData.padT + (1 - (v - chartData.pMin) / chartData.pRange) * chartData.priceH;
          const cy = pyv(b.close);
          const prev = hoverI > 0 ? chartData.barsVis[hoverI - 1] : null;
          const chg = prev && prev.close ? ((b.close / prev.close - 1) * 100) : null;
          const up = chg == null ? b.close >= b.open : chg >= 0;
          const fmtP = (v) => v >= 1000 ? v.toFixed(0) : v >= 100 ? v.toFixed(1) : v.toFixed(2);
          const fmtV = (v) => v >= 1e9 ? (v / 1e9).toFixed(1) + "B" : v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? (v / 1e3).toFixed(0) + "K" : String(v || 0);
          const txt = `${b.date}   O ${fmtP(b.open)}  H ${fmtP(b.high)}  L ${fmtP(b.low)}  C ${fmtP(b.close)}${chg != null ? `  ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%` : ""}  V ${fmtV(b.volume)}`;
          const tw = txt.length * 5.1 + 12;
          const left = cx <= chartData.chartRight / 2;
          const bx = left ? Math.min(cx + 10, chartData.chartRight - tw - 4) : Math.max(4, cx - 10 - tw);
          return (
            <g pointerEvents="none">
              <line x1={cx} y1={chartData.padT} x2={cx} y2={chartData.volTop + chartData.volH} stroke={CH_ARIA.textDim} strokeWidth={0.7} strokeDasharray="3,3" opacity={0.55} />
              <line x1={chartData.padL} y1={cy} x2={chartData.chartRight} y2={cy} stroke={CH_ARIA.textDim} strokeWidth={0.6} strokeDasharray="3,3" opacity={0.4} />
              <circle cx={cx} cy={cy} r={2.6} fill={up ? "#2bb886" : "#f87171"} stroke={CH_ARIA.bg} strokeWidth={0.8} />
              <rect x={bx} y={chartData.padT + 2} width={tw} height={15} rx={3} fill={CH_ARIA.bg} opacity={0.94} stroke={CH_ARIA.borderLight} strokeWidth={0.6} />
              <text x={bx + 6} y={chartData.padT + 12.5} fontSize={8} fill={CH_ARIA.text} fontFamily="ui-monospace,monospace">
                {b.date}   O {fmtP(b.open)}  H {fmtP(b.high)}  L {fmtP(b.low)}  C <tspan fill={up ? "#2bb886" : "#f87171"} fontWeight="700">{fmtP(b.close)}</tspan>{chg != null ? <tspan fill={up ? "#2bb886" : "#f87171"}>{`  ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`}</tspan> : null}  V {fmtV(b.volume)}
              </text>
            </g>
          );
        })()}
        {chartData.violMarker && (
          <text x={chartData.violMarker.x} y={chartData.violMarker.y} textAnchor="middle" fontSize={11} style={{ cursor: "default" }}>
            <title>{`Sell-discipline violation — closed below the ${chartData.violMarker.label} (leader cracking support). Ryan's trailing-stop trigger.`}</title>🔻
          </text>
        )}
        {showRS && chartData.rsLinePts && (
          <>
            {(chartData.divTint || []).map((d, i) => (
              <rect key={`div${i}`} x={d.x0} y={chartData.rsBandTop} width={Math.max(1, d.x1 - d.x0)} height={(chartData.rsBandBot || 0) - (chartData.rsBandTop || 0)} fill={d.type === "bull" ? "#22c55e" : "#f59e0b"} opacity={0.28}>
                <title>{d.type === "bull" ? "Bullish RS divergence — price down/flat while RS rising (relative strength accumulating)" : "Bearish RS divergence — price rising while RS falling (relative strength deteriorating)"}</title>
              </rect>
            ))}
            {chartData.rsPosD && <path d={chartData.rsPosD} fill="#22c55e" opacity={0.22} />}
            {chartData.rsNegD && <path d={chartData.rsNegD} fill="#ef4444" opacity={0.22} />}
            {chartData.rsZeroY != null && <line x1={chartData.padL} y1={chartData.rsZeroY} x2={chartData.chartRight} y2={chartData.rsZeroY} stroke="#3b82f6" strokeWidth={0.6} strokeDasharray="3 3" opacity={0.5} />}
            <polyline points={chartData.rsLinePts} fill="none" stroke="#3b82f6" strokeWidth={1.2} opacity={0.9} filter="url(#tpGlow)" />
            {(chartData.rsCross || []).map((d, i) => (
              <polygon key={`rsx${i}`}
                points={d.up ? `${d.x - 4},${d.y + 9} ${d.x + 4},${d.y + 9} ${d.x},${d.y + 2}` : `${d.x - 4},${d.y - 9} ${d.x + 4},${d.y - 9} ${d.x},${d.y - 2}`}
                fill={d.up ? "#22c55e" : "#f59e0b"} stroke="#0a0a14" strokeWidth={0.8}>
                <title>{d.up ? "RS turn UP — crossed above its 21d trend: entering outperformance" : "RS turn DOWN — crossed below its 21d trend: losing leadership"}</title>
              </polygon>
            ))}
            {chartData.rsDots.map((d, i) => (
              <circle key={`rsd${i}`} cx={d.x} cy={d.y} r={3.4} fill="#ec4899" stroke="#0a0a14" strokeWidth={0.7}>
                <title>RS New High Before Price (RSNHBP) — relative strength leading price, bullish</title>
              </circle>
            ))}
            {chartData.rsLabelY != null && <text x={chartData.padL + 3} y={chartData.rsLabelY - 2} fontSize={7.5} fill="#3b82f6" fontFamily="ui-monospace,monospace" fontWeight={700} opacity={0.85}>RS TREND (÷21d)<title>Mansfield RS: (stock÷SPY) relative to its own 21-day average. Green fill = in an outperformance trend, red = underperforming. ▲/▼ mark the zero-cross turns; pink dots = RS new high before price.</title></text>}
            {rsRating != null && chartData.rsEnd && (() => {
              const w = rsRating >= 100 ? 21 : 16, bx = chartData.rsEnd.x + 3, by = chartData.rsEnd.y - 6;
              return (
                <g>
                  <rect x={bx} y={by} width={w} height={12} rx={2} fill="#0a0a14" stroke={rsRatingColor || "#3b82f6"} strokeWidth={0.8} opacity={0.96}>
                    <title>RS rating (0-100) — relative strength vs the market, same value as the perf bar</title>
                  </rect>
                  <text x={bx + w / 2} y={by + 9} textAnchor="middle" fontSize={8} fontWeight={800} fill={rsRatingColor || "#3b82f6"} fontFamily="ui-monospace,monospace">{rsRating}</text>
                </g>
              );
            })()}
          </>
        )}
        <text x={chartData.padL + 3} y={10} fontSize={8} fontFamily="ui-monospace,monospace" fontWeight={700}
          fill={showRS ? "#3b82f6" : "#4a4a5a"} style={{ cursor: "pointer" }}
          onClick={() => setShowRS((v) => { const n = !v; try { localStorage.setItem("tp-chart-rs", n ? "1" : "0"); } catch {} return n; })}>
          <title>Toggle the IBD-style RS line (stock ÷ SPY)</title>RS
        </text>
        {volSubTab === "vol" && chartData.volElements}
        {volSubTab === "vol" && chartData.volMaPts && <polyline points={chartData.volMaPts} fill="none" stroke="#fbbf24" strokeWidth={1} opacity={0.5} />}
        {volSubTab === "rsi" && (() => {
          const { volTop, volH, chartRight, padL, rsiPathD, lastRsiX, lastRsiY, lastRsi } = chartData;
          const yRef = (v) => volTop + (1 - v / 100) * volH;
          const rsiColor = lastRsi >= 60 ? "#f87171" : lastRsi <= 40 ? "#4ade80" : "#60a5fa";
          return (
            <>
              {chartData.rsiOverboughtPathD && <path d={chartData.rsiOverboughtPathD} fill="url(#rsiObGrad)" />}
              {chartData.rsiOversoldPathD && <path d={chartData.rsiOversoldPathD} fill="url(#rsiOsGrad)" />}
              <line x1={padL} y1={yRef(60)} x2={chartRight} y2={yRef(60)} stroke="#f87171" strokeWidth={0.5} strokeDasharray="3,2" opacity={0.35} />
              <line x1={padL} y1={yRef(50)} x2={chartRight} y2={yRef(50)} stroke="#3a3a4a" strokeWidth={0.5} strokeDasharray="2,3" />
              <line x1={padL} y1={yRef(40)} x2={chartRight} y2={yRef(40)} stroke="#4ade80" strokeWidth={0.5} strokeDasharray="3,2" opacity={0.35} />
              {rsiPathD && <path d={rsiPathD} fill="none" stroke={rsiColor} strokeWidth={1.5} />}
              {lastRsiX != null && <circle cx={lastRsiX} cy={lastRsiY} r={2} fill={rsiColor} />}
              <text x={chartRight + 4} y={yRef(60) + 3} fontSize={7} fill="#f87171" fontFamily="ui-monospace,monospace" opacity={0.7}>60</text>
              <text x={chartRight + 4} y={yRef(50) + 3} fontSize={7} fill="#6a6a7a" fontFamily="ui-monospace,monospace">50</text>
              <text x={chartRight + 4} y={yRef(40) + 3} fontSize={7} fill="#4ade80" fontFamily="ui-monospace,monospace" opacity={0.7}>40</text>
              {lastRsi != null && <text x={chartRight + 4} y={lastRsiY + 3} fontSize={7} fontWeight={700} fill={rsiColor} fontFamily="ui-monospace,monospace">{lastRsi.toFixed(0)}</text>}
            </>
          );
        })()}
        {/* Vol / RSI tab toggles at top of indicator pane */}
        <text x={4} y={chartData.sepY + 11} fontSize={8} fontFamily="ui-monospace,monospace" fontWeight={700}
          fill={volSubTab === "vol" ? "#0d9163" : "#4a4a5a"}
          style={{ cursor: "pointer", userSelect: "none" }}
          onMouseDown={(e) => { e.stopPropagation(); setVolSubTab("vol"); }}>Vol</text>
        <text x={26} y={chartData.sepY + 11} fontSize={8} fontFamily="ui-monospace,monospace" fontWeight={700}
          fill={volSubTab === "rsi" ? "#60a5fa" : "#4a4a5a"}
          style={{ cursor: "pointer", userSelect: "none" }}
          onMouseDown={(e) => { e.stopPropagation(); setVolSubTab("rsi"); }}>RSI</text>
        {chartData.erMarkers}
        {stopLines.map((sl, i) => {
          if (!sl?.price || sl.price <= 0) return null;
          const pMin = chartData.pMin, pMax = chartData.pMax, pRange = chartData.pRange;
          const padT = chartData.padT, priceH = chartData.priceH;
          if (sl.price < pMin || sl.price > pMax) return null;
          const y = padT + (1 - (sl.price - pMin) / pRange) * priceH;
          return (
            <g key={i}>
              <line x1={chartData.padL} y1={y} x2={chartData.chartRight} y2={y}
                stroke={sl.color} strokeWidth={1.5}
                strokeDasharray={sl.dashed ? "5,3" : undefined} opacity={0.85} />
              <text x={chartData.chartRight + 4} y={y + 3} fontSize={7.5} fill={sl.color}
                fontFamily="ui-monospace,monospace" fontWeight={700}>
                {sl.label} {sl.price.toFixed(2)}
              </text>
            </g>
          );
        })}
      </svg>
      {/* Legend + zoom info */}
      <div style={{ display: "flex", gap: 10, padding: "4px 8px", fontSize: 8, fontFamily: "monospace", color: "#7a7a8a", flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
          <span style={{ color: "#ff828c" }}>EMA10</span>
          <span style={{ color: "#808080" }}>EMA21</span>
          <span style={{ color: "#2dd4bf" }}>SMA50</span>
          <span style={{ color: "#8232c8" }}>EMA200</span>
          <span style={{ color: "#fbbf24" }}>Vol MA</span>
        </span>
        {chartData.barCount < chartData.totalBars && (
          <span style={{ color: "#5a5a6a" }} title="Double-click to reset view">
            {chartData.startDate} → {chartData.endDate} · {chartData.barCount}d
          </span>
        )}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, background: "#2563eb", borderRadius: 1, display: "inline-block" }} />PP 10d</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, background: "#0d9488", borderRadius: 1, display: "inline-block" }} />PP 5d</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, background: `repeating-linear-gradient(135deg,transparent,transparent 2px,${CH_ARIA.yellow} 2px,${CH_ARIA.yellow} 3px)`, border: `1px solid ${CH_ARIA.yellow}80`, borderRadius: 1, display: "inline-block" }} />+4% BO</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, background: "repeating-linear-gradient(45deg,transparent,transparent 2px,#f87171 2px,#f87171 3px)", border: "1px solid #f8717180", borderRadius: 1, display: "inline-block" }} />-4% BD</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, background: CH_ARIA.glass, color: CH_ARIA.yellow, fontSize: 7, fontWeight: 900, textAlign: "center", lineHeight: "8px", fontFamily: "monospace", border: `1px solid ${CH_ARIA.borderLight}`, borderRadius: 1, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>T</span>Tight</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, background: `radial-gradient(circle,${CH_ARIA.bg === "#f8f9fc" ? "#0f766e" : "#2dd4bf"} 3px,transparent 3px)`, borderRadius: 1, display: "inline-block" }} />Dry-Up</span>
        </span>
      </div>
      {showRS && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 9, padding: "0 8px 5px", fontSize: 8, fontFamily: "monospace", color: "#7a7a8a", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ color: "#3b82f6", fontWeight: 700 }}>RS:</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 12, height: 2, background: "#3b82f6", display: "inline-block" }} />vs SPY</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 7, height: 7, background: "#3b82f6", borderRadius: "50%", display: "inline-block" }} />new hi</span>
          <span title="RS new high before price" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 7, height: 7, background: "#ec4899", borderRadius: "50%", display: "inline-block" }} />RSNHBP</span>
          <span title="RS lower high — rolling over" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ color: "#f97316", fontSize: 10, lineHeight: "8px" }}>▾</span>roll-over</span>
          <span title="Bullish divergence — price down/flat, RS up" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 9, height: 8, background: "#22c55e", opacity: 0.55, borderRadius: 1, display: "inline-block" }} />bull div</span>
          <span title="Bearish divergence — price up, RS down" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 9, height: 8, background: "#f59e0b", opacity: 0.55, borderRadius: 1, display: "inline-block" }} />bear div</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ padding: "0 3px", border: "1px solid #3b82f6", borderRadius: 2, color: "#3b82f6", fontSize: 7, fontWeight: 800, lineHeight: "9px" }}>90</span>rating</span>
        </div>
      )}
    </div>
  );
}



const _tickerNewsCache = new Map();
const _tickerOhlcCache = new Map();
const _tickerEarningsCache = new Map();
const TICKER_CACHE_TTL_MS = 5 * 60 * 1000;
const TICKER_DEBOUNCE_MS = 120;
function _ttlGet(map, key) {
  const hit = map.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > TICKER_CACHE_TTL_MS) { map.delete(key); return null; }
  return hit.data;
}
function _ttlSet(map, key, data) {
  if (map.size > 150) map.delete(map.keys().next().value);
  map.set(key, { ts: Date.now(), data });
}

function ChartPanelInline({
  ticker,
  onTickerChange,
  height = 580,
  stockMap,
}) {
  const ARIA = useAriaTheme();
  // layer membership chips (chain_layers.json — same file the RS Rotation Layers tab uses)
  const chainLayers = useChainLayers();
  const tickerLayers = useMemo(
    () => (chainLayers || []).filter((e) => Array.isArray(e.tickers) && e.tickers.includes(ticker)),
    [chainLayers, ticker]
  );
  const [tf, setTf] = useState(() => localStorage.getItem("themepulse-chart-tf") || "D");
  const [tickerInput, setTickerInput] = useState("");
  const tickerInputRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;
      if (!tickerInputRef.current) return;
      e.preventDefault();
      tickerInputRef.current.focus();
      tickerInputRef.current.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // EPS + Revenue bars below the CANSLIM stats row.
  //   quarters: quarterly bars (Finviz FactSet → FMP fallback)
  //   annuals:  annual bars (FMP only)
  const [quarters, setQuarters] = useState([]);
  const [annuals, setAnnuals] = useState([]);
  const [news, setNews] = useState([]);
  const [newsOpen, setNewsOpen] = useState(true);
  const [description, setDescription] = useState("");
  const [liveEarningsDate, setLiveEarningsDate] = useState(null);
  const [ohlcBars, setOhlcBars] = useState([]);
  const [showTrade, setShowTrade] = useState(false);
  const [tradeSettings, setTradeSettings] = useState(() => {
    try { return JSON.parse(localStorage.getItem("themepulse-risk-settings") || "null") ||
      { accountSize: 300000, riskPct: 1.0, maxAllocPct: 25.0, atrLen: 14 }; }
    catch { return { accountSize: 300000, riskPct: 1.0, maxAllocPct: 25.0, atrLen: 14 }; }
  });
  useEffect(() => {
    try { localStorage.setItem("themepulse-risk-settings", JSON.stringify(tradeSettings)); } catch {}
  }, [tradeSettings]);
  useEffect(() => {
    if (!ticker) return;
    const orient = (arr) => {
      if (!Array.isArray(arr) || arr.length <= 1) return arr || [];
      return arr[0].year > arr[arr.length - 1].year ? arr.slice().reverse() : arr;
    };
    const apply = (d) => {
      setQuarters(orient(d?.finvizQuarters));
      setAnnuals(orient(d?.finvizAnnual));
      setNews(d?.news || []);
      setDescription(d?.description || "");
      setLiveEarningsDate(d?.earningsDate || null);
    };
    const cached = _ttlGet(_tickerNewsCache, ticker);
    if (cached) { apply(cached); return; }
    setLiveEarningsDate(null);
    const ac = new AbortController();
    const tid = setTimeout(() => {
      authFetch(`/api/live?news=${encodeURIComponent(ticker)}`, { signal: ac.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (ac.signal.aborted) return;
          if (d) _ttlSet(_tickerNewsCache, ticker, d);
          apply(d);
        })
        .catch(() => {
          if (!ac.signal.aborted) {
            setQuarters([]);
            setAnnuals([]);
            setNews([]);
            setDescription("");
          }
        });
    }, TICKER_DEBOUNCE_MS);
    return () => { clearTimeout(tid); ac.abort(); };
  }, [ticker]);

  // Fetch OHLC bars for inline SVG daily chart
  useEffect(() => {
    if (!ticker) return;
    const interval = tf === "W" ? "1wk" : "1d";
    const key = `${ticker}:${interval}`;
    const cached = _ttlGet(_tickerOhlcCache, key);
    if (cached) { setOhlcBars(cached); return; }
    const ac = new AbortController();
    const tid = setTimeout(() => {
      authFetch(`/api/ohlc?ticker=${encodeURIComponent(ticker)}&interval=${interval}`, { signal: ac.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (ac.signal.aborted || !d?.ohlc) return;
          _ttlSet(_tickerOhlcCache, key, d.ohlc);
          setOhlcBars(d.ohlc);
        })
        .catch(() => {});
    }, TICKER_DEBOUNCE_MS);
    return () => { clearTimeout(tid); ac.abort(); };
  }, [ticker, tf]);
  // Right pane subtab: 'chart' (intraday OHLC) or 'picks' (agent picks list)

  // Draggable split between daily (left) and intraday (right) panes.
  // Stored as a 0..1 fraction of the chart body width assigned to the LEFT.
  // Default 0.55 ≈ Aria's flex 6/(6+5).


  // Live quote for the active ticker — drives the OHLC + RVol header line
  const tickerList = useMemo(() => (ticker ? [ticker] : []), [ticker]);
  const { quotes } = useLiveQuotes(tickerList, 30000);
  const liveQuote = quotes.get(ticker);
  const stockInfo = useMemo(() => stockMap?.[ticker] || {}, [stockMap, ticker]);
  const avgVol = stockInfo.avg_volume_raw || 0;

  // Aria-faithful OHLC line: O H L C +chg ($abs+%) Vol RV + badges
  const o = liveQuote?.open ?? 0;
  const l = liveQuote?.low ?? 0;
  const c = liveQuote?.price ?? 0;
  const chgPct = liveQuote?.change ?? null;
  const liveVol = liveQuote?.volume || 0;
  const rvol = liveVol && avgVol > 0 ? Math.round((liveVol / avgVol) * 100) / 100 : null;
  const rvolProfiles = useRvolProfiles();
  const zvr = zvrFor(stockInfo.ticker ? stockInfo : { ...stockInfo, ticker }, liveQuote, rvolProfiles);
  const fromOpenPct = o > 0 && c > 0 ? (c / o - 1) * 100 : null;

  // 9M badge: today's volume >= 8.9M but avg < 8.9M (unusual institutional)
  const todayVol = avgVol * (rvol || 0);
  const has9M = todayVol >= 8_900_000 && avgVol < 8_900_000;
  const fromHi = stockInfo.off_52w_high;
  const grade = stockInfo.grade || "";
  const gradeColor =
    grade && grade[0] === "A" ? ARIA.green : grade && grade[0] === "B" ? ARIA.blue : ARIA.textMuted;

  const adr = stockInfo.adr_pct ?? null;
  // Prefer live FMP earnings date over pipeline's stale earnings_days
  const { erDaysRaw, erTimingRaw } = useMemo(() => {
    if (liveEarningsDate?.date) {
      const todayUTC = new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()));
      const erDate = new Date(`${liveEarningsDate.date}T00:00:00Z`);
      const diffDays = Math.round((erDate - todayUTC) / 86400000);
      const timing = (liveEarningsDate.time || stockInfo.er_timing || "").toUpperCase();
      return { erDaysRaw: diffDays, erTimingRaw: timing };
    }
    return { erDaysRaw: stockInfo.earnings_days ?? null, erTimingRaw: stockInfo.er_timing || "" };
  }, [liveEarningsDate, stockInfo.earnings_days, stockInfo.er_timing]);
  const erCountdown = erDaysRaw != null
    ? (erDaysRaw === 0 ? "TODAY" : erDaysRaw > 0 ? `${erDaysRaw}d` : `${-erDaysRaw}d ago`)
    : "";
  // Next earnings DATE (formatted) + countdown for the thin header bar.
  const nextErDisp = useMemo(() => {
    const raw = liveEarningsDate?.date || stockInfo.earnings_display || null;
    if (!raw) return erCountdown || "";
    const d = new Date(`${raw}T00:00:00Z`);
    const dateStr = isNaN(d.getTime()) ? String(raw) : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    return erCountdown ? `${dateStr} (${erCountdown})` : dateStr;
  }, [liveEarningsDate, stockInfo.earnings_display, erCountdown]);

  // Layer-regime RS score (holds `s` from rs_rotation.json) — the exact value
  // the LAYER REGIME box shows, distinct from rs_rank. Map ticker -> max s.
  const rsRotation = useRsRotation();
  const rsScoreMap = useMemo(() => {
    const m = new Map();
    (rsRotation?.layers || []).forEach((l) => (l.holds || []).forEach((h) => {
      if (h?.t == null || h.s == null) return;
      if (!m.has(h.t) || h.s > m.get(h.t)) m.set(h.t, h.s);
    }));
    return m;
  }, [rsRotation]);
  // RS rating for the chart's end-of-line label — same value + coloring as the perf bar.
  const rsRating = rsScoreMap.get(ticker) ?? stockInfo?.rs_rank ?? null;
  const rsRatingColor = rsRating == null ? ARIA.textMuted : rsRating >= 90 ? ARIA.green : rsRating >= 70 ? ARIA.blue : rsRating >= 50 ? ARIA.yellow : ARIA.textDim;

  // CANSLIM composite + within-sector EPS/Rev growth percentiles for the perf bar.
  const canslimGrade = useMemo(() => canslimComposite(stockInfo, annuals, stockMap), [stockInfo, annuals, stockMap]);
  const globalPct = useCallback((field) => {
    const mine = stockInfo[field];
    if (mine == null || !stockMap) return null;
    const peers = Object.values(stockMap).filter((s) => s && s[field] != null);
    if (peers.length < 10) return null;
    const better = peers.filter((s) => s[field] > mine).length;
    return Math.round((1 - better / peers.length) * 100);
  }, [stockInfo, stockMap]);
  const epsPct = useMemo(() => globalPct("eps_yoy"), [globalPct]);
  const revPct = useMemo(() => globalPct("sales_yoy"), [globalPct]);

  // Risk Management — ATR + 5 stop scenarios (mirrors ThinkScript indicator)
  const dailyATR = useMemo(() => calcWilderATR(ohlcBars, tradeSettings.atrLen), [ohlcBars, tradeSettings.atrLen]);
  const riskEntry = c > 0 ? c : (ohlcBars[ohlcBars.length - 1]?.close ?? null);
  const riskDayLow = l > 0 ? l : (ohlcBars[ohlcBars.length - 1]?.low ?? null);
  const riskPDL = ohlcBars[ohlcBars.length - 1]?.low ?? null;
  const riskScenarios = useMemo(() => {
    if (!riskEntry || !dailyATR) return null;
    const { accountSize, riskPct, maxAllocPct } = tradeSettings;
    return {
      tight: calcRiskSize(riskEntry - dailyATR * 0.5, riskEntry, accountSize, riskPct, maxAllocPct),
      base:  calcRiskSize(riskEntry - dailyATR * 1.0, riskEntry, accountSize, riskPct, maxAllocPct),
      wide:  calcRiskSize(riskEntry - dailyATR * 2.0, riskEntry, accountSize, riskPct, maxAllocPct),
      lod:   riskDayLow ? calcRiskSize(riskDayLow, riskEntry, accountSize, riskPct, maxAllocPct) : null,
      pdl:   riskPDL    ? calcRiskSize(riskPDL,    riskEntry, accountSize, riskPct, maxAllocPct) : null,
    };
  }, [riskEntry, dailyATR, riskDayLow, riskPDL, tradeSettings]);

  // Prior earnings responses — lazy-loaded from /api/earnings when opened
  const [erHistOpen, setErHistOpen] = useState(() => { try { return localStorage.getItem("tp-erhist-open") === "1"; } catch { return false; } });
  const [erHist, setErHist] = useState(null);
  useEffect(() => {
    if (!ticker) return;
    const cached = _ttlGet(_tickerEarningsCache, ticker);
    if (cached) { setErHist(cached); return; }
    const ac = new AbortController();
    const tid = setTimeout(() => {
      authFetch(`/api/earnings?ticker=${encodeURIComponent(ticker)}`, { signal: ac.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (ac.signal.aborted || !d || !Array.isArray(d.history)) return;
          const entry = { ticker, history: d.history, next: d.next };
          _ttlSet(_tickerEarningsCache, ticker, entry);
          setErHist(entry);
        })
        .catch(() => {});
    }, TICKER_DEBOUNCE_MS);
    return () => { clearTimeout(tid); ac.abort(); };
  }, [ticker]);

  // Portfolio/Watchlist via shared cross-component hook (Aria's +WL / +PF)
  const [portfolio, setPortfolio] = useLocalStorageList("themepulse-portfolio");
  const [watchlist, setWatchlist] = useLocalStorageList("themepulse-watchlist");
  const [focus, setFocus] = useLocalStorageList("themepulse-focus");
  const inPF = portfolio.includes(ticker);
  const inWL = watchlist.includes(ticker);
  const inFC = focus.includes(ticker);
  const toggleWL = useCallback(() => {
    setWatchlist((prev) =>
      prev.includes(ticker) ? prev.filter((x) => x !== ticker) : [...prev, ticker]
    );
  }, [ticker, setWatchlist]);
  const togglePF = useCallback(() => {
    setPortfolio((prev) =>
      prev.includes(ticker) ? prev.filter((x) => x !== ticker) : [...prev, ticker]
    );
  }, [ticker, setPortfolio]);
  const toggleFC = useCallback(() => {
    setFocus((prev) =>
      prev.includes(ticker) ? prev.filter((x) => x !== ticker) : [...prev, ticker]
    );
  }, [ticker, setFocus]);

  const submitTicker = () => {
    const t = tickerInput.trim().toUpperCase();
    if (t) {
      onTickerChange(t);
      setTickerInput("");
    }
  };

  const agoLabel = (dateStr) => {
    if (!dateStr) return "";
    let d = new Date(dateStr);
    if (isNaN(d.getTime())) {
      // Finviz formats: "May-01-26", "Apr-30-26 08:30AM", "Today", "08:30AM"
      const m = dateStr.match(/^([A-Z][a-z]{2})-(\d{2})-(\d{2})/);
      if (m) {
        const yr = parseInt(m[3]) + 2000;
        d = new Date(`${m[1]} ${m[2]}, ${yr}`);
      } else if (/today/i.test(dateStr) || /^\d{1,2}:\d{2}/.test(dateStr)) {
        return "today";
      } else {
        return "";
      }
    }
    if (isNaN(d.getTime())) return "";
    const ms = Date.now() - d.getTime();
    const h = Math.floor(ms / 3600000);
    if (h < 1) return `${Math.max(1, Math.floor(ms / 60000))}m`;
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  };


  return (
    <div
      style={{
        background: ARIA.bgCard,
        border: `1px solid ${ARIA.border}`,
        borderRadius: 14,
        marginBottom: 8,
        overflow: "hidden",
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        boxShadow: ARIA.shadow,
      }}
    >
      {/* Thin header bar — ticker · layer · Chg · Intraday · ADR · Next ER (left), ticker input (right) */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 12px", borderBottom: `1px solid ${ARIA.border}`, flexShrink: 0, fontFamily: "monospace", overflowX: "auto", whiteSpace: "nowrap" }}>
        <img key={ticker} src={`https://images.financialmodelingprep.com/symbol/${ticker}.png`} alt="" onError={(e) => { e.target.style.display = "none"; }}
          style={{ width: 20, height: 20, borderRadius: 4, background: "#ffffff", objectFit: "contain", padding: 1.5, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 800, color: ARIA.text, flexShrink: 0 }}>{ticker}</span>
        {tickerLayers.length > 0 ? (
          <span onClick={() => { try { window.dispatchEvent(new CustomEvent("tp-open-layer", { detail: { themeId: tickerLayers[0].themeId, layer: tickerLayers[0].layer } })); } catch {} }}
            title={`${tickerLayers[0].theme} — click to view layer members${tickerLayers.length > 1 ? ` (+${tickerLayers.length - 1} more layer${tickerLayers.length - 1 > 1 ? "s" : ""})` : ""}`}
            style={{ fontSize: 8, fontWeight: 700, padding: "1px 7px", borderRadius: 4, background: "rgba(251,191,36,0.12)", border: "1px solid #a07a1f", color: "#fbbf24", textTransform: "uppercase", letterSpacing: 0.4, cursor: "pointer", flexShrink: 0 }}>
            {tickerLayers[0].theme} • {tickerLayers[0].layer}{tickerLayers.length > 1 ? ` +${tickerLayers.length - 1}` : ""}
          </span>
        ) : stockInfo.sector ? (
          <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 7px", borderRadius: 4, background: "rgba(108,213,232,0.12)", border: "1px solid #3a8a9e", color: "#6cd5e8", textTransform: "uppercase", letterSpacing: 0.4, flexShrink: 0 }}>{stockInfo.sector}</span>
        ) : null}
        <span style={{ fontSize: 9, display: "inline-flex", alignItems: "baseline", gap: 3, flexShrink: 0 }}>
          <span style={{ color: ARIA.textMuted }}>Chg</span>
          <span style={{ color: chgPct != null && Math.abs(chgPct) > 2 ? (chgPct > 0 ? ARIA.green : ARIA.red) : ARIA.textDim, fontWeight: chgPct != null && Math.abs(chgPct) > 2 ? 700 : 400 }}>{chgPct != null ? `${chgPct >= 0 ? "+" : ""}${chgPct.toFixed(2)}%` : "\u2014"}</span>
        </span>
        <span style={{ fontSize: 9, display: "inline-flex", alignItems: "baseline", gap: 3, flexShrink: 0 }}>
          <span style={{ color: ARIA.textMuted }}>Intra</span>
          <span style={{ color: (o > 0 && c > 0 && Math.abs((c - o) / o * 100) > 2) ? (c >= o ? ARIA.green : ARIA.red) : ARIA.textDim, fontWeight: (o > 0 && c > 0 && Math.abs((c - o) / o * 100) > 2) ? 700 : 400 }}>{o > 0 && c > 0 ? `${c >= o ? "+" : ""}${((c - o) / o * 100).toFixed(2)}%` : "\u2014"}</span>
        </span>
        <span style={{ fontSize: 9, display: "inline-flex", alignItems: "baseline", gap: 3, flexShrink: 0 }}>
          <span style={{ color: ARIA.textMuted }}>ADR</span>
          <span style={{ color: adr != null && adr >= 4 ? ARIA.cyan : ARIA.textDim, fontWeight: adr != null && adr >= 4 ? 700 : 400 }}>{adr != null ? `${adr.toFixed(1)}%` : "\u2014"}</span>
        </span>
        {(nextErDisp) && (
          <span style={{ fontSize: 9, display: "inline-flex", alignItems: "baseline", gap: 3, flexShrink: 0 }} title="Next earnings date">
            <span style={{ color: ARIA.textMuted }}>ER</span>
            <span style={{ color: (erDaysRaw != null && erDaysRaw >= 0 && erDaysRaw <= 21) ? ARIA.red : ARIA.textDim, fontWeight: (erDaysRaw != null && erDaysRaw >= 0 && erDaysRaw <= 21) ? 700 : 400 }}>{nextErDisp}{erTimingRaw ? ` ${erTimingRaw}` : ""}</span>
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {["D", "W"].map(tfOpt => (
            <button key={tfOpt} onClick={() => { setTf(tfOpt); try { localStorage.setItem("themepulse-chart-tf", tfOpt); } catch {} }}
              style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, cursor: "pointer", background: tf === tfOpt ? "#0d9163" : "transparent", border: "1px solid #0d9163", color: tf === tfOpt ? "#fff" : "#0d9163", fontFamily: "monospace", fontWeight: 700, minWidth: 18 }}>
              {tfOpt}
            </button>
          ))}
          <button onClick={() => setShowTrade(prev => !prev)}
            style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, cursor: "pointer", background: showTrade ? "#0d9163" : "transparent", border: "1px solid #0d9163", color: showTrade ? "#fff" : "#0d9163", fontFamily: "monospace", fontWeight: 700 }}>
            TRADE
          </button>
          <button onClick={togglePF} title={inPF ? "Remove from Portfolio" : "Add to Portfolio"} style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, border: `1px solid ${ARIA.yellow}80`, color: inPF ? ARIA.bg : ARIA.yellow, background: inPF ? ARIA.yellow : "transparent", cursor: "pointer", fontFamily: "monospace", fontWeight: 700 }}>{inPF ? "✓PF" : "+PF"}</button>
          <button onClick={toggleFC} title={inFC ? "Remove from Focus" : "Add to Focus (high-priority recent setups)"} style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, border: `1px solid ${ARIA.cyan}80`, color: inFC ? ARIA.bg : ARIA.cyan, background: inFC ? ARIA.cyan : "transparent", cursor: "pointer", fontFamily: "monospace", fontWeight: 700 }}>{inFC ? "✓FC" : "⚡FC"}</button>
          <button onClick={toggleWL} title={inWL ? "Remove from Watchlist" : "Add to Watchlist"} style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, border: `1px solid ${ARIA.green}80`, color: inWL ? ARIA.bg : ARIA.green, background: inWL ? ARIA.green : "transparent", cursor: "pointer", fontFamily: "monospace", fontWeight: 700 }}>{inWL ? "✓WL" : "+WL"}</button>
          <input ref={tickerInputRef} value={tickerInput} onChange={(e) => setTickerInput(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === "Enter") { submitTicker(); e.currentTarget.blur(); } else if (e.key === "Escape") { e.currentTarget.blur(); } }} placeholder="Ticker (/)" title="Jump to ticker (press /)" style={{ width: 70, fontSize: 9, padding: "2px 6px", background: ARIA.bg, border: `1px solid ${ARIA.border}`, borderRadius: 3, color: ARIA.textDim, fontFamily: "monospace", textTransform: "uppercase", outline: "none" }} />
        </div>
      </div>

      {/* Second thin row — grade · perf · 52W · Str (left), IPO (right) */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "3px 12px", borderBottom: `1px solid ${ARIA.border}`, flexShrink: 0, fontFamily: "monospace", overflowX: "auto", whiteSpace: "nowrap" }}>
      {(() => {
        const csColor = (l) => (l === "A+" || l === "A") ? ARIA.green : l === "B" ? ARIA.blue : l === "C" ? ARIA.yellow : l === "D" ? "#f59e0b" : l === "F" ? ARIA.red : ARIA.textMuted;
        const pctColor = (v) => v == null ? ARIA.textMuted : v >= 80 ? ARIA.green : v >= 50 ? ARIA.blue : v >= 30 ? ARIA.yellow : ARIA.textDim;
        const rsRank = rsScoreMap.get(ticker) ?? stockInfo?.rs_rank ?? null;
        const rsColor = rsRank == null ? ARIA.textMuted : rsRank >= 90 ? ARIA.green : rsRank >= 70 ? ARIA.blue : rsRank >= 50 ? ARIA.yellow : ARIA.textDim;
        // Extension from the 20-day MA in ATR multiples (swing anchor, days-weeks).
        // Coiled = tight to the 20-day MA on EITHER side (|ext| ≤ 2 ATRs) = green;
        // loose/extended above OR well below the MA = gray. Proximity is symmetric —
        // a name hugging the MA from just below is as tight as one just above it.
        const ext = stockInfo?.dist_20dma_atrx ?? null;
        const extColor = ext == null ? ARIA.textMuted : Math.abs(ext) <= 2 ? ARIA.green : ARIA.textDim;
        const baseW = stockInfo?.base_weeks ?? null;
        const basePos = stockInfo?.base_pos_pct ?? null;
        const baseColor = !baseW ? ARIA.textMuted : (baseW >= 6 && (basePos == null || basePos >= 50)) ? ARIA.green : baseW >= 3 ? ARIA.blue : ARIA.textDim;
        const perfs = [
          { label: "1M", val: stockInfo?.return_1m },
          { label: "3M", val: stockInfo?.return_3m },
          { label: "6M", val: stockInfo?.return_6m },
        ];
        const stat = (label, node, title) => (
          <span title={title} style={{ fontSize: 9, fontFamily: "monospace", display: "inline-flex", alignItems: "baseline", gap: 3, flexShrink: 0 }}>
            <span style={{ color: ARIA.textMuted }}>{label}</span>{node}
          </span>
        );
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "nowrap", flexShrink: 0 }}>
            {grade && (
              <span title="Overall grade" style={{ fontSize: 9, fontFamily: "monospace", fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: gradeColor + "22", border: `1px solid ${gradeColor}55`, color: gradeColor }}>
                {grade}
              </span>
            )}
            {stat("CANSLIM", <span style={{ color: csColor(canslimGrade), fontWeight: 700 }}>{canslimGrade}</span>, "CANSLIM composite — unweighted average of O'Neil/IBD's gradeable criteria (EPS growth, accel, 5Y EPS, sales, margin, ROE, inst flow, dist-from-high, industry rank)")}
            {stat("EPS", <span style={{ color: pctColor(epsPct), fontWeight: 700 }}>{epsPct != null ? `${epsPct}` : "—"}</span>, "EPS growth (YoY) percentile vs the full universe")}
            {stat("Rev", <span style={{ color: pctColor(revPct), fontWeight: 700 }}>{revPct != null ? `${revPct}` : "—"}</span>, "Revenue growth (YoY) percentile vs the full universe")}
            {perfs.map(({ label, val }) => (
              <span key={label} style={{ fontSize: 9, fontFamily: "monospace", display: "inline-flex", alignItems: "baseline", gap: 3, flexShrink: 0 }}>
                <span style={{ color: ARIA.textMuted }}>{label}</span>
                <span style={{ color: ARIA.textDim, fontWeight: val != null && Math.abs(val) >= 20 ? 700 : 400 }}>
                  {val != null ? `${val >= 0 ? "+" : ""}${val.toFixed(1)}%` : "—"}
                </span>
              </span>
            ))}
            {fromHi != null && (
              <span style={{ fontSize: 9, fontFamily: "monospace", display: "inline-flex", alignItems: "baseline", gap: 3, flexShrink: 0 }}>
                <span style={{ color: ARIA.textMuted }}>52W</span>
                <span style={{ color: fromHi >= -20 ? ARIA.green : ARIA.textDim, fontWeight: fromHi >= -20 ? 700 : 400 }}>
                  {fromHi > 0 ? "+" : ""}{fromHi.toFixed(1)}%
                </span>
              </span>
            )}
            {stat("RS", <span style={{ color: rsColor, fontWeight: 700 }}>{rsRank != null ? rsRank : "—"}</span>, "RS score (0-100) — the same relative-strength value shown in the LAYER REGIME box (rs_rotation holds)")}
            {stat("Ext", <span style={{ color: extColor, fontWeight: 700 }}>{ext != null ? `${ext.toFixed(1)}×` : "—"}</span>, "Extension from the 20-day MA in ATR multiples (swing anchor, days-to-weeks). Green = coiled: within ~2 ATRs of the MA on either side (tight to it, above or below). Gray = not coiled: extended above (loose, don\'t chase) or well below the MA.")}
            {stat("Base", <span style={{ color: baseColor, fontWeight: 700 }}>{baseW ? `${baseW % 1 === 0 ? baseW : baseW.toFixed(1)}w` : "—"}</span>, `Base quality — weeks consolidating near the highs (longer bases → bigger moves)${basePos != null ? `; price sits at the ${basePos}th %ile of the base range (${basePos >= 50 ? "upper" : "lower"} half)` : ""}.`)}
            {(() => {
              const tt = ttCount(stockInfo);
              const ttColor = tt == null ? ARIA.textMuted : tt === 8 ? ARIA.green : tt >= 6 ? ARIA.textDim : ARIA.red;
              const fails = tt != null && tt < 8 ? ` Failing: ${ttFails(stockInfo).join(" · ")}.` : tt === 8 ? " All eight pass — confirmed stage-2 uptrend." : "";
              return stat("TT", <span style={{ color: ttColor, fontWeight: tt === 8 ? 700 : 400 }}>{tt == null ? "—" : `${tt}/8`}</span>,
                `Minervini Trend Template (stage-2 qualifier): price > 150/200d · 150d > 200d · 200d rising 1mo+ · 50d > 150d > 200d · price > 50d · ≥30% above 52w low · within 25% of 52w high · RS ≥ 70.${fails}`);
            })()}
          </div>
        );
      })()}
        {stockInfo.ipo_date && (
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "baseline", gap: 3, fontFamily: "monospace", fontSize: 9, flexShrink: 0 }}>
            <span style={{ color: ARIA.textMuted, fontSize: 8 }}>IPO</span>
            <span title="Recent IPO (< 5 years)" style={{ fontWeight: 700, color: (Date.now() - new Date(stockInfo.ipo_date).getTime()) < 157788000000 ? ARIA.green : ARIA.textDim }}>{stockInfo.ipo_date}</span>
          </span>
        )}
      </div>

      {/* SVG D/W Chart */}
      <div style={{ height: 600, overflow: "hidden", flexShrink: 0 }}>
        <ErrorBoundary>
          <DailyChartSVG
            ohlc={ohlcBars}
            quarters={erHist?.ticker === ticker && erHist.history.length
              ? erHist.history.map((q) => ({ report_date: q.date, label: q.fiscal_label || "", eps_yoy: q.eps_yoy_pct, sales_yoy: q.revenue_yoy_pct }))
              : quarters}
            height={height}
            owned={inPF || inFC || inWL}
            rsRating={rsRating}
            rsRatingColor={rsRatingColor}
            stopLines={[
              ...(showTrade && riskScenarios ? [
                { price: riskScenarios.tight?.stopPrice, color: "#ef4444", label: "0.5x", dashed: true },
                { price: riskScenarios.base?.stopPrice,  color: "#f97316", label: "1x",   dashed: true },
                { price: riskScenarios.wide?.stopPrice,  color: "#f59e0b", label: "2x",   dashed: true },
                { price: riskDayLow,                     color: "#9ca3af", label: "LOD",  dashed: false },
                { price: riskPDL,                        color: "#fb923c", label: "PDL",  dashed: true },
              ] : []),
            ].filter(sl => sl.price > 0)}
          />
        </ErrorBoundary>
      </div>

      {/* Ticker details — compact strip below the chart */}
      <div style={{ padding: "6px 14px", borderTop: `1px solid ${ARIA.border}`, flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        {/* Left column — badges + company + description */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {(has9M || stockInfo.two_day_tight || stockInfo.de_ready) && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
              {has9M && <span style={badgeStyle("#f59e0b")} title="Unusual institutional volume">9M</span>}
              {!!stockInfo.two_day_tight && <span style={badgeStyle("#f472b6")} title="2-Days-Tight — last two closes within 1% + narrowing range, above the 50sma. Breakout candidate.">T2</span>}
              {!!stockInfo.de_ready && <span style={badgeStyle("#fb923c")} title={`Delayed Entry ready (2-7d post-gap, tight + narrowing, holding 4-EMA). Entry = break of ${stockInfo.de_trigger ?? "recent highs"}${stockInfo.de_hold ? ` · gap ${stockInfo.de_hold} (${stockInfo.de_hold_score}/5)` : ""}${stockInfo._epq ? ` · EP quality ${stockInfo._epq}` : ""}${stockInfo._newsPipe ? `\nCatalyst: ${stockInfo._newsPipe[0]}` : ""}`}>DE{stockInfo.de_trigger ? ` ${stockInfo.de_trigger}` : ""}{stockInfo.de_hold === "HELD" ? " ✓" : ""}</span>}
            </div>
          )}
          <div style={{ fontSize: 9, color: "#9090a0", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 1 }}>
            {stockInfo.company || ticker}
          </div>
          {liveQuote && (
            <div style={{ display: "flex", gap: 12, fontSize: 9, fontFamily: "monospace", margin: "1px 0 3px", flexWrap: "wrap" }}>
              {[
                ["Day", chgPct, "Change vs yesterday's close"],
                ["From open", fromOpenPct, "Change since today's open"],
              ].map(([lbl, v, tip]) => (
                <span key={lbl} title={tip}>
                  <span style={{ color: ARIA.textMuted }}>{lbl} </span>
                  <span style={{ color: v == null ? ARIA.textMuted : v >= 0 ? ARIA.green : ARIA.red, fontWeight: 700 }}>
                    {v == null ? "\u2014" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`}</span>
                </span>
              ))}
              <span title="ZVR — today's volume ÷ a normal day's volume by this time (the ticker's own intraday profile; 1.00× = normal pace). After the close: full-day volume ÷ 10-day average.">
                <span style={{ color: ARIA.textMuted }}>ZVR </span>
                <span style={{ color: zvr == null ? ARIA.textMuted : zvr >= 2 ? ARIA.purple : zvr >= 1.3 ? ARIA.green : zvr < 0.7 ? ARIA.textMuted : ARIA.textDim, fontWeight: 700 }}>
                  {zvr == null ? "\u2014" : `${zvr.toFixed(2)}×`}</span>
              </span>
              <TierMark t={ticker} label />
            </div>
          )}
          {description
            ? <div style={{ fontSize: 8.5, color: "#6a6a7a", lineHeight: 1.4 }}>{description}</div>
            : <div style={{ fontSize: 8.5, color: "#4a4a5a", fontStyle: "italic" }}>No description available.</div>}
        </div>
        {/* Right column — news */}
        <div style={{ flex: 1, minWidth: 0, borderLeft: `1px solid ${ARIA.border}`, paddingLeft: 14 }}>
          <div onClick={() => news.length > 0 && setNewsOpen(o => !o)}
            style={{ display: "flex", alignItems: "center", gap: 5, cursor: news.length > 0 ? "pointer" : "default", userSelect: "none", fontSize: 8, fontWeight: 700, color: "#6a6a7a", textTransform: "uppercase", letterSpacing: 0.5, padding: "1px 0" }}
            onMouseEnter={e => { if (news.length > 0) e.currentTarget.style.color = "#9090a0"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "#6a6a7a"; }}>
            {news.length > 0 && <span style={{ fontSize: 7 }}>{newsOpen ? "▼" : "▶"}</span>}
            News <span style={{ color: "#4a4a5a", fontWeight: 400 }}>({news.length || stockInfo._newsPipe?.length || 0})</span>
          </div>
          {news.length === 0 && !(stockInfo._newsPipe?.length) && <div style={{ fontSize: 8.5, color: "#4a4a5a", fontStyle: "italic", marginTop: 2 }}>No recent headlines.</div>}
          {news.length === 0 && stockInfo._newsPipe?.length > 0 && (
            <div style={{ maxHeight: 150, overflowY: "auto" }}>
              {stockInfo._newsPipe.map((h, i) => (
                <div key={i} title={h} style={{ fontSize: 8.5, color: "#9090a0", padding: "2px 0", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                  <span style={{ color: "#5a5a6a", marginRight: 4 }}>⛭</span>{h}
                </div>
              ))}
            </div>
          )}
          {newsOpen && news.length > 0 && (
            <div style={{ maxHeight: 150, overflowY: "auto" }}>
              {news.slice(0, 8).map((a, i) => (
                <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"
                  style={{ display: "block", fontSize: 8.5, color: "#9090a0", textDecoration: "none", padding: "2px 0", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", borderBottom: "1px solid rgba(255,255,255,0.03)" }}
                  onMouseEnter={e => { e.currentTarget.style.color = "#c0c0d8"; e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = "#9090a0"; e.currentTarget.style.background = "transparent"; }}>
                  <span style={{ color: "#5a5a6a", marginRight: 4 }}>{agoLabel(a.date)}</span>
                  {a.headline}
                  <span style={{ color: "#6a6a7a", marginLeft: 4 }}>{a.source}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
      </div>

      {/* Prior earnings responses — EPS/Sales surprise + 1d/10d reaction */}
      <div style={{ borderBottom: `1px solid ${ARIA.border}`, padding: "3px 14px 4px" }}>
        <div onClick={() => setErHistOpen((o) => { const n = !o; try { localStorage.setItem("tp-erhist-open", n ? "1" : "0"); } catch {} return n; })}
          style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", userSelect: "none", fontSize: 8, fontWeight: 700, color: "#6a6a7a", textTransform: "uppercase", letterSpacing: 0.5, padding: "1px 0" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#9090a0"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "#6a6a7a"; }}
          title="Prior earnings responses: EPS/Sales surprise vs estimates + the price reaction (announcement day and 10 sessions incl. drift). How does this name treat its reports?">
          <span style={{ fontSize: 7 }}>{erHistOpen ? "▼" : "▶"}</span>
          Earnings History{erHist?.ticker === ticker && erHist.history.length ? ` (${erHist.history.length}q)` : ""}
        </div>
        {erHistOpen && (() => {
          if (erHist?.ticker !== ticker) return <div style={{ fontSize: 8.5, color: "#4a4a5a", fontStyle: "italic", padding: "2px 0" }}>loading…</div>;
          if (!erHist.history.length) return <div style={{ fontSize: 8.5, color: "#4a4a5a", fontStyle: "italic", padding: "2px 0" }}>No reported quarters.</div>;
          const fmtRev = (v) => v == null ? "—" : v >= 1e9 ? (v / 1e9).toFixed(1) + "B" : (v / 1e6).toFixed(0) + "M";
          const surpC = (v) => v == null ? ARIA.textMuted : v >= 0 ? ARIA.green : ARIA.red;
          const rxC = (v) => v == null ? ARIA.textMuted : Math.abs(v) < 2 ? ARIA.textDim : v > 0 ? ARIA.green : ARIA.red;
          const sp = (v, dec = 1) => v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(dec)}%`;
          const yoy = (v) => v == null ? "—" : Math.abs(v) >= 1000 ? `${v > 0 ? ">+999" : "<-999"}%` : `${v > 0 ? "+" : ""}${v.toFixed(0)}%`;
          // Calendar-quarter shorthand: the quarter that ENDED most recently
          // before the report date (a 05/20/26 report covers Q1 26').
          const qtrTag = (d) => {
            if (!d) return null;
            const [y, m] = d.split("-").map(Number);
            const qEnd = Math.floor((m - 1) / 3); // 0 = Jan-Mar report → prior Q4
            const q = qEnd === 0 ? 4 : qEnd;
            const yr = qEnd === 0 ? y - 1 : y;
            return `Q${q} ${String(yr).slice(2)}'`;
          };
          // Minervini Code 33: a quarter "accelerates" when EPS YoY, Sales YoY
          // and net margin are ALL higher than the prior quarter's. Three
          // consecutive accelerating quarters = Code 33 → light-blue rows.
          const H = erHist.history; // newest first
          const accel = H.map((q, i) => {
            const p = H[i + 1];
            return !!(p && q.eps_yoy_pct != null && p.eps_yoy_pct != null && q.revenue_yoy_pct != null && p.revenue_yoy_pct != null && q.net_margin_pct != null && p.net_margin_pct != null
              && q.eps_yoy_pct > p.eps_yoy_pct && q.revenue_yoy_pct > p.revenue_yoy_pct && q.net_margin_pct > p.net_margin_pct);
          });
          const code33 = H.map((_, i) => {
            for (let k = Math.max(0, i - 2); k <= i; k++) {
              if (accel[k] && accel[k + 1] && accel[k + 2]) return true;
            }
            return false;
          });
          const liveCode33 = accel[0] && accel[1] && accel[2];
          const th = { padding: "2px 6px", fontSize: 7, fontWeight: 700, color: ARIA.textMuted, textTransform: "uppercase", letterSpacing: 0.3, textAlign: "right", borderBottom: `1px solid ${ARIA.border}`, whiteSpace: "nowrap" };
          const td = { padding: "1px 6px", fontSize: 8.5, fontFamily: "monospace", textAlign: "right", whiteSpace: "nowrap", borderBottom: `1px solid ${ARIA.border}40` };
          return (
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr>
                  <th style={{ ...th, textAlign: "left" }}>Qtr</th>
                  <th style={th} title="Reported EPS (surprise vs consensus)">EPS</th>
                  <th style={th} title="EPS growth vs the same quarter a year ago (4 reports back)">YoY</th>
                  <th style={th} title="EPS beat/miss vs consensus estimate">Surp</th>
                  <th style={th} title="Reported revenue (surprise vs consensus)">Sales</th>
                  <th style={th} title="Revenue growth vs the same quarter a year ago">YoY</th>
                  <th style={th} title="Revenue beat/miss vs consensus estimate">Surp</th>
                  <th style={th} title="ADJUSTED net margin for the reported quarter (street-basis EPS × diluted shares / revenue) — one-time GAAP items can't fake acceleration. Minervini Code 33: three straight quarters where EPS YoY, Sales YoY AND net margin all accelerate — those rows glow light blue.">NM%</th>
                  <th style={th} title="Announcement-day close-to-close move (BMO/AMC inferred from which session moved more)">1D</th>
                  <th style={th} title="Close 10 sessions after the pre-ER close vs the pre-ER close — total response incl. drift">10D</th>
                </tr></thead>
                <tbody>
                  {liveCode33 ? (
                    <tr><td colSpan={10} style={{ padding: "2px 6px", fontSize: 7.5, fontWeight: 800, color: ARIA.blue, background: `${ARIA.blue}14`, letterSpacing: 0.4 }} title="EPS YoY, Sales YoY and net margin have ALL accelerated for 3 straight quarters — Minervini's 'hitting on all cylinders' condition">CODE 33 — sales, earnings & margins accelerating 3 straight quarters</td></tr>
                  ) : null}
                  {erHist.history.map((q, qi) => (
                    <tr key={q.date} style={{ background: code33[qi] ? `${ARIA.blue}1f` : "transparent" }} title={code33[qi] ? "Part of a Code 33 run — EPS YoY, Sales YoY and net margin all accelerating for 3+ consecutive quarters" : undefined}>
                      <td style={{ ...td, textAlign: "left", color: ARIA.textDim }}>{q.date?.slice(2)}{(q.fiscal_label || qtrTag(q.date)) ? <span style={{ color: ARIA.textMuted }} title="Company fiscal quarter (matches the chart's ER markers)"> ({q.fiscal_label || qtrTag(q.date)})</span> : null}</td>
                      <td style={{ ...td, color: ARIA.textDim }}>{q.eps_actual != null ? q.eps_actual.toFixed(2) : "—"}</td>
                      <td style={{ ...td, color: surpC(q.eps_yoy_pct), fontWeight: q.eps_yoy_pct != null && q.eps_yoy_pct >= 25 ? 700 : 400 }}>{yoy(q.eps_yoy_pct)}</td>
                      <td style={{ ...td, color: surpC(q.eps_surprise_pct), fontWeight: q.eps_surprise_pct != null && Math.abs(q.eps_surprise_pct) >= 10 ? 700 : 400 }}>{sp(q.eps_surprise_pct)}</td>
                      <td style={{ ...td, color: ARIA.textDim }}>{fmtRev(q.revenue_actual)}</td>
                      <td style={{ ...td, color: surpC(q.revenue_yoy_pct), fontWeight: q.revenue_yoy_pct != null && q.revenue_yoy_pct >= 20 ? 700 : 400 }}>{yoy(q.revenue_yoy_pct)}</td>
                      <td style={{ ...td, color: surpC(q.revenue_surprise_pct), fontWeight: q.revenue_surprise_pct != null && Math.abs(q.revenue_surprise_pct) >= 5 ? 700 : 400 }}>{sp(q.revenue_surprise_pct)}</td>
                      <td style={{ ...td, color: accel[qi] ? ARIA.blue : ARIA.textDim, fontWeight: accel[qi] ? 700 : 400 }}>{q.net_margin_pct != null ? `${q.net_margin_pct.toFixed(1)}%` : "—"}</td>
                      <td style={{ ...td, color: rxC(q.day1_pct), fontWeight: q.day1_pct != null && Math.abs(q.day1_pct) >= 5 ? 700 : 400 }}>{sp(q.day1_pct)}</td>
                      <td style={{ ...td, color: rxC(q.day10_pct), fontWeight: q.day10_pct != null && Math.abs(q.day10_pct) >= 5 ? 700 : 400 }}>{sp(q.day10_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>

      {/* Risk Management Dashboard */}
      {showTrade && (() => {
        const inputStyle = {
          width: 80, fontSize: 9, padding: "2px 5px", background: "#0a0a14",
          border: "1px solid #2a2a3a", borderRadius: 3, color: "#c0c0d8",
          fontFamily: "monospace", outline: "none",
        };
        const labelStyle = { fontSize: 8, color: "#6a6a7a", marginRight: 3 };
        const cols = [
          { key: "tight", label: "0.5× ATR" },
          { key: "base",  label: "1× ATR" },
          { key: "wide",  label: "2× ATR" },
          { key: "lod",   label: "Day Low" },
          { key: "pdl",   label: "Prev Low" },
        ];
        const atrPct = dailyATR && riskEntry ? ((dailyATR / riskEntry) * 100).toFixed(2) : null;
        const fmtN = (v, dec = 2) => v != null ? v.toFixed(dec) : "—";
        const cellBg = "#0d0d1a";
        const headBg = "#14142a";
        const colColors = ["#ef4444","#f97316","#f59e0b","#9ca3af","#fb923c"];
        return (
          <div style={{ borderBottom: "1px solid #1a1a2e", background: "#0b0b18", padding: "8px 14px" }}>
            {/* Input row */}
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 9, fontFamily: "monospace", color: "#0d9163", fontWeight: 700 }}>
                ATR({tradeSettings.atrLen}): ${dailyATR ? dailyATR.toFixed(2) : "—"}{atrPct ? ` (${atrPct}%)` : ""}
              </span>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                <span style={labelStyle}>Acct $</span>
                <input style={inputStyle} type="number" value={tradeSettings.accountSize}
                  onChange={e => setTradeSettings(s => ({ ...s, accountSize: parseFloat(e.target.value) || s.accountSize }))} />
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                <span style={labelStyle}>Risk %</span>
                <input style={{ ...inputStyle, width: 50 }} type="number" step="0.1" value={tradeSettings.riskPct}
                  onChange={e => setTradeSettings(s => ({ ...s, riskPct: parseFloat(e.target.value) || s.riskPct }))} />
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                <span style={labelStyle}>Max %</span>
                <input style={{ ...inputStyle, width: 50 }} type="number" step="1" value={tradeSettings.maxAllocPct}
                  onChange={e => setTradeSettings(s => ({ ...s, maxAllocPct: parseFloat(e.target.value) || s.maxAllocPct }))} />
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                <span style={labelStyle}>ATR Len</span>
                <input style={{ ...inputStyle, width: 45 }} type="number" step="1" value={tradeSettings.atrLen}
                  onChange={e => setTradeSettings(s => ({ ...s, atrLen: parseInt(e.target.value) || s.atrLen }))} />
              </label>
            </div>
            {/* Table */}
            {riskScenarios && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: 9 }}>
                <thead>
                  <tr>
                    <th style={{ padding: "3px 8px", background: headBg, color: "#5a5a7a", textAlign: "left", fontWeight: 600, fontSize: 8, borderBottom: "1px solid #1a1a2e" }}></th>
                    {cols.map((col, ci) => (
                      <th key={col.key} style={{ padding: "3px 8px", background: headBg, color: colColors[ci], textAlign: "right", fontWeight: 700, fontSize: 8, borderBottom: "1px solid #1a1a2e", whiteSpace: "nowrap" }}>
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { row: "Stop $",    fn: s => s ? `$${fmtN(s.stopPrice)}` : "—" },
                    { row: "Shares",    fn: s => s ? `${s.shares}${s.capped ? "*" : ""}` : "—", cappedFn: s => s?.capped },
                    { row: "Dist %",    fn: s => s ? `-${fmtN(s.distPct)}%` : "—" },
                    { row: "Invested",  fn: s => s ? `${fmtN(s.investedPct, 1)}%` : "—" },
                    { row: "Risk $",    fn: s => s ? `$${fmtN(s.risk)}` : "—" },
                  ].map(({ row, fn, cappedFn }) => (
                    <tr key={row}>
                      <td style={{ padding: "3px 8px", background: headBg, color: "#6a6a7a", fontSize: 8, fontWeight: 600, borderBottom: "1px solid #111120" }}>{row}</td>
                      {cols.map((col, ci) => {
                        const s = riskScenarios[col.key];
                        const isCapped = cappedFn ? cappedFn(s) : false;
                        return (
                          <td key={col.key} style={{
                            padding: "3px 8px", textAlign: "right", borderBottom: "1px solid #111120",
                            background: isCapped ? "rgba(251,191,36,0.12)" : cellBg,
                            color: isCapped ? "#fbbf24" : colColors[ci],
                            fontWeight: row === "Stop $" || row === "Shares" ? 700 : 400,
                          }}>
                            {fn(s)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })()}

      {/* Quarterly fundamentals — always visible below chart */}
      {(() => {
        // Normalize pipeline quarters/annual into the same shape as FMP data.
        // Pipeline revenue is raw dollars; MiniQBars expects millions.
        const normPipelineQ = (arr) =>
          Array.isArray(arr)
            ? arr.map(q => ({
                ...q,
                revenue: q.revenue != null ? q.revenue / 1_000_000 : null,
                revenue_yoy: q.revenue_yoy ?? q.sales_yoy ?? null,
                ocf_ps: null,
                ocf_yoy: null,
              }))
            : [];
        const normPipelineA = (arr) =>
          Array.isArray(arr)
            ? arr.map(q => ({
                ...q,
                label: String(q.year),
                period: "FY",
                revenue: q.revenue != null ? q.revenue / 1_000_000 : null,
                revenue_yoy: q.revenue_yoy ?? q.sales_yoy ?? null,
                net_margin: q.net_margin ?? null,
                ocf_ps: null,
                ocf_yoy: null,
              }))
            : [];
        // Same source of truth as the Earnings History table + chart markers:
        // street-basis actuals from /api/earnings, oldest→newest.
        const erQ = erHist?.ticker === ticker && erHist.history.length
          ? [...erHist.history].reverse().map((q) => ({
              label: q.fiscal_label || (q.date || "").slice(2, 7),
              period: q.fiscal_label ? q.fiscal_label.split("-")[0] : "",
              eps: q.eps_actual,
              eps_yoy: q.eps_yoy_pct,
              revenue: q.revenue_actual != null ? q.revenue_actual / 1e6 : null,
              revenue_yoy: q.revenue_yoy_pct,
              net_margin: q.net_margin_pct,
              gross_margin: q.gross_margin_pct,
            }))
          : null;
        const effectiveQuarters = erQ || (quarters.length > 0 ? quarters : normPipelineQ(stockInfo?.quarters));
        const effectiveAnnuals  = annuals.length  > 0 ? annuals  : normPipelineA(stockInfo?.annual);
        // Oldest → newest. Street history (erQ) already is; pipeline arrays are
        // newest-first, so order by report date / year when available.
        const orderQ = (arr) => {
          const a = [...arr];
          if (a.length > 1 && a.every((q) => q.report_date)) a.sort((x, y) => String(x.report_date).localeCompare(String(y.report_date)));
          return a;
        };
        const qAll = erQ || orderQ(effectiveQuarters);
        const qCols = qAll.slice(-6).map((q) => ({
          _label: q.label || q.period || "",
          eps: q.eps ?? null, eps_yoy: q.eps_yoy ?? null,
          revenue: q.revenue ?? null, revenue_yoy: q.revenue_yoy ?? q.sales_yoy ?? null,
          net_margin: q.net_margin ?? null,
        }));
        const aCols = [...effectiveAnnuals]
          .sort((x, y) => (Number(x.year ?? x.label) || 0) - (Number(y.year ?? y.label) || 0))
          .slice(-6)
          .map((a) => ({
            _label: String(a.year ?? a.label ?? ""),
            eps: a.eps ?? null, eps_yoy: a.eps_yoy ?? null,
            revenue: a.revenue ?? null, revenue_yoy: a.revenue_yoy ?? a.sales_yoy ?? null,
            net_margin: a.net_margin ?? null,
          }));
        // Next quarter's consensus (orange). YoY vs the quarter 4 back.
        let est = null;
        const eEps = stockInfo?.eps_estimated, eRev = stockInfo?.revenue_estimated;
        if (eEps != null || eRev != null) {
          const yAgo = qAll.length >= 4 ? qAll[qAll.length - 4] : null;
          const revM = eRev != null ? eRev / 1e6 : null;
          const yoy = (now, then) => (now != null && then != null && then !== 0 ? ((now - then) / Math.abs(then)) * 100 : null);
          est = {
            _est: true,
            _label: `Est ${String(stockInfo?.earnings_display || "").replace(/^~/, "").split("/").slice(0, 2).join("/")}`.trim(),
            eps: eEps ?? null, eps_yoy: yoy(eEps, yAgo?.eps),
            revenue: revM, revenue_yoy: yoy(revM, yAgo?.revenue),
            net_margin: null,
          };
        }
        if (!qCols.length && !aCols.length) return null;
        return (
          <div style={{ padding: "8px 14px 12px", borderTop: `1px solid ${ARIA.border}` }}>
            <EarningsBox quarters={qCols} annuals={aCols} est={est} ARIA={ARIA}
              source={`Quarterly: ${erQ ? "street actuals (adjusted)" : quarters.length > 0 ? "Finviz actuals" : "pipeline data"} · Annual: reported · orange = consensus estimate`} />
          </div>
        );
      })()}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Watchlist (Phase 2.4)
// ──────────────────────────────────────────────────────────────────────────
//
// Persistent ticker list with live quote updates. localStorage-backed for
// Phase 2.4; Vercel KV sync via /api/userdata lands in Phase 4.
// ──────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────
// Watchlist (Phase 2.7 — Aria-faithful with Portfolio + Themes view)
// ──────────────────────────────────────────────────────────────────────────
//
// Aria reference: dashboard.html lines 3801-3843 + JS 4360-4530
// Two sections: Portfolio (yellow) + Watchlist (green)
// Two views: List (default tables) + Themes (grouped by subtheme with rank)
// Rank metrics: Chg% / RVol / RS / CR% / Open%
// Theme groups computed client-side from dashboard_data.json themes field.
// ──────────────────────────────────────────────────────────────────────────




// ──────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────
// AppMain
// ──────────────────────────────────────────────────────────────────────────



// ── Trade alerts: polls live quotes for portfolio ∪ focus during RTH and fires
// when (a) a name crosses its DE trigger, (b) a focus/held name fires BO
// conditions, (c) a PORTFOLIO name shows heavy distribution. Deduped per
// ticker+type per day; optional desktop notifications. Signal-free.
function useTradeAlerts(stockMap) {
  const [portfolio] = useLocalStorageList("themepulse-portfolio");
  const [focus] = useLocalStorageList("themepulse-focus");
  const [alerts, setAlerts] = useState([]);
  const seenKey = () => `tp-alerts-seen-${new Date().toISOString().slice(0, 10)}`;
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
      const mins = et.getHours() * 60 + et.getMinutes();
      if (mins < 570 || mins >= 960) return; // RTH only
      const names = [...new Set([...portfolio, ...focus])].filter((t) => stockMap?.[t]);
      if (!names.length) return;
      try {
        const qMap = await quoteStore.fetchQuotes(names, { maxAgeMs: 50000 });
        const qs = [...qMap.values()];
        const frac = Math.max(0.02, sessionVolFraction(mins - 570));
        let seen; try { seen = new Set(JSON.parse(localStorage.getItem(seenKey()) || "[]")); } catch { seen = new Set(); }
        const fresh = [];
        const push = (t, type, msg) => {
          const k = `${t}|${type}`;
          if (seen.has(k)) return;
          seen.add(k); fresh.push({ t, type, msg, time: et.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) });
        };
        qs.forEach((q) => {
          const t = q?.ticker; if (!t) return;
          const st = stockMap[t] || {};
          const price = q.price, chg = q.change, vol = q.volume, avg = st.avg_volume_raw || q.avgVolume || 0;
          let zvr = null;
          if (vol && avg > 0) { zvr = Math.round((vol / (avg * frac)) * 100); if (chg != null && chg < 0) zvr = -zvr; }
          const cr = closingRange(q, st);
          // (a) DE trigger break
          if (st.de_ready && st.de_trigger && price != null && price >= st.de_trigger)
            push(t, "DE", `crossed its DE trigger ${st.de_trigger} — delayed-entry breakout`);
          // (b) BO firing (focus or portfolio)
          if ((st.off_52w_high ?? -100) >= -6 && chg != null && chg > 0 && chg >= (st.adr_pct || 4) &&
              zvr != null && zvr >= 130 && cr != null && cr >= 60)
            push(t, "BO", `breakout conditions firing (+${chg.toFixed(1)}%, ZVR ${zvr}%)`);
          // (c) DIST on a portfolio holding
          if (portfolio.includes(t) && zvr != null && zvr <= -180)
            push(t, "DIST", `heavy distribution (ZVR ${zvr}%) — holdings guard`);
        });
        if (fresh.length && !stop) {
          try { localStorage.setItem(seenKey(), JSON.stringify([...seen])); } catch { /* noop */ }
          setAlerts((prev) => [...fresh, ...prev].slice(0, 30));
          if (typeof window.Notification !== "undefined" && window.Notification.permission === "granted" &&
              localStorage.getItem("tp-alerts-desktop") === "1") {
            fresh.forEach((a) => { try { new window.Notification(`${a.t} — ${a.type}`, { body: a.msg }); } catch { /* noop */ } });
          }
        }
      } catch { /* ignore */ }
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => { stop = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolio.join(","), focus.join(","), stockMap]);
  return alerts;
}

function AlertsBell({ alerts, onTicker, ARIA }) {
  const [open, setOpen] = useState(false);
  const [desk, setDesk] = useState(() => localStorage.getItem("tp-alerts-desktop") === "1");
  const toggleDesk = async () => {
    if (!desk && typeof window.Notification !== "undefined" && window.Notification.permission !== "granted") {
      const perm = await window.Notification.requestPermission();
      if (perm !== "granted") return;
    }
    const n = !desk; setDesk(n);
    try { localStorage.setItem("tp-alerts-desktop", n ? "1" : "0"); } catch { /* noop */ }
  };
  const C = { DE: "#fb923c", BO: "#a855f7", DIST: "#ef4444" };
  return (
    <div style={{ position: "fixed", bottom: 16, right: 16, zIndex: 60, fontFamily: "monospace" }}>
      {open && (
        <div style={{ position: "absolute", bottom: 40, right: 0, width: 280, maxHeight: 320, overflowY: "auto", background: ARIA.bgCard, border: `1px solid ${ARIA.border}`, borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.5)", padding: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 9, fontWeight: 800, color: ARIA.text, textTransform: "uppercase", letterSpacing: 0.5 }}>Trade alerts</span>
            <button onClick={toggleDesk} title="Fire desktop notifications when new alerts arrive" style={{ fontSize: 7, padding: "1px 6px", borderRadius: 3, cursor: "pointer", fontFamily: "monospace", border: `1px solid ${desk ? ARIA.green : ARIA.border}`, color: desk ? ARIA.green : ARIA.textMuted, background: "transparent" }}>
              {desk ? "✓ desktop" : "desktop off"}
            </button>
          </div>
          {alerts.length === 0 && <div style={{ fontSize: 8.5, color: ARIA.textMuted, padding: "6px 0" }}>No alerts today. Watches portfolio + focus during market hours: DE trigger breaks, BO firing, distribution on holdings.</div>}
          {alerts.map((a, i) => (
            <div key={i} onClick={() => { onTicker && onTicker(a.t); setOpen(false); }}
              style={{ display: "flex", alignItems: "baseline", gap: 6, padding: "3px 4px", borderRadius: 4, cursor: "pointer", fontSize: 9 }}
              onMouseEnter={(e) => e.currentTarget.style.background = ARIA.bgHover} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
              <span style={{ fontSize: 7, fontWeight: 800, color: C[a.type] || ARIA.text, border: `1px solid ${(C[a.type] || ARIA.border)}66`, borderRadius: 2, padding: "0 3px", flexShrink: 0 }}>{a.type}</span>
              <span style={{ fontWeight: 700, color: ARIA.text, flexShrink: 0 }}>{a.t}</span>
              <span style={{ color: ARIA.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.msg}</span>
              <span style={{ color: ARIA.textMuted, fontSize: 7.5, marginLeft: "auto", flexShrink: 0 }}>{a.time}</span>
            </div>
          ))}
        </div>
      )}
      <button onClick={() => setOpen((v) => !v)} title="Trade alerts — DE trigger breaks, BO firing, distribution on holdings (portfolio + focus, market hours)"
        style={{ width: 34, height: 34, borderRadius: 17, cursor: "pointer", background: ARIA.bgCard, border: `1px solid ${alerts.length ? "#fb923c" : ARIA.border}`, color: alerts.length ? "#fb923c" : ARIA.textMuted, fontSize: 14, position: "relative", boxShadow: "0 2px 10px rgba(0,0,0,0.4)" }}>
        🔔
        {alerts.length > 0 && <span style={{ position: "absolute", top: -4, right: -4, minWidth: 14, height: 14, borderRadius: 7, background: "#fb923c", color: "#0a0a14", fontSize: 8, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>{alerts.length}</span>}
      </button>
    </div>
  );
}

// One-time global CSS: tabular numerals (stable number columns), the loading
// shimmer, and the live-dot pulse. Injected once at module load.
if (typeof document !== "undefined" && !document.getElementById("tp-visual-css")) {
  const st = document.createElement("style");
  st.id = "tp-visual-css";
  st.textContent = `
    body { font-variant-numeric: tabular-nums; }
    @keyframes tpShimmer { 0% { background-position: -140px 0; } 100% { background-position: 140px 0; } }
    .tp-shimmer { background: linear-gradient(90deg, rgba(255,255,255,0.05) 25%, rgba(255,255,255,0.14) 50%, rgba(255,255,255,0.05) 75%); background-size: 280px 100%; animation: tpShimmer 1.3s linear infinite; }
    @keyframes tpPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }
    .tp-livedot { animation: tpPulse 2s ease-in-out infinite; }
    .tp-wordmark { -webkit-background-clip: text !important; background-clip: text !important; -webkit-text-fill-color: transparent; -webkit-font-smoothing: antialiased; }
  `;
  document.head.appendChild(st);
}

// ──────────────────────────────────────────────────────────────────────────
// WheelView — cash-secured put / covered call screener for the wheel.
//
// A screener, not a recommender: it ranks contracts by annualized yield on
// EXTRINSIC value and surfaces the risk flags (earnings inside the cycle,
// thin liquidity, wide spread, strike under cost basis). Selection is the
// user's call. Data comes from /api/wheel (Schwab chain).
// ──────────────────────────────────────────────────────────────────────────











function AuthGate({ children }) {
  const ARIA = useAriaTheme();
  const [status, setStatus] = useState(() => (getAuthToken() ? "checking" : "locked"));
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    let live = true;
    const hasTok = Boolean(getAuthToken());
    fetch("/api/auth", { headers: authHeaders(), cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d) {
          if (live && hasTok) setStatus("locked");
          return;
        }
        if (d.authenticated) {
          setStatus("unlocked");
        } else {
          if (hasTok) setAuthToken("");
          setStatus("locked");
          if (d.configured === false) setErr("Server auth not configured (set TP_PIN and TP_SESSION_SECRET in Vercel).");
        }
      })
      .catch(() => {
        if (live) setStatus("locked");
      });

    const onChanged = (e) => {
      if (e?.detail?.unlocked) { setErr(""); setStatus("unlocked"); }
      else setStatus("locked");
    };
    const onReq = () => {
      setErr("Session expired — enter PIN to unlock.");
      setStatus("locked");
    };
    window.addEventListener("tp-auth-changed", onChanged);
    window.addEventListener("tp-auth-required", onReq);
    return () => {
      live = false;
      window.removeEventListener("tp-auth-changed", onChanged);
      window.removeEventListener("tp-auth-required", onReq);
    };
  }, []);

  useEffect(() => {
    if (status === "locked") setTimeout(() => inputRef.current?.focus(), 20);
  }, [status]);

  if (status === "unlocked") return children;

  const submit = async (e) => {
    e.preventDefault();
    if (!pin.trim() || busy) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pin.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok || !d.token) {
        setErr(d.error || `Unlock failed (${r.status})`);
        return;
      }
      setAuthToken(d.token);
      setPin("");
      setStatus("unlocked");
    } catch {
      setErr("Network error — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: ARIA.vignette || ARIA.bg,
        color: ARIA.text,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 340,
          background: ARIA.bgCard,
          border: `1px solid ${ARIA.border}`,
          borderRadius: 12,
          padding: "28px 24px",
          boxShadow: ARIA.shadow || "0 16px 40px rgba(0,0,0,0.45)",
          textAlign: "center",
        }}
      >
        <div
          className="tp-wordmark"
          style={{
            fontSize: 20,
            fontWeight: 800,
            backgroundImage: `linear-gradient(135deg, ${ARIA.brand1 || ARIA.green}, ${ARIA.brand2 || ARIA.cyan})`,
            letterSpacing: 0.4,
            marginBottom: 4,
          }}
        >
          THEMEPULSE
        </div>
        <div style={{ fontSize: 11, color: ARIA.textMuted, fontFamily: "monospace", marginBottom: 20 }}>
          {status === "checking" ? "Verifying session…" : "Enter PIN to access dashboard"}
        </div>
        {status === "locked" && (
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input
              ref={inputRef}
              type="password"
              autoComplete="current-password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="PIN"
              style={{
                width: "100%",
                fontSize: 14,
                padding: "9px 12px",
                background: ARIA.bg,
                border: `1px solid ${ARIA.border}`,
                borderRadius: 6,
                color: ARIA.text,
                fontFamily: "monospace",
                textAlign: "center",
                letterSpacing: 3,
                outline: "none",
              }}
            />
            <button
              type="submit"
              disabled={busy}
              style={{
                width: "100%",
                padding: "9px 12px",
                background: "rgba(13,145,99,0.16)",
                border: `1px solid ${ARIA.green}`,
                color: ARIA.green,
                borderRadius: 6,
                cursor: busy ? "default" : "pointer",
                fontFamily: "monospace",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.8,
                textTransform: "uppercase",
              }}
            >
              {busy ? "Unlocking…" : "🔒 Unlock"}
            </button>
            {err && (
              <div style={{ fontSize: 10, color: ARIA.red, fontFamily: "monospace", lineHeight: 1.4 }}>
                {err}
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

function LockButton({ ARIA }) {
  return (
    <button
      onClick={() => setAuthToken("")}
      title="Lock dashboard and clear session token"
      style={{
        background: "transparent",
        border: `1px solid ${ARIA.border}`,
        color: ARIA.textDim,
        padding: "4px 8px",
        borderRadius: 4,
        cursor: "pointer",
        fontFamily: "monospace",
        fontSize: 10,
        letterSpacing: 0.4,
      }}
    >
      🔒 Lock
    </button>
  );
}

function AppMain() {
  // ── ALL hooks must be at the top, before any conditional return ────────
  // Phase 2.7 had useMemo(stockMap) AFTER the data.loading early return,
  // which caused React error #310 ("Rendered more hooks than during the
  // previous render") on the loading→loaded transition.
  const ARIA = useAriaTheme();
  const { themeMode, toggleTheme, zoom, changeZoom } = useAriaThemeControls();
  const data = useDashboardData();
  const { quotes: indexQuotes } = useLiveQuotes(LEAD_INDEX_TICKERS);
  // Active ticker & top-level view: URL query (?view=...&ticker=...) takes precedence over localStorage.
  const [chartTicker, setChartTicker] = useState(() => {
    try {
      const q = (new URLSearchParams(window.location.search).get("ticker") || "").trim().toUpperCase();
      if (/^[A-Z][A-Z0-9.\-]{0,11}$/.test(q)) return q;
    } catch {}
    return localStorage.getItem("themepulse-chart-ticker") || "QQQ";
  });
  const [mainView, setMainView] = useState(() => {
    const valid = (x) => x === "lead" || x === "zanger" || x === "scanner" || x === "brief";
    try {
      const qv = (new URLSearchParams(window.location.search).get("view") || "").trim().toLowerCase();
      if (valid(qv)) return qv;
    } catch {}
    const v = localStorage.getItem("themepulse-view");
    return valid(v) ? v : "lead";
  });
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("view", mainView);
      if (chartTicker) url.searchParams.set("ticker", chartTicker);
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch {}
  }, [mainView, chartTicker]);
  const switchView = useCallback((v) => {
    setMainView(v);
    try { localStorage.setItem("themepulse-view", v); } catch {}
  }, []);
  const handleTickerClick = useCallback((ticker) => {
    if (!ticker) return;
    setChartTicker(ticker);
    try { localStorage.setItem("themepulse-chart-ticker", ticker); } catch {}
  }, []);

  // Listen for ETF pill clicks from the Themes view (or anywhere else
  // that wants to load a chart without prop-drilling).
  // Also catches postMessage from chain/leaderboard iframes.
  useEffect(() => {
    const onOpen = (e) => {
      const t = (e && e.detail && String(e.detail).toUpperCase()) || "";
      if (t) handleTickerClick(t);
    };
    const onMsg = (e) => {
      if (e?.data?.type === "tp-open-chart" && e.data.ticker) {
        handleTickerClick(String(e.data.ticker).toUpperCase());
      }
    };
    window.addEventListener("tp-open-chart", onOpen);
    window.addEventListener("message", onMsg);
    return () => {
      window.removeEventListener("tp-open-chart", onOpen);
      window.removeEventListener("message", onMsg);
    };
  }, [handleTickerClick]);

  // Framework scores (Execution & Integrity Framework) — loaded from static JSON.
  const [frameworkScoresRaw, setFrameworkScoresRaw] = useState({});
  useEffect(() => {
    fetch("/data/framework_scores.json", { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.scores) setFrameworkScoresRaw(d.scores); })
      .catch(() => {});
  }, []);

  // stockMap depends on data.pipeline.stocks. Compute it BEFORE the early
  // returns so the hook count is stable across loading→loaded transitions.
  const stocks = useMemo(() => data.pipeline?.stocks || [], [data.pipeline?.stocks]);
  const stockMap = useMemo(() => {
    const m = {};
    stocks.forEach((s) => {
      if (s.ticker) m[s.ticker] = s;
    });
    Object.entries(frameworkScoresRaw).forEach(([ticker, score]) => {
      if (m[ticker]) m[ticker].framework_score = score;
    });
    // Delayed-Entry readiness (Wiedmaier): stamp de_ready/de_trigger from the
    // EP scanner's consolidation analysis so every table can flag stalkable
    // gappers (2-7d post-gap, tight closes, narrowing range, holding 4-EMA).
    (data.pipeline?.ep_signals || []).forEach((sig) => {
      const c = sig?.consol;
      if (c?.de_ready && m[sig.ticker]) {
        m[sig.ticker].de_ready = true;
        m[sig.ticker].de_trigger = c.de_trigger ?? null;
        m[sig.ticker].de_days = c.days_since ?? null;
        m[sig.ticker].de_hold = c.gap_hold_label || null;      // HELD / BASING / FADING
        m[sig.ticker].de_hold_score = c.gap_hold_score ?? null; // 0-5
      }
    });
    // Catalyst headlines (09h scrape) — stamp the top few per ticker so every
    // table row / the drawer can answer "why did this move?" without a fetch.
    const hl = data.pipeline?.headlines || {};
    Object.entries(hl).forEach(([t, v]) => {
      const arr = v?.headlines;
      if (m[t] && Array.isArray(arr) && arr.length) m[t]._newsPipe = arr.slice(0, 4);
    });
    // Mover EP-quality (earnings/SIP movers) — which gappers are worth stalking.
    const _allMovers = [...(data.pipeline?.earnings_movers || []), ...(data.pipeline?.pm_sip_movers || []), ...(data.pipeline?.ah_sip_movers || [])];
    _allMovers.forEach((mv) => {
      if (mv?.ticker && m[mv.ticker] && mv.ep_quality_label) {
        m[mv.ticker]._epq = mv.ep_quality_label;
        m[mv.ticker]._epSizing = mv.sizing_guide || null;
      }
    });
    // "In play" set — mirrors the ⚡ In Play subtab (top-15 in-universe movers by
    // EP quality) so tables can gold-flag the catalyst glyph for stalkable names.
    const _qOrd = { GENUINE: 5, ELITE: 4, EXPLOSIVE: 4, STRONG: 3, DECENT: 2, WEAK: 1 };
    _allMovers
      .filter((mv) => mv.in_universe && mv.ticker)
      .sort((a, b) => (_qOrd[b.ep_quality_label] || 0) - (_qOrd[a.ep_quality_label] || 0) || Math.abs(b.change_pct || 0) - Math.abs(a.change_pct || 0))
      .slice(0, 15)
      .forEach((mv) => { if (m[mv.ticker]) m[mv.ticker]._inPlay = true; });
    return m;
  }, [stocks, frameworkScoresRaw, data.pipeline?.ep_signals, data.pipeline?.headlines, data.pipeline?.earnings_movers, data.pipeline?.pm_sip_movers, data.pipeline?.ah_sip_movers]);
  // 🔔 Trade alerts (portfolio + focus, RTH): DE trigger breaks, BO firing, DIST on holdings
  const tradeAlerts = useTradeAlerts(stockMap);

  // ── Now safe to do conditional early returns ───────────────────────────
  if (data.loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: ARIA.bg,
          color: ARIA.textDim,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "monospace",
          fontSize: 12,
        }}
      >
        Loading pipeline…
      </div>
    );
  }

  if (data.error) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: ARIA.bg,
          color: ARIA.red,
          padding: 24,
          fontFamily: "monospace",
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700 }}>{data.error}</div>
        <div style={{ fontSize: 11, color: ARIA.textDim, marginTop: 6 }}>
          Pipeline data is required. Check that /dashboard_data.json exists.
        </div>
        <button
          onClick={data.retry}
          style={{
            marginTop: 12,
            padding: "6px 14px",
            background: "rgba(13,145,99,0.14)",
            border: `1px solid ${ARIA.green}`,
            color: ARIA.green,
            borderRadius: 4,
            cursor: "pointer",
            fontFamily: "monospace",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: ARIA.vignette || ARIA.bg,
        backgroundAttachment: "fixed",
        color: ARIA.text,
        fontFamily:
          "'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
      }}
    >
      <AlertsBell alerts={tradeAlerts} onTicker={handleTickerClick} ARIA={ARIA} />
      {/* Topbar */}
      <div
        className="tp-topbar"
        style={{
          display: "flex",
          flexWrap: "wrap",
          rowGap: 6,
          alignItems: "center",
          padding: "10px 24px",
          background: ARIA.bgCard,
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          borderBottom: `1px solid ${ARIA.border}`,
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <div
          className="tp-wordmark"
          style={{
            fontSize: 16,
            fontWeight: 800,
            backgroundImage: `linear-gradient(135deg, ${ARIA.brand1 || ARIA.green}, ${ARIA.brand2 || ARIA.cyan})`,
            letterSpacing: 0.2,
          }}
        >
          THEMEPULSE{" "}
          <span
            style={{
              WebkitTextFillColor: ARIA.textMuted,
              fontWeight: 400,
              fontSize: 11,
            }}
          >
            Trading Dashboard
          </span>
        </div>
        {/* View switcher */}
        <div style={{ display: "flex", gap: 2, marginLeft: 18 }}>
          {[["lead", "LEADERS"], ["zanger", "ZANGER"], ["scanner", "SCANNER"], ["brief", "BRIEF"]].map(([v, label]) => (
            <button key={v} onClick={() => switchView(v)}
              style={{
                background: mainView === v ? "rgba(13,145,99,0.14)" : "transparent",
                border: `1px solid ${mainView === v ? ARIA.green : ARIA.border}`,
                color: mainView === v ? ARIA.green : ARIA.textDim,
                padding: "3px 10px", borderRadius: 4, cursor: "pointer",
                fontFamily: "monospace", fontSize: 9, fontWeight: 700, letterSpacing: 0.6,
              }}>{label}</button>
          ))}
        </div>
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span
            style={{ color: isPipelineStale(data.pipeline?.date) ? "#f59e0b" : ARIA.textMuted, fontSize: 10 }}
            title={isPipelineStale(data.pipeline?.date) ? "Pipeline data is more than 2 trading days old — check GitHub Actions" : undefined}
          >
            {stocks.length.toLocaleString()} stocks · {data.pipeline?.date || ""}
            {isPipelineStale(data.pipeline?.date) && (
              <span
                style={{
                  marginLeft: 6,
                  padding: "1px 5px",
                  borderRadius: 3,
                  background: "rgba(245,158,11,0.16)",
                  border: "1px solid rgba(245,158,11,0.45)",
                  color: "#f59e0b",
                  fontFamily: "monospace",
                  fontSize: 9,
                  fontWeight: 700,
                }}
              >
                STALE
              </span>
            )}
          </span>
          <LockButton ARIA={ARIA} />
          <button
            onClick={toggleTheme}
            title={`Switch to ${themeMode === "dark" ? "light" : "dark"} mode`}
            style={{
              background: "transparent",
              border: `1px solid ${ARIA.border}`,
              color: ARIA.textDim,
              padding: "4px 10px",
              borderRadius: 4,
              cursor: "pointer",
              fontFamily: "monospace",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            {themeMode === "dark" ? "Light" : "Dark"}
          </button>
          {/* A-/A+ text size buttons (Aria-faithful, persisted) */}
          <div style={{ display: "flex" }}>
            <button
              onClick={() => changeZoom(-1)}
              title="Decrease text size"
              style={{
                background: "transparent",
                border: `1px solid ${ARIA.border}`,
                borderRight: "none",
                color: ARIA.textDim,
                padding: "4px 6px",
                borderRadius: "4px 0 0 4px",
                cursor: "pointer",
                fontFamily: "monospace",
                fontSize: 10,
                letterSpacing: 1,
              }}
            >
              A-
            </button>
            <button
              onClick={() => changeZoom(1)}
              title="Increase text size"
              style={{
                background: "transparent",
                border: `1px solid ${ARIA.border}`,
                color: ARIA.textDim,
                padding: "4px 6px",
                borderRadius: "0 4px 4px 0",
                cursor: "pointer",
                fontFamily: "monospace",
                fontSize: 10,
                letterSpacing: 1,
              }}
            >
              A+
            </button>
          </div>
          <span
            style={{
              fontSize: 9,
              color: ARIA.textMuted,
              fontFamily: "monospace",
              minWidth: 28,
              textAlign: "right",
            }}
            title="Current zoom level"
          >
            {Math.round(zoom * 100)}%
          </span>
        </div>
      </div>

      {/* Main content — Aria-faithful layout */}
      <div
        style={{
          padding: "12px 16px",
          // full window width (was capped at 1600px, leaving empty margins on wide screens)
          margin: "0 auto",
          zoom: zoom,
        }}
      >
        <ErrorBoundary>
          <LeadershipView
            view={mainView}
            ARIA={ARIA}
            indexQuotes={indexQuotes}
            pipeline={data.pipeline}
            stockMap={stockMap}
            chartTicker={chartTicker}
            onTickerClick={handleTickerClick}
            chartSlot={
              <ChartPanelInline
                ticker={chartTicker}
                onTickerChange={handleTickerClick}
                stockMap={stockMap}
              />
            }
          />
        </ErrorBoundary>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Root export
// ──────────────────────────────────────────────────────────────────────────

export default function App() {
  const [themeMode, setThemeMode] = useState(
    () => localStorage.getItem("themepulse-theme") || "dark"
  );
  const toggleTheme = useCallback(() => {
    setThemeMode((m) => {
      const next = m === "dark" ? "light" : "dark";
      try { localStorage.setItem("themepulse-theme", next); } catch {}
      return next;
    });
  }, []);
  // Aria-style A-/A+ text size zoom (CSS zoom property, persisted in localStorage)
  const [zoom, setZoom] = useState(() => {
    const z = parseFloat(localStorage.getItem("themepulse-zoom") || "1");
    return Number.isFinite(z) && z >= 0.5 && z <= 2 ? z : 1;
  });
  const changeZoom = useCallback((dir) => {
    setZoom((cur) => {
      let next = Math.round((cur + dir * 0.05) * 100) / 100;
      if (next < 0.5) next = 0.5;
      if (next > 2) next = 2;
      try { localStorage.setItem("themepulse-zoom", String(next)); } catch {}
      return next;
    });
  }, []);

  const ARIA = themeMode === "light" ? ARIA_LIGHT : ARIA_DARK;
  // Set body bg so the area outside the maxWidth container also flips
  useEffect(() => {
    document.body.style.background = ARIA.bg;
  }, [ARIA.bg]);
  const ctxValue = useMemo(
    () => ({ ARIA, themeMode, toggleTheme, zoom, changeZoom }),
    [ARIA, themeMode, toggleTheme, zoom, changeZoom]
  );
  return (
    <AriaThemeContext.Provider value={ctxValue}>
      <ErrorBoundary>
        <AuthGate>
          <AppMain />
        </AuthGate>
      </ErrorBoundary>
    </AriaThemeContext.Provider>
  );
}
