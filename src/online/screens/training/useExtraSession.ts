import { useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveBackendError } from "../../../utils/backendI18n";
import type {
  ExtraDayView,
  ExtraSessionRequest,
  ExtraSessionView,
  MyClubView,
  SquadPlayerView,
  TrainingDayView,
} from "../../api";
import { online } from "../../client";
import { useOnlineNow } from "../../clock";
import { OnlineApiError } from "../../errors";
import { refreshClub, tracked, useOnlineStore } from "../../store/onlineStore";
import { useActionKey } from "../useActionKey";
import {
  chosenInSquad,
  type ExtraChoice,
  focusFull,
  loadChoice,
  namesOf,
  saveChoice,
  startersUnderMatchCondition,
} from "./extraText";
import { matchTodayKickoff, refusalText, viewRefusalParams } from "./todayText";

const ignore = () => undefined;

type Translate = ReturnType<typeof useTranslation>["t"];

/**
 * Extra sessions as the panel and the phone page hold them (C-12a C12-1…C12-6): the players
 * chosen (kept per club in this browser), the intensity, the sessions and the condition to keep;
 * the press and the server's answer; why a press cannot go, and the warnings of today's starters
 * it would leave tired and of players whose focus has nothing left to grow. The server decides who
 * trains.
 */
export function useExtraSession(
  club: MyClubView,
  trainingDay: TrainingDayView,
  extra: ExtraDayView,
) {
  const { t, i18n } = useTranslation();
  const now = useOnlineNow();
  const season = useOnlineStore((state) => state.season);
  const clubId = club.club.id;
  const [choice, setChoiceState] = useState<ExtraChoice>(() => loadChoice(clubId));
  const [intensity, setIntensity] = useState<string>("Low");
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<{ error: unknown; seen: ExtraDayView } | null>(null);
  const [result, setResult] = useState<ExtraSessionView | null>(null);
  const key = useActionKey();
  const chosen = chosenInSquad(choice.players, club.players);
  const matchKickoff = matchTodayKickoff(club, season?.nextDayAt, now);
  const cost = extra.costs?.[intensity];

  const setChoice = (next: ExtraChoice) => {
    setChoiceState(next);
    saveChoice(clubId, next);
  };
  const toggle = (playerId: string) => {
    const ids = new Set(chosen);
    if (ids.has(playerId)) ids.delete(playerId);
    else ids.add(playerId);
    setChoice({ ...choice, players: club.players.map((p) => p.id).filter((id) => ids.has(id)) });
  };

  const press = async () => {
    const request: ExtraSessionRequest = {
      intensity,
      players: chosen,
      sessions: choice.sessions,
      ...(choice.keepAbove === null ? {} : { keepAbove: choice.keepAbove }),
    };
    setSending(true);
    setFailure(null);
    try {
      const view = await key.run(
        (idempotencyKey) => tracked(() => online.clubs.extraSessions(request, idempotencyKey)),
        JSON.stringify(request),
      );
      setResult(view);
      const current = useOnlineStore.getState().club;
      if (current) {
        useOnlineStore.getState().setClub({ ...current, trainingDay: view.trainingDay });
      }
      void refreshClub().catch(ignore);
    } catch (error) {
      setFailure({ error, seen: extra });
      // Every 409 means the view was stale: read it again.
      if (error instanceof OnlineApiError && error.status === 409) {
        void refreshClub().catch(ignore);
      }
    } finally {
      setSending(false);
    }
  };

  const shownFailure = failure && failure.seen === extra ? failure.error : null;
  const reason = shownFailure
    ? failureText(t, i18n.language, shownFailure, now)
    : extra.canPress
      ? null
      : refusalText(
          t,
          i18n.language,
          extra.refusal ?? "",
          viewRefusalParams(trainingDay, club),
          now,
        );
  const starters = matchKickoff
    ? startersUnderMatchCondition({
        players: club.players,
        chosen,
        startingXiIds: club.setup.startingXiIds,
        extra,
        intensity,
        sessions: choice.sessions,
        keepAbove: choice.keepAbove,
      })
    : [];
  const full = focusFull(club.players, chosen, club.trainingPlan);

  return {
    choice,
    setChoice,
    toggle,
    chosen,
    intensity,
    setIntensity,
    cost,
    matchToday: matchKickoff !== null,
    sending,
    result,
    clearResult: () => setResult(null),
    press,
    reason,
    starters,
    full,
  };
}

/** Up to three names, then "and k more". */
export function listed(t: Translate, players: SquadPlayerView[]): string {
  const { names, more } = namesOf(players);
  return more > 0 ? t("online.training.extra.andMore", { names, more }) : names;
}

/** What a failed press says: the panel's own sentence for a refusal, the shared one otherwise. */
function failureText(t: Translate, language: string, error: unknown, now: number): string {
  if (error instanceof OnlineApiError && error.status === 409) {
    return refusalText(t, language, error.code, error.params, now);
  }
  return resolveBackendError(error);
}
