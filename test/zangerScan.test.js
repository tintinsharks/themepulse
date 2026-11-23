import test from "node:test";
import assert from "node:assert/strict";
import { scoreZangerCandidate } from "../scripts/zanger-scan.mjs";

const sat = new Date("2026-11-21T18:00:00Z");

test("scoreZangerCandidate flags Dan Zanger breakout (ZVR>=2x, chg>=3%, CR>=70%, near 52wH)", () => {
  const s = {
    ticker: "NVDA",
    company: "NVIDIA Corp",
    avg_dollar_vol_raw: 500e6,
    avg_vol_10d: 1_000_000,
    above_50ma: true,
    rs_rank: 96,
    eps_rating: 92,
    eps_accel: true,
    adr20: 4.2,
    off_52w_high: -2.5,
  };
  const q = { price: 145, dayHigh: 146, dayLow: 138, change: 4.5, volume: 2_600_000 };
  const layer = { theme: "AI Infra", name: "Compute Silicon", st: "lead", now: 95 };

  const res = scoreZangerCandidate({ s, q, layer, tier: "lead", profiles: null, now: sat });
  assert.equal(res.qualifiesZanger, true);
  assert.equal(res.isBreakout, true);
  assert.equal(res.zvr, 2.6);
  assert.equal(res.cr, 88);
  assert.ok(res.score > 75);
});

test("scoreZangerCandidate rejects low-volume, weak-close, or buyout-pinned names", () => {
  const base = {
    ticker: "TEST",
    avg_dollar_vol_raw: 50e6,
    avg_vol_10d: 1_000_000,
    above_50ma: true,
    rs_rank: 92,
    adr20: 3.5,
    off_52w_high: -3.0,
  };
  const layer = { theme: "Cyber", name: "Platform", st: "lead", now: 94 };

  // Low ZVR (0.8x) -> does not qualify as Zanger volume mover
  const lowVol = scoreZangerCandidate({
    s: base,
    q: { price: 100, dayHigh: 101, dayLow: 96, change: 3.5, volume: 800_000 },
    layer,
    tier: "lead",
    profiles: null,
    now: sat,
  });
  assert.equal(lowVol.qualifiesZanger, false);

  // Weak close (CR 20%) -> rejected
  const weakClose = scoreZangerCandidate({
    s: base,
    q: { price: 97, dayHigh: 105, dayLow: 95, change: 2.0, volume: 2_500_000 },
    layer,
    tier: "lead",
    profiles: null,
    now: sat,
  });
  assert.equal(weakClose.qualifiesZanger, false);

  // Buyout-pinned (ADR 0.4%) -> filtered out completely
  const pinned = scoreZangerCandidate({
    s: { ...base, adr20: 0.4 },
    q: { price: 100, dayHigh: 100.2, dayLow: 99.8, change: 2.0, volume: 3_000_000 },
    layer,
    tier: null,
    profiles: null,
    now: sat,
  });
  assert.equal(pinned, null);
});
