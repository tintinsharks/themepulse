// ── Centralized live-quote hook (backed by shared src/liveQuotes.js store) ──
import { useEffect, useState, useMemo, useRef } from "react";
import { quoteStore } from "../liveQuotes.js";

export function useLiveQuotes(tickers, _intervalMs) {
  const [tick, forceUpdate] = useState(0);
  const idRef = useRef(null);

  const tickerList = useMemo(
    () => (tickers || []).filter(Boolean),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [(tickers || []).slice().sort().join(",")]
  );

  useEffect(() => {
    if (tickerList.length === 0) return;
    idRef.current = quoteStore.register(tickerList, { rthMs: 30000, extMs: 120000, offMs: 0 });
    const unsub = quoteStore.subscribe(() => forceUpdate((n) => n + 1));
    return () => {
      unsub();
      if (idRef.current != null) {
        quoteStore.unregister(idRef.current);
        idRef.current = null;
      }
    };
  }, [tickerList]);

  const quotes = useMemo(() => {
    void tick;
    return quoteStore.getMap(tickerList);
  }, [tickerList, tick]);

  return { quotes, updated: quoteStore.getUpdated() };
}
