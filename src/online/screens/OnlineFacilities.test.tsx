import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FacilitiesView, FacilityItemView, FinanceView } from "../api";
import type { OnlineRequest } from "../../services/onlineTransport";
import { fakeRealtime } from "../../test-utils/onlineMatchKit";
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
  resolveBackendError: (error: unknown) =>
    `resolved:${(error as { code?: string }).code ?? String(error)}`,
}));

const CLUB = "club-1";

function finance(overrides: Partial<FinanceView> = {}): FinanceView {
  return {
    economy: true,
    cash: 9_450_000,
    held: 0,
    locked: false,
    season: [],
    weeklyWageBill: 0,
    arrearsDaysToForcedListing: 3,
    ...overrides,
  };
}

function item(
  facility: string,
  level: number,
  overrides: Partial<FacilityItemView> = {},
): FacilityItemView {
  return {
    facility,
    level,
    maxLevel: facility === "stands" ? 16 : 10,
    cost: 2_000_000,
    buildDays: 3,
    upkeepDelta: 0,
    effects: [],
    lock: null,
    canDowngrade: level > 1,
    downgradeEffects: [],
    downgradeUpkeepSaving: 0,
    ...overrides,
  };
}

/** The brief's sample club (c-27 §12): 9,450,000 in cash, coach level 5. */
function view(overrides: Partial<FacilitiesView> = {}): FacilitiesView {
  return {
    facilities: [],
    items: [
      item("stands", 3, { upkeepDelta: 120_000 }),
      item("shop", 2, { seasonEarnings: 310_000 }),
      item("food", 1),
      item("park", 0, { cost: 1_500_000 }),
      item("training", 6, { cost: 15_000_000 }),
      item("medical", 7, { lock: { coachLevel: 6 } }),
      item("academy", 5),
    ],
    capacity: 9_000,
    nextCapacity: 11_000,
    stadiumName: "Sân Vinh",
    upkeepPerSeason: 1_200_000,
    build: null,
    lastCompleted: null,
    timeSkipHeld: 2,
    economyDisabled: false,
    serverNow: new Date().toISOString(),
    daySeconds: 3_600,
    coachLevel: 5,
    honoursCount: 3,
    lineupLocked: false,
    ...overrides,
  };
}

const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();
const anHourAgo = () => new Date(Date.now() - 3_600_000).toISOString();
const building = (overrides: Partial<NonNullable<FacilitiesView["build"]>> = {}) => ({
  facility: "stands",
  toLevel: 4,
  startedAt: anHourAgo(),
  endsAt: inAnHour(),
  refundOnCancel: 1_000_000,
  skipsToFinish: 3,
  skipDays: 1,
  ...overrides,
});

let server: ReturnType<typeof fakeServer>;
let realtime: ReturnType<typeof fakeRealtime>;

function serve(more: Record<string, Answer | ((request: OnlineRequest) => Answer)> = {}) {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub()),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/me": ok({ id: "account-1" }),
    "GET v1/friendlies/mine": ok({}),
    "GET v1/clubs/mine/finance": ok(finance()),
    "GET v1/clubs/mine/facilities": ok(view()),
    ...more,
  });
}

const sent = (method: string, path: string) =>
  server.requests.filter(
    (request) => request.method === method && request.segments.join("/") === path,
  );

const card = (name: string) =>
  screen.getByRole("article", { name: `online.facilities.name.${name}` });

beforeEach(() => {
  resetOnline();
  window.localStorage.clear();
  realtime = fakeRealtime();
});
afterEach(() => {
  server?.restore();
  realtime.restore();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("OnlineFacilities: the screen (c-27 §5.7)", () => {
  // Given the facilities not read yet,
  // when the screen opens,
  // then it shows the waiting frame, busy, and then the stadium and the four sections.
  it("waits busy, then shows the stadium and its sections", async () => {
    serve();
    renderOnline("/online/facilities");
    expect(await screen.findByLabelText("online.facilities.loading")).toHaveAttribute(
      "aria-busy",
      "true",
    );

    expect(await screen.findByRole("heading", { name: "Sân Vinh" })).toBeTruthy();
    for (const section of ["stadium", "commerce", "sports", "trophies"]) {
      expect(
        screen.getByRole("heading", { name: `online.facilities.section.${section}` }),
      ).toBeTruthy();
    }
    expect(screen.getByText("online.facilities.section.coachLevel:5")).toBeTruthy();
    expect(screen.getByText("online.facilities.section.trophiesCount:3")).toBeTruthy();
    expect(screen.getByText(/online\.facilities\.hero\.upkeep:.*1\.2M/)).toBeTruthy();
    expect(screen.getByText("online.facilities.crew.free")).toBeTruthy();
    expect(screen.getAllByRole("article")).toHaveLength(7);
  });

  // Given the facilities' read failing,
  // when the screen opens and the coach retries once it answers,
  // then it says it could not load and then shows the screen.
  it("says a failed read and retries it", async () => {
    let answer: Answer = fail(0, "be.error.online.network");
    serve({ "GET v1/clubs/mine/facilities": () => answer });
    renderOnline("/online/facilities");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("online.facilities.loadFailed");
    answer = ok(view());
    fireEvent.click(within(alert).getByRole("button", { name: "online.retry" }));
    expect(await screen.findByRole("heading", { name: "Sân Vinh" })).toBeTruthy();
  });

  // Given a season whose facilities upgrade at once (no stands in the view),
  // when the screen's address is typed,
  // then it goes to Finance, where they are upgraded.
  it("goes to Finance in a season that does not build over time", async () => {
    serve({ "GET v1/clubs/mine/facilities": ok({ facilities: [] }) });
    renderOnline("/online/facilities");
    await waitFor(() =>
      expect(screen.getByLabelText("location").textContent).toBe("/online/finance"),
    );
  });

  // Given the season's economy paused, then the club's finances locked,
  // when the screen opens,
  // then a banner says which, and every write is off with that reason (T4).
  it.each([
    [
      "economy",
      { "GET v1/clubs/mine/facilities": ok(view({ economyDisabled: true })) },
      "economyOff",
    ],
    ["locked", { "GET v1/clubs/mine/finance": ok(finance({ locked: true })) }, "clubLocked"],
  ] as const)("turns every write off when %s", async (_case, more, reason) => {
    serve(more);
    renderOnline("/online/facilities");

    expect(await screen.findByText(`online.facilities.banner.${reason}`)).toHaveAttribute(
      "role",
      "status",
    );
    const shop = card("shop");
    expect(
      within(shop).getByRole("button", { name: `online.facilities.card.${reason}` }),
    ).toBeDisabled();
    fireEvent.click(within(shop).getByRole("button", { name: /online\.facilities\.menu\.label/ }));
    expect(
      within(shop).getByRole("menuitem", { name: /online\.facilities\.menu\.downgrade/ }),
    ).toBeDisabled();
    expect(
      screen.queryAllByRole("button", { name: /online\.facilities\.card\.(upgradeFor|build):/ }),
    ).toHaveLength(0);
  });
});

describe("OnlineFacilities: the cards (c-27 §5.4)", () => {
  // Given the brief's sample club with the stands building,
  // when the screen opens,
  // then the stands show the build, the medical centre still its coach lock (S4), and the other
  // cards the builders busy (S5).
  it("shows the build, the coach lock and the busy builders", async () => {
    serve({ "GET v1/clubs/mine/facilities": ok(view({ build: building() })) });
    renderOnline("/online/facilities");

    const stands = await screen.findByRole("article", { name: "online.facilities.name.stands" });
    expect(within(stands).getByRole("progressbar")).toBeTruthy();
    expect(
      within(card("medical")).getByRole("button", { name: "online.facilities.card.needsCoach:6" }),
    ).toBeDisabled();
    expect(
      within(card("medical")).getByText("online.facilities.card.coachReason:8|6|5"),
    ).toBeTruthy();
    const shop = card("shop");
    expect(
      within(shop).getByRole("button", { name: "online.facilities.card.upgradeTo:3" }),
    ).toBeDisabled();
    expect(
      within(shop).getByText("online.facilities.card.busyReason:online.facilities.name.stands|4"),
    ).toBeTruthy();
    expect(
      screen.getByText("online.facilities.crew.busy:online.facilities.name.stands|4"),
    ).toBeTruthy();
  });

  // Given the builders free, a car park not built, a training ground dearer than the cash,
  // when the screen opens,
  // then the car park offers to build (S2) and the training ground says how much is short (S3).
  it("offers to build and says what is short", async () => {
    serve();
    renderOnline("/online/facilities");

    const park = await screen.findByRole("article", { name: "online.facilities.name.park" });
    expect(within(park).getByText("online.facilities.card.unbuilt")).toBeTruthy();
    expect(
      within(park).getByRole("button", { name: /online\.facilities\.card\.build:.*1\.5M/ }),
    ).toBeEnabled();
    expect(
      within(card("training")).getByText(/online\.facilities\.card\.short:.*5\.6M/),
    ).toBeTruthy();
    expect(within(card("shop")).getByText(/online\.facilities\.card\.seasonEarnings/)).toBeTruthy();
  });

  // Given a match's lineup lock on the club,
  // when the coach opens a card's menu,
  // then "Downgrade" is off with "Downgrade after the match" (R27-2).
  it("turns the downgrade off during a lineup lock", async () => {
    serve({ "GET v1/clubs/mine/facilities": ok(view({ lineupLocked: true })) });
    renderOnline("/online/facilities");

    const shop = await screen.findByRole("article", { name: "online.facilities.name.shop" });
    fireEvent.click(within(shop).getByRole("button", { name: /online\.facilities\.menu\.label/ }));
    const downgrade = within(shop).getByRole("menuitem", {
      name: /online\.facilities\.menu\.downgrade/,
    });
    expect(downgrade).toBeDisabled();
    expect(downgrade.textContent).toContain("online.facilities.downgradeOff.lineupLocked");
  });

  // Given a build past its end held by a match's lineup lock,
  // when the screen opens,
  // then it says the build finishes after the match, and reads the view again a minute later,
  // not every ten seconds (R27-1).
  it("says a build held by the match finishes after it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serve({
      "GET v1/clubs/mine/facilities": ok(
        view({
          lineupLocked: true,
          build: building({ endsAt: anHourAgo(), startedAt: anHourAgo() }),
        }),
      ),
    });
    renderOnline("/online/facilities");

    expect(
      (await screen.findAllByText("online.facilities.crew.afterMatch")).length,
    ).toBeGreaterThan(0);
    const reads = () => sent("GET", "v1/clubs/mine/facilities").length;
    const before = reads();
    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    expect(reads()).toBe(before);
    await act(async () => {
      vi.advanceTimersByTime(45_000);
    });
    expect(reads()).toBeGreaterThan(before);
  });
});

describe("OnlineFacilities: the dialogs (c-27 §5.5)", () => {
  // Given the shop ready to go up,
  // when the coach builds and the first send gets no answer,
  // then the dialog says the connection was lost, the second send carries the same key, and the
  // answer closes it with a toast.
  it("builds, retrying a lost send with the same key", async () => {
    let answer: Answer = fail(0, "be.error.online.network");
    serve({ "POST v1/clubs/mine/facilities/shop/build": () => answer });
    renderOnline("/online/facilities");

    const shop = await screen.findByRole("article", { name: "online.facilities.name.shop" });
    fireEvent.click(
      within(shop).getByRole("button", { name: /online\.facilities\.card\.upgradeFor/ }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText("online.facilities.dialog.upkeep")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "online.facilities.dialog.start" }));
    expect(await within(dialog).findByText("online.facilities.error.network")).toBeTruthy();

    answer = ok(view({ build: building({ facility: "shop", toLevel: 3 }) }));
    fireEvent.click(within(dialog).getByRole("button", { name: "online.facilities.dialog.start" }));
    expect(
      await screen.findByText("online.facilities.toast.started:online.facilities.name.shop|3"),
    ).toBeTruthy();
    const keys = sent("POST", "v1/clubs/mine/facilities/shop/build").map(
      (request) => request.idempotencyKey,
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  // Given the stands, whose next level adds upkeep,
  // when the coach opens its dialog,
  // then it shows the upkeep row (T2), the seats before and after, and the real time.
  it("shows the stands' upkeep, seats and real build time", async () => {
    serve();
    renderOnline("/online/facilities");

    const stands = await screen.findByRole("article", { name: "online.facilities.name.stands" });
    fireEvent.click(
      within(stands).getByRole("button", { name: /online\.facilities\.card\.upgradeFor/ }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("online.facilities.dialog.upkeep")).toBeTruthy();
    expect(
      within(dialog).getByText(/online\.facilities\.dialog\.seatsChange:9,000\|11,000/),
    ).toBeTruthy();
    expect(
      within(dialog).getByText("online.facilities.dialog.daysReal:3|online.facilities.realHours:3"),
    ).toBeTruthy();
  });

  // Given each refusal a build can meet,
  // when the server answers with it,
  // then the dialog says its own sentence (T3).
  it.each([
    ["be.error.economy.insufficientFunds", "resolved:be.error.economy.insufficientFunds"],
    ["be.error.economy.facilityBuilderBusy", "resolved:be.error.economy.facilityBuilderBusy"],
    ["be.error.economy.disabled", "resolved:be.error.economy.disabled"],
    ["be.error.something.unknown", "online.facilities.error.generic"],
  ])("says the refusal %s", async (code, text) => {
    serve({ "POST v1/clubs/mine/facilities/shop/build": fail(409, code) });
    renderOnline("/online/facilities");

    const shop = await screen.findByRole("article", { name: "online.facilities.name.shop" });
    fireEvent.click(
      within(shop).getByRole("button", { name: /online\.facilities\.card\.upgradeFor/ }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "online.facilities.dialog.start" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe(text);
  });

  // Given a build needing 3 time skips and 2 held,
  // when the coach opens the speed-up,
  // then − / + stay within 1 and 2, the shop is offered, and the count used is sent.
  it("keeps the speed-up within what is held and needed", async () => {
    serve({
      "GET v1/clubs/mine/facilities": ok(view({ build: building() })),
      "POST v1/clubs/mine/facilities/build/speed-up": ok(view({ build: building() })),
    });
    renderOnline("/online/facilities");

    fireEvent.click(await screen.findByRole("button", { name: /online\.facilities\.crew\.busy/ }));
    const dialog = await screen.findByRole("dialog");
    const fewer = within(dialog).getByRole("button", { name: "online.facilities.dialog.fewer" });
    const more = within(dialog).getByRole("button", { name: "online.facilities.dialog.more" });
    expect(fewer).toBeDisabled();
    fireEvent.click(more);
    expect(more).toBeDisabled();
    expect(
      within(dialog).getByRole("link", { name: "online.facilities.dialog.shop" }),
    ).toHaveAttribute("href", "/online/shop");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "online.facilities.dialog.useSkips:2" }),
    );
    await waitFor(() =>
      expect(sent("POST", "v1/clubs/mine/facilities/build/speed-up")).toHaveLength(1),
    );
    expect(sent("POST", "v1/clubs/mine/facilities/build/speed-up")[0]?.body).toEqual({ count: 2 });
  });
});

describe("OnlineFacilities: a completed build (c-27 §5.6)", () => {
  const done = { facility: "shop", level: 3, completedAt: "2026-11-13T10:00:00Z" };

  // Given the shop just completed, not seen,
  // when the screen opens,
  // then the layer comes up for it (not only the stands, T7) with confetti; closing it keeps the
  // card's "New" until the card is touched, and the layer never comes again for it.
  it("shows the layer once, and the card's mark until it is touched", async () => {
    serve({ "GET v1/clubs/mine/facilities": ok(view({ lastCompleted: done })) });
    const first = renderOnline("/online/facilities");

    const layer = await screen.findByRole("dialog", {
      name: "online.facilities.completion.title:online.facilities.name.shop|3",
    });
    expect(screen.getByTestId("confetti").children).toHaveLength(24);
    fireEvent.click(
      within(layer).getByRole("button", { name: "online.facilities.completion.great" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    const shop = card("shop");
    expect(within(shop).getByText("online.facilities.card.new")).toBeTruthy();
    fireEvent.pointerDown(shop);
    expect(within(card("shop")).queryByText("online.facilities.card.new")).toBeNull();
    expect(window.localStorage.getItem(`ofm.online.facilities.seen.${CLUB}`)).toBe(
      done.completedAt,
    );
    first.unmount();

    renderOnline("/online/facilities");
    expect(await screen.findByRole("heading", { name: "Sân Vinh" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // Given a player who asked for less motion,
  // when the layer comes up,
  // then no confetti falls.
  it("drops the confetti for reduced motion", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    serve({ "GET v1/clubs/mine/facilities": ok(view({ lastCompleted: done })) });
    renderOnline("/online/facilities");

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.queryByTestId("confetti")).toBeNull();
  });

  // Given storage that cannot be read,
  // when the screen opens after a completion,
  // then no layer comes up, so it never stays up for good.
  it("shows no layer when storage cannot be read", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    serve({ "GET v1/clubs/mine/facilities": ok(view({ lastCompleted: done })) });
    renderOnline("/online/facilities");

    expect(await screen.findByRole("heading", { name: "Sân Vinh" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
