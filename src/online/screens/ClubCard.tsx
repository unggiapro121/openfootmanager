import { type FormEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, CardHeader } from "../../components/ui";
import type { MyClubView } from "../api";
import { online } from "../client";
import { tracked, useOnlineStore } from "../store/onlineStore";
import { renameErrorText } from "./renameText";
import { useActionKey } from "./useActionKey";

/** The club: where it plays, and its name: the first rename is free, a later one needs a card. */
export default function ClubCard({ club }: { club: MyClubView }) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const profile = club.club;

  return (
    <Card>
      <CardHeader
        action={
          !renaming && (
            <Button variant="ghost" size="sm" onClick={() => setRenaming(true)}>
              {t("online.club.rename")}
            </Button>
          )
        }
      >
        {t("online.club.title")}
      </CardHeader>
      <CardBody className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
        <p className="font-heading text-lg font-bold text-gray-900 dark:text-gray-100">
          {profile.name}
        </p>
        <p>
          {profile.city} · {t(`coach.regions.${profile.region}`)}
        </p>
        <p>
          {t("online.club.stadium", {
            name: profile.stadiumName,
            capacity: profile.stadiumCapacity,
          })}
        </p>
        {club.squadRefreshing && (
          <p className="text-accent-600 dark:text-accent-400">{t("online.takeover.makingSquad")}</p>
        )}
        {renaming && <RenameForm current={profile.name} onDone={() => setRenaming(false)} />}
      </CardBody>
    </Card>
  );
}

function RenameForm({ current, onDone }: { current: string; onDone: () => void }) {
  const { t } = useTranslation();
  const offline = useOnlineStore((state) => state.network === "offline");
  const [name, setName] = useState(current);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const key = useActionKey();
  const input = useRef<HTMLInputElement>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const wanted = name.trim();
      const club = await key.run(
        (idempotencyKey) => tracked(() => online.clubs.rename(wanted, idempotencyKey)),
        wanted,
      );
      useOnlineStore.getState().setClub(club);
      onDone();
    } catch (failure) {
      setError(failure);
      input.current?.focus();
    } finally {
      setSaving(false);
    }
  };

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
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-navy-600 dark:bg-navy-800 dark:text-gray-100"
      />
      <p id="online-club-name-hint" className="text-xs text-gray-500 dark:text-gray-400">
        {t("online.club.renameHint")}
      </p>
      {error !== null && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {renameErrorText(t, error)}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving || offline || name.trim() === ""}>
          {t("online.club.save")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          {t("online.cancel")}
        </Button>
      </div>
    </form>
  );
}
