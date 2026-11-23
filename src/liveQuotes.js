// Centralized, freshness-aware live quote store shared across all views
// (index bar, chart panel, trade alerts, intraday scan, flagged tab, layer
// members, and hourly live RS). Coalesces overlapping tickers and concurrent
// requests so /api/live?universe=... is never called redundantly.

import { authFetch } from "./utils.js";

/** Return market session phase in ET: "rth" | "ext" | "off" */
export function marketPhase(now = new Date()) {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return "off";
  const mins = et.getHours() * 60 + et.getMinutes();
  if (mins >= 570 && mins <= 960) return "rth";
  if ((mins >= 240 && mins < 570) || (mins > 960 && mins <= 1200)) return "ext";
  return "off";
}

async function defaultBatchFetcher(batch) {
  const r = await authFetch(`/api/live?universe=${encodeURIComponent(batch.join(","))}`);
  if (!r.ok) return [];
  const d = await r.json();
  return d?.theme_universe || d?.universe || [];
}

/**
 * Factory for the shared quote store (dependency-injected for unit tests).
 */
export function createQuoteStore({
  fetcher = defaultBatchFetcher,
  now = () => Date.now(),
  phase = () => marketPhase(new Date(now())),
  isHidden = () => typeof document !== "undefined" && document.hidden,
  maxBatch = 500,
} = {}) {
  const cache = new Map();      // ticker -> { quote, ts }
  const inflight = new Map();   // ticker -> Promise<void>
  const subs = new Map();       // id -> { tickers: Set, rthMs, extMs, offMs, lastFetchMs }
  const listeners = new Set();  // () => void
  let nextId = 0;
  let updated = null;
  let timer = null;
  let visBound = false;

  const notify = () => {
    listeners.forEach((fn) => {
      try { fn(); } catch { /* isolate listener errors */ }
    });
  };

  const getMap = (tickers) => {
    const m = new Map();
    for (const t of tickers || []) {
      const hit = cache.get(t);
      if (hit) m.set(t, hit.quote);
    }
    return m;
  };

  /**
   * Fetch quotes for `tickers`, skipping any cached entry newer than `maxAgeMs`
   * and coalescing any tickers already in-flight. Returns Map<ticker, quote>.
   */
  async function fetchQuotes(tickers, { maxAgeMs = 25000, force = false } = {}) {
    const unique = [...new Set((tickers || []).filter(Boolean))];
    if (!unique.length) return new Map();

    const tNow = now();
    const waitPromises = new Set();
    const toFetch = [];

    for (const t of unique) {
      if (inflight.has(t)) {
        waitPromises.add(inflight.get(t));
        continue;
      }
      const hit = cache.get(t);
      if (!force && hit && tNow - hit.ts < maxAgeMs) continue;
      toFetch.push(t);
    }

    if (toFetch.length) {
      const chunks = [];
      for (let i = 0; i < toFetch.length; i += maxBatch) {
        chunks.push(toFetch.slice(i, i + maxBatch));
      }

      const batchPromise = Promise.all(
        chunks.map(async (chunk) => {
          try {
            const arr = await fetcher(chunk);
            const stamp = now();
            let got = 0;
            for (const q of arr || []) {
              if (q?.ticker) {
                cache.set(q.ticker, { quote: q, ts: stamp });
                got++;
              }
            }
            return got;
          } catch {
            return 0;
          }
        })
      ).then((counts) => {
        const total = counts.reduce((a, b) => a + b, 0);
        if (total > 0) {
          updated = new Date(now());
          notify();
        }
      }).finally(() => {
        for (const t of toFetch) {
          if (inflight.get(t) === batchPromise) inflight.delete(t);
        }
      });

      for (const t of toFetch) inflight.set(t, batchPromise);
      waitPromises.add(batchPromise);
    }

    if (waitPromises.size) await Promise.all(waitPromises);
    return getMap(unique);
  }

  const intervalFor = (sub, p) => {
    if (p === "rth") return sub.rthMs;
    if (p === "ext") return sub.extMs;
    return sub.offMs;
  };

  let burstTimer = null;
  const scheduleBurst = () => {
    if (burstTimer) return;
    burstTimer = setTimeout(() => {
      burstTimer = null;
      pollDue(true);
    }, 150);
  };

  async function pollDue(includeUncached = false) {
    if (isHidden() || subs.size === 0) return;
    const tNow = now();
    const p = phase();
    const dueTickers = new Set();
    let minAge = Infinity;

    for (const sub of subs.values()) {
      const iv = intervalFor(sub, p);
      const isDue = iv > 0 && tNow - sub.lastFetchMs >= iv - 500;
      if (isDue) {
        sub.lastFetchMs = tNow;
        minAge = Math.min(minAge, Math.max(5000, iv - 5000));
        for (const t of sub.tickers) dueTickers.add(t);
      } else if (includeUncached) {
        let missing = false;
        for (const t of sub.tickers) {
          if (!cache.has(t)) { dueTickers.add(t); missing = true; }
        }
        if (missing) minAge = Math.min(minAge, 25000);
      }
    }

    if (dueTickers.size) {
      await fetchQuotes([...dueTickers], { maxAgeMs: Number.isFinite(minAge) ? minAge : 25000 });
    }
  }

  const scheduleNext = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (subs.size === 0) return;
    const tNow = now();
    const p = phase();
    let wait = 60000;
    for (const sub of subs.values()) {
      const iv = intervalFor(sub, p);
      if (iv > 0) {
        const rem = Math.max(1000, iv - (tNow - sub.lastFetchMs));
        if (rem < wait) wait = rem;
      }
    }
    timer = setTimeout(async () => {
      timer = null;
      await pollDue(false);
      scheduleNext();
    }, wait);
  };

  const onVis = () => {
    if (!isHidden() && subs.size > 0) {
      pollDue(true).then(scheduleNext);
    }
  };

  const ensureVisibility = () => {
    if (visBound || typeof document === "undefined") return;
    document.addEventListener("visibilitychange", onVis);
    visBound = true;
  };

  const cleanupVisibility = () => {
    if (!visBound || subs.size > 0 || typeof document === "undefined") return;
    document.removeEventListener("visibilitychange", onVis);
    visBound = false;
  };

  function register(tickers, { rthMs = 30000, extMs = 120000, offMs = 0 } = {}) {
    const id = ++nextId;
    const set = new Set((tickers || []).filter(Boolean));
    subs.set(id, { tickers: set, rthMs, extMs, offMs, lastFetchMs: 0 });
    ensureVisibility();
    scheduleBurst();
    scheduleNext();
    return id;
  }

  function update(id, tickers) {
    const sub = subs.get(id);
    if (!sub) return;
    sub.tickers = new Set((tickers || []).filter(Boolean));
    for (const t of sub.tickers) {
      if (!cache.has(t)) { scheduleBurst(); break; }
    }
  }

  function unregister(id) {
    subs.delete(id);
    if (subs.size === 0) {
      if (timer) { clearTimeout(timer); timer = null; }
      if (burstTimer) { clearTimeout(burstTimer); burstTimer = null; }
      cleanupVisibility();
    }
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return {
    cache,
    get: (t) => cache.get(t)?.quote,
    getMap,
    getUpdated: () => updated,
    fetchQuotes,
    register,
    update,
    unregister,
    subscribe,
    _subCount: () => subs.size,
  };
}

export const quoteStore = createQuoteStore();
