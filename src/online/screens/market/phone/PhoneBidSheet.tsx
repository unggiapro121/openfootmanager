import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Minus, Plus } from "lucide-react";
import { formatExactMoney, formatVal } from "../../../../lib/valueFormatting";
import type { AuctionView } from "../../../api";
import { useOnlineStore } from "../../../store/onlineStore";
import { FOCUS, PhoneSheet } from "../../mobile/PhoneSheet";
import { marketErrorText } from "../marketText";
import MoneyInput from "../MoneyInput";
import { bidProblem, CONFIRM_SHARE_OF_CASH, useBidSender } from "../useBid";
import { KEY, TimerChip } from "./AuctionCard";

const STEP = `flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-900 disabled:opacity-40 dark:border-navy-700 dark:bg-navy-900 dark:text-white ${FOCUS}`;

/**
 * The bid sheet (design m-cho-chi-tiet): the amount with a step down and up, the quick picks
 * (least, one step more, the cap), why the server would refuse it, the cash left after a win, and
 * the button. A big bid, or one at the cap, asks first in the sheet itself.
 */
export function PhoneBidSheet({
  view,
  offset,
  onView,
  reload,
  onClose,
}: {
  view: AuctionView;
  offset: number;
  onView: (view: AuctionView) => void;
  reload: () => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const cash = useOnlineStore((state) => state.finance?.cash);
  const [amount, setAmount] = useState<number | null>(view.minNextBid);
  const [asking, setAsking] = useState(false);
  const { send, busy, error } = useBidSender(view, onView, reload);

  useEffect(() => setAmount(view.minNextBid), [view.minNextBid]);
  useEffect(() => setAsking(false), [amount]);

  const [least, next] = view.nextSteps;
  const step = least !== undefined && next !== undefined ? next - least : 0;
  const problem = bidProblem(amount, view, cash);
  const atCap = amount === view.priceCap;
  const needsConfirm =
    amount !== null && (atCap || (cash !== undefined && amount >= cash * CONFIRM_SHARE_OF_CASH));
  const quick = [
    { label: t("online.market.quick.least"), value: least ?? view.minNextBid },
    { label: t("online.market.quick.step"), value: next },
    { label: t("online.market.quick.cap"), value: view.priceCap },
  ].filter(
    (choice, index, all): choice is { label: string; value: number } =>
      choice.value !== undefined && all.findIndex((one) => one.value === choice.value) === index,
  );
  const place = () => {
    if (amount === null || problem) return;
    if (needsConfirm && !asking) setAsking(true);
    else send(amount, onClose);
  };

  return (
    <PhoneSheet
      title={t(`${KEY}.bidTitle`, {
        name: view.player?.fullName ?? t("online.market.retiredPlayer"),
      })}
      aside={<TimerChip endsAt={view.endsAt} offset={offset} active={view.status === "active"} />}
      onClose={onClose}
    >
      <div className="flex items-end gap-2">
        <button
          type="button"
          aria-label={t(`${KEY}.stepDown`)}
          disabled={step === 0 || amount === null || amount - step < view.minNextBid}
          onClick={() =>
            setAmount((value) => Math.max(view.minNextBid, (value ?? view.minNextBid) - step))
          }
          className={STEP}
        >
          <Minus className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <MoneyInput label={t("online.market.yourBid")} value={amount} onChange={setAmount} />
        </div>
        <button
          type="button"
          aria-label={t(`${KEY}.stepUp`)}
          disabled={step === 0 || (amount ?? 0) + step > view.priceCap}
          onClick={() =>
            setAmount((value) => Math.min(view.priceCap, (value ?? view.minNextBid) + step))
          }
          className={STEP}
        >
          <Plus className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {quick.map((choice) => {
          const on = choice.value === amount;
          return (
            <button
              key={choice.label}
              type="button"
              aria-pressed={on}
              onClick={() => setAmount(choice.value)}
              className={`flex min-h-12 flex-col items-center justify-center rounded-[10px] border px-1 text-xs ${on ? "border-primary-500 bg-primary-50 dark:bg-primary-900/40" : "border-gray-200 bg-white dark:border-navy-700 dark:bg-navy-900"} ${FOCUS}`}
            >
              <span className="text-gray-500 dark:text-gray-400">{choice.label}</span>
              <span className="font-heading text-sm font-bold text-gray-900 dark:text-white">
                {formatVal(choice.value)}
              </span>
            </button>
          );
        })}
      </div>
      {problem && amount !== null ? (
        <p className="text-xs text-red-600 dark:text-red-400">
          {t(`online.market.problem.${problem}`, {
            minimum: formatExactMoney(view.minNextBid),
            cap: formatExactMoney(view.priceCap),
            cash: formatExactMoney(cash ?? 0),
          })}
        </p>
      ) : (
        atCap && (
          <p className="text-xs text-accent-800 dark:text-accent-300">
            {t("online.market.capTieExplain")}
          </p>
        )
      )}
      {cash !== undefined && amount !== null && (
        <p className="flex items-center justify-between rounded-[10px] bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:bg-navy-900 dark:text-gray-300">
          {t(`${KEY}.afterWin`)}
          <strong
            className={`font-heading text-base ${cash - amount < 0 ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-white"}`}
          >
            {formatVal(cash - amount)}
          </strong>
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {marketErrorText(t, i18n.language, error)}
        </p>
      )}
      {asking && amount !== null ? (
        <div
          role="alertdialog"
          aria-label={t("online.market.confirmTitle")}
          className="flex flex-col gap-2.5 rounded-xl border border-accent-300 bg-accent-50 p-3 dark:border-accent-500/40 dark:bg-accent-500/10"
        >
          <p className="text-sm text-gray-800 dark:text-gray-100">
            {t("online.market.confirmBody", { amount: formatExactMoney(amount) })}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setAsking(false)}
              className={`h-11 rounded-xl border border-gray-300 bg-white text-sm font-semibold text-gray-800 dark:border-navy-600 dark:bg-navy-800 dark:text-gray-200 ${FOCUS}`}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={place}
              className={`h-11 rounded-xl bg-primary-700 text-sm font-bold text-white disabled:opacity-50 dark:bg-primary-600 ${FOCUS}`}
            >
              {t("online.market.confirmBid")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy || problem !== null}
          onClick={place}
          className={`h-12 rounded-xl font-heading text-base font-bold uppercase tracking-wider disabled:cursor-not-allowed disabled:opacity-50 ${atCap ? "bg-accent-400 text-navy-900" : "bg-primary-700 text-white dark:bg-primary-600"} ${FOCUS}`}
        >
          {t(`${KEY}.place`, { amount: amount === null ? "–" : formatVal(amount) })}
        </button>
      )}
    </PhoneSheet>
  );
}
