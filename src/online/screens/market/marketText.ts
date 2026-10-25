import type { TFunction } from "i18next";
import { formatExactMoney } from "../../../lib/valueFormatting";
import { resolveBackendError } from "../../../utils/backendI18n";
import type { QuoteRefusal } from "../../api";
import { OnlineApiError } from "../../errors";
import { formatMoment } from "../../format";

/** Parameters of the market's codes that are euros, and moments of the online calendar. */
const MONEY_PARAMS = new Set(["min", "max", "minimum", "amount", "price"]);
const MOMENT_PARAMS = new Set(["until", "kickoffAt"]);

function spelled(
  params: Record<string, string | number>,
  language: string,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(params)) {
    if (MONEY_PARAMS.has(name) && typeof value === "number") out[name] = formatExactMoney(value);
    else if (MOMENT_PARAMS.has(name) && typeof value === "string") {
      out[name] = formatMoment(value, language);
    } else out[name] = value;
  }
  return out;
}

/** A market code with its parameters as the player reads them: euros as money, moments as dates. */
export function marketCodeText(
  t: TFunction,
  language: string,
  code: string,
  params: Record<string, string | number>,
): string {
  return t(code, spelled(params, language));
}

/**
 * A failed market request as the player reads it (C-5 §3.5). The shared resolver would show the
 * market's euros and moments as bare numbers and ISO strings, so the market spells its own.
 */
export function marketErrorText(t: TFunction, language: string, error: unknown): string {
  if (error instanceof OnlineApiError && Object.keys(error.params).length > 0) {
    return marketCodeText(t, language, error.code, error.params);
  }
  return resolveBackendError(error);
}

/** Why a listing now would be refused, as the quote says it (C-5 C5-9). */
export function refusalText(t: TFunction, language: string, refusal: QuoteRefusal): string {
  return marketCodeText(t, language, refusal.code, refusal.params);
}
