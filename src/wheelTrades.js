// ── Closed option-trade parsing + wheel bookkeeping ──
//
// Parses Schwab's "Realized Gain/Loss" CSV export into closed option trades
// and derives the numbers the wheel actually runs on: premium collected,
// capture rate, and effective cost basis on assignment.
//
// Kept as a separate pure module so the parsing and the basis math can be
// unit-tested without a browser. Schwab's export format is not documented and
// has changed across versions, so the column mapping is deliberately fuzzy:
// match on header substrings rather than exact names or fixed positions.

// ── OCC-style option symbol ─────────────────────────────────────────────────
// "-NVDA260812P200"  → short NVDA 08/12/2026 200 put
// "NVDA  260812P00200000" (21-char OCC) is also accepted.
//
// The leading "-" is how Schwab marks a short position in this report, and it
// is the only thing distinguishing a sold put from a bought one. Without it we
// cannot tell a wheel trade from a long-put hedge, so it is preserved.
export function parseOptionSymbol(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const isShort = s.startsWith("-");
  const body = s.replace(/^-/, "").replace(/\s+/g, "");

  // Canonical 21-char OCC: ROOT + YYMMDD + C/P + 8-digit strike (3 implied decimals)
  let m = body.match(/^([A-Z.]{1,6})(\d{6})([CP])(\d{8})$/);
  if (m) {
    return {
      underlying: m[1],
      expiry: occDate(m[2]),
      type: m[3] === "P" ? "PUT" : "CALL",
      strike: Number(m[4]) / 1000,
      short: isShort,
    };
  }

  // Schwab's compact display form: ROOT + YYMMDD + C/P + plain strike
  m = body.match(/^([A-Z.]{1,6})(\d{6})([CP])(\d+(?:\.\d+)?)$/);
  if (m) {
    return {
      underlying: m[1],
      expiry: occDate(m[2]),
      type: m[3] === "P" ? "PUT" : "CALL",
      strike: Number(m[4]),
      short: isShort,
    };
  }

  return null;
}

function occDate(yymmdd) {
  const yy = Number(yymmdd.slice(0, 2));
  // Options expiries are never pre-2000; a 2-digit year always means 20xx.
  return `20${String(yy).padStart(2, "0")}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
}

// ── Number / date coercion ──────────────────────────────────────────────────
// Handles "$1,396.63", "(281.44)" for negatives, "--", "N/A", bare "".
export function parseMoney(v) {
  if (v == null) return null;
  let s = String(v).trim();
  if (!s || s === "--" || s === "-" || /^n\/?a$/i.test(s)) return null;
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
  // Schwab writes gains with an explicit leading "+" ("+$1,096.68"), so the
  // sign characters have to come off before the numeric test.
  s = s.replace(/[()$,\s]/g, "").replace(/^[-+]/, "");
  if (!s || !/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

const MONTHS = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

export function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // Month-name form — what the expanded lot view renders on screen
  // ("Apr-09-2025", "Apr 9, 2025"). Only the CSV export uses MM/DD/YYYY, and
  // copying off the screen is the likelier route for a one-off check.
  m = s.match(/^([A-Za-z]{3,9})[-\s]+(\d{1,2}),?[-\s]+(\d{4})$/);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) return `${m[3]}-${mo}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

// ── CSV ─────────────────────────────────────────────────────────────────────
// Minimal RFC4180-ish splitter: handles quoted fields containing commas and
// escaped double-quotes, which Schwab's "Name" column reliably contains.
export function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");

// Column resolution by fuzzy header match. Order matters: the first matching
// predicate wins, so more specific tests come first.
const COLUMN_TESTS = [
  ["symbol",    (h) => h === "symbol" || h.startsWith("symbol")],
  ["name",      (h) => h === "name" || h.includes("description")],
  ["closed",    (h) => h.includes("closed") && h.includes("date")],
  ["opened",    (h) => h.includes("opened") && h.includes("date")],
  // Schwab's expanded lot detail labels its date columns by position
  // mechanics ("Acquired" / "Date sold") rather than by trade lifecycle.
  ["acquired",  (h) => h === "acquired" || h === "dateacquired"],
  ["soldDate",  (h) => h === "datesold" || h === "solddate" || h === "sold"],
  ["quantity",  (h) => h === "quantity" || h === "qty" || h.includes("shares")],
  ["proceeds",  (h) => h.includes("proceeds")],
  ["cost",      (h) => h.includes("cost")],
  // Term-specific gain columns must be tested before the generic one.
  ["shortGain", (h) => h.includes("shortterm") && h.includes("gain")],
  ["longGain",  (h) => h.includes("longterm") && h.includes("gain")],
  ["gain",      (h) => h.includes("gain") && !h.includes("%") && !h.includes("percent")],
];

export function resolveColumns(headerCells) {
  const map = {};
  headerCells.forEach((raw, i) => {
    const h = norm(raw);
    if (!h) return;
    for (const [key, test] of COLUMN_TESTS) {
      if (map[key] === undefined && test(h)) { map[key] = i; return; }
    }
  });
  return map;
}

/**
 * Resolve when a trade opened and closed.
 *
 * "Opened Date"/"Closed Date" are already lifecycle-semantic and used as-is.
 * The lot-detail view instead gives "Acquired"/"Date sold", which describe
 * share movement, not the trade. For a SHORT option that ordering is
 * inverted: the sell-to-open comes first and the buy-to-close is the
 * "acquire". Reading those columns literally would report a short put as
 * closing before it opened and yield negative holding periods.
 */
export function lifecycleDates(cols, cells, isShort) {
  const at = (i) => (i !== undefined ? parseDate(cells[i]) : null);
  const opened = at(cols.opened);
  const closed = at(cols.closed);
  if (opened || closed) return { opened, closed };

  const acquired = at(cols.acquired);
  const sold = at(cols.soldDate);
  if (!acquired && !sold) return { opened: null, closed: null };

  return isShort
    ? { opened: sold, closed: acquired }
    : { opened: acquired, closed: sold };
}

const isTotalRow = (cells) => {
  const first = String(cells[0] || "").toLowerCase();
  return first.includes("total") || first.includes("subtotal") || first.startsWith("account");
};

/**
 * Parse a pasted Schwab Realized Gain/Loss export.
 *
 * Tolerates the preamble lines Schwab puts above the header, total/subtotal
 * rows, and stock rows mixed in with options (stock rows are reported
 * separately as `skipped` rather than silently dropped — a wheel that took
 * assignment will have both, and silently eating the stock rows would
 * misstate the picture).
 */
export function parseSchwabRealized(text) {
  const errors = [];
  const trades = [];
  let skippedNonOption = 0;

  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return { trades, errors: ["Nothing pasted."], skippedNonOption };

  // Find the header row: the first line that yields both a symbol and a
  // proceeds/cost column.
  let headerIdx = -1;
  let cols = null;
  for (let i = 0; i < Math.min(lines.length, 25); i++) {
    const c = resolveColumns(splitCsvLine(lines[i]));
    if (c.symbol !== undefined && (c.proceeds !== undefined || c.cost !== undefined)) {
      headerIdx = i;
      cols = c;
      break;
    }
  }

  if (headerIdx === -1) {
    return {
      trades,
      errors: ["Could not find a header row with Symbol and Proceeds/Cost columns. Paste the full CSV including its header line."],
      skippedNonOption,
    };
  }

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length < 2 || isTotalRow(cells)) continue;

    const rawSymbol = cells[cols.symbol];
    if (!rawSymbol) continue;

    const opt = parseOptionSymbol(rawSymbol);
    if (!opt) { skippedNonOption++; continue; }

    const proceeds = parseMoney(cells[cols.proceeds]);
    const cost = parseMoney(cells[cols.cost]);

    let gain = cols.gain !== undefined ? parseMoney(cells[cols.gain]) : null;
    if (gain == null && cols.shortGain !== undefined) gain = parseMoney(cells[cols.shortGain]);
    if (gain == null && cols.longGain !== undefined) gain = parseMoney(cells[cols.longGain]);
    // Derive rather than fail — proceeds/cost are the authoritative pair.
    // Round: binary floating point turns 2493.31 - 1396.63 into
    // 1096.6799999999998, which would surface raw in the UI.
    if (gain == null && proceeds != null && cost != null) {
      gain = Math.round((proceeds - cost) * 100) / 100;
    }

    if (proceeds == null && cost == null) {
      errors.push(`${rawSymbol}: no proceeds or cost value`);
      continue;
    }

    // Quantity is absolute; the short/long distinction lives on the symbol.
    const qtyRaw = cols.quantity !== undefined ? parseMoney(cells[cols.quantity]) : null;
    const contracts = qtyRaw != null ? Math.abs(qtyRaw) : null;

    trades.push({
      symbol: String(rawSymbol).trim(),
      underlying: opt.underlying,
      type: opt.type,
      strike: opt.strike,
      expiry: opt.expiry,
      short: opt.short,
      contracts,
      ...lifecycleDates(cols, cells, opt.short),
      // For a short option Schwab reports proceeds = credit received on the
      // sell-to-open and cost = debit paid on the buy-to-close.
      collected: opt.short ? proceeds : cost,
      paid: opt.short ? cost : proceeds,
      realized: gain,
    });
  }

  return { trades, errors, skippedNonOption };
}

// ── Merging imports ─────────────────────────────────────────────────────────

const fullKey = (t) =>
  `${t.symbol}|${t.opened || ""}|${t.closed || ""}|${t.contracts ?? ""}|${t.collected}|${t.paid}`;
const looseKey = (t) => `${t.symbol}|${t.collected}|${t.paid}`;

/**
 * Merge newly parsed trades into the stored set.
 *
 * Every incoming row claims at most one stored slot, and a claimed slot can't
 * be claimed again. That single rule handles three cases that otherwise
 * conflict:
 *
 *  - Re-importing the same export: each row exactly matches a distinct stored
 *    row, so nothing is added.
 *  - Pasting the on-screen table (no quantity or dates) and later the full
 *    export: no exact match exists, so the row enriches the thinner stored
 *    record instead of duplicating it.
 *  - Several genuinely separate lots of one contract that happen to carry
 *    identical amounts: the first claims a slot, the rest find none free and
 *    are appended. Collapsing them would silently understate premium — real
 *    lot data has pairs differing by a single cent, so identical pairs are
 *    only a rounding coin-flip away.
 */
export function mergeTrades(existing, incoming, now) {
  const stamp = now || new Date().toISOString();
  const store = (existing || []).map((t) => ({ ...t }));
  const claimed = new Set();
  let added = 0, enriched = 0, duplicates = 0;

  const findFree = (pred) => store.findIndex((s, i) => !claimed.has(i) && pred(s));

  for (const t of incoming || []) {
    const exact = findFree((s) => fullKey(s) === fullKey(t));
    if (exact >= 0) { claimed.add(exact); duplicates++; continue; }

    const thinner = findFree(
      (s) =>
        looseKey(s) === looseKey(t) &&
        ((s.contracts == null && t.contracts != null) ||
         (!s.opened && t.opened) ||
         (!s.closed && t.closed))
    );
    if (thinner >= 0) {
      claimed.add(thinner);
      for (const f of ["contracts", "opened", "closed", "realized"]) {
        const cur = store[thinner][f];
        if ((cur == null || cur === "") && t[f] != null && t[f] !== "") store[thinner][f] = t[f];
      }
      enriched++;
      continue;
    }

    // importedAt is what makes a cross-device "clear all" work: a clear
    // records a timestamp, and anything imported before it is dropped.
    store.push({ ...t, importedAt: t.importedAt || stamp });
    claimed.add(store.length - 1); // so a later identical row can't claim it
    added++;
  }

  return { trades: store, added, enriched, duplicates };
}

/**
 * Drop trades imported before a "clear all".
 *
 * Without this, clearing on one device is undone the moment another device
 * with a stale copy syncs — the union merge would faithfully restore every
 * deleted trade. The timestamp acts as a tombstone: only imports newer than
 * the clear survive. Trades predating the importedAt stamp have no timestamp
 * and are therefore also cleared, which is the intent.
 */
export function applyClearTombstone(trades, clearedAt) {
  if (!clearedAt) return trades || [];
  return (trades || []).filter((t) => t && t.importedAt && t.importedAt > clearedAt);
}

/** Newest of a set of ISO timestamps, or null. */
export function newestStamp(...stamps) {
  return stamps.filter(Boolean).sort().pop() || null;
}

// ── Wheel bookkeeping ───────────────────────────────────────────────────────

const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

/**
 * Aggregate closed trades into wheel metrics.
 *
 * Two different "cost basis" numbers fall out of this, and conflating them is
 * the classic wheel bookkeeping error, so both are returned explicitly:
 *
 *  - taxBasisOnAssignment — for a SINGLE put that gets assigned, the shares'
 *    basis is strike minus that put's own premium. Premium from previously
 *    CLOSED puts does not touch it; those are already realized gains and have
 *    been taxed. This is the number that belongs on a Schedule D.
 *
 *  - economicBasis — strike minus ALL net premium ever collected on the name.
 *    This is the "how much am I really in for" view a wheel trader thinks in.
 *    It is not a tax basis and must never be reported as one.
 */
export function summarizeTrades(trades, opts = {}) {
  const list = (trades || []).filter((t) => opts.underlying ? t.underlying === opts.underlying : true);

  const collected = list.reduce((s, t) => s + (t.collected || 0), 0);
  const paid = list.reduce((s, t) => s + (t.paid || 0), 0);
  const realized = list.reduce((s, t) => s + (t.realized || 0), 0);
  const wins = list.filter((t) => (t.realized || 0) > 0).length;

  const byYear = {};
  for (const t of list) {
    const y = (t.closed || t.expiry || "").slice(0, 4) || "unknown";
    if (!byYear[y]) byYear[y] = { year: y, n: 0, collected: 0, paid: 0, realized: 0 };
    byYear[y].n++;
    byYear[y].collected += t.collected || 0;
    byYear[y].paid += t.paid || 0;
    byYear[y].realized += t.realized || 0;
  }
  const years = Object.values(byYear)
    .map((y) => ({
      ...y,
      collected: r2(y.collected),
      paid: r2(y.paid),
      realized: r2(y.realized),
      capturePct: y.collected > 0 ? r2((y.realized / y.collected) * 100) : null,
    }))
    .sort((a, b) => (a.year < b.year ? -1 : 1));

  // Per-share figures need contract counts; Schwab's screen view omits them,
  // so treat them as unknown rather than assuming 1 contract.
  const withQty = list.filter((t) => t.contracts > 0);
  const missingQty = list.length - withQty.length;

  const perTrade = list.map((t) => {
    const shares = t.contracts > 0 ? t.contracts * 100 : null;
    const premiumPerShare = shares ? (t.collected || 0) / shares : null;
    const netPerShare = shares ? (t.realized || 0) / shares : null;
    const daysHeld = t.opened && t.closed
      ? Math.round((new Date(t.closed) - new Date(t.opened)) / 86400000)
      : null;

    // Collateral is what the trade actually tied up. For a short put that's
    // the cash securing it; a covered call is secured by shares, so its
    // capital commitment isn't comparable and is left null rather than faked.
    const collateral = t.type === "PUT" && t.short && shares ? t.strike * shares : null;
    const roc = collateral ? (t.realized || 0) / collateral : null;
    // Same-day trades still tie up collateral for a day — flooring at 1
    // avoids a divide-by-zero producing an infinite rate.
    const expDays = daysHeld != null ? Math.max(daysHeld, 1) : null;

    return {
      ...t,
      shares,
      premiumPerShare: r2(premiumPerShare),
      netPerShare: r2(netPerShare),
      capturePct: t.collected > 0 ? r2(((t.realized || 0) / t.collected) * 100) : null,
      daysHeld,
      collateral: collateral ? Math.round(collateral) : null,
      rocPct: roc != null ? r2(roc * 100) : null,
      annRocPct: roc != null && expDays ? r2(roc * (365 / expDays) * 100) : null,
      perContract: t.contracts > 0 ? r2((t.realized || 0) / t.contracts) : null,
      perDay: expDays ? r2((t.realized || 0) / expDays) : null,
      // Tax basis had THIS put been assigned instead of closed — its own
      // premium only.
      taxBasisOnAssignment: t.type === "PUT" && t.short && premiumPerShare != null
        ? r2(t.strike - premiumPerShare)
        : null,
    };
  });

  // Dollars first: rank by what was actually made, not by process quality.
  perTrade.sort((a, b) => (b.realized || 0) - (a.realized || 0));

  // Capital efficiency across the whole book. Collateral-days is the honest
  // denominator — $200k tied up for one day and $9k for five are not the
  // same commitment, and summing raw collateral would treat them alike.
  const priced = perTrade.filter((t) => t.collateral);
  const collateralDays = priced.reduce(
    (s, t) => s + t.collateral * Math.max(t.daysHeld ?? 1, 1),
    0
  );
  const pricedRealized = priced.reduce((s, t) => s + (t.realized || 0), 0);
  const totalCollateral = priced.reduce((s, t) => s + t.collateral, 0);

  return {
    count: list.length,
    wins,
    losses: list.length - wins,
    winRatePct: list.length ? r2((wins / list.length) * 100) : null,
    collected: r2(collected),
    paid: r2(paid),
    realized: r2(realized),
    capturePct: collected > 0 ? r2((realized / collected) * 100) : null,
    // Dollar-productivity view
    totalCollateral: totalCollateral ? Math.round(totalCollateral) : null,
    rocPct: totalCollateral ? r2((pricedRealized / totalCollateral) * 100) : null,
    annRocPct: collateralDays ? r2((pricedRealized / collateralDays) * 365 * 100) : null,
    avgPerContract: (() => {
      const n = list.reduce((s, t) => s + (t.contracts || 0), 0);
      return n ? r2(realized / n) : null;
    })(),
    best: perTrade[0] || null,
    // Share of total profit contributed by the top 3 trades — surfaces
    // whether the P/L came from a few sized-up trades or the whole book.
    top3SharePct: (() => {
      if (perTrade.length < 3 || realized <= 0) return null;
      const top3 = perTrade.slice(0, 3).reduce((s, t) => s + (t.realized || 0), 0);
      return r2((top3 / realized) * 100);
    })(),
    years,
    perTrade,
    missingQty,
  };
}

/**
 * Economic basis if assigned `contracts` at `strike`, after applying all net
 * premium collected. Explicitly NOT a tax basis — see summarizeTrades.
 */
export function economicBasis(strike, contracts, netPremium) {
  if (!(strike > 0) || !(contracts > 0)) return null;
  const offset = netPremium / (contracts * 100);
  return { offsetPerShare: r2(offset), basis: r2(strike - offset) };
}
