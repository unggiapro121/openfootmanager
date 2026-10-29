import type { TFunction } from "i18next";
import { resolveBackendError } from "../../../utils/backendI18n";
import type { EventsView, LevelRange, RewardView } from "../../api";
import { OnlineApiError } from "../../errors";
import { formatCoins } from "../../format";
import { itemCodeText, itemName } from "../items/itemText";

/**
 * The words of the coach's events (C-7 §19): an event's name by its theme, a mission's sentence by
 * its kind and target, the lines under it, why a reward lapsed, and a claim's errors. Every rule
 * is the server's (C-7 C7-7); these tables only say how a code reads.
 */

const THEMES = new Set(["welcome", "weekly", "weekend", "seasonOpener", "seasonFinale"]);

/** An event's name; a theme this build does not know reads "Event". */
export function themeName(t: TFunction, theme: string | undefined): string {
  return t(`online.events.theme.${theme && THEMES.has(theme) ? theme : "other"}`);
}

/** The missions counted match by match: they show a bar of progress over target. */
const COUNTED = new Set(["leagueMatchesDirected", "leagueWinsDirected", "offlineMatches"]);
/** The missions met when a season closes: met or not, never a count (C-7 C7-53). */
const SEASON_END = new Set(["seasonPromoted", "seasonFinishTop"]);

export function isCounted(kind: string): boolean {
  return COUNTED.has(kind);
}

export function isSeasonEnd(kind: string): boolean {
  return SEASON_END.has(kind);
}

/** What names a mission: its kind and target, and the league levels a season-end one counts in. */
export interface MissionWords {
  kind: string;
  target: number;
  levels?: LevelRange;
}

/** A mission's sentence (C-7 C7-52); a kind this build does not know is a "special mission". */
export function missionText(t: TFunction, mission: MissionWords): string {
  if (mission.kind === "seasonFinishTop" && mission.target === 1) {
    return t("online.events.mission.seasonChampion");
  }
  if (COUNTED.has(mission.kind) || SEASON_END.has(mission.kind)) {
    return t(`online.events.mission.${mission.kind}`, { target: mission.target });
  }
  return t("online.events.mission.other");
}

/** The line under a mission that says what counts; none for a kind this build does not know. */
export function missionHint(t: TFunction, kind: string): string | undefined {
  if (kind === "leagueMatchesDirected" || kind === "leagueWinsDirected") {
    return t("online.events.hint.directed");
  }
  if (kind === "offlineMatches") return t("online.events.hint.offline");
  if (SEASON_END.has(kind)) return t("online.events.hint.seasonEnd");
  return undefined;
}

/** The server's mark for "no top level" in a range (S-19 §3.4). */
const NO_TOP = 1000;

/** The league levels a mission counts in; none when the view gives none (the client never guesses). */
export function levelsText(t: TFunction, levels: LevelRange | undefined): string | undefined {
  if (!levels) return undefined;
  if (levels.to >= NO_TOP) return t("online.events.levels.from", { from: levels.from });
  if (levels.from === levels.to) return t("online.events.levels.one", { from: levels.from });
  return t("online.events.levels.range", { from: levels.from, to: levels.to });
}

/** Why a reward lapsed, the six the server may give (S-19 §5.4); any other is `unavailable`. */
const REASONS = new Set([
  "grantLimitReached",
  "coinLimitReached",
  "stackFull",
  "inventoryLocked",
  "disabled",
  "unavailable",
]);

export function lapsedReasonText(t: TFunction, reason: string): string {
  return t(`online.events.reason.${REASONS.has(reason) ? reason : "unavailable"}`);
}

/** A reward as one short phrase: "Energy drink ×2" or "20 coins". */
export function rewardText(t: TFunction, language: string, reward: RewardView): string {
  if (reward.coin !== undefined) {
    return t("online.shop.coinsAmount", { coins: formatCoins(reward.coin, language) });
  }
  const name = itemName(t, reward.item ?? "");
  return reward.quantity > 1 ? `${name} ×${reward.quantity}` : name;
}

/** The mission of `eventId` with `code` in the events the store holds, with its event's theme. */
export function findMission(
  events: EventsView | null | undefined,
  eventId: string | undefined,
  code: string | undefined,
): (MissionWords & { theme: string }) | undefined {
  if (!events || !eventId || !code) return undefined;
  const event = events.events.find((candidate) => candidate.id === eventId);
  const mission = event?.missions.find((candidate) => candidate.code === code);
  return event && mission ? { ...mission, theme: event.theme } : undefined;
}

/**
 * A failed claim as the player reads it: the event codes and the item codes a claim may answer
 * with, their limits spelled; anything else as any request's error.
 */
export function claimErrorText(t: TFunction, language: string, error: unknown): string {
  if (error instanceof OnlineApiError && error.code === "be.error.events.coinLimitReached") {
    const limit = Number(error.params.limit);
    return t(error.code, {
      limit: Number.isFinite(limit) ? formatCoins(limit, language) : String(error.params.limit),
    });
  }
  if (error instanceof OnlineApiError && error.code.startsWith("be.error.")) {
    return itemCodeText(t, language, error.code, error.params);
  }
  return resolveBackendError(error);
}
