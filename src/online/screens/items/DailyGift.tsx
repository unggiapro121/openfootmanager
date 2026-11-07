import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Check, Coins, Gift, Wallet } from "lucide-react";
import { Button } from "../../../components/ui";
import { formatExactMoney } from "../../../lib/valueFormatting";
import type { DailyGiftStateView, DailyGiftStepView, GiftReward } from "../../api";
import { online } from "../../client";
import { useOnlineNow } from "../../clock";
import { OnlineApiError } from "../../errors";
import { formatCoins, formatMoment } from "../../format";
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

const CELL: Record<DailyGiftStepView["state"], string> = {
  claimed: "border-gray-200 opacity-60 dark:border-navy-600",
  ready:
    "border-accent-400 ring-2 ring-accent-400/60 dark:border-accent-400 dark:ring-accent-400/40",
  waiting: "border-gray-200 dark:border-navy-600",
  later: "border-gray-200 dark:border-navy-600",
  closed: "border-gray-200 opacity-50 dark:border-navy-600",
};

/** One step of the chain: what it gives and where it stands, with the button on the step ready. */
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
  return (
    <li
      className={`flex min-h-11 items-center gap-2.5 rounded-lg border bg-white px-2.5 py-2 dark:bg-navy-800 ${CELL[step.state]}`}
    >
      <RewardIcon reward={step.reward} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-semibold text-gray-900 dark:text-gray-100">{what}</span>
        {step.state === "claimed" && (
          <span className="flex items-center gap-1 text-xs text-primary-700 dark:text-primary-300">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            {t("online.items.dailyGift.claimed")}
          </span>
        )}
        {step.state === "waiting" && left && (
          <span className="text-xs tabular-nums text-gray-600 dark:text-gray-400">
            {t("online.items.dailyGift.waiting", { time: left })}
          </span>
        )}
        {step.state === "closed" && (
          <span className="text-xs text-gray-600 dark:text-gray-400">
            {t("online.items.dailyGift.closed")}
          </span>
        )}
      </span>
      {step.state === "ready" && (
        <Button
          type="button"
          size="sm"
          disabled={busy}
          aria-label={t("online.items.dailyGift.claimReward", { reward: what })}
          onClick={onClaim}
        >
          {t("online.items.dailyGift.claim")}
        </Button>
      )}
    </li>
  );
}

/** The line under the steps: when the next gift comes, that the day is done, or no gift today. */
function summaryOf(t: TFunction, language: string, gift: DailyGiftStateView): string | null {
  if (gift.available) return null;
  const time = gift.nextAt ? formatMoment(gift.nextAt, language) : null;
  if (gift.next !== undefined) {
    return time ? t("online.items.dailyGift.next", { time }) : null;
  }
  if (!gift.steps.some((step) => step.state === "claimed")) {
    return t("online.items.dailyGift.none");
  }
  return time ? t("online.items.dailyGift.done", { time }) : t("online.items.dailyGift.doneToday");
}

/**
 * The daily gift chain (S-28 S28-9, C-12 C12-8, C-19 C19-1): today's steps in order, the one
 * ready with its button, the one waiting with its countdown. What is given and when are the
 * server's; the card only says them. Shown on the inventory page and in the extra training
 * block, both reading the coach's items from the store.
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
  const summary = summaryOf(t, i18n.language, gift);
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-2.5 rounded-md border border-accent-400/60 bg-accent-50 px-3 py-2.5 text-sm text-gray-800 dark:border-accent-400/40 dark:bg-accent-500/10 dark:text-gray-100"
    >
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
      <ol className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {gift.steps.map((step, index) => (
          <GiftStep
            key={index}
            step={step}
            busy={sending || offline}
            onClaim={() => void claim()}
          />
        ))}
      </ol>
      {summary && <p className="text-gray-700 dark:text-gray-300">{summary}</p>}
      {given && !shownError && <p role="status">{given}</p>}
      {shownError !== null && (
        <p role="alert" className="text-red-600 dark:text-red-400">
          {itemsErrorText(t, i18n.language, shownError)}
        </p>
      )}
    </section>
  );
}
