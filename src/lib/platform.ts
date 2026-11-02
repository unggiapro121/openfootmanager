/**
 * Whether this is the Android or iOS app (phase 5), decided when the frontend was built. The
 * phone app is online only (DM-1): no saves, no world editor, no quitting from a button.
 */
export function isMobileBuild(): boolean {
  return __APP_MOBILE__;
}
