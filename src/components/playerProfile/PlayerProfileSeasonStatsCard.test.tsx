import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PlayerSeasonStats } from "../../store/gameStore";
import PlayerProfileSeasonStatsCard from "./PlayerProfileSeasonStatsCard";

const t = (key: string) => key;

const stats = {
  appearances: 12,
  goals: 4,
  assists: 2,
  clean_sheets: 0,
  yellow_cards: 1,
  red_cards: 0,
  avg_rating: 6.4,
  minutes_played: 900,
} as PlayerSeasonStats;

function formBox(): HTMLElement {
  return screen.getByText("playerProfile.recentForm").parentElement as HTMLElement;
}

describe("PlayerProfileSeasonStatsCard", () => {
  it("shows the player's recent form on the rating scale", () => {
    render(<PlayerProfileSeasonStatsCard stats={stats} matchForm={73} t={t} />);

    expect(formBox()).toHaveTextContent("7.3");
  });

  it("shows a dash when the player's form is not known", () => {
    render(<PlayerProfileSeasonStatsCard stats={stats} matchForm={undefined} t={t} />);

    expect(formBox()).toHaveTextContent("-");
  });
});
