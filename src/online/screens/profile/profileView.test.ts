import { describe, expect, it } from "vitest";
import type { InventoryView, StyleMasteryView } from "../../api";
import { masteryInOrder, notebooks, strongestStyle, tierState } from "./profileView";

const style = (name: string, level: number): StyleMasteryView => ({
  style: name,
  level,
  xp: 0,
  xpToNext: 100,
  matches: 0,
  effects: [],
});

describe("strongestStyle and masteryInOrder", () => {
  // Given styles with a tie at the top, then the first of the tie is the strongest and the
  // order puts the highest levels first, a tie in the server's order.
  it("orders the styles strongest first", () => {
    const mastery = [style("Balanced", 51), style("Attacking", 76), style("Counter", 76)];
    expect(strongestStyle(mastery)?.style).toBe("Attacking");
    expect(masteryInOrder(mastery).map((one) => one.style)).toEqual([
      "Attacking",
      "Counter",
      "Balanced",
    ]);
    expect(strongestStyle([])).toBeUndefined();
  });
});

describe("tierState", () => {
  // Given the second licence held, then the first is passed, the second held, the third ahead;
  // and with none held every licence is ahead.
  it("places a licence against the one held", () => {
    expect([1, 2, 3].map((tier) => tierState(tier, 2))).toEqual(["passed", "held", "ahead"]);
    expect(tierState(1, 0)).toBe("ahead");
  });
});

describe("notebooks", () => {
  const inventory = (overrides: Partial<InventoryView> = {}): InventoryView => ({
    lines: [{ itemCode: "tacticalNoteMaster", powerClass: "high", total: 2, stacks: [] }],
    locked: false,
    limits: { notes: [], xpX2: { remaining: 0, max: 10 } } as never,
    ...overrides,
  });

  // Given item rules, then every notebook is counted, none held at zero; without rules, locked,
  // or unread, none.
  it("counts the notebooks only while they may be used", () => {
    expect(notebooks(inventory())).toEqual([
      { code: "tacticalNoteBasic", total: 0 },
      { code: "tacticalNoteAdvanced", total: 0 },
      { code: "tacticalNoteMaster", total: 2 },
    ]);
    expect(notebooks(inventory({ limits: undefined }))).toBeUndefined();
    expect(notebooks(inventory({ locked: true }))).toBeUndefined();
    expect(notebooks(undefined)).toBeUndefined();
  });
});
