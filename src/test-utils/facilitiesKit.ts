import type { FacilitiesView, FacilityItemView, FinanceView } from "../online/api";

/** The facilities screens' sample data (c-27 §12): the brief's club and its pieces. */

export function finance(overrides: Partial<FinanceView> = {}): FinanceView {
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

export function item(
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
export function view(overrides: Partial<FacilitiesView> = {}): FacilitiesView {
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

export const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();
export const anHourAgo = () => new Date(Date.now() - 3_600_000).toISOString();
export const building = (overrides: Partial<NonNullable<FacilitiesView["build"]>> = {}) => ({
  facility: "stands",
  toLevel: 4,
  startedAt: anHourAgo(),
  endsAt: inAnHour(),
  refundOnCancel: 1_000_000,
  skipsToFinish: 3,
  skipDays: 1,
  ...overrides,
});
