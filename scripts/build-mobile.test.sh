#!/usr/bin/env bash
#
# Drives `build-mobile.sh --dry-run` (phase 5 M2b, K3/K4 of m2-tech-spec).
#
# The script is the only road to a store build, so what it refuses matters more than what it
# builds: a release pointed at a plain `http`/`ws` server would send passwords in the clear (the
# app drops such a URL and is left with no server at all), and a release carrying the offline data
# package would ship data the app may not ship. `--dry-run` prints the Tauri command instead of
# running it, so these cases need neither an SDK nor a phone.

set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$here/build-mobile.sh"

passed=0
failed=0

# expect <expected exit status> <text the output must contain, or ""> <what this proves> -- <args…>
expect() {
    local want="$1" needle="$2" description="$3"
    shift 4
    local output status
    output="$("$script" --dry-run "$@" 2>&1)"
    status=$?
    if [ "$status" -eq "$want" ] && { [ -z "$needle" ] || [[ "$output" == *"$needle"* ]]; }; then
        passed=$((passed + 1))
        printf '  ok    %s\n' "$description"
    else
        failed=$((failed + 1))
        printf '  FAIL  %s\n' "$description"
        printf '        expected exit %s with "%s", got %s. Output was:\n' "$want" "$needle" "$status"
        printf '        %s\n' "$output"
    fi
}

# expect_not <text the output must not contain> <what this proves> -- <args…>
expect_not() {
    local needle="$1" description="$2"
    shift 3
    local output
    output="$("$script" --dry-run "$@" 2>&1)"
    if [[ "$output" != *"$needle"* ]]; then
        passed=$((passed + 1))
        printf '  ok    %s\n' "$description"
    else
        failed=$((failed + 1))
        printf '  FAIL  %s\n' "$description"
        printf '        "%s" found in:\n        %s\n' "$needle" "$output"
    fi
}

server="https://api.example.test"

echo "refused before any build:"
expect 2 "https://" "a plain http server" -- android --server http://10.0.2.2:8080
expect 2 "wss://" "a plain ws realtime gateway" -- android --server "$server" --realtime ws://10.0.2.2:8090/v1/realtime
expect 2 "--server" "no server at all" -- ios
expect 2 "android|ios" "an unknown platform" -- windows --server "$server"
expect 2 "build number" "a build number that is not a positive whole number" -- android --server "$server" --build-number 1.2
expect 2 "build number" "a build number of zero" -- ios --server "$server" --build-number 0
expect 2 "--package" "an offline data package" -- android --server "$server" --package real-world-2025-26.ofm
expect 2 "unknown" "an option it does not know" -- android --server "$server" --sign

echo "composed for Android:"
expect 0 "android build --aab --target aarch64 --target armv7" "an AAB for both phone ABIs" -- android --server "$server"
expect 0 '"serverUrl":"https://api.example.test"' "the given server" -- android --server "$server"
expect 0 '"realtimeUrl":"wss://api.example.test/v1/realtime"' "a gateway beside the server when none is given" -- android --server "$server"
expect 0 '"realtimeUrl":"wss://rt.example.test/v1/realtime"' "the given gateway" -- android --server "$server" --realtime wss://rt.example.test/v1/realtime
expect 0 '"versionCode":42' "the build number as the version code" -- android --server "$server" --build-number 42
expect 0 "OFM_BUILD_NUMBER=42" "the build number for the About line" -- android --server "$server" --build-number 42
expect_not "versionCode" "no version code when no build number is given" -- android --server "$server"
expect_not "resources" "no bundled resources of the desktop build" -- android --server "$server"

echo "composed for iOS:"
expect 0 "ios build" "an iOS build" -- ios --server "$server"
expect 0 '"bundleVersion":"7"' "the build number as the bundle version" -- ios --server "$server" --build-number 7
expect_not "--aab" "no Android flags" -- ios --server "$server"

echo "run with server URLs left in the shell:"
# `option_env!` in endpoints.rs reads OFM_SERVER_URL/OFM_REALTIME_URL at compile time and wins over
# --config. A plain http URL left in the shell (the play stack's, say) would be dropped by the
# release's https rule, and the app would ship with no server. A stand-in npm reports what the
# build saw, so this case runs the script for real without building anything.
fakebin="$(mktemp -d)"
trap 'rm -rf "$fakebin"' EXIT
printf '#!/usr/bin/env bash\nprintf "build saw OFM_SERVER_URL=%%s OFM_REALTIME_URL=%%s\\n" "${OFM_SERVER_URL-unset}" "${OFM_REALTIME_URL-unset}"\n' > "$fakebin/npm"
chmod +x "$fakebin/npm"
output="$(PATH="$fakebin:$PATH" OFM_SERVER_URL=http://10.0.2.2:8080 OFM_REALTIME_URL=ws://10.0.2.2:8090/v1/realtime \
    "$script" android --server "$server" 2>&1)"
if [[ "$output" == *"build saw OFM_SERVER_URL=unset OFM_REALTIME_URL=unset"* ]]; then
    passed=$((passed + 1))
    printf '  ok    %s\n' "the build does not see server URLs from the shell"
else
    failed=$((failed + 1))
    printf '  FAIL  %s\n' "the build does not see server URLs from the shell"
    printf '        output was:\n        %s\n' "$output"
fi

printf '\n%s passed, %s failed\n' "$passed" "$failed"
[ "$failed" -eq 0 ]
