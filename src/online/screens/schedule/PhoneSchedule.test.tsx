import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FixtureView } from "../../api";
import { PHONE_QUERY } from "../../../hooks/usePhoneLayout";
import { fakeRealtime } from "../../../test-utils/onlineMatchKit";
import {
  fail,
  fakeServer,
  LEAGUE,
  myClub,
  ok,
  renderOnline,
  resetOnline,
  SEASON,
} from "../../../test-utils/onlineTestKit";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      options && typeof options === "object"
        ? `${key}:${Object.values(options as Record<string, unknown>).join("|")}`
        : key,
    i18n: { language: "en" },
  }),
}));

vi.mock("../../../utils/backendI18n", () => ({
  resolveBackendError: (error: unknown) =>
    `resolved:${error instanceof Error ? error.message : String(error)}`,
}));

const MINE = { id: "club-1", name: "Cầu Vồng Nghệ An" };
const RIVAL = { id: "club-2", name: "Sóng Biển Đà Nẵng" };
const THIRD = { id: "club-3", name: "Sao Mai" };

function fixture(round: number, extra: Partial<FixtureView> = {}): FixtureView {
  return {
    id: `fixture-${round}`,
    leagueId: "league-1",
    round,
    kickoffAt: `2099-01-0${Math.ceil(round / 2)}T11:00:00Z`,
    status: "scheduled",
    home: MINE,
    away: RIVAL,
    ...extra,
  };
}

const FIXTURES = [
  fixture(1, { status: "settled", homeGoals: 2, awayGoals: 0 }),
  fixture(2, { home: THIRD, away: MINE }),
  fixture(3),
  fixture(4, { home: RIVAL, away: MINE }),
];

let server: ReturnType<typeof fakeServer>;
let realtime: ReturnType<typeof fakeRealtime>;

function serve() {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub({ nextFixture: FIXTURES[1] })),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/clubs/mine/fixtures": ok({ fixtures: FIXTURES }),
    "GET v1/friendlies/mine": ok({}),
    "GET v1/clubs/mine/market": ok({ selling: [], holding: [], recent: [] }),
    "GET v1/me/coins": fail(404, "be.error.notFound"),
  });
}

const rows = () =>
  screen
    .getAllByRole("listitem")
    .filter((item) => item.closest("[aria-label='online.schedule.title']"));
const rounds = () => rows().map((row) => row.getAttribute("data-round"));

beforeEach(() => {
  resetOnline();
  realtime = fakeRealtime();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === PHONE_QUERY,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
});
afterEach(() => {
  server?.restore();
  realtime.restore();
  vi.unstubAllGlobals();
});

describe("the schedule on a phone", () => {
  // Given a coach on a phone with a season of four fixtures, the first played,
  // when the schedule opens,
  // then a card names the next match's opponent with a countdown, and every fixture is listed,
  // the next one marked.
  it("leads with the next match and lists the season", async () => {
    serve();
    renderOnline("/online/schedule");

    const next = await screen.findByRole("region", { name: /schedule.nextMatch/ });
    expect(within(next).getByText(/Sao Mai/)).toBeInTheDocument();
    expect(within(next).getByRole("timer")).toBeInTheDocument();
    await waitFor(() => expect(rounds()).toEqual(["1", "2", "3", "4"]));
    expect(rows()[1]).toHaveAttribute("aria-current", "true");
  });

  // Given the same season,
  // when the coach picks Away,
  // then only the two away fixtures remain, and the filter counts each venue.
  it("filters the fixtures by venue", async () => {
    serve();
    renderOnline("/online/schedule");

    const filters = await screen.findByRole("group", { name: "online.schedule.filterLabel" });
    const away = within(filters).getByRole("button", { name: /online.fixture.away/ });
    expect(away).toHaveTextContent("2");
    fireEvent.click(away);
    expect(away).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(rounds()).toEqual(["2", "4"]));
  });
});
