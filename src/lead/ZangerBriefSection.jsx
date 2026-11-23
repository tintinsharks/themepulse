import { useEffect, useState } from "react";
import { Card, CopyTickersBtn, EPS_TIP, FlagButton, TierMark, td, th } from "./core.jsx";

const BRIEF_DIR = "/data/briefs/";

const BO_COLORS = {
  ZANGER: "#fbbf24",
  "SB4%": "#4ade80",
  "SB$": "#38bdf8",
  QMAG: "#c084fc",
};

const fmtPct = (v, dg = 1) =>
  typeof v === "number" && Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(dg)}%` : "—";

const fmtVol = (v) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return "—";
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}K`;
  return String(Math.round(v));
};

export default function ZangerBriefSection({ A, onTicker, chartTicker }) {
  const [index, setIndex] = useState(null);
  const [sel, setSel] = useState(null);
  const [snap, setSnap] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let live = true;
    fetch(`${BRIEF_DIR}zanger-index.json?t=${Date.now()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((ix) => {
        if (!live) return;
        const list = Array.isArray(ix?.briefs) ? ix.briefs : [];
        setIndex(list);
        setSel(list[0]?.file || ix?.latest || "zanger-latest.json");
      })
      .catch(() => {
        if (!live) return;
        setIndex([]);
        setSel("zanger-latest.json");
      });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!sel || !/^zanger-[a-z0-9_-]+\.json$/i.test(sel)) return;
    let live = true;
    fetch(`${BRIEF_DIR}${sel}?t=${Date.now()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => { if (live) { setSnap(d); setErr(null); } })
      .catch(() => { if (live) setErr("No Zanger briefing published yet."); });
    return () => { live = false; };
  }, [sel]);

  const pc = (v) => (typeof v !== "number" ? A.textMuted : v >= 0 ? A.green : A.red);
  const rsC = (v) => (v >= 90 ? A.green : v >= 70 ? A.yellow : typeof v === "number" ? A.red : A.textMuted);
  const epsC = (v) => (v >= 80 ? A.green : v >= 50 ? A.yellow : typeof v === "number" ? A.red : A.textMuted);

  const Tk = ({ t }) => (
    <span
      onClick={(e) => { e.stopPropagation(); onTicker && onTicker(t); }}
      style={{ cursor: "pointer", fontFamily: "monospace", fontWeight: 700, color: chartTicker === t ? A.green : A.text }}
    >
      {t}
    </span>
  );

  const picker = (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      {index && index.length > 0 && (
        <select
          value={sel || ""}
          onChange={(e) => setSel(e.target.value)}
          style={{
            background: A.bg,
            color: A.text,
            border: `1px solid ${A.border}`,
            borderRadius: 4,
            fontSize: 11,
            padding: "2px 6px",
            maxWidth: 270,
            fontFamily: "monospace",
          }}
        >
          {index.map((b) => (
            <option key={b.id || b.file} value={b.file}>
              {b.label || b.et || b.id} ({b.breakoutCount ?? 0} BO)
            </option>
          ))}
        </select>
      )}
    </div>
  );

  if (err && !snap) {
    return (
      <Card A={A} title="Zanger & Leadership Briefing" sub="Auto-updated hourly during market hours + 8:30 AM ET pre-market" right={picker}>
        <div style={{ fontSize: 11, color: A.textMuted }}>{err}</div>
      </Card>
    );
  }
  if (!snap) {
    return (
      <Card A={A} title="Zanger & Leadership Briefing" right={picker}>
        <div style={{ fontSize: 11, color: A.textMuted }}>Loading latest Zanger briefing…</div>
      </Card>
    );
  }

  const mkt = snap.market || {};
  const movers = snap.zangerMovers || [];
  const bos = movers.filter((m) => m.isBreakout);
  const ph = snap.phase || { id: "midday", label: "INTRADAY UPDATE", subtitle: "", accent: A.green };
  const dec = mkt.decision;
  const decColor = dec === "YES" ? A.green : dec === "CAUTION" ? "#f59e0b" : A.red;
  const futures = mkt.futures || [];
  const portAlerts = snap.portfolioAlerts || {};
  const portEarnings = snap.portfolioEarnings || [];
  const epMovers = snap.epMovers || [];
  const themeFlow = snap.themeFlow || {};
  const dmg = snap.leaderDamage || {};
  const onDeck = snap.onDeckRsl || [];
  const faded = snap.delta?.fadedBreakouts || [];
  const holdRate = snap.delta?.holdRate || null;
  const headlines = snap.headlines || {};

  const boTickers = bos.map((m) => m.ticker);
  const allMoverTickers = movers.map((m) => m.ticker);
  const onDeckTickers = onDeck.map((r) => r.ticker);

  const EpCard = epMovers.length > 0 ? (
    <Card A={A} title="EP / Gap-and-Go Movers" sub="High-momentum catalyst gaps ≥ +3%">
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {epMovers.map((e) => (
          <div key={e.ticker} style={{ fontSize: 11, display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap", borderBottom: `1px solid ${A.border}`, paddingBottom: 4 }}>
            <span style={{ fontSize: 9, fontWeight: 800, fontFamily: "monospace", padding: "1px 5px", borderRadius: 3, background: e.category === "LAVA" ? "rgba(239,68,68,0.18)" : "rgba(245,158,11,0.18)", color: e.category === "LAVA" ? A.red : "#f59e0b" }}>
              {e.category}
            </span>
            <Tk t={e.ticker} />
            <span style={{ color: A.green, fontFamily: "monospace", fontWeight: 700 }}>{fmtPct(e.chg, 1)}</span>
            {e.volume ? <span style={{ color: A.textMuted, fontFamily: "monospace", fontSize: 10 }}>vol {fmtVol(e.volume)}</span> : null}
            {e.headline ? <span style={{ color: A.textDim }}>— {e.headline}</span> : null}
          </div>
        ))}
      </div>
    </Card>
  ) : null;

  return (
    <div style={{ marginTop: 14, borderTop: `2px solid ${A.border}`, paddingTop: 12 }}>
      {/* Header & General Market */}
      <Card
        A={A}
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>Zanger &amp; Leadership Briefing</span>
            <span style={{ fontSize: 9, fontWeight: 800, fontFamily: "monospace", padding: "2px 6px", borderRadius: 4, border: `1px solid ${ph.accent || A.green}`, color: ph.accent || A.green }}>
              {ph.label}
            </span>
            {dec && (
              <span style={{ fontSize: 9, fontWeight: 800, fontFamily: "monospace", padding: "2px 7px", borderRadius: 999, background: `${decColor}22`, border: `1px solid ${decColor}`, color: decColor }}>
                {dec}{mkt.score != null ? ` · ${mkt.score}/100` : ""}{mkt.positionSize ? ` · ${mkt.positionSize}` : ""}
              </span>
            )}
          </span>
        }
        sub={`${snap.stamp?.pretty || ""} · ${snap.mode || ""} · ${bos.length} breakouts · ${movers.length} movers${holdRate ? ` · Hold rate ${holdRate.holding}/${holdRate.totalToday} (${holdRate.pct}%)` : ""}`}
        right={picker}
      >
        {/* 4-Index Strip */}
        {Array.isArray(mkt.indices) && mkt.indices.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 10 }}>
            {mkt.indices.map((idx) => (
              <div
                key={idx.ticker}
                onClick={() => onTicker && onTicker(idx.ticker)}
                style={{ cursor: "pointer", padding: "8px 10px", background: A.bg, border: `1px solid ${A.border}`, borderRadius: 6 }}
              >
                <div style={{ fontSize: 10, color: A.textMuted, fontFamily: "monospace" }}>
                  <strong style={{ color: A.text }}>{idx.ticker}</strong> {idx.name}
                </div>
                <div style={{ marginTop: 2, fontFamily: "monospace", display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: pc(idx.change) }}>{fmtPct(idx.change, 2)}</span>
                  <span style={{ fontSize: 11, color: A.textDim }}>{typeof idx.price === "number" ? idx.price.toFixed(2) : "—"}</span>
                </div>
                <div style={{ fontSize: 10, color: A.textMuted, marginTop: 2 }}>
                  {[idx.cr != null ? `CR ${idx.cr}%` : null, idx.maStatus].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Overnight Futures Strip */}
        {futures.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8, padding: "6px 8px", background: A.bg, border: `1px solid ${A.border}`, borderRadius: 6, fontSize: 10, fontFamily: "monospace" }}>
            <span style={{ color: A.textMuted, fontWeight: 700 }}>FUTURES:</span>
            {futures.map((f) => (
              <span key={f.name} style={{ color: A.textDim }}>
                <strong style={{ color: A.text }}>{f.name}</strong>{" "}
                <span style={{ color: pc(f.changePct), fontWeight: 700 }}>{fmtPct(f.changePct, 2)}</span>
              </span>
            ))}
          </div>
        )}

        {/* Macro / Breadth / Sector Rotation Strip */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 11, color: A.textDim, fontFamily: "monospace", marginBottom: 6 }}>
          {mkt.vix && <span>VIX <strong style={{ color: A.text }}>{mkt.vix.price.toFixed(2)}</strong> ({fmtPct(mkt.vix.change, 1)})</span>}
          {mkt.tnx && <span>10Y <strong style={{ color: A.text }}>{mkt.tnx.price.toFixed(2)}%</strong></span>}
          {mkt.breadth?.pctAbove50 != null && <span>&gt;50MA <strong style={{ color: A.text }}>{mkt.breadth.pctAbove50}%</strong></span>}
          {mkt.breadth?.up4 != null && mkt.breadth?.down4 != null && (
            <span>4% Movers <strong style={{ color: A.green }}>{mkt.breadth.up4}↑</strong> / <strong style={{ color: A.red }}>{mkt.breadth.down4}↓</strong></span>
          )}
          {mkt.breadth?.t2108 != null && <span>T2108 <strong style={{ color: A.text }}>{mkt.breadth.t2108}%</strong></span>}
          {mkt.sectors && (
            <span>
              Sectors <strong style={{ color: A.text }}>{mkt.sectors.positive}/{mkt.sectors.total}</strong> green
              {" · "}Top: <span style={{ color: A.green }}>{mkt.sectors.leaders.map((s) => `${s.ticker} ${fmtPct(s.change, 1)}`).join(", ")}</span>
              {" · "}Lag: <span style={{ color: A.red }}>{mkt.sectors.laggards.map((s) => `${s.ticker} ${fmtPct(s.change, 1)}`).join(", ")}</span>
            </span>
          )}
        </div>

        {/* Market Commentary Bullets */}
        {Array.isArray(mkt.commentary) && mkt.commentary.length > 0 && (
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 11, color: A.text, lineHeight: 1.5 }}>
            {mkt.commentary.map((c, i) => <li key={i} style={{ marginBottom: 3 }}>{c}</li>)}
          </ul>
        )}
      </Card>

      {/* Portfolio & Watchlist Pulse + Upcoming 10d Earnings */}
      {((portAlerts.alerts?.length > 0) || portEarnings.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 10 }}>
          {portAlerts.alerts?.length > 0 && (
            <Card A={A} title="Portfolio & Watchlist Pulse" sub={`${portAlerts.alerts.length} active across ${portAlerts.portfolioCount} holdings / ${portAlerts.watchlistCount} watchlist`}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th(A)}>List</th><th style={th(A)}>Ticker</th>
                    <th style={th(A, "right")}>Chg</th><th style={th(A, "right")}>ZVR</th><th style={th(A, "right")}>CR%</th><th style={th(A)}>Alert</th>
                  </tr>
                </thead>
                <tbody>
                  {portAlerts.alerts.map((a) => (
                    <tr key={a.ticker} onClick={() => onTicker && onTicker(a.ticker)} style={{ cursor: "pointer" }}>
                      <td style={{ ...td(A), fontSize: 10, fontFamily: "monospace", fontWeight: 700, color: a.list === "PORT" ? A.green : A.cyan }}>{a.list}</td>
                      <td style={td(A)}><Tk t={a.ticker} /></td>
                      <td style={{ ...td(A, "right"), color: pc(a.chg), fontFamily: "monospace", fontWeight: 700 }}>{fmtPct(a.chg, 2)}</td>
                      <td style={{ ...td(A, "right"), fontFamily: "monospace" }}>{a.zvr != null ? `${a.zvr.toFixed(1)}x` : "—"}</td>
                      <td style={{ ...td(A, "right"), fontFamily: "monospace" }}>{a.cr != null ? `${a.cr}%` : "—"}</td>
                      <td style={{ ...td(A), fontSize: 10 }}>
                        {(a.tags || []).map((t, i) => (
                          <span key={i} style={{ marginRight: 4, padding: "1px 5px", borderRadius: 3, fontWeight: 700, color: t.tone === "bad" ? A.red : t.tone === "warn" ? "#f59e0b" : A.green, background: A.bg, border: `1px solid ${A.border}` }}>
                            {t.label}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          {portEarnings.length > 0 && (
            <Card A={A} title="Upcoming Earnings (Portfolio & Watchlist · 10d)">
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {portEarnings.map((e) => (
                  <div key={e.ticker} style={{ fontSize: 11, display: "flex", gap: 8, alignItems: "center", borderBottom: `1px solid ${A.border}`, paddingBottom: 4 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, fontFamily: "monospace", color: e.list === "PORT" ? A.green : A.cyan }}>{e.list}</span>
                    <Tk t={e.ticker} />
                    <span style={{ color: A.textDim, fontFamily: "monospace", marginLeft: "auto" }}>
                      {e.display || "—"} {e.timing ? `(${e.timing})` : ""} · <strong style={{ color: e.days <= 2 ? "#f59e0b" : A.text }}>{e.days === 0 ? "Today" : `${e.days}d`}</strong>
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Pre-market / Open elevates EP movers above table */}
      {(ph.id === "premarket" || ph.id === "open") && EpCard}

      {/* Breakouts & Volume Movers Table */}
      <Card
        A={A}
        title="Breakouts & Intraday Volume Movers"
        sub="Zanger · Stockbee 4% / $ · Qullamaggie · click any row to chart"
        right={<CopyTickersBtn A={A} tickers={boTickers.length ? boTickers : allMoverTickers} label={boTickers.length ? "Copy BOs" : "Copy Movers"} />}
      >
        {movers.length === 0 ? (
          <div style={{ fontSize: 11, color: A.textMuted }}>No stocks currently pass breakout or ZVR ≥ 1.5x criteria in this snapshot.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th(A)}>Sig</th>
                  <th style={th(A)}>Ticker</th>
                  <th style={th(A)}>Theme · Layer</th>
                  <th style={th(A, "right")}>ADR</th>
                  <th style={th(A, "right")}>Chg%</th>
                  <th style={th(A, "right")}>ZVR</th>
                  <th style={th(A, "right")}>CR%</th>
                  <th style={th(A, "right")}>RS</th>
                  <th style={th(A, "right")} title={EPS_TIP}>EPS</th>
                  <th style={th(A, "right")}>Off 52wH</th>
                  <th style={th(A, "right")}>Score</th>
                </tr>
              </thead>
              <tbody>
                {movers.map((m) => (
                  <tr
                    key={m.ticker}
                    data-nav={m.ticker}
                    onClick={() => onTicker && onTicker(m.ticker)}
                    style={{ cursor: "pointer", background: chartTicker === m.ticker ? A.bgHover : m.isNew ? "rgba(56,189,248,0.06)" : "transparent" }}
                  >
                    <td style={td(A)}>
                      <span style={{ display: "inline-flex", gap: 3, flexWrap: "wrap" }}>
                        {m.isNew && (
                          <span style={{ fontSize: 9, fontWeight: 800, fontFamily: "monospace", padding: "1px 4px", borderRadius: 3, background: "rgba(56,189,248,0.2)", color: A.cyan, border: `1px solid ${A.cyan}` }}>NEW</span>
                        )}
                        {m.breakoutTypes?.length ? m.breakoutTypes.map((k) => {
                          const c = BO_COLORS[k] || "#fbbf24";
                          return (
                            <span key={k} style={{ fontSize: 9, fontWeight: 700, fontFamily: "monospace", padding: "1px 4px", borderRadius: 3, background: `${c}20`, color: c, border: `1px solid ${c}66` }}>{k}</span>
                          );
                        }) : (
                          <span style={{ fontSize: 9, fontWeight: 700, fontFamily: "monospace", padding: "1px 4px", borderRadius: 3, background: "rgba(34,197,94,0.16)", color: A.green }}>{m.rsl ? "RSL" : "VOL"}</span>
                        )}
                      </span>
                    </td>
                    <td style={td(A)}>
                      <FlagButton t={m.ticker} A={A} />
                      <Tk t={m.ticker} />
                      <TierMark t={m.ticker} />
                      {m.earningsDays != null && m.earningsDays >= 0 && m.earningsDays <= 5 && (
                        <span title={m.earningsDisplay || ""} style={{ marginLeft: 4, fontSize: 9, fontWeight: 700, fontFamily: "monospace", padding: "0 4px", borderRadius: 3, background: "rgba(245,158,11,0.18)", color: "#f59e0b" }}>
                          ER {m.earningsDays}d
                        </span>
                      )}
                    </td>
                    <td style={{ ...td(A), fontSize: 11, color: A.textDim }}>
                      <strong style={{ color: A.text }}>{m.theme}</strong> · {m.layer}
                    </td>
                    <td style={{ ...td(A, "right"), fontFamily: "monospace", color: (m.adr ?? 0) >= 4 ? A.cyan : A.textDim }}>{m.adr != null ? `${m.adr.toFixed(1)}%` : "—"}</td>
                    <td style={{ ...td(A, "right"), fontFamily: "monospace", fontWeight: 700, color: pc(m.chg) }}>
                      {fmtPct(m.chg, 2)}
                      {m.dollarMove != null && m.dollarMove >= 0.9 && (
                        <span style={{ display: "block", fontSize: 9, fontWeight: 500, color: A.cyan }}>+${m.dollarMove.toFixed(2)}</span>
                      )}
                    </td>
                    <td style={{ ...td(A, "right"), fontFamily: "monospace", fontWeight: 700, color: (m.zvr ?? 0) >= 2.5 ? "#fbbf24" : (m.zvr ?? 0) >= 1.8 ? A.green : A.textDim }}>
                      {m.zvr != null ? `${m.zvr.toFixed(2)}x` : "—"}
                    </td>
                    <td style={{ ...td(A, "right"), fontFamily: "monospace", fontWeight: 700, color: m.cr == null ? A.textMuted : m.cr >= 75 ? A.green : m.cr >= 50 ? "#f59e0b" : A.red }}>
                      {m.cr != null ? `${m.cr}%` : "—"}
                    </td>
                    <td style={{ ...td(A, "right"), fontFamily: "monospace", fontWeight: 700, color: rsC(m.rs) }}>{m.rs}</td>
                    <td style={{ ...td(A, "right"), fontFamily: "monospace", color: epsC(m.eps) }}>{m.eps ?? "—"}{m.epsAccel ? <span style={{ color: A.green, fontSize: 9 }}>▲</span> : null}</td>
                    <td style={{ ...td(A, "right"), fontFamily: "monospace", color: (m.off52 ?? -99) >= -5 ? A.green : A.textDim }}>{fmtPct(m.off52, 1)}</td>
                    <td style={{ ...td(A, "right"), fontFamily: "monospace", fontWeight: 800, color: (m.score ?? 0) >= 70 ? "#fbbf24" : A.text }}>{m.score != null ? m.score.toFixed(1) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {faded.length > 0 && (
          <div style={{ marginTop: 8, padding: "6px 10px", background: "rgba(239,68,68,0.1)", border: `1px solid ${A.red}55`, borderRadius: 6, fontSize: 11, color: A.red }}>
            <strong>Faded / Squatted since last hour:</strong>{" "}
            {faded.map((f, i) => (
              <span key={f.ticker}>
                {i > 0 ? " · " : ""}
                <Tk t={f.ticker} /> ({fmtPct(f.chg, 1)}, {f.reason})
              </span>
            ))}
          </div>
        )}

        {/* Catalyst Check */}
        {movers.length > 0 && (
          <div style={{ marginTop: 10, borderTop: `1px solid ${A.border}`, paddingTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: A.text, marginBottom: 4 }}>Catalyst Check (Top Movers)</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: A.textDim, lineHeight: 1.45 }}>
              {movers.slice(0, 8).map((m) => {
                const liveH = headlines[m.ticker];
                const items = liveH?.length ? liveH.map((h) => `${h.title}${h.source ? ` (${h.source})` : ""}`) : (m.pipelineNews || []);
                return (
                  <li key={m.ticker} style={{ marginBottom: 3 }}>
                    <Tk t={m.ticker} /> <span style={{ color: A.textMuted }}>({m.theme}, {fmtPct(m.chg)}, ZVR {m.zvr != null ? `${m.zvr.toFixed(2)}x` : "—"}):</span>{" "}
                    {items.length ? items.join(" | ") : <em>No live headline returned</em>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Card>

      {ph.id !== "premarket" && ph.id !== "open" && EpCard}

      {/* Intraday Theme Money Flow + Leader Damage + On Deck */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
        {themeFlow.hottest?.length > 0 && (
          <Card A={A} title="Today's Theme Money Flow">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th(A)}>Theme</th><th style={th(A, "right")}>Avg</th><th style={th(A, "right")}>% Grn</th><th style={th(A, "right")}>BO</th>
                </tr>
              </thead>
              <tbody>
                {themeFlow.hottest.map((t) => (
                  <tr key={t.theme}>
                    <td style={{ ...td(A), fontWeight: 600 }}>{t.theme}</td>
                    <td style={{ ...td(A, "right"), fontFamily: "monospace", fontWeight: 700, color: pc(t.avgChg) }}>{fmtPct(t.avgChg, 2)}</td>
                    <td style={{ ...td(A, "right"), fontFamily: "monospace", color: A.textDim }}>{t.pctGreen}%</td>
                    <td style={{ ...td(A, "right"), fontFamily: "monospace", color: t.breakouts ? "#fbbf24" : A.textMuted }}>{t.breakouts || "—"}</td>
                  </tr>
                ))}
                {(themeFlow.coldest || []).map((t) => (
                  <tr key={`cold-${t.theme}`}>
                    <td style={{ ...td(A), color: A.textDim }}>❄️ {t.theme}</td>
                    <td style={{ ...td(A, "right"), fontFamily: "monospace", fontWeight: 700, color: pc(t.avgChg) }}>{fmtPct(t.avgChg, 2)}</td>
                    <td style={{ ...td(A, "right"), fontFamily: "monospace", color: A.textMuted }}>{t.pctGreen}%</td>
                    <td style={{ ...td(A, "right"), fontFamily: "monospace", color: A.textMuted }}>{t.breakouts || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        <Card A={A} title="Leader Damage Watch" sub="RS 90+ leaders hit hard on volume">
          {!dmg.damagedLeaders?.length ? (
            <div style={{ fontSize: 11, color: A.green }}>✅ 0 RS 90+ leaders down ≥3% on heavy volume.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {dmg.damagedLeaders.map((d) => (
                <div key={d.ticker} onClick={() => onTicker && onTicker(d.ticker)} style={{ cursor: "pointer", fontSize: 11, display: "flex", gap: 8, alignItems: "center", borderBottom: `1px solid ${A.border}`, paddingBottom: 4 }}>
                  <Tk t={d.ticker} />
                  <span style={{ color: A.textMuted, fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.theme}</span>
                  <span style={{ marginLeft: "auto", fontFamily: "monospace", fontWeight: 700, color: A.red }}>{fmtPct(d.chg, 2)}</span>
                  <span style={{ fontFamily: "monospace", fontSize: 10, color: A.textDim }}>{d.zvr != null ? `${d.zvr.toFixed(1)}x` : "—"}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {onDeck.length > 0 && (
          <Card A={A} title="On Deck (🔵 RSL Basing)" sub="RS-line 52w highs consolidating near highs" right={<CopyTickersBtn A={A} tickers={onDeckTickers} label="Copy" />}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {onDeck.map((r) => (
                <div key={r.ticker} onClick={() => onTicker && onTicker(r.ticker)} style={{ cursor: "pointer", fontSize: 11, display: "flex", gap: 8, alignItems: "center", borderBottom: `1px solid ${A.border}`, paddingBottom: 4 }}>
                  <Tk t={r.ticker} />
                  <span style={{ color: A.textMuted, fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.theme}</span>
                  <span style={{ marginLeft: "auto", fontFamily: "monospace", color: A.green, fontWeight: 700 }}>RS {r.rs}</span>
                  <span style={{ fontFamily: "monospace", fontSize: 10, color: A.textDim }}>{fmtPct(r.off52, 1)}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* Quick Copy TradingView Strip */}
      {(boTickers.length > 0 || allMoverTickers.length > 0 || onDeckTickers.length > 0) && (
        <Card A={A} title="Quick Copy (TradingView)">
          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11, fontFamily: "monospace" }}>
            {boTickers.length > 0 && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ color: "#fbbf24", fontWeight: 700, minWidth: 85 }}>Breakouts:</span>
                <code style={{ color: A.text, background: A.bg, padding: "2px 6px", borderRadius: 4, border: `1px solid ${A.border}` }}>{boTickers.join(",")}</code>
                <CopyTickersBtn A={A} tickers={boTickers} label="Copy" />
              </div>
            )}
            {allMoverTickers.length > boTickers.length && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ color: A.green, fontWeight: 700, minWidth: 85 }}>All Movers:</span>
                <code style={{ color: A.text, background: A.bg, padding: "2px 6px", borderRadius: 4, border: `1px solid ${A.border}` }}>{allMoverTickers.join(",")}</code>
                <CopyTickersBtn A={A} tickers={allMoverTickers} label="Copy" />
              </div>
            )}
            {onDeckTickers.length > 0 && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ color: A.cyan, fontWeight: 700, minWidth: 85 }}>On Deck:</span>
                <code style={{ color: A.text, background: A.bg, padding: "2px 6px", borderRadius: 4, border: `1px solid ${A.border}` }}>{onDeckTickers.join(",")}</code>
                <CopyTickersBtn A={A} tickers={onDeckTickers} label="Copy" />
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
