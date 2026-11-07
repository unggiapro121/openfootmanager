import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHONE_QUERY } from "../../hooks/usePhoneLayout";
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

vi.mock("./shrinkImage", () => ({
  AVATAR_SIDE: 256,
  shrinkToAvatar: async () => "data:image/jpeg;base64,/9j/AAAA",
}));

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
  // then the sidebar shows the club, the header the season's day, the overview the next opponent and the league place.
  it("shows the club, the season, the next match and the league place", async () => {
    server = fakeServer({
      "GET v1/season": ok(SEASON),
      "GET v1/clubs/mine": ok(myClub()),
      "GET v1/leagues/mine": ok(LEAGUE),
    });
    renderOnline();

    const sidebar = await screen.findByRole("complementary");
    expect(await within(sidebar).findByText("Cầu Vồng Nghệ An")).toBeInTheDocument();
    expect(
      within(screen.getByRole("banner")).getByText("online.header.seasonDay:3|5|28"),
    ).toBeInTheDocument();
    const next = screen.getByRole("region", { name: /^online\.fixture\.title/ });
    expect(within(next).getByText("Sóng Biển Đà Nẵng")).toBeInTheDocument();
    const table = screen.getByRole("region", { name: "online.overview.tableTitle" });
    expect(within(table).getByText("online.overview.points:6")).toBeInTheDocument();
    fireEvent.click(within(table).getByRole("link", { name: "online.overview.seeTable" }));
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

  // Given a season that rests clubs by blocks, a coach on his squad page, the next mark 2 s away,
  // when the mark passes,
  // then the club is read again there too, for the players' new condition (C-8 C8-8).
  it("reads the club again at a recovery mark on any page", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const club = myClub({
      trainingDay: {
        day: 3,
        recent: [],
        canTrain: true,
        sessionsLast7: 0,
        sessionsCap: 6,
        nextRecoveryAt: new Date(Date.now() + 2_000).toISOString(),
        recovery: { perDay: 6, hours: 8 },
        autoOff: false,
        keeperDrill: false,
      },
    });
    server = fakeServer({
      "GET v1/season": ok(SEASON),
      "GET v1/clubs/mine": ok(club),
      "GET v1/leagues/mine": ok(LEAGUE),
    });
    renderOnline("/online/squad");
    await waitFor(() => expect(sent("GET", "v1/clubs/mine")).toHaveLength(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    await waitFor(() => expect(sent("GET", "v1/clubs/mine")).toHaveLength(2));
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

    expect(
      await within(screen.getByRole("complementary")).findByText("Sao Mai"),
    ).toBeInTheDocument();
    const [rename] = sent("PATCH", "v1/clubs/mine");
    expect(rename.body).toEqual({ name: "Sao Mai" });
    expect(rename.idempotencyKey).toEqual(expect.any(String));
  });

  // Given the rename form,
  // when only the stadium's name is changed and saved,
  // then only the stadium is sent, to its own route, and the club shows the new stadium.
  it("renames the stadium alone", async () => {
    server = fakeServer({
      "GET v1/season": ok(SEASON),
      "GET v1/clubs/mine": ok(myClub()),
      "GET v1/leagues/mine": ok(LEAGUE),
      "PATCH v1/clubs/mine/stadium": (request) =>
        ok(
          myClub({
            club: {
              ...myClub().club,
              stadiumName: (request.body as { name: string }).name,
            },
          }),
        ),
    });
    renderOnline();

    fireEvent.click(await screen.findByRole("button", { name: "online.club.rename" }));
    fireEvent.change(screen.getByLabelText("online.club.stadiumLabel"), {
      target: { value: "  Sân Mới  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /online.club.save/ }));

    expect(
      await screen.findByText("online.overview.stadiumLine:Sân Mới|18000"),
    ).toBeInTheDocument();
    expect(sent("PATCH", "v1/clubs/mine")).toHaveLength(0);
    const [rename] = sent("PATCH", "v1/clubs/mine/stadium");
    expect(rename.body).toEqual({ name: "Sân Mới" });
  });

  // Given the rename form untouched,
  // when it is looked at,
  // then there is nothing to save yet.
  it("has nothing to save until something changes", async () => {
    server = fakeServer({
      "GET v1/season": ok(SEASON),
      "GET v1/clubs/mine": ok(myClub()),
      "GET v1/leagues/mine": ok(LEAGUE),
    });
    renderOnline();

    fireEvent.click(await screen.findByRole("button", { name: "online.club.rename" }));

    expect(screen.getByRole("button", { name: "online.club.save" })).toBeDisabled();
  });

  // Given a name another club already has,
  // when it is saved,
  // then the server's refusal shows under the field and the form stays open.
  it("shows why a name was refused", async () => {
    server = fakeServer({
      "GET v1/season": ok(SEASON),
      "GET v1/clubs/mine": ok(myClub()),
      "GET v1/leagues/mine": ok(LEAGUE),
      "GET v1/clubs/mine/fixtures": ok({ fixtures: [] }),
      "PATCH v1/clubs/mine": fail(409, "be.error.club.nameTaken"),
    });
    renderOnline();

    fireEvent.click(await screen.findByRole("button", { name: "online.club.rename" }));
    fireEvent.change(screen.getByLabelText("online.club.renameLabel"), {
      target: { value: "Sao Mai" },
    });
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
  // when they open the region chip, pick another region and save,
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

    fireEvent.click(
      await screen.findByRole("button", {
        name: "online.profile.regionChip:coach.regions.AsiaSoutheast",
      }),
    );
    const save = screen.getByRole("button", { name: "online.profile.saveRegion" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("online.profile.changeRegion"), {
      target: { value: "Europe" },
    });
    fireEvent.click(save);
    expect(screen.getByRole("alertdialog")).toHaveTextContent("online.profile.confirmBody");
    expect(sent("PATCH", "v1/me")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "online.profile.confirm" }));
    expect(await screen.findByText("online.profile.changed")).toBeInTheDocument();
    expect(sent("PATCH", "v1/me")[0].body).toEqual({ region: "Europe" });
    fireEvent.click(await screen.findByRole("button", { name: "online.takeover.button" }));
    expect(await screen.findByLabelText("location")).toHaveTextContent("/online/takeover");
  });

  // Given a coach on their profile, on a phone,
  // when they open the region chip and tap the region field,
  // then a sheet of the regions opens instead of the phone's own list, and the pick waits for save.
  it("picks the region from a sheet on a phone", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === PHONE_QUERY,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    server = fakeServer({
      "GET v1/season": ok(SEASON),
      "GET v1/clubs/mine": ok(myClub()),
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
    });
    renderOnline("/online/profile");

    fireEvent.click(
      await screen.findByRole("button", {
        name: "online.profile.regionChip:coach.regions.AsiaSoutheast",
      }),
    );
    expect(screen.queryByRole("combobox", { name: "online.profile.changeRegion" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /online\.profile\.changeRegion/ }));
    fireEvent.click(
      within(screen.getByRole("listbox", { name: "online.profile.changeRegion" })).getByRole(
        "option",
        { name: /coach\.regions\.Europe/ },
      ),
    );
    expect(screen.getByRole("button", { name: /online\.profile\.changeRegion/ })).toHaveTextContent(
      "coach.regions.Europe",
    );
    fireEvent.click(screen.getByRole("button", { name: "online.profile.saveRegion" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("online.profile.confirmBody");
    expect(sent("PATCH", "v1/me")).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  // Given a coach with no chosen photo,
  // when he opens the photo picker, picks a face and saves,
  // then the seed goes to his account, and the picker closes with the account answering.
  it("lets the coach pick his photo", async () => {
    const account = {
      id: "a",
      email: "dung@example.test",
      firstName: "Dung",
      lastName: "Ung",
      dateOfBirth: "1990-01-01",
      nationality: "VN",
      region: "AsiaSoutheast",
      status: "active",
      capabilities: [],
    };
    server = fakeServer({
      "GET v1/season": ok(SEASON),
      "GET v1/clubs/mine": ok(myClub()),
      "GET v1/leagues/mine": ok(LEAGUE),
      "GET v1/me": ok(account),
      "PATCH v1/me": (request) =>
        ok({ ...account, avatarSeed: (request.body as { avatarSeed: string }).avatarSeed }),
    });
    renderOnline("/online/profile");

    fireEvent.click(await screen.findByRole("button", { name: "online.profile.avatarChange" }));
    expect(screen.getByRole("button", { name: "online.profile.avatarSave" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "online.profile.avatarOption:7" }));
    fireEvent.click(screen.getByRole("button", { name: "online.profile.avatarSave" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(sent("PATCH", "v1/me")[0].body).toEqual({ avatarSeed: "7" });
  });

  // Given a coach who picks a file from his computer,
  // when the picture is shrunk and sent,
  // then it goes to his account as a data URL, and his card shows that picture.
  it("lets the coach send a picture of his own", async () => {
    const account = {
      id: "a",
      email: "dung@example.test",
      firstName: "Dung",
      lastName: "Ung",
      dateOfBirth: "1990-01-01",
      nationality: "VN",
      region: "AsiaSoutheast",
      status: "active",
      capabilities: [],
      hasAvatarImage: false,
    };
    const dataUrl = "data:image/jpeg;base64,/9j/AAAA";
    server = fakeServer({
      "GET v1/season": ok(SEASON),
      "GET v1/clubs/mine": ok(myClub()),
      "GET v1/leagues/mine": ok(LEAGUE),
      "GET v1/me": ok(account),
      "GET v1/me/avatar-image": ok({ dataUrl }),
      "PUT v1/me/avatar-image": ok({ ...account, hasAvatarImage: true }),
    });
    renderOnline("/online/profile");

    fireEvent.click(await screen.findByRole("button", { name: "online.profile.avatarChange" }));
    const picture = new File([new Uint8Array([1, 2, 3])], "me.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("online.profile.avatarUpload", { selector: "input" }), {
      target: { files: [picture] },
    });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(sent("PUT", "v1/me/avatar-image")[0].body).toEqual({ dataUrl });
    expect(await screen.findByRole("img", { name: "Dung Ung" })).toHaveAttribute("src", dataUrl);
  });
});
