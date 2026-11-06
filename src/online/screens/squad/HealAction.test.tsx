import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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

const healPreview = {
  effect: { kind: "injury", playerId: "lin", before: 2, after: 1 },
  limits: {},
};

function healed(itemCode: string) {
  return {
    itemCode,
    target: { kind: "player", playerId: "lin" },
    effect: { kind: "injury", playerId: "lin", before: 2, after: 1 },
    held: [],
  };
}

const uses = (code: string) =>
  server.requests.filter((r) => r.segments.join("/") === `v1/me/items/${code}/use`);

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
    "GET v1/me/items/medkitBandage/preview": ok(healPreview),
    "GET v1/me/items/medkitAdvanced/preview": ok(healPreview),
    "POST v1/me/items/medkitBandage/use": ok(healed("medkitBandage")),
    "POST v1/me/items/medkitAdvanced/use": ok(healed("medkitAdvanced")),
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
  // when the coach presses "heal" on the injury and taps the bandage,
  // then only the medkits held are listed, and the bandage is used on this player at once: no
  // second dialog asks again (C-17 C17-8).
  it("lists the medkits held and uses the one chosen in one tap", async () => {
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
    const bandage = within(list).getByRole("button", { name: /online\.items\.medkitBandage/ });
    await waitFor(() => expect(bandage).toBeEnabled());
    fireEvent.click(bandage);

    await waitFor(() => expect(uses("medkitBandage")).toHaveLength(1));
    expect(uses("medkitBandage")[0]?.body).toMatchObject({
      target: { kind: "player", playerId: "lin" },
    });
    expect(screen.queryByRole("dialog", { name: /online\.items\.useTitle/ })).toBeNull();
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
  // when the coach presses "heal" on the injury and taps the medkit,
  // then the medkits held rise in a sheet, and the tap uses it at once.
  it("lists the medkits in a sheet on a phone and uses one in one tap", async () => {
    layout(true);
    await open(LIN, inventory([line("medkitAdvanced", 1)]));

    fireEvent.click(await screen.findByRole("button", { name: HEAL }));
    const sheet = screen.getByRole("dialog", { name: HEAL });
    const medkit = within(sheet).getByRole("button", { name: /online\.items\.medkitAdvanced/ });
    await waitFor(() => expect(medkit).toBeEnabled());
    fireEvent.click(medkit);

    await waitFor(() => expect(uses("medkitAdvanced")).toHaveLength(1));
    expect(screen.queryByRole("dialog", { name: /online\.items\.useTitle/ })).toBeNull();
  });
});
