// ── Shared utility functions extracted from App.jsx ──

/** Return a Date object representing the current time in US Eastern timezone */
export function getETNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}

/** Grade color map: A+ (dark green) through G (dark red) */
export const GRADE_COLORS = {
  "A+":"#1B7A2B","A":"#2E8B3C","A-":"#44A04D",
  "B+":"#5CB85C","B":"#78C878","B-":"#93D893",
  "C+":"#B0E8B0","C":"#CCF2CC","C-":"#E8F8E8",
  "D+":"#e5e5e5","D":"#FFF0F0","D-":"#FFE0E0",
  "E+":"#FFCECE","E":"#FFBABA","E-":"#FFA5A5",
  "F+":"#FF8C8C","F":"#FF7070","F-":"#FF5050",
  "G+":"#FF3030","G":"#E01010",
};

// ── Projected EOD RVol (Zanger-style volume signal) ──
// Uses empirical U-shaped cumulative volume curve instead of linear extrapolation.
// The first/last hours of trading carry ~22%/~28% of daily volume respectively,
// while midday half-hours carry only ~5% each. Linear projection (390/elapsed)
// massively over-projects early in the day; this curve corrects for that.
// Formula: projectedRVol = actualRVol / expectedCumulativeFraction(timeOfDay)
export const _volCurve = [ // [minutesSinceOpen, cumulativeFraction]
  [0,0],[30,.117],[60,.205],[90,.275],[120,.335],[150,.388],
  [180,.438],[210,.488],[240,.538],[270,.592],[300,.652],
  [330,.722],[360,.817],[390,1]
];

export function _cumVolFrac(mins) {
  if (mins <= 0) return 0;
  if (mins >= 390) return 1;
  for (let i = 1; i < _volCurve.length; i++) {
    if (mins <= _volCurve[i][0]) {
      const [m0, f0] = _volCurve[i - 1], [m1, f1] = _volCurve[i];
      return f0 + (f1 - f0) * ((mins - m0) / (m1 - m0));
    }
  }
  return 1;
}

export function projectedRVol(rv) {
  if (!rv || rv <= 0) return rv || 0;
  const et = getETNow();
  const open = new Date(et); open.setHours(9, 30, 0, 0);
  const close = new Date(et); close.setHours(16, 0, 0, 0);
  if (et <= open || et >= close) return rv; // pre-market or after close
  const frac = _cumVolFrac((et - open) / 60000);
  return frac > 0 ? rv / frac : rv;
}

/** Determine RS/TS quadrant from weekly/monthly scores */
export function getQuad(wrs, mrs) {
  if (wrs >= 50 && mrs >= 50) return "STRONG";
  if (wrs >= 50) return "IMPROVING";
  if (mrs >= 50) return "WEAKENING";
  return "WEAK";
}

/** Quadrant color palette */
export const QC = {
  STRONG: { bg: "#064e3b", text: "#4aad8c", tag: "#059669" },
  IMPROVING: { bg: "#422006", text: "#fcd34d", tag: "#d97706" },
  WEAKENING: { bg: "#431407", text: "#fdba74", tag: "#ea580c" },
  WEAK: { bg: "#450a0a", text: "#fca5a5", tag: "#dc2626" },
};
