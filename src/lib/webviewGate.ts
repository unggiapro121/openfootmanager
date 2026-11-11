/**
 * The flag `public/webview-check.js` leaves on `window` when the phone's Android System WebView is
 * too old to draw the app (phase 5 M2b, K2 of m2-tech-spec). The check runs as a classic script
 * before the app's module, but a module the parser has already met cannot be cancelled, so
 * `main.tsx` asks here before it mounts React over the notice.
 */
export function webViewBlocked(win: Pick<Window, "__OFM_WEBVIEW_BLOCKED__">): boolean {
  return win.__OFM_WEBVIEW_BLOCKED__ === true;
}
