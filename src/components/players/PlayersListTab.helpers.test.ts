import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import type { TeamCard, TeamsDirectory } from "../../services/teamsService";
import { buildDirectoryTree } from "../teams/TeamsListTab.helpers";
import { buildTeamFilterGroups } from "./PlayersListTab.helpers";

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

describe("buildTeamFilterGroups", () => {
  // Given no competition scope, then every club is offered, grouped by league,
  // clubs in name order and clubs in no league last.
  it("groups every club by league when no scope is chosen", () => {
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

  // Given the clubs of a scope, then only they are offered, under their own
  // leagues, and a league with none of them is left out.
  it("offers only the clubs of the scope", () => {
    expect(buildTeamFilterGroups(tree, new Set(["lee", "che"]))).toEqual([
      { id: "eng-1", label: "Premier (Nation eng)", options: [{ id: "che", name: "Chelsea" }] },
      { id: "eng-2", label: "Championship (Nation eng)", options: [{ id: "lee", name: "Leeds" }] },
    ]);
  });

  // Given a scope with no clubs, then no club is offered.
  it("offers nothing for an empty scope", () => {
    expect(buildTeamFilterGroups(tree, new Set())).toEqual([]);
  });
});
