import { useEffect, useState, useRef } from "react";
import { getAuthToken, setAuthToken, authHeaders } from "../utils.js";
import { useAriaTheme } from "../themeContext.js";

export function AuthGate({ children }) {
  const ARIA = useAriaTheme();
  const [status, setStatus] = useState(() => (getAuthToken() ? "checking" : "locked"));
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    let live = true;
    const hasTok = Boolean(getAuthToken());
    fetch("/api/auth", { headers: authHeaders(), cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d) {
          if (live && hasTok) setStatus("locked");
          return;
        }
        if (d.authenticated) {
          setStatus("unlocked");
        } else {
          if (hasTok) setAuthToken("");
          setStatus("locked");
          if (d.configured === false) setErr("Server auth not configured (set TP_PIN and TP_SESSION_SECRET in Vercel).");
        }
      })
      .catch(() => {
        if (live) setStatus("locked");
      });

    const onChanged = (e) => {
      if (e?.detail?.unlocked) { setErr(""); setStatus("unlocked"); }
      else setStatus("locked");
    };
    const onReq = () => {
      setErr("Session expired — enter PIN to unlock.");
      setStatus("locked");
    };
    window.addEventListener("tp-auth-changed", onChanged);
    window.addEventListener("tp-auth-required", onReq);
    return () => {
      live = false;
      window.removeEventListener("tp-auth-changed", onChanged);
      window.removeEventListener("tp-auth-required", onReq);
    };
  }, []);

  useEffect(() => {
    if (status === "locked") setTimeout(() => inputRef.current?.focus(), 20);
  }, [status]);

  if (status === "unlocked") return children;

  const submit = async (e) => {
    e.preventDefault();
    if (!pin.trim() || busy) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pin.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok || !d.token) {
        setErr(d.error || `Unlock failed (${r.status})`);
        return;
      }
      setAuthToken(d.token);
      setPin("");
      setStatus("unlocked");
    } catch {
      setErr("Network error — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: ARIA.vignette || ARIA.bg,
        color: ARIA.text,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 340,
          background: ARIA.bgCard,
          border: `1px solid ${ARIA.border}`,
          borderRadius: 12,
          padding: "28px 24px",
          boxShadow: ARIA.shadow || "0 16px 40px rgba(0,0,0,0.45)",
          textAlign: "center",
        }}
      >
        <div
          className="tp-wordmark"
          style={{
            fontSize: 20,
            fontWeight: 800,
            backgroundImage: `linear-gradient(135deg, ${ARIA.brand1 || ARIA.green}, ${ARIA.brand2 || ARIA.cyan})`,
            letterSpacing: 0.4,
            marginBottom: 4,
          }}
        >
          THEMEPULSE
        </div>
        <div style={{ fontSize: 11, color: ARIA.textMuted, fontFamily: "monospace", marginBottom: 20 }}>
          {status === "checking" ? "Verifying session…" : "Enter PIN to access dashboard"}
        </div>
        {status === "locked" && (
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input
              ref={inputRef}
              type="password"
              autoComplete="current-password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="PIN"
              style={{
                width: "100%",
                fontSize: 14,
                padding: "9px 12px",
                background: ARIA.bg,
                border: `1px solid ${ARIA.border}`,
                borderRadius: 6,
                color: ARIA.text,
                fontFamily: "monospace",
                textAlign: "center",
                letterSpacing: 3,
                outline: "none",
              }}
            />
            <button
              type="submit"
              disabled={busy}
              style={{
                width: "100%",
                padding: "9px 12px",
                background: "rgba(13,145,99,0.16)",
                border: `1px solid ${ARIA.green}`,
                color: ARIA.green,
                borderRadius: 6,
                cursor: busy ? "default" : "pointer",
                fontFamily: "monospace",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.8,
                textTransform: "uppercase",
              }}
            >
              {busy ? "Unlocking…" : "🔒 Unlock"}
            </button>
            {err && (
              <div style={{ fontSize: 10, color: ARIA.red, fontFamily: "monospace", lineHeight: 1.4 }}>
                {err}
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

export function LockButton({ ARIA }) {
  return (
    <button
      onClick={() => setAuthToken("")}
      title="Lock dashboard and clear session token"
      style={{
        background: "transparent",
        border: `1px solid ${ARIA.border}`,
        color: ARIA.textDim,
        padding: "4px 8px",
        borderRadius: 4,
        cursor: "pointer",
        fontFamily: "monospace",
        fontSize: 10,
        letterSpacing: 0.4,
      }}
    >
      🔒 Lock
    </button>
  );
}
