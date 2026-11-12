import { afterEach, describe, expect, it, vi } from "vitest";
import { mobilePlatform } from "./platform";

describe("mobilePlatform", () => {
  afterEach(() => vi.unstubAllGlobals());

  // Given the Android webview, which names Android in its user agent,
  // when the phone is asked,
  // then it is Android.
  it("reads Android from the user agent", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Linux; Android 15; sdk_gphone64_arm64)",
    });
    expect(mobilePlatform()).toBe("android");
  });

  // Given an iPhone's webview, or an iPad's that passes for a Mac,
  // when the phone is asked,
  // then it is iOS.
  it("takes anything else for iOS", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    });
    expect(mobilePlatform()).toBe("ios");
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" });
    expect(mobilePlatform()).toBe("ios");
  });
});
