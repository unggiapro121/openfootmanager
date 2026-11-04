import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHONE_QUERY } from "../../../hooks/usePhoneLayout";
import { fakeRealtime } from "../../../test-utils/onlineMatchKit";
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
import type { InventoryLineView, InventoryView, SquadPlayerView } from "../../api";

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

const HEAL = "online.squad.heal.action";

const LIN = squadPlayer({
  id: "lin",
  fullName: "Christian Lin",
  matchName: "Lin",
  injury: { name: "injuries.hamstring", daysRemaining: 2 },
});

function line(itemCode: string, total: number): InventoryLineView {
  return { itemCode, powerClass: "c", total, stacks: [{ quantity: total }] };
}

function inventory(lines: InventoryLineView[]): InventoryView {
  return {
    lines,
    locked: false,
    limits: {
      teamRecovery: { usedToday: 0, perDay: 1, nextAt: "2099-01-02T00:00:00Z" },
      notes: [],
      xpX2: { remaining: 0, max: 10 },
    },
  };
}

let server: ReturnType<typeof fakeServer>;
let realtime: ReturnType<typeof fakeRealtime>;

function layout(phone: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: phone && query === PHONE_QUERY,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

async function open(player: SquadPlayerView, items: InventoryView) {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub({ players: [player] })),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/me": ok({ id: "account-1" }),
    "GET v1/friendlies/mine": ok({}),
    "GET v1/clubs/mine/market": ok({ selling: [], holding: [], recent: [] }),
    "GET v1/me/items": ok(items),
  });
  renderOnline(`/online/squad/${player.id}`);
  await screen.findAllByText(/Christian Lin/);
}

beforeEach(() => {
  resetOnline();
  realtime = fakeRealtime();
});
afterEach(() => {
  server?.restore();
  realtime.restore();
  vi.unstubAllGlobals();
});

describe("healing an injured player from his injury", () => {
  // Given an injured player and a bandage in the inventory,
  // when the coach presses "heal" on the injury,
  // then a list of the medkits held opens, and choosing one opens its use on this player alone:
  // no other player to pick.
  it("lists the medkits held and uses the one chosen", async () => {
    layout(false);
    await open(LIN, inventory([line("medkitBandage", 2), line("energyDrinkSmall", 5)]));

    fireEvent.click(await screen.findByRole("button", { name: HEAL }));
    const list = screen.getByRole("dialog", { name: HEAL });
    expect(
      within(list).queryByRole("button", { name: /online\.items\.medkitAdvanced/ }),
    ).not.toBeInTheDocument();
    expect(
      within(list).queryByRole("button", { name: /online\.items\.energyDrinkSmall/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: /online\.items\.medkitBandage/ }));

    const use = await screen.findByRole("dialog", { name: /online\.items\.useTitle/ });
    expect(within(use).getByText("Christian Lin")).toBeInTheDocument();
    expect(within(use).queryByRole("group", { name: "online.items.pickPlayer" })).toBeNull();
  });

  // Given an injured player and no medkit in the inventory,
  // when the coach presses "heal",
  // then the list says there is none and points to the shop.
  it("says there is no medkit and points to the shop", async () => {
    layout(false);
    await open(LIN, inventory([line("energyDrinkSmall", 5)]));

    fireEvent.click(await screen.findByRole("button", { name: HEAL }));
    const list = screen.getByRole("dialog", { name: HEAL });
    expect(within(list).getByText("online.squad.heal.none")).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: /online\.player\.phone\.shop/ })).toHaveAttribute(
      "href",
      "/online/shop",
    );
  });

  // Given a player who is not injured,
  // when his page opens,
  // then there is no "heal" button.
  it("offers no heal to a fit player", async () => {
    layout(false);
    await open({ ...LIN, injury: undefined }, inventory([line("medkitBandage", 2)]));

    expect(screen.queryByRole("button", { name: HEAL })).not.toBeInTheDocument();
  });

  // Given an injured player on a phone,
  // when the coach presses "heal" on the injury,
  // then the medkits held rise in a sheet, and choosing one opens its use.
  it("lists the medkits in a sheet on a phone", async () => {
    layout(true);
    await open(LIN, inventory([line("medkitAdvanced", 1)]));

    fireEvent.click(await screen.findByRole("button", { name: HEAL }));
    const sheet = screen.getByRole("dialog", { name: HEAL });
    fireEvent.click(within(sheet).getByRole("button", { name: /online\.items\.medkitAdvanced/ }));

    expect(
      await screen.findByRole("dialog", { name: /online\.items\.useTitle/ }),
    ).toBeInTheDocument();
  });
});
