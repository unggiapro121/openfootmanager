import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FixtureView, MatchView } from "../../api";
import {
  fakeServer,
  LEAGUE,
  myClub,
  ok,
  renderOnline,
  resetOnline,
  SEASON,
  squadPlayer,
} from "../../../test-utils/onlineTestKit";
import { formMatch, opponentView, THEM, theirSide } from "./opponentTestData";

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

const PROFILE = "/online/clubs/club-2/opponent";
const opponentRoute = "GET v1/clubs/club-2/opponent";

function stage(routes: Parameters<typeof fakeServer>[0] = {}, club = myClub()) {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(club),
    "GET v1/leagues/mine": ok(LEAGUE),
    [opponentRoute]: ok(opponentView()),
    ...routes,
  });
}

const card = (name: string) => screen.getByRole("region", { name });

/** The kit club's next fixture: against club-2, `fixture-9`. */
function nextFixture(): FixtureView {
  const next = myClub().nextFixture;
  if (!next) throw new Error("the kit's club has a next fixture");
  return next;
}

describe("the opponent profile", () => {
  // Given a club with three matches played this season (C-23a §6.2),
  // when the coach opens its profile from his next fixture,
  // then the read names the fixture, and blocks (a) to (g) show what the server sent.
  it("shows every block of a club with three matches", async () => {
    stage();
    renderOnline(`${PROFILE}?fixture=fixture-9`);

    expect(await screen.findByRole("heading", { name: THEM.name })).toBeInTheDocument();
    expect(
      server.requests.find((request) => request.segments.join("/") === "v1/clubs/club-2/opponent"),
    ).toMatchObject({ query: [["fixture", "fixture-9"]] });

    const header = card(THEM.name);
    expect(within(header).getByText("online.opponent.leagueLine:Hạng Nhất|4|6|3")).toBeVisible();
    expect(within(header).getByText("online.publicClub.coach:Trần Lan")).toBeVisible();
    expect(within(header).getByText("online.opponent.savedFormation:4-4-2")).toBeVisible();
    expect(within(header).getByText("online.opponent.mayChange")).toBeVisible();

    const form = card("online.opponent.form");
    expect(within(form).getAllByRole("img")).toHaveLength(3);
    expect(within(form).getByText("online.opponent.averages:1|1.3")).toBeVisible();
    expect(within(form).getByText("online.opponent.recordLine:2|1|0|1|3|4")).toBeVisible();

    const met = card("online.opponent.headToHead");
    expect(within(met).getByText("online.opponent.headToHeadTotal:0|0|1")).toBeVisible();
    expect(within(met).getByRole("link", { name: /1 – 2/ })).toHaveAttribute(
      "href",
      "/online/fixtures/met-1",
    );

    const lineup = card("online.opponent.lastLineup");
    expect(within(lineup).getByRole("link", { name: /Tiền Đạo Hai/ })).toHaveAttribute(
      "href",
      "/online/players/their-10",
    );
    expect(within(lineup).getByText(/Dự Bị/)).toBeVisible();

    const notable = card("online.opponent.notable");
    expect(within(notable).getByText("online.opponent.notableValue:4|3")).toBeVisible();
    expect(within(notable).getByText("online.opponent.notableValue:7.5|3")).toBeVisible();
    expect(within(notable).getByRole("link", { name: "Hậu Hai" })).toHaveAttribute(
      "href",
      "/online/players/their-2",
    );

    const absent = card("online.opponent.absences");
    expect(within(absent).getByText("online.opponent.injured")).toBeVisible();
    expect(within(absent).getByText("online.opponent.suspended:2")).toBeVisible();
  });

  // Given an injured player (S-46a sends no days left, Q-OS3),
  // when the absences block draws him,
  // then no count of days shows anywhere in it.
  it("tells an injury without its days", async () => {
    stage();
    renderOnline(PROFILE);
    const absent = await screen.findByRole("region", { name: "online.opponent.absences" });
    expect(absent.textContent).not.toMatch(/\d+\s*(day|ngày)/i);
    expect(within(absent).getAllByRole("listitem")).toHaveLength(2);
  });

  // Given a club with no match played, never met, no line-up and nobody absent,
  // when its profile opens without a fixture,
  // then the read has no query, and each block says it has nothing.
  it("says so where a block has nothing", async () => {
    stage({
      [opponentRoute]: ok(
        opponentView({
          form: [],
          headToHead: [],
          lastLineup: undefined,
          notable: {},
          absences: [],
          coach: undefined,
        }),
      ),
    });
    renderOnline(PROFILE);

    expect(await screen.findByText("online.opponent.noMatches")).toBeVisible();
    expect(screen.getByText("online.opponent.neverMet")).toBeVisible();
    expect(screen.getByText("online.opponent.noLineup")).toBeVisible();
    expect(screen.getByText("online.opponent.noNotable")).toBeVisible();
    expect(screen.getByText("online.opponent.none")).toBeVisible();
    expect(screen.getByText("online.publicClub.botCoach")).toBeVisible();
    const read = server.requests.find(
      (request) => request.segments.join("/") === "v1/clubs/club-2/opponent",
    );
    expect(read?.query).toBeUndefined();
  });

  // Given a form that reaches back into last season and a line-up under the club's last coach
  // (BR-2),
  // when the profile draws them,
  // then those matches and the line-up carry their labels.
  it("labels last season's matches and the previous coach's", async () => {
    const view = opponentView({
      form: [formMatch(1), formMatch(2, { previousSeason: true, previousCoach: true })],
    });
    stage({
      [opponentRoute]: ok({
        ...view,
        lastLineup: view.lastLineup && { ...view.lastLineup, previousCoach: true },
      }),
    });
    renderOnline(PROFILE);

    const form = await screen.findByRole("region", { name: "online.opponent.form" });
    expect(within(form).getAllByText("online.opponent.previousSeason")).toHaveLength(1);
    expect(within(form).getAllByText("online.opponent.previousCoach")).toHaveLength(1);
    expect(
      within(card("online.opponent.lastLineup")).getByText("online.opponent.previousCoach"),
    ).toBeVisible();
  });

  // Given their last eleven and the coach's own (C-23a §6.4),
  // when the lines are compared,
  // then each line shows both means to a tenth and the gap, an empty line of his left blank.
  it("compares the two elevens line by line", async () => {
    const club = myClub({
      players: [
        squadPlayer({ id: "mine-1", position: "Defender", naturalPosition: "CenterBack", ovr: 72 }),
        squadPlayer({ id: "mine-2", position: "Forward", naturalPosition: "Striker", ovr: 70 }),
      ],
    });
    club.setup = { ...club.setup, startingXiIds: ["mine-1", "mine-2"] };
    stage({}, club);
    renderOnline(PROFILE);

    const lines = await screen.findByRole("region", { name: "online.opponent.lines" });
    const row = (group: string) =>
      within(lines).getByRole("row", { name: new RegExp(`common.positionGroups.${group}`) });
    expect(within(row("Defender")).getByText("70.3")).toBeVisible();
    expect(within(row("Defender")).getByText("72")).toBeVisible();
    expect(within(row("Defender")).getByText("+1.7")).toBeVisible();
    expect(within(row("Forward")).getByText("−4")).toBeVisible();
    expect(within(row("Goalkeeper")).getByText("64")).toBeVisible();
    expect(within(row("Goalkeeper")).getAllByText("–")).toHaveLength(2);
  });

  // Given one of the coach's own players named in the profile (his own club opened),
  // when the profile links him,
  // then he opens the coach's squad page, not the public one (§6.5).
  it("links the coach's own player to his squad page", async () => {
    const club = myClub({ players: [squadPlayer({ id: "their-2" })] });
    stage({}, club);
    renderOnline(PROFILE);
    const notable = await screen.findByRole("region", { name: "online.opponent.notable" });
    expect(within(notable).getByRole("link", { name: "Hậu Hai" })).toHaveAttribute(
      "href",
      "/online/squad/their-2",
    );
  });
});

describe("the kick-off line-ups (block h)", () => {
  function matchView(status: string): MatchView {
    const side = (name: string) => ({
      name,
      formation: "4-4-2",
      playStyle: "Balanced" as const,
      players: theirSide(),
    });
    return {
      id: "match-9",
      status,
      home: side("Cầu Vồng Nghệ An"),
      away: side(THEM.name),
    } as unknown as MatchView;
  }

  function withMatch(matchStatus: string) {
    return myClub({
      nextFixture: { ...nextFixture(), matchId: "match-9", matchStatus },
    });
  }

  // Given the next fixture's match has been built and is about to start (Q-OS10),
  // when the coach opens the opponent from that fixture,
  // then both locked sides show, and no way into the match yet.
  it("shows both locked sides once the match is built", async () => {
    stage({ "GET v1/matches/match-9": ok(matchView("scheduled")) }, withMatch("scheduled"));
    renderOnline(`${PROFILE}?fixture=fixture-9`);
    const block = await screen.findByRole("region", { name: "online.opponent.kickoffLineup" });
    expect(await within(block).findByText("online.opponent.locked")).toBeVisible();
    expect(within(block).getByText("Cầu Vồng Nghệ An")).toBeVisible();
    expect(within(block).queryByRole("link", { name: "online.fixture.enterMatch" })).toBeNull();
  });

  // Given the match is live,
  // when the block draws,
  // then it leads into the match.
  it("leads into a live match", async () => {
    stage({ "GET v1/matches/match-9": ok(matchView("live")) }, withMatch("live"));
    renderOnline(`${PROFILE}?fixture=fixture-9`);
    const block = await screen.findByRole("region", { name: "online.opponent.kickoffLineup" });
    expect(
      await within(block).findByRole("link", { name: "online.fixture.enterMatch" }),
    ).toHaveAttribute("href", "/online/match/match-9");
  });

  // Given the next fixture's match not built yet,
  // when the coach opens the opponent from that fixture,
  // then there is no block (h).
  it("is left out before the match is built", async () => {
    stage();
    renderOnline(`${PROFILE}?fixture=fixture-9`);
    await screen.findByRole("region", { name: "online.opponent.form" });
    expect(screen.queryByRole("region", { name: "online.opponent.kickoffLineup" })).toBeNull();
  });

  // Given the match built, but the profile opened without its fixture (from a league table),
  // when the profile draws,
  // then there is no block (h) and no match is read.
  it("is left out without the fixture", async () => {
    stage({ "GET v1/matches/match-9": ok(matchView("scheduled")) }, withMatch("scheduled"));
    renderOnline(PROFILE);
    await screen.findByRole("region", { name: "online.opponent.form" });
    expect(screen.queryByRole("region", { name: "online.opponent.kickoffLineup" })).toBeNull();
    expect(server.requests.some((request) => request.segments[1] === "matches")).toBe(false);
  });
});

describe("the ways into the profile", () => {
  // Given the coach's next match (§6.1),
  // when the overview shows it,
  // then a link opens the opponent's profile for that fixture.
  it("opens from the next match card with the fixture", async () => {
    stage();
    renderOnline("/online");
    expect(await screen.findByRole("link", { name: "online.opponent.open" })).toHaveAttribute(
      "href",
      "/online/clubs/club-2/opponent?fixture=fixture-9",
    );
  });

  // Given the club's public page of the coach's next opponent,
  // when it opens,
  // then it links the profile with the fixture, and its players to their public pages.
  it("opens from the next opponent's public page", async () => {
    stage({
      "GET v1/clubs/club-2": ok({
        club: opponentView().club,
        formation: "4-4-2",
        players: [
          {
            id: "their-10",
            fullName: "Nguyễn Tiền Đạo Hai",
            position: "Forward",
            naturalPosition: "Striker",
            age: 24,
            ovr: 75,
          },
        ],
      }),
    });
    renderOnline("/online/clubs/club-2");
    expect(await screen.findByRole("link", { name: "online.opponent.title" })).toHaveAttribute(
      "href",
      "/online/clubs/club-2/opponent?fixture=fixture-9",
    );
    expect(screen.getByRole("link", { name: "Nguyễn Tiền Đạo Hai" })).toHaveAttribute(
      "href",
      "/online/players/their-10",
    );
  });

  // Given a fixture still to play in the coach's season,
  // when the schedule lists it,
  // then the row links its opponent's profile with that fixture; a played one does not.
  it("opens from an unplayed fixture of the schedule", async () => {
    const upcoming = nextFixture();
    const played = { ...upcoming, id: "fixture-1", status: "settled", homeGoals: 1, awayGoals: 0 };
    stage({ "GET v1/clubs/mine/fixtures": ok({ fixtures: [played, upcoming] }) });
    renderOnline("/online/schedule");
    const links = await screen.findAllByRole("link", { name: /online.opponent.linkLabel/ });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/online/clubs/club-2/opponent?fixture=fixture-9");
  });
});

describe("the phone's opponent profile", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === "(max-width: 767.98px)",
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  // Given a phone (C-23a §6.3),
  // when the profile opens,
  // then the form and absences cards are open, the others folded, and a folded one opens on a tap.
  it("folds every card but the form and the absences", async () => {
    stage();
    renderOnline(PROFILE);
    const toggle = (name: string) => screen.getByRole("button", { name });

    expect(await screen.findByRole("heading", { name: THEM.name })).toBeInTheDocument();
    expect(toggle("online.opponent.form")).toHaveAttribute("aria-expanded", "true");
    expect(toggle("online.opponent.absences")).toHaveAttribute("aria-expanded", "true");
    for (const folded of [
      "online.opponent.headToHead",
      "online.opponent.lastLineup",
      "online.opponent.lines",
      "online.opponent.notable",
    ]) {
      expect(toggle(folded)).toHaveAttribute("aria-expanded", "false");
    }
    expect(screen.queryByRole("link", { name: /Tiền Đạo Hai/ })).toBeNull();

    fireEvent.click(toggle("online.opponent.lastLineup"));
    expect(toggle("online.opponent.lastLineup")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: /Tiền Đạo Hai/ })).toHaveAttribute(
      "href",
      "/online/players/their-10",
    );
  });

  // Given a phone,
  // when the profile draws its form and head to head,
  // then they are lists, not tables, so nothing scrolls sideways.
  it("draws no table that would scroll sideways", async () => {
    stage();
    renderOnline(PROFILE);
    await screen.findByRole("heading", { name: THEM.name });
    fireEvent.click(screen.getByRole("button", { name: "online.opponent.headToHead" }));
    expect(screen.queryAllByRole("table")).toHaveLength(0);
    expect(document.querySelector(".overflow-x-auto")).toBeNull();
  });
});
