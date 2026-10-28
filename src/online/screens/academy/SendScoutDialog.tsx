import { useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardModalFrame from "../../../components/dashboard/DashboardModalFrame";
import { Button } from "../../../components/ui";
import { formatExactMoney } from "../../../lib/valueFormatting";
import type { ScoutQuoteView } from "../../api";
import { online } from "../../client";
import { formatMoment } from "../../format";
import {
  refreshAcademy,
  refreshFinance,
  refreshItems,
  tracked,
  useOnlineStore,
} from "../../store/onlineStore";
import { useOnlineResource } from "../../useOnlineResource";
import { useActionKey } from "../useActionKey";
import {
  academyErrorText,
  academyRefusalText,
  regionName,
  SCOUT_FOCI,
  SCOUT_PAYS,
  SCOUT_REGIONS,
  type ScoutPay,
  scoutFocusName,
} from "./academyText";

/** The region a trip goes to by default: the club's own when a trip may go there. */
export function defaultRegion(clubRegion: string | undefined): string {
  return SCOUT_REGIONS.find((region) => region === clubRegion) ?? "Europe";
}

/**
 * The ways a trip may be paid now, as the quote says (C-7 C7-41): a ticket only while one is held,
 * the elite one only while the season has elite trips left, and no ticket while the inventory is
 * locked (the server refuses it, PO bản 4).
 */
export function payChoices(quote: ScoutQuoteView, itemsLocked: boolean): ScoutPay[] {
  return SCOUT_PAYS.filter((pay) => {
    if (pay === "cash") return true;
    if (itemsLocked) return false;
    if (pay === "scoutExpedition") return quote.tickets.scoutExpedition > 0;
    return quote.tickets.scoutExpeditionElite > 0 && quote.eliteTripsLeft > 0;
  });
}

/** A plain ticket when one is held, club money otherwise; the elite ticket is never the default. */
function defaultPay(choices: ScoutPay[]): ScoutPay {
  return choices.includes("scoutExpedition") ? "scoutExpedition" : "cash";
}

const CHOICE =
  "rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800";
const CHOSEN =
  "border-primary-500 bg-primary-50 text-primary-800 dark:border-primary-400 dark:bg-primary-500/10 dark:text-primary-200";
const NOT_CHOSEN =
  "border-gray-200 text-gray-700 hover:border-primary-400 dark:border-navy-600 dark:text-gray-200";

function Choices<T extends string>({
  label,
  values,
  chosen,
  name,
  onChoose,
}: {
  label: string;
  values: readonly T[];
  chosen: T;
  name: (value: T) => string;
  onChoose: (value: T) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-gray-800 dark:text-gray-100">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {values.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={value === chosen}
            className={`${CHOICE} ${value === chosen ? CHOSEN : NOT_CHOSEN}`}
            onClick={() => onChoose(value)}
          >
            {name(value)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Send a scouting trip (C-7 C7-41): where, what for, how it is paid. The quote is read again for
 * each region and focus; its refusal, when any, is the server's word and keeps the button off.
 * One key for one opening of the dialog, so a press retried after no answer sends the same trip.
 */
export default function SendScoutDialog({
  clubRegion,
  onClose,
}: {
  clubRegion: string | undefined;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const itemsLocked = useOnlineStore((state) => Boolean(state.items?.locked));
  const [region, setRegion] = useState(() => defaultRegion(clubRegion));
  const [focus, setFocus] = useState<string>("Balanced");
  const [pay, setPay] = useState<ScoutPay | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { run } = useActionKey();
  const { resource } = useOnlineResource(
    () => tracked(() => online.academy.quote(region, focus)),
    [region, focus],
  );
  const quote = resource.status === "ready" ? resource.data : null;
  const choices = quote ? payChoices(quote, itemsLocked) : [];
  const paying = pay && choices.includes(pay) ? pay : defaultPay(choices);

  const send = () => {
    setBusy(true);
    setError(null);
    run(
      (key) => tracked(() => online.academy.send({ region, focus, pay: paying }, key)),
      `${region}:${focus}:${paying}`,
    )
      .then((trip) => {
        useOnlineStore.setState((state) =>
          state.academy ? { academy: { ...state.academy, trip } } : {},
        );
        void refreshAcademy().catch(() => undefined);
        // The server does not ring the inventory when the academy spends a ticket (PO bản 4).
        if (paying === "cash") void refreshFinance().catch(() => undefined);
        else void refreshItems().catch(() => undefined);
        onClose();
      })
      .catch(setError)
      .finally(() => setBusy(false));
  };

  const payText = (value: ScoutPay): string => {
    if (!quote) return "";
    if (value === "cash")
      return t("online.academy.send.payCash", { cost: formatExactMoney(quote.cost) });
    if (value === "scoutExpedition") {
      return t("online.academy.send.payTicket", { held: quote.tickets.scoutExpedition });
    }
    return t("online.academy.send.payElite", { held: quote.tickets.scoutExpeditionElite });
  };

  return (
    <DashboardModalFrame maxWidthClassName="max-w-lg">
      <div role="dialog" aria-modal="true" aria-labelledby="scout-send-title" className="space-y-4">
        <h3
          id="scout-send-title"
          className="font-heading text-lg font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100"
        >
          {t("online.academy.send.title")}
        </h3>
        <Choices
          label={t("online.academy.send.region")}
          values={SCOUT_REGIONS}
          chosen={region as (typeof SCOUT_REGIONS)[number]}
          name={(value) => regionName(t, value)}
          onChoose={setRegion}
        />
        <Choices
          label={t("online.academy.send.focus")}
          values={SCOUT_FOCI}
          chosen={focus as (typeof SCOUT_FOCI)[number]}
          name={(value) => scoutFocusName(t, value)}
          onChoose={setFocus}
        />
        {resource.status === "loading" && (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("online.loading")}</p>
        )}
        {resource.status === "failed" && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {academyErrorText(t, i18n.language, resource.error)}
          </p>
        )}
        {quote && (
          <>
            <Choices
              label={t("online.academy.send.pay")}
              values={choices}
              chosen={paying}
              name={payText}
              onChoose={setPay}
            />
            {itemsLocked && (
              <p role="note" className="text-xs text-gray-600 dark:text-gray-400">
                {t("online.academy.itemsLocked")}
              </p>
            )}
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {t("online.academy.send.back", { time: formatMoment(quote.readyAt, i18n.language) })}
            </p>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {t("online.academy.send.left", {
                trips: quote.tripsLeft,
                elite: quote.eliteTripsLeft,
              })}
            </p>
            {quote.refusal && (
              <p role="note" className="text-sm text-red-600 dark:text-red-400">
                {academyRefusalText(t, i18n.language, quote.refusal)}
              </p>
            )}
          </>
        )}
        {error !== null && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {academyErrorText(t, i18n.language, error)}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy || !quote || quote.refusal !== undefined}
            onClick={send}
          >
            {t("online.academy.send.confirm")}
          </Button>
        </div>
      </div>
    </DashboardModalFrame>
  );
}
