import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHONE_QUERY } from "../../../hooks/usePhoneLayout";
import {
  EMPTY_PERFORMANCE,
  fail,
  fakeServer,
  myClub,
  ok,
  resetOnline,
  seasonStats,
  squadPlayer,
} from "../../../test-utils/onlineTestKit";
import type { PlayerPerformanceView, SquadPlayerView } from "../../api";
import { useOnlineStore } from "../../store/onlineStore";
import OnlinePlayer from "./OnlinePlayer";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      options && typeof options === "object" && !("defaultValue" in options)
        ? `${key}:${Object.values(options as Record<string, unknown>).join("|")}`
        : key,
    i18n: { language: "en" },
  }),
}));

// The rating trend draws with recharts, which needs a laid-out page jsdom has not.
vi.mock("../../../components/playerProfile/PlayerRatingTrendChart", () => ({
  PlayerRatingTrendChart: () => <div data-testid="rating-trend" />,
}));

const STRIKER = squadPlayer({
  id: "st",
  season: seasonStats({ appearances: 3, minutesPlayed: 270, yellowCards: 1, cleanSheets: 0 }),
  matchForm: 72,
  career: [
    {
      season: 3,
      clubId: "club-old",
      clubName: "Dragons Lamphun",
      appearances: 20,
      goals: 7,
      assists: 2,
    },
  ],
});

const PERFORMANCE: PlayerPerformanceView = {
  advanced: {
    percentileEligible: true,
    metrics: {
      ...EMPTY_PERFORMANCE.advanced.metrics,
      shots: { total: 6, per90: 2, percentile: 81 },
    },
  },
  recentMatches: [
    {
      fixtureId: "fx-1",
      kickoffAt: "2026-11-07T12:00:00Z",
      round: 3,
      clubId: "club-1",
      opponentClubId: "club-2",
      opponentName: "Bengkulu Buffaloes",
      teamGoals: 2,
      opponentGoals: 1,
      minutes: 90,
      goals: 1,
      assists: 0,
      shots: 3,
      shotsOnTarget: 2,
      yellowCards: 0,
      redCards: 0,
      rating: 7.4,
    },
  ],
};

let server: ReturnType<typeof fakeServer>;

beforeEach(() => resetOnline());
afterEach(() => {
  server?.restore();
  vi.unstubAllGlobals();
});

const performanceReads = () =>
  server.requests
    .map((one) => one.segments.join("/"))
    .filter((path) => path.endsWith("/performance"));

function renderPlayer(player: SquadPlayerView, performance: ReturnType<typeof ok>) {
  useOnlineStore.getState().setClub(myClub({ players: [player] }));
  server = fakeServer({ "GET v1/players/st/performance": performance });
  return render(
    <MemoryRouter initialEntries={["/online/squad/st"]}>
      <Routes>
        <Route path="/online/squad/:playerId" element={<OnlinePlayer />} />
      </Routes>
    </MemoryRouter>,
  );
}

function card(title: string): HTMLElement {
  const heading = screen.getByText(title);
  const box = heading.closest("div.rounded-xl") ?? heading.parentElement;
  if (!(box instanceof HTMLElement)) throw new Error(`no card ${title}`);
  return box;
}

describe("a player's season and matches online (C-21)", () => {
  // Given a striker with three matches, a yellow card, a form of 7.2 and one finished season,
  // when his page opens and the server ranks his figures and lists his last match,
  // then the season card holds all nine numbers, the advanced card shows the rank, the career
  // names the season by its number, and the match links to its fixture page.
  it("shows the offline profile's cards with the server's figures", async () => {
    renderPlayer(STRIKER, ok(PERFORMANCE));

    const season = card("playerProfile.seasonStats");
    expect(within(season).getByText("playerProfile.mins")).toBeInTheDocument();
    expect(within(season).getByText("270")).toBeInTheDocument();
    expect(within(season).getByText("playerProfile.recentForm")).toBeInTheDocument();
    expect(within(season).getByText("7.2")).toBeInTheDocument();
    expect(within(season).getByText("playerProfile.yellows")).toBeInTheDocument();

    expect(await screen.findByText("Bengkulu Buffaloes")).toBeInTheDocument();
    const score = screen.getByRole("link", { name: "2 - 1" });
    expect(score).toHaveAttribute("href", "/online/fixtures/fx-1");
    expect(screen.getByTestId("rating-trend")).toBeInTheDocument();
    expect(screen.getByText("81st")).toBeInTheDocument();

    expect(screen.getByText("Dragons Lamphun")).toBeInTheDocument();
    expect(screen.getByText("online.player.careerSeason:3")).toBeInTheDocument();
    // The honours card (S-42) reads its own route; the performance route is read once.
    expect(performanceReads()).toEqual(["v1/players/st/performance"]);
  });

  // Given a server older than S-43: the squad view has four season numbers and no form or
  // career, and the performance route is unknown (404),
  // when the page opens,
  // then it still draws: the missing numbers read 0, the form "-", the advanced card shows the
  // season's totals unranked, no match card, and the career says there is none.
  it("draws from an older server's view without failing", async () => {
    const older = {
      ...STRIKER,
      season: { appearances: 3, goals: 2, assists: 1, avgRating: 6.8 },
      matchForm: undefined,
      career: undefined,
    } as unknown as SquadPlayerView;
    renderPlayer(older, fail(404, "be.error.notFound"));

    await waitFor(() => expect(performanceReads()).toHaveLength(1));
    const season = card("playerProfile.seasonStats");
    expect(within(season).getByText("-")).toBeInTheDocument();
    expect(screen.getByText("playerProfile.advancedStats")).toBeInTheDocument();
    expect(screen.queryByText("playerProfile.recentMatches")).not.toBeInTheDocument();
    expect(screen.getByText("playerProfile.noCareer")).toBeInTheDocument();
  });

  // Given a phone,
  // when the coach opens the season tab,
  // then it holds the nine numbers (form included) and the cards below them.
  it("shows the same on a phone's season tab", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === PHONE_QUERY,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    renderPlayer(STRIKER, ok(PERFORMANCE));

    fireEvent.click(screen.getByRole("tab", { name: "online.player.phone.tab.season" }));
    const boxes = screen.getByRole("list", { name: "online.player.phone.tab.season" });
    expect(within(boxes).getAllByRole("listitem")).toHaveLength(9);
    expect(within(boxes).getByText("7.2")).toBeInTheDocument();
    expect(await screen.findByText("Bengkulu Buffaloes")).toBeInTheDocument();
    expect(screen.getByText("Dragons Lamphun")).toBeInTheDocument();
  });
});
