import { type ReactNode, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, X } from "lucide-react";
import type { ExtraDayView, MyClubView, TrainingDayView } from "../../api";
import { useOnlineStore } from "../../store/onlineStore";
import DailyGift from "../items/DailyGift";
import { FRAME_ACTION, keepFocusInside } from "../items/ItemDialogFrame";
import { IntensityChooser, PlayerChooser, PressResult, SessionsChooser } from "./ExtraChoosers";
import { ALL_SESSIONS, MATCH_CONDITION } from "./extraText";
import { listed, listedWithBest, useExtraSession } from "./useExtraSession";

/**
 * Extra sessions on top of the day's, in a panel from the right (design tap-luyen.html; C-12a
 * C12-1…C12-6): the players to train (the whole squad by default), the intensity (Low by default),
 * how many sessions and the condition to keep, then the press and each player's line of the
 * answer. The server decides who trains; the panel only shows who it says will sit out, and warns
 * of today's starters it would leave under 75. Escape, the backdrop and × close it unless a press
 * is on its way.
 */
export default function ExtraTraining({
  club,
  trainingDay,
  extra,
  onClose,
}: {
  club: MyClubView;
  trainingDay: TrainingDayView;
  extra: ExtraDayView;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const offline = useOnlineStore((state) => state.network === "offline");
  const {
    choice,
    setChoice,
    toggle,
    chosen,
    intensity,
    setIntensity,
    cost,
    matchToday,
    sending,
    result,
    press,
    reason,
    starters,
    full,
  } = useExtraSession(club, trainingDay, extra);
  const intensityLabel = t(`training.intensities.${intensity}.label`);

  return (
    <Drawer busy={sending} onClose={onClose}>
      <div className="flex items-start gap-3 border-b border-gray-200 px-5 py-4.5 dark:border-navy-600">
        <div className="flex flex-1 flex-col gap-1">
          <h2
            id="extra-training-title"
            className="font-heading text-2xl font-bold uppercase tracking-wide text-gray-900 dark:text-white"
          >
            {t("online.training.extra.title")}
          </h2>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            {t("online.training.extra.drawerIntro")}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={sending}
          aria-label={t("common.close")}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-navy-600"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-4.5 overflow-y-auto px-5 py-4">
        {result && <PressResult club={club} result={result} />}
        <DailyGift />
        <PlayerChooser
          players={club.players}
          chosen={chosen}
          extra={extra}
          cost={cost}
          keepAbove={choice.keepAbove}
          disabled={sending}
          onToggle={toggle}
          onAll={() => setChoice({ ...choice, players: null })}
          onNone={() => setChoice({ ...choice, players: [] })}
        />
        <IntensityChooser
          value={intensity}
          costs={extra.costs}
          disabled={sending}
          onChange={setIntensity}
        />
        <SessionsChooser
          choice={choice}
          floor={extra.floor}
          matchToday={matchToday}
          disabled={sending}
          onChange={setChoice}
        />
        {starters.length > 0 && (
          <Warning>
            {t("online.training.extra.xiWarning", {
              names: listed(t, starters),
              condition: MATCH_CONDITION,
            })}
          </Warning>
        )}
        {full.length > 0 && (
          <Warning>
            {t("online.training.extra.focusFull", { names: listedWithBest(t, full) })}
          </Warning>
        )}
      </div>
      <div className="flex flex-col gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3.5 dark:border-navy-600 dark:bg-navy-800">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex-[1_1_180px] text-[13px] text-gray-600 dark:text-gray-400">
            {choice.sessions === ALL_SESSIONS
              ? t("online.training.extra.summaryAll", {
                  players: chosen.length,
                  intensity: intensityLabel,
                })
              : t("online.training.extra.summary", {
                  players: chosen.length,
                  sessions: choice.sessions,
                  intensity: intensityLabel,
                })}
            {cost !== undefined && ` (${t("online.training.extra.costPer", { cost })})`}
          </span>
          <button
            type="button"
            disabled={!extra.canPress || sending || offline || chosen.length === 0}
            onClick={() => void press()}
            className={`${FRAME_ACTION} flex-none px-5.5`}
          >
            {t("online.training.extra.pressShort")}
          </button>
        </div>
        {reason && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {reason}
          </p>
        )}
      </div>
    </Drawer>
  );
}

/**
 * The panel's frame: a dark backdrop and a column on the right, full height. It takes the focus
 * when it opens, keeps Tab inside, and closes on Escape or a click on the backdrop unless busy.
 */
function Drawer({
  busy,
  onClose,
  children,
}: {
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
      if (event.key === "Tab") keepFocusInside(ref.current, event);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* The backdrop is for the mouse; the keyboard closes with Escape or the × button. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/60"
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="extra-training-title"
        tabIndex={-1}
        className="relative flex h-full w-full max-w-130 flex-col border-l border-gray-200 bg-white shadow-2xl outline-none dark:border-navy-600 dark:bg-navy-700"
      >
        {children}
      </div>
    </div>
  );
}

export function Warning({ children }: { children: string }) {
  return (
    <p
      role="note"
      className="flex items-start gap-2 rounded-lg border border-accent-400/60 bg-accent-50 px-3 py-2 text-sm text-gray-800 dark:border-accent-400/40 dark:bg-accent-500/10 dark:text-gray-100"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-accent-600 dark:text-accent-400" />
      {children}
    </p>
  );
}
