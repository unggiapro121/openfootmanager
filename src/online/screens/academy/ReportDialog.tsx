import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { BadgeCheck } from "lucide-react";
import { CountryFlag } from "../../../components/ui";
import { translatePositionLabel } from "../../../components/squad/SquadTab.helpers";
import type { AcademyView, ScoutTripView, YoungsterView } from "../../api";
import { online } from "../../client";
import { academyState, refreshAcademy, tracked, useOnlineStore } from "../../store/onlineStore";
import ItemDialogFrame, { FRAME_ACTION, FrameCancel } from "../items/ItemDialogFrame";
import PotentialStars from "../PotentialStars";
import { useActionKey } from "../useActionKey";
import { useCountdownText } from "../useCountdownText";
import { ACADEMY_LINK, freeSlots } from "./AcademyFigures";
import { academyErrorText } from "./academyText";
import TripLine from "./TripLine";

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
      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm focus-within:ring-2 focus-within:ring-primary-500 ${
        chosen
          ? "border-primary-500 bg-primary-50 dark:border-primary-500 dark:bg-primary-900/40"
          : "border-gray-200 bg-gray-50 dark:border-navy-600 dark:bg-navy-900"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 rounded focus:outline-none"
        checked={chosen}
        disabled={disabled}
        onChange={onToggle}
        aria-label={t("online.academy.candidate.choose", { name: candidate.name })}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-semibold text-gray-900 dark:text-white">{candidate.name}</span>
        <span className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
          <CountryFlag code={candidate.nationality} locale={i18n.language} />
          {t("online.academy.candidate.facts", {
            age: candidate.age,
            position: translatePositionLabel(t, candidate.position),
            height: candidate.heightCm,
          })}
        </span>
        <span className="flex items-center gap-3 text-gray-700 dark:text-gray-300">
          <span className="font-heading text-base font-bold tabular-nums">
            {t("online.academy.candidate.ovr", {
              low: candidate.ovrRange[0],
              high: candidate.ovrRange[1],
            })}
          </span>
          <PotentialStars range={[candidate.starRange[0], candidate.starRange[1]]} />
        </span>
      </span>
    </label>
  );
}

/**
 * The report back (C-7 C7-42): the candidates as the academy knows them, no more chosen than its
 * free slots, the others gone for good once it is closed; none chosen closes it too. Either is
 * asked once more before it is sent.
 */
export default function ReportDialog({
  academy,
  trip,
  onClose,
}: {
  academy: AcademyView;
  trip: ScoutTripView;
  onClose: () => void;
}) {
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
        onClose();
      })
      .catch((failure: unknown) => {
        setError(failure);
        setConfirming(false);
        void refreshAcademy().catch(() => undefined);
      })
      .finally(() => setBusy(false));
  };

  return (
    <ItemDialogFrame
      title={t("online.academy.report.title")}
      icon={
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
          <BadgeCheck className="h-7 w-7" aria-hidden="true" />
        </span>
      }
      busy={busy}
      onClose={onClose}
    >
      <div className="flex flex-col gap-1">
        <TripLine trip={trip} />
        {closes && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t("online.academy.report.closesIn", { time: closes })}
          </span>
        )}
      </div>
      <p className="text-sm text-gray-700 dark:text-gray-300">
        {t("online.academy.report.free", { free })}{" "}
        {chosen.length >= free && (
          <Link to="/online/finance" className={ACADEMY_LINK}>
            {t("online.academy.upgrade")}
          </Link>
        )}
      </p>
      <div className="flex flex-col gap-2">
        {trip.candidates.map((candidate) => {
          const isChosen = chosen.includes(candidate.id);
          return (
            <CandidateCard
              key={candidate.id}
              candidate={candidate}
              chosen={isChosen}
              disabled={confirming || (!isChosen && chosen.length >= free)}
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
      {confirming && (
        <p
          role="note"
          className="rounded-lg bg-accent-100 p-3 text-sm text-accent-800 dark:bg-accent-900/40 dark:text-accent-300"
        >
          {t("online.academy.report.othersLeave")}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {confirming ? (
          <>
            <FrameCancel onClick={() => setConfirming(false)} disabled={busy}>
              {t("common.cancel")}
            </FrameCancel>
            <button type="button" className={FRAME_ACTION} disabled={busy} onClick={recruit}>
              {t("online.academy.confirm")}
            </button>
          </>
        ) : (
          <>
            <FrameCancel
              onClick={() => {
                setChosen([]);
                setConfirming(true);
              }}
              disabled={busy}
            >
              {t("online.academy.report.skip")}
            </FrameCancel>
            <button
              type="button"
              className={FRAME_ACTION}
              disabled={busy || chosen.length === 0}
              onClick={() => setConfirming(true)}
            >
              {t("online.academy.report.recruit", { n: chosen.length })}
            </button>
          </>
        )}
      </div>
    </ItemDialogFrame>
  );
}
