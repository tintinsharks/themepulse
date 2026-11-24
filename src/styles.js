// ── Shared style constants for ThemePulse ──
// Extracted from the most repeated inline style patterns in App.jsx.
// Adopt incrementally — spread into inline styles: { ...S.monoSmall, color: "#fff" }

// ── Typography ──

export const FONT_SANS = "'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif";
export const FONT_MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace";

export const monoTiny = { fontSize: 10, fontFamily: FONT_MONO };       // ~15 occurrences
export const monoSmall = { fontSize: 10.5, fontFamily: FONT_MONO };    // ~25 occurrences
export const monoMedium = { fontSize: 11.5, fontFamily: FONT_MONO };   // ~20 occurrences

// ── Colors ──

export const COLOR = {
  bg:         "#121218",  // main background
  bgCard:     "#1a1a24",  // card/panel background
  bgDark:     "#0d0d14",  // darker nested background
  green:      "#2bb886",  // positive values
  greenAccent:"#0d9163",  // brand green accent
  red:        "#f87171",  // negative values
  textMuted:  "#787888",  // muted/secondary text (29 occurrences)
  textDim:    "#686878",  // dimmer text (155 occurrences)
  textLight:  "#9090a0",  // light secondary text (68 occurrences)
  textDefault:"#d4d4e0",  // default text (37 occurrences)
  border:     "#2a2a38",  // standard border color (9 occurrences)
  cyan:       "#22d3ee",  // Earnings Intel accent
  gold:       "#e3b341",  // On Deck highlight
};

// ── Aria-faithful theme palettes (ported from Aria base.html) ──
// Two palettes: ARIA_DARK (default) and ARIA_LIGHT (matches Aria's
// [data-theme="light"] block). Components consume the active palette
// via useAriaTheme() in App.jsx.

export const ARIA_DARK = {
  bg:           "#09090e",
  bgCard:       "#12121a",
  bgCardGlass:  "rgba(18, 18, 26, 0.88)",
  bgRow:        "#181823",
  bgHover:      "rgba(44, 44, 62, 0.62)",
  border:       "rgba(255, 255, 255, 0.085)",
  borderLight:  "rgba(255, 255, 255, 0.14)",
  text:         "#f1f1f4",
  textDim:      "#b2b2c2",
  textMuted:    "#84849a",
  cardSheen:    "inset 0 1px 0 rgba(255, 255, 255, 0.04)",
  green:        "#34d399",
  red:          "#f87171",
  yellow:       "#fbbf24",
  blue:         "#60a5fa",
  purple:       "#c084fc",
  cyan:         "#22d3ee",
  gold:         "#e3b341",
  glowGreen:    "rgba(52, 211, 153, 0.15)",
  glass:        "rgba(255, 255, 255, 0.03)",
  vignette:     "radial-gradient(1100px 700px at 18% -8%, #14141d 0%, #09090e 60%)",
  shadow:       "0 4px 24px rgba(0, 0, 0, 0.35)",
  brand1:       "#6ee7b7",
  brand2:       "#67e8f9",
};

export const ARIA_LIGHT = {
  bg:           "#f8f9fc",
  bgCard:       "#ffffff",
  bgCardGlass:  "rgba(255, 255, 255, 0.90)",
  bgRow:        "rgba(241, 243, 249, 0.7)",
  bgHover:      "rgba(228, 231, 240, 0.6)",
  border:       "rgba(15, 23, 42, 0.09)",
  borderLight:  "rgba(15, 23, 42, 0.16)",
  text:         "#0f0f14",
  // Light-mode data values read near-black (gray washes out on white);
  // labels/headers stay gray so the hierarchy holds.
  textDim:      "#26262f",
  textMuted:    "#5e6275",
  cardSheen:    "inset 0 1px 0 rgba(255, 255, 255, 0.9)",
  green:        "#059669",
  red:          "#dc2626",
  yellow:       "#d97706",
  blue:         "#2563eb",
  purple:       "#7c3aed",
  cyan:         "#0891b2",
  gold:         "#a16207",
  glowGreen:    "rgba(5, 150, 105, 0.1)",
  glass:        "rgba(0, 0, 0, 0.02)",
  vignette:     "radial-gradient(1100px 700px at 18% -8%, #ffffff 0%, #f8f9fc 60%)",
  shadow:       "0 4px 20px rgba(30, 40, 70, 0.10)",
  brand1:       "#059669",
  brand2:       "#0891b2",
};

// Default export for backwards compat — points at the dark palette so any
// non-themed component still gets a sensible static value.
export const ARIA = ARIA_DARK;

// ── Padding presets ──

export const PAD_PILL = { padding: "1px 5px" };         // ~18x — small pill/badge
export const PAD_CODE = { padding: "1px 4px" };         // ~16x — inline code
export const PAD_TAG_XS = { padding: "2px 4px" };       // ~17x — tiny tag
export const PAD_TAG_SM = { padding: "2px 6px" };       // ~17x — small tag
export const PAD_TAG = { padding: "2px 8px" };           // ~37x — standard tag
export const PAD_CELL = { padding: "3px 8px" };          // ~15x — table cell
export const PAD_BTN_SM = { padding: "4px 8px" };        // ~45x — small button
export const PAD_BTN = { padding: "4px 12px" };          // ~13x — button
export const PAD_INPUT = { padding: "8px 10px" };        // ~10x — input field

// ── Common composite styles ──

/** Muted monospace text (most common in data cells) */
export const mutedMono = {
  color: COLOR.textDim,
  fontSize: 10,
  fontFamily: FONT_MONO,
};

/** Standard table header cell */
export const thCell = {
  padding: "3px 8px",
  fontSize: 10,
  fontFamily: FONT_MONO,
  color: COLOR.textMuted,
  textAlign: "left",
};

/** Small rounded tag/badge */
export const tagSmall = {
  padding: "1px 5px",
  borderRadius: 3,
  fontSize: 11,
  fontWeight: 700,
  fontFamily: FONT_MONO,
};

/** Clickable row hover base */
export const rowBase = {
  cursor: "pointer",
  borderBottom: `1px solid ${COLOR.border}`,
};

/** Card panel */
export const cardPanel = {
  background: COLOR.bgCard,
  borderRadius: 6,
  padding: 8,
};

/** Standard border */
export const borderDefault = {
  border: `1px solid ${COLOR.border}`,
};

/** Error text style */
export const errorText = {
  color: COLOR.red,
  fontSize: 12,
};

/** Small button base */
export const btnSmall = {
  padding: "4px 8px",
  borderRadius: 4,
  border: `1px solid ${COLOR.border}`,
  background: "transparent",
  color: COLOR.textDefault,
  cursor: "pointer",
  fontSize: 10,
};
