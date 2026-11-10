#!/usr/bin/env bash
#
# Measures a phone build against D-P5-13 (phase 5 M2b-11 of m2-tech-spec).
#
#   scripts/mobile-measure.sh size android <app.aab|app.apk>
#   scripts/mobile-measure.sh size ios <Eleven Saga.app>
#   scripts/mobile-measure.sh start android [--runs N] [--package ID] [--overview]
#   scripts/mobile-measure.sh start ios [--runs N] [--package ID] [--overview]
#
# size   the 10 largest files of the bundle, whether any offline data package (.ofm) is inside
#        (there must be none, K4), and the download size where a tool can say it:
#        Android through `bundletool get-size total` (an AAB, bundletool on PATH or BUNDLETOOL_JAR);
#        iOS only the unpacked .app here, since the thinned size needs a signed export (M4a).
# start  cold starts on the running emulator or simulator (the app installed beforehand): stops the
#        app, launches it, and waits for the `OFM_READY login` line the app logs once its login form
#        is usable (src/lib/readyMarker.ts), or `OFM_READY overview` with --overview (logged in, on
#        a server with a season). Prints each run, the median and the slowest.
#        Android times from the launch to the line's logcat timestamp, to the millisecond;
#        iOS polls the simulator's log, so its numbers are good to about 0.2 s.
#
# Thresholds (D-P5-13): download <= 100 MB; login <= 3 s; overview <= 5 s. The script reports;
# it judges nothing and never fills in a number it could not measure.

set -euo pipefail

die() {
    printf 'mobile-measure: %s\n' "$1" >&2
    exit 2
}

[ "$#" -ge 2 ] || die "usage: mobile-measure.sh <size|start> <android|ios> …"
what="$1"
platform="$2"
shift 2

package="com.sturdyrobot.openfootmanager"
runs=10
stage="login"

largest_files() {
    # <listing of "bytes path" lines> -> the 10 largest, in MB. awk reads the whole listing: `head`
    # would close the pipe early, and under pipefail the writer's SIGPIPE ends the script here.
    sort -nr | awk 'NR <= 10 { size = $1; $1 = ""; printf "  %8.2f MB %s\n", size / 1048576, $0 }'
}

size_android() {
    local bundle="$1"
    [ -f "$bundle" ] || die "no such file: $bundle"
    printf '10 largest files in %s (uncompressed):\n' "$bundle"
    unzip -l "$bundle" | awk 'NR > 3 && $1 ~ /^[0-9]+$/ && NF >= 4 { size = $1; $1 = $2 = $3 = ""; sub(/^ +/, ""); print size, $0 }' | largest_files
    # grep without -q, which would also stop reading at the first match.
    if unzip -l "$bundle" | grep '\.ofm$' >/dev/null; then
        printf 'OFFLINE DATA PACKAGE FOUND (.ofm), which the phone app must not carry:\n'
        unzip -l "$bundle" | grep '\.ofm$'
    else
        printf 'no .ofm file inside\n'
    fi
    printf 'file size: %s bytes\n' "$(wc -c < "$bundle" | tr -d ' ')"

    case "$bundle" in
        *.aab) ;;
        *) printf 'download size: not measured (bundletool needs an .aab)\n'; return ;;
    esac
    local bundletool=()
    if command -v bundletool >/dev/null; then
        bundletool=(bundletool)
    elif [ -n "${BUNDLETOOL_JAR:-}" ] && [ -f "$BUNDLETOOL_JAR" ]; then
        bundletool=(java -jar "$BUNDLETOOL_JAR")
    else
        printf 'download size: not measured (no bundletool on PATH and no BUNDLETOOL_JAR)\n'
        return
    fi
    local scratch
    scratch="$(mktemp -d)"
    "${bundletool[@]}" build-apks --bundle="$bundle" --output="$scratch/app.apks" >/dev/null
    printf 'download size by ABI (bytes, min and max over devices):\n'
    "${bundletool[@]}" get-size total --apks="$scratch/app.apks" --dimensions=ABI
    rm -rf "$scratch"
}

size_ios() {
    local app="$1"
    [ -d "$app" ] || die "no such .app directory: $app"
    printf '10 largest files in %s:\n' "$app"
    find "$app" -type f -exec stat -f '%z %N' {} + | sed "s|$app/||" | largest_files
    if [ -n "$(find "$app" -name '*.ofm')" ]; then
        printf 'OFFLINE DATA PACKAGE FOUND (.ofm), which the phone app must not carry:\n'
        find "$app" -name '*.ofm'
    else
        printf 'no .ofm file inside\n'
    fi
    printf 'unpacked .app: %s KB\n' "$(du -sk "$app" | cut -f1)"
    printf 'download size: not measured (app thinning needs a signed export, M4a)\n'
}

# Median and slowest of the numbers on stdin, one per line.
summarise() {
    sort -n | awk '{ v[NR] = $1 } END {
        if (NR == 0) { print "no run reached the milestone"; exit }
        m = (NR % 2) ? v[(NR + 1) / 2] : (v[NR / 2] + v[NR / 2 + 1]) / 2
        printf "runs: %d  median: %d ms  slowest: %d ms\n", NR, m, v[NR]
    }'
}

start_android() {
    command -v adb >/dev/null || die "adb not found"
    local results=() i launched line ready activity
    # `am start` on the launcher activity, not `monkey`: on an emulator with no hardware keys monkey
    # aborts ("SYS_KEYS has no physical keys") without launching anything.
    activity="$(adb shell cmd package resolve-activity --brief "$package" | tr -d '\r' | tail -1)"
    [[ "$activity" == "$package/"* ]] || die "no launcher activity for $package (is it installed?)"
    for ((i = 1; i <= runs; i++)); do
        adb shell am force-stop "$package"
        adb logcat -c
        launched="$(adb shell 'echo $EPOCHREALTIME' | tr -d '\r')"
        adb shell am start -n "$activity" >/dev/null
        line=""
        for _ in $(seq 1 300); do
            line="$(adb logcat -d -v epoch | grep -m1 "OFM_READY $stage" || true)"
            [ -n "$line" ] && break
            sleep 0.1
        done
        if [ -z "$line" ]; then
            printf '  run %d: no OFM_READY %s line within 30 s\n' "$i" "$stage"
            continue
        fi
        ready="$(printf '%s' "$line" | awk '{ print $1 }')"
        results+=("$(awk -v a="$launched" -v b="$ready" 'BEGIN { printf "%d", (b - a) * 1000 }')")
        printf '  run %d: %s ms\n' "$i" "${results[${#results[@]} - 1]}"
    done
    printf '%s\n' "${results[@]}" | grep . | summarise
}

start_ios() {
    command -v xcrun >/dev/null || die "xcrun not found"
    local results=() i launched now found since
    for ((i = 1; i <= runs; i++)); do
        xcrun simctl terminate booted "$package" >/dev/null 2>&1 || true
        # The search starts at this run's launch second, so it never finds an earlier run's line.
        sleep 1.1
        since="$(date '+%Y-%m-%d %H:%M:%S')"
        launched="$(perl -MTime::HiRes=time -e 'printf "%.3f", time')"
        xcrun simctl launch booted "$package" >/dev/null
        found=""
        for _ in $(seq 1 150); do
            if xcrun simctl spawn booted log show --start "$since" --style compact \
                --predicate "eventMessage CONTAINS \"OFM_READY $stage\"" 2>/dev/null | grep -q "OFM_READY $stage"; then
                found=yes
                break
            fi
            sleep 0.2
        done
        now="$(perl -MTime::HiRes=time -e 'printf "%.3f", time')"
        if [ -z "$found" ]; then
            printf '  run %d: no OFM_READY %s line within 30 s\n' "$i" "$stage"
            continue
        fi
        results+=("$(awk -v a="$launched" -v b="$now" 'BEGIN { printf "%d", (b - a) * 1000 }')")
        printf '  run %d: about %s ms\n' "$i" "${results[${#results[@]} - 1]}"
    done
    printf '%s\n' "${results[@]}" | grep . | summarise
}

case "$what" in
    size)
        [ "$#" -ge 1 ] || die "size needs the bundle's path"
        case "$platform" in
            android) size_android "$1" ;;
            ios) size_ios "$1" ;;
            *) die "the platform is android|ios" ;;
        esac
        ;;
    start)
        while [ "$#" -gt 0 ]; do
            case "$1" in
                --runs) runs="${2:-}"; shift ;;
                --package) package="${2:-}"; shift ;;
                --overview) stage="overview" ;;
                *) die "unknown option $1" ;;
            esac
            shift
        done
        [[ "$runs" =~ ^[1-9][0-9]*$ ]] || die "--runs needs a whole number above 0"
        printf 'cold start to OFM_READY %s, %s, %d runs:\n' "$stage" "$platform" "$runs"
        case "$platform" in
            android) start_android ;;
            ios) start_ios ;;
            *) die "the platform is android|ios" ;;
        esac
        ;;
    *) die "measure size or start, not $what" ;;
esac
