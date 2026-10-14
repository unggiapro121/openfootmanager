import { describe, expect, it } from "vitest";

import type { PlayerData } from "../../store/gameStore";
import { DEFAULT_TRANSFER_MARKET_FILTERS } from "./TransfersTab.filters";
import { applyMarketPanelFilters } from "./TransfersTab.panelFilters";

function player(overrides: Partial<PlayerData>): PlayerData {
  return {
    id: "p",
    full_name: "P",
    date_of_birth: "2000-01-01",
    position: "CenterBack",
    natural_position: "CenterBack",
    ovr: 70,
    team_id: "ars",
    ...overrides,
  } as PlayerData;
}

describe("applyMarketPanelFilters", () => {
  const players = [
    player({ id: "young-cb", date_of_birth: "2007-03-01", ovr: 64, team_id: "ars" }),
    player({
      id: "prime-lb",
      position: "LeftBack",
      natural_position: "LeftBack",
      ovr: 82,
      team_id: "rma",
    }),
    player({
      id: "old-st",
      position: "Striker",
      natural_position: "Striker",
      date_of_birth: "1990-01-01",
      ovr: 80,
      team_id: "fla",
    }),
    player({ id: "free", date_of_birth: "1998-05-01", ovr: 75, team_id: null }),
  ];
  const ids = (list: PlayerData[]) => list.map((p) => p.id);

  // Given an age range, then only players of those ages on the game date stay.
  it("keeps players inside the age range", () => {
    const filters = { ...DEFAULT_TRANSFER_MARKET_FILTERS, ageMin: 20, ageMax: 30 };
    expect(ids(applyMarketPanelFilters(players, filters, "2027-02-08", null))).toEqual([
      "prime-lb",
      "free",
    ]);
  });

  // Given an OVR range, then only players rated inside it stay.
  it("keeps players inside the OVR range", () => {
    const filters = { ...DEFAULT_TRANSFER_MARKET_FILTERS, ovrMin: 75, ovrMax: 81 };
    expect(ids(applyMarketPanelFilters(players, filters, "2027-02-08", null))).toEqual([
      "old-st",
      "free",
    ]);
  });

  // Given a position group and a specific position, then only that position stays.
  it("keeps players of the chosen position", () => {
    const filters = {
      ...DEFAULT_TRANSFER_MARKET_FILTERS,
      positionGroup: "Defender",
      position: "LeftBack",
    };
    expect(ids(applyMarketPanelFilters(players, filters, "2027-02-08", null))).toEqual([
      "prime-lb",
    ]);
  });

  // Given clubs in scope, then only their players stay; a free agent has no club.
  it("keeps players of the clubs in scope", () => {
    expect(
      ids(
        applyMarketPanelFilters(
          players,
          DEFAULT_TRANSFER_MARKET_FILTERS,
          "2027-02-08",
          new Set(["ars", "fla"]),
        ),
      ),
    ).toEqual(["young-cb", "old-st"]);
  });
});
