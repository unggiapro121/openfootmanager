// What the opponent profile's tests read: a club the coach plays next, as S-46a sends it.

import type {
  FormMatchView,
  OpponentView,
  ProjectedPlayer,
  PublicPlayerPageView,
  TrendSideView,
  TrendView,
} from "../../api";
import { seasonStats } from "../../../test-utils/onlineTestKit";

export const THEM = { id: "club-2", name: "Sóng Biển Đà Nẵng" };

export function formMatch(n: number, extra: Partial<FormMatchView> = {}): FormMatchView {
  return {
    fixtureId: `played-${n}`,
    kickoffAt: "2098-12-20T11:00:00Z",
    seasonNumber: 3,
    leagueName: "Hạng Nhất",
    home: true,
    opponent: { id: `club-${10 + n}`, name: `Đội ${n}` },
    goalsFor: 2,
    goalsAgainst: 1,
    outcome: "W",
    previousSeason: false,
    previousCoach: false,
    ...extra,
  };
}

const ELEVEN: [string, ProjectedPlayer["position"], number][] = [
  ["Thủ Môn", "Goalkeeper", 64],
  ["Hậu Một", "Defender", 70],
  ["Hậu Hai", "Defender", 72],
  ["Hậu Ba", "Defender", 68],
  ["Hậu Bốn", "Defender", 71],
  ["Tiền Vệ Một", "Midfielder", 66],
  ["Tiền Vệ Hai", "Midfielder", 67],
  ["Tiền Vệ Ba", "Midfielder", 69],
  ["Tiền Vệ Bốn", "Midfielder", 70],
  ["Tiền Đạo Một", "Forward", 73],
  ["Tiền Đạo Hai", "Forward", 75],
];

/** Their eleven in slot order, then one man on the bench. */
export function theirSide(): ProjectedPlayer[] {
  const eleven = ELEVEN.map(([matchName, position, ovr], slot) => ({
    id: `their-${slot}`,
    matchName,
    position,
    ovr,
    shirtNumber: slot + 1,
    slot,
    onPitch: true,
  }));
  return [
    ...eleven,
    { id: "their-bench", matchName: "Dự Bị", position: "Forward", ovr: 60, onPitch: false },
  ];
}

export function opponentView(extra: Partial<OpponentView> = {}): OpponentView {
  return {
    club: {
      ...THEM,
      shortName: "SBDN",
      city: "Đà Nẵng",
      nation: "VN",
      region: "AsiaSoutheast",
      stadiumName: "Sân Hoà Xuân",
      stadiumCapacity: 20000,
      colors: { primary: "#003366", secondary: "#ffffff" },
      kitPattern: "Plain",
    },
    coach: { firstName: "Lan", lastName: "Trần", fullName: "Trần Lan" },
    savedFormation: "4-4-2",
    league: { id: "league-1", name: "Hạng Nhất", level: 2, position: 4, played: 3, points: 6 },
    form: [
      formMatch(1),
      formMatch(2, { home: false, goalsFor: 0, goalsAgainst: 0, outcome: "D" }),
      formMatch(3, { goalsFor: 1, goalsAgainst: 3, outcome: "L" }),
    ],
    record: {
      home: { played: 2, won: 1, drawn: 0, lost: 1, goalsFor: 3, goalsAgainst: 4 },
      away: { played: 1, won: 0, drawn: 1, lost: 0, goalsFor: 0, goalsAgainst: 0 },
    },
    headToHead: [
      formMatch(7, {
        fixtureId: "met-1",
        seasonNumber: 2,
        opponent: { id: "club-1", name: "Cầu Vồng Nghệ An" },
        goalsFor: 1,
        goalsAgainst: 2,
        outcome: "L",
      }),
    ],
    lastLineup: {
      fixtureId: "played-1",
      kickoffAt: "2098-12-20T11:00:00Z",
      previousSeason: false,
      previousCoach: false,
      side: { name: THEM.name, formation: "4-4-2", playStyle: "Counter", players: theirSide() },
    },
    notable: {
      goals: {
        playerId: "their-10",
        name: "Tiền Đạo Hai",
        naturalPosition: "Striker",
        value: 4,
        appearances: 3,
      },
      rating: {
        playerId: "their-2",
        name: "Hậu Hai",
        naturalPosition: "CenterBack",
        value: 7.46,
        appearances: 3,
      },
    },
    absences: [
      { playerId: "their-9", name: "Tiền Đạo Một", naturalPosition: "Striker", kind: "injured" },
      {
        playerId: "their-9",
        name: "Tiền Đạo Một",
        naturalPosition: "Striker",
        kind: "suspended",
        matchesLeft: 2,
      },
    ],
    ...extra,
  };
}

export function publicPlayer(extra: Partial<PublicPlayerPageView> = {}): PublicPlayerPageView {
  return {
    id: "their-10",
    fullName: "Nguyễn Tiền Đạo Hai",
    position: "Forward",
    naturalPosition: "Striker",
    age: 24,
    ovr: 75,
    nationality: "VN",
    shirtNumber: 11,
    club: THEM,
    season: seasonStats({ appearances: 3, goals: 4 }),
    absence: [],
    ...extra,
  };
}

/** One side of a trend where nothing happened: every count 0, the lanes empty. */
export function trendSide(extra: Partial<TrendSideView> = {}): TrendSideView {
  return {
    possessionPct: 50,
    shots: 0,
    shotsOnTarget: 0,
    corners: 0,
    fouls: 0,
    yellowCards: 0,
    redCards: 0,
    longBalls: 0,
    crosses: 0,
    lowCrosses: 0,
    earlyCrosses: 0,
    counters: 0,
    highTurnovers: 0,
    ballsInBehind: 0,
    flankExposed: 0,
    offsides: 0,
    goalsBySource: {
      openPlay: 0,
      corner: 0,
      freeKickSetPiece: 0,
      penalty: 0,
      header: 0,
      directFreeKick: 0,
      longShot: 0,
    },
    finalThirdLanes: { left: 0, centre: 0, right: 0 },
    ...extra,
  };
}

/** A trend over `matches` matches, as S-46b sends it. */
export function trendView(
  team: Partial<TrendSideView> = {},
  against: Partial<TrendSideView> = {},
  matches = 5,
): TrendView {
  return { matches, team: trendSide(team), against: trendSide(against) };
}
