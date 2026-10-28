import { type FormEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Palette, PenLine } from "lucide-react";
import { Button } from "../../../components/ui";
import { formatVal } from "../../../lib/valueFormatting";
import type { MyClubView } from "../../api";
import { online } from "../../client";
import { tracked, useOnlineStore } from "../../store/onlineStore";
import ClubCrestMark from "../ClubCrestMark";
import RenameCardNote, { useRenameCard } from "../RenameCardNote";
import { renameErrorText } from "../renameText";
import { useActionKey } from "../useActionKey";
import CrestDialog from "./CrestDialog";
import OverviewCard from "./OverviewCard";

const HEAD_BUTTON =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 font-heading text-xs font-semibold uppercase tracking-wider text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:border-navy-600 dark:text-gray-300 dark:hover:bg-navy-600 dark:focus:ring-offset-navy-800";

/**
 * The club (design tong-quan.html): its crest, name, area, stadium and money, and its name: the
 * first rename is free, a later one needs a card.
 */
export default function ClubCard({ club }: { club: MyClubView }) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const finance = useOnlineStore((state) => state.finance);
  const profile = club.club;
  const dt = "text-gray-500 dark:text-gray-400";
  const dd = "text-gray-900 dark:text-gray-100";

  return (
    <OverviewCard
      title={t("online.club.title")}
      className="flex-[1_1_420px]"
      action={
        <span className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setDrawing(true)} className={HEAD_BUTTON}>
            <Palette className="h-3.5 w-3.5" aria-hidden="true" />
            {t("online.club.crest.change")}
          </button>
          {!renaming && (
            <button type="button" onClick={() => setRenaming(true)} className={HEAD_BUTTON}>
              <PenLine className="h-3.5 w-3.5" aria-hidden="true" />
              {t("online.club.rename")}
            </button>
          )}
        </span>
      }
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex flex-wrap items-start gap-5">
          <span className="h-16 w-16 shrink-0">
            <ClubCrestMark profile={profile} />
          </span>
          <dl className="grid flex-[1_1_240px] grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
            <dt className={dt}>{t("online.overview.clubName")}</dt>
            <dd className={`${dd} font-bold`}>{profile.name}</dd>
            <dt className={dt}>{t("online.overview.area")}</dt>
            <dd className={dd}>
              {profile.city} · {t(`coach.regions.${profile.region}`)}
            </dd>
            <dt className={dt}>{t("online.overview.stadium")}</dt>
            <dd className={dd}>
              {t("online.overview.stadiumLine", {
                name: profile.stadiumName,
                capacity: profile.stadiumCapacity,
              })}
            </dd>
            {finance?.economy && (
              <>
                <dt className={dt}>{t("online.overview.budget")}</dt>
                <dd className={`${dd} font-semibold`}>
                  {formatVal(finance.cash)}{" "}
                  <Link
                    to="/online/finance"
                    className="ml-1.5 rounded text-xs font-semibold text-primary-700 hover:text-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-primary-400 dark:hover:text-primary-300"
                  >
                    {t("online.nav.finance")}
                  </Link>
                </dd>
              </>
            )}
          </dl>
        </div>
        {club.squadRefreshing && (
          <p className="text-sm text-accent-700 dark:text-accent-300">
            {t("online.takeover.makingSquad")}
          </p>
        )}
        {drawing && <CrestDialog profile={profile} onClose={() => setDrawing(false)} />}
        {renaming && (
          <RenameForm
            current={profile.name}
            currentStadium={profile.stadiumName}
            free={club.renameFree}
            onDone={() => setRenaming(false)}
          />
        )}
      </div>
    </OverviewCard>
  );
}

const STADIUM_NAME = { min: 3, max: 40 };

function RenameForm({
  current,
  currentStadium,
  free,
  onDone,
}: {
  current: string;
  currentStadium: string;
  /** Absent from an older server (C-7 C7-2). */
  free: boolean | undefined;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const offline = useOnlineStore((state) => state.network === "offline");
  const [name, setName] = useState(current);
  const [stadium, setStadium] = useState(currentStadium);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const { blocked: needsCard } = useRenameCard("clubRename", free);
  const nameKey = useActionKey();
  const stadiumKey = useActionKey();
  const input = useRef<HTMLInputElement>(null);
  const wantedName = name.trim();
  const wantedStadium = stadium.trim();
  const nameChanged = wantedName !== current;
  const stadiumChanged = wantedStadium !== currentStadium;
  const stadiumFits =
    [...wantedStadium].length >= STADIUM_NAME.min && [...wantedStadium].length <= STADIUM_NAME.max;
  const valid =
    wantedName !== "" &&
    (!stadiumChanged || stadiumFits) &&
    (nameChanged || stadiumChanged) &&
    !(nameChanged && needsCard);

  /** Each change is its own request, the club's name first; the first refusal stops the rest. */
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (nameChanged) {
        const club = await nameKey.run(
          (idempotencyKey) => tracked(() => online.clubs.rename(wantedName, idempotencyKey)),
          wantedName,
        );
        useOnlineStore.getState().setClub(club);
      }
      if (stadiumChanged) {
        const club = await stadiumKey.run(
          (idempotencyKey) =>
            tracked(() => online.clubs.renameStadium(wantedStadium, idempotencyKey)),
          wantedStadium,
        );
        useOnlineStore.getState().setClub(club);
      }
      onDone();
    } catch (failure) {
      setError(failure);
      input.current?.focus();
    } finally {
      setSaving(false);
    }
  };

  const field =
    "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-navy-600 dark:bg-navy-800 dark:text-gray-100";
  return (
    <form onSubmit={submit} className="space-y-2 pt-2">
      <label htmlFor="online-club-name" className="block text-xs font-semibold uppercase">
        {t("online.club.renameLabel")}
      </label>
      <input
        id="online-club-name"
        ref={input}
        value={name}
        maxLength={40}
        onChange={(event) => setName(event.target.value)}
        aria-invalid={error !== null}
        aria-describedby="online-club-name-hint"
        className={field}
      />
      <p id="online-club-name-hint" className="text-xs text-gray-500 dark:text-gray-400">
        {t("online.club.renameHint")}
      </p>
      <RenameCardNote card="clubRename" free={free} />
      <label htmlFor="online-stadium-name" className="block pt-1 text-xs font-semibold uppercase">
        {t("online.club.stadiumLabel")}
      </label>
      <input
        id="online-stadium-name"
        value={stadium}
        maxLength={STADIUM_NAME.max}
        onChange={(event) => setStadium(event.target.value)}
        aria-describedby="online-stadium-name-hint"
        className={field}
      />
      <p id="online-stadium-name-hint" className="text-xs text-gray-500 dark:text-gray-400">
        {t("online.club.stadiumHint")}
      </p>
      {error !== null && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {renameErrorText(t, error)}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving || offline || !valid}>
          {t("online.club.save")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          {t("online.cancel")}
        </Button>
      </div>
    </form>
  );
}
