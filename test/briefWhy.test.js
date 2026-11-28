import test from "node:test";
import assert from "node:assert/strict";
import briefWhyHandler, {
  buildCacheKey,
  buildWhyPrompt,
  extractGroundingSources,
  parseGeminiWhyResponse,
} from "../api/brief-why.js";
import { createToken } from "../api/auth.js";

function mockRes() {
  const headers = {};
  return {
    statusCode: 200,
    headers,
    body: null,
    setHeader(k, v) { headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

const SAMPLE_CLUSTERS = [
  {
    theme: "Cybersecurity",
    count: 7,
    aPlusACount: 4,
    avgChg: 4.2,
    avgZvr: 1.9,
    breakoutCount: 3,
    pp2Count: 2,
    subLayers: [{ name: "Zero Trust", count: 4 }, { name: "Endpoint", count: 3 }],
    topTickers: [
      { ticker: "CRWD", grade: "A+", aPlusScore: 88, chg: 5.4, zvr: 2.3 },
      { ticker: "PANW", grade: "A", aPlusScore: 76, chg: 3.1, zvr: 1.7 },
    ],
    catalysts: [{ ticker: "CRWD", title: "CRWD raises full-year ARR guidance on enterprise AI security demand" }],
  },
  {
    theme: "Internet",
    count: 11,
    aPlusACount: 5,
    avgChg: 3.6,
    avgZvr: 1.6,
    breakoutCount: 4,
    pp2Count: 3,
    subLayers: [{ name: "E-Commerce", count: 6 }],
    topTickers: [{ ticker: "APP", grade: "A+", aPlusScore: 84, chg: 6.1, zvr: 2.1 }],
    catalysts: [],
  },
];

test("buildCacheKey produces stable signature from date, session, and cluster leaders", () => {
  const k1 = buildCacheKey({ date: "2026-04-20", session: "intraday", clusters: SAMPLE_CLUSTERS });
  const k2 = buildCacheKey({ date: "2026-04-20", session: "intraday", clusters: SAMPLE_CLUSTERS });
  assert.equal(k1, k2);
  assert.match(k1, /^2026-04-20::intraday::Cybersecurity:7:CRWD,PANW\|Internet:11:APP$/);
});

test("buildWhyPrompt embeds macro tape, clusters, and JSON schema rules", () => {
  const prompt = buildWhyPrompt({
    date: "2026-04-20",
    session: "pm",
    macro: { spy: 0.9, qqq: 1.4, vix: 14.2, us10y: 4.21, decision: "YES", score: 82 },
    clusters: SAMPLE_CLUSTERS,
    topLeaders: [{ ticker: "CRWD", grade: "A+", aPlusScore: 88, theme: "Cybersecurity", layer: "Zero Trust", chg: 5.4, zvr: 2.3, cr: 91, rs: 96, ppCount: 3, earningsDays: 4 }],
  });
  assert.match(prompt, /Post-Market Close/);
  assert.match(prompt, /SPY \+0\.9%/);
  assert.match(prompt, /Cybersecurity: 7 Go-To names/);
  assert.match(prompt, /Internet: 11 Go-To names/);
  assert.match(prompt, /CRWD \(A\+ 88/);
  assert.match(prompt, /ER in 4d/);
  assert.match(prompt, /"macroTakeaway"/);
});

test("extractGroundingSources dedupes URLs, strips non-http links, and extracts hostnames", () => {
  const sources = extractGroundingSources({
    groundingMetadata: {
      groundingChunks: [
        { web: { uri: "https://www.reuters.com/tech/crwd-guidance", title: "Reuters" } },
        { web: { uri: "https://www.reuters.com/tech/crwd-guidance", title: "Duplicate" } },
        { web: { uri: "javascript:alert(1)", title: "Bad" } },
        { web: { uri: "https://www.cnbc.com/markets/cyber-rally", title: "CNBC Cyber Rally" } },
      ],
    },
  });
  assert.equal(sources.length, 2);
  assert.equal(sources[0].host, "reuters.com");
  assert.equal(sources[1].host, "cnbc.com");
});

test("parseGeminiWhyResponse strips markdown fences, aligns theme names, and normalizes standouts", () => {
  const raw = {
    candidates: [
      {
        content: {
          parts: [
            {
              text: "```json\n" + JSON.stringify({
                macroTakeaway: "Falling 10Y yields sparked broad growth and software accumulation.",
                themes: [
                  { theme: "cybersecurity", why: "CRWD guidance raise sparked sympathy breakouts across Zero Trust peers." },
                  { theme: "Internet", why: "Strong digital ad checks lifted APP and e-commerce leaders." },
                ],
                standouts: [
                  { ticker: "crwd", kind: "leader", note: "A+ institutional breakout on 2.3x vol." },
                  { ticker: "APP", kind: "risk", note: "Approaching earnings next week — manage size." },
                ],
              }) + "\n```",
            },
          ],
        },
        groundingMetadata: {
          groundingChunks: [
            { web: { uri: "https://www.barrons.com/articles/cyber", title: "Barron's" } },
          ],
        },
      },
    ],
  };

  const out = parseGeminiWhyResponse(raw, ["Cybersecurity", "Internet"]);
  assert.equal(out.ok, true);
  assert.match(out.macroTakeaway, /Falling 10Y yields/);
  assert.equal(out.themes.length, 2);
  assert.equal(out.themes[0].theme, "Cybersecurity");
  assert.equal(out.themes[1].theme, "Internet");
  assert.equal(out.standouts[0].ticker, "CRWD");
  assert.equal(out.standouts[0].kind, "leader");
  assert.equal(out.standouts[1].kind, "risk");
  assert.equal(out.sources[0].host, "barrons.com");
});

test("parseGeminiWhyResponse fails cleanly on non-JSON output", () => {
  const out = parseGeminiWhyResponse({
    candidates: [{ content: { parts: [{ text: "Sorry, cannot produce JSON right now." }] } }],
  }, ["Cybersecurity"]);
  assert.equal(out.ok, false);
  assert.equal(out.error, "parse_failed");
});

test("/api/brief-why handles method check, missing API key, empty clusters, live call, and warm cache", async () => {
  const prevPin = process.env.TP_PIN;
  const prevSecret = process.env.TP_SESSION_SECRET;
  const prevKey = process.env.GEMINI_API_KEY;
  const origFetch = globalThis.fetch;

  try {
    process.env.TP_PIN = "2468";
    process.env.TP_SESSION_SECRET = "test-secret";
    const tok = createToken("2468");
    const authHeaders = { authorization: `Bearer ${tok}` };

    // 1. GET -> 405
    const rMethod = mockRes();
    await briefWhyHandler({ method: "GET", headers: authHeaders }, rMethod);
    assert.equal(rMethod.statusCode, 405);

    // 2. Missing GEMINI_API_KEY -> 503 with helpful message
    delete process.env.GEMINI_API_KEY;
    const rNoKey = mockRes();
    await briefWhyHandler({ method: "POST", headers: authHeaders, body: { clusters: SAMPLE_CLUSTERS } }, rNoKey);
    assert.equal(rNoKey.statusCode, 503);
    assert.equal(rNoKey.body.error, "missing_api_key");
    assert.match(rNoKey.body.message, /GEMINI_API_KEY/);

    // 3. Empty clusters -> 400
    process.env.GEMINI_API_KEY = "fake-test-key";
    const rEmpty = mockRes();
    await briefWhyHandler({ method: "POST", headers: authHeaders, body: { clusters: [] } }, rEmpty);
    assert.equal(rEmpty.statusCode, 400);
    assert.equal(rEmpty.body.error, "no_clusters");

    // 4. Successful Gemini call + warm cache hit + force refresh
    let fetchCalls = 0;
    globalThis.fetch = async (url, opts) => {
      fetchCalls += 1;
      assert.match(String(url), /generativelanguage\.googleapis\.com/);
      const sent = JSON.parse(opts.body);
      assert.deepEqual(sent.tools, [{ google_search: {} }]);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      macroTakeaway: "Software and internet names led on easing rates.",
                      themes: [
                        { theme: "Cybersecurity", why: "CRWD beat and raised guidance." },
                        { theme: "Internet", why: "Ad-tech demand drove APP breakout." },
                      ],
                      standouts: [
                        { ticker: "CRWD", kind: "leader", note: "Top A+ breakout leader." },
                      ],
                    }),
                  },
                ],
              },
              groundingMetadata: {
                groundingChunks: [
                  { web: { uri: "https://www.reuters.com/markets/test", title: "Reuters" } },
                ],
              },
            },
          ],
        }),
      };
    };

    const reqBody = { date: "2026-04-20", session: "intraday", clusters: SAMPLE_CLUSTERS };
    const r1 = mockRes();
    await briefWhyHandler({ method: "POST", headers: authHeaders, body: reqBody }, r1);
    assert.equal(r1.statusCode, 200);
    assert.equal(r1.body.ok, true);
    assert.equal(r1.body.cached, false);
    assert.equal(fetchCalls, 1);
    assert.equal(r1.body.themes.length, 2);
    assert.equal(r1.body.sources[0].host, "reuters.com");

    // Second call hits warm server cache without invoking Gemini again
    const r2 = mockRes();
    await briefWhyHandler({ method: "POST", headers: authHeaders, body: reqBody }, r2);
    assert.equal(r2.statusCode, 200);
    assert.equal(r2.body.cached, true);
    assert.equal(fetchCalls, 1);

    // Force refresh bypasses cache
    const r3 = mockRes();
    await briefWhyHandler({ method: "POST", headers: authHeaders, body: { ...reqBody, force: true } }, r3);
    assert.equal(r3.statusCode, 200);
    assert.equal(r3.body.cached, false);
    assert.equal(fetchCalls, 2);
  } finally {
    globalThis.fetch = origFetch;
    if (prevPin === undefined) delete process.env.TP_PIN; else process.env.TP_PIN = prevPin;
    if (prevSecret === undefined) delete process.env.TP_SESSION_SECRET; else process.env.TP_SESSION_SECRET = prevSecret;
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = prevKey;
  }
});
