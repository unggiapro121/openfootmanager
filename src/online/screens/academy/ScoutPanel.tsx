import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, BadgeCheck, Search, Sparkles } from "lucide-react";
import { ProgressBar } from "../../../components/ui";
import { formatExactMoney } from "../../../lib/valueFormatting";
import type { AcademyView, ScoutQuoteView, ScoutTripView } from "../../api";
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
import { heldOf } from "../items/OnlineShop";
import { LABEL } from "../overview/OverviewCard";
import { useActionKey } from "../useActionKey";
import { useCountdownText } from "../useCountdownText";
import { freeSlots } from "./AcademyFigures";
import AcademyConfirm from "./AcademyConfirm";
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
import ReportDialog from "./ReportDialog";
import TripLine from "./TripLine";

/** The region a trip goes to by default: the club's own when a trip may go there. */
function defaultRegion(clubRegion: string | undefined): string {
  return SCOUT_REGIONS.find((region) => region === clubRegion) ?? "Europe";
}

/**
 * The ways a trip may be paid now, as the quote says (C-7 C7-41): a ticket only while one is held,
 * the elite one only while the season has elite trips left, and no ticket while the inventory is
 * locked (the server refuses it, PO bản 4).
 */
function payChoices(quote: ScoutQuoteView, itemsLocked: boolean): ScoutPay[] {
  return SCOUT_PAYS.filter((pay) => {
    if (pay === "cash") return true;
    if (itemsLocked) return false;
    if (pay === "scoutExpedition") return quote.tickets.scoutExpedition > 0;
    return quote.tickets.scoutExpeditionElite > 0 && quote.eliteTripsLeft > 0;
  });
}

const ELITE: ScoutPay = "scoutExpeditionElite";

/** A plain ticket when one is held, club money otherwise. */
function defaultPay(choices: ScoutPay[]): ScoutPay {
  return choices.includes("scoutExpedition") ? "scoutExpedition" : "cash";
}

const CHIP = "rounded-lg border px-3 text-sm font-semibold";
const CHIP_ON =
  "border-primary-500 bg-primary-50 text-primary-800 dark:border-primary-500 dark:bg-primary-900/40 dark:text-primary-300";
const CHIP_OFF =
  "border-gray-300 text-gray-700 hover:border-primary-500 dark:border-navy-600 dark:text-gray-300 dark:hover:border-primary-500";

/** One choice of a few, each a chip over a native radio (design HocVien.dc.html). */
function ChipGroup<T extends string>({
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
  const group = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={`mb-2 ${LABEL}`}>{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {values.map((value) => (
          <label
            key={value}
            className={`flex min-h-9 cursor-pointer items-center py-1.5 focus-within:ring-2 focus-within:ring-primary-500 focus-within:ring-offset-2 dark:focus-within:ring-offset-navy-800 ${CHIP} ${value === chosen ? CHIP_ON : CHIP_OFF}`}
          >
            <input
              type="radio"
              name={group}
              value={value}
              checked={value === chosen}
              onChange={() => onChoose(value)}
              className="sr-only"
            />
            {name(value)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** A season's trips against their cap, as a bar. */
function TripGauge({
  label,
  sent,
  max,
  tone,
}: {
  label: string;
  sent: number;
  max: number;
  tone: "primary" | "accent";
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex justify-between text-xs text-gray-600 dark:text-gray-400">
        {label}
        <strong className="tabular-nums text-gray-900 dark:text-white">
          {sent}/{max}
        </strong>
      </span>
      <ProgressBar value={max > 0 ? (sent / max) * 100 : 0} variant={tone} />
    </div>
  );
}

/**
 * The academy's scouting (C-7 C7-39…C7-42, design HocVien.dc.html): the season's trips, a new one
 * chosen and sent from the panel, and the trip out or the report back below it.
 */
export default function ScoutPanel({
  academy,
  clubRegion,
}: {
  academy: AcademyView;
  clubRegion: string | undefined;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const max = academy.maxTripsPerSeason;
  const eliteMax = academy.maxEliteTripsPerSeason;
  return (
    <section
      aria-labelledby={titleId}
      className="min-w-0 flex-[1_1_320px] self-start overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-navy-600 dark:bg-navy-700 dark:shadow-md"
    >
      <div className="flex items-center gap-2.5 border-b border-gray-200 bg-gradient-to-b from-white to-gray-50 px-6 py-3.5 dark:border-navy-600 dark:from-navy-700 dark:to-navy-800">
        <Search className="h-5 w-5 text-primary-600 dark:text-primary-400" aria-hidden="true" />
        <h2
          id={titleId}
          className="font-heading text-lg font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100"
        >
          {t("online.academy.scout.title")}
        </h2>
      </div>
      <div className="flex flex-col gap-5 px-6 py-5">
        {max !== undefined && (
          <div className="grid grid-cols-2 gap-3">
            <TripGauge
              label={t("online.academy.scout.normal")}
              sent={academy.tripsThisSeason}
              max={max}
              tone="primary"
            />
            <TripGauge
              label={t("online.academy.scout.elite")}
              sent={academy.eliteTripsThisSeason}
              max={eliteMax ?? 0}
              tone="accent"
            />
          </div>
        )}
        <SendForm academy={academy} clubRegion={clubRegion} />
        <Reports academy={academy} />
      </div>
    </section>
  );
}

/** One of a trip's two kinds, plain or elite, over a native radio. */
function KindChoice({
  group,
  label,
  left,
  checked,
  disabled,
  elite = false,
  onChoose,
}: {
  group: string;
  label: string;
  left: string;
  checked: boolean;
  disabled: boolean;
  elite?: boolean;
  onChoose: () => void;
}) {
  const on = elite
    ? "border-accent-400 bg-accent-50 dark:border-accent-400 dark:bg-accent-900/40"
    : "border-primary-500 bg-primary-50 dark:border-primary-500 dark:bg-primary-900/40";
  return (
    <label
      className={`flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2.5 text-left focus-within:ring-2 focus-within:ring-primary-500 focus-within:ring-offset-2 dark:focus-within:ring-offset-navy-800 ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      } ${
        checked
          ? on
          : "border-gray-300 bg-gray-50 hover:border-primary-500 dark:border-navy-600 dark:bg-navy-900 dark:hover:border-primary-500"
      }`}
    >
      <input
        type="radio"
        name={group}
        checked={checked}
        disabled={disabled}
        onChange={onChoose}
        className="sr-only"
      />
      <span
        className={`inline-flex items-center gap-1 font-heading text-[15px] font-bold uppercase tracking-wider ${
          elite ? "text-accent-700 dark:text-accent-400" : "text-gray-900 dark:text-white"
        }`}
      >
        {elite && <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
        {label}
      </span>
      <span className="text-xs text-gray-500 dark:text-gray-400">{left}</span>
    </label>
  );
}

/**
 * Where a trip goes, what it looks for, its kind and how it is paid. The quote is read again for
 * each region and focus, and when the trip out changes; its refusal, when any, is the server's
 * word and keeps the button off. One key for one choice, so a press retried after no answer sends
 * the same trip.
 */
function SendForm({
  academy,
  clubRegion,
}: {
  academy: AcademyView;
  clubRegion: string | undefined;
}) {
  const { t, i18n } = useTranslation();
  const itemsLocked = useOnlineStore((state) => Boolean(state.items?.locked));
  const [region, setRegion] = useState(() => defaultRegion(clubRegion));
  const [focus, setFocus] = useState<string>("Balanced");
  const [kind, setKind] = useState<"normal" | "elite">("normal");
  const [pay, setPay] = useState<ScoutPay | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { run } = useActionKey();
  const tripId = academy.trip?.id ?? "";
  const { resource } = useOnlineResource(
    () => tracked(() => online.academy.quote(region, focus)),
    [region, focus, tripId],
  );
  const quote = resource.status === "ready" ? resource.data : null;
  const choices = quote ? payChoices(quote, itemsLocked) : [];
  const plainPays = choices.filter((choice) => choice !== ELITE);
  const eliteOpen = choices.includes(ELITE);
  const elite = kind === "elite" && eliteOpen;
  const paying: ScoutPay = elite
    ? ELITE
    : pay && plainPays.includes(pay)
      ? pay
      : defaultPay(plainPays);

  const max = academy.maxTripsPerSeason;
  const eliteMax = academy.maxEliteTripsPerSeason ?? 0;
  const tripsLeft = max === undefined ? undefined : Math.max(0, max - academy.tripsThisSeason);
  const eliteLeft = Math.max(0, eliteMax - academy.eliteTripsThisSeason);
  const noneLeft = elite ? eliteLeft === 0 : tripsLeft === 0;
  const full = freeSlots(academy) === 0;

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
      })
      .catch(setError)
      .finally(() => setBusy(false));
  };

  const payText = (value: ScoutPay): string => {
    if (!quote) return "";
    if (value === "cash")
      return t("online.academy.send.payCash", { cost: formatExactMoney(quote.cost) });
    return t("online.academy.send.payTicket", { held: quote.tickets.scoutExpedition });
  };

  const kindGroup = useId();
  return (
    <>
      <fieldset className="flex flex-col gap-2">
        <legend className={`mb-2 ${LABEL}`}>{t("online.academy.scout.kind")}</legend>
        <div className="grid grid-cols-2 gap-2">
          <KindChoice
            group={kindGroup}
            label={t("online.academy.scout.normal")}
            left={tripsLeft === undefined ? "" : t("online.academy.scout.left", { n: tripsLeft })}
            checked={!elite}
            disabled={false}
            onChoose={() => setKind("normal")}
          />
          <KindChoice
            group={kindGroup}
            label={t("online.academy.scout.elite")}
            left={t("online.academy.scout.eliteLeft", {
              n: eliteLeft,
              held: quote?.tickets.scoutExpeditionElite ?? 0,
            })}
            checked={elite}
            disabled={!eliteOpen}
            elite
            onChoose={() => setKind("elite")}
          />
        </div>
      </fieldset>
      <ChipGroup
        label={t("online.academy.send.region")}
        values={SCOUT_REGIONS}
        chosen={region as (typeof SCOUT_REGIONS)[number]}
        name={(value) => regionName(t, value)}
        onChoose={setRegion}
      />
      <ChipGroup
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
      {quote && !elite && (
        <ChipGroup
          label={t("online.academy.send.pay")}
          values={plainPays}
          chosen={paying}
          name={payText}
          onChoose={setPay}
        />
      )}
      {quote && elite && (
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {t("online.academy.send.payElite", { held: quote.tickets.scoutExpeditionElite })}
        </p>
      )}
      {itemsLocked && (
        <p role="note" className="text-xs text-gray-600 dark:text-gray-400">
          {t("online.academy.itemsLocked")}
        </p>
      )}
      {academy.slots > 0 && full && (
        <Callout>
          {t("online.academy.scout.full", { used: academy.used, slots: academy.slots })}
        </Callout>
      )}
      {quote?.refusal && (
        <p role="note" className="text-sm text-red-600 dark:text-red-400">
          {academyRefusalText(t, i18n.language, quote.refusal)}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {academyErrorText(t, i18n.language, error)}
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={send}
          disabled={busy || noneLeft || !quote || quote.refusal !== undefined}
          className="h-12 rounded-lg bg-primary-700 font-heading text-base font-bold uppercase tracking-wider text-white shadow-md hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary-700 dark:focus:ring-offset-navy-800"
        >
          {noneLeft
            ? t("online.academy.scout.noTripsLeft")
            : elite
              ? t("online.academy.scout.sendElite")
              : t("online.academy.scout.sendNormal")}
        </button>
        {quote && !noneLeft && quote.refusal === undefined && (
          <span className="text-center text-xs text-gray-500 dark:text-gray-400">
            {t("online.academy.send.back", { time: formatMoment(quote.readyAt, i18n.language) })}
          </span>
        )}
      </div>
    </>
  );
}

function Callout({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2.5 rounded-lg bg-accent-100 p-3 text-[13px] leading-snug text-accent-800 dark:bg-accent-900/40 dark:text-accent-300">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** The trip out or the report back, under the panel's own head. */
function Reports({ academy }: { academy: AcademyView }) {
  const { t } = useTranslation();
  const trip = academy.trip;
  return (
    <div className="flex flex-col gap-2 border-t border-gray-200 pt-4 dark:border-navy-600">
      <span className={LABEL}>{t("online.academy.scout.reports")}</span>
      {!trip && (
        <p className="text-[13px] text-gray-500 dark:text-gray-400">
          {t("online.academy.scout.noReport")}
        </p>
      )}
      {trip?.status === "pending" && <TripOut trip={trip} />}
      {trip?.status === "ready" && <ReportBack academy={academy} trip={trip} />}
    </div>
  );
}

const ROW =
  "flex flex-col gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-navy-600 dark:bg-navy-900";

/** A trip out: when it is back on the server's clock, and an hourglass while one is held. */
function TripOut({ trip }: { trip: ScoutTripView }) {
  const { t, i18n } = useTranslation();
  const offset = useOnlineStore((state) => state.academyOffsetMs);
  const items = useOnlineStore((state) => state.items);
  const left = useCountdownText(trip.readyAt, offset);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { run } = useActionKey();
  const hourglasses = heldOf(items, "timeSkip");

  const skip = () => {
    setBusy(true);
    setError(null);
    run((key) => tracked(() => online.academy.timeSkip(trip.id, key)), trip.id)
      .then((back) => {
        useOnlineStore.setState((state) =>
          state.academy ? { academy: { ...state.academy, trip: back } } : {},
        );
        void refreshAcademy().catch(() => undefined);
        void refreshItems().catch(() => undefined);
      })
      .catch(setError)
      .finally(() => {
        setBusy(false);
        setAsking(false);
      });
  };

  return (
    <div className={ROW}>
      <span className="flex items-center gap-2.5">
        <Search
          className="h-4 w-4 shrink-0 text-primary-600 dark:text-primary-400"
          aria-hidden="true"
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <TripLine trip={trip} />
          <span className="font-heading text-lg font-bold tabular-nums text-gray-900 dark:text-white">
            {left
              ? t("online.academy.scout.backIn", { time: left })
              : t("online.academy.scout.backSoon")}
          </span>
        </span>
      </span>
      {/* At zero the server refuses an hourglass (tripNotPending): the report is being drawn. */}
      {left && hourglasses > 0 && (
        <button
          type="button"
          disabled={busy || Boolean(items?.locked)}
          onClick={() => setAsking(true)}
          className="h-9 self-start rounded-lg border border-gray-300 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-navy-600 dark:text-gray-300 dark:hover:bg-navy-600 dark:focus:ring-offset-navy-800"
        >
          {t("online.academy.scout.timeSkip", { held: hourglasses })}
        </button>
      )}
      {left && hourglasses > 0 && items?.locked && (
        <p role="note" className="text-xs text-gray-600 dark:text-gray-400">
          {t("online.academy.itemsLocked")}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {academyErrorText(t, i18n.language, error)}
        </p>
      )}
      {asking && (
        <AcademyConfirm
          title={t("online.academy.scout.timeSkip", { held: hourglasses })}
          text={t("online.academy.scout.timeSkipConfirm")}
          busy={busy}
          onCancel={() => setAsking(false)}
          onConfirm={skip}
        />
      )}
    </div>
  );
}

/** A report back: its candidates and when it closes, opened to choose from. */
function ReportBack({ academy, trip }: { academy: AcademyView; trip: ScoutTripView }) {
  const { t } = useTranslation();
  const offset = useOnlineStore((state) => state.academyOffsetMs);
  const closes = useCountdownText(trip.closesAt, offset);
  const [open, setOpen] = useState(false);
  return (
    <div className={ROW}>
      <span className="flex items-center gap-2.5">
        <BadgeCheck
          className="h-4 w-4 shrink-0 text-primary-600 dark:text-primary-400"
          aria-hidden="true"
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[13px] font-semibold text-gray-900 dark:text-white">
            {t("online.academy.report.back", { n: trip.candidates.length })}
          </span>
          <TripLine trip={trip} />
        </span>
        {closes && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t("online.academy.report.closesIn", { time: closes })}
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-9 rounded-lg bg-primary-700 px-3 font-heading text-sm font-bold uppercase tracking-wider text-white hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-700 focus:ring-offset-2 dark:focus:ring-offset-navy-800"
      >
        {t("online.academy.report.open")}
      </button>
      {open && <ReportDialog academy={academy} trip={trip} onClose={() => setOpen(false)} />}
    </div>
  );
}
