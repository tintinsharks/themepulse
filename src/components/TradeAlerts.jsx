// ── Trade alerts: polls live quotes for portfolio ∪ focus during RTH and fires
// when (a) a name crosses its DE trigger, (b) a focus/held name fires BO
// conditions, (c) a PORTFOLIO name shows heavy distribution. Deduped per
// ticker+type per day; optional desktop notifications. Signal-free.

import { useEffect, useState } from "react";
import { quoteStore } from "../liveQuotes.js";
import { closingRange } from "../lead/math.js";
import { useLocalStorageList } from "../hooks/useUserData.js";

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

export function useTradeAlerts(stockMap) {
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

export function AlertsBell({ alerts, onTicker, ARIA }) {
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
