#!/usr/bin/env bash
#
# Builds the phone app for a store (phase 5 M2b-8 of m2-tech-spec).
#
#   scripts/build-mobile.sh <android|ios> --server <https-url> [--realtime <wss-url>]
#                           [--build-number N] [--dry-run]
#
#   android  an AAB with arm64-v8a and armeabi-v7a (x86_64 is for emulators only)
#   ios      an iPhone build through Xcode
#
# --server        the account server; must be https (a release phone build drops any other URL
#                 and is then left with no server, src-tauri/src/application/endpoints.rs)
# --realtime      the realtime gateway; must be wss. Default: /v1/realtime beside the server.
# --build-number  the store's build number, a whole number above 0 that grows with each upload.
#                 Android versionCode, iOS CFBundleVersion, and the About line (OFM_BUILD_NUMBER).
#                 Default: Tauri's own, derived from `version` in tauri.conf.json.
# --dry-run       print the command instead of running it
#
# Android needs JDK 17 on JAVA_HOME (Homebrew: JAVA_HOME=/opt/homebrew/opt/openjdk@17), the JDK the
# release build with R8 and Firebase Messaging was checked on (M3c2, PO P5-39 B4). Pushes need the Firebase project's
# src-tauri/gen/android/app/google-services.json (git-ignored, from the store account's Firebase
# project): without it the app builds and runs, and the push plugin's token call answers an error.
#
# Nothing is signed here: the Android keystore and the Apple certificate belong to the store
# accounts and come in M4a. There is deliberately no --package and no bundled resources: the phone
# app is online only, and the offline data packages may not ship in it (D-P5-17, K4).

set -euo pipefail

usage_error() {
    printf 'build-mobile: %s\n' "$1" >&2
    printf 'usage: build-mobile.sh <android|ios> --server <https-url> [--realtime <wss-url>] [--build-number N] [--dry-run]\n' >&2
    exit 2
}

platform=""
server=""
realtime=""
build_number=""
dry_run=false

while [ "$#" -gt 0 ]; do
    case "$1" in
        android | ios) platform="$1" ;;
        --server) server="${2:-}"; shift ;;
        --realtime) realtime="${2:-}"; shift ;;
        --build-number) build_number="${2:-}"; shift ;;
        --dry-run) dry_run=true ;;
        --package) usage_error "--package is not allowed: the phone app carries no offline data package" ;;
        -*) usage_error "unknown option $1" ;;
        *) usage_error "the platform is android|ios, not $1" ;;
    esac
    shift
done

[ -n "$platform" ] || usage_error "name the platform: android|ios"
[ -n "$server" ] || usage_error "--server <https-url> is required"
case "$server" in
    https://?*) ;;
    *) usage_error "--server must start with https://, got $server" ;;
esac
if [ -z "$realtime" ]; then
    # The gateway sits at /v1/realtime beside the API, as realtime_url_of in endpoints.rs.
    authority="${server#https://}"
    authority="${authority%%/*}"
    authority="${authority%%\?*}"
    realtime="wss://$authority/v1/realtime"
fi
case "$realtime" in
    wss://?*) ;;
    *) usage_error "--realtime must start with wss://, got $realtime" ;;
esac
if [ -n "$build_number" ] && ! [[ "$build_number" =~ ^[1-9][0-9]*$ ]]; then
    usage_error "the build number must be a whole number above 0, got $build_number"
fi

json_string() {
    # The URLs were checked above; only a quote or a backslash could break the JSON.
    case "$1" in
        *'"'* | *'\'*) usage_error "a URL may not contain a quote or a backslash: $1" ;;
    esac
    printf '"%s"' "$1"
}

bundle=""
if [ -n "$build_number" ]; then
    if [ "$platform" = android ]; then
        bundle=",\"bundle\":{\"android\":{\"versionCode\":$build_number}}"
    else
        bundle=",\"bundle\":{\"iOS\":{\"bundleVersion\":\"$build_number\"}}"
    fi
fi
config="{\"plugins\":{\"ofmOnline\":{\"serverUrl\":$(json_string "$server"),\"realtimeUrl\":$(json_string "$realtime")}}$bundle}"

if [ "$platform" = android ]; then
    command=(npm run tauri -- android build --aab --target aarch64 --target armv7 --config "$config")
else
    command=(npm run tauri -- ios build --config "$config")
fi

# The app reads OFM_SERVER_URL/OFM_REALTIME_URL at compile time (`option_env!`), ahead of --config.
# One left in the shell, such as the play stack's plain http URL, would win over --server, and the
# release's https rule would then drop it: an app with no server. The build sees only --server.
for name in OFM_SERVER_URL OFM_REALTIME_URL; do
    if [ -n "${!name+set}" ]; then
        printf 'build-mobile: ignoring %s from the shell (%s); the build uses --server/--realtime\n' \
            "$name" "${!name}" >&2
        unset "$name"
    fi
done

if "$dry_run"; then
    printf 'OFM_BUILD_NUMBER=%s %s\n' "$build_number" "${command[*]}"
    exit 0
fi

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"
OFM_BUILD_NUMBER="$build_number" "${command[@]}"

printf '\nbuilt (unsigned):\n'
if [ "$platform" = android ]; then
    find src-tauri/gen/android/app/build/outputs/bundle -name '*.aab' -print
else
    find src-tauri/gen/apple/build -maxdepth 3 \( -name '*.ipa' -o -name '*.app' \) -print
fi
