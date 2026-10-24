import type { TFunction } from "i18next";

import type { Dial, LicenceControls, LicenceLevels } from "../../bindings/core/rules";

/**
 * What a coach's licence closes on the tactics board (online, phase 3 S-9). The server decides;
 * the board only shows a closed choice as closed, with the licence and coach level that open it.
 * Offline, in the world editor and in a season without licences there are no limits.
 */
export interface TacticsLimits {
  /** What the coach's licence opens. */
  open: LicenceControls;
  /** Every licence, the first to the highest, to name the one that opens a closed choice. */
  table: LicenceControls[];
  /** The coach levels the second, third and fourth licences start at. */
  levels: LicenceLevels;
}

/** A choice on the board a licence may close. */
export type TacticsChoice =
  | { kind: "formation"; value: string }
  | { kind: "playStyle"; value: string }
  | { kind: "dial"; value: Dial }
  | { kind: "role"; value: string };

/** The licence that opens a closed choice, and the coach level it starts at. */
export interface LicenceLock {
  tier: number;
  level: number;
}

function opens(licence: LicenceControls, choice: TacticsChoice): boolean {
  switch (choice.kind) {
    case "formation":
      return licence.formations.includes(choice.value);
    case "playStyle":
      return (licence.playStyles as string[]).includes(choice.value);
    case "dial":
      return licence.dials.includes(choice.value);
    case "role":
      return choice.value === "Standard" || (licence.roles as string[]).includes(choice.value);
  }
}

function startsAt(levels: LicenceLevels, tier: number): number {
  if (tier >= 4) return levels.elite;
  if (tier === 3) return levels.continental;
  if (tier === 2) return levels.national;
  return 1;
}

/** Why `choice` is closed to the coach, or `null` when he may make it. */
export function licenceLock(
  limits: TacticsLimits | undefined,
  choice: TacticsChoice,
): LicenceLock | null {
  if (!limits || opens(limits.open, choice)) return null;
  const opener = limits.table.find((licence) => opens(licence, choice));
  const tier = opener?.tier ?? limits.table.length;
  return { tier, level: startsAt(limits.levels, tier) };
}

/** "Opens with the National Pro licence, at coach level 2": why a choice is closed. */
export function lockHint(t: TFunction, lock: LicenceLock): string {
  return t("tactics.licence.lockedHint", {
    licence: t(`tactics.licence.tier_${lock.tier}`),
    level: lock.level,
  });
}

/** A closed choice in a list: its own label and the coach level that opens it. */
export function lockedOption(t: TFunction, option: string, lock: LicenceLock): string {
  return t("tactics.licence.lockedOption", { option, level: lock.level });
}
