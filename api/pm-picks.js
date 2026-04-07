// api/pm-picks.js — Pre-market movers picks (from morning PM scan script)
//
// POSTed by /Users/nprabhak/Claude Bot/personal-assistant/scripts/pm_movers_scan.sh
// at ~6:03 AM PT weekdays.

import { makePicksHandler } from "./_picks-store.js";

export const config = { maxDuration: 10 };

export default makePicksHandler("tp_pm_picks");
