// Minimal guard: no-undef only. Purpose: catch dangling identifiers after
// edits to the 13k-line App.jsx (the bundler doesn't check them — a removed
// state var referenced elsewhere ships fine and breaks at runtime).
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    files: ["src/**/*.jsx", "src/**/*.js"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        window: "readonly", document: "readonly", navigator: "readonly",
        localStorage: "readonly", sessionStorage: "readonly", fetch: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly",
        clearInterval: "readonly", console: "readonly", URL: "readonly",
        URLSearchParams: "readonly", AbortSignal: "readonly", CustomEvent: "readonly",
        requestAnimationFrame: "readonly", cancelAnimationFrame: "readonly",
        performance: "readonly", alert: "readonly", confirm: "readonly",
        Blob: "readonly", FileReader: "readonly", ResizeObserver: "readonly",
        IntersectionObserver: "readonly", MutationObserver: "readonly",
        getComputedStyle: "readonly", matchMedia: "readonly",
      },
    },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: { "no-undef": "error" },
  },
];
