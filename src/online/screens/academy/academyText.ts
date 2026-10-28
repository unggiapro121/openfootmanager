import type { TFunction } from "i18next";
import { formatExactMoney } from "../../../lib/valueFormatting";
import { resolveBackendError } from "../../../utils/backendI18n";
import type { QuoteRefusal } from "../../api";
import { OnlineApiError } from "../../errors";
import { formatMoment } from "../../format";

/** The regions a trip may go to: the fork's `REGIONS` (C-7 §18.1). */
export const SCOUT_REGIONS = ["AsiaSoutheast", "AsiaEast", "Europe", "Americas"] as const;
/** What a trip looks for: the fork's `ScoutFocus`, the balanced one first. */
export const SCOUT_FOCI = ["Balanced", "Physical", "Technical"] as const;
/** How a trip is paid: club money, or one of the two tickets. */
export const SCOUT_PAYS = ["scoutExpedition", "cash", "scoutExpeditionElite"] as const;
export type ScoutPay = (typeof SCOUT_PAYS)[number];

/** Parameters of the academy's codes that are moments, and euros. */
const MOMENT_PARAMS = new Set(["readyAt"]);
const MONEY_PARAMS = new Set(["fee"]);

/**
 * An academy code with its parameters as the player reads them (C-7 C7-50): moments as dates,
 * money as euros. `tripId` is never shown: no sentence names it.
 */
export function academyCodeText(
  t: TFunction,
  language: string,
  code: string,
  params: Record<string, string | number>,
): string {
  const spelled: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(params)) {
    if (name === "tripId") continue;
    if (MOMENT_PARAMS.has(name) && typeof value === "string") {
      spelled[name] = formatMoment(value, language);
    } else if (MONEY_PARAMS.has(name) && typeof value === "number") {
      spelled[name] = formatExactMoney(value);
    } else spelled[name] = value;
  }
  return t(code, spelled);
}

/** A failed academy request as the player reads it. */
export function academyErrorText(t: TFunction, language: string, error: unknown): string {
  if (error instanceof OnlineApiError && error.code.startsWith("be.error.")) {
    return academyCodeText(t, language, error.code, error.params);
  }
  return resolveBackendError(error);
}

/** Why a trip sent now would be refused, as the quote says it. */
export function academyRefusalText(t: TFunction, language: string, refusal: QuoteRefusal): string {
  return academyCodeText(t, language, refusal.code, refusal.params);
}

/** A region's name in the player's language; one this build does not know as it is. */
export function regionName(t: TFunction, region: string): string {
  return t(`online.academy.region.${region}`, { defaultValue: region });
}

export function scoutFocusName(t: TFunction, focus: string): string {
  return t(`online.academy.focus.${focus}`, { defaultValue: focus });
}

/** How a trip was paid, said in a few words. */
export function payName(t: TFunction, pay: string): string {
  return t(`online.academy.pay.${pay}`, { defaultValue: pay });
}

/**
 * How well the academy knows a youngster (P4-D26): 0 when he came, then one step each, never with
 * a number of days, as the ruleset sets them (C-7 §18.6, PO bản 4).
 */
export function revealName(t: TFunction, level: number): string {
  const step = Math.max(0, Math.min(2, level));
  return t(`online.academy.reveal.${step}`);
}
