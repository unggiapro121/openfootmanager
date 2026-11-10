import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fakeServer,
  LEAGUE,
  myClub,
  ok,
  renderOnline,
  resetOnline,
  SEASON,
} from "../../../test-utils/onlineTestKit";
import { publicPlayer } from "./opponentTestData";

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
  resolveBackendError: (error: unknown) => `resolved:${(error as Error).message}`,
}));

let server: ReturnType<typeof fakeServer>;
beforeEach(() => resetOnline());
afterEach(() => server?.restore());

function open(player = publicPlayer()) {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub()),
    "GET v1/leagues/mine": ok(LEAGUE),
    [`GET v1/players/${player.id}`]: ok(player),
  });
  renderOnline(`/online/players/${player.id}`);
}

describe("another club's player (C-23a §6.5)", () => {
  // Given a player of another club,
  // when the coach opens his page,
  // then it shows who he is and where he plays, his club as a link, and his season's cards.
  it("shows who he is, his club and his season", async () => {
    open();
    expect(await screen.findByRole("heading", { name: "Nguyễn Tiền Đạo Hai" })).toBeVisible();
    expect(screen.getByText("common.age 24")).toBeVisible();
    expect(screen.getByText("75")).toBeVisible();
    expect(screen.getByText("online.publicPlayer.shirt:11")).toBeVisible();
    expect(screen.getByRole("link", { name: "Sóng Biển Đà Nẵng" })).toHaveAttribute(
      "href",
      "/online/clubs/club-2",
    );
    expect(server.requests.map((request) => request.segments.join("/"))).toContain(
      "v1/players/their-10",
    );
    expect(screen.getByText("online.opponent.none")).toBeVisible();
  });

  // Given another club's player,
  // when his page opens,
  // then nothing of his that is the other coach's own shows: no attributes, condition, potential
  // stars, and no action to take.
  it("shows no attribute, condition, potential or action", async () => {
    open();
    await screen.findByRole("heading", { name: "Nguyễn Tiền Đạo Hai" });
    const page = within(screen.getByRole("main"));
    expect(page.queryByRole("progressbar")).toBeNull();
    expect(page.queryByRole("button")).toBeNull();
    expect(page.queryByText(/attributes/i)).toBeNull();
    expect(page.queryByText(/potential/i)).toBeNull();
  });

  // Given a free agent who is hurt and banned,
  // when his page opens,
  // then it says he has no club, and lists both absences without a count of days.
  it("tells a free agent and his absences", async () => {
    open(
      publicPlayer({
        club: undefined,
        absence: [
          { playerId: "their-10", name: "x", naturalPosition: "Striker", kind: "injured" },
          {
            playerId: "their-10",
            name: "x",
            naturalPosition: "Striker",
            kind: "suspended",
            matchesLeft: 1,
          },
        ],
      }),
    );
    expect(await screen.findByText("online.publicPlayer.freeAgent")).toBeVisible();
    const absent = screen.getByRole("region", { name: "online.opponent.absences" });
    expect(within(absent).getByText("online.opponent.injured")).toBeVisible();
    expect(within(absent).getByText("online.opponent.suspended:1")).toBeVisible();
  });
});
