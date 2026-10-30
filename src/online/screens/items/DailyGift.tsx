import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Gift } from "lucide-react";
import { Button } from "../../../components/ui";
import type { DailyGiftStateView } from "../../api";
import { online } from "../../client";
import { useOnlineNow } from "../../clock";
import { OnlineApiError } from "../../errors";
import { formatMoment } from "../../format";
import { refreshItems, tracked, useOnlineStore } from "../../store/onlineStore";
import { useActionKey } from "../useActionKey";
import { itemName, itemsErrorText } from "./itemText";

/**
 * The daily gift (S-28 S28-9, C-12 C12-8): a button while today's gift waits, otherwise when the
 * next one comes. What is given and when are the server's; the card only says them. Shown on the
 * inventory page and in the extra training block, both reading the coach's items from the store.
 */
export default function DailyGift() {
  const { t, i18n } = useTranslation();
  const gift = useOnlineStore((state) => state.items?.dailyGift);
  const offline = useOnlineStore((state) => state.network === "offline");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ failure: unknown; seen: DailyGiftStateView } | null>(null);
  const [given, setGiven] = useState<string | null>(null);
  const { run } = useActionKey();
  const now = useOnlineNow();
  // The next gift's moment passed with no new read: read the items once for it.
  const readFor = useRef<string | null>(null);
  const due = gift?.nextAt !== undefined && Date.parse(gift.nextAt) <= now ? gift.nextAt : null;
  useEffect(() => {
    if (due === null || readFor.current === due) return;
    readFor.current = due;
    void refreshItems().catch(() => undefined);
  }, [due]);
  if (!gift) return null;

  const claim = async () => {
    setSending(true);
    setError(null);
    try {
      const view = await run((key) => tracked(() => online.items.claimDailyGift(key)), "gift");
      useOnlineStore.setState({ items: view.inventory });
      setGiven(
        t("online.items.dailyGift.given", {
          quantity: view.quantity,
          item: itemName(t, view.item),
        }),
      );
    } catch (failure) {
      setError({ failure, seen: gift });
      // Taken elsewhere or the season closed: the stored view is stale, read it again.
      if (failure instanceof OnlineApiError && failure.status === 409) {
        void refreshItems().catch(() => undefined);
      }
    } finally {
      setSending(false);
    }
  };

  const shownError = error && error.seen === gift ? error.failure : null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-accent-400/60 bg-accent-50 px-3 py-2 text-sm text-gray-800 dark:border-accent-400/40 dark:bg-accent-500/10 dark:text-gray-100">
      <Gift className="h-4 w-4 shrink-0 text-accent-600 dark:text-accent-400" aria-hidden="true" />
      {gift.available ? (
        <Button type="button" size="sm" disabled={sending || offline} onClick={() => void claim()}>
          {t("online.items.dailyGift.claim", {
            quantity: gift.quantity,
            item: itemName(t, gift.item),
          })}
        </Button>
      ) : (
        <span>
          {gift.nextAt
            ? t("online.items.dailyGift.next", {
                time: formatMoment(gift.nextAt, i18n.language),
              })
            : t("online.items.dailyGift.none")}
        </span>
      )}
      {given && !shownError && <span role="status">{given}</span>}
      {shownError !== null && (
        <span role="alert" className="text-red-600 dark:text-red-400">
          {itemsErrorText(t, i18n.language, shownError)}
        </span>
      )}
    </div>
  );
}
