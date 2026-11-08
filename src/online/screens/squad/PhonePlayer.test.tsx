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
  seasonStats,
  squadPlayer,
  trainingDayView,
} from "../../../test-utils/onlineTestKit";
import type { InventoryView } from "../../api";

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

const KEY = "online.player.phone";

const FISCHER = squadPlayer({
  id: "gk",
  fullName: "Andrés Fischer",
  matchName: "Fischer",
  position: "Goalkeeper",
  naturalPosition: "Goalkeeper",
  nationality: "AR",
  ovr: 69,
  age: 23,
  condition: 79,
  fitness: 100,
  morale: 100,
  shirtNumber: 13,
  footedness: "Left",
  heightCm: 189,
  traits: ["Leader"],
  season: seasonStats({ appearances: 21, goals: 0, assists: 2, avgRating: 6.3 }),
});

const ITEMS: InventoryView = {
  lines: [{ itemCode: "energyDrinkSmall", powerClass: "c", total: 10, stacks: [{ quantity: 10 }] }],
  locked: false,
  limits: {
    teamRecovery: { usedToday: 0, perDay: 1, nextAt: "2099-01-02T00:00:00Z" },
    notes: [],
    xpX2: { remaining: 0, max: 10 },
  },
};

let server: ReturnType<typeof fakeServer>;
let realtime: ReturnType<typeof fakeRealtime>;

function serve(keeperDrill = false) {
  const club = myClub({ players: [FISCHER], trainingDay: trainingDayView({ keeperDrill }) });
  club.setup = { ...club.setup, startingXiIds: ["gk"] };
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(club),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/me": ok({ id: "account-1" }),
    "GET v1/friendlies/mine": ok({}),
    "GET v1/clubs/mine/market": ok({ selling: [], holding: [], recent: [] }),
    "GET v1/me/items": ok(ITEMS),
  });
}

beforeEach(() => {
  resetOnline();
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

async function open(keeperDrill = false) {
  serve(keeperDrill);
  renderOnline("/online/squad/gk");
  return screen.findByRole("heading", { level: 2, name: "Andrés Fischer" });
}

describe("a player's page on a phone", () => {
  // Given a keeper of the club,
  // when his page opens on a phone,
  // then the head card says who he is, his condition shows in three meters, and his
  // attributes open on the radar.
  it("shows the head card, the meters and the radar", async () => {
    await open();

    expect(screen.getByText("common.footedness.Left")).toBeInTheDocument();
    expect(screen.getByLabelText(`${KEY}.shirt:13`)).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "common.condition" })).toHaveAttribute(
      "aria-valuenow",
      "79",
    );
    expect(screen.getByRole("tab", { name: `${KEY}.tab.stats` })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("radio", { name: "common.radarView" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  // Given a keeper in a season whose keepers train their own drill, and one without it,
  // when his page opens on a phone,
  // then the head card carries the drill's badge only in the first.
  it("marks the keeper who trains the keepers' drill", async () => {
    await open(true);
    expect(screen.getByText("online.training.keeperBadge")).toBeInTheDocument();
  });

  it("leaves the badge out in a season without the drill", async () => {
    await open();
    expect(screen.queryByText("online.training.keeperBadge")).toBeNull();
  });

  // Given the attributes as a list,
  // when the coach opens a group,
  // then its attributes show.
  it("opens an attribute group in the list", async () => {
    await open();
    fireEvent.click(screen.getByRole("radio", { name: "common.listView" }));

    const group = screen.getAllByRole("button", { expanded: false })[0];
    fireEvent.click(group);
    expect(group).toHaveAttribute("aria-expanded", "true");
  });

  // Given his traits and his season,
  // when the coach opens those tabs,
  // then each trait is told, and his matches and goals are counted.
  it("shows his traits and his season", async () => {
    await open();
    fireEvent.click(screen.getByRole("tab", { name: `${KEY}.tab.traits` }));
    expect(screen.getByText("traits.Leader.desc")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: `${KEY}.tab.season` }));
    const season = screen.getByRole("list", { name: `${KEY}.tab.season` });
    expect(within(season).getByText("21")).toBeInTheDocument();
    expect(within(season).getByText("6.3")).toBeInTheDocument();
  });

  // Given energy drinks in the inventory,
  // when the coach opens the recovery sheet and taps a drink, its condition before and after
  // shown on it,
  // then the drink is used on this player at once: no second dialog asks again (C-17 C17-8).
  it("uses a recovery item from its sheet in one tap", async () => {
    await open();
    server.routes["GET v1/me/items/energyDrinkSmall/preview"] = ok({
      effect: { kind: "condition", players: [{ playerId: "gk", before: 79, after: 94 }] },
      limits: { pointsToday: 0, pointsPerDay: 35 },
    });
    server.routes["POST v1/me/items/energyDrinkSmall/use"] = ok({
      itemCode: "energyDrinkSmall",
      target: { kind: "player", playerId: "gk" },
      effect: { kind: "condition", players: [{ playerId: "gk", before: 79, after: 94 }] },
      held: [{ quantity: 9 }],
    });
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${KEY}\\.boost`) }));

    const sheet = screen.getByRole("dialog", { name: `${KEY}.boostTitle` });
    const drink = await within(sheet).findByRole("button", {
      name: /online\.items\.energyDrinkSmall.*online\.items\.quick\.change:79\|94/,
    });
    await waitFor(() => expect(drink).toBeEnabled());
    fireEvent.click(drink);

    await waitFor(() =>
      expect(
        server.requests.filter((r) => r.segments.join("/") === "v1/me/items/energyDrinkSmall/use"),
      ).toHaveLength(1),
    );
    expect(screen.queryByRole("dialog", { name: /online\.items\.useTitle/ })).toBeNull();
    expect(await screen.findByText(/^online\.items\.used/)).toBeInTheDocument();
  });

  // Given the player's page,
  // when the coach opens the management menu from the app bar,
  // then the actions sheet offers the transfer and the personal actions.
  it("opens the management menu from the app bar", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: `${KEY}.manage` }));

    const sheet = await screen.findByRole("dialog", {
      name: "online.squad.phone.actionsTitle:Fischer",
    });
    expect(within(sheet).getByText("online.squad.phone.groupTransfer")).toBeInTheDocument();
    expect(
      within(sheet).getByRole("button", { name: /^online\.player\.release/ }),
    ).toBeInTheDocument();
    expect(
      within(sheet).getByRole("button", { name: /^squad\.jerseyPickerAction/ }),
    ).toBeInTheDocument();
  });
});
