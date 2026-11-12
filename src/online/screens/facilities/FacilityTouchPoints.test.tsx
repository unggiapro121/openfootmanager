import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FacilitiesView, FinanceView } from "../../api";
import { fakeRealtime } from "../../../test-utils/onlineMatchKit";
import {
  fakeServer,
  LEAGUE,
  myClub,
  ok,
  renderOnline,
  resetOnline,
  SEASON,
} from "../../../test-utils/onlineTestKit";
import { setFacilities, useOnlineStore } from "../../store/onlineStore";
import { FacilitiesOverviewChips } from "./FacilityTouchPoints";

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

const FINANCE: FinanceView = {
  economy: true,
  cash: 9_450_000,
  held: 0,
  locked: false,
  season: [],
  weeklyWageBill: 0,
  arrearsDaysToForcedListing: 3,
};

const STANDS = {
  facility: "stands",
  level: 3,
  maxLevel: 16,
  cost: 2_000_000,
  buildDays: 3,
  upkeepDelta: 0,
  effects: [],
  lock: null,
  canDowngrade: true,
  downgradeEffects: [],
  downgradeUpkeepSaving: 0,
};

function overTime(overrides: Partial<FacilitiesView> = {}): FacilitiesView {
  return {
    facilities: [{ facility: "training", level: 1, maxLevel: 10, cost: 1, effects: [] }],
    items: [STANDS],
    capacity: 9_000,
    upkeepPerSeason: 1_200_000,
    build: null,
    lastCompleted: null,
    serverNow: new Date().toISOString(),
    ...overrides,
  };
}

const build = {
  facility: "stands",
  toLevel: 4,
  startedAt: new Date(Date.now() - 60_000).toISOString(),
  endsAt: new Date(Date.now() + 3_600_000).toISOString(),
  refundOnCancel: 1,
  skipsToFinish: 1,
  skipDays: 1,
};

let realtime: ReturnType<typeof fakeRealtime>;
let restore: (() => void) | undefined;

beforeEach(() => {
  resetOnline();
  window.localStorage.clear();
  realtime = fakeRealtime();
});
afterEach(() => {
  restore?.();
  realtime.restore();
});

function serveFinance(facilities: FacilitiesView) {
  restore = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub()),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/me": ok({ id: "account-1" }),
    "GET v1/friendlies/mine": ok({}),
    "GET v1/clubs/mine/finance": ok(FINANCE),
    "GET v1/clubs/mine/market": ok({ selling: [], holding: [], recent: [] }),
    "GET v1/clubs/mine/facilities": ok(facilities),
    "GET v1/clubs/mine/ledger": ok({ items: [] }),
  }).restore;
}

describe("Finance's facilities (c-27 §5.8, C27-9)", () => {
  // Given a season that builds over time, with the stands building,
  // when the finance page opens,
  // then it links to the facilities screen with the build and the upkeep, and has no upgrade
  // card of its own.
  it("links to the facilities screen in a season that builds over time", async () => {
    serveFinance(overTime({ build }));
    renderOnline("/online/finance");

    const link = await screen.findByRole("link", { name: /online\.nav\.facilities/ });
    expect(link).toHaveAttribute("href", "/online/facilities");
    expect(link.textContent).toContain(
      "online.facilities.touch.building:online.facilities.name.stands|4|",
    );
    expect(link.textContent).toMatch(/online\.facilities\.hero\.upkeep:.*1\.2M/);
    expect(screen.queryByText("finances.facilities")).toBeNull();
  });

  // Given a season whose facilities upgrade at once,
  // when the finance page opens,
  // then it keeps its upgrade card and no link.
  it("keeps its upgrade card in a season that upgrades at once", async () => {
    serveFinance({ facilities: overTime().facilities });
    renderOnline("/online/finance");

    expect(await screen.findByText("finances.facilities")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /online\.nav\.facilities/ })).toBeNull();
  });
});

describe("the overview's facilities chips (c-27 §5.8)", () => {
  const renderChips = () =>
    render(
      <MemoryRouter>
        <FacilitiesOverviewChips />
      </MemoryRouter>,
    );

  // Given a build under way,
  // when the overview shows,
  // then a chip names it and leads to the screen.
  it("names the build under way", () => {
    setFacilities(overTime({ build }));
    renderChips();
    const chip = screen.getByRole("link");
    expect(chip.textContent).toContain("online.facilities.touch.chipBuilding:");
    expect(chip).toHaveAttribute("href", "/online/facilities");
  });

  // Given a build completed an hour ago and not seen, then one a day and more ago,
  // when the overview shows,
  // then the first has a chip and the second none.
  it("names a completion of the last day not seen yet", () => {
    useOnlineStore.setState({ club: myClub() });
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    setFacilities(
      overTime({ lastCompleted: { facility: "stands", level: 4, completedAt: hourAgo } }),
    );
    const first = renderChips();
    expect(screen.getByRole("link").textContent).toContain(
      "online.facilities.touch.chipDone:online.facilities.name.stands|4",
    );
    first.unmount();

    const dayAgo = new Date(Date.now() - 25 * 3_600_000).toISOString();
    setFacilities(
      overTime({ lastCompleted: { facility: "stands", level: 4, completedAt: dayAgo } }),
    );
    renderChips();
    expect(screen.queryByRole("link")).toBeNull();
  });

  // Given a season that upgrades at once,
  // when the overview shows,
  // then there is no chip.
  it("has nothing in a season that upgrades at once", () => {
    setFacilities({ facilities: [] });
    const { container } = renderChips();
    expect(container.textContent).toBe("");
  });
});
