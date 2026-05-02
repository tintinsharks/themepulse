// Quick test endpoint — DELETE AFTER USE
export const config = { maxDuration: 10 };
export default async function handler(req, res) {
  const fmpKey = process.env.FMP_API_KEY;
  const tests = {};
  // Try v3 earning_calendar
  try {
    const r1 = await fetch(`https://financialmodelingprep.com/api/v3/earning_calendar?from=2026-05-04&to=2026-05-08&apikey=${fmpKey}`);
    tests.v3_status = r1.status;
    if (r1.ok) {
      const d = await r1.json();
      tests.v3_count = Array.isArray(d) ? d.length : "not-array";
      tests.v3_sample = Array.isArray(d) ? d.slice(0, 3) : d;
    }
  } catch (e) { tests.v3_err = e.message; }
  // Try /stable/earnings-confirmed
  try {
    const r2 = await fetch(`https://financialmodelingprep.com/stable/earnings-confirmed?from=2026-05-04&to=2026-05-08&apikey=${fmpKey}`);
    tests.confirmed_status = r2.status;
    if (r2.ok) {
      const d = await r2.json();
      tests.confirmed_sample = Array.isArray(d) ? d.slice(0, 3) : d;
    }
  } catch (e) { tests.confirmed_err = e.message; }
  res.json(tests);
}
