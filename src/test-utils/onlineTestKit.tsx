import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import {
  type OnlineRequest,
  type OnlineResponse,
  setOnlineTransport,
} from "../services/onlineTransport";
import type { LeagueView, MyClubView, SeasonNowView } from "../online/api";
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
    },
    version: 7,
    squadRefreshing: false,
    players: [],
    staff: [],
    setup: {} as MyClubView["setup"],
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
    },
  ],
};
