import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import {
  type OnlineRequest,
  type OnlineResponse,
  setOnlineTransport,
} from "../services/onlineTransport";
import type {
  LeagueView,
  MyClubView,
  SeasonNowView,
  SquadPlayerView,
  TrainingDayView,
} from "../online/api";
import { CONTRACT_REVISION } from "../online/api/contract";
import { reopenOnlineGate } from "../online/client";
import { useOnlineStore } from "../online/store/onlineStore";
import OnlineApp from "../online/screens/OnlineApp";

/** What a staged route answers: a body, or a failure as the proxy rejects it. */
export type Answer = { body: unknown } | { failure: { status: number; code: string } & object };

export const ok = (body: unknown): Answer => ({ body });
export const fail = (status: number, code: string, extra: object = {}): Answer => ({
  failure: { status, code, ...extra },
});

/**
 * A fake server for the online screens: each route (`GET v1/clubs/mine`) answers as staged, a
 * function answer is asked anew each time, and every request is recorded.
 */
export function fakeServer(routes: Record<string, Answer | ((request: OnlineRequest) => Answer)>) {
  const requests: OnlineRequest[] = [];
  const restore = setOnlineTransport({
    request: <T,>(request: OnlineRequest): Promise<OnlineResponse<T>> => {
      requests.push(request);
      const staged = routes[`${request.method} ${request.segments.join("/")}`];
      const answer = typeof staged === "function" ? staged(request) : staged;
      if (!answer) return Promise.reject({ status: 0, code: "be.error.online.routeNotAllowed" });
      if ("failure" in answer) {
        const served = answer.failure.status === 0 ? {} : { contractRevision: CONTRACT_REVISION };
        return Promise.reject({ ...answer.failure, ...served });
      }
      return Promise.resolve({
        status: 200,
        body: answer.body as T,
        contractRevision: CONTRACT_REVISION,
      });
    },
  });
  return { requests, restore, routes };
}

/**
 * The requests a test made, less the trophy room's reads (S-42 C20-6) that a player's page sends
 * on its own: a test of a write on that page counts only what the coach did.
 */
export function withoutHonours(requests: OnlineRequest[]): OnlineRequest[] {
  return requests.filter((request) => request.segments[request.segments.length - 1] !== "honours");
}

export function resetOnline(): void {
  reopenOnlineGate();
  useOnlineStore.getState().reset();
}

function Where() {
  const location = useLocation();
  return <output aria-label="location">{location.pathname}</output>;
}

/** The online mode at `path`, with the app's other routes reduced to a marker. */
export function renderOnline(path = "/online") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/online/*" element={<OnlineApp />} />
        <Route path="*" element={<p>outside-online</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

export const SEASON: SeasonNowView = {
  number: 3,
  status: "running",
  region: "AsiaSoutheast",
  day: 4,
  nextDayAt: "2099-01-01T00:00:00Z",
  footballYear: 2028,
};

export function myClub(overrides: Partial<MyClubView> = {}): MyClubView {
  return {
    club: {
      id: "club-1",
      name: "Cầu Vồng Nghệ An",
      shortName: "CVNA",
      city: "Vinh",
      nation: "VN",
      region: "AsiaSoutheast",
      stadiumName: "Sân Vinh",
      stadiumCapacity: 18000,
      colors: { primary: "#c8102e", secondary: "#ffffff" },
      kitPattern: "Plain",
    },
    version: 7,
    squadRefreshing: false,
    unreadMail: 0,
    players: [],
    staff: [],
    setup: {
      formation: "4-4-2",
      playStyle: "Balanced",
      startingXiIds: [],
      playerRoles: {},
      tacticsPhase: {
        build_up_style: "Mixed",
        width: "Normal",
        tempo: "Patient",
        defensive_line: "Medium",
        pressing_intensity: "Medium",
        defensive_shape: "Normal",
        marking_style: "Zonal",
        counter_press_duration: "Short",
        break_speed: "Medium",
        cross_style: "Mixed",
        offside_trap: "Off",
      },
      matchRoles: {
        captain: null,
        vice_captain: null,
        penalty_taker: null,
        free_kick_taker: null,
        corner_taker: null,
      },
    },
    trainingPlan: {
      focus: "Physical",
      intensity: "Medium",
      schedule: "Balanced",
      groups: [],
      auto: true,
    },
    trainingPlanIsOwn: false,
    leagueId: "league-1",
    nextFixture: {
      id: "fixture-9",
      leagueId: "league-1",
      round: 3,
      kickoffAt: "2099-01-01T11:00:00Z",
      status: "scheduled",
      home: { id: "club-1", name: "Cầu Vồng Nghệ An" },
      away: { id: "club-2", name: "Sóng Biển Đà Nẵng" },
    },
    // The first rename is free until one is made (S-14, S-17 R17-5).
    renameFree: true,
    // The coach's own eleven unless a test turns the XI assistant on (S-27).
    xiAssistant: false,
    xiPick: "saved",
    ...overrides,
  };
}

export const LEAGUE: LeagueView = {
  id: "league-1",
  seasonNumber: 3,
  region: "AsiaSoutheast",
  level: 1,
  tier: 0,
  name: "Hạng 1 · A",
  fixturesDone: 14,
  rankedPerMatch: false,
  promotionPlaces: 4,
  table: [
    {
      position: 2,
      club: { id: "club-1", name: "Cầu Vồng Nghệ An" },
      seat: "human",
      played: 2,
      won: 2,
      drawn: 0,
      lost: 0,
      goalsFor: 5,
      goalsAgainst: 1,
      goalDifference: 4,
      points: 6,
      defendingChampion: false,
    },
  ],
};

const ATTRIBUTES: SquadPlayerView["attributes"] = {
  pace: 60,
  stamina: 60,
  strength: 60,
  agility: 60,
  passing: 60,
  shooting: 60,
  tackling: 60,
  dribbling: 60,
  defending: 60,
  positioning: 60,
  vision: 60,
  decisions: 60,
  composure: 60,
  aggression: 60,
  teamwork: 60,
  leadership: 60,
  handling: 20,
  reflexes: 20,
  aerial: 60,
  long_passing: 60,
  crossing: 60,
  curve: 60,
  free_kick: 60,
  long_shots: 60,
  heading: 60,
  first_touch: 60,
};

/** Today's training of a club in a season with recovery blocks, nothing held yet. */
export function trainingDayView(overrides: Partial<TrainingDayView> = {}): TrainingDayView {
  return {
    day: 3,
    recent: [],
    canTrain: true,
    sessionsLast7: 0,
    sessionsCap: 6,
    nextRecoveryAt: "2099-01-01T08:00:00Z",
    recovery: { perDay: 6, hours: 8 },
    autoOff: false,
    keeperDrill: false,
    ...overrides,
  };
}

export function squadPlayer(overrides: Partial<SquadPlayerView> = {}): SquadPlayerView {
  return {
    id: "p1",
    fullName: "Nguyễn Văn An",
    matchName: "V. An",
    position: "Forward",
    naturalPosition: "Striker",
    alternatePositions: [],
    footedness: "Right",
    weakFoot: 3,
    heightCm: 178,
    weightKg: 72,
    traits: [],
    hasAvatarImage: false,
    nationality: "VN",
    age: 23,
    ovr: 64,
    potentialStars: 3,
    shirtNumber: 9,
    positionRatings: [],
    condition: 90,
    fitness: 80,
    morale: 70,
    attributes: ATTRIBUTES,
    season: { appearances: 3, goals: 2, assists: 1, avgRating: 6.8 },
    // The first rename is free until one is made (S-14, S-17 R17-5).
    renameFree: true,
    ...overrides,
  };
}
