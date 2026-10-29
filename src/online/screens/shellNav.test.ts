import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import { isCurrent, pageTitleKey, seasonText } from "./shellNav";

const t = ((key: string, options?: Record<string, unknown>) =>
  options ? `${key}:${Object.values(options).join("|")}` : key) as unknown as TFunction;

describe("pageTitleKey", () => {
  // Given a page of the coach's own sections, then the header names it by its entry.
  it("names a section's page by its entry", () => {
    expect(pageTitleKey("/online")).toBe("online.nav.overview");
    expect(pageTitleKey("/online/coins")).toBe("online.nav.coins");
    expect(pageTitleKey("/online/coins/")).toBe("online.nav.coins");
    expect(pageTitleKey("/online/takeover")).toBe("online.takeover.title");
  });

  // Given a page under a section (a player, an auction, a fixture), then it takes the section's name.
  it("names a page under a section by the section", () => {
    expect(pageTitleKey("/online/squad/p-1")).toBe("online.nav.squad");
    expect(pageTitleKey("/online/auctions/a-1")).toBe("online.nav.market");
    expect(pageTitleKey("/online/fixtures/f-1")).toBe("online.nav.schedule");
  });

  // Given another club's page or a match, then none: the header names the coach's club.
  it("names no page outside the sections", () => {
    expect(pageTitleKey("/online/clubs/c-2")).toBeUndefined();
    expect(pageTitleKey("/online/match/m-1")).toBeUndefined();
  });
});

describe("isCurrent", () => {
  // Given the page open, then its entry is current, and a section's for the pages under it.
  it("marks the entry of the page open", () => {
    expect(isCurrent("/online/shop", "/online/shop")).toBe(true);
    expect(isCurrent("/online/shop", "/online/inventory")).toBe(false);
    expect(isCurrent("/online", "/online/takeover")).toBe(true);
    expect(isCurrent("/online", "/online/shop")).toBe(false);
    expect(isCurrent("/online/market", "/online/auctions/a-1")).toBe(true);
    expect(isCurrent("/online/squad", "/online/squad/p-1")).toBe(true);
  });
});

describe("seasonText", () => {
  // Given a season on a day, before its days, and none, then each is said apart.
  it("says the season and its day", () => {
    const season = {
      number: 4,
      status: "running",
      region: "AsiaSoutheast",
      day: 15,
      nextDayAt: "2099-01-01T00:00:00Z",
      footballYear: 2028,
    };
    expect(seasonText(t, season)).toBe("online.header.seasonDay:4|16|28");
    expect(seasonText(t, { ...season, day: undefined })).toBe("online.header.season:4");
    expect(seasonText(t, null)).toBe("online.season.none");
  });
});
