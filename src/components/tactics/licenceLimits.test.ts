import { describe, expect, it } from "vitest";

import type { LicenceControls } from "../../bindings/core/rules";
import { licenceLock, type TacticsLimits } from "./licenceLimits";

const ALL_FORMATIONS = [
  "4-4-2",
  "4-3-3",
  "3-5-2",
  "4-5-1",
  "4-2-3-1",
  "3-4-3",
  "5-3-2",
  "4-1-4-1",
  "3-4-2-1",
];

function licence(tier: number, extra: Partial<LicenceControls>): LicenceControls {
  return { tier, formations: [], playStyles: [], dials: [], roles: [], ...extra };
}

const TABLE: LicenceControls[] = [
  licence(1, { formations: ["4-4-2", "4-3-3", "3-5-2"], playStyles: ["Balanced"] }),
  licence(2, {
    formations: ALL_FORMATIONS,
    playStyles: ["Balanced", "Counter"],
    dials: ["width"],
    roles: ["Poacher"],
  }),
  licence(3, {
    formations: ALL_FORMATIONS,
    playStyles: ["Balanced", "Counter"],
    dials: ["width", "break_speed"],
    roles: ["Poacher", "Mezzala"],
  }),
  licence(4, {
    formations: ALL_FORMATIONS,
    playStyles: ["Balanced", "Counter"],
    dials: ["width", "break_speed", "offside_trap"],
    roles: ["Poacher", "Mezzala", "False9"],
  }),
];

const firstLicence: TacticsLimits = {
  open: TABLE[0],
  table: TABLE,
  levels: { national: 2, continental: 4, elite: 7 },
};

describe("licenceLock", () => {
  // Given a first-licence coach,
  // when the board asks about a choice his licence opens and ones it does not,
  // then an open choice has no lock, and a closed one names the first licence that opens it and
  // the coach level it starts at.
  it("names the licence and level that open a closed choice", () => {
    expect(licenceLock(firstLicence, { kind: "formation", value: "4-3-3" })).toBeNull();
    expect(licenceLock(firstLicence, { kind: "formation", value: "4-2-3-1" })).toEqual({
      tier: 2,
      level: 2,
    });
    expect(licenceLock(firstLicence, { kind: "playStyle", value: "Counter" })).toEqual({
      tier: 2,
      level: 2,
    });
    expect(licenceLock(firstLicence, { kind: "dial", value: "break_speed" })).toEqual({
      tier: 3,
      level: 4,
    });
    expect(licenceLock(firstLicence, { kind: "role", value: "False9" })).toEqual({
      tier: 4,
      level: 7,
    });
  });

  // Given no limits (offline, the editor, a season without licences) and the Standard role,
  // when the board asks,
  // then nothing is locked.
  it("locks nothing without limits, and never the Standard role", () => {
    expect(licenceLock(undefined, { kind: "dial", value: "offside_trap" })).toBeNull();
    expect(licenceLock(firstLicence, { kind: "role", value: "Standard" })).toBeNull();
  });
});
