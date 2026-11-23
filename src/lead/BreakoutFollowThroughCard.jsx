import { useEffect, useMemo, useState } from "react";
import { Card, etClock } from "./core.jsx";
import { evaluateBreakoutFollowThrough, selectDailySnapshots } from "./followThrough.js";

const BRIEF_DIR = "/data/briefs/";
const SAFE_FILE_RE = /^[a-z0-9_.-]+\.json$/i;

// Module-level snapshot cache so tab switches do not re-fetch immutable snapshots
const _snapCache = new Map();
const _snapInflight = new Map();

function fetchSnapshot(file) {
  if (!file || !SAFE_FILE_RE.test(file)) return Promise.resolve(null);
  if (_snapCache.has(file)) return Promise.resolve(_snapCache.get(file));
  let p = _snapInflight.get(file);
  if (!p) {
    p = fetch(`${BRIEF_DIR}${file}`, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d === "object") _snapCache.set(file, d);
        _snapInflight.delete(file);
        return d;
      })
      .catch(() => {
        _snapInflight.delete(file);
        return null;
      });
    _snapInflight.set(file, p);
  }
  return p;
}

const fmtPct = (v) =>
  typeof v === "number" && Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(1)}%` : "—";

const shortDate = (d) => {
  if (typeof d !== "string") return "—";
  const parts = d.split("-");
  return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : d;
};

const STATUS_META = [
  { key: "held", icon: "✓", label: "Held" },
  { key: "mixed", icon: "~", label: "Mixed" },
  { key: "squatted", icon: "✕", label: "Squatted" },
];

export default function BreakoutFollowThroughCard({
  A,
  index,
  quotes,
  stockMap,
  liveOn,
  onTicker,
  chartTicker,
}) {
  const files = useMemo(() => selectDailySnapshots(index, 5), [index]);
  const filesKey = files.join("|");

  const [snapMap, setSnapMap] = useState(() => {
    const m = {};
    for (const f of files) {
      if (_snapCache.has(f)) m[f] = _snapCache.get(f);
    }
    return m;
  });
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);

  useEffect(() => {
    if (!filesKey) {
      setLoading(false);
      return undefined;
    }
    const list = filesKey.split("|").filter(Boolean);
    const cached = {};
    const missing = [];
    for (const f of list) {
      if (_snapCache.has(f)) cached[f] = _snapCache.get(f);
      else missing.push(f);
    }
    if (Object.keys(cached).length) {
      setSnapMap((prev) => ({ ...prev, ...cached }));
    }
    if (!missing.length) {
      setLoading(false);
      return undefined;
    }

    let alive = true;
    setLoading(true);
    Promise.all(missing.map((f) => fetchSnapshot(f).then((d) => [f, d]))).then((pairs) => {
      if (!alive) return;
      const patch = {};
      for (const [f, d] of pairs) {
        if (d) patch[f] = d;
      }
      if (Object.keys(patch).length) {
        setSnapMap((prev) => ({ ...prev, ...patch }));
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [filesKey]);

  const snapshots = useMemo(
    () => files.map((f) => snapMap[f]).filter(Boolean),
    [files, snapMap]
  );

  const todayStr = useMemo(() => etClock().session, []);

  const result = useMemo(
    () =>
      evaluateBreakoutFollowThrough({
        snapshots,
        quotes,
        stockMap,
        todayStr,
        liveOn: Boolean(liveOn),
      }),
    [snapshots, quotes, stockMap, todayStr, liveOn]
  );

  const amber = A.yellow || "#f59e0b";
  const toneColor = (tone) =>
    tone === "good" ? A.green : tone === "warn" ? amber : tone === "bad" ? A.red : A.textMuted;
  const statusColor = (st) => (st === "held" ? A.green : st === "mixed" ? amber : A.red);

  const verdict = result.verdict;
  const vColor = toneColor(verdict.tone);
  const latest = result.latestDay;
  const isLatestToday = Boolean(latest && latest.date === todayStr);
  const defaultDate = latest?.date || (result.days.length ? result.days[result.days.length - 1].date : null);
  const activeDay =
    result.days.find((d) => d.date === selectedDate) ||
    result.days.find((d) => d.date === defaultDate) ||
    null;

  const badge = (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 10,
        fontWeight: 800,
        fontFamily: "monospace",
        letterSpacing: 0.4,
        padding: "2px 8px",
        borderRadius: 999,
        color: vColor,
        background: `${vColor}1c`,
        border: `1px solid ${vColor}`,
        whiteSpace: "nowrap",
      }}
    >
      {verdict.label}
    </span>
  );

  const subText =
    result.rollingTotal > 0
      ? `${result.days.length}d · ${result.rollingTotal} breakout${result.rollingTotal === 1 ? "" : "s"} tracked${liveOn && isLatestToday ? " · live quotes active" : ""}`
      : "Tracks intraday & close hold vs squat rate across Zanger breakout scans";

  const hasData = result.rollingTotal > 0;
  const holdPctBar = result.rollingHoldRate ?? 0;
  const mixedPctBar = result.rollingTotal ? Math.round((result.rollingMixed / result.rollingTotal) * 100) : 0;
  const squatPctBar = result.rollingTotal ? Math.max(0, 100 - holdPctBar - mixedPctBar) : 0;

  return (
    <Card A={A} title="Breakout Follow-Through" sub={subText} right={badge}>
      {/* Sizing Verdict Advice */}
      <div
        style={{
          fontSize: 11,
          color: A.textDim,
          marginBottom: hasData ? 10 : 6,
          lineHeight: 1.4,
        }}
      >
        {verdict.advice}
      </div>

      {!hasData ? (
        <div
          style={{
            fontSize: 11,
            color: A.textMuted,
            padding: "8px 10px",
            background: A.bg,
            border: `1px solid ${A.border}`,
            borderRadius: 6,
          }}
        >
          {loading
            ? "Loading breakout snapshot history…"
            : "No breakout snapshots recorded yet — hold and squat rates will populate automatically once intraday Zanger scans run."}
        </div>
      ) : (
        <>
          {/* KPI Strip */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))",
              gap: 8,
              marginBottom: 10,
            }}
          >
            {/* Today / Latest Hold Rate */}
            <div
              style={{
                padding: "7px 10px",
                background: A.bg,
                border: `1px solid ${A.border}`,
                borderRadius: 6,
              }}
            >
              <div style={{ fontSize: 9, fontWeight: 700, color: A.textMuted, letterSpacing: 0.4, fontFamily: "monospace" }}>
                {isLatestToday ? "TODAY HOLD RATE" : `LATEST (${shortDate(latest?.date)}) HOLD`}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 2, fontFamily: "monospace" }}>
                <span
                  style={{
                    fontSize: 17,
                    fontWeight: 800,
                    color:
                      latest?.holdRate == null
                        ? A.textMuted
                        : latest.holdRate >= 65
                        ? A.green
                        : latest.holdRate >= 45
                        ? amber
                        : A.red,
                  }}
                >
                  {latest?.holdRate != null ? `${latest.holdRate}%` : "—"}
                </span>
                <span style={{ fontSize: 11, color: A.textDim }}>
                  {latest ? `${latest.held}/${latest.total} held` : "—"}
                </span>
              </div>
            </div>

            {/* Today / Latest Squat Rate */}
            <div
              style={{
                padding: "7px 10px",
                background: A.bg,
                border: `1px solid ${A.border}`,
                borderRadius: 6,
              }}
            >
              <div style={{ fontSize: 9, fontWeight: 700, color: A.textMuted, letterSpacing: 0.4, fontFamily: "monospace" }}>
                {isLatestToday ? "TODAY SQUAT RATE" : `LATEST (${shortDate(latest?.date)}) SQUAT`}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 2, fontFamily: "monospace" }}>
                <span
                  style={{
                    fontSize: 17,
                    fontWeight: 800,
                    color:
                      latest?.squatRate == null
                        ? A.textMuted
                        : latest.squatRate >= 40
                        ? A.red
                        : latest.squatRate >= 20
                        ? amber
                        : A.green,
                  }}
                >
                  {latest?.squatRate != null ? `${latest.squatRate}%` : "—"}
                </span>
                <span style={{ fontSize: 11, color: A.textDim }}>
                  {latest ? `${latest.squatted}/${latest.total} squatted` : "—"}
                </span>
              </div>
            </div>

            {/* Rolling 5d Hold Rate + Visual Progress Bar */}
            <div
              style={{
                padding: "7px 10px",
                background: A.bg,
                border: `1px solid ${A.border}`,
                borderRadius: 6,
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6 }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: A.textMuted, letterSpacing: 0.4, fontFamily: "monospace" }}>
                  ROLLING 5D HOLD RATE
                </span>
                <span style={{ fontSize: 10, color: A.textDim, fontFamily: "monospace" }}>
                  {result.rollingHeld}/{result.rollingTotal}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
                <span style={{ fontSize: 17, fontWeight: 800, fontFamily: "monospace", color: vColor }}>
                  {result.rollingHoldRate != null ? `${result.rollingHoldRate}%` : "—"}
                </span>
                <div
                  title={`Held ${result.rollingHeld} · Mixed ${result.rollingMixed} · Squatted ${result.rollingSquatted}`}
                  style={{
                    flex: 1,
                    height: 7,
                    borderRadius: 4,
                    background: A.border,
                    overflow: "hidden",
                    display: "flex",
                  }}
                >
                  {holdPctBar > 0 && <div style={{ width: `${holdPctBar}%`, background: A.green }} />}
                  {mixedPctBar > 0 && <div style={{ width: `${mixedPctBar}%`, background: amber }} />}
                  {squatPctBar > 0 && <div style={{ width: `${squatPctBar}%`, background: A.red }} />}
                </div>
              </div>
            </div>
          </div>

          {/* Compact Daily Bar Strip (up to 5 trading days) */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${Math.max(1, result.days.length)}, minmax(90px, 1fr))`,
              gap: 6,
              marginBottom: 10,
            }}
          >
            {result.days.map((d) => {
              const isSel = activeDay?.date === d.date;
              const isDayToday = d.date === todayStr;
              const wHeld = d.total ? (d.held / d.total) * 100 : 0;
              const wMixed = d.total ? (d.mixed / d.total) * 100 : 0;
              const wSquat = d.total ? (d.squatted / d.total) * 100 : 0;
              const rateColor =
                d.holdRate == null ? A.textMuted : d.holdRate >= 65 ? A.green : d.holdRate >= 45 ? amber : A.red;
              return (
                <button
                  key={d.date}
                  type="button"
                  onClick={() => setSelectedDate(d.date)}
                  title={`${d.date}: ${d.held} held, ${d.mixed} mixed, ${d.squatted} squatted (${d.total} breakouts)`}
                  style={{
                    textAlign: "left",
                    cursor: "pointer",
                    padding: "6px 8px",
                    borderRadius: 6,
                    background: isSel ? A.bgHover : A.bg,
                    border: `1px solid ${isSel ? rateColor : A.border}`,
                    color: A.text,
                    fontFamily: "monospace",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 4, fontSize: 10 }}>
                    <span style={{ fontWeight: 700, color: isSel ? A.text : A.textDim }}>
                      {shortDate(d.date)}
                      {isDayToday ? (
                        <span style={{ color: A.cyan, fontSize: 9, marginLeft: 3 }}>●</span>
                      ) : null}
                    </span>
                    <span style={{ fontWeight: 800, color: rateColor }}>
                      {d.holdRate != null ? `${d.holdRate}%` : "—"}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      height: 6,
                      borderRadius: 3,
                      overflow: "hidden",
                      background: A.border,
                      marginTop: 5,
                      marginBottom: 4,
                    }}
                  >
                    {wHeld > 0 && <div style={{ width: `${wHeld}%`, background: A.green }} />}
                    {wMixed > 0 && <div style={{ width: `${wMixed}%`, background: amber }} />}
                    {wSquat > 0 && <div style={{ width: `${wSquat}%`, background: A.red }} />}
                  </div>
                  <div style={{ fontSize: 9, color: A.textMuted, display: "flex", justifyContent: "space-between" }}>
                    <span>
                      <span style={{ color: A.green }}>{d.held}✓</span>{" "}
                      <span style={{ color: amber }}>{d.mixed}~</span>{" "}
                      <span style={{ color: A.red }}>{d.squatted}✕</span>
                    </span>
                    <span>{d.total} BO</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Clickable Ticker Pills for Selected Day */}
          {activeDay && (
            <div
              style={{
                padding: "7px 9px",
                background: A.bg,
                border: `1px solid ${A.border}`,
                borderRadius: 6,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 6,
                  fontSize: 10,
                  fontFamily: "monospace",
                  color: A.textMuted,
                }}
              >
                <span>
                  <strong style={{ color: A.text }}>{activeDay.date}</strong>
                  {activeDay.date === todayStr ? " (Today)" : ""} · {activeDay.total} breakout
                  {activeDay.total === 1 ? "" : "s"}
                </span>
                <span>click any ticker to chart</span>
              </div>

              {activeDay.tickers.length === 0 ? (
                <div style={{ fontSize: 11, color: A.textMuted }}>No breakouts recorded on {activeDay.date}.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {STATUS_META.map(({ key, icon, label }) => {
                    const group = activeDay.tickers.filter((t) => t.status === key);
                    if (!group.length) return null;
                    const c = statusColor(key);
                    return (
                      <div key={key} style={{ display: "flex", alignItems: "flex-start", gap: 6, flexWrap: "wrap" }}>
                        <span
                          style={{
                            minWidth: 66,
                            fontSize: 9,
                            fontWeight: 800,
                            fontFamily: "monospace",
                            color: c,
                            paddingTop: 4,
                            letterSpacing: 0.3,
                          }}
                        >
                          {icon} {label.toUpperCase()} ({group.length})
                        </span>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, flex: 1 }}>
                          {group.map((t) => {
                            const isCharted = chartTicker === t.ticker;
                            const boTag = t.breakoutTypes?.length ? ` · ${t.breakoutTypes.join("/")}` : "";
                            return (
                              <button
                                key={t.ticker}
                                type="button"
                                onClick={() => onTicker && onTicker(t.ticker)}
                                title={`${t.ticker} (${t.theme}${boTag}) · ${fmtPct(t.chg)} · CR ${t.cr != null ? `${t.cr}%` : "—"}`}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                  padding: "2px 7px",
                                  borderRadius: 4,
                                  cursor: "pointer",
                                  fontFamily: "monospace",
                                  fontSize: 10,
                                  background: isCharted ? `${c}28` : `${c}12`,
                                  border: `1px solid ${isCharted ? c : `${c}66`}`,
                                  color: A.text,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                <span style={{ color: c, fontWeight: 800 }}>{icon}</span>
                                <strong style={{ color: isCharted ? c : A.text }}>{t.ticker}</strong>
                                <span style={{ color: typeof t.chg === "number" && t.chg >= 0 ? A.green : A.red, fontWeight: 700 }}>
                                  {fmtPct(t.chg)}
                                </span>
                                <span style={{ color: A.textMuted }}>
                                  CR {t.cr != null ? `${t.cr}%` : "—"}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
