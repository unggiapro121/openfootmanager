import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ExtraDayView, MyClubView } from "../../api";
import type { PlayerAttributes } from "../../api/domain/PlayerAttributes";
import type { RestingPlayer } from "./ExtraLists";
import type { ExtraOutcome } from "./extraResult";
import { ALL_SESSIONS, stopReasonKey } from "./extraText";
import { extraOrder, stopsBeforeFirst } from "./trainingView";
import type { useExtraSession } from "./useExtraSession";

const KEY = "online.training.phone";

/** The sit-out reasons a "why" text explains in full; any other reads as `other`. */
const WHY_REASONS = new Set(["injured", "tired", "resting", "peaked", "focusMaxed", "keepAbove"]);

/**
 * The extra session's two lists as the phone page and the desktop panel show them (design
 * MTapThem): those who can train, and those who rest this session — the server's sit-outs and
 * those the condition to keep stops before the first session — each with why; how many of the
 * chosen will train, "choose all / none" over those who can, and the press's summary lines.
 */
export function useExtraLists(
  club: MyClubView,
  extra: ExtraDayView,
  session: ReturnType<typeof useExtraSession>,
) {
  const { t } = useTranslation();
  const { choice, setChoice, chosen, intensity, cost } = session;
  const sitOut = new Map(extra.sitOut.map((line) => [line.playerId, line.reason]));
  const keptBack = (condition: number) =>
    stopsBeforeFirst(condition, cost, extra.floor, choice.keepAbove);
  const ordered = extraOrder(club.players, extra);
  const ready = ordered.filter((p) => !sitOut.has(p.id) && !keptBack(p.condition));
  const rest: RestingPlayer[] = ordered
    .filter((p) => sitOut.has(p.id) || keptBack(p.condition))
    .map((player) => {
      const reason = sitOut.get(player.id) ?? "keepAbove";
      return {
        player,
        reason,
        text: sitOut.has(player.id)
          ? t(stopReasonKey(reason), { floor: extra.floor })
          : t(`${KEY}.underKeep`, { value: choice.keepAbove }),
        why: t(`${KEY}.why.${WHY_REASONS.has(reason) ? reason : "other"}`, {
          name: player.matchName,
          condition: Math.round(player.condition),
          floor: extra.floor,
          value: choice.keepAbove,
        }),
      };
    });
  const chosenIds = new Set(chosen);
  // The players the summary counts: those chosen who can train this session.
  const training = ready.filter((player) => chosenIds.has(player.id)).length;
  const allOn = ready.length > 0 && ready.every((player) => chosenIds.has(player.id));
  const bulk = () => {
    const readyIds = new Set(ready.map((player) => player.id));
    const kept = new Set(
      allOn ? chosen.filter((id) => !readyIds.has(id)) : [...chosen, ...readyIds],
    );
    setChoice({ ...choice, players: club.players.map((p) => p.id).filter((id) => kept.has(id)) });
  };
  const summary =
    choice.sessions === ALL_SESSIONS
      ? t(`${KEY}.footerMax`, { players: training })
      : t(`${KEY}.footer`, { players: training, sessions: choice.sessions });
  const detail = [
    t(`training.intensities.${intensity}.label`),
    cost === undefined ? null : t("online.training.extra.costPer", { cost }),
    choice.keepAbove === null ? null : t(`${KEY}.keepAtLeast`, { value: choice.keepAbove }),
  ]
    .filter(Boolean)
    .join(" · ");
  return { ready, rest, chosenIds, training, allOn, bulk, summary, detail };
}

/**
 * The press as both screens make it: the squad's attributes are kept just before, so the result
 * can name what rose (`namedGains`), and each answer goes to `onOutcome` with them.
 */
export function useExtraOutcome(
  club: MyClubView,
  session: ReturnType<typeof useExtraSession>,
  onOutcome: (outcome: ExtraOutcome) => void,
): () => void {
  const before = useRef(new Map<string, PlayerAttributes>());
  const { result } = session;
  useEffect(() => {
    if (result) onOutcome({ result, before: before.current });
  }, [result, onOutcome]);
  return () => {
    before.current = new Map(club.players.map((player) => [player.id, player.attributes]));
    void session.press();
  };
}
