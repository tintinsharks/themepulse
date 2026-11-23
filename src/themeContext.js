// ──────────────────────────────────────────────────────────────────────────
// Theme system: Aria light/dark palettes via React context
// ──────────────────────────────────────────────────────────────────────────
//
// The App root reads themepulse-theme from localStorage and provides the
// active palette + toggle via AriaThemeContext. Each component starts with
//   const ARIA = useAriaTheme();
// then references ARIA.bg, ARIA.text, etc. as before — the values flip when
// the user toggles theme.

import React from "react";
import { ARIA_DARK } from "./styles.js";

export const AriaThemeContext = React.createContext({
  ARIA: ARIA_DARK,
  themeMode: "dark",
  toggleTheme: () => {},
  zoom: 1,
  changeZoom: () => {},
});

export function useAriaTheme() {
  return React.useContext(AriaThemeContext).ARIA;
}

export function useAriaThemeControls() {
  return React.useContext(AriaThemeContext);
}
