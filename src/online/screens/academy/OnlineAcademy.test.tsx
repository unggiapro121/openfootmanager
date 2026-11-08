import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AcademyPlayerView,
  AcademyView,
  InventoryView,
  ScoutQuoteView,
  ScoutTripView,
  YoungsterView,
} from "../../api";
import type { OnlineRequest } from "../../../services/onlineTransport";
import { PHONE_QUERY } from "../../../hooks/usePhoneLayout";
import { fakeRealtime } from "../../../test-utils/onlineMatchKit";
import {
  type Answer,
  fail,
  fakeServer,
  LEAGUE,
  myClub,
  ok,
  renderOnline,
  resetOnline,
  SEASON,
} from "../../../test-utils/onlineTestKit";
import { useOnlineStore } from "../../store/onlineStore";

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

const ACCOUNT = "account-1";
const TRIP = "0192f0c4-0000-7000-8000-0000000000d1";

function youngster(id: string, overrides: Partial<YoungsterView> = {}): YoungsterView {
  return {
    id,
    name: `Kid ${id}`,
    nationality: "VNM",
    age: 15,
    position: "Midfielder",
    heightCm: 172,
    ovrRange: [42, 52],
    starRange: [2, 4],
    revealLevel: 0,
    ...overrides,
  };
}

function pupil(id: string, overrides: Partial<AcademyPlayerView> = {}): AcademyPlayerView {
  return {
    ...youngster(id),
    joinedAt: "2099-01-01T00:00:00Z",
    daysInAcademy: 3,
    wagePerDay: 71,
    graduationDeferred: false,
    ...overrides,
  };
}

function trip(overrides: Partial<ScoutTripView> = {}): ScoutTripView {
  return {
    id: TRIP,
    region: "AsiaSoutheast",
    line: "Any",
    elite: false,
    paidWith: "cash",
    status: "pending",
    sentAt: "2099-01-01T00:00:00Z",
    readyAt: "2099-01-03T00:00:00Z",
    candidates: [],
    ...overrides,
  };
}

function academy(overrides: Partial<AcademyView> = {}): AcademyView {
  return {
    enabled: true,
    serverNow: new Date().toISOString(),
    tripsThisSeason: 0,
    maxTripsPerSeason: 10,
    eliteTripsThisSeason: 0,
    maxEliteTripsPerSeason: 2,
    academyLevel: 1,
    slots: 3,
    used: 0,
    players: [],
    graduated: [],
    weeklyWage: 500,
    graduationFee: 200_000,
    minAcademyDays: 14,
    positionWeights: [],
    lineShares: {
      Any: [
        { position: "CenterBack", perMille: 190 },
        { position: "Striker", perMille: 810 },
      ],
      Defender: [
        { position: "CenterBack", perMille: 542 },
        { position: "LeftBack", perMille: 229 },
        { position: "RightBack", perMille: 229 },
      ],
    },
    ...overrides,
  };
}

function quote(overrides: Partial<ScoutQuoteView> = {}): ScoutQuoteView {
  return {
    cost: 150_000,
    waitSeconds: 3600,
    readyAt: "2099-01-03T00:00:00Z",
    tickets: { scoutExpedition: 0, scoutExpeditionElite: 0 },
    tripsLeft: 10,
    eliteTripsLeft: 2,
    ...overrides,
  };
}

const NO_ITEMS: InventoryView = { lines: [], locked: false };

function holding(code: string, total: number, locked = false): InventoryView {
  return {
    lines: [{ itemCode: code, powerClass: "b", total, stacks: [] }],
    locked,
  };
}

let server: ReturnType<typeof fakeServer>;
let realtime: ReturnType<typeof fakeRealtime>;

function serve(more: Record<string, Answer | ((request: OnlineRequest) => Answer)> = {}) {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub()),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/me": ok({ id: ACCOUNT }),
    "GET v1/friendlies/mine": ok({}),
    "GET v1/clubs/mine/market": ok({ selling: [], holding: [], recent: [] }),
    "GET v1/me/coins": fail(404, "be.error.notFound"),
    "GET v1/me/items": ok(NO_ITEMS),
    "GET v1/clubs/mine/finance": fail(404, "be.error.notFound"),
    "GET v1/clubs/mine/academy": ok(academy()),
    "GET v1/clubs/mine/academy/scout-quote": ok(quote()),
    ...more,
  });
}

const sent = (method: string, path: string) =>
  server.requests.filter(
    (request) => request.method === method && request.segments.join("/") === path,
  );

beforeEach(() => {
  resetOnline();
  realtime = fakeRealtime();
});
afterEach(() => {
  server?.restore();
  realtime.restore();
});

describe("the academy page", () => {
  // Given a season without academy rules,
  // when the academy opens,
  // then a banner says so and no scout can be sent.
  it("says the academy is closed this season", async () => {
    serve({ "GET v1/clubs/mine/academy": ok(academy({ enabled: false, slots: 0 })) });
    renderOnline("/online/academy");

    expect(await screen.findByText("online.academy.disabled")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^online\.academy\.scout\.send/ })).toBeNull();
  });

  // Given a full academy of three youngsters on €500 a week each and a €200,000 graduation fee,
  // when the academy opens,
  // then the figures say the slots are full, the week's wages for three, and the fee.
  it("shows the academy's figures", async () => {
    serve({
      "GET v1/clubs/mine/academy": ok(
        academy({ used: 3, players: [pupil("p0"), pupil("p1"), pupil("p2")] }),
      ),
    });
    renderOnline("/online/academy");

    const figures = await screen.findByRole("list", { name: "online.academy.figures.title" });
    const text = within(figures)
      .getAllByRole("listitem")
      .map((item) => item.textContent ?? "");
    expect(text[0]).toContain("online.academy.figures.full");
    expect(text[0]).toContain("online.academy.figures.level:1");
    expect(text[1]).toContain("online.academy.figures.eliteTrips:0|2");
    expect(text[2]).toMatch(/online\.academy\.figures\.wagesNote:.*500\|3/);
    expect(text[3]).toMatch(/200,000/);
    expect(text[3]).toContain("online.academy.figures.feeNote:14");
  });

  // Given a club that sent every trip of the season (10 of 10),
  // when the academy opens,
  // then sending is off, saying the season's trips are used.
  it("sends no scout once the season's trips are used", async () => {
    serve({ "GET v1/clubs/mine/academy": ok(academy({ tripsThisSeason: 10 })) });
    renderOnline("/online/academy");

    const send = (await screen.findByRole("button", {
      name: "online.academy.scout.noTripsLeft",
    })) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
  });

  // Given a trip out ten minutes on the server's clock, the server 90 s ahead of this machine,
  // when the academy opens,
  // then the countdown reads ten minutes, not eleven and a half.
  it("counts down on the server's clock", async () => {
    const machine = Date.now();
    serve({
      "GET v1/clubs/mine/academy": ok(
        academy({
          serverNow: new Date(machine + 90_000).toISOString(),
          trip: trip({ readyAt: new Date(machine + 90_000 + 600_000).toISOString() }),
        }),
      ),
    });
    renderOnline("/online/academy");

    const left = await screen.findByText(/^online\.academy\.scout\.backIn:/);
    expect(left.textContent).toMatch(/00:(10:0\d|09:5\d)$/);
  });

  // Given a trip out and an hourglass held, then none held, then the inventory locked,
  // when the academy opens,
  // then the hourglass shows, is hidden, and is off with the lock said.
  it("offers the hourglass only while one can be used", async () => {
    const out = academy({ trip: trip() });
    serve({ "GET v1/clubs/mine/academy": ok(out), "GET v1/me/items": ok(holding("timeSkip", 2)) });
    const first = renderOnline("/online/academy");
    const hourglass = (await screen.findByRole("button", {
      name: "online.academy.scout.timeSkip:2",
    })) as HTMLButtonElement;
    expect(hourglass.disabled).toBe(false);
    first.unmount();
    server.restore();

    resetOnline();
    serve({ "GET v1/clubs/mine/academy": ok(out) });
    const second = renderOnline("/online/academy");
    await screen.findByText(/^online\.academy\.scout\.backIn:/);
    expect(screen.queryByRole("button", { name: /online\.academy\.scout\.timeSkip/ })).toBeNull();
    second.unmount();
    server.restore();

    resetOnline();
    serve({
      "GET v1/clubs/mine/academy": ok(out),
      "GET v1/me/items": ok(holding("timeSkip", 1, true)),
    });
    renderOnline("/online/academy");
    const locked = (await screen.findByRole("button", {
      name: "online.academy.scout.timeSkip:1",
    })) as HTMLButtonElement;
    expect(locked.disabled).toBe(true);
    expect(screen.getAllByText("online.academy.itemsLocked").length).toBeGreaterThan(0);
  });

  // Given no trip out and no report,
  // when the academy opens,
  // then the reports say none waits for the coach.
  it("says no report is waiting", async () => {
    serve();
    renderOnline("/online/academy");

    expect(await screen.findByText("online.academy.scout.noReport")).toBeTruthy();
  });
});

describe("sending a scout", () => {
  // Given no ticket held,
  // when the academy opens,
  // then club money is the only way to pay, and sending posts the trip with it.
  it("pays with club money when no ticket is held", async () => {
    serve({ "POST v1/clubs/mine/academy/scouts": ok(trip()) });
    renderOnline("/online/academy");

    const pays = await screen.findAllByRole("radio", { name: /^online\.academy\.send\.pay/ });
    expect(pays).toHaveLength(1);
    expect(pays[0].closest("label")?.textContent).toMatch(/^online\.academy\.send\.payCash:/);
    fireEvent.click(screen.getByRole("button", { name: "online.academy.scout.sendNormal" }));

    await waitFor(() => expect(sent("POST", "v1/clubs/mine/academy/scouts").length).toBe(1));
    expect(sent("POST", "v1/clubs/mine/academy/scouts")[0].body).toEqual({
      line: "Any",
      pay: "cash",
    });
  });

  // Given the season's shares of each line,
  // when the academy opens and the coach picks defenders,
  // then one group of lines is offered, any line first and chosen; the shares shown follow the
  // line chosen; the quote is read for it and the trip sent looks for it (C-15).
  it("looks for the line the coach picks and shows its positions", async () => {
    serve({ "POST v1/clubs/mine/academy/scouts": ok(trip({ line: "Defender" })) });
    renderOnline("/online/academy");

    const any = await screen.findByRole("radio", { name: "online.academy.line.Any" });
    expect((any as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByText("online.academy.send.region")).toBeNull();
    expect(screen.queryByText("online.academy.send.focus")).toBeNull();
    const shares = () =>
      within(screen.getByRole("list", { name: "online.academy.lineShares.title" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent);
    expect(shares()).toHaveLength(2);

    fireEvent.click(screen.getByRole("radio", { name: "common.positionGroups.Defender:Defender" }));
    await waitFor(() => expect(shares()).toHaveLength(3));
    expect(shares()[0]).toMatch(/^common\.positions\.CenterBack:.*54\.2 %$/);
    await waitFor(() =>
      expect(
        sent("GET", "v1/clubs/mine/academy/scout-quote").some(
          (request) => JSON.stringify(request.query) === JSON.stringify([["line", "Defender"]]),
        ),
      ).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "online.academy.scout.sendNormal" }));
    await waitFor(() => expect(sent("POST", "v1/clubs/mine/academy/scouts").length).toBe(1));
    expect(sent("POST", "v1/clubs/mine/academy/scouts")[0].body).toEqual({
      line: "Defender",
      pay: "cash",
    });
  });

  // Given a trip out looking for defenders,
  // when the academy opens,
  // then its line is said with how it was paid, and no region or focus.
  it("says the line a trip looks for", async () => {
    serve({ "GET v1/clubs/mine/academy": ok(academy({ trip: trip({ line: "Defender" }) })) });
    renderOnline("/online/academy");

    expect(
      await screen.findByText(
        /^online\.academy\.scout\.trip:common\.positionGroups\.Defender:Defender\|/,
      ),
    ).toBeTruthy();
  });

  // Given a plain ticket and an elite one held, with no elite trip left this season,
  // when the academy opens,
  // then the plain ticket is chosen and the elite kind cannot be.
  it("offers an elite trip only while elite trips are left", async () => {
    serve({
      "GET v1/clubs/mine/academy/scout-quote": ok(
        quote({ tickets: { scoutExpedition: 1, scoutExpeditionElite: 1 }, eliteTripsLeft: 0 }),
      ),
    });
    renderOnline("/online/academy");

    const ticket = await screen.findByRole("radio", { name: "online.academy.send.payTicket:1" });
    expect((ticket as HTMLInputElement).checked).toBe(true);
    const elite = screen.getByRole("radio", { name: /^online\.academy\.scout\.elite/ });
    expect((elite as HTMLInputElement).disabled).toBe(true);
  });

  // Given an elite ticket held and elite trips left,
  // when the elite kind is chosen and the scout sent,
  // then the trip is paid with the elite ticket.
  it("sends an elite trip with the elite ticket", async () => {
    serve({
      "GET v1/clubs/mine/academy/scout-quote": ok(
        quote({ tickets: { scoutExpedition: 0, scoutExpeditionElite: 1 } }),
      ),
      "POST v1/clubs/mine/academy/scouts": ok(trip({ elite: true })),
    });
    renderOnline("/online/academy");

    const elite = await screen.findByRole("radio", { name: /^online\.academy\.scout\.elite/ });
    await waitFor(() => expect((elite as HTMLInputElement).disabled).toBe(false));
    fireEvent.click(elite);
    fireEvent.click(screen.getByRole("button", { name: "online.academy.scout.sendElite" }));

    await waitFor(() => expect(sent("POST", "v1/clubs/mine/academy/scouts").length).toBe(1));
    expect(sent("POST", "v1/clubs/mine/academy/scouts")[0].body).toMatchObject({
      pay: "scoutExpeditionElite",
    });
  });

  // Given a quote refused because a trip is already open,
  // when the academy opens,
  // then sending is off and the reason names no trip id.
  it("says why a trip would be refused, without its id", async () => {
    serve({
      "GET v1/clubs/mine/academy/scout-quote": ok(
        quote({ refusal: { code: "be.error.academy.tripOpen", params: { tripId: TRIP } } }),
      ),
    });
    renderOnline("/online/academy");

    const reason = await screen.findByText(/^be\.error\.academy\.tripOpen/);
    expect(reason.textContent).not.toContain(TRIP);
    const send = screen.getByRole("button", {
      name: "online.academy.scout.sendNormal",
    }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
  });

  // Given a full academy (3 of 3),
  // when the academy opens,
  // then the scout panel warns that a youngster must leave before another comes in.
  it("warns that a full academy takes no one in", async () => {
    serve({
      "GET v1/clubs/mine/academy": ok(
        academy({ used: 3, players: [pupil("p0"), pupil("p1"), pupil("p2")] }),
      ),
    });
    renderOnline("/online/academy");

    expect(await screen.findByText("online.academy.scout.full:3|3")).toBeTruthy();
  });
});

describe("a report back", () => {
  const report = academy({
    slots: 3,
    used: 2,
    trip: trip({
      status: "ready",
      closesAt: "2099-01-06T00:00:00Z",
      candidates: ["a", "b", "c", "d", "e"].map((id) => youngster(id)),
    }),
  });

  async function openReport() {
    fireEvent.click(await screen.findByRole("button", { name: "online.academy.report.open" }));
    return screen.findByRole("dialog");
  }

  // Given five candidates and one free slot (3 slots, 2 used),
  // when one is chosen,
  // then the others cannot be, and taking him sends only his id.
  it("chooses no more than the free slots", async () => {
    serve({
      "GET v1/clubs/mine/academy": ok(report),
      [`POST v1/clubs/mine/academy/scouts/${TRIP}/recruit`]: ok(academy({ used: 3 })),
    });
    renderOnline("/online/academy");
    const dialog = await openReport();

    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: "online.academy.candidate.choose:Kid a" }),
    );
    const other = within(dialog).getByRole("checkbox", {
      name: "online.academy.candidate.choose:Kid b",
    }) as HTMLInputElement;
    expect(other.disabled).toBe(true);

    fireEvent.click(
      within(dialog).getByRole("button", { name: "online.academy.report.recruit:1" }),
    );
    fireEvent.click(await within(dialog).findByRole("button", { name: "online.academy.confirm" }));
    await waitFor(() =>
      expect(sent("POST", `v1/clubs/mine/academy/scouts/${TRIP}/recruit`).length).toBe(1),
    );
    expect(sent("POST", `v1/clubs/mine/academy/scouts/${TRIP}/recruit`)[0].body).toEqual({
      candidateIds: ["a"],
    });
  });

  // Given a report back,
  // when it is skipped and the skip confirmed,
  // then it is closed with no candidate.
  it("closes a report with none chosen", async () => {
    serve({
      "GET v1/clubs/mine/academy": ok(report),
      [`POST v1/clubs/mine/academy/scouts/${TRIP}/recruit`]: ok(academy({ used: 2 })),
    });
    renderOnline("/online/academy");
    const dialog = await openReport();

    fireEvent.click(within(dialog).getByRole("button", { name: "online.academy.report.skip" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "online.academy.confirm" }));
    await waitFor(() =>
      expect(sent("POST", `v1/clubs/mine/academy/scouts/${TRIP}/recruit`).length).toBe(1),
    );
    expect(sent("POST", `v1/clubs/mine/academy/scouts/${TRIP}/recruit`)[0].body).toEqual({
      candidateIds: [],
    });
  });

  // Given a report back, on a phone,
  // when the report's sheet opens, then the skip is confirmed,
  // then its secondary buttons stay, under the main one (they do a job, D-S8), and the skip
  // still closes the report with none chosen.
  it("keeps the skip and the step back on a phone", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === PHONE_QUERY,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    serve({
      "GET v1/clubs/mine/academy": ok(report),
      [`POST v1/clubs/mine/academy/scouts/${TRIP}/recruit`]: ok(academy({ used: 2 })),
    });
    renderOnline("/online/academy");
    const dialog = await openReport();

    const foot = within(dialog).getByRole("contentinfo");
    const names = within(foot)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(names).toEqual(["online.academy.report.recruit:0", "online.academy.report.skip"]);
    fireEvent.click(within(foot).getByRole("button", { name: "online.academy.report.skip" }));
    expect(within(foot).getByRole("button", { name: "common.cancel" })).toBeTruthy();
    fireEvent.click(await within(foot).findByRole("button", { name: "online.academy.confirm" }));
    await waitFor(() =>
      expect(sent("POST", `v1/clubs/mine/academy/scouts/${TRIP}/recruit`)[0].body).toEqual({
        candidateIds: [],
      }),
    );
    vi.unstubAllGlobals();
  });

  // Given two devices choosing at once, the server answering that no slot is free,
  // when the choice is sent,
  // then the reason is shown and the academy is read again.
  it("reads the academy again when the slots were taken meanwhile", async () => {
    serve({
      "GET v1/clubs/mine/academy": ok(report),
      [`POST v1/clubs/mine/academy/scouts/${TRIP}/recruit`]: fail(409, "be.error.academy.noSlot", {
        params: { free: 0 },
      }),
    });
    renderOnline("/online/academy");
    const dialog = await openReport();
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: "online.academy.candidate.choose:Kid a" }),
    );
    const reads = sent("GET", "v1/clubs/mine/academy").length;
    fireEvent.click(
      within(dialog).getByRole("button", { name: "online.academy.report.recruit:1" }),
    );
    fireEvent.click(await within(dialog).findByRole("button", { name: "online.academy.confirm" }));

    expect(await screen.findByText(/^be\.error\.academy\.noSlot/)).toBeTruthy();
    await waitFor(() => expect(sent("GET", "v1/clubs/mine/academy").length).toBe(reads + 1));
  });
});

describe("the academy's youngsters", () => {
  // Given three youngsters known at each level, one with no expected graduation and one whose
  // graduation waited for its fee,
  // when the academy opens,
  // then each card says the level in words, the unknown graduation as a dash, the waited one as
  // free.
  it("says what is known of each youngster", async () => {
    serve({
      "GET v1/clubs/mine/academy": ok(
        academy({
          used: 3,
          players: [
            pupil("p0", { revealLevel: 0, graduatesAtSeason: 4 }),
            pupil("p1", { revealLevel: 1 }),
            pupil("p2", { revealLevel: 2, graduationDeferred: true, graduatesAtSeason: 5 }),
          ],
        }),
      ),
    });
    renderOnline("/online/academy");

    const cards = await screen.findAllByRole("article");
    const text = cards.map((card) => card.textContent ?? "");
    expect(text[0]).toContain("online.academy.reveal.0");
    expect(text[0]).toContain("online.academy.players.graduates:4");
    expect(text[0]).toContain("online.academy.players.daysOf:3|14");
    expect(text[1]).toContain("online.academy.reveal.1");
    expect(text[1]).toContain("online.academy.players.graduatesUnknown");
    expect(text[2]).toContain("online.academy.reveal.2");
    expect(text[2]).toContain("online.academy.players.nextFree");
  });

  // Given one youngster in an academy of three slots,
  // when the academy opens,
  // then two free slots show and a card points to the upgrade in Finance.
  it("shows the free slots and where more come from", async () => {
    serve({ "GET v1/clubs/mine/academy": ok(academy({ used: 1, players: [pupil("p0")] })) });
    renderOnline("/online/academy");

    expect(await screen.findAllByText("online.academy.players.freeSlot")).toHaveLength(2);
    expect(screen.getByText("online.academy.players.moreSlots")).toBeTruthy();
  });

  // Given a youngster the server finds on a fair focus, and one it gives no fit,
  // when the academy opens,
  // then the first shows the best focus beside his own, and the second no hint.
  it("shows how a youngster's focus suits him", async () => {
    serve({
      "GET v1/clubs/mine/academy": ok(
        academy({
          used: 2,
          players: [
            pupil("p0", {
              focusFit: { current: "Technical", best: "Tactical", verdict: "fair" },
            }),
            pupil("p1"),
          ],
        }),
      ),
    });
    renderOnline("/online/academy");

    expect(
      await screen.findByText("online.training.focusHint.fair:training.focuses.Tactical.label"),
    ).toBeTruthy();
    expect(screen.getAllByText(/^online\.training\.focusHint\./)).toHaveLength(1);
  });

  // T-C5 (C-13b C13b-5): a club on "Auto".
  // Given a club on Auto and a youngster with no focus of his own, whom the server shows no fit,
  // when the academy opens,
  // then his focus reads the club's on Auto, and nothing says what Auto picks for him.
  it("names the club's Auto and never what it picks for a youngster", async () => {
    const club = myClub();
    serve({
      "GET v1/clubs/mine": ok({
        ...club,
        trainingPlan: { ...club.trainingPlan, autoFocus: true },
        autoFocusOpen: true,
      }),
      "GET v1/clubs/mine/academy": ok(academy({ used: 1, players: [pupil("p0")] })),
    });
    renderOnline("/online/academy");

    const field = await screen.findByRole("combobox", { name: "online.academy.players.focus" });
    await waitFor(() =>
      expect(within(field).getAllByRole("option")[0]).toHaveTextContent(
        "online.academy.players.clubFocusAuto",
      ),
    );
    expect((field as HTMLSelectElement).value).toBe("");
    expect(screen.queryByText(/online\.training\.focus\.autoPick/)).toBeNull();
    expect(screen.queryByText(/^online\.training\.focusHint\./)).toBeNull();
  });

  // Given a youngster with his own focus,
  // when his focus is set back to the club's,
  // then the request carries no focus.
  it("sets a youngster back to the club's focus", async () => {
    serve({
      "GET v1/clubs/mine/academy": ok(
        academy({ used: 1, players: [pupil("p0", { focus: "Technical" })] }),
      ),
      "PUT v1/clubs/mine/academy/players/p0/focus": ok(pupil("p0")),
    });
    renderOnline("/online/academy");

    fireEvent.change(
      await screen.findByRole("combobox", { name: "online.academy.players.focus" }),
      { target: { value: "" } },
    );
    await waitFor(() =>
      expect(sent("PUT", "v1/clubs/mine/academy/players/p0/focus").length).toBe(1),
    );
    expect(sent("PUT", "v1/clubs/mine/academy/players/p0/focus")[0].body).toEqual({});
  });

  // Given a youngster with his own focus, on a phone,
  // when his focus field is tapped and the club's focus chosen,
  // then a sheet of the focuses opens instead of the phone's own list, and no focus is sent.
  it("sets a youngster's focus from a sheet on a phone", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === PHONE_QUERY,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    serve({
      "GET v1/clubs/mine/academy": ok(
        academy({ used: 1, players: [pupil("p0", { focus: "Technical" })] }),
      ),
      "PUT v1/clubs/mine/academy/players/p0/focus": ok(pupil("p0")),
    });
    renderOnline("/online/academy");

    const field = await screen.findByRole("button", { name: /online\.academy\.players\.focus/ });
    expect(screen.queryByRole("combobox", { name: "online.academy.players.focus" })).toBeNull();
    expect(field).toHaveTextContent("training.focuses.Technical.label");
    fireEvent.click(field);
    fireEvent.click(
      within(screen.getByRole("listbox", { name: "online.academy.players.focus" })).getByRole(
        "option",
        { name: /online\.academy\.players\.clubFocus/ },
      ),
    );
    await waitFor(() =>
      expect(sent("PUT", "v1/clubs/mine/academy/players/p0/focus").length).toBe(1),
    );
    expect(sent("PUT", "v1/clubs/mine/academy/players/p0/focus")[0].body).toEqual({});
    vi.unstubAllGlobals();
  });

  // Given a youngster,
  // when he is let go,
  // then it is asked once more before the release is sent.
  it("asks before letting a youngster go", async () => {
    serve({
      "GET v1/clubs/mine/academy": ok(academy({ used: 1, players: [pupil("p0")] })),
      "POST v1/clubs/mine/academy/players/p0/release": ok(academy()),
    });
    renderOnline("/online/academy");

    fireEvent.click(await screen.findByRole("button", { name: "online.academy.players.release" }));
    expect(sent("POST", "v1/clubs/mine/academy/players/p0/release")).toEqual([]);
    fireEvent.click(await screen.findByRole("button", { name: "online.academy.confirm" }));
    await waitFor(() =>
      expect(sent("POST", "v1/clubs/mine/academy/players/p0/release").length).toBe(1),
    );
  });
});

describe("the academy's ring", () => {
  // Given a coach on another page,
  // when a scouting trip comes back,
  // then the academy is read again, the sidebar's academy entry lights, and a notice links to it.
  it("lights the academy and tells of a report back", async () => {
    serve();
    renderOnline("/online/coins");
    await waitFor(() =>
      expect(realtime.watches.some((watch) => watch.channel === `account:${ACCOUNT}`)).toBe(true),
    );
    const watch = realtime.watches.find((one) => one.channel === `account:${ACCOUNT}`);

    act(() =>
      watch?.speak({
        kind: "notice",
        channel: `account:${ACCOUNT}`,
        data: { kind: "academy", event: "scoutDone", tripId: TRIP },
      }),
    );
    await waitFor(() => expect(sent("GET", "v1/clubs/mine/academy").length).toBe(1));
    expect(useOnlineStore.getState().academyUnseen).toBe(true);
    const region = screen.getByRole("region", { name: "online.market.notice.region" });
    const notice = await within(region).findByRole("link");
    expect(notice.textContent).toContain("online.academy.notice.scoutDone");
    expect(notice.getAttribute("href")).toBe("/online/academy");
  });
});
