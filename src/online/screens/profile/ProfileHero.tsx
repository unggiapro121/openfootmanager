import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Award, Camera, Globe2, Pencil } from "lucide-react";
import { Button } from "../../../components/ui";
import { resolveBackendError } from "../../../utils/backendI18n";
import type { AccountView, CareerView } from "../../api";
import type { CoachRegion } from "../../api/domain";
import { online } from "../../client";
import { ONLINE_REGIONS } from "../../format";
import {
  refreshClub,
  refreshLeague,
  refreshSeason,
  tracked,
  useOnlineStore,
} from "../../store/onlineStore";
import { CoachPortrait } from "../CoachAvatar";
import { useActionKey } from "../useActionKey";
import { strongestStyle } from "./profileView";

const SMALL_GHOST =
  "inline-flex h-7 items-center gap-1.5 rounded-md border border-gray-300 px-2.5 text-[13px] text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-navy-600 dark:text-gray-200 dark:hover:bg-navy-600";

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "gold" }) {
  return (
    <div className="flex flex-col-reverse gap-0.5">
      <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd
        className={`font-heading text-3xl font-bold leading-none ${
          tone === "up"
            ? "text-primary-600 dark:text-success-400"
            : tone === "gold"
              ? "text-accent-700 dark:text-accent-400"
              : "text-gray-900 dark:text-white"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * The coach at the head of his profile (design ho-so-hlv.html): his portrait with a way to change
 * it, his name, level and licence, his region with a way to change it, his e-mail, and his record.
 * `career` is undefined until read.
 */
export default function ProfileHero({
  account,
  image,
  career,
  onPickPortrait,
  onAccount,
}: {
  account: AccountView;
  image: string | undefined;
  career: CareerView | undefined;
  onPickPortrait: () => void;
  onAccount: (account: AccountView) => void;
}) {
  const { t } = useTranslation();
  const best = career ? strongestStyle(career.mastery) : undefined;
  const licence = career?.licence;
  return (
    <section
      aria-labelledby="online-coach-name"
      className="flex flex-wrap items-center justify-between gap-6 rounded-2xl border border-gray-200 bg-white px-6 py-6 shadow-sm @2xl:px-7 dark:border-navy-600 dark:bg-navy-800"
    >
      <div className="flex min-w-0 flex-[1_1_420px] items-center gap-5">
        <span className="relative shrink-0">
          <CoachPortrait
            account={account}
            seed={account.avatarSeed}
            image={image}
            className="flex h-22 w-22 items-center justify-center overflow-hidden rounded-full border-3 border-primary-500 bg-gray-200 font-heading text-3xl font-bold text-primary-700 dark:bg-navy-600 dark:text-primary-300"
          />
          <button
            type="button"
            onClick={onPickPortrait}
            aria-label={t("online.profile.avatarChange")}
            title={t("online.profile.avatarChange")}
            className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-gray-100 text-gray-800 hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-navy-800 dark:bg-navy-700 dark:text-white dark:hover:bg-navy-600"
          >
            <Camera className="h-4 w-4" aria-hidden="true" />
          </button>
        </span>
        <div className="flex min-w-0 flex-col gap-2">
          <h2
            id="online-coach-name"
            className="font-heading text-4xl font-bold uppercase leading-none tracking-wide text-gray-900 dark:text-white"
          >
            {`${account.firstName} ${account.lastName}`}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {career && (
              <span className="inline-flex h-7 items-center gap-1.5 rounded-md bg-accent-100 px-2.5 font-heading text-sm font-bold uppercase tracking-wider text-accent-800 dark:bg-accent-900/40 dark:text-accent-300">
                <Award className="h-4 w-4" aria-hidden="true" />
                {licence
                  ? t("online.profile.levelChip", {
                      level: career.level,
                      licence: t(`tactics.licence.tier_${licence.tier}`),
                    })
                  : t("online.profile.levelOnly", { level: career.level })}
              </span>
            )}
            <RegionChange account={account} onChanged={onAccount} />
          </div>
          <span className="truncate text-xs text-gray-500 dark:text-gray-400">{account.email}</span>
        </div>
      </div>
      {career && (
        <dl className="grid grid-cols-2 gap-x-7 gap-y-3 @xl:grid-cols-4">
          <Stat label={t("online.profile.stat.seasons")} value={String(career.seasons)} />
          <Stat
            label={t("online.profile.stat.promotions")}
            value={String(career.promotions)}
            tone="up"
          />
          {/* A server before S-16c sends no forced levels. */}
          {typeof career.forcedLevels === "number" && (
            <Stat label={t("online.profile.stat.forced")} value={String(career.forcedLevels)} />
          )}
          <Stat
            label={t("online.profile.stat.bestStyle")}
            value={best ? t(`common.playStyles.${best.style}`, best.style) : "–"}
            tone="gold"
          />
        </dl>
      )}
    </section>
  );
}

/**
 * The coach's region as a chip that turns into a picker. Changing region gives the club back to
 * its bot at once, so it is confirmed first (C-2 §3.3, Qc2-6).
 */
function RegionChange({
  account,
  onChanged,
}: {
  account: AccountView;
  onChanged: (account: AccountView) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const offline = useOnlineStore((state) => state.network === "offline");
  const hasClub = useOnlineStore((state) => state.club !== null);
  const [editing, setEditing] = useState(false);
  const [region, setRegion] = useState<CoachRegion>(account.region);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [changed, setChanged] = useState(false);
  const key = useActionKey();
  const regionName = t(`coach.regions.${account.region}`);

  const close = () => {
    setEditing(false);
    setConfirming(false);
    setRegion(account.region);
    setError(null);
  };

  const change = async () => {
    setSending(true);
    setError(null);
    try {
      const updated = await key.run(
        (idempotencyKey) => tracked(() => online.me.update({ region }, idempotencyKey)),
        region,
      );
      onChanged(updated);
      setConfirming(false);
      setEditing(false);
      setChanged(true);
      // The club went back to its bot: the shared views change with it.
      await Promise.allSettled([refreshClub(), refreshLeague(), refreshSeason()]);
    } catch (failure) {
      setError(failure);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {editing ? (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <label htmlFor="online-region" className="sr-only">
            {t("online.profile.changeRegion")}
          </label>
          <select
            id="online-region"
            value={region}
            onChange={(event) => {
              setRegion(event.target.value as CoachRegion);
              setConfirming(false);
            }}
            className="h-8 rounded-md border border-primary-500 bg-white px-2 text-[13px] text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-navy-900 dark:text-white"
          >
            {ONLINE_REGIONS.map((option) => (
              <option key={option} value={option}>
                {t(`coach.regions.${option}`)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={region === account.region || offline}
            className="h-8 rounded-md bg-primary-700 px-3 font-heading text-[13px] font-bold uppercase tracking-wider text-white hover:bg-primary-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-navy-800"
          >
            {t("online.profile.saveRegion")}
          </button>
          <button type="button" onClick={close} className={`${SMALL_GHOST} h-8`}>
            {t("online.cancel")}
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => {
            setEditing(true);
            setChanged(false);
          }}
          aria-label={t("online.profile.regionChip", { region: regionName })}
          className={SMALL_GHOST}
        >
          <Globe2 className="h-3.5 w-3.5" aria-hidden="true" />
          {regionName}
          <Pencil className="h-3 w-3 text-gray-400" aria-hidden="true" />
        </button>
      )}
      {error !== null && (
        <p role="alert" className="basis-full text-sm text-red-600 dark:text-red-400">
          {resolveBackendError(error)}
        </p>
      )}
      {confirming && (
        <div
          role="alertdialog"
          aria-labelledby="online-region-confirm"
          className="basis-full space-y-3 rounded-lg border border-accent-400/50 bg-accent-50 p-4 text-sm text-gray-800 dark:bg-accent-500/10 dark:text-gray-200"
        >
          <p id="online-region-confirm" className="font-semibold text-gray-900 dark:text-gray-100">
            {t("online.profile.confirmTitle")}
          </p>
          <p>{t("online.profile.confirmBody")}</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={change} disabled={sending || offline}>
              {t("online.profile.confirm")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              {t("online.cancel")}
            </Button>
          </div>
        </div>
      )}
      {changed && (
        <div
          role="status"
          className="flex basis-full flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-gray-300"
        >
          <p>{t("online.profile.changed")}</p>
          {!hasClub && (
            <Button size="sm" onClick={() => navigate("/online/takeover")}>
              {t("online.takeover.button")}
            </Button>
          )}
        </div>
      )}
    </>
  );
}
