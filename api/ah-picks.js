// api/ah-picks.js — After-hours movers picks (from evening AH scan script)
//
// POSTed by /Users/nprabhak/Claude Bot/personal-assistant/scripts/ah_movers_scan.sh
// at ~8:03 PM PT weekdays.

import { makePicksHandler } from "./_picks-store.js";

export const config = { maxDuration: 10 };

export default makePicksHandler("tp_ah_picks");
