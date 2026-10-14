import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import type { TeamCard, TeamsDirectory } from "../../services/teamsService";
import { buildDirectoryTree } from "../teams/TeamsListTab.helpers";
import {
  PLAYER_FILTER_DEFAULTS,
  countActivePlayerFilters,
  positionsForFilter,
  teamIdsInScope,
} from "./playerFilters";

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

describe("countActivePlayerFilters", () => {
  // Given default filters, then none are active; each range, the position and
  // the competition scope count once however many of their fields are set.
  it("counts each filter of the panel once", () => {
    expect(countActivePlayerFilters(PLAYER_FILTER_DEFAULTS)).toBe(0);
    expect(
      countActivePlayerFilters({
        ...PLAYER_FILTER_DEFAULTS,
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
