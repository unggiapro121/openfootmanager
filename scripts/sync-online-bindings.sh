#!/usr/bin/env bash
#
# Copy the online API's TypeScript declarations from a checkout of the account server
# (ofm-server, its `bindings/` folder) into `src/online/api/` (phase 3 E3-6, E6-4).
#
# The server is a private repository and this one is public, so the fork never reads the server
# while it builds: the declarations are copied here and committed, with `SOURCE` naming where they
# came from. Run this after every change to the server's contract that touches `bindings/`.
#
# It also lists the core types (`domain/`, `engine/`, `rules/`) whose copy in the server's
# declarations differs from `src/bindings/core/`: they come at the tag the server pins, and a
# difference means the server could pin a newer one (E6-19). A difference is not an error.
#
# Usage: scripts/sync-online-bindings.sh <path to ofm-server>

set -euo pipefail

server="${1:?usage: sync-online-bindings.sh <path to ofm-server>}"
root="$(cd "$(dirname "$0")/.." && pwd)"
source_dir="$server/bindings"
target="$root/src/online/api"

[ -f "$source_dir/contract.ts" ] || {
  echo "no bindings/contract.ts under $server" >&2
  exit 1
}

rm -rf "$target"
mkdir -p "$target"
cp -R "$source_dir/." "$target/"

commit="$(git -C "$server" rev-parse --short HEAD)"
tag="$(grep -o 'tag = "engine-v[^"]*"' "$server/Cargo.toml" | head -1 | sed 's/tag = "\(.*\)"/\1/')"
revision="$(sed -n 's/^export const CONTRACT_REVISION = \([0-9]*\);$/\1/p' "$source_dir/contract.ts")"
cat > "$target/SOURCE" <<SOURCE
ofm-server commit: $commit
fork tag pinned by the server: $tag
contract revision: $revision
SOURCE

echo "copied $(find "$target" -name '*.ts' | wc -l | tr -d ' ') declarations from ofm-server $commit ($tag, revision $revision)"

drift=0
for folder in domain engine rules; do
  [ -d "$target/$folder" ] || continue
  for file in "$target/$folder"/*.ts; do
    name="$folder/$(basename "$file")"
    [ "$(basename "$file")" = "index.ts" ] && continue
    core="$root/src/bindings/core/$name"
    if [ ! -f "$core" ] || ! cmp -s "$file" "$core"; then
      echo "  differs from src/bindings/core: $name"
      drift=1
    fi
  done
done
if [ "$drift" -eq 1 ]; then
  echo "the server's core types are older than this fork's: the server could pin a newer tag"
fi

"$root/node_modules/.bin/tsc" --noEmit -p "$root"
echo "tsc: the online client still compiles"
