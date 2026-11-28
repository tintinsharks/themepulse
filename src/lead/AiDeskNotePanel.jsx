import { MONO } from "./core.jsx";

const safeUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : null);

function formatAge(ts) {
  if (!ts) return "";
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return "just now";
  if (mins === 1) return "1m ago";
  return `${mins}m ago`;
}

/**
 * Shared AI Trading Desk Note display for Gemini 2.5 Flash + Google Search grounded synthesis.
 * - compact=true (Written Brief): renders Macro Takeaway + Top 3 Standouts/Risks + Sources
 *   (because Written Brief already renders the Theme Cluster cards right below with AI Why inline).
 * - compact=false (Breakouts Drawer): renders full Desk Note including per-theme cluster cards.
 */
export default function AiDeskNotePanel({
  A,
  data,
  loading,
  error,
  updatedAt,
  compact = false,
  clustersMeta = null,
  onTicker,
  onThemeClick,
  activeTheme = null,
  onRefresh,
  onClose,
}) {
  if (!loading && !error && !data) return null;

  const metaByTheme = new Map();
  if (Array.isArray(clustersMeta)) {
    for (const c of clustersMeta) {
      if (c?.theme) metaByTheme.set(c.theme.toLowerCase(), c);
    }
  }

  return (
    <div
      style={{
        marginBottom: 10,
        padding: "10px 12px",
        borderRadius: 8,
        background: "linear-gradient(135deg, rgba(168,85,247,0.08) 0%, rgba(56,189,248,0.05) 100%)",
        border: "1px solid rgba(168,85,247,0.34)",
      }}
    >
      {/* Header strip */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: data || error ? 7 : 0 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: "#c084fc", letterSpacing: 0.2 }}>
            ✨ AI Desk Note
          </span>
          {data?.model && (
            <span style={{ fontFamily: MONO, fontSize: 9.5, color: A.textMuted }}>
              {data.model} · Google Search grounded
            </span>
          )}
          {updatedAt && !loading && (
            <span style={{ fontFamily: MONO, fontSize: 9.5, color: A.textMuted }}>
              · {formatAge(updatedAt)}{data?.cached ? " (cached)" : ""}
            </span>
          )}
          {loading && (
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: A.cyan }}>
              Searching live news &amp; catalysts…
            </span>
          )}
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          {onRefresh && (
            <button
              type="button"
              disabled={loading}
              onClick={onRefresh}
              title="Force fresh Gemini web-grounded search (bypasses 30m cache)"
              style={{
                background: "transparent",
                border: `1px solid ${A.border}`,
                color: loading ? A.textMuted : A.textDim,
                borderRadius: 5,
                padding: "2px 7px",
                fontSize: 10,
                fontWeight: 600,
                cursor: loading ? "wait" : "pointer",
              }}
            >
              {loading ? "Refreshing…" : "↻ Refresh"}
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              title="Hide AI Desk Note drawer"
              style={{
                background: "none",
                border: "none",
                color: A.textMuted,
                cursor: "pointer",
                fontSize: 12,
                padding: "0 4px",
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          style={{
            fontSize: 11,
            color: "#fbbf24",
            background: "rgba(251,191,36,0.08)",
            border: "1px solid rgba(251,191,36,0.3)",
            borderRadius: 6,
            padding: "6px 9px",
            lineHeight: 1.45,
          }}
        >
          {error}
        </div>
      )}

      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* 1. Macro Rotation Takeaway */}
          {data.macroTakeaway && (
            <div style={{ fontSize: 12, color: A.text, lineHeight: 1.45 }}>
              <strong style={{ color: A.cyan, fontSize: 10.5, fontFamily: MONO, letterSpacing: 0.3, marginRight: 6 }}>
                MACRO:
              </strong>
              {data.macroTakeaway}
            </div>
          )}

          {/* 2. Per-Theme Grounded "Why?" Cards (shown in full drawer mode) */}
          {!compact && Array.isArray(data.themes) && data.themes.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 7 }}>
              {data.themes.map((t) => {
                const meta = metaByTheme.get(String(t.theme || "").toLowerCase());
                const focused = activeTheme && activeTheme === t.theme;
                return (
                  <div
                    key={t.theme}
                    style={{
                      padding: "7px 9px",
                      borderRadius: 7,
                      background: focused ? A.bgHover : A.bg,
                      border: `1px solid ${focused ? A.cyan : A.border}`,
                      borderLeft: `3px solid ${meta?.aPlusCount > 0 ? A.green : "#c084fc"}`,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => onThemeClick && onThemeClick(t.theme)}
                        title={onThemeClick ? `Click to filter table to ${t.theme}` : undefined}
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          cursor: onThemeClick ? "pointer" : "default",
                          color: A.text,
                          fontWeight: 800,
                          fontSize: 11.5,
                          display: "inline-flex",
                          alignItems: "baseline",
                          gap: 5,
                        }}
                      >
                        <span>{t.theme}</span>
                        {meta?.count != null && (
                          <span style={{ fontFamily: MONO, fontSize: 10, color: A.textMuted, fontWeight: 700 }}>
                            {meta.count} {meta.count === 1 ? "name" : "names"}
                          </span>
                        )}
                      </button>
                      {meta?.avgChg != null && (
                        <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: meta.avgChg >= 0 ? A.green : A.red }}>
                          avg {meta.avgChg > 0 ? "+" : ""}{meta.avgChg.toFixed(1)}%
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: A.textDim, lineHeight: 1.45, marginTop: 3 }}>
                      {t.why}
                    </div>
                    {meta?.topTickers?.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
                        {meta.topTickers.slice(0, 4).map((tk) => (
                          <button
                            key={tk.ticker}
                            type="button"
                            onClick={() => onTicker && onTicker(tk.ticker)}
                            style={{
                              background: A.bgCard,
                              border: `1px solid ${A.border}`,
                              borderRadius: 4,
                              padding: "1px 5px",
                              fontFamily: MONO,
                              fontSize: 9.5,
                              color: A.text,
                              cursor: onTicker ? "pointer" : "default",
                            }}
                          >
                            <strong>{tk.ticker}</strong>{" "}
                            <span style={{ color: tk.grade === "A+" ? A.green : tk.grade === "A" ? A.cyan : "#f59e0b", fontWeight: 700 }}>
                              {tk.grade}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* 3. Top 3 Standouts & Risks */}
          {Array.isArray(data.standouts) && data.standouts.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {data.standouts.map((s, idx) => {
                const isRisk = s.kind === "risk";
                const accent = isRisk ? "#f59e0b" : A.green;
                return (
                  <div
                    key={`${s.ticker}-${idx}`}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 7,
                      fontSize: 11,
                      lineHeight: 1.4,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 9.5,
                        fontWeight: 800,
                        padding: "1px 5px",
                        borderRadius: 4,
                        background: isRisk ? "rgba(245,158,11,0.16)" : "rgba(34,197,94,0.16)",
                        color: accent,
                        border: `1px solid ${accent}66`,
                        flexShrink: 0,
                      }}
                    >
                      {isRisk ? "⚠ RISK" : "★ LEAD"}
                    </span>
                    <button
                      type="button"
                      onClick={() => onTicker && onTicker(s.ticker)}
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        fontFamily: MONO,
                        fontWeight: 800,
                        fontSize: 11.5,
                        color: A.text,
                        cursor: onTicker ? "pointer" : "default",
                        flexShrink: 0,
                      }}
                    >
                      {s.ticker}
                    </button>
                    <span style={{ color: A.textDim }}>{s.note}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* 4. Grounded Web Sources */}
          {Array.isArray(data.sources) && data.sources.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5, paddingTop: 4, borderTop: `1px solid ${A.border}` }}>
              <span style={{ fontSize: 9.5, fontFamily: MONO, fontWeight: 700, color: A.textMuted }}>
                SOURCES:
              </span>
              {data.sources.slice(0, 6).map((src, i) => {
                const href = safeUrl(src?.url);
                if (!href) return null;
                return (
                  <a
                    key={`${href}-${i}`}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={src.title || href}
                    style={{
                      fontSize: 10,
                      color: A.cyan,
                      background: A.bg,
                      border: `1px solid ${A.border}`,
                      borderRadius: 4,
                      padding: "1px 6px",
                      textDecoration: "none",
                      maxWidth: 200,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {src.host || src.title}
                  </a>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
