import test from "node:test";
import assert from "node:assert/strict";
import { _cumVolFrac, getQuad, pipelineAgeWeekdays, isPipelineStale } from "../src/utils.js";
import authHandler, { createToken, verifyToken } from "../api/auth.js";
import userdataHandler from "../api/userdata.js";

test("_cumVolFrac is monotonic from 0 to 1 across RTH", () => {
  assert.equal(_cumVolFrac(-5), 0);
  assert.equal(_cumVolFrac(0), 0);
  assert.equal(_cumVolFrac(390), 1);
  assert.equal(_cumVolFrac(450), 1);
  let prev = 0;
  for (let m = 15; m <= 390; m += 15) {
    const f = _cumVolFrac(m);
    assert.ok(f > prev, `expected ${f} > ${prev} at minute ${m}`);
    prev = f;
  }
});

test("getQuad maps weekly/monthly RS scores to quadrants", () => {
  assert.equal(getQuad(60, 70), "STRONG");
  assert.equal(getQuad(60, 40), "IMPROVING");
  assert.equal(getQuad(40, 60), "WEAKENING");
  assert.equal(getQuad(40, 40), "WEAK");
});

test("pipelineAgeWeekdays and isPipelineStale skip weekends and flag multi-day gaps", () => {
  // Friday 2026-11-20 → Monday 2026-11-23 is 1 weekday (fresh)
  const mon = new Date(2026, 10, 23, 10, 0);
  assert.equal(pipelineAgeWeekdays("2026-11-20", mon), 1);
  assert.equal(isPipelineStale("2026-11-20", mon), false);

  // Tuesday 2026-11-17 → Monday 2026-11-23 is 4 weekdays (Wed, Thu, Fri, Mon -> stale)
  assert.equal(pipelineAgeWeekdays("2026-11-17", mon), 4);
  assert.equal(isPipelineStale("2026-11-17", mon), true);

  // Future/same-day UTC run is fresh
  assert.equal(pipelineAgeWeekdays("2026-11-24", mon), 0);
  assert.equal(isPipelineStale("2026-11-24", mon), false);
});

test("auth createToken/verifyToken requires secret and rejects tampering", () => {
  const prevPin = process.env.TP_PIN;
  const prevSecret = process.env.TP_SESSION_SECRET;
  try {
    process.env.TP_PIN = "1234";
    delete process.env.TP_SESSION_SECRET;
    assert.throws(() => createToken("1234"), /TP_SESSION_SECRET/);
    assert.equal(verifyToken("anything.invalid"), false);

    process.env.TP_SESSION_SECRET = "unit-test-secret";
    const tok = createToken("1234");
    assert.equal(verifyToken(tok), true);
    assert.equal(verifyToken(tok + "x"), false);
    assert.equal(verifyToken(createToken("9999")), false);
  } finally {
    if (prevPin === undefined) delete process.env.TP_PIN; else process.env.TP_PIN = prevPin;
    if (prevSecret === undefined) delete process.env.TP_SESSION_SECRET; else process.env.TP_SESSION_SECRET = prevSecret;
  }
});

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  res.end = () => res;
  return res;
}

test("GET /api/auth reports configured/authenticated status accurately", async () => {
  const prevPin = process.env.TP_PIN;
  const prevSecret = process.env.TP_SESSION_SECRET;
  try {
    process.env.TP_PIN = "2468";
    process.env.TP_SESSION_SECRET = "test-secret";
    const tok = createToken("2468");

    const r1 = mockRes();
    await authHandler({ method: "GET", headers: {} }, r1);
    assert.equal(r1.statusCode, 200);
    assert.deepEqual(r1.body, { ok: true, configured: true, authenticated: false });

    const r2 = mockRes();
    await authHandler({ method: "GET", headers: { authorization: `Bearer ${tok}` } }, r2);
    assert.equal(r2.statusCode, 200);
    assert.deepEqual(r2.body, { ok: true, configured: true, authenticated: true });
  } finally {
    if (prevPin === undefined) delete process.env.TP_PIN; else process.env.TP_PIN = prevPin;
    if (prevSecret === undefined) delete process.env.TP_SESSION_SECRET; else process.env.TP_SESSION_SECRET = prevSecret;
  }
});

test("POST /api/userdata rejects unauthenticated writes on default and flags scopes", async () => {
  const prevPin = process.env.TP_PIN;
  const prevSecret = process.env.TP_SESSION_SECRET;
  const prevUrl = process.env.UPSTASH_REDIS_REST_URL;
  const prevTok = process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    process.env.TP_PIN = "2468";
    process.env.TP_SESSION_SECRET = "test-secret";
    process.env.UPSTASH_REDIS_REST_URL = "https://example.invalid";
    process.env.UPSTASH_REDIS_REST_TOKEN = "dummy";

    const r1 = mockRes();
    await userdataHandler({ method: "POST", query: {}, headers: {}, body: {} }, r1);
    assert.equal(r1.statusCode, 401);

    const r2 = mockRes();
    await userdataHandler({ method: "POST", query: { scope: "flags" }, headers: {}, body: { flags: {} } }, r2);
    assert.equal(r2.statusCode, 401);
  } finally {
    if (prevPin === undefined) delete process.env.TP_PIN; else process.env.TP_PIN = prevPin;
    if (prevSecret === undefined) delete process.env.TP_SESSION_SECRET; else process.env.TP_SESSION_SECRET = prevSecret;
    if (prevUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL; else process.env.UPSTASH_REDIS_REST_URL = prevUrl;
    if (prevTok === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN = prevTok;
  }
});
