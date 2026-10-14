import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import type { TeamCard, TeamsDirectory } from "../../services/teamsService";
import type { PlayerData } from "../../store/gameStore";
import { buildDirectoryTree } from "../teams/TeamsListTab.helpers";
import { DEFAULT_TRANSFER_MARKET_FILTERS, countActiveMarketFilters } from "./TransfersTab.filters";
import {
  applyMarketPanelFilters,
  positionsForFilter,
  teamIdsInScope,
} from "./TransferMarketFilterPanel.helpers";

const t = ((key: string, options?: Record<string, unknown>) =>
  String(options?.defaultValue ?? key)) as unknown as TFunction;

function card(id: string): TeamCard {
  return { team: { id, name: id } } as unknown as TeamCard;
}

const tree = buildDirectoryTree(
  {
    regions: [
      {
        id: "europe",
        team_count: 3,
        leagues: [
          { id: "eng-1", name: "Premier", country_id: "ENG", teams: [card("ars"), card("che")] },
          { id: "esp-1", name: "La Liga", country_id: "ESP", teams: [card("rma")] },
        ],
      },
      {
        id: "south-america",
        team_count: 1,
        leagues: [{ id: "bra-1", name: "Serie A", country_id: "BRA", teams: [card("fla")] }],
      },
    ],
  } satisfies TeamsDirectory,
  t,
);

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

describe("positionsForFilter", () => {
  // Given a group and no specific position, then every position of the group
  // counts; a specific position narrows it to that one; neither means any.
  it("turns the two position dropdowns into the positions that match", () => {
    expect(positionsForFilter("Defender", null)).toEqual([
      "CenterBack",
      "LeftBack",
      "RightBack",
      "LeftWingBack",
      "RightWingBack",
    ]);
    expect(positionsForFilter("Defender", "LeftBack")).toEqual(["LeftBack"]);
    expect(positionsForFilter(null, null)).toEqual([]);
  });
});

describe("teamIdsInScope", () => {
  // Given a region, a country or a league, then the clubs of that scope; with
  // nothing chosen, no restriction at all.
  it("narrows clubs by region, then country, then league", () => {
    expect(teamIdsInScope(tree, null, null, null)).toBeNull();
    expect(teamIdsInScope(tree, "europe", null, null)).toEqual(new Set(["ars", "che", "rma"]));
    expect(teamIdsInScope(tree, "europe", "ESP", null)).toEqual(new Set(["rma"]));
    expect(teamIdsInScope(tree, "europe", "ENG", "eng-1")).toEqual(new Set(["ars", "che"]));
  });
});

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

describe("countActiveMarketFilters", () => {
  // Given default filters, then none are active; each range, the position and
  // the competition scope count once however many of their fields are set.
  it("counts each filter of the panel once", () => {
    expect(countActiveMarketFilters(DEFAULT_TRANSFER_MARKET_FILTERS)).toBe(0);
    expect(
      countActiveMarketFilters({
        ...DEFAULT_TRANSFER_MARKET_FILTERS,
        ageMin: 18,
        ageMax: 23,
        ovrMin: 70,
        positionGroup: "Defender",
        position: "LeftBack",
        regionId: "europe",
        countryId: "ENG",
      }),
    ).toBe(4);
  });
});
