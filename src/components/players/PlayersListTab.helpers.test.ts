import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import type { TeamCard, TeamsDirectory } from "../../services/teamsService";
import { buildDirectoryTree } from "../teams/TeamsListTab.helpers";
import { buildLeagueFilterGroups, buildTeamFilterGroups } from "./PlayersListTab.helpers";

const t = ((key: string, options?: Record<string, unknown>) =>
  key.startsWith("nations.")
    ? `Nation ${key.slice("nations.".length)}`
    : String(options?.defaultValue ?? key)) as unknown as TFunction;

function card(id: string, name: string): TeamCard {
  return { team: { id, name } } as unknown as TeamCard;
}

const directory: TeamsDirectory = {
  regions: [
    {
      id: "europe",
      team_count: 4,
      leagues: [
        {
          id: "eng-1",
          name: "Premier",
          country_id: "ENG",
          teams: [card("che", "Chelsea"), card("ars", "Arsenal")],
        },
        { id: "eng-2", name: "Championship", country_id: "ENG", teams: [card("lee", "Leeds")] },
        { id: "esp-1", name: "La Liga", country_id: "ESP", teams: [card("rma", "Real Madrid")] },
      ],
    },
    {
      id: "africa",
      team_count: 1,
      leagues: [{ id: "__ungrouped", name: "", teams: [card("free", "Free FC")] }],
    },
  ],
};

const tree = buildDirectoryTree(directory, t);

describe("buildLeagueFilterGroups", () => {
  // Given leagues across regions, then each region is a group of its leagues,
  // each league labelled with its country, and clubs in no league offer no league.
  it("groups leagues by region, naming each league's country", () => {
    expect(buildLeagueFilterGroups(tree)).toEqual([
      {
        id: "europe",
        label: "Europe",
        options: [
          { id: "eng-1", name: "Premier (Nation eng)" },
          { id: "eng-2", name: "Championship (Nation eng)" },
          { id: "esp-1", name: "La Liga (Nation esp)" },
        ],
      },
    ]);
  });
});

describe("buildTeamFilterGroups", () => {
  // Given no league is chosen, then every club is offered, grouped by league,
  // clubs in name order and clubs in no league last.
  it("groups every club by league when no league is chosen", () => {
    const groups = buildTeamFilterGroups(tree, null);

    expect(groups.map((group) => group.label)).toEqual([
      "Premier (Nation eng)",
      "Championship (Nation eng)",
      "La Liga (Nation esp)",
      "teams.otherClubs",
    ]);
    expect(groups[0].options).toEqual([
      { id: "ars", name: "Arsenal" },
      { id: "che", name: "Chelsea" },
    ]);
  });

  // Given a league is chosen, then only that league's clubs are offered.
  it("offers only the chosen league's clubs", () => {
    expect(buildTeamFilterGroups(tree, "eng-2")).toEqual([
      { id: "eng-2", label: "Championship (Nation eng)", options: [{ id: "lee", name: "Leeds" }] },
    ]);
  });

  // Given a league id the directory does not know, then no club is offered.
  it("offers nothing for an unknown league", () => {
    expect(buildTeamFilterGroups(tree, "missing")).toEqual([]);
  });
});
