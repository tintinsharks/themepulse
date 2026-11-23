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

import { useEffect, useState, useCallback } from "react";
import { authFetch } from "../utils.js";
import { mergeTrades, applyClearTombstone, newestStamp } from "../wheelTrades.js";

const SERVER_STATE_KEY = "themepulse-server-state";
const SERVER_DEBOUNCE_MS = 1500;
const ANALYZED_TTL_MS = 7 * 24 * 60 * 60 * 1000; // mirrors server-side filter
const ANALYZED_MAX = 50;

export function emptyServerState() {
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

export function mergeListOps(a, b) {
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
export function applyListOps(field, list, ops) {
  if (!ops) return list || [];
  return (list || []).filter((t) => ops[`${field}:${t}`]?.op !== "del");
}

// Record adds/removes by diffing a list mutation.
export function opsForChange(field, prev, next, ops) {
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

export async function _pushToServer() {
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

export function _pullFromServer() {
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

export function useServerState() {
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

// Cross-component pub/sub for portfolio + watchlist sync. Whenever any
// component mutates `themepulse-portfolio` or `themepulse-watchlist` in
// localStorage, it dispatches `tp-pw-changed` so all subscribers re-read.
export function useLocalStorageList(key) {
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
