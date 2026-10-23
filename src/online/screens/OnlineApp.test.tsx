import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_REVISION } from "../api/contract";
import {
  fail,
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

vi.mock("../../utils/backendI18n", () => ({
  resolveBackendError: (error: unknown) => `resolved:${(error as Error).message}`,
}));

let server: ReturnType<typeof fakeServer>;

beforeEach(() => resetOnline());
afterEach(() => {
  server?.restore();
  vi.useRealTimers();
});

const sent = (method: string, path: string) =>
  server.requests.filter(
    (request) => request.method === method && request.segments.join("/") === path,
  );

describe("a coach with a club", () => {
  // Given a coach who runs a club in a running season,
  // when the online mode opens,
  // then the overview shows the club, the season's day, the next opponent and the league place.
  it("shows the club, the season, the next match and the league place", async () => {
    server = fakeServer({
      "GET v1/season": ok(SEASON),
      "GET v1/clubs/mine": ok(myClub()),
      "GET v1/leagues/mine": ok(LEAGUE),
    });
    renderOnline();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Cầu Vồng Nghệ An" }),
    ).toBeInTheDocument();
    expect(screen.getByText("online.header.seasonDay:3|5|28")).toBeInTheDocument();
    expect(screen.getByText("online.fixture.versus:Sóng Biển Đà Nẵng")).toBeInTheDocument();
    expect(screen.getByText("common.place.2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "home.standings" }));
    expect(await screen.findByLabelText("location")).toHaveTextContent("/online/league");
  });

  // Given a club whose match is being played,
  // when the overview opens,
  // then the next-match card takes the coach into it.
  it("takes the coach into their match while it is played", async () => {
    const club = myClub();
    server = fakeServer({
      "GET v1/season": ok(SEASON),
      "GET v1/clubs/mine": ok({
        ...club,
        nextFixture: club.nextFixture && {
          ...club.nextFixture,
          status: "prepared",
          matchId: "match-9",
          matchStatus: "live",
        },
      }),
      "GET v1/leagues/mine": ok(LEAGUE),
    });
    renderOnline();
    expect(await screen.findByRole("link", { name: "online.fixture.enterLive" })).toHaveAttribute(
      "href",
      "/online/match/match-9",
    );
  });

  // Given a club whose league seat waits for next season,
  // when the overview opens,
  // then it says so instead of a table place.
  it("says when the club plays in no league this season", async () => {
    server = fakeServer({
      "GET v1/season": ok(SEASON),
      "GET v1/clubs/mine": ok(myClub({ leagueId: undefined, nextFixture: undefined })),
      "GET v1/leagues/mine": fail(404, "be.error.notFound"),
    });
    renderOnline();

    expect(await screen.findByText("online.league.none")).toBeInTheDocument();
    expect(screen.getByText("online.fixture.none")).toBeInTheDocument();
  });

  // Given the rename form,
  // when a new name is saved,
  // then it is sent once with an idempotency key, and the club shows its new name.
  it("renames the club", async () => {
    server = fakeServer({
      "GET v1/season": ok(SEASON),
      "GET v1/clubs/mine": ok(myClub()),
      "GET v1/leagues/mine": ok(LEAGUE),
      "PATCH v1/clubs/mine": (request) =>
        ok(myClub({ club: { ...myClub().club, name: (request.body as { name: string }).name } })),
    });
    renderOnline();

    fireEvent.click(await screen.findByRole("button", { name: "online.club.rename" }));
    fireEvent.change(screen.getByLabelText("online.club.renameLabel"), {
      target: { value: "  Sao Mai  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "online.club.save" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Sao Mai" })).toBeInTheDocument();
    const [rename] = sent("PATCH", "v1/clubs/mine");
    expect(rename.body).toEqual({ name: "Sao Mai" });
    expect(rename.idempotencyKey).toEqual(expect.any(String));
  });

  // Given a name another club already has,
  // when it is saved,
  // then the server's refusal shows under the field and the form stays open.
  it("shows why a name was refused", async () => {
    server = fakeServer({
      "GET v1/season": ok(SEASON),
      "GET v1/clubs/mine": ok(myClub()),
      "GET v1/leagues/mine": ok(LEAGUE),
      "PATCH v1/clubs/mine": fail(409, "be.error.club.nameTaken"),
    });
    renderOnline();

    fireEvent.click(await screen.findByRole("button", { name: "online.club.rename" }));
    fireEvent.click(screen.getByRole("button", { name: "online.club.save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("resolved:be.error.club.nameTaken");
    expect(screen.getByLabelText("online.club.renameLabel")).toBeInTheDocument();
  });
});

describe("taking over a club", () => {
  // Given a coach with no club,
  // when the online mode opens on the overview,
  // then it goes to the takeover page, which explains the three ways a takeover goes.
  it("sends a coach without a club to the takeover page", async () => {
    server = fakeServer({
      "GET v1/season": ok(SEASON),
      "GET v1/clubs/mine": fail(404, "be.error.club.none"),
      "GET v1/leagues/mine": fail(404, "be.error.notFound"),
    });
    renderOnline();

    expect(await screen.findByText("online.takeover.newcomer")).toBeInTheDocument();
    expect(screen.getByText("online.takeover.returning")).toBeInTheDocument();
    expect(screen.getByText("online.takeover.other")).toBeInTheDocument();
    expect(screen.getByLabelText("location")).toHaveTextContent("/online/takeover");
  });

  // Given a newcomer whose fresh squad is still being made,
  // when they take over a club,
  // then the screen waits for the squad, reading the club again, before it lets them in.
  it("waits for a fresh squad before opening the club", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let clubAnswer = fail(404, "be.error.club.none");
    server = fakeServer({
      "GET v1/season": ok(SEASON),
      "GET v1/clubs/mine": () => clubAnswer,
      "GET v1/leagues/mine": ok(LEAGUE),
      "POST v1/clubs/takeover": () => {
        clubAnswer = ok(myClub({ squadRefreshing: true }));
        return ok({
          club: { id: "club-1", name: "Cầu Vồng Nghệ An" },
          kind: "fresh",
          leagueId: "league-1",
          squadRefreshing: true,
        });
      },
    });
    renderOnline("/online/takeover");

    fireEvent.click(await screen.findByRole("button", { name: "online.takeover.button" }));
    expect(
      await screen.findByText("online.takeover.result.fresh:Cầu Vồng Nghệ An"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "online.takeover.enter" })).toBeDisabled();

    clubAnswer = ok(myClub({ squadRefreshing: false }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    const enter = screen.getByRole("button", { name: "online.takeover.enter" });
    await waitFor(() => expect(enter).toBeEnabled());
    fireEvent.click(enter);
    expect(await screen.findByLabelText("location")).toHaveTextContent(/^\/online$/);
  });

  // Given a club with a match being prepared,
  // when the takeover is refused with a Retry-After,
  // then the reason shows and the button stays off until the wait is over.
  it("waits out a Retry-After", async () => {
    server = fakeServer({
      "GET v1/season": ok(SEASON),
      "GET v1/clubs/mine": fail(404, "be.error.club.none"),
      "GET v1/leagues/mine": fail(404, "be.error.notFound"),
      "POST v1/clubs/takeover": fail(409, "be.error.club.matchUnderway", {
        retryAfterSeconds: 120,
        details: { params: { kickoffAt: "2099-01-01T11:00:00Z" } },
      }),
    });
    renderOnline("/online/takeover");

    fireEvent.click(await screen.findByRole("button", { name: "online.takeover.button" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "resolved:be.error.club.matchUnderway?kickoffAt=",
    );
    expect(screen.getByRole("button", { name: "online.takeover.button" })).toBeDisabled();
    expect(screen.getByText(/^online\.takeover\.retryIn:1[12]\d$/)).toBeInTheDocument();
  });

  // Given a takeover sent while the server could not be reached,
  // when the coach presses again,
  // then the retry carries the same idempotency key, so the server takes the club once.
  it("retries an unanswered takeover with the same key", async () => {
    let attempts = 0;
    server = fakeServer({
      "GET v1/season": ok(SEASON),
      "GET v1/clubs/mine": fail(404, "be.error.club.none"),
      "GET v1/leagues/mine": fail(404, "be.error.notFound"),
      "POST v1/clubs/takeover": () => {
        attempts += 1;
        return attempts === 1
          ? fail(0, "be.error.online.unreachable")
          : ok({ club: { id: "c", name: "C" }, kind: "asIs", squadRefreshing: false });
      },
    });
    renderOnline("/online/takeover");

    fireEvent.click(await screen.findByRole("button", { name: "online.takeover.button" }));
    expect(await screen.findByText("online.offlineBanner")).toBeInTheDocument();
    // The banner disables writes; a successful read brings the server back.
    await act(async () => {
      server.routes["GET v1/season"] = ok(SEASON);
    });
    const { tracked } = await import("../store/onlineStore");
    await act(async () => {
      await tracked(() => Promise.resolve(null));
    });
    fireEvent.click(screen.getByRole("button", { name: "online.takeover.button" }));
    expect(await screen.findByText("online.takeover.result.asIs:C")).toBeInTheDocument();

    const keys = sent("POST", "v1/clubs/takeover").map((request) => request.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });
});

describe("the online mode's guards", () => {
  // Given a server on a newer contract revision,
  // when the online mode opens,
  // then only the "update needed" screen shows, with a way back to the main menu.
  it("closes the mode when the client is outdated", async () => {
    server = fakeServer({});
    const { setOnlineTransport } = await import("../../services/onlineTransport");
    server.restore();
    const restore = setOnlineTransport({
      request: <T,>() =>
        Promise.resolve({ status: 200, body: {} as T, contractRevision: CONTRACT_REVISION + 1 }),
    });
    server = { ...server, restore };
    renderOnline();

    expect(await screen.findByText("online.gate.clientOutdatedTitle")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "online.nav.mainMenu" }));
    expect(await screen.findByText("outside-online")).toBeInTheDocument();
  });

  // Given a server that cannot be reached at all,
  // when the online mode opens,
  // then it warns that it is offline and offers to try again.
  it("warns when the server cannot be reached", async () => {
    const unreachable = fail(0, "be.error.online.unreachable");
    server = fakeServer({
      "GET v1/season": unreachable,
      "GET v1/clubs/mine": unreachable,
      "GET v1/leagues/mine": unreachable,
    });
    renderOnline();

    expect(await screen.findByText("online.offlineBanner")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("resolved:be.error.online.unreachable");
    expect(screen.getByRole("button", { name: "online.retry" })).toBeInTheDocument();
  });
});

describe("changing region", () => {
  // Given a coach on their profile,
  // when they pick another region,
  // then nothing is sent until they confirm; once confirmed their club is gone and they are
  // offered a takeover in the new region.
  it("asks before changing region, then offers a takeover", async () => {
    let clubAnswer = ok(myClub());
    server = fakeServer({
      "GET v1/season": ok(SEASON),
      "GET v1/clubs/mine": () => clubAnswer,
      "GET v1/leagues/mine": ok(LEAGUE),
      "GET v1/me": ok({
        id: "a",
        email: "dung@example.test",
        firstName: "Dung",
        lastName: "Ung",
        dateOfBirth: "1990-01-01",
        nationality: "VN",
        region: "AsiaSoutheast",
        status: "active",
        capabilities: [],
      }),
      "PATCH v1/me": (request) => {
        clubAnswer = fail(404, "be.error.club.none");
        return ok({
          id: "a",
          email: "dung@example.test",
          firstName: "Dung",
          lastName: "Ung",
          dateOfBirth: "1990-01-01",
          nationality: "VN",
          region: (request.body as { region: string }).region,
          status: "active",
          capabilities: [],
        });
      },
    });
    renderOnline("/online/profile");

    fireEvent.change(await screen.findByLabelText("online.profile.changeRegion"), {
      target: { value: "Europe" },
    });
    fireEvent.click(screen.getByRole("button", { name: "online.profile.changeRegion" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("online.profile.confirmBody");
    expect(sent("PATCH", "v1/me")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "online.profile.confirm" }));
    expect(await screen.findByText("online.profile.changed")).toBeInTheDocument();
    expect(sent("PATCH", "v1/me")[0].body).toEqual({ region: "Europe" });
    fireEvent.click(await screen.findByRole("button", { name: "online.takeover.button" }));
    expect(await screen.findByLabelText("location")).toHaveTextContent("/online/takeover");
  });
});
