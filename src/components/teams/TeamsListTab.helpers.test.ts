import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import type { TeamCard, TeamsDirectory } from "../../services/teamsService";
import { buildDirectoryTree, locateTeam, resolveSelection } from "./TeamsListTab.helpers";

const t = ((key: string, options?: Record<string, unknown>) =>
  key.startsWith("nations.")
    ? `Nation ${key.slice("nations.".length)}`
    : String(options?.defaultValue ?? key)) as unknown as TFunction;

function card(id: string): TeamCard {
  return { team: { id } } as unknown as TeamCard;
}

const directory: TeamsDirectory = {
  regions: [
    {
      id: "europe",
      team_count: 4,
      leagues: [
        { id: "eng-1", name: "Premier", country_id: "ENG", teams: [card("ars"), card("che")] },
        { id: "eng-2", name: "Championship", country_id: "ENG", teams: [card("lee")] },
        { id: "esp-1", name: "La Liga", country_id: "ESP", teams: [card("rma")] },
      ],
    },
    {
      id: "africa",
      team_count: 1,
      leagues: [{ id: "__ungrouped", name: "", teams: [card("free")] }],
    },
  ],
};

describe("buildDirectoryTree", () => {
  // Given leagues from two countries of a region, then the region holds the two
  // countries, each with its own leagues in the order the backend gave.
  it("groups a region's leagues under their countries", () => {
    const tree = buildDirectoryTree(directory, t);

    const europe = tree.find((region) => region.id === "europe");
    expect(europe?.countries.map((country) => country.id)).toEqual(["ENG", "ESP"]);
    expect(europe?.countries[0].leagues.map((league) => league.id)).toEqual(["eng-1", "eng-2"]);
    expect(europe?.countries[0].name).toBe("Nation eng");
  });

  // Given clubs in no league and no country, then they sit under "other clubs".
  it("puts clubs with no league under other clubs", () => {
    const tree = buildDirectoryTree(directory, t);

    const africa = tree.find((region) => region.id === "africa");
    expect(africa?.countries[0].name).toBe("teams.otherClubs");
    expect(africa?.countries[0].leagues[0].name).toBe("teams.otherClubs");
  });
});

describe("locateTeam", () => {
  // Given a club in the tree, then its region, country and league are found.
  it("finds where a club plays", () => {
    const tree = buildDirectoryTree(directory, t);

    expect(locateTeam(tree, "lee")).toEqual({
      regionId: "europe",
      countryId: "ENG",
      leagueId: "eng-2",
    });
    expect(locateTeam(tree, "nobody")).toBeNull();
  });
});

describe("resolveSelection", () => {
  // Given a country picked that the region does not have, then the selection
  // falls back to the region's first country and that country's first league.
  it("falls back to the first country and league that exist", () => {
    const tree = buildDirectoryTree(directory, t);

    expect(
      resolveSelection(tree, { regionId: "europe", countryId: "BRA", leagueId: "eng-1" }),
    ).toEqual({ regionId: "europe", countryId: "ENG", leagueId: "eng-1" });
    expect(
      resolveSelection(tree, { regionId: "europe", countryId: "ESP", leagueId: "eng-1" }),
    ).toEqual({ regionId: "europe", countryId: "ESP", leagueId: "esp-1" });
  });

  // Given no selection at all, then the first region, country and league are on show.
  it("starts from the first region when nothing is picked", () => {
    const tree = buildDirectoryTree(directory, t);

    expect(resolveSelection(tree, null)?.regionId).toBe(tree[0].id);
    expect(resolveSelection([], null)).toBeNull();
  });
});
