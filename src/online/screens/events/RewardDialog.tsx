import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { RewardView } from "../../api";
import { rewardText } from "./eventText";
import { rewardIcon } from "./RewardIcon";

/** Where the rewards went: the items to the inventory, the coins to the wallet. */
function whereKey(rewards: RewardView[]): string {
  const items = rewards.some((reward) => reward.item !== undefined);
  const coins = rewards.some((reward) => reward.coin !== undefined);
  if (items && coins) return "online.events.reward.toBoth";
  return coins ? "online.events.reward.toWallet" : "online.events.reward.toInventory";
}

/**
 * What a claim gave (design su-kien.html): the first reward's icon, every reward in words and where
 * they went. One button, which takes the focus; Escape closes it too.
 */
export default function RewardDialog({
  rewards,
  onClose,
}: {
  rewards: RewardView[];
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const Icon = rewardIcon(rewards[0]);
  const expires = rewards.find((reward) => reward.expiresInDays !== undefined);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      // The only control: Tab stays on it, never on the page behind.
      if (event.key === "Tab") {
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex w-full max-w-95 flex-col items-center gap-3.5 rounded-2xl border border-gray-200 border-t-4 border-t-accent-400 bg-white px-6 pb-6 pt-7 text-center shadow-2xl dark:border-navy-600 dark:border-t-accent-400 dark:bg-navy-700"
      >
        <span className="font-heading text-xs font-semibold uppercase tracking-widest text-accent-800 dark:text-accent-300">
          {t("online.events.reward.heading")}
        </span>
        <span className="flex h-28 w-28 items-center justify-center rounded-full border-3 border-accent-500 bg-accent-100 text-accent-800 ring-10 ring-accent-400/10 motion-safe:animate-reward-pop dark:border-accent-400 dark:bg-accent-900/40 dark:text-accent-400">
          <Icon className="h-13 w-13" aria-hidden="true" />
        </span>
        <h2
          id={titleId}
          className="font-heading text-3xl font-bold uppercase leading-none tracking-wider text-gray-900 dark:text-white"
        >
          {rewards.map((reward) => rewardText(t, i18n.language, reward)).join(", ")}
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t(whereKey(rewards))}
          {expires?.expiresInDays !== undefined &&
            ` ${t("online.events.reward.expires", { days: expires.expiresInDays })}`}
        </p>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="h-12 w-full rounded-lg bg-primary-700 font-heading text-base font-bold uppercase tracking-wider text-white hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-700 focus:ring-offset-2 dark:focus:ring-offset-navy-700"
        >
          {t("online.events.reward.close")}
        </button>
      </div>
    </div>
  );
}
