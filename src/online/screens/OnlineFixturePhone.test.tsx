import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHONE_QUERY } from "../../hooks/usePhoneLayout";
import type { PlayerLine } from "../api";
import {
  fakeServer,
  LEAGUE,
  myClub,
  ok,
  renderOnline,
  resetOnline,
  SEASON,
} from "../../test-utils/onlineTestKit";

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

let server: ReturnType<typeof fakeServer>;
beforeEach(() => {
  resetOnline();
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
  vi.unstubAllGlobals();
});

function line(playerId: string, name: string, rating: number, extra: Partial<PlayerLine> = {}) {
  return {
    playerId,
    name,
    clubId: "club-1",
    minutes: 90,
    goals: 0,
    assists: 0,
    yellowCards: 0,
    redCards: 0,
    rating,
    ...extra,
  };
}

describe("a settled fixture on a phone", () => {
  // Given a settled fixture whose home players have different parts,
  // when its page opens on a phone,
  // then each club's ratings fit in four columns, best rated first, with the goals, assists and
  // cards of a player gathered in one column.
  it("lists the ratings in four columns, best first", async () => {
    server = fakeServer({
      "GET v1/season": ok(SEASON),
      "GET v1/clubs/mine": ok(myClub()),
      "GET v1/leagues/mine": ok(LEAGUE),
      "GET v1/fixtures/fixture-1": ok({
        fixture: {
          id: "fixture-1",
          leagueId: "league-1",
          round: 1,
          kickoffAt: "2099-01-01T11:00:00Z",
          status: "settled",
          home: { id: "club-1", name: "Cầu Vồng Nghệ An" },
          away: { id: "club-2", name: "Sóng Biển Đà Nẵng" },
          homeGoals: 2,
          awayGoals: 1,
        },
        players: [
          line("a", "An", 6.4),
          line("b", "Bình", 8.1, { goals: 2, assists: 1, yellowCards: 1 }),
          line("c", "Chi", 7.0, { minutes: 30 }),
        ],
      }),
    });
    renderOnline("/online/fixtures/fixture-1");

    expect(await screen.findByRole("heading", { level: 2, name: "2 – 1" })).toBeInTheDocument();
    const [home] = screen.getAllByRole("table");
    expect(within(home).getAllByRole("columnheader")).toHaveLength(4);
    const rows = within(home).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[1].textContent)).toEqual([
      "Bình",
      "Chi",
      "An",
    ]);
    const best = within(rows[0]).getAllByRole("cell")[3];
    expect(
      within(best).getByRole("img", { name: "online.fixture.goalsCount:2" }),
    ).toBeInTheDocument();
    expect(
      within(best).getByRole("img", { name: "online.fixture.assistsCount:1" }),
    ).toBeInTheDocument();
    expect(within(best).getByText("online.fixture.yellowCards:1")).toBeInTheDocument();
  });
});
