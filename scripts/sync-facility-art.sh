#!/usr/bin/env bash
#
# Copy the facilities art from the render tool's output into `src/online/assets/facilities/`
# (c-27 §4.3, C27-6), and rewrite the file list of its `SOURCE.md` with each file's size and md5.
#
# The art is made by `node render.js <items> --layers` in the design repository
# (`ofm-document/05-design/brand/eleven-saga/stadium/3d-src/`), which writes `out/`: per piece a
# `<key>.base.webp`, and `<key>.c1.webp` / `<key>.c2.webp` masks when `meta.json` marks it
# `layers: true`. Never edit the copies by hand; render again and run this.
#
# Usage: scripts/sync-facility-art.sh [path to the render tool's out/]
#        (default: ../ofm-document/05-design/brand/eleven-saga/stadium/3d-src/out)

set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
source="${1:-$root/../ofm-document/05-design/brand/eleven-saga/stadium/3d-src/out}"
target="$root/src/online/assets/facilities"

if [ ! -f "$source/meta.json" ]; then
  echo "no meta.json in $source: render with --layers first" >&2
  exit 1
fi

mkdir -p "$target"
rm -f "$target"/*.webp
cp "$source/meta.json" "$target/meta.json"
# The render tool writes its own JSON layout; the repository's formatter owns this copy.
"$root/node_modules/.bin/biome" format --write "$target/meta.json" >/dev/null

SOURCE_DIR="$source" TARGET_DIR="$target" node <<'NODE'
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const source = process.env.SOURCE_DIR;
const target = process.env.TARGET_DIR;
const meta = JSON.parse(fs.readFileSync(path.join(target, "meta.json"), "utf8"));
const files = ["meta.json"];
for (const [key, art] of Object.entries(meta)) {
  if (art.layers === undefined) throw new Error(`${key} was not rendered with --layers`);
  const names = [`${key}.base.webp`].concat(art.layers ? [`${key}.c1.webp`, `${key}.c2.webp`] : []);
  for (const name of names) {
    const from = path.join(source, name);
    if (!fs.existsSync(from)) throw new Error(`missing ${name}`);
    fs.copyFileSync(from, path.join(target, name));
    files.push(name);
  }
}
let total = 0;
const rows = files.sort().map((name) => {
  const bytes = fs.readFileSync(path.join(target, name));
  total += bytes.length;
  const md5 = crypto.createHash("md5").update(bytes).digest("hex");
  return `| \`${name}\` | ${bytes.length.toLocaleString("de-DE")} | \`${md5}\` |`;
});
const list = [
  "<!-- files:start (written by scripts/sync-facility-art.sh) -->",
  "| File | Bytes | md5 |",
  "|---|---|---|",
  ...rows,
  `| **Total** (${files.length} files) | **${total.toLocaleString("de-DE")}** | |`,
  "<!-- files:end -->",
].join("\n");
const sourceMd = path.join(target, "SOURCE.md");
const old = fs.existsSync(sourceMd) ? fs.readFileSync(sourceMd, "utf8") : "# Facilities art\n\n<!-- files:start -->\n<!-- files:end -->\n";
const updated = old.replace(/<!-- files:start[\s\S]*?<!-- files:end -->/, list);
fs.writeFileSync(sourceMd, updated);
console.log(`${files.length} files, ${total} bytes`);
NODE
