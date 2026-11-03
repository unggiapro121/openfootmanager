import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHONE_QUERY } from "../../../hooks/usePhoneLayout";
import { fakeRealtime } from "../../../test-utils/onlineMatchKit";
import {
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
import type { MyClubView } from "../../api";

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

const KEY = "online.squad.phone";

/** A keeper and a defender in the eleven; a midfielder and a hurt forward on the bench. */
const PLAYERS = [
  squadPlayer({
    id: "gk",
    matchName: "Fischer",
    fullName: "Leon Fischer",
    position: "Goalkeeper",
    naturalPosition: "Goalkeeper",
    ovr: 69,
    age: 22,
    condition: 59,
    shirtNumber: 13,
  }),
  squadPlayer({
    id: "lb",
    matchName: "Nhân Lucas",
    fullName: "Nhân Lucas",
    position: "Defender",
    naturalPosition: "LeftBack",
    alternatePositions: ["LeftWingBack", "CenterBack"],
    ovr: 82,
    age: 24,
    shirtNumber: 2,
  }),
  squadPlayer({
    id: "cm",
    matchName: "Hoàng Đức",
    fullName: "Nguyễn Hoàng Đức",
    position: "Midfielder",
    naturalPosition: "CentralMidfielder",
    ovr: 74,
    age: 19,
    shirtNumber: 14,
    season: { appearances: 1, goals: 0, assists: 0, avgRating: 6.5 },
  }),
  squadPlayer({
    id: "st",
    matchName: "Việt Anh",
    fullName: "Việt Anh",
    position: "Forward",
    naturalPosition: "Striker",
    ovr: 64,
    age: 20,
    shirtNumber: 19,
    injury: { name: "Hamstring", daysRemaining: 4 },
  }),
];

let server: ReturnType<typeof fakeServer>;
let realtime: ReturnType<typeof fakeRealtime>;

function serve(overrides: Partial<MyClubView> = {}, selling: unknown[] = []) {
  const club = myClub({ players: PLAYERS, ...overrides });
  club.setup = { ...club.setup, startingXiIds: ["gk", "lb"] };
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(club),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/friendlies/mine": ok({}),
    "GET v1/clubs/mine/market": ok({ selling, holding: [], recent: [] }),
    "GET v1/me/coins": fail(404, "be.error.notFound"),
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
  localStorage.clear();
});

const where = () => screen.getByLabelText("location").textContent;
const list = () => screen.getByRole("list", { name: `${KEY}.list` });
const row = (name: string) =>
  within(list()).getByRole("button", { name: new RegExp(`^${KEY}\\.row\\w+:${name}\\|`) });
const rowNames = () =>
  within(list())
    .getAllByRole("button")
    .map((button) => /:([^|]+)\|/.exec(button.getAttribute("aria-label") ?? "")?.[1]);

async function open() {
  renderOnline("/online/squad");
  return screen.findByRole("list", { name: `${KEY}.list` });
}

describe("the squad on a phone", () => {
  // Given a club of four, two of them in the eleven,
  // when the squad opens on a phone,
  // then it is a list, not the desktop table: the eleven under one heading and the bench under
  // another, each player a row to tap.
  it("lists the eleven and the bench apart", async () => {
    serve();
    await open();

    expect(screen.queryByRole("table")).toBeNull();
    expect(within(list()).getByText(`${KEY}.sectionXi:2`)).toBeInTheDocument();
    expect(within(list()).getByText(`${KEY}.sectionBench:2`)).toBeInTheDocument();
    expect(rowNames()).toEqual(["Fischer", "Nhân Lucas", "Hoàng Đức", "Việt Anh"]);
    expect(row("Fischer")).toHaveAccessibleName(/^online\.squad\.phone\.rowStarter:/);
    expect(row("Hoàng Đức")).toHaveAccessibleName(/^online\.squad\.phone\.rowBench:/);
  });

  // Given the squad,
  // when the coach picks the bench, then the defenders,
  // then each tab counts its players, and the list keeps only those who match both.
  it("filters by status and by line", async () => {
    serve();
    await open();
    const status = screen.getByRole("tablist", { name: "common.status" });

    expect(within(status).getByRole("tab", { name: /squad\.starter 2/ })).toBeInTheDocument();
    expect(within(status).getByRole("tab", { name: /common\.injured 1/ })).toBeInTheDocument();
    fireEvent.click(within(status).getByRole("tab", { name: /squad\.benchOption/ }));
    expect(rowNames()).toEqual(["Hoàng Đức", "Việt Anh"]);
    fireEvent.click(screen.getByRole("tab", { name: /common\.all 4/ }));
    fireEvent.click(screen.getByRole("button", { name: "online.market.group.Defender" }));
    expect(rowNames()).toEqual(["Nhân Lucas"]);
  });

  // Given the squad,
  // when the coach opens the search from the app bar and types part of a name,
  // then only that player is left.
  it("searches by name from the app bar", async () => {
    serve();
    await open();
    fireEvent.click(screen.getByRole("button", { name: `${KEY}.searchToggle` }));
    fireEvent.change(screen.getByRole("searchbox", { name: `${KEY}.searchLabel` }), {
      target: { value: "lucas" },
    });
    expect(rowNames()).toEqual(["Nhân Lucas"]);
  });

  // Given the squad read through its condition,
  // when the coach switches to growth,
  // then the two columns are age and potential.
  it("switches what the two columns show", async () => {
    serve();
    await open();
    const lenses = screen.getByRole("radiogroup", { name: `${KEY}.lens` });
    expect(within(row("Fischer")).getByText("59%")).toBeInTheDocument();

    fireEvent.click(within(lenses).getByRole("radio", { name: `${KEY}.lensGrowth` }));
    expect(screen.getByText("common.age")).toBeInTheDocument();
    expect(within(row("Hoàng Đức")).getByText("19")).toBeInTheDocument();
  });

  // Given the squad,
  // when the coach sorts by OVR,
  // then the list is strongest first, without the eleven/bench headings.
  it("sorts by overall", async () => {
    serve();
    await open();
    fireEvent.change(screen.getByRole("combobox", { name: `${KEY}.sort` }), {
      target: { value: "ovr" },
    });
    expect(rowNames()).toEqual(["Nhân Lucas", "Hoàng Đức", "Fischer", "Việt Anh"]);
    expect(within(list()).queryByText(/sectionXi/)).toBeNull();
  });

  // Given the squad,
  // when the coach taps a player,
  // then his sheet rises with his number, age and status, and it leads to his full profile.
  it("opens a player's sheet and his full profile", async () => {
    serve();
    await open();
    fireEvent.click(row("Nhân Lucas"));
    const sheet = screen.getByRole("dialog", { name: "Nhân Lucas" });
    expect(within(sheet).getByText(`${KEY}.sheetLine:2|24`)).toBeInTheDocument();
    expect(within(sheet).getByText("squad.starter")).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole("link", { name: `${KEY}.fullProfile` }));
    await waitFor(() => expect(where()).toBe("/online/squad/lb"));
  });

  // Given a player's sheet,
  // when the coach opens his actions and picks the release,
  // then every action the full profile has is offered, and the release asks to confirm.
  it("offers the player's actions and opens the one picked", async () => {
    serve();
    await open();
    fireEvent.click(row("Nhân Lucas"));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Nhân Lucas" })).getByRole("button", {
        name: `${KEY}.actions`,
      }),
    );

    const actions = await screen.findByRole("dialog", { name: `${KEY}.actionsTitle:Nhân Lucas` });
    for (const name of [
      "online.market.list",
      "online.player.release",
      "squad.jerseyPickerAction",
      "online.player.avatarChange",
      "online.player.nationalityChange",
      "online.rename.open",
    ]) {
      expect(await within(actions).findByRole("button", { name })).toBeInTheDocument();
    }
    fireEvent.click(within(actions).getByRole("button", { name: "online.player.release" }));

    expect(
      screen.getByRole("dialog", { name: "online.player.releaseTitle:Nhân Lucas" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: `${KEY}.actionsTitle:Nhân Lucas` })).toBeNull();
  });

  // Given a player up for auction,
  // when the coach opens his actions,
  // then they lead to his auction, and what the server would refuse while he is listed is gone.
  it("leads a listed player's actions to his auction", async () => {
    serve({}, [{ id: "a-9", playerId: "lb" }]);
    await open();
    fireEvent.click(row("Nhân Lucas"));
    fireEvent.click(screen.getByRole("button", { name: `${KEY}.actions` }));

    const actions = await screen.findByRole("dialog", { name: `${KEY}.actionsTitle:Nhân Lucas` });
    const listed = await within(actions).findByRole("link", { name: "online.market.listed" });
    expect(listed).toHaveAttribute("href", "/online/auctions/a-9");
    expect(within(actions).queryByRole("button", { name: "online.player.release" })).toBeNull();
    expect(within(actions).queryByRole("button", { name: "online.rename.open" })).toBeNull();
    expect(
      within(actions).getByRole("button", { name: "squad.jerseyPickerAction" }),
    ).toBeInTheDocument();
  });

  // Given a player's sheet,
  // when the coach closes it with Escape,
  // then it is gone and the list is there.
  it("closes the sheet with Escape", async () => {
    serve();
    await open();
    fireEvent.click(row("Fischer"));
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Fischer" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Fischer" })).toBeNull();
  });

  // Given the hint to turn the phone for the full table,
  // when the coach hides it,
  // then it stays hidden the next time the squad opens.
  it("remembers a hidden rotate hint", async () => {
    serve();
    const { unmount } = renderOnline("/online/squad");
    await screen.findByRole("list", { name: `${KEY}.list` });
    fireEvent.click(screen.getByRole("button", { name: `${KEY}.hideRotate` }));
    expect(screen.queryByText(`${KEY}.rotateHint`)).toBeNull();
    unmount();

    renderOnline("/online/squad");
    await screen.findByRole("list", { name: `${KEY}.list` });
    expect(screen.queryByText(`${KEY}.rotateHint`)).toBeNull();
  });

  // Given a club whose eleven the assistant picks,
  // when the squad opens,
  // then a line says so and leads to the tactics.
  it("says when the assistant picks the eleven", async () => {
    serve({ xiAssistant: true });
    await open();
    fireEvent.click(screen.getByRole("link", { name: /online\.squad\.phone\.assistant/ }));
    await waitFor(() => expect(where()).toBe("/online/tactics"));
  });
});
