import type { TacticsLimits } from "../../components/tactics/licenceLimits";
import type { LicenceTableView, MyClubView } from "../api";
import type { Dial, LicenceControls } from "../api/rules";

/**
 * What the coach's licence closes on the tactics board (S-9 S9-15): his licence within the table
 * the server serves. None while the season has no licences or the table is not read yet; the
 * server still refuses a closed choice then.
 */
export function boardLimits(
  club: MyClubView,
  table: LicenceTableView | null,
): TacticsLimits | undefined {
  const licence = club.licence;
  if (!licence || !table?.levels) return undefined;
  const open = table.tiers.find((entry) => entry.tier === licence.tier);
  if (!open) return undefined;
  return { open, table: table.tiers, levels: table.levels };
}

/**
 * The orders of `kind` a side may give in this match (S-9 S9-6): `licence` is the side's as the
 * match kicked off (`MineView.licence`); none opens every one. `Standard` is always open.
 */
export function openInMatch<T extends string>(
  licence: LicenceControls | undefined,
  kind: "formation" | "playStyle" | "role",
  options: readonly T[],
): T[] {
  if (!licence) return [...options];
  const open: readonly string[] =
    kind === "formation"
      ? licence.formations
      : kind === "playStyle"
        ? licence.playStyles
        : licence.roles;
  return options.filter(
    (option) => (kind === "role" && option === "Standard") || open.includes(option),
  );
}

/** What a licence opens, by kind. */
export interface LicenceOpens {
  formations: string[];
  playStyles: string[];
  dials: Dial[];
  roles: string[];
}

/** One licence as a step of the coach's road: where it starts, what it holds, what it adds. */
export interface LicenceStep {
  tier: number;
  /** The coach level it starts at; `null` while no season has licences. */
  startsAt: number | null;
  totals: { formations: number; playStyles: number; dials: number; roles: number };
  /** What it opens that the licence before it did not (the first: all it opens). */
  added: LicenceOpens;
}

function startsAt(table: LicenceTableView, tier: number): number | null {
  const levels = table.levels;
  if (!levels) return null;
  if (tier >= 4) return levels.elite;
  if (tier === 3) return levels.continental;
  if (tier === 2) return levels.national;
  return 1;
}

/** The licence table as the road a coach climbs (his profile's roadmap). */
export function licenceSteps(table: LicenceTableView): LicenceStep[] {
  return table.tiers.map((licence, index) => {
    const before = table.tiers[index - 1];
    const fresh = <T extends string>(now: readonly T[], then: readonly T[] | undefined): T[] =>
      now.filter((item) => !then?.includes(item));
    return {
      tier: licence.tier,
      startsAt: startsAt(table, licence.tier),
      totals: {
        formations: licence.formations.length,
        playStyles: licence.playStyles.length,
        dials: licence.dials.length,
        roles: licence.roles.length,
      },
      added: {
        formations: fresh(licence.formations, before?.formations),
        playStyles: fresh(licence.playStyles, before?.playStyles),
        dials: fresh(licence.dials, before?.dials),
        roles: fresh(licence.roles, before?.roles),
      },
    };
  });
}
