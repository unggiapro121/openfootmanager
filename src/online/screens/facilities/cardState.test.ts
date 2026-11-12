import { describe, expect, it } from "vitest";
import type { FacilityBuildView, FacilityItemView } from "../../api";
import {
  buildClock,
  buildsOverTime,
  type CardContext,
  cardState,
  downgradeState,
  serverOffsetOf,
} from "./cardState";

function item(facility: string, extra: Partial<FacilityItemView> = {}): FacilityItemView {
  return {
    facility,
    level: 3,
    maxLevel: 16,
    cost: 1_000_000,
    buildDays: 2,
    upkeepDelta: 10_000,
    effects: [],
    lock: null,
    canDowngrade: true,
    downgradeEffects: [],
    downgradeUpkeepSaving: 5_000,
    ...extra,
  };
}

const STANDS_BUILD: FacilityBuildView = {
  facility: "stands",
  toLevel: 5,
  startedAt: "2026-11-13T10:00:00Z",
  endsAt: "2026-11-13T12:00:00Z",
  refundOnCancel: 300_000,
  skipsToFinish: 2,
  skipDays: 1,
};

/** The design brief's sample club (§11): 9,450,000 in cash, coach level 5. */
function brief(extra: Partial<CardContext> = {}): CardContext {
  return { view: { build: null, coachLevel: 5 }, cash: 9_450_000, writesOff: null, ...extra };
}

const MEDICAL = item("medical", { level: 7, cost: 4_000_000, lock: { coachLevel: 6 } });
const PARK = item("park", { level: 0, cost: 800_000 });
const TRAINING = item("training", { level: 6, cost: 15_000_000 });
const SHOP = item("shop", { level: 4, cost: 2_000_000 });

describe("a facility card's state (c-27 §5.4)", () => {
  // Given the brief's club and Medical at level 7 whose next level opens at coach level 6,
  // when its card is read,
  // then it is S4, naming the level it needs and the coach's own.
  it("locks a level the coach is short of (S4)", () => {
    expect(cardState(MEDICAL, brief())).toEqual({ kind: "coachLocked", coachLevel: 6, current: 5 });
  });

  // Given the Training ground at level 6, its next level at 15,000,000,
  // when the card is read with 9,450,000 in cash,
  // then it is S3, 5,550,000 short.
  it("says how much cash is short (S3)", () => {
    expect(cardState(TRAINING, brief())).toEqual({
      kind: "short",
      cost: 15_000_000,
      missing: 5_550_000,
    });
  });

  // Given a car park not built yet that the club can afford,
  // when its card is read,
  // then it is S2, to build at its cost.
  it("offers to build what is not built yet (S2)", () => {
    expect(cardState(PARK, brief())).toEqual({ kind: "unbuilt", cost: 800_000 });
  });

  // Given a shop the club can afford and nothing in its way,
  // when its card is read,
  // then it is S1.
  it("offers the next level (S1)", () => {
    expect(cardState(SHOP, brief())).toEqual({ kind: "ready", cost: 2_000_000 });
  });

  // Given the stands building,
  // when every card is read,
  // then the stands are S6, the others S5, but Medical stays S4: the coach's level comes first.
  it("shows the build on its own card and the builders busy on the others (S6, S5)", () => {
    const building = brief({ view: { build: STANDS_BUILD, coachLevel: 5 } });
    expect(cardState(item("stands"), building)).toEqual({ kind: "building", build: STANDS_BUILD });
    expect(cardState(SHOP, building)).toEqual({ kind: "builderBusy", busy: STANDS_BUILD });
    expect(cardState(TRAINING, building).kind).toBe("builderBusy");
    expect(cardState(MEDICAL, building).kind).toBe("coachLocked");
  });

  // Given a facility at its top level,
  // when its card is read, the coach short or not,
  // then it is S7.
  it("marks the top level (S7)", () => {
    expect(cardState(item("food", { cost: null, lock: { coachLevel: 9 } }), brief())).toEqual({
      kind: "top",
    });
  });

  // Given every write off, the economy paused or the club locked,
  // when the cards are read,
  // then S1–S5 give way to it, while a build under way and a top level stay as they are.
  it.each(["economy", "locked"] as const)("lets %s override S1–S5 but not S6 or S7", (reason) => {
    const off = brief({ writesOff: reason, view: { build: STANDS_BUILD, coachLevel: 5 } });
    for (const card of [MEDICAL, TRAINING, PARK, SHOP]) {
      expect(cardState(card, off)).toEqual({ kind: "writesOff", reason });
    }
    expect(cardState(item("stands"), off).kind).toBe("building");
    expect(cardState(item("food", { cost: null }), off).kind).toBe("top");
  });
});

describe("a card's downgrade (c-27 §5.4 S9, R27-2)", () => {
  // Given the academy,
  // when its menu is read,
  // then it has no downgrade at all.
  it("has none for the academy", () => {
    expect(downgradeState(item("academy"), { build: null }, null)).toEqual({ kind: "none" });
  });

  // Given a shop the server lets go down,
  // when its menu is read,
  // then the downgrade is open.
  it("opens when the server allows it", () => {
    expect(downgradeState(SHOP, { build: null, lineupLocked: false }, null)).toEqual({
      kind: "open",
    });
  });

  // Given, in turn, every write off, the facility itself building, a match's lineup lock and a
  // level the server says cannot go lower,
  // when the menu is read,
  // then the downgrade is off, with that reason, in that order.
  it("turns off with its reason", () => {
    const stands = item("stands");
    expect(downgradeState(stands, { build: STANDS_BUILD }, "locked")).toEqual({
      kind: "off",
      reason: "writesOff",
    });
    expect(downgradeState(stands, { build: STANDS_BUILD, lineupLocked: true }, null)).toEqual({
      kind: "off",
      reason: "building",
    });
    expect(downgradeState(SHOP, { build: STANDS_BUILD, lineupLocked: true }, null)).toEqual({
      kind: "off",
      reason: "lineupLocked",
    });
    expect(
      downgradeState(item("training", { canDowngrade: false }), { build: null }, null),
    ).toEqual({ kind: "off", reason: "atBottom" });
  });
});

describe("a build's clock (c-27 §5.2, R27-1)", () => {
  const at = (iso: string) => Date.parse(iso);

  // Given a two-hour build half-way through on the server's clock, this machine 60 s behind it,
  // when its clock is read,
  // then an hour is left and half the bar is filled.
  it("counts down on the server's time", () => {
    expect(buildClock(STANDS_BUILD, false, at("2026-11-13T10:59:00Z"), 60_000)).toEqual({
      kind: "running",
      secondsLeft: 3600,
      share: 0.5,
    });
  });

  // Given a build whose end has passed,
  // when its clock is read during a match's lineup lock, and then without one,
  // then it completes after the match, or it is due and the view is to be read again.
  it("waits for the match, or for the server, once its end has passed", () => {
    const after = at("2026-11-13T12:00:01Z");
    expect(buildClock(STANDS_BUILD, true, after, 0)).toEqual({ kind: "afterMatch" });
    expect(buildClock(STANDS_BUILD, false, after, 0)).toEqual({ kind: "due" });
  });

  // Given a view read with the server 90 s ahead, and one with no or an unreadable `serverNow`,
  // when the offset is taken,
  // then it is 90 s, and 0 for the others.
  it("takes the server's clock offset from the view", () => {
    const readAt = at("2026-11-13T10:00:00Z");
    expect(serverOffsetOf({ serverNow: "2026-11-13T10:01:30Z" }, readAt)).toBe(90_000);
    expect(serverOffsetOf({}, readAt)).toBe(0);
    expect(serverOffsetOf({ serverNow: "soon" }, readAt)).toBe(0);
  });
});

describe("whether a season builds facilities over time (c-27 §5.1)", () => {
  // Given a view with the stands among its items, one with items but no stands, and an old one,
  // when it is asked,
  // then only the first builds over time.
  it("is told by the stands", () => {
    expect(buildsOverTime({ facilities: [], items: [item("stands")] })).toBe(true);
    expect(buildsOverTime({ facilities: [], items: [item("training")] })).toBe(false);
    expect(buildsOverTime({ facilities: [] })).toBe(false);
    expect(buildsOverTime(null)).toBe(false);
  });
});
