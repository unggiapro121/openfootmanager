import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import en from "../../i18n/locales/en.json";
import fr from "../../i18n/locales/fr.json";
import vi from "../../i18n/locales/vi.json";
import type { PlayerAdvancedStatsSummary } from "./PlayerProfile.helpers";
import PlayerProfileAdvancedStatsCard from "./PlayerProfileAdvancedStatsCard";

type Tree = { [key: string]: string | Tree };

/** The locale's own sentence for `key`, filled the way i18next fills it. */
function translatorOf(locale: Tree) {
  return (key: string, options?: Record<string, unknown>): string => {
    let node: string | Tree | undefined = locale;
    for (const part of key.split(".")) {
      node = typeof node === "object" ? node[part] : undefined;
    }
    if (typeof node !== "string") return key;
    return node.replace(/{{\s*(\w+)\s*}}/g, (_, name: string) => String(options?.[name] ?? ""));
  };
}

function summary(percentiles: Array<number | null>): PlayerAdvancedStatsSummary {
  const [shots, onTarget, passes, tackles, interceptions, fouls] = percentiles;
  const metric = (percentile: number | null | undefined) => ({
    total: 10,
    per90: 1,
    percentile: percentile ?? null,
  });
  return {
    percentileEligible: true,
    metrics: {
      shots: metric(shots),
      shotsOnTarget: metric(onTarget),
      passes: { completed: 8, attempted: 10, accuracy: 80, percentile: passes ?? null },
      tacklesWon: metric(tackles),
      interceptions: metric(interceptions),
      foulsCommitted: metric(fouls),
    },
  };
}

const RANKS = [70, 1, 2, 3, 11, 22];

describe("the advanced stats card's percentile ranks", () => {
  // Given a player ranked 70, 1, 2, 3, 11 and 22 in his six figures,
  // when the card draws in English,
  // then each rank takes its English ordinal: 70th, 1st, 2nd, 3rd, 11th, 22nd.
  it("writes English ordinals in English", () => {
    render(
      <PlayerProfileAdvancedStatsCard
        summary={summary(RANKS)}
        t={translatorOf(en as Tree)}
        language="en"
      />,
    );
    for (const rank of ["70th", "1st", "2nd", "3rd", "11th", "22nd"]) {
      expect(screen.getByText(rank)).toBeInTheDocument();
    }
  });

  // Given the same ranks,
  // when the card draws in Vietnamese,
  // then no English suffix shows: each rank reads "PN", a percentile (PO P5-20: "thứ 100" would
  // read as last, where 100 is the top).
  it("writes Vietnamese ranks in Vietnamese", () => {
    render(
      <PlayerProfileAdvancedStatsCard
        summary={summary(RANKS)}
        t={translatorOf(vi as Tree)}
        language="vi"
      />,
    );
    for (const rank of RANKS) {
      expect(screen.getByText(`P${rank}`)).toBeInTheDocument();
    }
    expect(screen.queryByText(/\d(st|nd|rd|th)$/)).toBeNull();
  });

  // Given ranks 1 and 70,
  // when the card draws in French, whose ordinals differ for 1,
  // then they read 1er and 70e.
  it("follows the language's own ordinal forms", () => {
    render(
      <PlayerProfileAdvancedStatsCard
        summary={summary([1, 70])}
        t={translatorOf(fr as Tree)}
        language="fr"
      />,
    );
    expect(screen.getByText("1er")).toBeInTheDocument();
    expect(screen.getByText("70e")).toBeInTheDocument();
  });

  // Given a language Intl cannot read (an empty one),
  // when the card draws,
  // then it still draws, each rank in the language's "other" form.
  it("still draws when the language cannot be read", () => {
    render(
      <PlayerProfileAdvancedStatsCard
        summary={summary([70, 1])}
        t={translatorOf(en as Tree)}
        language=""
      />,
    );
    expect(screen.getByText("70th")).toBeInTheDocument();
    expect(screen.getByText("1th")).toBeInTheDocument();
  });

  // Given a figure with no rank,
  // when the card draws,
  // then it shows a dash, as before.
  it("shows a dash for a figure without a rank", () => {
    render(
      <PlayerProfileAdvancedStatsCard
        summary={summary([null, null, null, null, null, null])}
        t={translatorOf(vi as Tree)}
        language="vi"
      />,
    );
    expect(screen.getAllByText("-")).toHaveLength(6);
  });
});
