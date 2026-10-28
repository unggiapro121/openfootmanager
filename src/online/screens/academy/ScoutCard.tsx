import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button, Card, CardBody, CardHeader, CountryFlag } from "../../../components/ui";
import { countryName } from "../../../lib/countries";
import type { AcademyView, ScoutTripView, YoungsterView } from "../../api";
import { online } from "../../client";
import {
  academyState,
  refreshAcademy,
  refreshItems,
  tracked,
  useOnlineStore,
} from "../../store/onlineStore";
import { heldOf } from "../items/OnlineShop";
import PotentialStars from "../PotentialStars";
import { useActionKey } from "../useActionKey";
import { useCountdownText } from "../useCountdownText";
import AcademyConfirm from "./AcademyConfirm";
import { academyErrorText, payName, regionName, scoutFocusName } from "./academyText";
import SendScoutDialog from "./SendScoutDialog";

/** The free slots a report may fill: never below zero. */
export function freeSlots(academy: AcademyView): number {
  return Math.max(0, academy.slots - academy.used);
}

/**
 * The academy's scouting (C-7 C7-39): the season's trips and a new one when none is out, the trip
 * out with its countdown and an hourglass, or the report back to choose from.
 */
export default function ScoutCard({
  academy,
  clubRegion,
}: {
  academy: AcademyView;
  clubRegion: string | undefined;
}) {
  const { t } = useTranslation();
  const trip = academy.trip;
  return (
    <Card className="lg:col-span-2">
      <CardHeader>{t("online.academy.scout.title")}</CardHeader>
      <CardBody>
        {!trip && <NoTrip academy={academy} clubRegion={clubRegion} />}
        {trip?.status === "pending" && <TripOut trip={trip} />}
        {trip?.status === "ready" && <Report academy={academy} trip={trip} />}
      </CardBody>
    </Card>
  );
}

function NoTrip({ academy, clubRegion }: { academy: AcademyView; clubRegion: string | undefined }) {
  const { t } = useTranslation();
  const [sending, setSending] = useState(false);
  const max = academy.maxTripsPerSeason;
  const full = max !== undefined && academy.tripsThisSeason >= max;
  return (
    <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
      {max !== undefined && (
        <p>
          {t("online.academy.scout.season", {
            sent: academy.tripsThisSeason,
            max,
            elite: academy.eliteTripsThisSeason,
            eliteMax: academy.maxEliteTripsPerSeason ?? 0,
          })}
        </p>
      )}
      {full && (
        <p role="note" className="text-red-600 dark:text-red-400">
          {t("be.error.academy.tripLimitReached", { sent: academy.tripsThisSeason, limit: max })}
        </p>
      )}
      <Button type="button" disabled={full} onClick={() => setSending(true)}>
        {t("online.academy.scout.send")}
      </Button>
      {sending && <SendScoutDialog clubRegion={clubRegion} onClose={() => setSending(false)} />}
    </div>
  );
}

function TripLine({ trip }: { trip: ScoutTripView }) {
  const { t } = useTranslation();
  return (
    <p className="text-sm text-gray-700 dark:text-gray-300">
      {t("online.academy.scout.trip", {
        region: regionName(t, trip.region),
        focus: scoutFocusName(t, trip.focus),
        pay: payName(t, trip.paidWith),
      })}
    </p>
  );
}

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
    <div className="space-y-3">
      <TripLine trip={trip} />
      <p className="font-heading text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
        {left
          ? t("online.academy.scout.backIn", { time: left })
          : t("online.academy.scout.backSoon")}
      </p>
      {/* At zero the server refuses an hourglass (tripNotPending): the report is being drawn. */}
      {left && hourglasses > 0 && (
        <div className="space-y-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || Boolean(items?.locked)}
            onClick={() => setAsking(true)}
          >
            {t("online.academy.scout.timeSkip", { held: hourglasses })}
          </Button>
          {items?.locked && (
            <p role="note" className="text-xs text-gray-600 dark:text-gray-400">
              {t("online.academy.itemsLocked")}
            </p>
          )}
        </div>
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

function CandidateCard({
  candidate,
  chosen,
  disabled,
  onToggle,
}: {
  candidate: YoungsterView;
  chosen: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <label
      className={`flex items-start gap-3 rounded-md border p-3 text-sm ${
        chosen
          ? "border-primary-500 bg-primary-50 dark:border-primary-400 dark:bg-primary-500/10"
          : "border-gray-200 dark:border-navy-600"
      } ${disabled ? "opacity-50" : ""}`}
    >
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 rounded focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800"
        checked={chosen}
        disabled={disabled}
        onChange={onToggle}
        aria-label={t("online.academy.candidate.choose", { name: candidate.name })}
      />
      <div className="flex-1 space-y-1">
        <p className="font-semibold text-gray-900 dark:text-gray-100">{candidate.name}</p>
        <p className="text-gray-600 dark:text-gray-400">
          <CountryFlag code={candidate.nationality} locale={i18n.language} className="mr-1" />
          {countryName(candidate.nationality, i18n.language)} ·{" "}
          {t("online.academy.candidate.facts", {
            age: candidate.age,
            position: candidate.position,
            height: candidate.heightCm,
          })}
        </p>
        <p className="flex items-center gap-3 text-gray-700 dark:text-gray-300">
          <span>
            {t("online.academy.candidate.ovr", {
              low: candidate.ovrRange[0],
              high: candidate.ovrRange[1],
            })}
          </span>
          <PotentialStars range={[candidate.starRange[0], candidate.starRange[1]]} />
        </p>
      </div>
    </label>
  );
}

/**
 * The report back (C-7 C7-42): the candidates as the academy knows them, no more chosen than its
 * free slots, the others gone for good once it is closed; none chosen closes it too.
 */
function Report({ academy, trip }: { academy: AcademyView; trip: ScoutTripView }) {
  const { t, i18n } = useTranslation();
  const offset = useOnlineStore((state) => state.academyOffsetMs);
  const closes = useCountdownText(trip.closesAt, offset);
  const [chosen, setChosen] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { run } = useActionKey();
  const free = freeSlots(academy);

  const toggle = (id: string) =>
    setChosen((now) => (now.includes(id) ? now.filter((at) => at !== id) : [...now, id]));

  const recruit = () => {
    setBusy(true);
    setError(null);
    run(
      (key) => tracked(() => online.academy.recruit(trip.id, chosen, key)),
      `${trip.id}:${[...chosen].sort().join(",")}`,
    )
      .then((view) => {
        useOnlineStore.setState({ ...academyState(view), academyUnseen: false });
        setConfirming(false);
      })
      .catch((failure: unknown) => {
        setError(failure);
        setConfirming(false);
        void refreshAcademy().catch(() => undefined);
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="space-y-3">
      <TripLine trip={trip} />
      {closes && (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t("online.academy.report.closesIn", { time: closes })}
        </p>
      )}
      <p className="text-sm text-gray-700 dark:text-gray-300">
        {t("online.academy.report.free", { free })}{" "}
        {chosen.length >= free && (
          <Link
            to="/online/finance"
            className="font-semibold underline focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800"
          >
            {t("online.academy.upgrade")}
          </Link>
        )}
      </p>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {trip.candidates.map((candidate) => {
          const isChosen = chosen.includes(candidate.id);
          return (
            <CandidateCard
              key={candidate.id}
              candidate={candidate}
              chosen={isChosen}
              disabled={!isChosen && chosen.length >= free}
              onToggle={() => toggle(candidate.id)}
            />
          );
        })}
      </div>
      {error !== null && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {academyErrorText(t, i18n.language, error)}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => {
            setChosen([]);
            setConfirming(true);
          }}
        >
          {t("online.academy.report.skip")}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy || chosen.length === 0}
          onClick={() => setConfirming(true)}
        >
          {t("online.academy.report.recruit", { n: chosen.length })}
        </Button>
      </div>
      {confirming && (
        <AcademyConfirm
          title={
            chosen.length > 0
              ? t("online.academy.report.recruit", { n: chosen.length })
              : t("online.academy.report.skip")
          }
          text={t("online.academy.report.othersLeave")}
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={recruit}
        />
      )}
    </div>
  );
}
