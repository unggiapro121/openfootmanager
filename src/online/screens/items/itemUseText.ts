import type { TFunction } from "i18next";
import type { ItemEffectView, ItemUseLimitsView, SquadPlayerView } from "../../api";
import { formatMoment } from "../../format";
import { itemName } from "./itemText";

// The lines a use of an item is told in, before and after it: shared by the use dialog and the
// one-tap choices (C-17 C17-1, C17-2).

export function nameOf(players: SquadPlayerView[], id: string): string {
  return players.find((player) => player.id === id)?.fullName ?? id;
}

/** What a use did or would do, before and after, as lines (C-7 §17.3 step 3). */
export function effectLines(
  t: TFunction,
  effect: ItemEffectView,
  players: SquadPlayerView[],
): string[] {
  switch (effect.kind) {
    case "condition":
      return effect.players.map((change) =>
        t("online.items.preview.condition", {
          player: nameOf(players, change.playerId),
          before: change.before,
          after: change.after,
        }),
      );
    case "injury":
      return [
        effect.after === undefined
          ? t("online.items.preview.cured", {
              player: nameOf(players, effect.playerId),
              before: effect.before,
            })
          : t("online.items.preview.injury", {
              player: nameOf(players, effect.playerId),
              before: effect.before,
              after: effect.after,
            }),
      ];
    case "mastery":
      return [
        t("online.items.preview.mastery", {
          xp: effect.xp,
          before: effect.masteryBefore,
          after: effect.masteryAfter,
        }),
      ];
    case "xpX2":
      return [
        t("online.items.preview.xpX2", { matches: effect.matches, remaining: effect.remaining }),
      ];
  }
}

export function limitLines(t: TFunction, language: string, limits: ItemUseLimitsView): string[] {
  const out: string[] = [];
  // A season that caps the drinks in condition points sends points instead of uses (S-28 S28-8).
  if (limits.pointsToday !== undefined && limits.pointsPerDay !== undefined) {
    out.push(
      t("online.items.limit.points", { used: limits.pointsToday, perDay: limits.pointsPerDay }),
    );
  }
  if (limits.perDay === 0) {
    out.push(t("online.inventory.offThisSeason"));
  } else if (limits.usedToday !== undefined && limits.perDay !== undefined) {
    out.push(
      limits.nextAt
        ? t("online.items.limit.today", {
            used: limits.usedToday,
            perDay: limits.perDay,
            time: formatMoment(limits.nextAt, language),
          })
        : t("online.items.limit.todayPlain", { used: limits.usedToday, perDay: limits.perDay }),
    );
  }
  if (limits.seasonUsed !== undefined && limits.seasonLimit !== undefined) {
    out.push(
      t("online.items.limit.season", { used: limits.seasonUsed, limit: limits.seasonLimit }),
    );
  }
  if (limits.effectRemaining !== undefined && limits.effectMax !== undefined) {
    out.push(
      t("online.items.limit.xpX2", { remaining: limits.effectRemaining, max: limits.effectMax }),
    );
  }
  return out;
}

/** What a use did, as the line shown after it: the item used, then its effect. */
export function usedText(
  t: TFunction,
  code: string,
  effect: ItemEffectView,
  players: SquadPlayerView[],
): string {
  return [
    t("online.items.used", { item: itemName(t, code) }),
    ...effectLines(t, effect, players),
  ].join(" ");
}
