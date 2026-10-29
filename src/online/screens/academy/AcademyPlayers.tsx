import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Info, Lock, Plus, User } from "lucide-react";
import { Badge, CountryFlag, ProgressBar } from "../../../components/ui";
import {
  translatePositionAbbreviation,
  translatePositionLabel,
} from "../../../components/squad/SquadTab.helpers";
import { TRAINING_FOCUS_IDS } from "../../../components/training/trainingOptions";
import { positionBadgeVariant } from "../../../lib/playerRating";
import { formatExactMoney } from "../../../lib/valueFormatting";
import type { AcademyPlayerView, AcademyView } from "../../api";
import { online } from "../../client";
import { academyState, tracked, useOnlineStore } from "../../store/onlineStore";
import { LABEL } from "../overview/OverviewCard";
import PotentialStars from "../PotentialStars";
import { useActionKey } from "../useActionKey";
import { ACADEMY_LINK, freeSlots } from "./AcademyFigures";
import AcademyConfirm from "./AcademyConfirm";
import { academyErrorText, revealName } from "./academyText";

/** "Theo CLB" is no focus of his own: the request leaves it out. */
const CLUB_FOCUS = "";

/** The overall a youngster's band is drawn against (design HocVien.dc.html). */
const BAND = { low: 20, high: 80 };

const HEADING =
  "font-heading text-lg font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100";

/** Where a value sits on the band, as a share of it, kept on the band. */
function bandShare(value: number): number {
  const share = (value - BAND.low) / (BAND.high - BAND.low);
  return Math.max(0, Math.min(1, share)) * 100;
}

/**
 * The academy's youngsters (C-7 C7-43, design HocVien.dc.html): a card each, then the free slots
 * and where more come from.
 */
export function YoungstersSection({ academy }: { academy: AcademyView }) {
  const { t } = useTranslation();
  const titleId = useId();
  const free = academy.enabled ? freeSlots(academy) : 0;
  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-[999_1_560px] flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id={titleId} className={HEADING}>
          {t("online.academy.players.heading", { used: academy.used, slots: academy.slots })}
        </h2>
        <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t("online.academy.players.revealNote")}
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
        {academy.players.map((player) => (
          <ProspectCard key={player.id} player={player} minDays={academy.minAcademyDays} />
        ))}
        {Array.from({ length: free }, (_, at) => (
          <SlotCard
            key={at}
            icon={<Plus className="h-5 w-5" aria-hidden="true" />}
            title={t("online.academy.players.freeSlot")}
            text={t("online.academy.players.freeSlotHint")}
          />
        ))}
        {academy.enabled && (
          <SlotCard
            icon={<Lock className="h-5 w-5" aria-hidden="true" />}
            title={t("online.academy.players.moreSlots")}
            text={t("online.academy.players.moreSlotsHint")}
            link
          />
        )}
      </div>
    </section>
  );
}

function SlotCard({
  icon,
  title,
  text,
  link = false,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  link?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-60 flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed border-gray-300 p-5 text-center dark:border-navy-600">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-navy-700 dark:text-gray-400">
        {icon}
      </span>
      <span className="font-heading text-base font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">
        {title}
      </span>
      <span className="max-w-60 text-sm text-gray-500 dark:text-gray-400">{text}</span>
      {link && (
        <Link to="/online/finance" className={`text-sm ${ACADEMY_LINK}`}>
          {t("online.academy.upgrade")}
        </Link>
      )}
    </div>
  );
}

/** A youngster as the academy knows him: ranges, his time there, his focus and letting him go. */
function ProspectCard({
  player,
  minDays,
}: {
  player: AcademyPlayerView;
  minDays: number | undefined;
}) {
  const { t, i18n } = useTranslation();
  const nameId = useId();
  const [low, high] = player.ovrRange;
  return (
    <article
      aria-labelledby={nameId}
      className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-navy-600 dark:bg-navy-700 dark:shadow-md"
    >
      <div className="flex items-center gap-3.5">
        <span className="flex h-14 w-14 shrink-0 items-end justify-center overflow-hidden rounded-full border-2 border-primary-400 bg-gray-100 text-gray-400 dark:border-primary-400 dark:bg-navy-600 dark:text-gray-500">
          <User className="h-11 w-11 fill-current" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 id={nameId} className="truncate text-base font-bold text-gray-900 dark:text-white">
            {player.name}
          </h3>
          <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <CountryFlag code={player.nationality} locale={i18n.language} />
            {t("online.academy.candidate.facts", {
              age: player.age,
              position: translatePositionLabel(t, player.position),
              height: player.heightCm,
            })}
          </span>
        </div>
        <Badge variant={positionBadgeVariant(player.position)} size="md">
          {translatePositionAbbreviation(t, player.position)}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <span className={LABEL}>{t("online.academy.players.ovr")}</span>
          <span className="font-heading text-2xl font-bold leading-none tabular-nums text-gray-900 dark:text-white">
            {low}–{high}
          </span>
          <span
            aria-hidden="true"
            className="relative h-1.5 rounded-full bg-gray-200 dark:bg-navy-600"
          >
            <span
              className="absolute inset-y-0 rounded-full bg-primary-300 dark:bg-primary-300"
              style={{
                left: `${bandShare(low)}%`,
                width: `${Math.max(2, bandShare(high) - bandShare(low))}%`,
              }}
            />
          </span>
          <span
            aria-hidden="true"
            className="flex justify-between text-[11px] text-gray-400 dark:text-gray-500"
          >
            <span>{BAND.low}</span>
            <span>{BAND.high}</span>
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className={LABEL}>{t("online.academy.players.potential")}</span>
          <PotentialStars range={[player.starRange[0], player.starRange[1]]} size="lg" />
          <span className="text-xs font-semibold text-accent-700 dark:text-accent-300">
            {t("online.academy.players.stars", {
              low: player.starRange[0],
              high: player.starRange[1],
            })}
          </span>
        </div>
      </div>

      <TimeInAcademy player={player} minDays={minDays} />
      <ProspectActions player={player} />
    </article>
  );
}

/** His days in the academy against the least it asks, and when he is expected to graduate. */
function TimeInAcademy({
  player,
  minDays,
}: {
  player: AcademyPlayerView;
  minDays: number | undefined;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-gray-50 p-3 dark:bg-navy-900">
      <span className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600 dark:text-gray-400">
        <span>
          {minDays !== undefined
            ? t("online.academy.players.daysOf", { days: player.daysInAcademy, min: minDays })
            : t("online.academy.players.days", { days: player.daysInAcademy })}
        </span>
        <span className="rounded-md bg-gray-200 px-1.5 text-gray-600 dark:bg-navy-600 dark:text-gray-300">
          {revealName(t, player.revealLevel)}
        </span>
      </span>
      {minDays !== undefined && minDays > 0 && (
        <ProgressBar value={(player.daysInAcademy / minDays) * 100} variant="primary" />
      )}
      <span className="flex flex-wrap justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span>
          {player.graduatesAtSeason !== undefined
            ? t("online.academy.players.graduates", { season: player.graduatesAtSeason })
            : t("online.academy.players.graduatesUnknown")}
        </span>
        <span>
          {t("online.academy.players.wage", { wage: formatExactMoney(player.wagePerDay) })}
        </span>
      </span>
      {player.graduationDeferred && (
        <span className="self-start rounded-md bg-accent-100 px-2 py-0.5 text-xs font-semibold text-accent-800 dark:bg-accent-900/40 dark:text-accent-300">
          {t("online.academy.players.nextFree")}
        </span>
      )}
    </div>
  );
}

/** His own focus (sent at once, the same value twice is the same) and letting him go. */
function ProspectActions({ player }: { player: AcademyPlayerView }) {
  const { t, i18n } = useTranslation();
  const focusId = useId();
  const [busy, setBusy] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { run } = useActionKey();

  const setFocus = (value: string) => {
    setBusy(true);
    setError(null);
    const focus = value === CLUB_FOCUS ? undefined : value;
    tracked(() => online.academy.setFocus(player.id, focus))
      .then((row) =>
        useOnlineStore.setState((state) =>
          state.academy
            ? {
                academy: {
                  ...state.academy,
                  players: state.academy.players.map((at) => (at.id === row.id ? row : at)),
                },
              }
            : {},
        ),
      )
      .catch(setError)
      .finally(() => setBusy(false));
  };

  const release = () => {
    setBusy(true);
    setError(null);
    run((key) => tracked(() => online.academy.release(player.id, key)), player.id)
      .then((view) => useOnlineStore.setState(academyState(view)))
      .catch(setError)
      .finally(() => {
        setBusy(false);
        setReleasing(false);
      });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-[2_1_160px] flex-col gap-1">
          <label htmlFor={focusId} className={LABEL}>
            {t("online.academy.players.focus")}
          </label>
          <select
            id={focusId}
            value={player.focus ?? CLUB_FOCUS}
            disabled={busy}
            onChange={(event) => setFocus(event.target.value)}
            className="h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 dark:border-navy-600 dark:bg-navy-800 dark:text-gray-100"
          >
            <option value={CLUB_FOCUS}>{t("online.academy.players.clubFocus")}</option>
            {TRAINING_FOCUS_IDS.map((focus) => (
              <option key={focus} value={focus}>
                {t(`training.focuses.${focus}.label`)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => setReleasing(true)}
          className="h-11 flex-[1_1_100px] rounded-lg border border-gray-300 px-3 font-heading text-sm font-bold uppercase tracking-wider text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 dark:border-navy-600 dark:text-gray-300 dark:hover:bg-navy-600 dark:focus:ring-offset-navy-800"
        >
          {t("online.academy.players.release")}
        </button>
      </div>
      {error !== null && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {academyErrorText(t, i18n.language, error)}
        </p>
      )}
      {releasing && (
        <AcademyConfirm
          title={t("online.academy.players.releaseTitle", { name: player.name })}
          text={t("online.academy.players.releaseText")}
          busy={busy}
          onCancel={() => setReleasing(false)}
          onConfirm={release}
        />
      )}
    </div>
  );
}

/**
 * Who graduated into the club (C-7 C7-44): a link to his page while he is still in the squad, his
 * name alone once he is gone (his page reads the squad, PO bản 4).
 */
export function GraduatesSection({ academy }: { academy: AcademyView }) {
  const { t } = useTranslation();
  const titleId = useId();
  const squad = useOnlineStore((state) => state.club?.players);
  if (academy.graduated.length === 0) return null;
  const inSquad = new Set((squad ?? []).map((player) => player.id));
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-navy-600 dark:bg-navy-700 dark:shadow-md"
    >
      <h2 id={titleId} className={HEADING}>
        {t("online.academy.graduated.title")}
      </h2>
      <ul className="flex flex-wrap gap-2 text-sm text-gray-700 dark:text-gray-300">
        {academy.graduated.map((graduate) => (
          <li
            key={graduate.playerId}
            className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-navy-600 dark:bg-navy-900"
          >
            {inSquad.has(graduate.playerId) ? (
              <Link to={`/online/squad/${graduate.playerId}`} className={ACADEMY_LINK}>
                {graduate.name}
              </Link>
            ) : (
              <span className="font-semibold text-gray-900 dark:text-gray-100">
                {graduate.name}
              </span>
            )}{" "}
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {t("online.academy.graduated.season", { season: graduate.season })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
