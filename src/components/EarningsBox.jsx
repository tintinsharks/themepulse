// ── EarningsBox — quarterly + annual fundamentals as one compact grid ─────
// Oldest → newest left to right, next quarter's consensus as an orange "Est"
// column. Cell colors: green = strong (YoY ≥ 25%, net margin ≥ 15%),
// red = negative, blue fill = best in row.

import { useEffect, useState, useRef } from "react";

export function EarningsBox({ quarters, annuals, est, ARIA, source }) {
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
  const tight = w < 410;
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
  const fmtSales = (m) => (m == null ? "—" : Math.abs(m) >= 1000 ? `${(m / 1000).toFixed(1)}${tight ? "B" : " B"}` : `${Math.round(m)}${tight ? "M" : " M"}`);
  const fmtPct = (v) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(compact && Math.abs(v) >= 100 ? 0 : 1)}%`);
  const fmtEps = (v) => (v == null || !Number.isFinite(v) ? "—" : String(+v.toFixed(2)));
  const rows = [
    { k: "eps", label: "EPS ($)", fmt: fmtEps, kind: "eps" },
    { k: "eps_yoy", label: tight ? "EPS YoY" : "EPS YoY %", fmt: fmtPct, kind: "growth" },
    { k: "revenue", label: tight ? "Sales" : "Sales ($)", fmt: fmtSales, kind: "plain" },
    { k: "revenue_yoy", label: tight ? "Sales YoY" : "Sales YoY %", fmt: fmtPct, kind: "growth" },
    { k: "net_margin", label: tight ? "Net Mgn" : compact ? "Net Mgn %" : "Net Margin %", fmt: fmtPct, kind: "margin" },
  ];
  const cell = { padding: tight ? "4px 2px" : compact ? "5px 2px" : "6px 6px", textAlign: "center", fontSize: tight ? 10 : compact ? 11 : 12.5, borderBottom: `1px solid ${C.line}`, borderLeft: `1px solid ${C.line}`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" };
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
        <colgroup><col style={{ width: tight ? "19%" : compact ? "19.6%" : "22%" }} />{Array.from({ length: 6 }, (_, i) => <col key={i} style={{ width: tight ? "13.5%" : compact ? "13.4%" : "13%" }} />)}</colgroup>
        <tbody>
          {section("Quarterly", [...(est ? quarters.slice(-5) : quarters.slice(-6)), ...(est ? [est] : [])])}
          {section("Annual", annuals.slice(-6))}
        </tbody>
      </table>
    </div>
  );
}
