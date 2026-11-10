import { afterEach, describe, expect, it } from "vitest";
import indexHtml from "../../index.html?raw";
import script from "../../public/theme-early.js?raw";

/**
 * `public/theme-early.js` runs before the app's CSS paints (phase 5 M2b-9). The body is gray-100
 * until `<html>` has the `dark` class, which `ThemeProvider` only adds after React's first
 * render: on the API 35 AVD that showed as a light frame between the navy splash and the login.
 * The script decides as `getInitialTheme` does: dark unless the coach chose light.
 */
function runWith(stored: string | null | "throws"): boolean {
  document.documentElement.classList.remove("dark");
  const localStorage = {
    getItem: () => {
      if (stored === "throws") throw new Error("storage blocked");
      return stored;
    },
  };
  new Function("window", "document", script)({ localStorage }, document);
  return document.documentElement.classList.contains("dark");
}

afterEach(() => document.documentElement.classList.remove("dark"));

describe("theme-early.js", () => {
  it("Given no theme chosen yet, when the page starts, then it starts dark", () => {
    expect(runWith(null)).toBe(true);
  });

  it("Given the coach chose dark or light, when the page starts, then it starts in that theme", () => {
    expect(runWith("dark")).toBe(true);
    expect(runWith("light")).toBe(false);
  });

  it("Given storage that cannot be read, when the page starts, then it starts dark", () => {
    expect(runWith("throws")).toBe(true);
  });

  it("Given index.html, when it is parsed, then the script runs in the head before the app", () => {
    const head = indexHtml.slice(0, indexHtml.indexOf("</head>"));
    expect(head).toMatch(/<script src="\/theme-early\.js"><\/script>/);
  });
});
