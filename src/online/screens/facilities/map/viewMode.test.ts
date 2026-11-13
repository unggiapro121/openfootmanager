import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hintSeen, markHintSeen, readViewMode, VIEW_MODE_KEY, writeViewMode } from "./viewMode";

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe("the facilities screen's view (c-27 §6.3)", () => {
  // Given nothing remembered,
  // when the screen opens on a desktop or on a phone,
  // then it shows the map on a desktop and the list on a phone.
  it("opens on the map on a desktop and the list on a phone", () => {
    expect(readViewMode(false)).toBe("map");
    expect(readViewMode(true)).toBe("list");
  });

  // Given the coach chose a view on this device,
  // when the screen opens again,
  // then it shows that view whatever the device's default.
  it("remembers the coach's choice", () => {
    writeViewMode("list");
    expect(window.localStorage.getItem(VIEW_MODE_KEY)).toBe("list");
    expect(readViewMode(false)).toBe("list");
    writeViewMode("map");
    expect(readViewMode(true)).toBe("map");
  });

  // Given storage holding something else, or failing to read or write,
  // when the view is read or chosen,
  // then it falls back to the default and nothing throws.
  it("falls back to the default when storage fails", () => {
    window.localStorage.setItem(VIEW_MODE_KEY, "grid");
    expect(readViewMode(true)).toBe("list");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readViewMode(false)).toBe("map");
    expect(() => writeViewMode("list")).not.toThrow();
    expect(() => markHintSeen()).not.toThrow();
  });

  // Given the map's hint not dismissed in this session,
  // when the coach first drags the map,
  // then the hint is seen for the rest of the session.
  it("keeps the hint seen for the session", () => {
    expect(hintSeen()).toBe(false);
    markHintSeen();
    expect(hintSeen()).toBe(true);
  });
});
