import { type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Coffee } from "lucide-react";
import type { MatchCommand } from "../../../api/engine";
import { useOnlineNow } from "../../../clock";
import { toRadarRoster } from "../../../convert/matchState";
import { useOnlineStore } from "../../../store/onlineStore";
import { halfTimeSecondsLeft } from "../MatchStatusStrip";
import type { LiveMatchData } from "../useLiveMatch";
import { PhoneMatchDock } from "./PhoneMatchDock";
import { PhoneMatchHeader } from "./PhoneMatchHeader";
import { PhoneMatchPanels } from "./PhoneMatchPanels";

/** Under this many seconds the countdown turns to a warning. */
const HURRY_SECONDS = 10;

/** `seconds` as m:ss. */
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/**
 * The half-time break on a phone (analysis-mobile-halftime D-HT1): the live match's screen with
 * the countdown to the second half in the radar's place, the stats tab open (D-HT4), and for the
 * coach the same dock of controls pinned at the foot, so a change is a tap away, never a scroll.
 * Over the whole screen, so no tab of the app is tapped out of the match by mistake.
 */
export function PhoneHalfTime({
  data,
  strip,
  send,
  halfTimeSince,
  replacing,
  disabled,
}: {
  data: LiveMatchData;
  /** What the viewer should know now: a hurt player to replace, the connection. */
  strip: ReactNode;
  send: (command: MatchCommand) => Promise<void>;
  /** When the server's match reached the break, which the countdown runs from. */
  halfTimeSince: number | null;
  /** A hurt player of the coach's to replace now. */
  replacing?: string;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const now = useOnlineNow();
  const { view, state, mine } = data;
  const squad = useOnlineStore((store) => store.club?.players);
  const pictures = useOnlineStore((store) => store.playerPictures);
  const roster = useMemo(() => toRadarRoster(state, squad, pictures), [state, squad, pictures]);
  const left =
    halfTimeSince === null ? null : halfTimeSecondsLeft(halfTimeSince, view.halfTimeMillis, now);
  const hurry = left !== null && left < HURRY_SECONDS;

  return (
    <section
      aria-label={t("match.halfTime")}
      className={`fixed inset-0 z-40 overflow-y-auto bg-gray-100 dark:bg-navy-900 ${mine ? "pb-[calc(8.5rem+var(--safe-bottom))]" : "pb-[var(--safe-bottom)]"}`}
    >
      <PhoneMatchHeader data={data} shown={state} />
      <div className="px-3 pt-2.5 empty:hidden">{strip}</div>
      <div
        className={`mx-3 mt-2.5 flex items-center gap-3 rounded-[14px] border px-4 py-3.5 ${hurry ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-900/30" : "border-gray-200 bg-white dark:border-navy-700 dark:bg-navy-800"}`}
      >
        <Coffee
          className={`h-7 w-7 shrink-0 ${hurry ? "text-red-600 dark:text-red-400" : "text-accent-600 dark:text-accent-400"}`}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="font-heading text-xs font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
            {t("online.match.phone.secondHalfIn")}
          </p>
          {mine && (
            <p className="mt-0.5 text-xs leading-snug text-gray-600 dark:text-gray-400">
              {t("online.match.halfTimeHint")}
            </p>
          )}
        </div>
        <span
          role="timer"
          aria-label={t("online.match.phone.secondHalfIn")}
          className={`shrink-0 font-heading text-[40px] font-bold leading-none tabular-nums ${hurry ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-white"}`}
        >
          {left === null ? "–:––" : clock(left)}
        </span>
      </div>
      <PhoneMatchPanels state={state} mine={mine} roster={roster} initialPanel="stats" />
      {mine && (
        <PhoneMatchDock
          state={state}
          mine={mine}
          sent={data.sent}
          onSend={send}
          initialOff={replacing}
          disabled={disabled}
        />
      )}
    </section>
  );
}
