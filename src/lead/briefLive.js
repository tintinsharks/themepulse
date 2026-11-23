// Pure helpers for overlaying live intraday quotes & macro data onto static
// Written Brief snapshots (public/data/briefs/brief-*.json).

export function evalPivotStatus(price, { pivot, buyZoneMax, stop } = {}) {
  if (typeof price !== "number" || !Number.isFinite(price)) return null;
  if (typeof stop === "number" && price <= stop) {
    return {
      state: "stopped",
      label: "< STOP",
      detail: `${(((price / stop) - 1) * 100).toFixed(1)}% vs stop`,
      tone: "red",
    };
  }
  if (typeof pivot === "number" && pivot > 0) {
    const pctFromPivot = ((price / pivot) - 1) * 100;
    const maxBuy = typeof buyZoneMax === "number" && buyZoneMax >= pivot ? buyZoneMax : pivot * 1.05;
    if (price >= pivot && price <= maxBuy) {
      return {
        state: "buy_zone",
        label: "IN BUY ZONE",
        detail: `+${pctFromPivot.toFixed(1)}% above pivot`,
        tone: "green",
      };
    }
    if (price > maxBuy) {
      return {
        state: "extended",
        label: "EXTENDED",
        detail: `+${pctFromPivot.toFixed(1)}% above pivot`,
        tone: "yellow",
      };
    }
    const near = pctFromPivot >= -2.0;
    return {
      state: near ? "near_pivot" : "below_pivot",
      label: `${pctFromPivot.toFixed(1)}% to pivot`,
      detail: near ? "Approaching pivot" : "Below pivot",
      tone: near ? "cyan" : "muted",
    };
  }
  return null;
}

export function matchMacroLive(item, mq) {
  if (!item?.name || !mq) return null;
  const name = String(item.name).toLowerCase();
  const tape = Array.isArray(mq.tape) ? mq.tape : [];
  const futures = Array.isArray(mq.futures) ? mq.futures : [];
  const findTape = (tk) => tape.find((x) => x?.ticker === tk);
  const findFut = (re) => futures.find((x) => re.test(String(x?.name || "")));

  const fmtChg = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
  };

  if (/\bvix\b/.test(name)) {
    const t = findTape("VIX");
    if (t?.price != null) return { value: Number(t.price).toFixed(2), change: fmtChg(t.change) };
  }
  if (/10y|tnx|treasury|yield/.test(name)) {
    const t = findTape("TNX");
    if (t?.price != null) return { value: `${Number(t.price).toFixed(2)}%`, change: fmtChg(t.change) };
  }
  if (/dxy|dollar/.test(name)) {
    const t = findTape("DXY");
    if (t?.price != null) return { value: Number(t.price).toFixed(2), change: fmtChg(t.change) };
  }
  if (/wti|crude|oil/.test(name)) {
    const f = findFut(/crude|oil/i);
    if (typeof f?.price === "number") return { value: `$${f.price.toFixed(2)}`, change: fmtChg(f.changePct) };
  }
  if (/gold/.test(name)) {
    const f = findFut(/gold/i);
    if (typeof f?.price === "number") return { value: `$${f.price.toFixed(2)}`, change: fmtChg(f.changePct) };
  }
  if (/btc|bitcoin/.test(name)) {
    const f = findFut(/btc|bitcoin/i);
    if (typeof f?.price === "number") return { value: `$${Math.round(f.price).toLocaleString()}`, change: fmtChg(f.changePct) };
  }
  return null;
}

export function collectBriefTickers(brief) {
  if (!brief) return [];
  const set = new Set();
  const add = (t) => {
    if (typeof t === "string" && /^[A-Z][A-Z0-9.-]{0,9}$/.test(t.trim().toUpperCase())) {
      set.add(t.trim().toUpperCase());
    }
  };
  for (const x of brief.regime?.indexes || []) add(x?.symbol);
  for (const f of brief.focusSetups || []) add(f?.ticker);
  for (const m of brief.extendedMovers || []) add(m?.ticker);
  for (const b of brief.breakdowns || []) add(b?.ticker);
  return [...set];
}
