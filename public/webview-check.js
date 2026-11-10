/*
 * Runs before the app on every platform, as a classic script (phase 5 M2b, K2 of m2-tech-spec).
 *
 * Tailwind 4 needs Chrome 111 or newer (Safari 16.4 on iOS, which the deployment target already
 * guarantees). An Android phone from API 26 up may still run an older Android System WebView, and
 * then the app's CSS breaks without a word. On such a WebView this script replaces the root with a
 * plain notice, styled inline because Tailwind does not work there, and leaves a flag `main.tsx`
 * reads so React never mounts over it.
 *
 * ES5 only, no module syntax: the point is to run where modern syntax may not. Outside Android, or
 * when the Chrome version cannot be read, it does nothing.
 */
// biome-ignore lint/complexity/useArrowFunction: ES5 on purpose, an old WebView must parse this file
(function () {
  var MINIMUM_CHROME = 111;
  // biome-ignore lint/complexity/useOptionalChain: ES5 on purpose, `?.` needs Chrome 80
  var agent = (navigator && navigator.userAgent) || "";
  if (agent.indexOf("Android") === -1) return;
  var match = /Chrome\/(\d+)/.exec(agent);
  if (!match) return;
  if (parseInt(match[1], 10) >= MINIMUM_CHROME) return;

  window.__OFM_WEBVIEW_BLOCKED__ = true;
  var root = document.getElementById("root");
  if (!root) return;
  var store = "https://play.google.com/store/apps/details?id=com.google.android.webview";
  root.innerHTML =
    '<div style="font-family:sans-serif;max-width:28rem;margin:0 auto;padding:3rem 1.5rem;' +
    'color:#f9fafb;background:#0a1128;min-height:100vh;box-sizing:border-box;text-align:center">' +
    '<h1 style="font-size:1.4rem;margin:0 0 1rem">Eleven Saga</h1>' +
    '<p style="line-height:1.5;margin:0 0 0.75rem">Cần cập nhật Android System WebView để chạy ' +
    "Eleven Saga.</p>" +
    '<p style="line-height:1.5;margin:0 0 1.5rem">Please update Android System WebView to run ' +
    "Eleven Saga.</p>" +
    '<a href="' +
    store +
    '" style="display:inline-block;padding:0.85rem 1.5rem;border-radius:0.6rem;' +
    'background:#059669;color:#ffffff;text-decoration:none;font-weight:bold">' +
    "Cập nhật / Update</a></div>";
})();
