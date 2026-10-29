import { describe, expect, it } from "vitest";
import {
  countdownTo,
  deviceDiffersFromRegion,
  formatCoins,
  formatKickoffClock,
  formatMoment,
  formatRegionClock,
  formatTenths,
  secondsUntil,
} from "./format";

const NOW = Date.parse("2026-10-23T10:00:00Z");

describe("countdownTo", () => {
  // Given a kick-off a day, two hours, three minutes and four seconds away,
  // when the countdown is read,
  // then it shows one day and the rest as a clock.
  it("splits the time left into days and a clock", () => {
    expect(countdownTo("2026-10-24T12:03:04Z", NOW)).toEqual({ days: 1, clock: "02:03:04" });
  });

  // Given a moment less than a second away,
  // when the countdown is read,
  // then it still shows one second, never zero before the moment has come.
  it("rounds a part of a second up", () => {
    expect(countdownTo("2026-10-23T10:00:00.400Z", NOW)).toEqual({ days: 0, clock: "00:00:01" });
  });

  // Given a moment that has passed, or one the server sent unreadable,
  // when the countdown is read,
  // then there is none.
  it("has no countdown for a past or unreadable moment", () => {
    expect(countdownTo("2026-10-23T10:00:00Z", NOW)).toBeNull();
    expect(countdownTo("2026-10-23T09:00:00Z", NOW)).toBeNull();
    expect(countdownTo("not a date", NOW)).toBeNull();
  });
});

describe("secondsUntil", () => {
  // Given a moment a second and a half away, and one already gone,
  // when the seconds left are read,
  // then the first rounds up and the second never goes below zero.
  it("rounds up and never goes below zero", () => {
    expect(secondsUntil(NOW + 1500, NOW)).toBe(2);
    expect(secondsUntil(NOW - 5000, NOW)).toBe(0);
  });
});

describe("formatMoment", () => {
  // Given a kick-off and the player's language,
  // when it is shown,
  // then it is written on this machine's clock in that language, and an unreadable one as sent.
  it("writes the moment in the player's language", () => {
    const text = formatMoment("2026-10-23T11:00:00Z", "en");
    expect(text).toMatch(/Oct/);
    expect(formatMoment("soon", "en")).toBe("soon");
  });
});

describe("formatKickoffClock", () => {
  // Given kick-offs today and on a later day on this machine's clock,
  // when they are shown in a short list,
  // then today's is its time alone, a later one its weekday and time, an unreadable one as sent.
  it("writes today's time alone and a later day's with its weekday", () => {
    const today = new Date(NOW);
    today.setHours(23, 30, 0, 0);
    const later = new Date(today.getTime() + 2 * 86_400_000);
    expect(formatKickoffClock(today.toISOString(), NOW, "en")).toMatch(/^\d{1,2}:30( PM)?$/);
    expect(formatKickoffClock(later.toISOString(), NOW, "en")).toMatch(/^[A-Z][a-z]{2} .*:30/);
    expect(formatKickoffClock("soon", NOW, "en")).toBe("soon");
  });
});

describe("formatRegionClock", () => {
  // Given a kick-off at 11:00 UTC,
  // when it is written on each region's clock,
  // then each shows its own fixed offset, whatever this machine's zone is.
  it("writes the time on the region's clock", () => {
    const iso = "2026-10-23T11:00:00Z";
    expect(formatRegionClock(iso, "AsiaSoutheast", "en-GB")).toBe("18:00");
    expect(formatRegionClock(iso, "AsiaEast", "en-GB")).toBe("19:00");
    expect(formatRegionClock(iso, "Europe", "en-GB")).toBe("12:00");
    expect(formatRegionClock(iso, "Americas", "en-GB")).toBe("06:00");
  });
});

describe("deviceDiffersFromRegion", () => {
  // Given this machine's offset at a moment,
  // when it is compared with a region's fixed offset,
  // then only a different offset is reported, and an unknown region never is.
  it("reports only a different offset", () => {
    const iso = "2026-10-23T11:00:00Z";
    const deviceOffset = -new Date(iso).getTimezoneOffset();
    const offsets: Record<string, number> = {
      AsiaSoutheast: 420,
      AsiaEast: 480,
      Europe: 60,
      Americas: -300,
    };
    for (const [region, offset] of Object.entries(offsets)) {
      expect(deviceDiffersFromRegion(region, iso)).toBe(offset !== deviceOffset);
    }
    expect(deviceDiffersFromRegion("Atlantis", iso)).toBe(false);
  });
});

describe("formatCoins", () => {
  // Given whole coin counts, one below zero,
  // when they are written in English and Vietnamese,
  // then each language groups the digits its own way, the sign stays, and no currency mark or
  // fraction appears (C-7 C7-5).
  it("writes whole coins grouped by language, without a currency mark", () => {
    expect(formatCoins(12_500, "en")).toBe("12,500");
    expect(formatCoins(12_500, "vi")).toBe("12.500");
    expect(formatCoins(-40, "en")).toBe("-40");
    expect(formatCoins(7, "en")).not.toMatch(/[€$.]/);
  });
});

describe("formatTenths", () => {
  // Given a strength the server sends in whole tenths of OVR (705, 630, 0),
  // when it is shown in Vietnamese and in English,
  // then it reads with one decimal in each language's own separator.
  it("shows a strength in tenths with one decimal", () => {
    expect(formatTenths(705, "vi")).toBe("70,5");
    expect(formatTenths(705, "en")).toBe("70.5");
    expect(formatTenths(630, "en")).toBe("63.0");
    expect(formatTenths(0, "en")).toBe("0.0");
  });
});
