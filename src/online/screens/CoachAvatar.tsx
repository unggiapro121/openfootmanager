import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardModalFrame from "../../components/dashboard/DashboardModalFrame";
import { Button, PlayerAvatar } from "../../components/ui";
import { resolveBackendError } from "../../utils/backendI18n";
import type { AccountView } from "../api";
import { online } from "../client";
import { tracked } from "../store/onlineStore";
import { useActionKey } from "./useActionKey";

/** Portraits offered on one page of the picker. */
const PAGE_SIZE = 12;

/**
 * The coach's portrait drawn from his account and a seed: the same deterministic face pool a
 * player's portrait comes from. Without a seed it is the face his account gives him.
 */
export function CoachPortrait({
  account,
  seed,
  className,
}: {
  account: AccountView;
  seed?: string;
  className?: string;
}) {
  const name = `${account.firstName} ${account.lastName}`;
  return (
    <PlayerAvatar
      className={className}
      player={{
        id: seed ? `coach:${account.id}:${seed}` : `coach:${account.id}`,
        full_name: name,
        match_name: name,
        nationality: account.nationality,
        date_of_birth: account.dateOfBirth,
      }}
      fallback={
        <span>
          {account.firstName.charAt(0)}
          {account.lastName.charAt(0)}
        </span>
      }
    />
  );
}

/** A dozen faces to choose from, a page at a time: the choice is a seed the server keeps. */
export function CoachAvatarPicker({
  account,
  onSaved,
  onClose,
}: {
  account: AccountView;
  onSaved: (account: AccountView) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<string | undefined>(account.avatarSeed);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { run } = useActionKey();
  const seeds = Array.from({ length: PAGE_SIZE }, (_, index) =>
    String(page * PAGE_SIZE + index + 1),
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saving, onClose]);

  const save = (seed: string | undefined) => {
    setSaving(true);
    setError(null);
    run((key) => tracked(() => online.me.update({ avatarSeed: seed ?? "" }, key)), seed ?? "")
      .then((updated) => {
        onSaved(updated);
        onClose();
      })
      .catch(setError)
      .finally(() => setSaving(false));
  };

  return (
    <DashboardModalFrame maxWidthClassName="max-w-2xl">
      <div className="space-y-4" role="dialog" aria-modal="true" aria-labelledby="avatar-title">
        <div>
          <h3
            id="avatar-title"
            className="font-heading text-lg font-bold text-gray-900 dark:text-gray-100"
          >
            {t("online.profile.avatarTitle")}
          </h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            {t("online.profile.avatarHint")}
          </p>
        </div>
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {seeds.map((seed) => (
            <li key={seed}>
              <button
                type="button"
                aria-pressed={picked === seed}
                aria-label={t("online.profile.avatarOption", { number: seed })}
                onClick={() => setPicked(seed)}
                className={`block w-full overflow-hidden rounded-xl border-2 transition-all focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800 ${
                  picked === seed
                    ? "border-primary-500 ring-2 ring-primary-300"
                    : "border-gray-200 hover:border-primary-400 dark:border-navy-600"
                }`}
              >
                <CoachPortrait
                  account={account}
                  seed={seed}
                  className="flex aspect-square w-full items-center justify-center bg-navy-800 font-heading text-2xl font-bold text-primary-400"
                />
              </button>
            </li>
          ))}
        </ul>
        {error !== null && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {resolveBackendError(error)}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={() => setPage((current) => current + 1)}
            >
              {t("online.profile.avatarMore")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving || account.avatarSeed === undefined}
              onClick={() => save(undefined)}
            >
              {t("online.profile.avatarClear")}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onClose}>
              {t("online.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={saving || picked === undefined || picked === account.avatarSeed}
              onClick={() => save(picked)}
            >
              {t("online.profile.avatarSave")}
            </Button>
          </div>
        </div>
      </div>
    </DashboardModalFrame>
  );
}
