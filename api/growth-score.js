// api/growth-score.js — Financial growth scoring via FMP
// Returns CAN SLIM-style letter grades for growth quality metrics
// that the pipeline doesn't compute (FCF growth, margin trend, multi-year CAGRs).
//
// GET /api/growth-score?ticker=NVDA
// Env vars: FMP_API_KEY

export const config = { maxDuration: 15 };

const FMP = "https://financialmodelingprep.com/stable";

async function fmp(path, apiKey) {
  const r = await fetch(`${FMP}${path}&apikey=${apiKey}`);
  if (!r.ok) return null;
  return r.json();
}

function gradeBand(v, thresholds) {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= thresholds[0]) return "A+";
  if (v >= thresholds[1]) return "A";
  if (v >= thresholds[2]) return "B";
  if (v >= thresholds[3]) return "C";
  if (v >= thresholds[4]) return "D";
  return "F";
}

function composite(grades) {
  const ord = { "A+": 5, A: 4, B: 3, C: 2, D: 1, F: 0 };
  const nums = grades.map(g => ord[g]).filter(n => n != null);
  if (!nums.length) return "—";
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  const letters = ["A+", "A", "B", "C", "D", "F"];
  return letters[Math.max(0, Math.min(5, 5 - Math.round(avg)))];
}

export default async function handler(req, res) {
  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: "ticker required" });

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "FMP_API_KEY not set" });

  const [growth, metrics, income] = await Promise.all([
    fmp(`/financial-growth?symbol=${ticker}&period=annual&limit=5`, apiKey),
    fmp(`/key-metrics?symbol=${ticker}&period=annual&limit=2`, apiKey),
    fmp(`/income-statement?symbol=${ticker}&period=quarter&limit=8`, apiKey),
  ]);

  if (!growth?.length && !metrics?.length && !income?.length) {
    return res.status(404).json({ error: "no data", ticker });
  }

  const latest = growth?.[0] || {};
  const prev = growth?.[1] || {};
  const met = metrics?.[0] || {};

  // Quarterly EPS acceleration (compare most recent 2 quarters YoY growth)
  let qtrAccel = null;
  if (income?.length >= 5) {
    const q0 = income[0], q4 = income[4]; // most recent vs year-ago
    const q1 = income[1], q5 = income[5]; // prior quarter vs its year-ago
    if (q0?.eps && q4?.eps && q4.eps > 0 && q1?.eps && q5?.eps && q5.eps > 0) {
      const g0 = (q0.eps - q4.eps) / Math.abs(q4.eps) * 100;
      const g1 = (q1.eps - q5.eps) / Math.abs(q5.eps) * 100;
      qtrAccel = g0 - g1;
    }
  }

  // Revenue acceleration
  let revAccel = null;
  if (income?.length >= 5) {
    const q0 = income[0], q4 = income[4];
    const q1 = income[1], q5 = income[5];
    if (q0?.revenue && q4?.revenue && q4.revenue > 0 && q1?.revenue && q5?.revenue && q5.revenue > 0) {
      const g0 = (q0.revenue - q4.revenue) / q4.revenue * 100;
      const g1 = (q1.revenue - q5.revenue) / q5.revenue * 100;
      revAccel = g0 - g1;
    }
  }

  // Margin trend (latest quarter vs 4 quarters ago)
  let marginTrend = null;
  if (income?.length >= 5) {
    const m0 = income[0]?.netIncome / income[0]?.revenue;
    const m4 = income[4]?.netIncome / income[4]?.revenue;
    if (Number.isFinite(m0) && Number.isFinite(m4)) {
      marginTrend = (m0 - m4) * 100; // pp change
    }
  }

  const epsGrowth = latest.epsgrowth != null ? latest.epsgrowth * 100 : null;
  const revGrowth = latest.revenueGrowth != null ? latest.revenueGrowth * 100 : null;
  const fcfGrowth = latest.freeCashFlowGrowth != null ? latest.freeCashFlowGrowth * 100 : null;
  const threeYRevGrowth = latest.threeYRevenueGrowthPerShare != null ? latest.threeYRevenueGrowthPerShare * 100 : null;
  const fiveYRevGrowth = latest.fiveYRevenueGrowthPerShare != null ? latest.fiveYRevenueGrowthPerShare * 100 : null;
  const roe = met.roe != null ? met.roe * 100 : null;
  const roic = met.roic != null ? met.roic * 100 : null;

  const scores = [
    { key: "EPS", label: "EPS Growth", value: epsGrowth, grade: gradeBand(epsGrowth, [80, 40, 20, 10, 0]) },
    { key: "REV", label: "Rev Growth", value: revGrowth, grade: gradeBand(revGrowth, [50, 25, 15, 8, 0]) },
    { key: "FCF", label: "FCF Growth", value: fcfGrowth, grade: gradeBand(fcfGrowth, [60, 30, 15, 5, -10]) },
    { key: "ACC", label: "EPS Accel", value: qtrAccel, grade: gradeBand(qtrAccel, [20, 8, 0, -8, -20]) },
    { key: "RAC", label: "Rev Accel", value: revAccel, grade: gradeBand(revAccel, [15, 5, 0, -5, -15]) },
    { key: "MGN", label: "Margin Δ", value: marginTrend, grade: gradeBand(marginTrend, [5, 2, 0, -2, -5]) },
    { key: "ROE", label: "ROE", value: roe, grade: gradeBand(roe, [30, 20, 12, 8, 0]) },
    { key: "ROIC", label: "ROIC", value: roic, grade: gradeBand(roic, [25, 15, 10, 6, 0]) },
    { key: "3YR", label: "3Y Rev CAGR", value: threeYRevGrowth, grade: gradeBand(threeYRevGrowth, [30, 20, 12, 6, 0]) },
    { key: "5YR", label: "5Y Rev CAGR", value: fiveYRevGrowth, grade: gradeBand(fiveYRevGrowth, [25, 15, 10, 5, 0]) },
  ];

  const comp = composite(scores.map(s => s.grade).filter(g => g !== "—"));

  res.setHeader("Cache-Control", "public, max-age=604800, stale-while-revalidate=86400");
  return res.status(200).json({
    ticker,
    composite: comp,
    scores,
    raw: {
      epsGrowth, revGrowth, fcfGrowth, qtrAccel, revAccel,
      marginTrend, roe, roic, threeYRevGrowth, fiveYRevGrowth,
    },
  });
}
