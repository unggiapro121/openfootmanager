import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InventoryLineView, InventoryView, ItemEntriesPage, ItemPreviewView } from "../../api";
import type { OnlineRequest } from "../../../services/onlineTransport";
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
  squadPlayer,
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
const TIRED = squadPlayer({ id: "p-tired", fullName: "Trần Văn Bình", condition: 60 });
const FRESH = squadPlayer({ id: "p-fresh", fullName: "Lê Văn Cường", condition: 100 });

function line(itemCode: string, total = 2, powerClass = "c"): InventoryLineView {
  return { itemCode, powerClass, total, stacks: [{ quantity: total }] };
}

function inventory(overrides: Partial<InventoryView> = {}): InventoryView {
  return {
    lines: [line("energyDrinkSmall"), line("teamRecoveryPack", 1), line("mysteryBox", 1, "a")],
    locked: false,
    limits: {
      teamRecovery: { usedToday: 0, perDay: 1, nextAt: "2099-01-02T00:00:00Z" },
      notes: [],
      xpX2: { remaining: 0, max: 10 },
    },
    ...overrides,
  };
}

function preview(overrides: Partial<ItemPreviewView> = {}): ItemPreviewView {
  return {
    effect: { kind: "condition", players: [{ playerId: TIRED.id, before: 60, after: 75 }] },
    limits: { usedToday: 0, perDay: 2 },
    ...overrides,
  };
}

let server: ReturnType<typeof fakeServer>;
let realtime: ReturnType<typeof fakeRealtime>;

function serve(more: Record<string, Answer | ((request: OnlineRequest) => Answer)> = {}) {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub({ players: [TIRED, FRESH] })),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/me": ok({ id: ACCOUNT }),
    "GET v1/friendlies/mine": ok({}),
    "GET v1/clubs/mine/market": ok({ selling: [], holding: [], recent: [] }),
    "GET v1/me/items": ok(inventory()),
    ...more,
  });
}

const sent = (method: string, path: string) =>
  server.requests.filter(
    (request) => request.method === method && request.segments.join("/") === path,
  );

/** Opens the detail dialog of the tile of `code`. */
async function openDetail(code: string) {
  fireEvent.click(
    await screen.findByRole("button", {
      name: new RegExp(`^online\\.inventory\\.tileAria:online\\.items\\.${code}\\.name`),
    }),
  );
  return screen.findByRole("dialog", { name: `online.items.${code}.name:${code}` });
}

/** The main action of a detail dialog. */
const actionIn = (dialog: HTMLElement) =>
  within(dialog).getByRole("button", {
    name: /^online\.inventory\.action\./,
  }) as HTMLButtonElement;

/** Opens the use dialog of `code` through its detail. */
async function openUse(code: string) {
  fireEvent.click(actionIn(await openDetail(code)));
  return screen.findByRole("dialog", { name: /^online\.items\.useTitle:/ });
}

beforeEach(() => {
  resetOnline();
  realtime = fakeRealtime();
});
afterEach(() => {
  server?.restore();
  realtime.restore();
});

describe("the inventory", () => {
  // Given a coach holding drinks, a recovery pack and a code this build does not know,
  // when the inventory opens,
  // then the items show under their groups with their counts, the unknown one under Other by its
  // code, the pack with the club's uses today, and the items tab counts three kinds.
  it("shows each item under its group, an unknown code under Other", async () => {
    serve();
    renderOnline("/online/inventory");

    const condition = await screen.findByRole("region", {
      name: /^online\.inventory\.group\.condition/,
    });
    const drink = within(condition).getByRole("button", { name: /energyDrinkSmall/ });
    expect(drink.getAttribute("aria-label")).toBe(
      "online.inventory.tileAria:online.items.energyDrinkSmall.name:energyDrinkSmall|2",
    );
    const other = screen.getByRole("region", { name: /^online\.inventory\.group\.other/ });
    expect(within(other).getByText("online.items.mysteryBox.name:mysteryBox")).toBeTruthy();
    expect(screen.getByText("online.inventory.usedToday:0|1")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "online.inventory.tabHeldCount:3" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "online.inventory.toShopMore" })).toBeTruthy();
  });

  // Given a drink held in two rows, one expiring,
  // when its detail opens,
  // then it says how many are held, what it is used on and when each row expires.
  it("shows the detail of an item", async () => {
    serve({
      "GET v1/me/items": ok(
        inventory({
          lines: [
            {
              itemCode: "energyDrinkSmall",
              powerClass: "c",
              total: 3,
              stacks: [{ quantity: 1, expiresAt: "2099-03-01T00:00:00Z" }, { quantity: 2 }],
            },
          ],
        }),
      ),
    });
    renderOnline("/online/inventory");
    const dialog = await openDetail("energyDrinkSmall");

    expect(dialog.textContent).toContain("online.inventory.holding:3");
    expect(dialog.textContent).toContain("online.shop.scope.player");
    expect(dialog.textContent).toMatch(/online\.inventory\.expires:1\|/);
    expect(dialog.textContent).toContain("online.inventory.neverExpires:2");
    expect(actionIn(dialog).textContent).toBe("online.inventory.action.player");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  // Given the nightly audit locked the coach's items,
  // when the inventory opens and a drink's detail is opened,
  // then a banner says so and the use is off.
  it("shows the lock and turns the use off", async () => {
    serve({ "GET v1/me/items": ok(inventory({ locked: true })) });
    renderOnline("/online/inventory");

    expect((await screen.findByRole("alert")).textContent).toContain("online.inventory.locked");
    const dialog = await openDetail("energyDrinkSmall");
    expect(actionIn(dialog).disabled).toBe(true);
    expect(dialog.textContent).toContain("online.inventory.lockedShort");
  });

  // Given a season with no item rules (`limits` absent),
  // when a drink's detail opens,
  // then it cannot be used, and says why.
  it("turns use off while the season has no item rules", async () => {
    serve({ "GET v1/me/items": ok(inventory({ limits: undefined })) });
    renderOnline("/online/inventory");

    const dialog = await openDetail("energyDrinkSmall");
    expect(actionIn(dialog).disabled).toBe(true);
    expect(dialog.textContent).toContain("online.inventory.notThisSeason");
  });

  // Given the club already used its recovery pack today,
  // when the pack's detail opens,
  // then the day's limit shows as used and the use is off until the day turns.
  it("turns the recovery pack off once the club used it today", async () => {
    serve({
      "GET v1/me/items": ok(
        inventory({
          limits: {
            teamRecovery: { usedToday: 1, perDay: 1, nextAt: "2099-01-02T00:00:00Z" },
            notes: [],
            xpX2: { remaining: 0, max: 10 },
          },
        }),
      ),
    });
    renderOnline("/online/inventory");
    const dialog = await openDetail("teamRecoveryPack");

    expect(dialog.textContent).toContain("online.inventory.dailyUsed:1|1");
    expect(dialog.textContent).toMatch(/online\.inventory\.refreshAt:/);
    expect(actionIn(dialog).textContent).toBe("online.inventory.action.usedToday");
    expect(actionIn(dialog).disabled).toBe(true);
  });

  // Given a coach with no club,
  // when a drink's detail and then a note's open,
  // then the drink cannot be used and links to taking a club; the note needs no club.
  it("opens without a club, items for a player or the club needing one", async () => {
    serve({
      "GET v1/clubs/mine": fail(404, "be.error.club.none"),
      "GET v1/me/items": ok(
        inventory({ lines: [line("energyDrinkSmall"), line("tacticalNoteBasic")] }),
      ),
    });
    renderOnline("/online/inventory");

    const drink = await openDetail("energyDrinkSmall");
    expect(actionIn(drink).disabled).toBe(true);
    expect(within(drink).getByText("online.inventory.needClub")).toBeTruthy();
    expect(within(drink).getByRole("link", { name: "online.coins.takeOver" })).toBeTruthy();
    fireEvent.click(within(drink).getAllByRole("button", { name: "common.close" })[0]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const note = await openDetail("tacticalNoteBasic");
    expect(within(note).queryByText("online.inventory.needClub")).toBeNull();
    expect(screen.getByLabelText("location").textContent).toBe("/online/inventory");
  });

  // Given a note, one style that banked its season's XP and one that did not,
  // when the note's detail opens and the coach picks a style,
  // then the full style cannot be picked, the use waits for a pick, then names the style.
  it("picks the style a note is used on", async () => {
    serve({
      "GET v1/me/items": ok(
        inventory({
          lines: [line("tacticalNoteBasic")],
          limits: {
            notes: [
              { style: "Attacking", usedXp: 300, limit: 500 },
              { style: "Defensive", usedXp: 500, limit: 500 },
            ],
            xpX2: { remaining: 0, max: 10 },
          },
        }),
      ),
    });
    renderOnline("/online/inventory");
    const dialog = await openDetail("tacticalNoteBasic");

    expect(actionIn(dialog).disabled).toBe(true);
    expect(actionIn(dialog).textContent).toBe("online.inventory.action.pickStyle");
    const full = within(dialog).getByRole("radio", { name: /common\.playStyles\.Defensive/ });
    expect((full as HTMLInputElement).disabled).toBe(true);
    const attacking = within(dialog).getByRole("radio", {
      name: /common\.playStyles\.Attacking/,
    });
    expect(attacking.closest("label")?.textContent).toContain("online.inventory.styleXp:300|500");
    fireEvent.click(attacking);
    expect((attacking as HTMLInputElement).checked).toBe(true);
    expect(actionIn(dialog).disabled).toBe(false);
    expect(actionIn(dialog).textContent).toBe(
      "online.inventory.action.style:common.playStyles.Attacking",
    );
  });
});

describe("using an item", () => {
  // Given a drink and two players, one at full condition,
  // when the coach opens its use and picks the full one, then the tired one,
  // then the full one is dimmed and asks nothing, the tired one is previewed as `player:<id>`.
  it("previews the player chosen, never one already full", async () => {
    serve({ "GET v1/me/items/energyDrinkSmall/preview": ok(preview()) });
    renderOnline("/online/inventory");
    const dialog = await openUse("energyDrinkSmall");

    fireEvent.click(within(dialog).getByRole("button", { name: /Lê Văn Cường/ }));
    expect(within(dialog).getByText("online.items.reason.conditionFull")).toBeTruthy();
    expect(sent("GET", "v1/me/items/energyDrinkSmall/preview")).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole("button", { name: /Trần Văn Bình/ }));
    await within(dialog).findByText("online.items.preview.condition:Trần Văn Bình|60|75");
    expect(sent("GET", "v1/me/items/energyDrinkSmall/preview")[0].query).toEqual([
      ["target", `player:${TIRED.id}`],
    ]);
  });

  // Given a preview that refuses (the day's cap reached),
  // when it is shown,
  // then its sentence says why and the use cannot be confirmed.
  it("holds the use when the preview refuses", async () => {
    serve({
      "GET v1/me/items/energyDrinkSmall/preview": ok(
        preview({
          effect: undefined,
          refusal: { code: "be.error.inventory.wrongTarget", params: { reason: "notInjured" } },
        }),
      ),
    });
    renderOnline("/online/inventory");
    const dialog = await openUse("energyDrinkSmall");
    fireEvent.click(within(dialog).getByRole("button", { name: /Trần Văn Bình/ }));

    expect((await within(dialog).findByRole("note")).textContent).toBe(
      "online.items.reason.notInjured",
    );
    expect(
      (within(dialog).getByRole("button", { name: "online.items.confirmUse" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  // Given the eleven locked for a match,
  // when the recovery pack's use opens,
  // then it is previewed at once on the club, and the lock is one banner with the kick-off.
  it("previews a club item at once and shows the match lock as one banner", async () => {
    serve({
      "GET v1/me/items/teamRecoveryPack/preview": ok(
        preview({
          effect: undefined,
          refusal: {
            code: "be.error.inventory.targetMatchLocked",
            params: { kickoffAt: "2099-01-02T15:00:00Z" },
          },
        }),
      ),
    });
    renderOnline("/online/inventory");
    const dialog = await openUse("teamRecoveryPack");

    const banner = await within(dialog).findByRole("alert");
    expect(banner.textContent).toMatch(/^be\.error\.inventory\.targetMatchLocked:/);
    expect(banner.textContent).not.toContain("2099-01-02T15:00:00Z");
    expect(sent("GET", "v1/me/items/teamRecoveryPack/preview")[0].query).toEqual([
      ["target", "club"],
    ]);
  });

  // Given a preview with nothing in the way,
  // when the coach confirms,
  // then the use carries the same target in its body and a key, the club is read again, and a
  // notice says what was used.
  it("uses the item on the target previewed", async () => {
    serve({
      "GET v1/me/items/energyDrinkSmall/preview": ok(preview()),
      "POST v1/me/items/energyDrinkSmall/use": ok({
        itemCode: "energyDrinkSmall",
        target: { kind: "player", playerId: TIRED.id },
        effect: { kind: "condition", players: [{ playerId: TIRED.id, before: 60, after: 75 }] },
        held: [{ quantity: 1 }],
      }),
    });
    renderOnline("/online/inventory");
    const dialog = await openUse("energyDrinkSmall");
    fireEvent.click(within(dialog).getByRole("button", { name: /Trần Văn Bình/ }));
    await within(dialog).findByText("online.items.preview.condition:Trần Văn Bình|60|75");
    const clubReads = sent("GET", "v1/clubs/mine").length;

    fireEvent.click(within(dialog).getByRole("button", { name: "online.items.confirmUse" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const [use] = sent("POST", "v1/me/items/energyDrinkSmall/use");
    expect(use.body).toEqual({ target: { kind: "player", playerId: TIRED.id } });
    expect(use.idempotencyKey).toBeTruthy();
    await waitFor(() => expect(sent("GET", "v1/clubs/mine").length).toBeGreaterThan(clubReads));
    const notice = screen.getByText(/^online\.items\.used:/).closest("[role=status]");
    expect(notice).toBeTruthy();
  });

  // Given a note and a style picked in its detail,
  // when the coach uses it,
  // then the use opens on that style and previews it.
  it("opens the note's use on the style picked", async () => {
    serve({
      "GET v1/me/items": ok(
        inventory({
          lines: [line("tacticalNoteBasic")],
          limits: {
            notes: [{ style: "Attacking", usedXp: 0, limit: 500 }],
            xpX2: { remaining: 0, max: 10 },
          },
        }),
      ),
      "GET v1/me/items/tacticalNoteBasic/preview": ok(
        preview({
          effect: {
            kind: "mastery",
            style: "Attacking",
            xp: 100,
            xpBefore: 0,
            xpAfter: 100,
            masteryBefore: 3,
            masteryAfter: 4,
          },
          limits: { seasonUsed: 0, seasonLimit: 500 },
        }),
      ),
    });
    renderOnline("/online/inventory");
    const detail = await openDetail("tacticalNoteBasic");
    fireEvent.click(within(detail).getByRole("radio", { name: /common\.playStyles\.Attacking/ }));
    fireEvent.click(actionIn(detail));

    await screen.findByRole("dialog", { name: /^online\.items\.useTitle:/ });
    await waitFor(() =>
      expect(sent("GET", "v1/me/items/tacticalNoteBasic/preview")[0]?.query).toEqual([
        ["target", "style:Attacking"],
      ]),
    );
  });
});

function entries(): ItemEntriesPage {
  return {
    items: [
      {
        id: "e-1",
        at: "2026-10-28T10:00:00Z",
        itemCode: "energyDrinkSmall",
        delta: 2,
        source: "shop",
      },
      {
        id: "e-2",
        at: "2026-10-28T11:00:00Z",
        itemCode: "energyDrinkSmall",
        delta: -1,
        source: "use",
        targetKind: "player",
        targetId: TIRED.id,
      },
      {
        id: "e-3",
        at: "2026-10-28T12:00:00Z",
        itemCode: "timeSkip",
        delta: -1,
        source: "adminRevoke",
      },
      {
        id: "e-4",
        at: "2026-10-28T13:00:00Z",
        itemCode: "timeSkip",
        delta: -1,
        source: "somethingNew",
        targetKind: "scoutTrip",
      },
    ],
    nextCursor: "e-4",
  };
}

describe("the item history", () => {
  // Given entries from the shop, a use on a player, an administrator's take-back and a source
  // this build does not know,
  // when the history tab opens and the next page is read,
  // then each has its source's words, the player is named, the unknown source is shown as it is,
  // and the next page is asked from the cursor.
  it("lists every entry with its source, a page at a time", async () => {
    serve({
      "GET v1/me/items/entries": (request) =>
        ok(request.query?.some(([name]) => name === "cursor") ? { items: [] } : entries()),
    });
    renderOnline("/online/inventory");
    fireEvent.click(await screen.findByRole("tab", { name: "online.inventory.tabHistory" }));

    const list = await screen.findByRole("list", { name: "online.inventory.tabHistory" });
    expect(list.textContent).toContain("online.inventory.source.shop:shop");
    expect(list.textContent).toContain(TIRED.fullName);
    expect(list.textContent).toContain("online.inventory.source.adminRevoke:adminRevoke");
    expect(list.textContent).toContain("online.inventory.source.somethingNew:somethingNew");
    expect(list.textContent).toContain("online.inventory.target.scoutTrip");

    fireEvent.click(screen.getByRole("button", { name: "online.coins.more" }));
    await waitFor(() => expect(sent("GET", "v1/me/items/entries")).toHaveLength(2));
    expect(sent("GET", "v1/me/items/entries")[1].query).toContainEqual(["cursor", "e-4"]);
  });
});

describe("the account's item rings", () => {
  // Given a coach in the online mode,
  // when an item is given to them, then one of theirs is used,
  // then both read the inventory again, and only the gift shows a notice, linking to the inventory.
  it("reads the items again and tells only of a gift", async () => {
    serve();
    renderOnline("/online/inventory");
    await waitFor(() =>
      expect(realtime.watches.some((watch) => watch.channel === `account:${ACCOUNT}`)).toBe(true),
    );
    await screen.findByText("online.items.energyDrinkSmall.name:energyDrinkSmall");
    const watch = realtime.watches.find((one) => one.channel === `account:${ACCOUNT}`);
    const reads = sent("GET", "v1/me/items").length;

    act(() =>
      watch?.speak({
        kind: "notice",
        channel: `account:${ACCOUNT}`,
        data: { kind: "items", event: "used", itemCode: "energyDrinkSmall" },
      }),
    );
    await waitFor(() => expect(sent("GET", "v1/me/items").length).toBe(reads + 1));
    expect(useOnlineStore.getState().notices).toEqual([]);

    act(() =>
      watch?.speak({
        kind: "notice",
        channel: `account:${ACCOUNT}`,
        data: { kind: "items", event: "granted", itemCode: "timeSkip" },
      }),
    );
    await waitFor(() => expect(sent("GET", "v1/me/items").length).toBe(reads + 2));
    const region = screen.getByRole("region", { name: "online.market.notice.region" });
    const notice = await within(region).findByRole("link");
    expect(notice.textContent).toContain("online.items.notice.granted");
    expect(notice.getAttribute("href")).toBe("/online/inventory");
  });

  // Given a coach in the online mode,
  // when a SuperAdmin takes 2 of their drinks back (S-17d), then a ring says items were taken
  // back without saying how many,
  // then the first notice says which item and how many, linking to the inventory, and the second
  // says only that the items changed.
  it("tells of items taken back, with how many", async () => {
    serve();
    renderOnline("/online/inventory");
    await waitFor(() =>
      expect(realtime.watches.some((watch) => watch.channel === `account:${ACCOUNT}`)).toBe(true),
    );
    await screen.findByText("online.items.energyDrinkSmall.name:energyDrinkSmall");
    const watch = realtime.watches.find((one) => one.channel === `account:${ACCOUNT}`);
    const reads = sent("GET", "v1/me/items").length;

    act(() =>
      watch?.speak({
        kind: "notice",
        channel: `account:${ACCOUNT}`,
        data: { kind: "items", event: "revoked", itemCode: "energyDrinkSmall", quantity: 2 },
      }),
    );
    await waitFor(() => expect(sent("GET", "v1/me/items").length).toBe(reads + 1));
    const region = screen.getByRole("region", { name: "online.market.notice.region" });
    const notice = await within(region).findByRole("link");
    expect(notice.textContent).toContain("online.items.notice.revoked");
    expect(notice.textContent).toContain("energyDrinkSmall");
    expect(notice.textContent).toContain("|2");
    expect(notice.getAttribute("href")).toBe("/online/inventory");

    act(() =>
      watch?.speak({
        kind: "notice",
        channel: `account:${ACCOUNT}`,
        data: { kind: "items", event: "revoked", itemCode: "energyDrinkSmall" },
      }),
    );
    await waitFor(() => expect(within(region).getAllByRole("link")).toHaveLength(2));
    expect(within(region).getAllByRole("link")[1].textContent).toContain(
      "online.items.notice.changed",
    );
  });
});

describe("the daily gift and condition points (C-12b)", () => {
  const LATE = squadPlayer({ id: "p-late", fullName: "Phạm Văn Dũng", condition: 90 });
  const GIFT = { item: "energyDrinkLarge", quantity: 2, available: true };
  const NEXT = "2099-01-02T21:00:00Z";

  // Given a season capping drinks at 50 points and a large drink labelled 35,
  // when the coach previews it on a player at 90,
  // then the dialog shows the points used today out of 50, and that he loses 25 points to 100.
  it("shows the points cap and what 100 cuts", async () => {
    serve({
      "GET v1/clubs/mine": ok(myClub({ players: [LATE] })),
      "GET v1/me/items": ok(inventory({ lines: [line("energyDrinkLarge")] })),
      "GET v1/shop": ok({
        items: [
          {
            itemCode: "energyDrinkLarge",
            powerClass: "c",
            price: 12,
            maxPurchase: 10,
            effect: { condition: 35 },
          },
        ],
      }),
      "GET v1/me/items/energyDrinkLarge/preview": ok(
        preview({
          effect: { kind: "condition", players: [{ playerId: LATE.id, before: 90, after: 100 }] },
          limits: { pointsToday: 0, pointsPerDay: 50 },
        }),
      ),
    });
    renderOnline("/online/inventory");
    const dialog = await openUse("energyDrinkLarge");
    fireEvent.click(within(dialog).getByRole("button", { name: /Phạm Văn Dũng/ }));
    await within(dialog).findByText("online.items.limit.points:0|50");
    await within(dialog).findByText("online.items.preview.lost:Phạm Văn Dũng|25");
  });

  // Given today's gift of 2 large drinks waiting,
  // when the coach claims it,
  // then the claim goes out with a key, the inventory takes the answer's, and the card says
  // what came and when the next gift comes.
  it("claims the gift and shows when the next one comes", async () => {
    serve({
      "GET v1/me/items": ok(inventory({ dailyGift: GIFT })),
      "POST v1/me/daily-gift": ok({
        item: "energyDrinkLarge",
        quantity: 2,
        inventory: inventory({ dailyGift: { ...GIFT, available: false, nextAt: NEXT } }),
      }),
    });
    renderOnline("/online/inventory");
    const claim = await screen.findByRole("button", {
      name: /^online\.items\.dailyGift\.claim:2\|online\.items\.energyDrinkLarge\.name/,
    });
    fireEvent.click(claim);
    await screen.findByText(/^online\.items\.dailyGift\.given:2\|/);
    expect(screen.getByText(/^online\.items\.dailyGift\.next:/)).toBeTruthy();
    expect(sent("POST", "v1/me/daily-gift")[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(useOnlineStore.getState().items?.dailyGift?.available).toBe(false);
  });

  // Given a gift claimed meanwhile on another device,
  // when the coach claims it here,
  // then the refusal shows in words and the inventory is read again.
  it("says the gift was taken and reads the items again", async () => {
    serve({
      "GET v1/me/items": ok(inventory({ dailyGift: GIFT })),
      "POST v1/me/daily-gift": fail(409, "be.error.inventory.dailyGiftTaken", {
        details: { params: { nextAt: NEXT } },
      }),
    });
    renderOnline("/online/inventory");
    fireEvent.click(
      await screen.findByRole("button", { name: /^online\.items\.dailyGift\.claim:/ }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /^be\.error\.inventory\.dailyGiftTaken:/,
    );
    await waitFor(() => expect(sent("GET", "v1/me/items").length).toBeGreaterThan(1));
  });
});
