import test from "node:test";
import assert from "node:assert/strict";
import {
  parseOptionSymbol,
  parseMoney,
  parseDate,
  splitCsvLine,
  lifecycleDates,
  parseSchwabRealized,
  mergeTrades,
  applyClearTombstone,
  economicBasis,
} from "../src/wheelTrades.js";

test("parseOptionSymbol handles Schwab compact and 21-char OCC formats", () => {
  assert.deepEqual(parseOptionSymbol("-NVDA260812P200"), {
    underlying: "NVDA",
    expiry: "2026-08-12",
    type: "PUT",
    strike: 200,
    short: true,
  });
  assert.deepEqual(parseOptionSymbol("NVDA  260812C00205500"), {
    underlying: "NVDA",
    expiry: "2026-08-12",
    type: "CALL",
    strike: 205.5,
    short: false,
  });
  assert.equal(parseOptionSymbol("NVDA"), null);
});

test("parseMoney handles currency, signs, parentheses, and blanks", () => {
  assert.equal(parseMoney("$1,396.63"), 1396.63);
  assert.equal(parseMoney("+$1,096.68"), 1096.68);
  assert.equal(parseMoney("($281.44)"), -281.44);
  assert.equal(parseMoney("-42.5"), -42.5);
  assert.equal(parseMoney("--"), null);
  assert.equal(parseMoney("N/A"), null);
});

test("parseDate handles MM/DD/YYYY, ISO, and month-name formats", () => {
  assert.equal(parseDate("04/09/2026"), "2026-04-09");
  assert.equal(parseDate("2026-04-09T12:00:00Z"), "2026-04-09");
  assert.equal(parseDate("Apr 9, 2026"), "2026-04-09");
  assert.equal(parseDate("Apr-09-2026"), "2026-04-09");
  assert.equal(parseDate("bad"), null);
});

test("splitCsvLine preserves quoted commas and escaped quotes", () => {
  assert.deepEqual(splitCsvLine('"-NVDA260812P200","NVIDIA, Inc. ""Put""","$1,200.00"'), [
    "-NVDA260812P200",
    'NVIDIA, Inc. "Put"',
    "$1,200.00",
  ]);
});

test("lifecycleDates inverts Acquired/Sold for short options", () => {
  const cols = { acquired: 0, soldDate: 1 };
  const cells = ["04/18/2026", "04/01/2026"];
  assert.deepEqual(lifecycleDates(cols, cells, true), {
    opened: "2026-04-01",
    closed: "2026-04-18",
  });
  assert.deepEqual(lifecycleDates(cols, cells, false), {
    opened: "2026-04-18",
    closed: "2026-04-01",
  });
});

test("parseSchwabRealized parses options, skips stocks/totals, and computes gain", () => {
  const csv = [
    "Realized Gain/Loss — Account XXXX-1234",
    "Symbol,Name,Opened Date,Closed Date,Quantity,Proceeds,Cost Basis",
    '"-NVDA260812P200","PUT NVDA",04/01/2026,04/10/2026,2,"$2,493.31","$1,396.63"',
    '"NVDA","NVIDIA CORP",01/01/2026,04/10/2026,100,"$15,000.00","$12,000.00"',
    '"Total","","","","","$17,493.31","$13,396.63"',
  ].join("\n");

  const res = parseSchwabRealized(csv);
  assert.equal(res.errors.length, 0);
  assert.equal(res.skippedNonOption, 1);
  assert.equal(res.trades.length, 1);
  assert.equal(res.trades[0].underlying, "NVDA");
  assert.equal(res.trades[0].realized, 1096.68);
});

test("mergeTrades dedupes and applyClearTombstone drops pre-clear trades", () => {
  const t1 = {
    symbol: "-NVDA260812P200", underlying: "NVDA", opened: "2026-04-01", closed: "2026-04-10",
    contracts: 2, collected: 2493.31, paid: 1396.63, importedAt: "2026-04-01T00:00:00.000Z",
  };
  const t2 = {
    symbol: "-PLTR260812P100", underlying: "PLTR", opened: "2026-04-06", closed: "2026-04-10",
    contracts: 1, collected: 500, paid: 100, importedAt: "2026-04-10T00:00:00.000Z",
  };
  const merged = mergeTrades([t1], [t1, t2], "2026-04-10T00:00:00.000Z");
  assert.equal(merged.trades.length, 2);
  const afterClear = applyClearTombstone(merged.trades, "2026-04-05T00:00:00.000Z");
  assert.deepEqual(afterClear.map((t) => t.underlying), ["PLTR"]);
});

test("economicBasis reduces assignment strike by net premium per share", () => {
  assert.deepEqual(economicBasis(200, 2, 1000), { offsetPerShare: 5, basis: 195 });
});
