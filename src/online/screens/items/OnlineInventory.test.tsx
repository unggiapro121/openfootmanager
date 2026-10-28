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

/** The Use button of the card of `code`. */
async function useButtonOf(code: string) {
  const card = await screen.findByRole("article", { name: `online.items.${code}.name:${code}` });
  return within(card).getByRole("button", { name: "online.inventory.use" });
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
  // then the items show under their groups, the unknown one under Other by its code.
  it("shows each item under its group, an unknown code under Other", async () => {
    serve();
    renderOnline("/online/inventory");

    const condition = await screen.findByRole("region", {
      name: "online.inventory.group.condition",
    });
    expect(
      within(condition).getByText("online.items.energyDrinkSmall.name:energyDrinkSmall"),
    ).toBeTruthy();
    const other = screen.getByRole("region", { name: "online.inventory.group.other" });
    expect(within(other).getByText("online.items.mysteryBox.name:mysteryBox")).toBeTruthy();
    expect(screen.getByText(/online\.inventory\.teamRecovery:0\|1/)).toBeTruthy();
  });

  // Given the nightly audit locked the coach's items,
  // when the inventory opens,
  // then a banner says so and every Use is off.
  it("shows the lock and turns every use off", async () => {
    serve({ "GET v1/me/items": ok(inventory({ locked: true })) });
    renderOnline("/online/inventory");

    expect((await screen.findByRole("alert")).textContent).toContain("online.inventory.locked");
    for (const button of screen.getAllByRole("button", { name: "online.inventory.use" })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  // Given a season with no item rules (`limits` absent),
  // when the inventory opens,
  // then the condition items cannot be used, and say why.
  it("turns use off while the season has no item rules", async () => {
    serve({ "GET v1/me/items": ok(inventory({ limits: undefined })) });
    renderOnline("/online/inventory");

    const use = await useButtonOf("energyDrinkSmall");
    expect((use as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText("online.inventory.notThisSeason").length).toBeGreaterThan(0);
  });

  // Given a coach with no club,
  // when the inventory opens,
  // then the page opens, a drink cannot be used and links to taking a club, a note still can.
  it("opens without a club, items for a player or the club needing one", async () => {
    serve({
      "GET v1/clubs/mine": fail(404, "be.error.club.none"),
      "GET v1/me/items": ok(
        inventory({ lines: [line("energyDrinkSmall"), line("tacticalNoteBasic")] }),
      ),
    });
    renderOnline("/online/inventory");

    const drink = await useButtonOf("energyDrinkSmall");
    expect((drink as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("online.inventory.needClub")).toBeTruthy();
    expect(screen.getByRole("link", { name: "online.coins.takeOver" })).toBeTruthy();
    const note = await useButtonOf("tacticalNoteBasic");
    expect((note as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByLabelText("location").textContent).toBe("/online/inventory");
  });
});

describe("using an item", () => {
  // Given a drink and two players, one at full condition,
  // when the coach opens its dialog and picks the full one, then the tired one,
  // then the full one is dimmed and asks nothing, the tired one is previewed as `player:<id>`.
  it("previews the player chosen, never one already full", async () => {
    serve({ "GET v1/me/items/energyDrinkSmall/preview": ok(preview()) });
    renderOnline("/online/inventory");
    fireEvent.click(await useButtonOf("energyDrinkSmall"));

    const dialog = await screen.findByRole("dialog");
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
    fireEvent.click(await useButtonOf("energyDrinkSmall"));
    const dialog = await screen.findByRole("dialog");
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
  // when the recovery pack's dialog opens,
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
    fireEvent.click(await useButtonOf("teamRecoveryPack"));

    const dialog = await screen.findByRole("dialog");
    const banner = await within(dialog).findByRole("alert");
    expect(banner.textContent).toMatch(/^be\.error\.inventory\.targetMatchLocked:/);
    expect(banner.textContent).not.toContain("2099-01-02T15:00:00Z");
    expect(sent("GET", "v1/me/items/teamRecoveryPack/preview")[0].query).toEqual([
      ["target", "club"],
    ]);
  });

  // Given a preview with nothing in the way,
  // when the coach confirms,
  // then the use carries the same target in its body and a key, and the club is read again.
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
    fireEvent.click(await useButtonOf("energyDrinkSmall"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Trần Văn Bình/ }));
    await within(dialog).findByText("online.items.preview.condition:Trần Văn Bình|60|75");
    const clubReads = sent("GET", "v1/clubs/mine").length;

    fireEvent.click(within(dialog).getByRole("button", { name: "online.items.confirmUse" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const [use] = sent("POST", "v1/me/items/energyDrinkSmall/use");
    expect(use.body).toEqual({ target: { kind: "player", playerId: TIRED.id } });
    expect(use.idempotencyKey).toBeTruthy();
    await waitFor(() => expect(sent("GET", "v1/clubs/mine").length).toBeGreaterThan(clubReads));
    expect(screen.getByText(/^online\.items\.used:/)).toBeTruthy();
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
});
