import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { AlertTriangle, Coffee, Flag, Radio, WifiOff } from "lucide-react";
import { Button } from "../../../components/ui";
import { resolveBackendError } from "../../../utils/backendI18n";
import type { Side } from "../../api/engine";
import { injuryStepsLeft, type OnlineMatchState } from "../../convert/matchState";
import { useOnlineNow } from "../../clock";
import { FriendlyAfterMatch } from "../friendly/FriendlyAfterMatch";
import type { LiveMatchData } from "./useLiveMatch";

const sideKey = (side: Side) => (side === "Home" ? "home" : "away");

const STRIP =
  "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-gray-800 dark:text-gray-100";
const CALM = `${STRIP} border-gray-200 bg-white dark:border-navy-700 dark:bg-navy-800`;
const WARN = `${STRIP} border-accent-400/50 bg-accent-50 dark:bg-accent-500/10`;

/** Seconds from steps at the match's pace, rounded up. */
const secondsOf = (steps: number, stepMillis: number) => Math.ceil((steps * stepMillis) / 1000);

/** The moment the match was first seen in half time, so the break counts down from it. */
export function useHalfTimeStart(phase: string): number | null {
  const now = useOnlineNow();
  const [since, setSince] = useState<number | null>(null);
  useEffect(() => {
    if (phase !== "HalfTime") setSince(null);
    else setSince((current) => current ?? now);
  }, [phase, now]);
  return since;
}

/** Who holds each side (C2-13): the viewer's own side, or both for a spectator. */
function ControllerLine({ data }: { data: LiveMatchData }) {
  const { t } = useTranslation();
  const { mine, state, everCoached } = data;
  if (mine === null) {
    const of = (side: "home" | "away") =>
      t(state.controllers[side] === "Manager" ? "online.match.byCoach" : "online.match.byAi", {
        team: state[side].name,
      });
    return (
      <p role="status" className={CALM}>
        <Radio className="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400" />
        {t("match.spectatorMode")} · {of("home")} · {of("away")}
      </p>
    );
  }
  const held = state.controllers[sideKey(mine.side)];
  if (held === "Manager") {
    return (
      <p role="status" className={CALM}>
        <Radio className="h-4 w-4 shrink-0 text-primary-600 dark:text-primary-400" />
        {t("online.match.youCoach")}
      </p>
    );
  }
  return (
    <p role="status" className={WARN}>
      <Radio className="h-4 w-4 shrink-0 text-accent-600 dark:text-accent-400" />
      {everCoached ? t("online.match.aiCoaches") : t("online.match.takingCharge")}{" "}
      {t("online.match.orderTakesCharge")}
    </p>
  );
}

/**
 * What the viewer should know about the match right now, above the radar (C-2 §3.6): who holds
 * each side, the connection, a hurt player of theirs still on the pitch and the time left to
 * replace him (C2-12), the half-time break, and the final whistle.
 */
export function MatchStatusStrip({
  data,
  shown = data.state,
  halfTimeSince: since,
  onReplace,
  phone = false,
}: {
  data: LiveMatchData;
  /**
   * The match as far as the screen shows it (`useShownState`): the break, the end and a hurt
   * player show once the radar has played them. The time left to act is the server's.
   */
  shown?: OnlineMatchState;
  /** When the server's match reached the break, if the screen keeps it; else when this saw it. */
  halfTimeSince?: number | null;
  /** Open the substitutions with this hurt player chosen to come off. */
  onReplace: (playerId: string) => void;
  /** On a phone the header says who coaches and the leave sheet warns: the strip keeps the rest. */
  phone?: boolean;
}) {
  const { t } = useTranslation();
  const now = useOnlineNow();
  const { view, state, mine, connection, watchError } = data;
  const seen = useHalfTimeStart(shown.phase);
  const halfTimeSince = since === undefined ? seen : since;
  const own = mine ? state[sideKey(mine.side)] : null;
  const isHurt = (match: OnlineMatchState, playerId: string) =>
    injuryStepsLeft(match, playerId, view.injuryWindowSteps) !== null;
  const hurt = own
    ? own.eleven.filter((player) => isHurt(shown, player.id) && isHurt(state, player.id))
    : [];

  return (
    <div className="flex flex-col gap-2">
      {shown.isFinished ? (
        <div role="status" className={CALM}>
          <Flag className="h-4 w-4 shrink-0 text-primary-600 dark:text-primary-400" />
          <span className="font-heading font-bold uppercase tracking-wider">
            {t("match.fullTime")}
          </span>
          {view.kind === "friendly" && (
            <FriendlyAfterMatch matchId={view.id} inline coach={mine !== null} />
          )}
          {view.fixtureId && (
            <Link
              to={`/online/fixtures/${view.fixtureId}`}
              className="ml-auto text-sm font-semibold text-primary-700 underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-primary-400 dark:focus:ring-offset-navy-800"
            >
              {t("online.match.seeResult")}
            </Link>
          )}
        </div>
      ) : (
        !phone && <ControllerLine data={data} />
      )}
      {watchError !== null ? (
        <p role="alert" className={WARN}>
          <WifiOff className="h-4 w-4 shrink-0 text-accent-600 dark:text-accent-400" />
          {resolveBackendError(watchError)}
        </p>
      ) : (
        (connection === "reconnecting" || connection === "closed") &&
        !shown.isFinished && (
          <p role="status" className={WARN}>
            <WifiOff className="h-4 w-4 shrink-0 text-accent-600 dark:text-accent-400" />
            {t("online.match.reconnecting")}
          </p>
        )
      )}
      {shown.phase === "HalfTime" && halfTimeSince !== null && (
        <p role="status" className={CALM}>
          <Coffee className="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400" />
          {t("online.match.halfTime", {
            seconds: Math.max(0, Math.ceil((halfTimeSince + view.halfTimeMillis - now) / 1000)),
          })}
        </p>
      )}
      {!shown.isFinished &&
        hurt.map((player) => {
          const steps = injuryStepsLeft(state, player.id, view.injuryWindowSteps) ?? 0;
          return (
            <div key={player.id} role="alert" className={WARN}>
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
              <span className="flex-1">
                {steps > 0
                  ? t("online.match.hurt", {
                      player: player.matchName,
                      seconds: secondsOf(steps, view.stepMillis),
                    })
                  : t("online.match.hurtNow", { player: player.matchName })}
              </span>
              <Button size="sm" variant="outline" onClick={() => onReplace(player.id)}>
                {t("online.match.replace")}
              </Button>
            </div>
          );
        })}
      {mine !== null && !shown.isFinished && !phone && (
        <p className="text-xs text-gray-500 dark:text-gray-400">{t("online.match.leaveWarning")}</p>
      )}
    </div>
  );
}
