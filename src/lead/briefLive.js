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

const MON_MAP = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// Parse date from Finviz ("Today 09:42AM", "Nov-23-26 08:30AM", "09:42AM"),
// pipeline bracket timestamps ("[5/18/2026 9:00 PM]"), or ISO strings.
// Returns { ts: number|null, bareTime: boolean }.
export function parseHeadlineDate(raw, now = new Date()) {
  const s = String(raw || "").trim();
  if (!s) return { ts: null, bareTime: false };
  if (/^today\b/i.test(s)) return { ts: now.getTime(), bareTime: false };
  if (/^\d{1,2}:\d{2}\s*(?:AM|PM)?$/i.test(s)) return { ts: null, bareTime: true };

  // Finviz: "Nov-23-26 08:30AM" or "Nov-23-26"
  const fv = s.match(/\b([A-Za-z]{3})-(\d{1,2})-(\d{2})\b/);
  if (fv) {
    const m = MON_MAP[fv[1].toLowerCase()];
    if (m != null) {
      const yr = 2000 + Number(fv[3]);
      return { ts: Date.UTC(yr, m, Number(fv[2]), 12, 0, 0), bareTime: false };
    }
  }

  // Bracketed or inline US numeric date: "[5/18/2026 9:00 PM]" or "11/23/2026"
  const us = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (us) {
    return { ts: Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2]), 12, 0, 0), bareTime: false };
  }

  // ISO date: "2026-11-23"
  const iso = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    return { ts: Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12, 0, 0), bareTime: false };
  }

  const parsed = Date.parse(s);
  return { ts: Number.isFinite(parsed) ? parsed : null, bareTime: false };
}

// Keep only headlines within maxDays of `now`. Finviz news tables list the date
// on the first headline of a day and bare times ("09:15AM") on subsequent rows,
// so bare times inherit the most recent prior row's date.
export function filterRecentHeadlines(items, now = new Date(), maxDays = 14) {
  if (!Array.isArray(items) || !items.length) return [];
  const cutoff = now.getTime() - maxDays * 86400000;
  let lastTs = null;
  const out = [];
  for (const item of items) {
    const isStr = typeof item === "string";
    const title = isStr ? item : (item?.title || item?.headline || "");
    if (!title) continue;
    const rawDate = isStr ? item : (item?.date || item?.time || title);
    const { ts, bareTime } = parseHeadlineDate(rawDate, now);
    const effTs = bareTime ? (lastTs ?? now.getTime()) : ts;
    if (ts != null) lastTs = ts;
    // Drop headlines that have a known date older than maxDays
    if (effTs != null && effTs < cutoff) continue;
    out.push(item);
  }
  return out;
}
