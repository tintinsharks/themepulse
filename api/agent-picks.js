// api/agent-picks.js — RVol scanner picks + commentary
//
// POST: from local cron (09r_rvol_catalyst_scan.py) with bearer RVOL_SCANNER_TOKEN
// GET:  from React app (/api/agent-picks)
//
// Body shape on POST:
//   { picks: [...], commentary: { market, subthemes, patterns } }

import { makePicksHandler } from "./_picks-store.js";

export const config = { maxDuration: 10 };

export default makePicksHandler("tp_agent_picks");
