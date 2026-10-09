import { describe, expect, it } from "vitest";

import { assessmentRefreshKey, withScoutedWonderkid } from "./scoutedTraits";

describe("withScoutedWonderkid", () => {
  it("adds Wonderkid when the club's read says so", () => {
    expect(withScoutedWonderkid(["Speedster"], true)).toEqual(["Speedster", "Wonderkid"]);
  });

  it("leaves the traits alone when the read does not, or there is none", () => {
    expect(withScoutedWonderkid(["Speedster"], false)).toEqual(["Speedster"]);
    expect(withScoutedWonderkid(["Speedster"], undefined)).toEqual(["Speedster"]);
  });

  it("never shows Wonderkid twice", () => {
    expect(withScoutedWonderkid(["Wonderkid"], true)).toEqual(["Wonderkid"]);
  });
});

describe("assessmentRefreshKey", () => {
  const staff = [
    { id: "s2", team_id: "club" },
    { id: "s1", team_id: "club" },
    { id: "x", team_id: "rival" },
  ];

  it("changes with the day and with the club's staff, not other clubs'", () => {
    const today = assessmentRefreshKey("2026-08-01", staff, "club");

    expect(today).toBe("2026-08-01|s1,s2");
    expect(assessmentRefreshKey("2026-08-02", staff, "club")).not.toBe(today);
    expect(assessmentRefreshKey("2026-08-01", staff.slice(1), "club")).not.toBe(today);
    expect(
      assessmentRefreshKey("2026-08-01", [...staff, { id: "y", team_id: "rival" }], "club"),
    ).toBe(today);
  });
});
