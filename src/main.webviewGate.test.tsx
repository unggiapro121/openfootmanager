import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `main.tsx` is the app's entry module. On an Android WebView too old for the app's CSS,
 * `public/webview-check.js` has already put a notice in `#root` and left a flag; the entry must
 * then leave the notice alone (phase 5 M2b, K2 of m2-tech-spec).
 */
const createRoot = vi.fn(() => ({ render: vi.fn() }));

vi.mock("react-dom/client", () => ({ default: { createRoot }, createRoot }));
vi.mock("./App", () => ({ default: () => null }));
vi.mock("./i18n", () => ({ i18nReady: Promise.resolve() }));
vi.mock("./lib/logger", () => ({
  installConsoleForwarding: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

type FlagWindow = Window & { __OFM_WEBVIEW_BLOCKED__?: boolean };

beforeEach(() => {
  vi.resetModules();
  createRoot.mockClear();
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => {
  delete (window as FlagWindow).__OFM_WEBVIEW_BLOCKED__;
  document.body.innerHTML = "";
});

// The first import of the entry transforms its whole module graph; on a loaded machine that alone
// can pass Vitest's 5 s default.
describe("main.tsx", { timeout: 20_000 }, () => {
  it("Given the WebView check blocked the app, when the entry runs, then React never mounts", async () => {
    (window as FlagWindow).__OFM_WEBVIEW_BLOCKED__ = true;
    document.getElementById("root")?.append("notice");
    await import("./main");
    expect(createRoot).not.toHaveBeenCalled();
    expect(document.getElementById("root")?.textContent).toBe("notice");
  });

  it("Given no block, when the entry runs, then React mounts on the root", async () => {
    await import("./main");
    expect(createRoot).toHaveBeenCalledTimes(1);
  });
});
