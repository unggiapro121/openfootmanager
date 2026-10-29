import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, UserCheck } from "lucide-react";
import { Badge, Button } from "../../components/ui";
import type { MyClubView } from "../api";

/** Whether the coach has been told the assistant is on, per club, in this browser (C10-7). */
const SEEN_PREFIX = "ofm:xiAssistant:seen:";

function readSeen(clubId: string): boolean {
  try {
    return window.localStorage.getItem(SEEN_PREFIX + clubId) === "1";
  } catch {
    // No storage (a private window): the notice may show again, which does no harm.
    return false;
  }
}

function writeSeen(clubId: string): void {
  try {
    window.localStorage.setItem(SEEN_PREFIX + clubId, "1");
  } catch {
    // As above: nothing to keep it in.
  }
}

/**
 * The XI assistant on the tactics screen (S-27, C-10 C10-1, C10-4, C10-7): its switch, what each
 * state means, the "expected" mark on the eleven it picks, a notice the first time a coach finds
 * it on, and, when his own eleven just turned it off, the way to hand it back. Every rule is the
 * server's: it says on or off and which eleven will play.
 */
export default function XiAssistantCard({
  club,
  locked,
  dropped,
  setAssistant,
}: {
  club: MyClubView;
  locked: boolean;
  /** The coach's own eleven just turned it off. */
  dropped: boolean;
  setAssistant: (on: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const on = club.xiAssistant ?? false;
  const broken = !on && club.xiPick === "savedBroken";
  const [busy, setBusy] = useState(false);
  // Read once a visit: shown this time, never again for this club.
  const [firstTime] = useState(() => on && !readSeen(club.club.id));
  useEffect(() => {
    if (firstTime) writeSeen(club.club.id);
  }, [firstTime, club.club.id]);

  const turn = async (next: boolean) => {
    setBusy(true);
    writeSeen(club.club.id);
    try {
      await setAssistant(next);
    } catch {
      // The board's own notice says what went wrong.
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby={titleId}
      className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-navy-600 dark:bg-navy-700"
    >
      {firstTime && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-md border border-primary-300 bg-primary-50 px-3 py-2 text-sm text-gray-800 dark:border-primary-500/40 dark:bg-primary-500/10 dark:text-gray-100"
        >
          <Sparkles
            className="mt-0.5 h-4 w-4 shrink-0 text-primary-600 dark:text-primary-400"
            aria-hidden
          />
          {t("online.tactics.xiAssistant.firstNotice")}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <UserCheck className="h-5 w-5 text-primary-600 dark:text-primary-400" aria-hidden />
          <h2
            id={titleId}
            className="font-heading text-sm font-semibold uppercase tracking-wider text-gray-900 dark:text-white"
          >
            {t("online.tactics.xiAssistant.title")}
          </h2>
          {(on || broken) && (
            <Badge variant="accent">{t("online.tactics.xiAssistant.expected")}</Badge>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={titleId}
          disabled={locked || busy}
          onClick={() => void turn(!on)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors motion-reduce:transition-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-offset-navy-800 ${
            on ? "bg-primary-600 dark:bg-primary-500" : "bg-gray-300 dark:bg-navy-500"
          }`}
        >
          <span
            aria-hidden
            className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none ${
              on ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        {t(on ? "online.tactics.xiAssistant.onHint" : "online.tactics.xiAssistant.offHint")}
      </p>
      {broken && (
        <p className="text-sm text-accent-700 dark:text-accent-400">
          {t("online.tactics.xiAssistant.savedBroken")}
        </p>
      )}
      {locked && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t("online.tactics.xiAssistant.locked")}
        </p>
      )}
      {dropped && !on && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-accent-400/50 bg-accent-50 px-3 py-2 text-sm text-gray-800 dark:bg-accent-500/10 dark:text-gray-100"
        >
          <span>{t("online.tactics.xiAssistant.dropped")}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={locked || busy}
            onClick={() => void turn(true)}
          >
            {t("online.tactics.xiAssistant.handBack")}
          </Button>
        </div>
      )}
    </section>
  );
}
