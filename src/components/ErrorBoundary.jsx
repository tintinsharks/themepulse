import React from "react";
import { ARIA } from "../styles.js";

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, err: null, info: null };
  }
  static getDerivedStateFromError(err) {
    return { hasError: true, err };
  }
  componentDidCatch(err, info) {
    console.error("ErrorBoundary caught:", err, info);
    // Capture the component stack so we can display it
    this.setState({ info });
  }
  render() {
    if (this.state.hasError) {
      const stack = this.state.info?.componentStack || "";
      // Find the most-derived (first) custom component name in the stack
      // Lines look like: "    at ChartPanelInline (https://...)"
      const lines = stack.split("\n").filter((l) => l.trim().startsWith("at "));
      const firstLine = lines[0] || "";
      const m = firstLine.match(/at\s+(\w+)/);
      const culprit = m ? m[1] : "unknown";
      return (
        <div style={{ padding: 16, color: ARIA.red, fontFamily: "monospace" }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
            Render error in <span style={{ color: ARIA.yellow }}>{culprit}</span>
          </div>
          <div style={{ fontSize: 10, color: ARIA.textDim, marginBottom: 8 }}>
            {String(this.state.err)}
          </div>
          {stack && (
            <details style={{ marginBottom: 8 }}>
              <summary
                style={{
                  fontSize: 9,
                  color: ARIA.textMuted,
                  cursor: "pointer",
                }}
              >
                Component stack (top 8)
              </summary>
              <pre
                style={{
                  fontSize: 9,
                  color: ARIA.textDim,
                  background: ARIA.bg,
                  padding: 8,
                  borderRadius: 4,
                  overflow: "auto",
                  maxHeight: 200,
                  marginTop: 4,
                  whiteSpace: "pre-wrap",
                }}
              >
                {lines.slice(0, 8).join("\n")}
              </pre>
            </details>
          )}
          <button
            onClick={() =>
              this.setState({ hasError: false, err: null, info: null })
            }
            style={{
              padding: "6px 14px",
              background: "transparent",
              border: `1px solid ${ARIA.green}`,
              color: ARIA.green,
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 11,
              fontFamily: "monospace",
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
