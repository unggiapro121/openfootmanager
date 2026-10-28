import type { TFunction } from "i18next";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Backpack, Gavel, X } from "lucide-react";
import { formatExactMoney } from "../../lib/valueFormatting";
import { type OnlineNotice, useOnlineStore } from "../store/onlineStore";
import { itemName } from "./items/itemText";

/** How long a notice stays before it leaves by itself. */
export const NOTICE_MILLIS = 8000;

/** The market events a notice has its own sentence for; any other says only that something changed. */
const MARKET_EVENTS = new Set(["outbid", "won", "sold", "unsold", "cancelled", "forced"]);

/** The item events a notice is pushed for (C-7 C7-34). */
const ITEM_EVENTS = new Set(["granted", "refunded"]);

function noticeText(t: TFunction, notice: OnlineNotice): string {
  if (notice.kind === "items") {
    const event = ITEM_EVENTS.has(notice.event) ? notice.event : "changed";
    const code = notice.params.item;
    return t(`online.items.notice.${event}`, {
      item: typeof code === "string" ? itemName(t, code) : "",
    });
  }
  const event = MARKET_EVENTS.has(notice.event) ? notice.event : "changed";
  const player = notice.params.player;
  const price = notice.params.price;
  return t(`online.market.notice.${event}${player === undefined ? "Unnamed" : ""}`, {
    player,
    price: typeof price === "number" ? formatExactMoney(price) : "",
  });
}

/**
 * The notices in a corner of the online screens (C-5 C5-14, C-7 C7-4): the market's, and an item
 * given or a purchase refunded. At most three, newest last, each leaving after eight seconds or
 * when closed. They sit outside a live match's frame and never take the focus; a screen reader
 * hears each as it comes.
 */
export default function OnlineNotices() {
  const { t } = useTranslation();
  const notices = useOnlineStore((state) => state.notices);
  return (
    <section
      aria-label={t("online.market.notice.region")}
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-40 flex w-80 flex-col gap-2"
    >
      {notices.map((notice) => (
        <NoticeCard key={notice.id} notice={notice} text={noticeText(t, notice)} />
      ))}
    </section>
  );
}

function NoticeCard({ notice, text }: { notice: OnlineNotice; text: string }) {
  const { t } = useTranslation();
  const dismiss = useOnlineStore((state) => state.dismissNotice);
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(notice.id), NOTICE_MILLIS);
    return () => window.clearTimeout(timer);
  }, [dismiss, notice.id]);
  const Icon = notice.kind === "items" ? Backpack : Gavel;

  return (
    <div className="pointer-events-auto flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-800 shadow-lg dark:border-navy-600 dark:bg-navy-800 dark:text-gray-100">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent-600 dark:text-accent-400" aria-hidden />
      {notice.link ? (
        <Link
          to={notice.link}
          onClick={() => dismiss(notice.id)}
          className="flex-1 rounded hover:text-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:hover:text-primary-400 dark:focus:ring-offset-navy-800"
        >
          {text}
        </Link>
      ) : (
        <p className="flex-1">{text}</p>
      )}
      <button
        type="button"
        onClick={() => dismiss(notice.id)}
        aria-label={t("online.market.notice.close")}
        className="rounded text-gray-400 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:hover:text-gray-200 dark:focus:ring-offset-navy-800"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
