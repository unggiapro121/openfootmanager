import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { RewardView } from "../../api";
import { rewardText } from "./eventText";
import { rewardIcon } from "./RewardIcon";

/** The rays turning slowly behind a phone's reward (design m-su-kien.html), twelve of them. */
const RAYS = Array.from({ length: 12 }, (_, index) => index * 30);

function Rays() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 100"
      className="pointer-events-none absolute -top-17.5 left-1/2 hidden h-75 w-75 -translate-x-1/2 fill-accent-400 opacity-10 max-md:block motion-safe:animate-[spin_14s_linear_infinite]"
    >
      {RAYS.map((angle) => (
        <path key={angle} d="M50 50 L47 0 L53 0 Z" transform={`rotate(${angle} 50 50)`} />
      ))}
    </svg>
  );
}

/** Where the rewards went: the items to the inventory, the coins to the wallet. */
function whereKey(rewards: RewardView[]): string {
  const items = rewards.some((reward) => reward.item !== undefined);
  const coins = rewards.some((reward) => reward.coin !== undefined);
  if (items && coins) return "online.events.reward.toBoth";
  return coins ? "online.events.reward.toWallet" : "online.events.reward.toInventory";
}

/**
 * What a claim gave (design su-kien.html): the first reward's icon, every reward in words and where
 * they went. One button, which takes the focus; Escape closes it too. On a phone it glows gold,
 * rays turning behind it (design m-su-kien.html).
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
        className="relative flex w-full max-w-95 flex-col items-center gap-3.5 overflow-hidden rounded-2xl border border-gray-200 border-t-4 border-t-accent-400 bg-white px-6 pb-6 pt-7 text-center shadow-2xl max-md:max-w-85 max-md:gap-2.5 max-md:rounded-[20px] max-md:border-t max-md:border-accent-300 max-md:bg-[radial-gradient(120%_80%_at_50%_0%,var(--color-accent-100)_0%,var(--color-white)_60%)] max-md:px-5 max-md:pb-5 dark:border-navy-600 dark:border-t-accent-400 dark:bg-navy-700 max-md:dark:border-accent-900 max-md:dark:bg-[radial-gradient(120%_80%_at_50%_0%,color-mix(in_oklab,var(--color-accent-900)_55%,var(--color-navy-900))_0%,var(--color-navy-700)_60%)]"
      >
        <Rays />
        <span className="relative font-heading text-xs font-semibold uppercase tracking-widest text-accent-800 dark:text-accent-300">
          {t("online.events.reward.heading")}
        </span>
        <span className="relative flex h-28 w-28 items-center justify-center rounded-full border-3 border-accent-500 bg-accent-100 text-accent-800 ring-10 ring-accent-400/10 motion-safe:animate-reward-pop max-md:h-22 max-md:w-22 max-md:shadow-[0_0_32px_color-mix(in_oklab,var(--color-accent-400)_35%,transparent)] max-md:ring-0 dark:border-accent-400 dark:bg-accent-900/40 dark:text-accent-400 max-md:dark:bg-accent-900">
          <Icon className="h-13 w-13 max-md:h-10 max-md:w-10" aria-hidden="true" />
        </span>
        <h2
          id={titleId}
          className="relative mt-1 font-heading text-3xl font-bold uppercase leading-none tracking-wider text-gray-900 max-md:text-accent-800 dark:text-white max-md:dark:text-accent-400"
        >
          {rewards.map((reward) => rewardText(t, i18n.language, reward)).join(", ")}
        </h2>
        <p className="relative text-sm text-gray-600 max-md:text-[13px] dark:text-gray-400 max-md:dark:text-gray-300">
          {t(whereKey(rewards))}
          {expires?.expiresInDays !== undefined &&
            ` ${t("online.events.reward.expires", { days: expires.expiresInDays })}`}
        </p>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="relative h-12 w-full rounded-lg bg-primary-700 max-md:mt-2 max-md:rounded-[10px] font-heading text-base font-bold uppercase tracking-wider text-white hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-700 focus:ring-offset-2 max-md:focus:ring-0 max-md:focus-visible:ring-2 dark:focus:ring-offset-navy-700"
        >
          {t("online.events.reward.close")}
        </button>
      </div>
    </div>
  );
}
