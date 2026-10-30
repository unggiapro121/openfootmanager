import type { TFunction } from "i18next";
import { resolveBackendError } from "../../../utils/backendI18n";
import type { ItemCapsView, ItemEffectView, ItemNumbersView, ItemTarget } from "../../api";
import { OnlineApiError } from "../../errors";
import { formatMoment } from "../../format";

/**
 * The words of the coach's items (C-7 §17): their names, the groups the inventory shows them in,
 * what each is used on, and the item codes' errors with their parameters spelled. Every rule is
 * the server's; these tables only say how a code is shown and which target picker it opens.
 */

/** The inventory's groups, in the order shown (C-7 C7-13); a code this build does not know is `other`. */
export const ITEM_GROUPS = [
  "condition",
  "medical",
  "tactics",
  "custom",
  "academy",
  "other",
] as const;
export type ItemGroup = (typeof ITEM_GROUPS)[number];

/** What an item used through the use route is used on (S-17 §3.1). */
export type TargetKind = ItemTarget["kind"];

interface Known {
  group: ItemGroup;
  /** Absent: the item is spent elsewhere (a rename, the academy), never through the use route. */
  target?: TargetKind;
}

const KNOWN: Record<string, Known> = {
  energyDrinkSmall: { group: "condition", target: "player" },
  energyDrinkLarge: { group: "condition", target: "player" },
  teamRecoveryPack: { group: "condition", target: "club" },
  medkitBandage: { group: "medical", target: "player" },
  medkitAdvanced: { group: "medical", target: "player" },
  tacticalNoteBasic: { group: "tactics", target: "style" },
  tacticalNoteAdvanced: { group: "tactics", target: "style" },
  tacticalNoteMaster: { group: "tactics", target: "style" },
  xpBoosterX2: { group: "tactics", target: "account" },
  playerRename: { group: "custom" },
  clubRename: { group: "custom" },
  scoutExpedition: { group: "academy" },
  scoutExpeditionElite: { group: "academy" },
  timeSkip: { group: "academy" },
};

export function groupOf(code: string): ItemGroup {
  return KNOWN[code]?.group ?? "other";
}

/** What the item is used on, when it is used through the use route. */
export function targetKindOf(code: string): TargetKind | undefined {
  return KNOWN[code]?.target;
}

/** A medkit's target must be injured; the picker dims the others (C-7 C7-29). */
export function isMedkit(code: string): boolean {
  return KNOWN[code]?.group === "medical";
}

/** An item code's name; a code this build does not know is shown as it is (E6-15). */
export function itemName(t: TFunction, code: string): string {
  return t(`online.items.${code}.name`, { defaultValue: code });
}

export function itemDescription(t: TFunction, code: string): string {
  return t(`online.items.${code}.description`, { defaultValue: "" });
}

const DAILY_LIMIT = "be.error.inventory.dailyLimitReached";

/** Parameters of the item codes that are moments of the online calendar. */
const MOMENT_PARAMS = new Set(["kickoffAt", "nextAt"]);
/** Codes whose one parameter names a case, each case said by its own sentence (C-7 C7-33). */
const CASES: Record<string, { param: string; known: Set<string> }> = {
  "be.error.inventory.wrongTarget": {
    param: "reason",
    known: new Set(["conditionFull", "notInjured", "atCap", "wrongTier"]),
  },
  "be.error.inventory.notUsableHere": { param: "use", known: new Set(["rename", "academy"]) },
  "be.error.shop.notUsableNow": { param: "needs", known: new Set(["items", "academy"]) },
};

/**
 * An item code with its parameters as the player reads them: a reason or a use by its own
 * sentence, moments as dates. A case this build does not know falls back to the code's own
 * sentence, which every code has.
 */
export function itemCodeText(
  t: TFunction,
  language: string,
  code: string,
  params: Record<string, string | number>,
): string {
  // A cap in condition points (S-28 S28-8) says how many points are left today.
  if (code === DAILY_LIMIT && params.pointsLeft !== undefined) {
    const time = typeof params.nextAt === "string" ? formatMoment(params.nextAt, language) : "";
    return t("online.items.dailyLimitPoints", { pointsLeft: params.pointsLeft, nextAt: time });
  }
  const cases = CASES[code];
  if (cases) {
    const value = params[cases.param];
    if (typeof value === "string" && cases.known.has(value)) {
      return t(`online.items.${cases.param}.${value}`);
    }
  }
  const spelled: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(params)) {
    spelled[name] =
      MOMENT_PARAMS.has(name) && typeof value === "string" ? formatMoment(value, language) : value;
  }
  return t(code, spelled);
}

/** A failed item or shop request as the player reads it. */
export function itemsErrorText(t: TFunction, language: string, error: unknown): string {
  if (error instanceof OnlineApiError && error.code.startsWith("be.error.")) {
    return itemCodeText(t, language, error.code, error.params);
  }
  return resolveBackendError(error);
}

/** What an item does in the season under way, from the ruleset's numbers (C-7 §17.4). */
export function effectText(t: TFunction, effect: ItemNumbersView): string[] {
  const out: string[] = [];
  if (effect.condition !== undefined)
    out.push(t("online.shop.effect.condition", { n: effect.condition }));
  if (effect.reduceDays !== undefined) {
    out.push(
      effect.cureAtMost !== undefined
        ? t("online.shop.effect.cure", { days: effect.reduceDays, cure: effect.cureAtMost })
        : t("online.shop.effect.days", { days: effect.reduceDays }),
    );
  }
  if (
    effect.xp !== undefined &&
    effect.masteryFrom !== undefined &&
    effect.masteryUntil !== undefined
  ) {
    out.push(
      t("online.shop.effect.note", {
        xp: effect.xp,
        from: effect.masteryFrom,
        to: effect.masteryUntil - 1,
      }),
    );
  }
  if (effect.matches !== undefined)
    out.push(t("online.shop.effect.matches", { n: effect.matches }));
  return out;
}

/** How often it may be used, from the ruleset's caps. */
export function capsText(t: TFunction, caps: ItemCapsView): string[] {
  const out: string[] = [];
  if (caps.pointsPerPlayerDay !== undefined)
    out.push(t("online.shop.caps.pointsPerPlayerDay", { n: caps.pointsPerPlayerDay }));
  if (caps.perPlayerDay !== undefined)
    out.push(t("online.shop.caps.perPlayerDay", { n: caps.perPlayerDay }));
  if (caps.perClubDay !== undefined)
    out.push(t("online.shop.caps.perClubDay", { n: caps.perClubDay }));
  if (caps.xpPerStyleSeason !== undefined) {
    out.push(t("online.shop.caps.xpPerStyleSeason", { n: caps.xpPerStyleSeason }));
  }
  if (caps.maxMatches !== undefined)
    out.push(t("online.shop.caps.maxMatches", { n: caps.maxMatches }));
  return out;
}

/**
 * The condition each player would lose to the cap of 100 (C-12 C12-7, Qe54-3): the drink's label
 * less what the preview says he gains. Only players who lose some are listed.
 */
export function pointsLost(
  effect: ItemEffectView | undefined,
  label: number | undefined,
): { playerId: string; lost: number }[] {
  if (effect?.kind !== "condition" || label === undefined) return [];
  return effect.players
    .map((change) => ({ playerId: change.playerId, lost: label - (change.after - change.before) }))
    .filter((line) => line.lost > 0);
}

/** Where an entry of the item history came from; a source this build does not know as it is. */
export function sourceText(t: TFunction, source: string): string {
  return t(`online.inventory.source.${source}`, { defaultValue: source });
}
