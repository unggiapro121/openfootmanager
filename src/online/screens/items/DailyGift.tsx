import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Coins, Gift, Wallet } from "lucide-react";
import { Button } from "../../../components/ui";
import { formatExactMoney } from "../../../lib/valueFormatting";
import type { DailyGiftStateView, DailyGiftStepView, GiftReward } from "../../api";
import { online } from "../../client";
import { useOnlineNow } from "../../clock";
import { OnlineApiError } from "../../errors";
import { formatCoins } from "../../format";
import {
  refreshClub,
  refreshCoins,
  refreshItems,
  tracked,
  useOnlineStore,
} from "../../store/onlineStore";
import { useActionKey } from "../useActionKey";
import { useCountdownText } from "../useCountdownText";
import { ItemIcon } from "./itemLook";
import { itemName, itemsErrorText } from "./itemText";

/** What a gift gives, in words: "1 × Small energy drink", "€50,000", "10 coins". */
function rewardText(t: TFunction, language: string, reward: GiftReward): string {
  switch (reward.kind) {
    case "item":
      return t("online.items.dailyGift.item", {
        quantity: reward.quantity,
        item: itemName(t, reward.item),
      });
    case "cash":
      return formatExactMoney(reward.amount);
    case "coin":
      return t("online.items.dailyGift.coin", { amount: formatCoins(reward.amount, language) });
  }
}

function RewardIcon({ reward }: { reward: GiftReward }) {
  if (reward.kind === "item") return <ItemIcon code={reward.item} size="md" />;
  const Icon = reward.kind === "cash" ? Wallet : Coins;
  return (
    <span
      aria-hidden="true"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300"
    >
      <Icon className="h-5.5 w-5.5" />
    </span>
  );
}

/** The step given next today, when it is ready or waiting; none once the day is over. */
function stepNow(gift: DailyGiftStateView): DailyGiftStepView | undefined {
  const step = gift.next === undefined ? undefined : gift.steps[gift.next];
  return step && (step.state === "ready" || step.state === "waiting") ? step : undefined;
}

/** Why nothing is given now: the chain done, the day over before it, or no gift today. */
function overText(t: TFunction, gift: DailyGiftStateView): string {
  if (gift.steps.every((step) => step.state === "claimed")) {
    return t("online.items.dailyGift.doneToday");
  }
  return gift.steps.some((step) => step.state === "claimed")
    ? t("online.items.dailyGift.closed")
    : t("online.items.dailyGift.none");
}

/** The one gift to claim now: what it gives, and its button or the time left until it opens. */
function GiftStep({
  step,
  busy,
  onClaim,
}: {
  step: DailyGiftStepView;
  busy: boolean;
  onClaim: () => void;
}) {
  const { t, i18n } = useTranslation();
  const left = useCountdownText(step.state === "waiting" ? step.opensAt : undefined);
  const what = rewardText(t, i18n.language, step.reward);
  const ready = step.state === "ready";
  return (
    <div
      className={`flex min-h-14 items-center gap-3 rounded-lg border bg-white px-3 py-2 dark:bg-navy-800 ${
        ready
          ? "border-accent-400 ring-2 ring-accent-400/60 dark:ring-accent-400/40"
          : "border-gray-200 dark:border-navy-600"
      }`}
    >
      <RewardIcon reward={step.reward} />
      <span className="min-w-0 flex-1 truncate font-semibold text-gray-900 dark:text-gray-100">
        {what}
      </span>
      {ready ? (
        <Button
          type="button"
          size="sm"
          disabled={busy}
          aria-label={t("online.items.dailyGift.claimReward", { reward: what })}
          onClick={onClaim}
        >
          {t("online.items.dailyGift.claim")}
        </Button>
      ) : (
        left && (
          <span className="shrink-0 tabular-nums text-gray-700 dark:text-gray-300">
            {t("online.items.dailyGift.waiting", { time: left })}
          </span>
        )
      )}
    </div>
  );
}

/** No gift to give now: why, and the time left until the next one when the server says it. */
function DayOver({ gift }: { gift: DailyGiftStateView }) {
  const { t } = useTranslation();
  const left = useCountdownText(gift.nextAt);
  return (
    <p className="text-gray-700 dark:text-gray-300">
      {overText(t, gift)}
      {left && (
        <span className="tabular-nums"> · {t("online.items.dailyGift.newIn", { time: left })}</span>
      )}
    </p>
  );
}

/**
 * The daily gift chain (S-28 S28-9, C-12 C12-8, C-19 C19-1, C19-6): one gift at a time, the
 * step given next with its button once ready or the time left until it opens; once claimed,
 * the step after it. What is given and when are the server's; the card only says them.
 * Shown on the inventory page and in the extra training block, both reading the coach's items
 * from the store.
 */
export default function DailyGift() {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const gift = useOnlineStore((state) => state.items?.dailyGift);
  const offline = useOnlineStore((state) => state.network === "offline");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ failure: unknown; seen: DailyGiftStateView } | null>(null);
  const [given, setGiven] = useState<string | null>(null);
  const { run } = useActionKey();
  const now = useOnlineNow();
  // The next step's moment passed with no new read: read the items once for it.
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
      if (view.reward.kind === "cash") void refreshClub().catch(() => undefined);
      // Coins also arrive by the realtime channel; one read makes sure.
      if (view.reward.kind === "coin") void refreshCoins().catch(() => undefined);
      setGiven(
        t("online.items.dailyGift.given", { reward: rewardText(t, i18n.language, view.reward) }),
      );
    } catch (failure) {
      setError({ failure, seen: gift });
      // Claimed elsewhere, not open yet or the season closed: the stored view is stale.
      if (failure instanceof OnlineApiError && failure.status === 409) {
        void refreshItems().catch(() => undefined);
      }
    } finally {
      setSending(false);
    }
  };

  const shownError = error && error.seen === gift ? error.failure : null;
  const shown = stepNow(gift);
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-2.5 rounded-md border border-accent-400/60 bg-accent-50 px-3 py-2.5 text-sm text-gray-800 dark:border-accent-400/40 dark:bg-accent-500/10 dark:text-gray-100"
    >
      <div className="flex items-center justify-between gap-2">
        <h3
          id={titleId}
          className="flex items-center gap-2 font-heading text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-white"
        >
          <Gift
            className="h-4 w-4 shrink-0 text-accent-600 dark:text-accent-400"
            aria-hidden="true"
          />
          {t("online.items.dailyGift.title")}
        </h3>
        {shown && gift.next !== undefined && (
          <span className="shrink-0 text-xs tabular-nums text-gray-600 dark:text-gray-400">
            {t("online.items.dailyGift.step", {
              step: gift.next + 1,
              total: gift.steps.length,
            })}
          </span>
        )}
      </div>
      {shown ? (
        <GiftStep step={shown} busy={sending || offline} onClaim={() => void claim()} />
      ) : (
        <DayOver gift={gift} />
      )}
      {given && !shownError && <p role="status">{given}</p>}
      {shownError !== null && (
        <p role="alert" className="text-red-600 dark:text-red-400">
          {itemsErrorText(t, i18n.language, shownError)}
        </p>
      )}
    </section>
  );
}
