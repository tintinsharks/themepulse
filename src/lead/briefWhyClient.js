// Shared on-demand client + 30-min synced cache for POST /api/brief-why.
// Keeps WrittenBrief (Brief.jsx) and Breakouts & Intraday Volume Movers (ZangerBriefSection.jsx)
// synchronized via localStorage + CustomEvent so both views share one Gemini web-grounded call.

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "../utils.js";

export const BRIEF_WHY_CACHE_KEY = "tp-brief-why-cache-v1";
export const BRIEF_WHY_SYNC_EVENT = "tp-brief-why-sync";
export const BRIEF_WHY_TTL_MS = 30 * 60 * 1000;

export function readBriefWhyCache(nowMs = Date.now()) {
  try {
    const raw = JSON.parse(localStorage.getItem(BRIEF_WHY_CACHE_KEY) || "null");
    if (!raw || typeof raw !== "object" || !raw.data || typeof raw.ts !== "number") return null;
    if (nowMs - raw.ts >= BRIEF_WHY_TTL_MS) return null;
    return raw;
  } catch {
    return null;
  }
}

export function writeBriefWhyCache(data, nowMs = Date.now()) {
  const entry = { ts: nowMs, data };
  try {
    localStorage.setItem(BRIEF_WHY_CACHE_KEY, JSON.stringify(entry));
  } catch { /* ignore quota / private mode */ }
  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(BRIEF_WHY_SYNC_EVENT, { detail: entry }));
    }
  } catch { /* ignore */ }
  return entry;
}

export function clearBriefWhyCache() {
  try {
    localStorage.removeItem(BRIEF_WHY_CACHE_KEY);
  } catch { /* ignore */ }
  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(BRIEF_WHY_SYNC_EVENT, { detail: null }));
    }
  } catch { /* ignore */ }
}

/**
 * Normalize a buildGoToBriefingAnalysis() result into the compact payload
 * accepted by POST /api/brief-why.
 */
export function buildBriefWhyPayload({
  date = "",
  session = "intraday",
  macro = null,
  analysis = null,
  force = false,
} = {}) {
  const clusters = (analysis?.themeClusters || []).slice(0, 6).map((c) => ({
    theme: c.theme,
    count: c.count,
    aPlusACount: c.aPlusACount,
    avgChg: c.avgChg,
    avgZvr: c.avgZvr,
    breakoutCount: c.breakoutCount,
    pp2Count: c.pp2Count,
    rotationStatus: c.rotationStatus,
    rankNow: c.rankNow,
    subLayers: (c.subLayers || []).slice(0, 3),
    topTickers: (c.topTickers || []).slice(0, 5),
    catalysts: (c.catalysts || []).slice(0, 2).map((h) => ({ ticker: h.ticker, title: h.title })),
  }));

  const topLeaders = (analysis?.leaders || []).slice(0, 8).map((m) => ({
    ticker: m.ticker,
    grade: m.grade,
    aPlusScore: m.aPlusScore,
    theme: m.theme,
    layer: m.layer,
    chg: m.chg,
    zvr: m.zvr,
    cr: m.cr,
    rs: m.rs,
    ppCount: m.ppCount,
    earningsDays: m.earningsDays,
    topHeadline: m.topHeadline || null,
  }));

  return { date, session, macro, clusters, topLeaders, force: Boolean(force) };
}

export function useBriefWhy() {
  const [entry, setEntry] = useState(() => readBriefWhyCache());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onSync = (e) => {
      setEntry(e?.detail || null);
      if (e?.detail) setError(null);
    };
    const onStorage = (e) => {
      if (e.key === BRIEF_WHY_CACHE_KEY) {
        setEntry(readBriefWhyCache());
      }
    };
    window.addEventListener(BRIEF_WHY_SYNC_EVENT, onSync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(BRIEF_WHY_SYNC_EVENT, onSync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const run = useCallback(async (params) => {
    const payload = params?.clusters ? params : buildBriefWhyPayload(params);
    if (!payload.clusters?.length) {
      setError("No matched theme clusters on screen to analyze.");
      return null;
    }
    setLoading(true);
    setError(null);
    try {
      const resp = await authFetch("/api/brief-why", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok || !json?.ok) {
        const msg = json?.message || (resp.status === 401
          ? "Sign in with your ThemePulse PIN to run AI analysis."
          : `AI analysis failed (${resp.status}).`);
        setError(msg);
        return null;
      }
      const saved = writeBriefWhyCache(json);
      setEntry(saved);
      return json;
    } catch {
      setError("Network error contacting /api/brief-why.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    clearBriefWhyCache();
    setEntry(null);
    setError(null);
  }, []);

  const data = entry?.data || null;
  const updatedAt = entry?.ts || null;

  return { data, loading, error, updatedAt, run, clear };
}
