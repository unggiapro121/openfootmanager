import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { useOnlineNow } from "../../clock";
import { formatKickoffClock } from "../../format";
import { useOnlineStore } from "../../store/onlineStore";

/**
 * The way into extra sessions (design tap-luyen.html "Tập thêm"): how many the club held today,
 * when the next daily gift comes or that one waits, and the button that opens the panel.
 */
export default function ExtraEntry({ today, onOpen }: { today: number; onOpen: () => void }) {
  const { t, i18n } = useTranslation();
  const now = useOnlineNow();
  const gift = useOnlineStore((state) => state.items?.dailyGift);
  const giftText = gift?.available
    ? t("online.training.extra.entryGiftReady")
    : gift?.nextAt
      ? t("online.training.extra.entryGift", {
          time: formatKickoffClock(gift.nextAt, now, i18n.language),
        })
      : null;
  return (
    <div className="flex flex-wrap items-center gap-3.5 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3.5 dark:border-navy-600 dark:bg-navy-700">
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300"
      >
        <Plus className="h-5 w-5" />
      </span>
      <span className="flex min-w-0 flex-[1_1_160px] flex-col gap-0.5">
        <span className="font-heading text-base font-bold uppercase tracking-wider text-gray-900 dark:text-white">
          {t("online.training.extra.title")}
        </span>
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {t("online.training.extra.entryToday", { count: today })}
          {giftText && ` · ${giftText}`}
        </span>
      </span>
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        className="h-10 rounded-lg border border-primary-500 px-4 font-heading text-sm font-bold uppercase tracking-wider text-primary-700 hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-primary-300 dark:hover:bg-primary-900/30 dark:focus:ring-offset-navy-800"
      >
        {t("online.training.extra.open")}
      </button>
    </div>
  );
}
