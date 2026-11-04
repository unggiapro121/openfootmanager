import { useTranslation } from "react-i18next";
import { ChevronRight, Plus } from "lucide-react";
import type { ExtraDayView, SquadPlayerView } from "../../../api";
import { FOCUS } from "../../mobile/PhoneSheet";
import { pressTotals } from "./extraResult";
import type { ExtraOutcome } from "./PhoneExtraResult";

const KEY = "online.training.phone";

/**
 * The way into extra sessions on a phone (design MTapThem "Tập thêm" entry): a card that opens
 * the page, saying what the last press gave or how many can train, and the sessions held today.
 */
export function PhoneExtraEntry({
  extra,
  players,
  outcome,
  onOpen,
}: {
  extra: ExtraDayView;
  players: SquadPlayerView[];
  outcome: ExtraOutcome | null;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const sittingOut = new Set(extra.sitOut.map((line) => line.playerId));
  const ready = players.filter((player) => !sittingOut.has(player.id)).length;
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={onOpen}
      className={`flex w-full items-center gap-3 rounded-[14px] border border-gray-200 bg-white px-3.5 py-3 text-left dark:border-navy-700 dark:bg-navy-800 ${FOCUS}`}
    >
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300"
      >
        <Plus className="h-5 w-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-heading text-[17px] font-bold uppercase tracking-wider text-gray-900 dark:text-white">
          {t("online.training.extra.title")}
        </span>
        <span
          className={`truncate text-xs ${outcome ? "text-primary-700 dark:text-primary-300" : "text-gray-500 dark:text-gray-400"}`}
        >
          {outcome
            ? t(`${KEY}.entryLast`, {
                gains: pressTotals(outcome.result.players).gains,
                today: extra.today,
              })
            : t(`${KEY}.entryReady`, { count: ready, today: extra.today })}
        </span>
      </span>
      <ChevronRight className="h-4.5 w-4.5 shrink-0 text-gray-400" aria-hidden="true" />
    </button>
  );
}
