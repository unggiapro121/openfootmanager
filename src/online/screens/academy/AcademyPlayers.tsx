import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button, Card, CardBody, CardHeader } from "../../../components/ui";
import { TRAINING_FOCUS_IDS } from "../../../components/training/trainingOptions";
import { formatExactMoney } from "../../../lib/valueFormatting";
import type { AcademyPlayerView, AcademyView } from "../../api";
import { online } from "../../client";
import { academyState, tracked, useOnlineStore } from "../../store/onlineStore";
import PotentialStars from "../PotentialStars";
import { useActionKey } from "../useActionKey";
import AcademyConfirm from "./AcademyConfirm";
import { academyErrorText, revealName } from "./academyText";

const LINK =
  "font-semibold underline hover:text-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:hover:text-primary-400 dark:focus:ring-offset-navy-800";

/** "Theo CLB" is no focus of his own: the request leaves it out. */
const CLUB_FOCUS = "";

/**
 * The academy's youngsters (C-7 C7-43): the slots and what they cost, then each youngster as the
 * academy knows him, when he is expected to graduate (the server's word), his own focus, and
 * letting him go.
 */
export function YoungstersCard({ academy }: { academy: AcademyView }) {
  const { t } = useTranslation();
  return (
    <Card className="lg:col-span-2">
      <CardHeader>{t("online.academy.players.title")}</CardHeader>
      <CardBody>
        <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
          <p>
            {t("online.academy.players.slots", {
              used: academy.used,
              slots: academy.slots,
              level: academy.academyLevel,
            })}{" "}
            <Link to="/online/finance" className={LINK}>
              {t("online.academy.upgrade")}
            </Link>
          </p>
          {academy.weeklyWage !== undefined &&
            academy.graduationFee !== undefined &&
            academy.minAcademyDays !== undefined && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t("online.academy.players.costs", {
                  wage: formatExactMoney(academy.weeklyWage),
                  fee: formatExactMoney(academy.graduationFee),
                  days: academy.minAcademyDays,
                })}
              </p>
            )}
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("online.academy.players.revealNote")}
          </p>
          {academy.players.length === 0 ? (
            <p>{t("online.academy.players.none")}</p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-navy-700">
              {academy.players.map((player) => (
                <YoungsterRow key={player.id} player={player} />
              ))}
            </ul>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function YoungsterRow({ player }: { player: AcademyPlayerView }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <li className="py-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((now) => !now)}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded text-left focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800"
      >
        <span className="font-semibold text-gray-900 dark:text-gray-100">{player.name}</span>
        <span>
          {t("online.academy.candidate.facts", {
            age: player.age,
            position: player.position,
            height: player.heightCm,
          })}
        </span>
        <span>
          {t("online.academy.candidate.ovr", { low: player.ovrRange[0], high: player.ovrRange[1] })}
        </span>
        <PotentialStars range={[player.starRange[0], player.starRange[1]]} />
        <span>{revealName(t, player.revealLevel)}</span>
        <span>{t("online.academy.players.days", { days: player.daysInAcademy })}</span>
        <span>
          {t("online.academy.players.wage", { wage: formatExactMoney(player.wagePerDay) })}
        </span>
        <span>
          {player.graduatesAtSeason !== undefined
            ? t("online.academy.players.graduates", { season: player.graduatesAtSeason })
            : "—"}
        </span>
        {player.graduationDeferred && (
          <span className="rounded bg-accent-50 px-2 py-0.5 text-xs text-accent-800 dark:bg-accent-500/10 dark:text-accent-300">
            {t("online.academy.players.nextFree")}
          </span>
        )}
      </button>
      {open && <YoungsterDetail player={player} />}
    </li>
  );
}

/** His own focus (sent at once, the same value twice is the same) and letting him go. */
function YoungsterDetail({ player }: { player: AcademyPlayerView }) {
  const { t, i18n } = useTranslation();
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
    <div className="mt-2 flex flex-wrap items-end gap-3 rounded-md bg-gray-50 p-3 dark:bg-navy-700">
      <label className="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-300">
        {t("online.academy.players.focus")}
        <select
          value={player.focus ?? CLUB_FOCUS}
          disabled={busy}
          onChange={(event) => setFocus(event.target.value)}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:border-navy-600 dark:bg-navy-800 dark:text-gray-100 dark:focus:ring-offset-navy-800"
        >
          <option value={CLUB_FOCUS}>{t("online.academy.players.clubFocus")}</option>
          {TRAINING_FOCUS_IDS.map((focus) => (
            <option key={focus} value={focus}>
              {t(`training.focuses.${focus}.label`)}
            </option>
          ))}
        </select>
      </label>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => setReleasing(true)}
      >
        {t("online.academy.players.release")}
      </Button>
      {error !== null && (
        <p role="alert" className="w-full text-sm text-red-600 dark:text-red-400">
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
export function GraduatesCard({ academy }: { academy: AcademyView }) {
  const { t } = useTranslation();
  const squad = useOnlineStore((state) => state.club?.players);
  if (academy.graduated.length === 0) return null;
  const inSquad = new Set((squad ?? []).map((player) => player.id));
  return (
    <Card>
      <CardHeader>{t("online.academy.graduated.title")}</CardHeader>
      <CardBody>
        <ul className="space-y-1 text-sm text-gray-700 dark:text-gray-300">
          {academy.graduated.map((graduate) => (
            <li key={graduate.playerId}>
              {inSquad.has(graduate.playerId) ? (
                <Link to={`/online/squad/${graduate.playerId}`} className={LINK}>
                  {graduate.name}
                </Link>
              ) : (
                graduate.name
              )}{" "}
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {t("online.academy.graduated.season", { season: graduate.season })}
              </span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
