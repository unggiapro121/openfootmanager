import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHONE_QUERY } from "../../hooks/usePhoneLayout";
import { building, finance, view } from "../../test-utils/facilitiesKit";
import { fakeRealtime } from "../../test-utils/onlineMatchKit";
import {
  fakeServer,
  LEAGUE,
  myClub,
  ok,
  renderOnline,
  resetOnline,
  SEASON,
} from "../../test-utils/onlineTestKit";
import { VIEW_MODE_KEY } from "./facilities/map/viewMode";

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

let server: ReturnType<typeof fakeServer>;
let realtime: ReturnType<typeof fakeRealtime>;

function serve(facilities = view()) {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub()),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/me": ok({ id: "account-1" }),
    "GET v1/friendlies/mine": ok({}),
    "GET v1/clubs/mine/finance": ok(finance()),
    "GET v1/clubs/mine/facilities": ok(facilities),
  });
}

function phoneWindow() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === PHONE_QUERY,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

const MAP_LABEL = "online.facilities.map.label";
const findMap = () => screen.findByRole("application", { name: MAP_LABEL });
const level = (n: number) => `online.facilities.card.level:${n}`;
const label = (name: string, lvl: string) => `online.facilities.map.item:${name}|${lvl}`;
/** The world group the camera moves: the map's first group. */
const world = (map: HTMLElement) => map.querySelector("g") as SVGGElement;
const panel = (name: string) => screen.queryByRole("dialog", { name });

beforeEach(() => {
  resetOnline();
  window.localStorage.clear();
  window.sessionStorage.clear();
  realtime = fakeRealtime();
});
afterEach(() => {
  server?.restore();
  realtime.restore();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("OnlineFacilities: the campus map (c-27 §6)", () => {
  // Given a desktop and nothing remembered,
  // when the screen opens and the coach switches to the List,
  // then it opens on the map with the switch in the hero before it, shows the List after the
  // switch, and opens on the List the next time.
  it("opens on the map on a desktop and remembers the List", async () => {
    serve();
    const first = renderOnline("/online/facilities");
    const map = await findMap();
    const group = screen.getByRole("group", { name: "online.facilities.view.group" });
    expect(group.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryAllByRole("article")).toHaveLength(0);

    fireEvent.click(within(group).getByRole("button", { name: "online.facilities.view.list" }));
    expect(screen.queryByRole("application", { name: MAP_LABEL })).toBeNull();
    expect(screen.getAllByRole("article")).toHaveLength(7);
    expect(window.localStorage.getItem(VIEW_MODE_KEY)).toBe("list");

    first.unmount();
    renderOnline("/online/facilities");
    expect(await screen.findAllByRole("article")).toHaveLength(7);
    expect(screen.queryByRole("application", { name: MAP_LABEL })).toBeNull();
  });

  // Given a phone and nothing remembered,
  // when the screen opens and the coach presses the app bar's switch twice,
  // then it shows the List with one icon button to the map in the app bar (the page's name keeps
  // its room), then the map with a button back to the List, then the List again.
  it("opens on the List on a phone, with one switch button in the app bar", async () => {
    phoneWindow();
    serve();
    renderOnline("/online/facilities");
    expect(await screen.findAllByRole("article")).toHaveLength(7);
    const toMap = await screen.findByRole("button", { name: "online.facilities.view.showMap" });
    expect(toMap.closest("header")).not.toBeNull();
    expect(screen.queryByRole("group", { name: "online.facilities.view.group" })).toBeNull();

    fireEvent.click(toMap);
    expect(await findMap()).toBeTruthy();
    expect(screen.getByText("online.facilities.map.hintPhone")).toBeTruthy();
    const toList = screen.getByRole("button", { name: "online.facilities.view.showList" });
    expect(toList.closest("header")).not.toBeNull();
    fireEvent.click(toList);
    expect(screen.queryByRole("application", { name: MAP_LABEL })).toBeNull();
    expect(window.localStorage.getItem(VIEW_MODE_KEY)).toBe("list");
  });

  // Given the map,
  // when the coach walks it with Tab,
  // then the eight buildings come in the List's order, each named with its level, the one
  // being built saying so.
  it("walks the buildings in the List's order", async () => {
    serve(view({ build: building({ facility: "training", toLevel: 7 }) }));
    renderOnline("/online/facilities");
    const map = await findMap();

    const buildings = within(map).getAllByRole("button");
    expect(buildings.map((entry) => entry.getAttribute("aria-label"))).toEqual([
      label("online.facilities.name.stands", level(3)),
      label("online.facilities.name.shop", level(2)),
      label("online.facilities.name.food", level(1)),
      label("online.facilities.name.park", "online.facilities.card.unbuilt"),
      `online.facilities.map.itemBuilding:online.facilities.name.training|${level(6)}`,
      label("online.facilities.name.medical", level(7)),
      label("online.facilities.name.academy", level(5)),
      "online.facilities.section.trophies",
    ]);
    for (const entry of buildings) expect(entry).toHaveAttribute("tabindex", "0");
  });

  // Given the map,
  // when the coach picks the stands with Enter, then presses Esc,
  // then the stands' panel opens with the focus in it and the stands' card, and Esc shuts it
  // and gives the focus back to the stands.
  it("opens a building's panel with Enter and shuts it with Esc", async () => {
    serve();
    renderOnline("/online/facilities");
    const map = await findMap();
    const stands = within(map).getAllByRole("button")[0];

    stands.focus();
    fireEvent.keyDown(stands, { key: "Enter" });
    const opened = panel("online.facilities.section.stadium");
    expect(opened).not.toBeNull();
    expect(opened).toHaveAttribute("aria-modal", "false");
    expect(opened).toHaveFocus();
    expect(
      within(opened as HTMLElement).getByRole("article", {
        name: "online.facilities.name.stands",
      }),
    ).toBeTruthy();
    expect(stands).toHaveAttribute("aria-pressed", "true");

    fireEvent.keyDown(opened as HTMLElement, { key: "Escape" });
    expect(panel("online.facilities.section.stadium")).toBeNull();
    expect(stands).toHaveFocus();
  });

  // Given the map,
  // when the coach picks the academy with Space, and then the trophy room,
  // then each panel holds its own: the academy's card with its way to the academy, and the
  // trophy room's way to the honours.
  it("shows the academy's and the trophy room's ways out", async () => {
    serve();
    renderOnline("/online/facilities");
    const map = await findMap();
    const [academy, trophy] = within(map).getAllByRole("button").slice(6);

    fireEvent.keyDown(academy, { key: " " });
    const academyPanel = panel("online.facilities.name.academy") as HTMLElement;
    expect(
      within(academyPanel).getByRole("link", { name: "online.facilities.card.openAcademy" }),
    ).toHaveAttribute("href", "/online/academy");

    fireEvent.click(trophy);
    const trophyPanel = panel("online.facilities.section.trophies") as HTMLElement;
    expect(
      within(trophyPanel).getByRole("link", { name: "online.facilities.trophies.open" }),
    ).toHaveAttribute("href", "/online/honours");
    expect(panel("online.facilities.name.academy")).toBeNull();
  });

  // Given the map,
  // when the coach drags 10 px from a building and lets go on it, and then clicks it still,
  // then the drag picks nothing, moves the map and hides the hint for the session, and the click
  // picks the building.
  it("does not pick on a 10 px drag", async () => {
    serve();
    const first = renderOnline("/online/facilities");
    const map = await findMap();
    const shop = within(map).getAllByRole("button")[1];
    const before = world(map).getAttribute("transform");
    expect(screen.getByText("online.facilities.map.hint")).toBeTruthy();

    const at = { pointerId: 1, pointerType: "mouse", clientY: 100 };
    fireEvent.pointerDown(map, { ...at, clientX: 100 });
    fireEvent.pointerMove(map, { ...at, clientX: 110 });
    fireEvent.pointerUp(map, { ...at, clientX: 110 });
    fireEvent.click(shop);
    expect(panel("online.facilities.name.shop")).toBeNull();
    expect(world(map).getAttribute("transform")).not.toBe(before);
    expect(screen.queryByText("online.facilities.map.hint")).toBeNull();

    fireEvent.pointerDown(map, { ...at, clientX: 100 });
    fireEvent.pointerUp(map, { ...at, clientX: 100 });
    fireEvent.click(shop);
    expect(panel("online.facilities.name.shop")).not.toBeNull();

    first.unmount();
    renderOnline("/online/facilities");
    await findMap();
    expect(screen.queryByText("online.facilities.map.hint")).toBeNull();
  });

  // Given a map laid out 940 × 420 px and opened close in (scale 2.3),
  // when the coach drags 2,000 px to the right,
  // then the map stops where the campus ground's left edge meets the frame's.
  it("stops a drag at the ground's edge", async () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 940,
      bottom: 420,
      width: 940,
      height: 420,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    serve();
    renderOnline("/online/facilities");
    const map = await findMap();

    const at = { pointerId: 1, pointerType: "mouse", clientY: 100 };
    fireEvent.pointerDown(map, { ...at, clientX: 0 });
    fireEvent.pointerMove(map, { ...at, clientX: 2000 });
    fireEvent.pointerUp(map, { ...at, clientX: 2000 });
    // The ground's left edge (x −760) at scale 2.3 meets the frame's (x −470): −470 + 760 × 2.3.
    expect(world(map).getAttribute("transform")).toMatch(/^translate\(1278\.0,/);
  });

  // Given a wide map laid out 1,000 × 420 px at its whole-campus zoom, and less motion asked for,
  // when the coach picks the trophy room near the ground's right edge,
  // then it jumps to the middle of the part the side panel leaves, the ground held only to that
  // part; and once the panel shuts, the ground is held to the whole map again.
  it("centres a picked building beside the panel, even near the edge", async () => {
    vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(1000);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 1000,
      bottom: 420,
      width: 1000,
      height: 420,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query.includes("reduced-motion"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    serve();
    renderOnline("/online/facilities");
    const map = await findMap();
    const trophy = within(map).getByRole("button", { name: "online.facilities.section.trophies" });

    fireEvent.keyDown(trophy, { key: "Enter" });
    // Panel 440 px: the middle of the 560 px left is map x −220; the trophy room is at x 312.89.
    expect(world(map).getAttribute("transform")).toMatch(/^translate\(-557\.9,/);

    const opened = panel("online.facilities.section.trophies") as HTMLElement;
    fireEvent.click(within(opened).getByRole("button", { name: "online.facilities.map.close" }));
    // The whole frame again: the ground's right edge (x 760 × 1.08) meets the frame's (x 500).
    expect(world(map).getAttribute("transform")).toMatch(/^translate\(-320\.8,/);
  });

  // Given a map laid out 940 × 420 px, opened close in (scale 2.3), and less motion asked for,
  // when Tab reaches the stands, in sight, and then the trophy room, out of sight,
  // then the map stays put for the stands and brings the trophy room to its middle.
  it("brings a building tabbed to into sight", async () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 940,
      bottom: 420,
      width: 940,
      height: 420,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query.includes("reduced-motion"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    serve();
    renderOnline("/online/facilities");
    const map = await findMap();
    const start = world(map).getAttribute("transform");
    const [stands] = within(map).getAllByRole("button");
    const trophy = within(map).getByRole("button", { name: "online.facilities.section.trophies" });

    act(() => stands.focus());
    expect(world(map).getAttribute("transform")).toBe(start);
    act(() => trophy.focus());
    // The trophy room (x 312.89, y −13.71) to the frame's middle (x 0, y 10) at scale 2.3.
    expect(world(map).getAttribute("transform")).toMatch(/^translate\(-719\.6,41\.5\)/);
    expect(panel("online.facilities.section.trophies")).toBeNull();
  });

  // Given the stands' panel open with its card's menu open,
  // when the coach presses Esc in the menu,
  // then only the menu shuts; the panel stays.
  it("shuts a card's menu, not the panel, on Esc", async () => {
    serve();
    renderOnline("/online/facilities");
    const map = await findMap();
    fireEvent.keyDown(within(map).getAllByRole("button")[0], { key: "Enter" });
    const opened = panel("online.facilities.section.stadium") as HTMLElement;
    const more = within(opened).getByRole("button", { name: /^online\.facilities\.menu\.label/ });
    fireEvent.click(more);
    const menu = within(opened).getByRole("menu");

    fireEvent.keyDown(menu, { key: "Escape" });
    expect(within(opened).queryByRole("menu")).toBeNull();
    expect(panel("online.facilities.section.stadium")).not.toBeNull();
  });

  // Given the map,
  // when the wheel turns over the map, and then over the page outside it,
  // then the map zooms in and keeps the page from scrolling, and outside it nothing changes.
  it("zooms with the wheel only over the map", async () => {
    serve();
    renderOnline("/online/facilities");
    const map = await findMap();
    const before = world(map).getAttribute("transform");

    const wheel = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
    act(() => {
      map.dispatchEvent(wheel);
    });
    expect(wheel.defaultPrevented).toBe(true);
    const zoomed = world(map).getAttribute("transform");
    expect(zoomed).not.toBe(before);

    const outside = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
    act(() => {
      document.body.dispatchEvent(outside);
    });
    expect(outside.defaultPrevented).toBe(false);
    expect(world(map).getAttribute("transform")).toBe(zoomed);
  });

  // Given the map zoomed in,
  // when the coach presses zoom out and then "back to the middle",
  // then the zoom goes down and then back to where the map opened.
  it("zooms with the buttons and goes back to the middle", async () => {
    serve();
    renderOnline("/online/facilities");
    const map = await findMap();
    const start = world(map).getAttribute("transform");
    const zoom = screen.getByRole("group", { name: "online.facilities.map.zoom" });

    fireEvent.click(within(zoom).getByRole("button", { name: "online.facilities.map.zoomIn" }));
    const inScale = world(map).getAttribute("transform");
    expect(inScale).not.toBe(start);
    fireEvent.click(within(zoom).getByRole("button", { name: "online.facilities.map.zoomOut" }));
    expect(world(map).getAttribute("transform")).toBe(start);
    fireEvent.click(within(zoom).getByRole("button", { name: "online.facilities.map.zoomIn" }));
    fireEvent.click(within(zoom).getByRole("button", { name: "online.facilities.map.reset" }));
    expect(world(map).getAttribute("transform")).toBe(start);
  });

  // Given the sold-out mail's way to the stands,
  // when the screen opens at #stands on the map,
  // then the stands' panel is open.
  it("opens the stands' panel from #stands", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    serve();
    renderOnline("/online/facilities#stands");
    await findMap();
    await waitFor(() => expect(panel("online.facilities.section.stadium")).not.toBeNull());
    expect(scroll).toHaveBeenCalled();
  });

  // Given the legend,
  // then it names each dot in words.
  it("names each dot in the legend", async () => {
    serve();
    renderOnline("/online/facilities");
    await findMap();
    for (const status of ["building", "upgradable", "waiting", "top"]) {
      expect(screen.getByText(`online.facilities.map.legend.${status}`)).toBeTruthy();
    }
  });
});
