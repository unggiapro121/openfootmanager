import { fireEvent, screen, within } from "@testing-library/react";
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

/** A settled fixture between club-1 (home) and club-2 (away), two players a side. */
function fixtureDetail() {
  return {
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
      line("h1", "Hải", 7.2),
      line("h2", "Hùng", 6.8),
      line("a1", "Anh", 7.5, { clubId: "club-2" }),
      line("a2", "Bảo", 6.1, { clubId: "club-2" }),
    ],
  };
}

/** Opens the fixture with the viewer coaching `viewerClubId`. */
function openFixture(viewerClubId: string) {
  const viewer = myClub();
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok({ ...viewer, club: { ...viewer.club, id: viewerClubId } }),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/fixtures/fixture-1": ok(fixtureDetail()),
  });
  renderOnline("/online/fixtures/fixture-1");
}

/** The names in the one ratings table on show. */
function namesShown(): (string | null)[] {
  const [table] = screen.getAllByRole("table");
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[1].textContent);
}

describe("the ratings tabs on a phone (C-22a)", () => {
  // Given a settled fixture and a viewer who coaches the home club,
  // when its page opens on a phone,
  // then the two clubs are two tabs, the home tab open, and only the home players are listed.
  it("opens the home club's tab for the home coach", async () => {
    openFixture("club-1");

    const tabs = await screen.findByRole("tablist", { name: "online.fixture.clubTabs" });
    const [home, away] = within(tabs).getAllByRole("tab");
    expect(home).toHaveTextContent("Cầu Vồng Nghệ An");
    expect(away).toHaveTextContent("Sóng Biển Đà Nẵng");
    expect(home).toHaveAttribute("aria-selected", "true");
    expect(away).toHaveAttribute("aria-selected", "false");
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(within(screen.getByRole("tabpanel")).getByRole("table")).toBeInTheDocument();
    expect(namesShown()).toEqual(["Hải", "Hùng"]);
  });

  // Given a settled fixture and a viewer who coaches the away club,
  // when its page opens on a phone,
  // then the away tab is the one open: a coach sees his own club first.
  it("opens the away club's tab for the away coach", async () => {
    openFixture("club-2");

    const tabs = await screen.findByRole("tablist", { name: "online.fixture.clubTabs" });
    const [home, away] = within(tabs).getAllByRole("tab");
    expect(away).toHaveAttribute("aria-selected", "true");
    expect(home).toHaveAttribute("aria-selected", "false");
    expect(namesShown()).toEqual(["Anh", "Bảo"]);
  });

  // Given a settled fixture between two clubs the viewer does not coach,
  // when its page opens on a phone,
  // then the home tab is the one open.
  it("opens the home club's tab for an onlooker", async () => {
    openFixture("club-9");

    const tabs = await screen.findByRole("tablist", { name: "online.fixture.clubTabs" });
    expect(within(tabs).getAllByRole("tab")[0]).toHaveAttribute("aria-selected", "true");
    expect(namesShown()).toEqual(["Hải", "Hùng"]);
  });

  // Given the home tab open,
  // when the away tab is tapped, and then the home tab,
  // then the list follows each tap.
  it("changes club when a tab is tapped", async () => {
    openFixture("club-1");

    const tabs = await screen.findByRole("tablist", { name: "online.fixture.clubTabs" });
    const [home, away] = within(tabs).getAllByRole("tab");
    fireEvent.click(away);
    expect(away).toHaveAttribute("aria-selected", "true");
    expect(home).toHaveAttribute("aria-selected", "false");
    expect(namesShown()).toEqual(["Anh", "Bảo"]);
    fireEvent.click(home);
    expect(home).toHaveAttribute("aria-selected", "true");
    expect(namesShown()).toEqual(["Hải", "Hùng"]);
  });

  // Given the home tab open and focused,
  // when the right arrow is pressed, and then Home,
  // then focus and the list move to the away club and back, only the open tab in the Tab order
  // (P5-5).
  it("changes club with the arrow keys", async () => {
    openFixture("club-1");

    const tabs = await screen.findByRole("tablist", { name: "online.fixture.clubTabs" });
    const [home, away] = within(tabs).getAllByRole("tab");
    expect(home).toHaveAttribute("tabindex", "0");
    expect(away).toHaveAttribute("tabindex", "-1");
    home.focus();
    fireEvent.keyDown(home, { key: "ArrowRight" });
    expect(away).toHaveFocus();
    expect(away).toHaveAttribute("tabindex", "0");
    expect(namesShown()).toEqual(["Anh", "Bảo"]);
    fireEvent.keyDown(away, { key: "ArrowRight" });
    expect(home).toHaveFocus();
    fireEvent.keyDown(home, { key: "End" });
    expect(away).toHaveFocus();
    fireEvent.keyDown(away, { key: "Home" });
    expect(home).toHaveFocus();
    expect(namesShown()).toEqual(["Hải", "Hùng"]);
  });
});

describe("the ratings on a desktop (C-22a)", () => {
  // Given a settled fixture,
  // when its page opens on a wide screen,
  // then both clubs' tables are shown side by side and there are no tabs.
  it("keeps both clubs' tables and no tabs", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    openFixture("club-2");

    expect(await screen.findByRole("heading", { level: 2, name: "2 – 1" })).toBeInTheDocument();
    expect(screen.getAllByRole("table")).toHaveLength(2);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });
});

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
