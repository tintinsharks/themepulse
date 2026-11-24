#!/usr/bin/env node
// Syncs daily Stockbee 4% Movers history (up_4pct, down_4pct, t2108) into
// public/data/stockbee_4pct_history.json so historical series survives
// upstream overwrites of public/market_monitor.json.
//
// Usage:
//   node scripts/sync-stockbee-history.mjs                 # merge current market_monitor.json
//   node scripts/sync-stockbee-history.mjs --backfill-git  # also backfill from git history

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MONITOR_PATH = path.join(ROOT, "public", "market_monitor.json");
const OUT_PATH = path.join(ROOT, "public", "data", "stockbee_4pct_history.json");
const BACKFILL = process.argv.includes("--backfill-git");

function isValidDate(d) {
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
}

function normalizeEntry(e) {
  if (!e || !isValidDate(e.date)) return null;
  const up = Number(e.up_4pct);
  const dn = Number(e.down_4pct);
  if (!Number.isFinite(up) || !Number.isFinite(dn)) return null;
  if (up === 0 && dn === 0) return null;
  const row = { date: e.date, up_4pct: Math.round(up), down_4pct: Math.round(dn) };
  if (typeof e.t2108 === "number" && Number.isFinite(e.t2108)) {
    row.t2108 = Math.round(e.t2108 * 10) / 10;
  }
  return row;
}

const byDate = new Map();

// 1. Seed from existing archive if present
if (fs.existsSync(OUT_PATH)) {
  try {
    const existing = JSON.parse(fs.readFileSync(OUT_PATH, "utf8"));
    for (const raw of existing?.history || []) {
      const row = normalizeEntry(raw);
      if (row) byDate.set(row.date, row);
    }
  } catch (err) {
    console.warn("Could not read existing archive:", err.message);
  }
}

// 2. Optional full git backfill (newest-first, so first seen per date is latest EOD reading)
if (BACKFILL) {
  const shas = execSync("git log --format=%H -- public/market_monitor.json", {
    cwd: ROOT,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);

  const fromGit = new Map();
  for (const sha of shas) {
    try {
      const raw = execSync(`git show ${sha}:public/market_monitor.json`, {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 5 * 1024 * 1024,
      });
      const d = JSON.parse(raw);
      const entries = [...(Array.isArray(d.history) ? d.history : []), ...(d.current ? [d.current] : [])];
      for (const e of entries) {
        const row = normalizeEntry(e);
        if (row && !fromGit.has(row.date)) fromGit.set(row.date, row);
      }
    } catch {
      // skip malformed commit
    }
  }
  for (const [dt, row] of fromGit.entries()) {
    if (!byDate.has(dt)) byDate.set(dt, row);
  }
}

// 3. Merge latest public/market_monitor.json (overrides same date with freshest reading)
if (fs.existsSync(MONITOR_PATH)) {
  try {
    const d = JSON.parse(fs.readFileSync(MONITOR_PATH, "utf8"));
    for (const e of Array.isArray(d.history) ? d.history : []) {
      const row = normalizeEntry(e);
      if (row) byDate.set(row.date, row);
    }
    if (d.current) {
      const row = normalizeEntry(d.current);
      if (row) byDate.set(row.date, row);
    }
  } catch (err) {
    console.warn("Could not read public/market_monitor.json:", err.message);
  }
}

const history = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
const payload = {
  updated: history.length ? history[history.length - 1].date : null,
  count: history.length,
  history,
};

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(
  `Wrote ${history.length} Stockbee 4% mover sessions (${history[0]?.date || "—"} → ${history[history.length - 1]?.date || "—"}) to ${path.relative(ROOT, OUT_PATH)}`
);
