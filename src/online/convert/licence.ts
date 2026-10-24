import type { TacticsLimits } from "../../components/tactics/licenceLimits";
import type { LicenceTableView, MyClubView } from "../api";
import type { LicenceControls } from "../api/rules";

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
