import test from "node:test";
import assert from "node:assert/strict";
import { rsi, ema, macd, detectSignals, signalStudy, currentSignalState } from "../src/indicators.js";

test("rsi produces null warmup and bounded values in [0, 100]", () => {
  const rising = Array.from({ length: 30 }, (_, i) => 100 + i * 2);
  const r = rsi(rising, 14);
  assert.equal(r.length, 30);
  assert.equal(r[13], null);
  assert.equal(r[14], 100);
  assert.equal(r[29], 100);

  const falling = Array.from({ length: 30 }, (_, i) => 200 - i * 2);
  const rf = rsi(falling, 14);
  assert.equal(rf[14], 0);
  assert.equal(rf[29], 0);
});

test("ema seeds with SMA and matches length", () => {
  const values = [10, 20, 30, 40, 50];
  const e = ema(values, 3);
  assert.deepEqual(e.slice(0, 3), [null, null, 20]);
  assert.equal(e[3], 30);
  assert.equal(e[4], 40);
});

test("macd aligns line, signal, and histogram", () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 4) * 10 + i * 0.2);
  const m = macd(closes);
  assert.equal(m.line.length, 60);
  assert.equal(m.signal.length, 60);
  assert.equal(m.hist.length, 60);
  assert.equal(m.line[24], null);
  assert.ok(typeof m.line[25] === "number");
  assert.equal(m.signal[32], null);
  assert.ok(typeof m.signal[33] === "number");
  assert.ok(Math.abs(m.hist[59] - (m.line[59] - m.signal[59])) < 1e-12);
});

test("detectSignals, signalStudy, and currentSignalState work on oscillating series", () => {
  const closes = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 5) * 25);
  const dates = closes.map((_, i) => `2026-01-${String((i % 28) + 1).padStart(2, "0")}`);
  const { events } = detectSignals(closes);
  assert.ok(events.length > 0);

  const study = signalStudy(closes, [5, 10]);
  assert.ok(study.baseline[5].n > 0);
  assert.equal(study.signals.length, 4);

  const state = currentSignalState(closes, dates);
  assert.ok(state.rsi >= 0 && state.rsi <= 100);
  assert.equal(typeof state.macdAboveSignal, "boolean");
  assert.ok(state.lastBullish && state.lastBullish.barsAgo >= 0);
});
