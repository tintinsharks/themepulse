import React, { useEffect, useMemo, useState } from "react";
import { CONF_LABEL, Card, Delta, EPS_TIP, ExtHoursMovers, FlagButton, LayerLink, StockTable, TierMark, statusColor, td, th } from "./core.jsx";
import RotationView from "./Rotation.jsx";
import ZangerBriefSection from "./ZangerBriefSection.jsx";

// ── Written briefs (BRIEF → Written) ─────────────────────────────────────
// Dated snapshots in public/data/briefs/ (brief-index.json + <id>.json),
// committed by the Gmail → GitHub bridge. Everything is rendered as text —
// never as HTML — and links are limited to http(s).
const BRIEF_DIR = "/data/briefs/";
const safeUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : null);
const SESSION_LABEL = { am: "Premarket", pm: "Postmarket", intraday: "Intraday" };

function WrittenBrief({ A, onTicker, chartTicker, modeSwitch }) {
  const [index, setIndex] = useState(null);
  const [sel, setSel] = useState(null);
  const [brief, setBrief] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    fetch(`${BRIEF_DIR}brief-index.json?t=${Date.now()}`).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((ix) => { const list = Array.isArray(ix?.briefs) ? ix.briefs : []; setIndex(list); setSel(list[0]?.file || ix?.latest || null); })
      .catch(() => setErr("No written briefs published yet."));
  }, []);
  useEffect(() => {
    if (!sel || !/^[a-z0-9_-]+\.json$/i.test(sel)) return;
    setBrief(null);
    fetch(`${BRIEF_DIR}${sel}`).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((b) => { setBrief(b); setErr(null); }).catch(() => setErr(`Couldn't load ${sel}.`));
  }, [sel]);

  const num = (v, dg = 2) => (typeof v === "number" ? v.toFixed(dg) : "—");
  const pct = (v, dg = 1) => (typeof v === "number" ? `${v > 0 ? "+" : ""}${v.toFixed(dg)}%` : "—");
  const pc = (v) => (typeof v !== "number" ? A.textMuted : v >= 0 ? A.green : A.red);
  const rsC = (v) => (v >= 90 ? A.green : v >= 70 ? A.yellow : typeof v === "number" ? A.red : A.textMuted);
  const arr = (x) => (Array.isArray(x) ? x : []);
  const td = (align = "left") => ({ padding: "5px 6px", fontSize: 11, color: A.text, borderBottom: `1px solid ${A.border}`, textAlign: align, verticalAlign: "top", fontVariantNumeric: "tabular-nums" });
  const Tk = ({ t }) => (typeof t === "string" && t
    ? <><span onClick={() => onTicker(t)} style={{ cursor: "pointer", fontFamily: "monospace", fontWeight: 700, color: chartTicker === t ? A.green : A.text }}>{t}</span><TierMark t={t} /></>
    : null);
  const Src = ({ u }) => { const h = safeUrl(u); return h ? <a href={h} target="_blank" rel="noopener noreferrer" style={{ color: A.cyan, fontSize: 10, marginLeft: 4 }}>src</a> : null; };
  const label = (b) => `${b.label || b.date || b.id}${b.session ? ` · ${SESSION_LABEL[b.session] || b.session}` : ""}`;

  const picker = (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      {index && index.length > 0 && (
        <select value={sel || ""} onChange={(e) => setSel(e.target.value)}
          style={{ background: A.bg, color: A.text, border: `1px solid ${A.border}`, borderRadius: 4, fontSize: 11, padding: "2px 4px", maxWidth: 260 }}>
          {index.map((b) => <option key={b.id || b.file} value={b.file}>{label(b)}</option>)}
        </select>
      )}
      {modeSwitch}
    </div>
  );
  if (err && !brief) return <Card A={A} title="Written brief" right={picker}><div style={{ fontSize: 12, color: A.textMuted }}>{err}</div></Card>;
  if (!brief) return <Card A={A} title="Written brief" right={picker}><div style={{ fontSize: 12, color: A.textMuted }}>Loading…</div></Card>;

  const rg = brief.regime || {};
  const br = rg.breadth || {};
  const st = brief.skipTraps || {};
  return (
    <div>
      <Card A={A} title="Written brief" sub={`${SESSION_LABEL[brief.session] || brief.session || ""} · ${brief.date || ""}${brief.dataAsOf ? ` · data as of ${brief.dataAsOf}` : ""}`} right={picker}>
        {brief.headline && <div style={{ fontSize: 16, fontWeight: 700, color: A.text, lineHeight: 1.35, marginBottom: 6 }}>{String(brief.headline)}</div>}
        {rg.posture && <div style={{ fontSize: 12, fontWeight: 700, color: /correction|defensive|risk off/i.test(rg.posture) ? A.red : A.green }}>{String(rg.posture)}</div>}
        {rg.note && <div style={{ fontSize: 11, color: A.textDim, marginTop: 3, lineHeight: 1.45 }}>{String(rg.note)}</div>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 10, borderTop: `1px solid ${A.border}`, paddingTop: 10 }}>
          {arr(rg.indexes).map((x) => (
            <div key={x.symbol} style={{ minWidth: 120 }}>
              <div style={{ fontSize: 11, color: A.textMuted }}><Tk t={x.symbol} /></div>
              <div style={{ fontSize: 16, fontWeight: 700, color: pc(x.chgPct), fontVariantNumeric: "tabular-nums" }}>{num(x.price)} <span style={{ fontSize: 11 }}>{pct(x.chgPct, 2)}</span></div>
              <div style={{ fontSize: 10, color: A.textMuted }}>off high {pct(x.offHighPct)} · CR {typeof x.closingRangePct === "number" ? `${x.closingRangePct.toFixed(0)}%` : "—"}{typeof x.afterHours === "number" ? ` · AH ${num(x.afterHours)}` : ""}</div>
            </div>
          ))}
          {Object.keys(br).length > 0 && (
            <div style={{ fontSize: 11, color: A.textDim, lineHeight: 1.6 }}>
              <span style={{ color: A.green }}>{br.leadingLayers ?? "—"} leading</span> · <span style={{ color: A.cyan }}>{br.emergingLayers ?? "—"} emerging</span><br />
              <span style={{ color: A.yellow }}>{br.weakeningLayers ?? "—"} weakening</span> · <span style={{ color: A.red }}>{br.breakingDownLayers ?? "—"} breaking down</span> · {br.laggingLayers ?? "—"} lagging
            </div>
          )}
        </div>
      </Card>

      {arr(brief.macroTape).length > 0 && (
        <Card A={A} title="Macro tape">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            {arr(brief.macroTape).map((m, i) => (
              <div key={i}>
                <div style={{ fontSize: 10, color: A.textMuted }}>{String(m.name ?? "")}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: A.text }}>{String(m.value ?? "")} <span style={{ fontSize: 11, color: /^\+/.test(m.change) ? A.green : /^-/.test(m.change) ? A.red : A.textDim }}>{String(m.change ?? "")}</span></div>
                <div style={{ fontSize: 10, color: A.textDim, lineHeight: 1.4, marginTop: 2 }}>{String(m.impact ?? "")}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {arr(brief.focusSetups).length > 0 && (
        <Card A={A} title="Focus setups" sub="Pivot, buy zone and stop as written in the brief · click a ticker to chart">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={th(A)}>Ticker</th><th style={th(A)}>Layer</th><th style={th(A, "right")}>RS</th><th style={th(A, "right")}>EPS</th>
                <th style={th(A, "right")}>Price</th><th style={th(A, "right")}>Pivot</th><th style={th(A, "right")}>Buy ≤</th><th style={th(A, "right")}>Stop</th>
                <th style={th(A)}>Stage</th><th style={th(A)}>Size</th><th style={th(A)}>Catalyst</th>
              </tr></thead>
              <tbody>{arr(brief.focusSetups).map((f, i) => (
                <tr key={`${f.ticker}-${i}`}>
                  <td style={td()}><Tk t={f.ticker} /><div style={{ fontSize: 10, color: A.textMuted }}>{String(f.company ?? "")}</div></td>
                  <td style={td()}>{String(f.layer ?? "")}<div style={{ fontSize: 10, color: A.textMuted }}>{String(f.theme ?? "")}</div></td>
                  <td style={{ ...td("right"), color: rsC(f.rs) }}>{f.rs ?? "—"}</td>
                  <td style={{ ...td("right"), color: rsC(f.eps) }}>{f.eps ?? "—"}</td>
                  <td style={td("right")}>{num(f.price)}</td><td style={td("right")}>{num(f.pivot)}</td>
                  <td style={td("right")}>{num(f.buyZoneMax)}</td><td style={{ ...td("right"), color: A.red }}>{num(f.stop)}</td>
                  <td style={td()}>{String(f.baseStage ?? "")}<div style={{ fontSize: 10, color: A.textMuted }}>{[f.continuity, f.rsLine].filter(Boolean).map(String).join(" · ")}</div></td>
                  <td style={td()}>{String(f.sizing ?? "")}</td>
                  <td style={{ ...td(), color: A.textDim, minWidth: 220 }}>{String(f.catalyst ?? "")}<Src u={f.sourceUrl} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      )}

      {arr(brief.extendedMovers).length > 0 && (
        <Card A={A} title="Pre / after-market movers">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={th(A)}>Ticker</th><th style={th(A)}>Session</th><th style={th(A, "right")}>Chg</th><th style={th(A, "right")}>Price</th>
                <th style={th(A, "right")}>Vol</th><th style={th(A, "right")}>RS</th><th style={th(A)}>Catalyst</th><th style={th(A)}>Protocol</th></tr></thead>
              <tbody>{arr(brief.extendedMovers).map((m, i) => (
                <tr key={`${m.ticker}-${i}`}>
                  <td style={td()}><Tk t={m.ticker} /></td><td style={td()}>{String(m.session ?? "")}</td>
                  <td style={{ ...td("right"), color: pc(m.chgPct) }}>{pct(m.chgPct, 2)}</td><td style={td("right")}>{num(m.price)}</td>
                  <td style={td("right")}>{String(m.vol ?? "")}</td><td style={{ ...td("right"), color: rsC(m.rs) }}>{m.rs ?? "—"}</td>
                  <td style={{ ...td(), color: A.textDim, minWidth: 200 }}>{String(m.catalyst ?? "")}<Src u={m.sourceUrl} /></td>
                  <td style={{ ...td(), color: A.textDim, minWidth: 200 }}>{String(m.protocol ?? "")}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      )}

      {arr(brief.breakdowns).length > 0 && (
        <Card A={A} title="Breakdowns">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={th(A)}>Ticker</th><th style={th(A)}>Layer</th><th style={th(A, "right")}>vs 50d</th><th style={th(A, "right")}>1M</th><th style={th(A)}>Catalyst</th></tr></thead>
              <tbody>{arr(brief.breakdowns).map((b, i) => (
                <tr key={`${b.ticker}-${i}`}>
                  <td style={td()}><Tk t={b.ticker} /></td><td style={td()}>{String(b.layer ?? "")}</td>
                  <td style={{ ...td("right"), color: pc(b.vs50dPct) }}>{pct(b.vs50dPct)}</td><td style={{ ...td("right"), color: pc(b.chg1mPct) }}>{pct(b.chg1mPct)}</td>
                  <td style={{ ...td(), color: A.textDim, minWidth: 220 }}>{String(b.catalyst ?? "")}<Src u={b.sourceUrl} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      )}

      {(arr(brief.radar).length > 0 || Object.keys(st).length > 0) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {arr(brief.radar).length > 0 && (
            <div style={{ flex: "1 1 300px", minWidth: 0 }}>
              <Card A={A} title="Radar">
                {arr(brief.radar).map((r, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, fontSize: 11, padding: "4px 0", borderBottom: `1px solid ${A.border}` }}>
                    <span style={{ color: A.cyan, fontFamily: "monospace", whiteSpace: "nowrap" }}>{String(r.date ?? "")}</span>
                    <span style={{ color: A.text }}>{String(r.event ?? "")}</span>
                  </div>
                ))}
              </Card>
            </div>
          )}
          {Object.keys(st).length > 0 && (
            <div style={{ flex: "1 1 300px", minWidth: 0 }}>
              <Card A={A} title="Skip / traps">
                {[["buyoutCapped", "Buyout-capped"], ["extended", "Extended"], ["stage4", "Stage 4"]].concat(
                  Object.keys(st).filter((k) => !["buyoutCapped", "extended", "stage4"].includes(k)).map((k) => [k, k]))
                  .filter(([k]) => arr(st[k]).length).map(([k, lab]) => (
                    <div key={k} style={{ fontSize: 11, padding: "4px 0", borderBottom: `1px solid ${A.border}` }}>
                      <span style={{ color: A.textMuted, marginRight: 8 }}>{lab}</span>
                      <span style={{ color: A.text }}>{arr(st[k]).map(String).join(" · ")}</span>
                    </div>
                  ))}
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BriefPanel(props) {
  const { A } = props;
  const [mode, setMode] = useState(() => { try { return localStorage.getItem("tp_brief_mode") || "live"; } catch { return "live"; } });
  const pick = (m) => { setMode(m); try { localStorage.setItem("tp_brief_mode", m); } catch { /* ignore */ } };
  const modeSwitch = (
    <div style={{ display: "inline-flex", border: `1px solid ${A.border}`, borderRadius: 4, overflow: "hidden" }}>
      {[["live", "Live"], ["written", "Written"]].map(([k, l]) => (
        <button key={k} onClick={() => pick(k)} style={{ background: mode === k ? A.border : "transparent", color: mode === k ? A.text : A.textMuted,
          border: "none", padding: "2px 10px", fontSize: 11, cursor: "pointer" }}>{l}</button>
      ))}
    </div>
  );
  return (
    <>
      {mode === "written"
        ? <WrittenBrief A={A} onTicker={props.onTicker} chartTicker={props.chartTicker} modeSwitch={modeSwitch} />
        : <LiveBrief {...props} modeSwitch={modeSwitch} />}
      <ZangerBriefSection A={A} onTicker={props.onTicker} chartTicker={props.chartTicker} />
    </>
  );
}

// ── Brief (BRIEF view) ────────────────────────────────────────────────────
// The market brief rebuilt from live ThemePulse data, in the order the static
// written brief uses: headline strip → strongest stocks in the strongest
// themes (RS & EPS >= 80) → pre/after-market → rotation → emerging layers
// (confirmed vs unconfirmed) → breakdowns (leaders cracking, leaders breaking
// down). Every ticker charts on click; every layer / theme opens its members.
const isRising = (l) => l.st === "emerg" || (l.st !== "lead" && (l.now - (l.m1 ?? l.now)) >= 10 && (l.trend?.slope ?? 0) > 0);

function LiveBrief({ A, themes, layers, stockMap, tickerLayer, members, brk, pipeline, dates, theme, lb,
  onTicker, chartTicker, onLayer, onTheme, layerOfTicker, modeSwitch }) {
  const pct = (v, dg = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(dg)}%`);
  const pc = (v) => (v == null ? A.textMuted : v >= 0 ? A.green : A.red);
  const rsC = (v) => (v >= 90 ? A.green : v >= 70 ? A.yellow : v != null ? A.red : A.textMuted);
  const epsC = (v) => (v >= 80 ? A.green : v >= 50 ? A.yellow : v != null ? A.red : A.textMuted);
  const tks = (l) => members[l.key] || (l.holds || []).map((h) => h.t);

  const top = useMemo(() => [...themes].sort((a, b) => b.now - a.now).slice(0, 5), [themes]);
  const byM1 = useMemo(() => [...themes].filter((t) => t.m1 != null).sort((a, b) => (b.now - b.m1) - (a.now - a.m1)), [themes]);

  // strongest stocks in the strongest themes: RS >= 80 and EPS >= 80
  const strongest = useMemo(() => top.map((t) => {
    const set = [...new Set(t.layers.flatMap(tks))];
    const rows = set.map((x) => stockMap[x]).filter((s) => s && (s.rs_rank ?? 0) >= 80 && (s.eps_rating ?? 0) >= 80)
      .sort((a, b) => (b.rs_rank - a.rs_rank) || (b.eps_rating - a.eps_rating)).slice(0, 6);
    return { t, rows, leading: t.layers.filter((l) => l.st === "lead").length };
  }), [top, stockMap, members]); // eslint-disable-line react-hooks/exhaustive-deps

  const emerging = useMemo(() => layers.filter(isRising)
    .map((l) => ({ l, cf: l.conf, names: tks(l).map((x) => stockMap[x]).filter((s) => s && (s.rs_rank ?? 0) >= 80)
      .sort((a, b) => b.rs_rank - a.rs_rank).slice(0, 4) }))
    .sort((a, b) => ((b.cf?.passed.length ?? 0) - (a.cf?.passed.length ?? 0)) || ((b.l.now - b.l.m1) - (a.l.now - a.l.m1)))
    .slice(0, 12), [layers, stockMap, members]); // eslint-disable-line react-hooks/exhaustive-deps

  const exiting = useMemo(() => layers.filter((l) => (l.conf?.lx ?? 0) >= 2 && (l.st === "lead" || l.st === "weak" || l.now >= 70))
    .sort((a, b) => b.conf.lx - a.conf.lx).slice(0, 10), [layers]);
  const totalExits = layers.reduce((n, l) => n + (l.conf?.lx ?? 0), 0);
  const leadingN = layers.filter((l) => l.st === "lead").length;

  const H = ({ children, sub }) => (
    <div style={{ margin: "4px 0 8px" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: A.text, letterSpacing: 0.3 }}>{children}</div>
      {sub && <div style={{ fontSize: 10, color: A.textMuted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
  const Tk = ({ t }) => (
    <><span onClick={(e) => { e.stopPropagation(); onTicker(t); }} style={{ cursor: "pointer", fontFamily: "monospace", fontWeight: 700,
      color: chartTicker === t ? A.green : A.text }}>{t}</span><TierMark t={t} /></>
  );
  const Metric = ({ big, color, label, sub }) => (
    <div style={{ flex: "1 1 180px", minWidth: 0 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{big}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: A.text, marginTop: 2 }}>{label}</div>
      <div style={{ fontSize: 10, color: A.textMuted, marginTop: 2, lineHeight: 1.4 }}>{sub}</div>
    </div>
  );
  const up = byM1[0], dn = byM1[byM1.length - 1];

  return (
    <div>
      <Card A={A} title="Market brief" sub={`Live from ThemePulse · layers as of ${dates[dates.length - 1] || "—"}`}
        right={modeSwitch}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, borderTop: `1px solid ${A.border}`, borderBottom: `1px solid ${A.border}`, padding: "10px 0" }}>
          {top[0] && <Metric big={`${top[0].theme} ${Math.round(top[0].now)}`} color={A.green}
            label={`Strongest themes${top[1] ? ` · then ${top[1].theme} ${Math.round(top[1].now)}` : ""}`}
            sub={`${leadingN} layers leading (rank ≥ 88) across the universe`} />}
          {up && dn && <Metric big={`${up.theme} +${Math.round(up.now - up.m1)}`} color={A.cyan}
            label="Biggest 1-month rotation in"
            sub={`Out: ${dn.theme} ${Math.round(dn.now - dn.m1)} · rank change over a month`} />}
          <Metric big={`${totalExits} exits`} color={totalExits ? A.red : A.textMuted} label="Leaders cracking this week"
            sub={exiting[0] ? `Most in ${exiting[0].name} (${exiting[0].conf.lx}) — RS 90+ names now below the 50-day or under RS 80` : "No layer has 2+ leaders cracking"} />
        </div>
      </Card>

      <Card A={A} title="Strongest stocks in the strongest themes" sub="Top 5 themes by rank · members with RS ≥ 80 and EPS ≥ 80 · click a ticker to chart, a theme or layer to open its stocks">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th(A)}>Ticker</th><th style={th(A)}>Layer</th>
              <th style={th(A, "right")}>RS</th><th style={th(A, "right")} title={EPS_TIP}>EPS</th>
              <th style={th(A, "right")}>vs 50d</th><th style={th(A, "right")}>Off high</th><th style={th(A, "right")}>1M</th>
            </tr></thead>
            <tbody>
              {strongest.map(({ t, rows, leading }) => (
                <React.Fragment key={t.themeId}>
                  <tr onClick={() => onTheme(t.themeId)} style={{ cursor: "pointer" }} title="Show every stock in this theme">
                    <td colSpan={7} style={{ ...td(A), paddingTop: 10, color: A.text, fontWeight: 700, borderBottom: `1px solid ${A.textDim}` }}>
                      {t.theme} <span style={{ color: statusColor(t.st, A) }}>{Math.round(t.now)}</span>
                      <span style={{ color: A.textMuted, fontWeight: 400, fontSize: 11 }}> · {leading} of {t.layers.length} layers leading · 1m <Delta v={t.now - t.m1} A={A} /></span>
                    </td>
                  </tr>
                  {rows.length ? rows.map((s) => {
                    const L = tickerLayer[s.ticker];
                    return (
                      <tr key={s.ticker} data-nav={s.ticker} onClick={() => onTicker(s.ticker)} style={{ cursor: "pointer", background: chartTicker === s.ticker ? A.bgHover : "transparent" }}>
                        <td style={td(A)}><FlagButton t={s.ticker} A={A} /><Tk t={s.ticker} /></td>
                        <td style={{ ...td(A), fontSize: 11 }}><LayerLink r={{ t: s.ticker, layer: L?.name, layerSt: L?.st }} A={A} onLayer={layerOfTicker} /></td>
                        <td style={{ ...td(A, "right"), color: rsC(s.rs_rank), fontWeight: 700 }}>{s.rs_rank}</td>
                        <td title={s.eps_tip || ""} style={{ ...td(A, "right"), color: epsC(s.eps_rating) }}>{s.eps_rating}{s.eps_accel ? <span style={{ color: A.green, fontSize: 9 }}>▲</span> : null}</td>
                        <td style={{ ...td(A, "right"), color: pc(s.sma50_pct) }}>{pct(s.sma50_pct)}</td>
                        <td style={td(A, "right")}>{pct(s.off_52w_high)}</td>
                        <td style={{ ...td(A, "right"), color: pc(s.return_1m) }}>{pct(s.return_1m)}</td>
                      </tr>
                    );
                  }) : (
                    <tr><td colSpan={7} style={{ ...td(A), color: A.textMuted, fontSize: 11 }}>No member clears RS 80 and EPS 80.</td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card A={A} title="Pre-market & after-hours movers">
        <ExtHoursMovers A={A} pipeline={pipeline} stockMap={stockMap} tickerLayer={tickerLayer} onTicker={onTicker} chartTicker={chartTicker} onLayer={layerOfTicker} />
      </Card>

      <Card A={A} title="Rotation" sub="RS rank change by layer or theme">
        <RotationView A={A} layers={layers} themes={themes} dates={dates} theme={theme} lb={lb}
          onLayer={onLayer} onTheme={(id) => onTheme(id)} />
      </Card>

      <Card A={A} title="Emerging layers" sub="Rank rising (Emerging, or +10 in a month and still climbing) · confirmed = 2+ of accumulation days, money flowing in, new RS 90+ leaders · early rotation backtested negative, so unconfirmed is a watchlist only">
        {!emerging.length ? <div style={{ fontSize: 11, color: A.textMuted }}>None.</div> : emerging.map(({ l, cf, names }) => {
          const ok = (cf?.passed.length ?? 0) >= 2;
          return (
            <div key={l.key} onClick={() => onLayer(l)} title="Show every stock in this layer"
              style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", padding: "6px 0", borderBottom: `1px solid ${A.border}`, cursor: "pointer" }}>
              <span style={{ minWidth: 170, color: A.text, fontWeight: 600, fontSize: 12 }}>{l.name} <span style={{ color: A.textMuted, fontWeight: 400, fontSize: 10 }}>{l.theme}</span></span>
              <span style={{ fontSize: 11, color: statusColor(l.st, A), fontWeight: 700, minWidth: 70 }}>{l.now} <span style={{ color: A.textMuted, fontWeight: 400 }}>1m</span> <Delta v={l.now - l.m1} A={A} /></span>
              <span style={{ fontSize: 10, fontWeight: 700, padding: "0 5px", borderRadius: 3, border: `1px solid ${ok ? A.green : A.textMuted}`, color: ok ? A.green : A.textMuted }}>
                {cf ? (ok ? "confirmed" : "unconfirmed") : "no volume data"}
              </span>
              {cf?.passed.length ? <span style={{ fontSize: 10, color: A.textMuted }}>{cf.passed.map((k) => CONF_LABEL[k]).join(" · ")}</span> : null}
              <span style={{ fontSize: 11, marginLeft: "auto" }}>
                {names.map((s) => <span key={s.ticker} style={{ marginLeft: 8 }}><Tk t={s.ticker} /> <span style={{ color: rsC(s.rs_rank), fontSize: 10 }}>{s.rs_rank}</span></span>)}
              </span>
            </div>
          );
        })}
      </Card>

      <Card A={A} title="Breakdowns" sub="Layers losing leaders this week (were RS 90+, now below the 50-day or under RS 80), then individual leaders breaking down">
        {exiting.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            {exiting.map((l) => (
              <div key={l.key} onClick={() => onLayer(l)} title="Show every stock in this layer"
                style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", padding: "5px 0", borderBottom: `1px solid ${A.border}`, cursor: "pointer" }}>
                <span style={{ minWidth: 170, color: A.text, fontWeight: 600, fontSize: 12 }}>{l.name} <span style={{ color: A.textMuted, fontWeight: 400, fontSize: 10 }}>{l.theme}</span></span>
                <span style={{ fontSize: 11, color: A.red, fontWeight: 700 }}>{l.conf.lx} out</span>
                <span style={{ fontSize: 11 }}>{l.conf.lxT.slice(0, 10).map((t) => <span key={t} style={{ marginRight: 8 }}><Tk t={t} /></span>)}</span>
              </div>
            ))}
          </div>
        )}
        <H sub="Held the top RS decile ≥ 40% of the quarter, now RS < 70 or ≥ 8% below the 50-day">Leaders breaking down</H>
        <StockTable rows={brk.slice(0, 20)} A={A} onTicker={onTicker} chartTicker={chartTicker} mode="brk" onLayer={layerOfTicker} />
      </Card>
    </div>
  );
}


export default BriefPanel;
