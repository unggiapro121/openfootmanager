import { type KeyboardEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Ticket } from "lucide-react";
import { formatCount, formatPermille, formatVal } from "../../../../lib/valueFormatting";
import type { MatchdayView, TicketPriceView } from "../../../api";
import { online } from "../../../client";
import { tracked } from "../../../store/onlineStore";
import { FOCUS } from "../../mobile/PhoneSheet";
import { useActionKey } from "../../useActionKey";
import { useWritesOff } from "../FacilityCard";
import { refusalText } from "../useFacilityWrite";

/** The four ticket prices, cheapest first, as the server names them (S-49c). */
export const TICKET_PRICES: readonly TicketPriceView[] = ["low", "medium", "high", "veryHigh"];

/**
 * The ticket price of the club's home league matches (c-27 §7.1, C27-19): four choices, and what
 * the next home match would draw and earn at the one shown, as the server worked it out for each,
 * so choosing only changes the line shown. A choice is sent at once; the answer is kept and named
 * in a toast. Off with every other write (T4).
 */
export function TicketPriceCard({
  matchday,
  onAnswered,
  onToast,
}: {
  matchday: MatchdayView;
  onAnswered: (view: MatchdayView) => void;
  onToast: (message: string) => void;
}) {
  const { t } = useTranslation();
  const writesOff = useWritesOff();
  const action = useActionKey();
  const [shown, setShown] = useState<TicketPriceView>(matchday.ticketPrice);
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<unknown>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const priceName = (price: TicketPriceView) => t(`online.facilities.ticket.price.${price}`);

  const choose = async (price: TicketPriceView) => {
    if (price === matchday.ticketPrice && price === shown) return;
    setShown(price);
    setSending(true);
    setRefusal(null);
    try {
      const answer = await action.run(
        (key) => tracked(() => online.finance.setTicketPrice(price, key)),
        price,
      );
      onAnswered(answer);
      const opponent = answer.appliesFrom?.opponent.shortName;
      onToast(
        opponent
          ? t("online.facilities.ticket.toast", { price: priceName(price), opponent })
          : t("online.facilities.ticket.toastNoMatch", { price: priceName(price) }),
      );
    } catch (error) {
      setShown(matchday.ticketPrice);
      setRefusal(error);
    } finally {
      setSending(false);
    }
  };

  // Arrows move between the prices, as in a radio group; choosing stays a press, so walking past
  // a price never sends it.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = (index + step + TICKET_PRICES.length) % TICKET_PRICES.length;
    buttons.current[next]?.focus();
  };

  const projection = matchday.next?.projections.find((line) => line.price === shown);
  return (
    <article
      aria-labelledby="facilities-ticket-title"
      className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-navy-600 dark:bg-navy-800"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h3
          id="facilities-ticket-title"
          className="flex items-center gap-2 font-heading text-base font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100"
        >
          <Ticket className="h-4 w-4 text-accent-600 dark:text-accent-400" aria-hidden="true" />
          {t("online.facilities.ticket.title")}
        </h3>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {t("online.facilities.ticket.hint")}
        </span>
      </div>
      <div
        role="radiogroup"
        aria-label={t("online.facilities.ticket.title")}
        className="grid grid-cols-4 gap-1 rounded-lg bg-gray-100 p-1 dark:bg-navy-900"
      >
        {TICKET_PRICES.map((price, index) => (
          <button
            key={price}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={shown === price}
            tabIndex={shown === price ? 0 : -1}
            disabled={writesOff !== null || sending}
            onClick={() => void choose(price)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`min-h-11 rounded-md px-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${shown === price ? "bg-white text-gray-900 shadow-sm dark:bg-navy-700 dark:text-white" : "text-gray-600 enabled:hover:bg-white/60 dark:text-gray-300 dark:enabled:hover:bg-navy-700/60"} ${FOCUS}`}
          >
            {priceName(price)}
          </button>
        ))}
      </div>
      {matchday.next && projection && (
        <div className="flex flex-col gap-1 rounded-lg bg-gray-50 p-2.5 dark:bg-navy-900">
          <span className="truncate text-xs text-gray-500 dark:text-gray-400">
            {t("online.facilities.ticket.opponent", {
              opponent: matchday.next.opponent.shortName,
              day: matchday.next.day,
            })}
          </span>
          <span className="text-sm tabular-nums text-gray-900 dark:text-white">
            {t("online.facilities.ticket.crowd", {
              attendance: formatCount(projection.attendance),
              fill: formatPermille(projection.fillPermille),
            })}
          </span>
          <span className="text-sm tabular-nums text-gray-700 dark:text-gray-300">
            {t("online.facilities.ticket.revenue", { amount: formatVal(projection.revenue) })}
            {projection.soldOut &&
              t("online.facilities.ticket.soldOut", { count: formatCount(projection.lockedOut) })}
          </span>
        </div>
      )}
      {refusal !== null && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-300">
          {refusalText(t, refusal)}
        </p>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {t("online.facilities.ticket.note")}
      </p>
    </article>
  );
}
