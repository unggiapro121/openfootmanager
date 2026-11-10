#!/usr/bin/env bash
#
# Drives `mobile-measure.sh size android` on small made-up bundles (phase 5 M2b-11, K4 of
# m2-tech-spec). A real bundle holds about a thousand files and the .ofm check and the file size
# come after the list of the 10 largest, so the bundles here are as long: a listing that outgrows
# the pipe buffer is what once stopped the script right after that list.

set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$here/mobile-measure.sh"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

passed=0
failed=0

# check <text the output must contain> <what this proves> <bundle>
check() {
    local needle="$1" description="$2" bundle="$3" output status
    output="$("$script" size android "$bundle" 2>&1)"
    status=$?
    if [ "$status" -eq 0 ] && [[ "$output" == *"$needle"* ]]; then
        passed=$((passed + 1))
        printf '  ok    %s\n' "$description"
    else
        failed=$((failed + 1))
        printf '  FAIL  %s\n' "$description"
        printf '        expected exit 0 with "%s", got %s. Output was:\n%s\n' "$needle" "$status" "$output"
    fi
}

# bundle <name> <extra file or ""> -> a zip of 1500 files (plus the extra one) in the scratch dir
bundle() {
    local dir="$scratch/$1"
    mkdir -p "$dir/base/lib"
    for i in $(seq 1 1500); do printf '%*s' "$i" '' > "$dir/base/lib/file-with-a-long-name-$i.bin"; done
    if [ -n "$2" ]; then mkdir -p "$dir/$(dirname "$2")" && printf 'x' > "$dir/$2"; fi
    (cd "$dir" && zip -qr "../$1.zip" .)
    printf '%s/%s.zip' "$scratch" "$1"
}

clean="$(bundle clean "")"
check "no .ofm file inside" "a bundle without .ofm says so after its 10 largest files" "$clean"
check "file size: " "the bundle's file size follows the list" "$clean"
check "download size: not measured (bundletool needs an .aab)" "a non-.aab bundle says why it has no download size" "$clean"

dirty="$(bundle dirty "base/assets/real-world.ofm")"
check "OFFLINE DATA PACKAGE FOUND (.ofm)" "a bundle carrying an .ofm package is flagged" "$dirty"

printf '%d passed, %d failed\n' "$passed" "$failed"
[ "$failed" -eq 0 ]
