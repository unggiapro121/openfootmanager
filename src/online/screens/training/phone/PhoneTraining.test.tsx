import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHONE_QUERY } from "../../../../hooks/usePhoneLayout";
import type { OnlineRequest } from "../../../../services/onlineTransport";
import { fakeRealtime } from "../../../../test-utils/onlineMatchKit";
import {
  type Answer,
  fakeServer,
  LEAGUE,
  myClub,
  ok,
  renderOnline,
  resetOnline,
  SEASON,
  squadPlayer,
} from "../../../../test-utils/onlineTestKit";
import type {
  ExtraDayView,
  ExtraSessionView,
  InventoryView,
  ItemPreviewView,
  ItemUseView,
  MyClubView,
  ShopView,
  TrainingDayView,
  TrainingPlan,
} from "../../../api";
import { saveChoice } from "../extraText";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      options && typeof options === "object"
        ? `${key}:${Object.values(options as Record<string, unknown>).join("|")}`
        : key,
    i18n: { language: "en" },
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}));

vi.mock("../../../../utils/backendI18n", () => ({
  resolveBackendError: (error: unknown) =>
    `resolved:${error instanceof Error ? error.message : String(error)}`,
}));

const KEY = "online.training.phone";
const HOUR = 60 * 60 * 1000;

const SQUAD = [
  squadPlayer({ id: "p1", matchName: "V. An", fullName: "Văn An", condition: 80 }),
  squadPlayer({ id: "p2", matchName: "T. Bình", fullName: "Thanh Bình", condition: 35 }),
];

function extraDay(overrides: Partial<ExtraDayView> = {}): ExtraDayView {
  return {
    canPress: true,
    today: 2,
    floor: 40,
    costs: { Low: 3, Medium: 6, High: 10 },
    sitOut: [{ playerId: "p2", reason: "tired" }],
    ...overrides,
  };
}

function trainingDay(overrides: Partial<TrainingDayView> = {}): TrainingDayView {
  return {
    day: 3,
    recent: [{ day: 2, kind: "auto" }],
    canTrain: true,
    sessionsLast7: 2,
    sessionsCap: 6,
    nextRecoveryAt: new Date(Date.now() + 2 * HOUR).toISOString(),
    recovery: { perDay: 6, hours: 8 },
    autoOff: false,
    keeperDrill: false,
    extra: extraDay(),
    ...overrides,
  };
}

const PLAN: TrainingPlan = {
  focus: "Physical",
  intensity: "Medium",
  schedule: "Balanced",
  groups: [{ id: "g1", name: "Defenders", focus: "Defending", player_ids: ["p2"] }],
  auto: true,
};

function club(overrides: Partial<MyClubView> = {}): MyClubView {
  return myClub({
    players: SQUAD,
    trainingDay: trainingDay(),
    trainingPlan: PLAN,
    trainingPlanIsOwn: true,
    ...overrides,
  });
}

function answer(): ExtraSessionView {
  return {
    day: 3,
    intensity: "Low",
    held: 1,
    firstN: 1,
    lastN: 1,
    players: [{ playerId: "p1", conditionBefore: 80, conditionAfter: 77, gains: 1, sessions: 1 }],
    trainingDay: trainingDay({ extra: extraDay({ today: 3 }) }),
  };
}

let server: ReturnType<typeof fakeServer>;
let realtime: ReturnType<typeof fakeRealtime>;

function serve(
  view: MyClubView,
  more: Record<string, Answer | ((r: OnlineRequest) => Answer)> = {},
) {
  server = fakeServer({
    "GET v1/season": ok({ ...SEASON, weekday: 0 }),
    "GET v1/clubs/mine": ok(view),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/friendlies/mine": ok({}),
    "GET v1/clubs/mine/market": ok({ selling: [], holding: [], recent: [] }),
    "PUT v1/clubs/mine/training": (request) => ok(request.body as TrainingPlan),
    "PATCH v1/players/p1/training-focus": ok(view),
    "POST v1/clubs/mine/training/extra": ok(answer()),
    ...more,
  });
}

const sent = (method: string, path: string) =>
  server.requests.filter(
    (request) => request.method === method && request.segments.join("/") === path,
  );

beforeEach(() => {
  resetOnline();
  window.localStorage.clear();
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

async function open(view: MyClubView = club()) {
  serve(view);
  renderOnline("/online/training");
  await screen.findByRole("tab", { name: `${KEY}.tab.today` });
}

describe("the training page on a phone", () => {
  // Given a club with today's sessions and its plan,
  // when the training page opens on a phone,
  // then today's tab says how many sessions of the cap were held, and the plan's tiles lead to
  // the tab that changes them.
  it("opens on today and leads to the plan's tabs", async () => {
    await open();

    expect(screen.getByRole("tab", { name: `${KEY}.tab.today` })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("2/6")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /training\.focuses\.Physical\.label/ }));
    expect(screen.getByRole("tab", { name: `${KEY}.tab.focus` })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  // Given the schedule tab,
  // when the coach picks the light week and the high intensity,
  // then each is saved with the plan.
  it("changes the schedule and the intensity", async () => {
    await open();
    fireEvent.click(screen.getByRole("tab", { name: `${KEY}.tab.sched` }));

    fireEvent.click(screen.getByRole("radio", { name: /training\.schedules\.Light\.label/ }));
    await waitFor(() =>
      expect(sent("PUT", "v1/clubs/mine/training")[0]?.body).toMatchObject({ schedule: "Light" }),
    );
    fireEvent.click(screen.getByRole("radio", { name: /training\.intensities\.High\.label/ }));
    await waitFor(() =>
      expect(sent("PUT", "v1/clubs/mine/training")[1]?.body).toMatchObject({ intensity: "High" }),
    );
  });

  // Given the focus tab,
  // when the coach picks the technical focus,
  // then the plan is saved with it.
  it("changes the team's focus", async () => {
    await open();
    fireEvent.click(screen.getByRole("tab", { name: `${KEY}.tab.focus` }));
    fireEvent.click(screen.getByRole("radio", { name: /training\.focuses\.Technical\.label/ }));

    await waitFor(() =>
      expect(sent("PUT", "v1/clubs/mine/training")[0]?.body).toMatchObject({ focus: "Technical" }),
    );
  });

  // Given a group of one,
  // when the coach filters by it, then opens the other player and gives him his own focus,
  // then the filter shows the group alone and the player's focus is saved.
  it("filters by group and sets a player's own focus", async () => {
    await open();
    fireEvent.click(screen.getByRole("tab", { name: /online\.training\.phone\.tab\.groups/ }));

    const list = screen.getByRole("list", { name: `${KEY}.players` });
    expect(within(list).getAllByRole("button", { expanded: false })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /^Defenders/ }));
    expect(within(list).getAllByRole("button", { expanded: false })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /^online\.training\.groups\.all/ }));

    fireEvent.click(within(list).getByRole("button", { name: /V\. An/ }));
    fireEvent.change(screen.getByLabelText(/online\.training\.groups\.focusOfPlayer:V\. An/), {
      target: { value: "Attacking" },
    });
    await waitFor(() =>
      expect(sent("PATCH", "v1/players/p1/training-focus")[0]?.body).toMatchObject({
        focus: "Attacking",
      }),
    );
  });

  // Given extra sessions today, one player under the floor,
  // when the coach opens extra training and looks at who rests this session,
  // then the tired player is listed with his reason, and a tap on him tells why in full.
  it("explains why a player rests this session", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: /^online\.training\.extra\.title/ }));

    const page = screen.getByRole("dialog", { name: "online.training.extra.title" });
    fireEvent.click(within(page).getByRole("tab", { name: new RegExp(`^${KEY}\\.listRest`) }));
    expect(within(page).getByText(`${KEY}.restNote`)).toBeInTheDocument();
    fireEvent.click(within(page).getByRole("button", { name: /T\. Bình/ }));

    const why = screen.getByRole("dialog", { name: "T. Bình" });
    expect(
      within(why).getByText(new RegExp(`^${KEY}\\.why\\.tired:T\\. Bình\\|35\\|40`)),
    ).toBeInTheDocument();
    fireEvent.click(within(why).getByRole("button", { name: `${KEY}.gotIt` }));
    expect(screen.queryByRole("dialog", { name: "T. Bình" })).not.toBeInTheDocument();
  });

  // Given extra sessions today, and a squad whose next read shows the attribute he gained,
  // when the coach presses for the player who can train,
  // then the press sends him at low intensity, the result names the attribute risen, and the
  // page and the training tab then say what the last press gave.
  it("holds extra sessions and shows what rose", async () => {
    const view = club();
    let pressed = false;
    const after = club({
      players: [
        { ...SQUAD[0], attributes: { ...SQUAD[0].attributes, pace: SQUAD[0].attributes.pace + 1 } },
        SQUAD[1],
      ],
      trainingDay: trainingDay({ extra: extraDay({ today: 3 }) }),
    });
    serve(view, {
      "GET v1/clubs/mine": () => ok(pressed ? after : view),
      "POST v1/clubs/mine/training/extra": () => {
        pressed = true;
        return ok(answer());
      },
    });
    renderOnline("/online/training");
    fireEvent.click(await screen.findByRole("button", { name: /^online\.training\.extra\.title/ }));
    const page = screen.getByRole("dialog", { name: "online.training.extra.title" });
    fireEvent.click(within(page).getByRole("button", { name: "online.training.extra.pressShort" }));

    await waitFor(() => expect(sent("POST", "v1/clubs/mine/training/extra")).toHaveLength(1));
    const body = sent("POST", "v1/clubs/mine/training/extra")[0]?.body as { players: string[] };
    expect(body).toMatchObject({ intensity: "Low" });
    expect(body.players).toContain("p1");
    const sheet = await screen.findByRole("dialog", { name: `${KEY}.resultTitle` });
    expect(await within(sheet).findByText("common.attributes.pace")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "common.close" }));

    expect(within(page).getByRole("button", { name: /lastGains:1\|1/ })).toBeInTheDocument();
    fireEvent.click(within(page).getByRole("button", { name: `${KEY}.back` }));
    expect(screen.getByRole("button", { name: /entryLast:1\|3/ })).toBeInTheDocument();
  });

  // Given a player at 80 condition who can train,
  // when the coach keeps 75 for the match and picks the high intensity (10 a session),
  // then one session would take him under 75: he moves to those who rest, nobody is left to
  // train, and the press cannot go.
  it("rests the players the condition to keep would stop", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: /^online\.training\.extra\.title/ }));
    const page = screen.getByRole("dialog", { name: "online.training.extra.title" });

    fireEvent.click(within(page).getByRole("button", { name: `${KEY}.keepMatchShort:75` }));
    fireEvent.click(
      within(page).getByRole("radio", { name: /training\.intensities\.High\.label/ }),
    );

    expect(within(page).getByText(`${KEY}.noneReadyKeep:75`)).toBeInTheDocument();
    expect(
      within(page).getByRole("button", { name: "online.training.extra.pressShort" }),
    ).toBeDisabled();
    fireEvent.click(within(page).getByRole("tab", { name: new RegExp(`^${KEY}\\.listRest`) }));
    expect(within(page).getByText(`${KEY}.underKeep:75`)).toBeInTheDocument();
  });
  // Given a season with the keepers' drill and the keeper under the floor (E5-6d C),
  // when the coach opens extra training on a phone,
  // then a note names the keeper.
  it("warns when a keeper is too tired for the session and the drill", async () => {
    const keeper = squadPlayer({
      id: "gk",
      matchName: "C. Thụ",
      position: "Goalkeeper",
      naturalPosition: "Goalkeeper",
      condition: 35,
    });
    await open(
      club({
        players: [...SQUAD, keeper],
        trainingDay: trainingDay({
          keeperDrill: true,
          extra: extraDay({ sitOut: [{ playerId: "gk", reason: "tired" }] }),
        }),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^online\.training\.extra\.title/ }));
    const page = screen.getByRole("dialog", { name: "online.training.extra.title" });
    expect(within(page).getByRole("note")).toHaveTextContent(
      "online.training.extra.keeperTired:C. Thụ|40",
    );
  });
});

const DRINK = "online.training.extra.drink";

function drinks(small: number, large: number, locked = false): InventoryView {
  const lines = [
    { itemCode: "energyDrinkSmall", total: small },
    { itemCode: "energyDrinkLarge", total: large },
  ]
    .filter((line) => line.total > 0)
    .map((line) => ({ ...line, powerClass: "c", stacks: [{ quantity: line.total }] }));
  return {
    lines,
    locked,
    limits: {
      teamRecovery: { usedToday: 0, perDay: 1, nextAt: "2099-01-02T00:00:00Z" },
      notes: [],
      xpX2: { remaining: 0, max: 10 },
    },
  };
}

function drinkPreview(before: number, after: number): ItemPreviewView {
  return {
    effect: { kind: "condition", players: [{ playerId: "p2", before, after }] },
    limits: { pointsToday: 0, pointsPerDay: 35 },
  };
}

const USED: ItemUseView = {
  itemCode: "energyDrinkSmall",
  target: { kind: "player", playerId: "p2" },
  effect: { kind: "condition", players: [{ playerId: "p2", before: 35, after: 50 }] },
  held: [{ quantity: 1 }],
};

const SHOP: ShopView = {
  priceListVersion: 3,
  items: [
    {
      itemCode: "energyDrinkSmall",
      powerClass: "c",
      price: 5,
      maxPurchase: 99,
      effect: { condition: 15 },
    },
    {
      itemCode: "energyDrinkLarge",
      powerClass: "c",
      price: 12,
      maxPurchase: 99,
      effect: { condition: 35 },
    },
  ],
};

/** The extra page with the squad's drinks, on a phone. */
async function openExtraWith(
  items: InventoryView,
  more: Record<string, Answer | ((r: OnlineRequest) => Answer)> = {},
  view: MyClubView = club(),
) {
  serve(view, {
    "GET v1/me": ok({ id: "account-1" }),
    "GET v1/me/items": ok(items),
    "GET v1/shop": ok(SHOP),
    "GET v1/me/items/energyDrinkSmall/preview": ok(drinkPreview(35, 50)),
    "GET v1/me/items/energyDrinkLarge/preview": ok(drinkPreview(35, 70)),
    ...more,
  });
  renderOnline("/online/training");
  fireEvent.click(await screen.findByRole("button", { name: /^online\.training\.extra\.title/ }));
  return screen.getByRole("dialog", { name: "online.training.extra.title" });
}

describe("energy drinks in extra training on a phone", () => {
  // Given a tired player left out of the coach's saved choice, and two small drinks,
  // when the coach taps his ⚡ on the resting list and taps the small drink once,
  // then the drink is used on him with no second confirmation, the page says what it did, and
  // once the club is read again he can train and is chosen.
  it("boosts a tired player in one tap and chooses him", async () => {
    saveChoice(club().club.id, { players: ["p1"], sessions: 1, keepAbove: null });
    let used = false;
    const after = club({
      players: [SQUAD[0], { ...SQUAD[1], condition: 50 }],
      trainingDay: trainingDay({ extra: extraDay({ sitOut: [] }) }),
    });
    const page = await openExtraWith(drinks(2, 0), {
      "GET v1/clubs/mine": () => ok(used ? after : club()),
      "POST v1/me/items/energyDrinkSmall/use": () => {
        used = true;
        return ok(USED);
      },
    });
    expect(
      await within(page).findByText(/online\.training\.extra\.drinksHeld:2\|0/),
    ).toBeInTheDocument();
    fireEvent.click(within(page).getByRole("tab", { name: new RegExp(`^${KEY}\\.listRest`) }));
    fireEvent.click(within(page).getByRole("button", { name: `${DRINK}.open:T. Bình` }));

    const sheet = screen.getByRole("dialog", { name: `${DRINK}.title` });
    const small = await within(sheet).findByRole("button", {
      name: /online\.items\.energyDrinkSmall.*online\.items\.quick\.change:35\|50/,
    });
    await waitFor(() => expect(small).toBeEnabled());
    fireEvent.click(small);

    await waitFor(() => expect(sent("POST", "v1/me/items/energyDrinkSmall/use")).toHaveLength(1));
    expect(sent("POST", "v1/me/items/energyDrinkSmall/use")[0]?.body).toMatchObject({
      target: { kind: "player", playerId: "p2" },
    });
    expect(screen.queryByRole("dialog", { name: /online\.items\.useTitle/ })).toBeNull();
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: `${DRINK}.title` })).toBeNull(),
    );
    expect(within(page).getByText(/^online\.items\.used/)).toHaveAttribute("role", "status");
    fireEvent.click(within(page).getByRole("tab", { name: new RegExp(`^${KEY}\\.listReady`) }));
    expect(await within(page).findByRole("checkbox", { name: "T. Bình" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  // Given a small drink held and no large one, and a shop that sells both,
  // when the coach opens a player's drinks,
  // then the large drink is offered to buy at its price, and a tap opens its purchase.
  it("offers to buy a drink the club has none of", async () => {
    const page = await openExtraWith(drinks(1, 0));
    fireEvent.click(within(page).getByRole("tab", { name: new RegExp(`^${KEY}\\.listRest`) }));
    fireEvent.click(within(page).getByRole("button", { name: `${DRINK}.open:T. Bình` }));

    const sheet = screen.getByRole("dialog", { name: `${DRINK}.title` });
    const buy = await within(sheet).findByRole("button", {
      name: /online\.items\.energyDrinkLarge.*online\.items\.quick\.buy:12/,
    });
    fireEvent.click(buy);
    expect(
      await screen.findByRole("dialog", { name: /^online\.items\.energyDrinkLarge\.name/ }),
    ).toBeInTheDocument();
  });

  // Given a fit player at 100, an injured one and a tired one,
  // when the extra page opens, then only the tired one has a ⚡;
  // and with the items locked, no one has.
  it("offers drinks only to those they can help", async () => {
    const view = club({
      players: [
        { ...SQUAD[0], condition: 100 },
        SQUAD[1],
        squadPlayer({
          id: "p3",
          matchName: "Q. Hải",
          condition: 60,
          injury: { name: "injuries.hamstring", daysRemaining: 2 },
        }),
      ],
      trainingDay: trainingDay({
        extra: extraDay({
          sitOut: [
            { playerId: "p2", reason: "tired" },
            { playerId: "p3", reason: "injured" },
          ],
        }),
      }),
    });
    const page = await openExtraWith(drinks(2, 1), {}, view);
    await within(page).findByText(/online\.training\.extra\.drinksHeld/);
    expect(within(page).queryByRole("button", { name: `${DRINK}.open:V. An` })).toBeNull();
    fireEvent.click(within(page).getByRole("tab", { name: new RegExp(`^${KEY}\\.listRest`) }));
    expect(within(page).getByRole("button", { name: `${DRINK}.open:T. Bình` })).toBeInTheDocument();
    expect(within(page).queryByRole("button", { name: `${DRINK}.open:Q. Hải` })).toBeNull();
  });

  // Given the items locked,
  // when the extra page opens, then there is no ⚡ and no count of drinks.
  it("offers no drinks while the items are locked", async () => {
    const page = await openExtraWith(drinks(2, 1, true));
    fireEvent.click(within(page).getByRole("tab", { name: new RegExp(`^${KEY}\\.listRest`) }));
    expect(within(page).getByRole("button", { name: /T\. Bình/ })).toBeInTheDocument();
    expect(within(page).queryByRole("button", { name: `${DRINK}.open:T. Bình` })).toBeNull();
    expect(within(page).queryByText(/online\.training\.extra\.drinksHeld/)).toBeNull();
  });

  // Given a player's drinks open over the extra page,
  // when the coach presses Escape,
  // then the drinks close and the extra page stays.
  it("closes the drinks on Escape and keeps the page", async () => {
    const page = await openExtraWith(drinks(2, 0));
    fireEvent.click(within(page).getByRole("tab", { name: new RegExp(`^${KEY}\\.listRest`) }));
    fireEvent.click(within(page).getByRole("button", { name: `${DRINK}.open:T. Bình` }));
    const sheet = screen.getByRole("dialog", { name: `${DRINK}.title` });

    fireEvent.keyDown(sheet, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: `${DRINK}.title` })).toBeNull();
    expect(screen.getByRole("dialog", { name: "online.training.extra.title" })).toBeInTheDocument();
  });
});
