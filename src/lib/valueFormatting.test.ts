import { afterEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "../store/settingsStore";
import { formatCount, formatExactMoney } from "./valueFormatting";

const original = useSettingsStore.getState().settings;

afterEach(() => {
  useSettingsStore.setState({ settings: original });
});

describe("formatCount", () => {
  // Given the game's language set apart from the machine's,
  // when a count (a stadium's seats) is written,
  // then it groups digits as the game's language does, the way money is, never the machine's.
  it.each([
    ["en", "27,000"],
    ["de", "27.000"],
  ])("groups digits by the game's language %s", (language, text) => {
    useSettingsStore.setState({ settings: { ...original, language } });

    expect(formatCount(27_000)).toBe(text);
    expect(formatExactMoney(27_000)).toContain(text);
  });
});
