/**
 * Whether this is the Android or iOS app (phase 5), decided when the frontend was built. The
 * phone app is online only (DM-1): no saves, no world editor, no quitting from a button.
 */
export function isMobileBuild(): boolean {
  return __APP_MOBILE__;
}

/**
 * Which phone the app runs on, read from the webview: Android names itself, and an iPad on
 * iPadOS 13 or later passes for a Mac, so anything else in a phone build is iOS.
 */
export function mobilePlatform(): "android" | "ios" {
  return /Android/i.test(navigator.userAgent) ? "android" : "ios";
}
