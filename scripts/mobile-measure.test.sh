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

# A stand-in adb for `start android`: the clock reads 1000.000 s at launch, and the app logs its
# ready line at 1001.500 s, but only once the activity was started. `monkey` fails the way it does
# on an emulator with no hardware keys ("SYS_KEYS has no physical keys"), where it launches nothing.
fakebin="$scratch/bin"
mkdir -p "$fakebin"
cat > "$fakebin/adb" <<'ADB'
#!/usr/bin/env bash
state="$(dirname "$0")/started"
case "$*" in
    "shell am force-stop "*) rm -f "$state" ;;
    "logcat -c") ;;
    "shell echo \$EPOCHREALTIME") printf '1000.000\r\n' ;;
    "shell monkey "*) printf '** SYS_KEYS has no physical keys but with factor 2.0%%.\n' >&2; exit 251 ;;
    "shell cmd package resolve-activity --brief "*) printf 'priority=0 preferredOrder=0\r\n%s/.MainActivity\r\n' "${@: -1}" ;;
    "shell am start "*) touch "$state" ;;
    "logcat -d -v epoch")
        [ -f "$state" ] && printf '  1001.500  3972  4070 I         : [webview] OFM_READY login 1400\n' ;;
    *) printf 'fake adb: unexpected %s\n' "$*" >&2; exit 1 ;;
esac
exit 0
ADB
chmod +x "$fakebin/adb"

# check_start <text the output must contain> <what this proves>
check_start() {
    local needle="$1" description="$2" output status
    output="$(PATH="$fakebin:$PATH" "$script" start android --runs 3 2>&1)"
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

check_start "run 1: 1500 ms" "a cold start launches the app's own activity and times it to the ready line"
check_start "runs: 3  median: 1500 ms  slowest: 1500 ms" "the runs end in a median and the slowest"

printf '%d passed, %d failed\n' "$passed" "$failed"
[ "$failed" -eq 0 ]
