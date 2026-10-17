import type { TFunction } from "i18next";

import nationRegions from "./nationRegions.generated.json";

const NATION_REGIONS: Readonly<Record<string, string>> = nationRegions;

/**
 * Localized region label, falling back to a humanized form of the region id
 * (or an explicit fallback name) when no translation exists.
 */
export function buildRegionLabel(t: TFunction, regionId: string, fallbackName?: string): string {
  return t(`teamSelect.regionLabels.${regionId}`, {
    defaultValue:
      fallbackName ??
      regionId
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" "),
  });
}

/** Confederation bucket for a country, used when no competition pins a team
 * to an authored region. Read from the backend nation catalog (see
 * `NATION_REGIONS_FIXTURE` in `nations.rs`), with the same Europe fallback as
 * its `region_for_code`. */
export function inferRegionId(countryCode: string): string {
  return NATION_REGIONS[countryCode] ?? "europe";
}
