// extract_chain_taxonomy.js — pull DRAWER_SUBTHEMES + INDUSTRY_CHAIN_MAP from
// src/App.jsx into public/data/chain_taxonomy.json, the single source of truth
// for chain layer membership (consumed by stock-pipeline/build_chain_layers.py).
// Run from the themepulse repo root: node scripts/extract_chain_taxonomy.js
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");

function evalLiteral(decl) {
  const s = src.indexOf(decl);
  if (s < 0) throw new Error(`not found: ${decl}`);
  const arr = decl.trim().endsWith("[");
  const oc = arr ? "[" : "{", cc = arr ? "]" : "}";
  const open = src.indexOf(oc, s);
  let d = 0, i = open, e = -1;
  for (; i < src.length; i++) { const ch = src[i]; if (ch === oc) d++; else if (ch === cc) { d--; if (d === 0) { e = i; break; } } }
  // eslint-disable-next-line no-eval
  return eval("(" + src.slice(open, e + 1) + ")");
}

const drawer = evalLiteral("const DRAWER_SUBTHEMES = [");
const industryMap = evalLiteral("const INDUSTRY_CHAIN_MAP = {");
const themeNames = {};
drawer.forEach((d) => { if (d.themeId && d.theme) themeNames[d.themeId] = d.theme; });

const out = { drawer, industryMap, themeNames, generated: new Date().toISOString().slice(0, 10) };
const dest = path.join(root, "public/data/chain_taxonomy.json");
fs.writeFileSync(dest, JSON.stringify(out));
console.log(`wrote ${dest} — ${drawer.length} drawer layers, ${Object.keys(industryMap).length} industry mappings`);
