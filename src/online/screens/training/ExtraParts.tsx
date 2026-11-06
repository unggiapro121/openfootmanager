import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, ChevronRight, Info } from "lucide-react";
import { FOCUS } from "../mobile/PhoneSheet";
import { type ExtraOutcome, pressTotals } from "./extraResult";
import { MATCH_CONDITION } from "./extraText";
import { listed, listedWithBest, type useExtraSession } from "./useExtraSession";

const KEY = "online.training.phone";

// Pieces the phone's extra page and the desktop panel share (design MTapThem).

/** The ⓘ button that shows how extra sessions work. */
export function InfoToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={t(`${KEY}.howItWorks`)}
      onClick={onToggle}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-primary-600 dark:text-primary-400 ${open ? "bg-gray-100 dark:bg-navy-700" : ""} ${FOCUS}`}
    >
      <Info className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}

/** How extra sessions work, in three points. */
export function ExtraInfo({ cap }: { cap: number }) {
  const { t } = useTranslation();
  return (
    <ul className="flex list-disc flex-col gap-1.5 rounded-xl border border-gray-200 bg-white py-3 pl-7 pr-3.5 text-xs leading-snug text-gray-700 dark:border-navy-600 dark:bg-navy-800 dark:text-gray-300">
      <li>{t("online.training.extra.drawerIntro")}</li>
      <li>{t(`${KEY}.notCounted`, { cap })}</li>
      <li>{t("online.training.extra.intensityHint")}</li>
    </ul>
  );
}

/** The last press in one line: players who rose and attributes risen; a tap shows it all. */
export function LastResultChip({
  outcome,
  expanded,
  onOpen,
}: {
  outcome: ExtraOutcome;
  /** Set where the chip folds the result open in place rather than opening a sheet. */
  expanded?: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const totals = pressTotals(outcome.result.players);
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onOpen}
      className={`flex h-11 shrink-0 items-center gap-2 rounded-[10px] border border-primary-300 bg-primary-50 px-3 text-left text-[13px] font-semibold text-primary-800 dark:border-primary-800 dark:bg-primary-900/30 dark:text-primary-300 ${FOCUS}`}
    >
      <Check className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">
        {t(`${KEY}.lastGains`, { players: totals.improved, gains: totals.gains })}
      </span>
      <ChevronRight
        className={`h-4 w-4 shrink-0 ${expanded ? "-rotate-90" : ""}`}
        aria-hidden="true"
      />
    </button>
  );
}

/** The press: why it cannot go, what it will do, and the button. */
export function PressBar({
  reason,
  summary,
  detail,
  disabled,
  onPress,
}: {
  reason: string | null;
  summary: string;
  detail: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {reason && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {reason}
        </p>
      )}
      <div className="flex items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="text-[15px] font-bold text-gray-900 dark:text-white">{summary}</span>
          <span className="truncate text-xs text-gray-500 dark:text-gray-400">{detail}</span>
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={onPress}
          className={`h-12.5 shrink-0 rounded-xl bg-primary-700 px-5.5 font-heading text-lg font-bold uppercase tracking-wider text-white disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 dark:bg-primary-600 dark:disabled:bg-navy-700 dark:disabled:text-gray-400 ${FOCUS}`}
        >
          {t("online.training.extra.pressShort")}
        </button>
      </div>
    </>
  );
}

/**
 * The warnings of a press: today's starters it would tire, focuses that lift nothing, and keepers
 * too tired for the session, and so for their drill (E5-6d C), under the `floor` condition.
 */
export function ExtraWarnings({
  session,
  floor,
}: {
  session: ReturnType<typeof useExtraSession>;
  floor: number;
}) {
  const { t } = useTranslation();
  return (
    <>
      {session.starters.length > 0 && (
        <Warning>
          {t("online.training.extra.xiWarning", {
            names: listed(t, session.starters),
            condition: MATCH_CONDITION,
          })}
        </Warning>
      )}
      {session.full.length > 0 && (
        <Warning>
          {t("online.training.extra.focusFull", { names: listedWithBest(t, session.full) })}
        </Warning>
      )}
      {session.keepersTired.length > 0 && (
        <Warning>
          {t("online.training.extra.keeperTired", {
            names: listed(t, session.keepersTired),
            floor,
          })}
        </Warning>
      )}
    </>
  );
}

function Warning({ children }: { children: string }) {
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
