import { beforeAll, describe, expect, it } from "vitest";
import i18n, { i18nReady } from "../../../../i18n";
import { liveMarks } from "./reportParts";

describe("liveMarks", () => {
  beforeAll(async () => {
    await i18nReady;
    await i18n.changeLanguage("en");
  });

  // Given a man of the report banned now for one match and another for two,
  // when their marks are written in English,
  // then each names its own number of matches, with no "1 matches" and no raw placeholder
  // (PO note N2 on C-24b).
  it("names how many matches a banned man still misses", () => {
    const live = { left: [], injured: [], suspended: { a: 1, b: 2 } };

    expect(liveMarks(i18n.t, live, "a")).toEqual(["suspended for 1 match(es)"]);
    expect(liveMarks(i18n.t, live, "b")).toEqual(["suspended for 2 match(es)"]);
  });
});
