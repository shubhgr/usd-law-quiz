#!/usr/bin/env node
/**
 * Rebuild data/college-catalog.json from College-Review colleges.json.
 *
 * Usage:
 *   node scripts/build-college-catalog.js
 *   node scripts/build-college-catalog.js /path/to/colleges.json
 */
const fs = require("fs");
const path = require("path");

const defaultSrc = path.resolve(
  __dirname,
  "../../College-Review/data/colleges.json"
);
const srcPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : defaultSrc;
const outPath = path.join(__dirname, "..", "data", "college-catalog.json");

if (!fs.existsSync(srcPath)) {
  console.error("Source not found:", srcPath);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(srcPath, "utf8"));
if (!Array.isArray(raw)) {
  console.error("Expected an array in", srcPath);
  process.exit(1);
}

function cleanAlias(a) {
  return String(a || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const seen = new Set();
const out = [];

for (const row of raw) {
  const name =
    typeof row.name === "string" ? row.name.trim().replace(/\s+/g, " ") : "";
  if (!name) continue;
  const key = name.toLowerCase();
  if (seen.has(key)) continue;
  seen.add(key);

  const aliases = [];
  const aliasSeen = new Set();
  const push = (a) => {
    const v = cleanAlias(a);
    if (!v || v === key || aliasSeen.has(v)) return;
    aliasSeen.add(v);
    aliases.push(v);
  };

  if (Array.isArray(row.abbreviations)) {
    for (const a of row.abbreviations) push(a);
  }

  out.push({
    name,
    aliases,
    city: typeof row.city === "string" ? row.city.trim() : "",
    state: typeof row.state === "string" ? row.state.trim() : "",
  });
}

out.sort((a, b) => a.name.localeCompare(b.name));
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(`Wrote ${out.length} colleges → ${outPath}`);
