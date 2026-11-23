import { useEffect, useMemo, useState } from "react";
import { computeStageDistribution, etClock } from "../lead/math.js";
import { authFetch } from "../utils.js";

// Shared 60s cache for Finviz homepage market_stats (Adv/Dec, New High/Low, >50/200 SMA)
const HP_TTL_MS = 60 * 1000;
let _hpCache = { ts: 0, stats: null, inflight: null };

function fetchHomepageStats() {
  const now = Date.now();
  if (_hpCache.stats && now - _hpCache.ts < HP_TTL_MS) {
    return Promise.resolve(_hpCache.stats);
  }
  if (_hpCache.inflight) return _hpCache.inflight;
  _hpCache.inflight = authFetch("/api/live?homepage=1", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      const ms = d?.homepage?.market_stats;
      if (ms && Object.keys(ms).length > 0) {
        _hpCache = { ts: Date.now(), stats: ms, inflight: null };
        return ms;
      }
      _hpCache.inflight = null;
      return _hpCache.stats;
    })
    .catch(() => {
      _hpCache.inflight = null;
      return _hpCache.stats;
    });
  return _hpCache.inflight;
}

// Deepvue-inspired color tokens (vivid on dark, crisp on light)
const COLORS = {
  blue: "#3b82f6",
  pink: "#ec4899",
  gold: "#eab308",
  slate: "#64748b",
};

const STAGE_COLOR = {
  1: COLORS.slate,
  2: COLORS.blue,
  3: COLORS.gold,
  4: COLORS.pink,
};

function RatioBar({ title, pct, leftLabel, rightLabel, accentColor, trackBg, textColor, mutedColor }) {
  const safePct = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: textColor, letterSpacing: -0.1 }}>{title}</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: accentColor, fontVariantNumeric: "tabular-nums" }}>
          {Number.isFinite(pct) ? `${Math.round(pct)}%` : "—"}
        </span>
      </div>
      <div style={{ height: 8, width: "100%", borderRadius: 999, background: trackBg, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${safePct}%`,
            background: accentColor,
            borderRadius: 999,
            transition: "width 0.35s ease",
          }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontSize: 11, color: mutedColor, fontVariantNumeric: "tabular-nums" }}>
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
    </div>
  );
}

export default function MarketBreadthCard({ A, stockMap, breadth, monitor }) {
  const [slide, setSlide] = useState(0); // 0 = Breadth + Stage Analysis (Deepvue view), 1 = MA Breadth + 4% Movers
  const [liveStats, setLiveStats] = useState(() => _hpCache.stats);
  const [liveAt, setLiveAt] = useState(() => (_hpCache.ts ? new Date(_hpCache.ts) : null));

  useEffect(() => {
    let alive = true;
    const pull = () => {
      fetchHomepageStats().then((ms) => {
        if (alive && ms) {
          setLiveStats(ms);
          setLiveAt(new Date(_hpCache.ts || Date.now()));
        }
      });
    };
    pull();
    const id = setInterval(() => {
      if (!document.hidden && etClock().rth) pull();
    }, HP_TTL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // 1. New Highs vs New Lows: live Finviz full-market -> breadth.json fallback
  const nhNl = useMemo(() => {
    if (liveStats?.new_high?.count != null && liveStats?.new_low?.count != null) {
      const nh = liveStats.new_high.count;
      const nl = liveStats.new_low.count;
      const tot = nh + nl;
      return { nh, nl, pct: tot > 0 ? (nh / tot) * 100 : 0, isLive: true };
    }
    const q = breadth?.conditions?.qulla?.net_hl;
    if (q?.nh != null && q?.nl != null) {
      const tot = q.nh + q.nl;
      return { nh: q.nh, nl: q.nl, pct: tot > 0 ? (q.nh / tot) * 100 : 0, isLive: false };
    }
    return null;
  }, [liveStats, breadth]);

  // 2. Advance vs Decline: live Finviz full-market -> breadth.json ad_history fallback
  const advDec = useMemo(() => {
    if (liveStats?.advancing?.count != null && liveStats?.declining?.count != null) {
      const adv = liveStats.advancing.count;
      const dec = liveStats.declining.count;
      const tot = adv + dec;
      return { adv, dec, pct: tot > 0 ? (adv / tot) * 100 : 0, isLive: true };
    }
    const hist = breadth?.ad_history;
    const last = Array.isArray(hist) && hist.length ? hist[hist.length - 1] : null;
    if (last?.adv != null && last?.dec != null) {
      const tot = last.adv + last.dec;
      return { adv: last.adv, dec: last.dec, pct: tot > 0 ? (last.adv / tot) * 100 : 0, isLive: false };
    }
    return null;
  }, [liveStats, breadth]);

  // 3. Stan Weinstein Stage Analysis (Stages 1-4 across stockMap universe)
  const stageDist = useMemo(() => computeStageDistribution(stockMap), [stockMap]);

  // Contextual tape read (e.g. Ted Zhang's "Junk rally" tell: big Adv% while Stage 4 >= 50% and NH/NL weak)
  const tapeTag = useMemo(() => {
    const s2 = stageDist.stages[1]?.pct ?? 0;
    const s4 = stageDist.stages[3]?.pct ?? 0;
    const advPct = advDec?.pct ?? null;
    const nhPct = nhNl?.pct ?? null;
    if (advPct != null && advPct >= 65 && s4 >= 50 && (nhPct == null || nhPct < 35)) {
      return { label: "Bear-Market / Junk Rally", color: COLORS.pink };
    }
    if (s2 >= 50 && (nhPct == null || nhPct >= 60)) {
      return { label: "Broad Stage 2 Uptrend", color: COLORS.blue };
    }
    if (s4 >= 55) {
      return { label: "Stage 4 Bear Regime", color: COLORS.pink };
    }
    if (s2 >= 35 && s4 <= 35) {
      return { label: "Constructive Breadth", color: A.green };
    }
    return { label: "Mixed / Transitional", color: COLORS.gold };
  }, [stageDist, advDec, nhNl, A.green]);

  // Slide 2: Moving Average Breadth (>20d, >50d, >200d) + Stockbee 4% movers
  const maStats = useMemo(() => {
    const stocks = Object.values(stockMap || {});
    const n = stocks.length;
    const above20 = stocks.filter((s) => (s.sma20_pct ?? -1) > 0).length;
    const above50Local = stocks.filter((s) => s.above_50ma === 1 || (s.sma50_pct ?? -1) > 0).length;
    const above200Local = stocks.filter((s) => (s.sma200_pct ?? -1) > 0).length;

    const s50 = liveStats?.sma50_above?.count != null && liveStats?.sma50_below?.count != null
      ? { above: liveStats.sma50_above.count, below: liveStats.sma50_below.count, pct: liveStats.sma50_above.pct }
      : { above: above50Local, below: Math.max(0, n - above50Local), pct: n > 0 ? (above50Local / n) * 100 : 0 };

    const s200 = liveStats?.sma200_above?.count != null && liveStats?.sma200_below?.count != null
      ? { above: liveStats.sma200_above.count, below: liveStats.sma200_below.count, pct: liveStats.sma200_above.pct }
      : { above: above200Local, below: Math.max(0, n - above200Local), pct: n > 0 ? (above200Local / n) * 100 : 0 };

    const s20 = { above: above20, below: Math.max(0, n - above20), pct: n > 0 ? (above20 / n) * 100 : 0 };

    const cur = monitor?.current;
    const up4 = cur?.up_4pct ?? stocks.filter((s) => (s.change_pct ?? 0) >= 4).length;
    const dn4 = cur?.down_4pct ?? stocks.filter((s) => (s.change_pct ?? 0) <= -4).length;
    const tot4 = up4 + dn4;
    return {
      s20,
      s50,
      s200,
      m4: { up: up4, dn: dn4, pct: tot4 > 0 ? (up4 / tot4) * 100 : 50 },
      t2108: cur?.t2108 ?? null,
      mcclellan: breadth?.conditions?.qulla?.mcclellan?.osc ?? null,
    };
  }, [stockMap, liveStats, monitor, breadth]);

  const isDark = A.bg === "#0a0d12" || A.bg === "#0d1117" || /^#0|^#1/.test(String(A.bg || ""));
  const trackBg = isDark ? "#2d333b" : "#e2e8f0";
  const isLive = Boolean(nhNl?.isLive || advDec?.isLive);

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, padding: "0 2px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: A.text, letterSpacing: 0.1 }}>Market Breadth</span>
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              fontFamily: "monospace",
              padding: "1px 6px",
              borderRadius: 999,
              background: `${tapeTag.color}20`,
              border: `1px solid ${tapeTag.color}66`,
              color: tapeTag.color,
            }}
          >
            {tapeTag.label}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, fontFamily: "monospace", color: A.textMuted }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: isLive ? A.green : A.textMuted }}>
            {isLive && <span className="tp-livedot" style={{ width: 6, height: 6, borderRadius: 3, background: A.green, display: "inline-block" }} />}
            {isLive ? `LIVE${liveAt ? ` · ${liveAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}` : `EOD${breadth?.date ? ` · ${breadth.date}` : ""}`}
          </span>
          <button
            onClick={() => setSlide((s) => (s === 0 ? 1 : 0))}
            style={{
              background: "transparent",
              border: `1px solid ${A.border}`,
              color: A.textDim,
              borderRadius: 4,
              padding: "1px 6px",
              fontSize: 10,
              fontFamily: "monospace",
              cursor: "pointer",
            }}
          >
            {slide === 0 ? "MA Breadth →" : "← Stages"}
          </button>
        </div>
      </div>

      <div
        style={{
          background: A.bgCard,
          border: `1px solid ${A.border}`,
          borderRadius: 12,
          padding: "16px 18px 14px",
        }}
      >
        {slide === 0 ? (
          <>
            <RatioBar
              title="New Highs vs New Lows"
              pct={nhNl?.pct}
              leftLabel={nhNl ? `${nhNl.nh.toLocaleString()} Highs` : "— Highs"}
              rightLabel={nhNl ? `${nhNl.nl.toLocaleString()} Lows` : "— Lows"}
              accentColor={(nhNl?.pct ?? 0) >= 50 ? COLORS.blue : COLORS.pink}
              trackBg={trackBg}
              textColor={A.text}
              mutedColor={A.textMuted}
            />

            <RatioBar
              title="Advance vs Decline"
              pct={advDec?.pct}
              leftLabel={advDec ? `${advDec.adv.toLocaleString()} Advance` : "— Advance"}
              rightLabel={advDec ? `${advDec.dec.toLocaleString()} Decline` : "— Decline"}
              accentColor={(advDec?.pct ?? 0) >= 50 ? COLORS.blue : COLORS.pink}
              trackBg={trackBg}
              textColor={A.text}
              mutedColor={A.textMuted}
            />

            {/* Stan Weinstein Stage Analysis */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: A.text, letterSpacing: -0.1 }}>Stage Analysis</span>
                <span style={{ fontSize: 10, color: A.textMuted, fontFamily: "monospace" }}>
                  {stageDist.total.toLocaleString()} stocks · Weinstein 1–4
                </span>
              </div>
              <div style={{ display: "flex", height: 8, width: "100%", borderRadius: 999, background: trackBg, overflow: "hidden" }}>
                {stageDist.stages.map((st) => (
                  <div
                    key={st.stage}
                    title={`${st.label} (${st.hint}): ${st.count.toLocaleString()} (${st.pct}%)`}
                    style={{
                      width: `${stageDist.total > 0 ? (st.count / stageDist.total) * 100 : 0}%`,
                      background: STAGE_COLOR[st.stage],
                      transition: "width 0.35s ease",
                    }}
                  />
                ))}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                  gap: 8,
                  marginTop: 10,
                }}
              >
                {stageDist.stages.map((st) => (
                  <div key={st.stage} title={`${st.label} — ${st.hint}`}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: A.text }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: STAGE_COLOR[st.stage], flexShrink: 0 }} />
                      <span>{st.label}</span>
                    </div>
                    <div style={{ fontSize: 11, color: A.textMuted, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                      {st.count.toLocaleString()} · <strong style={{ color: A.textDim }}>{st.pct}%</strong>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <RatioBar
              title="Above 20-Day SMA"
              pct={maStats.s20.pct}
              leftLabel={`${maStats.s20.above.toLocaleString()} Above`}
              rightLabel={`${maStats.s20.below.toLocaleString()} Below`}
              accentColor={maStats.s20.pct >= 50 ? COLORS.blue : COLORS.pink}
              trackBg={trackBg}
              textColor={A.text}
              mutedColor={A.textMuted}
            />
            <RatioBar
              title="Above 50-Day SMA"
              pct={maStats.s50.pct}
              leftLabel={`${maStats.s50.above.toLocaleString()} Above`}
              rightLabel={`${maStats.s50.below.toLocaleString()} Below`}
              accentColor={maStats.s50.pct >= 50 ? COLORS.blue : COLORS.pink}
              trackBg={trackBg}
              textColor={A.text}
              mutedColor={A.textMuted}
            />
            <RatioBar
              title="Above 200-Day SMA"
              pct={maStats.s200.pct}
              leftLabel={`${maStats.s200.above.toLocaleString()} Above`}
              rightLabel={`${maStats.s200.below.toLocaleString()} Below`}
              accentColor={maStats.s200.pct >= 50 ? COLORS.blue : COLORS.pink}
              trackBg={trackBg}
              textColor={A.text}
              mutedColor={A.textMuted}
            />
            <RatioBar
              title="Stockbee 4% Movers"
              pct={maStats.m4.pct}
              leftLabel={`${maStats.m4.up.toLocaleString()} Up 4%+`}
              rightLabel={`${maStats.m4.dn.toLocaleString()} Down 4%+`}
              accentColor={maStats.m4.pct >= 50 ? COLORS.blue : COLORS.pink}
              trackBg={trackBg}
              textColor={A.text}
              mutedColor={A.textMuted}
            />
            {(maStats.t2108 != null || maStats.mcclellan != null) && (
              <div style={{ display: "flex", gap: 14, fontSize: 11, fontFamily: "monospace", color: A.textMuted }}>
                {maStats.t2108 != null && <span>T2108 <strong style={{ color: A.text }}>{maStats.t2108}%</strong></span>}
                {maStats.mcclellan != null && (
                  <span>McClellan Osc <strong style={{ color: maStats.mcclellan >= 0 ? COLORS.blue : COLORS.pink }}>{maStats.mcclellan > 0 ? `+${maStats.mcclellan}` : maStats.mcclellan}</strong></span>
                )}
              </div>
            )}
          </>
        )}

        {/* Carousel dots matching the Deepvue widget */}
        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 12 }}>
          {[0, 1].map((i) => (
            <button
              key={i}
              aria-label={i === 0 ? "Breadth & Stage Analysis" : "Moving Average Breadth"}
              onClick={() => setSlide(i)}
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                padding: 0,
                cursor: "pointer",
                background: slide === i ? A.textMuted : "transparent",
                border: `1.5px solid ${A.textMuted}`,
                opacity: slide === i ? 0.95 : 0.45,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
