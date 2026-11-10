import { afterEach, describe, expect, it } from "vitest";
import indexHtml from "../../index.html?raw";
import script from "../../public/webview-check.js?raw";
import { webViewBlocked } from "./webviewGate";

/**
 * `public/webview-check.js` runs before React on a phone (phase 5 M2b, K2 of m2-tech-spec): an
 * Android System WebView older than 111 cannot draw Tailwind 4, so the page says so and the app
 * does not start. The script is plain ES5 so an old WebView can run it; the test runs its text as
 * the WebView would, against a stub `navigator` and the test's `document`.
 */
type CheckWindow = { __OFM_WEBVIEW_BLOCKED__?: boolean };

function runCheck(userAgent: string): CheckWindow {
  document.body.innerHTML = '<div id="root"></div>';
  const win: CheckWindow = {};
  new Function("window", "navigator", "document", script)(win, { userAgent }, document);
  return win;
}

const androidChrome = (major: number) =>
  `Mozilla/5.0 (Linux; Android 8.0.0; SM-J330F Build/R16NW; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/${major}.0.5481.153 Mobile Safari/537.36`;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("webview-check.js", () => {
  it("blocks an Android WebView older than Chrome 111 and says how to update it", () => {
    const win = runCheck(androidChrome(110));
    expect(win.__OFM_WEBVIEW_BLOCKED__).toBe(true);
    const root = document.getElementById("root");
    expect(root?.textContent).toContain("Android System WebView");
    expect(root?.querySelector("a")?.getAttribute("href")).toContain("com.google.android.webview");
  });

  it("lets Chrome 111 and newer through untouched", () => {
    for (const major of [111, 140]) {
      const win = runCheck(androidChrome(major));
      expect(win.__OFM_WEBVIEW_BLOCKED__).toBeUndefined();
      expect(document.getElementById("root")?.childElementCount).toBe(0);
    }
  });

  it("never blocks outside Android: iOS, desktop WebView2, WebKitGTK, or an unknown agent", () => {
    for (const agent of [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.0.0 Safari/537.36 Edg/90.0",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)",
      "",
    ]) {
      expect(runCheck(agent).__OFM_WEBVIEW_BLOCKED__).toBeUndefined();
    }
  });

  it("does not block an Android agent whose Chrome version it cannot read", () => {
    expect(
      runCheck("Mozilla/5.0 (Linux; Android 9; wv) AppleWebKit/537.36").__OFM_WEBVIEW_BLOCKED__,
    ).toBeUndefined();
  });
});

describe("webViewBlocked", () => {
  it("reads the flag the check script leaves", () => {
    expect(webViewBlocked({ __OFM_WEBVIEW_BLOCKED__: true })).toBe(true);
    expect(webViewBlocked({})).toBe(false);
  });
});

describe("index.html", () => {
  it("loads the check as a classic script after the root and before the app module", () => {
    const html = indexHtml;
    const root = html.indexOf('<div id="root"></div>');
    const check = html.indexOf('<script src="/webview-check.js"></script>');
    const app = html.indexOf('<script type="module" src="/src/main.tsx"></script>');
    expect(root).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(root);
    expect(app).toBeGreaterThan(check);
  });
});
