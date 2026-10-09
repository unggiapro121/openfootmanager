import { describe, expect, it } from "vitest";

import type { FixtureDetailData, FixturePlayerStatsData } from "../../services/matchDetailService";
import {
  eventLabel,
  localizeDetailNames,
  manOfTheMatchId,
  playerLinesForSide,
  playerNameOf,
} from "./MatchDetail.helpers";

function stats(
  playerId: string,
  teamId: string,
  overrides: Partial<FixturePlayerStatsData> = {},
): FixturePlayerStatsData {
  return {
    playerId,
    teamId,
    minutesPlayed: 90,
    goals: 0,
    assists: 0,
    shots: 0,
    shotsOnTarget: 0,
    passesCompleted: 0,
    passesAttempted: 0,
    tacklesWon: 0,
    interceptions: 0,
    foulsCommitted: 0,
    yellowCards: 0,
    redCards: 0,
    rating: 6.5,
    ...overrides,
  };
}

function detail(overrides: Partial<FixtureDetailData> = {}): FixtureDetailData {
  return {
    fixtureId: "f1",
    competitionId: "c1",
    competitionName: "Premier",
    competition: "League",
    matchday: 1,
    date: "2026-08-20",
    homeTeamId: "home",
    homeTeamName: "Home FC",
    awayTeamId: "away",
    awayTeamName: "Away FC",
    result: null,
    teamStats: [],
    playerStats: [],
    players: [
      { id: "gk", name: "Keeper", fullName: "A Keeper", position: "Goalkeeper" },
      { id: "st", name: "Striker", fullName: "A Striker", position: "Striker" },
      { id: "sub", name: "Sub", fullName: "A Sub", position: "Winger" },
    ],
    ...overrides,
  };
}

const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${JSON.stringify(params)}` : key;

describe("MatchDetail helpers", () => {
  // Given a goal with an assist, then the label names the scorer and the assist.
  it("labels a goal with its assist", () => {
    const nameOf = playerNameOf(detail());

    const label = eventLabel(
      {
        minute: 30,
        event_type: "Goal",
        side: "Home",
        player_id: "st",
        secondary_player_id: "sub",
      },
      nameOf,
      t,
    );

    expect(label).toBe('Striker (match.assist:{"name":"Sub"})');
  });

  // Given a lineup and a substitute who came on, then the side's players list
  // the starters in slot order first and the substitute after them.
  it("lists starters in lineup order, then substitutes who played", () => {
    const withLineup = detail({
      playerStats: [
        stats("sub", "home", { minutesPlayed: 20 }),
        stats("st", "home"),
        stats("gk", "home"),
      ],
      result: {
        home_goals: 0,
        away_goals: 0,
        home_scorers: [],
        away_scorers: [],
        report: {
          total_minutes: 90,
          home_stats: {
            possession_pct: 50,
            shots: 0,
            shots_on_target: 0,
            fouls: 0,
            corners: 0,
            yellow_cards: 0,
            red_cards: 0,
          },
          away_stats: {
            possession_pct: 50,
            shots: 0,
            shots_on_target: 0,
            fouls: 0,
            corners: 0,
            yellow_cards: 0,
            red_cards: 0,
          },
          events: [],
          home_lineup: {
            formation: "4-4-2",
            play_style: "Balanced",
            starters: [
              { player_id: "gk", position: "Goalkeeper" },
              { player_id: "st", position: "Striker" },
            ],
            bench: ["sub"],
          },
        },
      },
    });

    const lines = playerLinesForSide(withLineup, "home");

    expect(lines.map((line) => [line.playerId, line.started, line.position])).toEqual([
      ["gk", true, "Goalkeeper"],
      ["st", true, "Striker"],
      ["sub", false, "Winger"],
    ]);
  });

  // Given player ratings, then the man of the match is the best-rated player
  // who played, from either side.
  it("picks the best-rated player as man of the match", () => {
    const rated = detail({
      playerStats: [
        stats("gk", "home", { rating: 7.1 }),
        stats("st", "away", { rating: 8.4 }),
        stats("sub", "home", { rating: 9.9, minutesPlayed: 0 }),
      ],
    });

    expect(manOfTheMatchId(rated)).toBe("st");
  });

  // Given no stats at all, then there is no man of the match.
  it("names no man of the match without ratings", () => {
    expect(manOfTheMatchId(detail())).toBeNull();
  });

  // Given a generated league and a national team whose names are templates,
  // then the dialog shows them translated, as every other screen does.
  it("translates a templated competition name and a national team's name", () => {
    const translate = (key: string, params?: Record<string, unknown>) => {
      if (key === "competitions.firstDivision") return `${String(params?.country)} First Division`;
      if (key === "nations.ar") return "Argentina";
      if (key === "nations.fr") return "France";
      if (key === "nations.nationalTeamTemplate") return `${String(params?.name)} NT`;
      return String(params?.defaultValue ?? key);
    };

    const named = localizeDetailNames(
      detail({ competitionId: "c1", homeTeamId: "nt-fr", homeTeamName: "France National Team" }),
      {
        competitions: [
          { id: "c1", name: "Raw Name", name_key: "competitions.firstDivision", country_id: "AR" },
        ],
        national_teams: [{ id: "nt-fr", name: "France National Team", name_key: "nations.fr" }],
      },
      translate,
    );

    expect(named.competitionName).toBe("Argentina First Division");
    expect(named.homeTeamName).toBe("France NT");
    expect(named.awayTeamName).toBe("Away FC");
  });

  // Given a penalty goal, then its label says so in the player's language.
  it("labels a penalty goal with the translated event name", () => {
    const label = eventLabel(
      {
        minute: 12,
        event_type: "PenaltyGoal",
        side: "Away",
        player_id: "st",
        secondary_player_id: null,
      },
      playerNameOf(detail()),
      t,
    );

    expect(label).toBe("Striker (match.eventTypes.PenaltyGoal)");
  });
});
