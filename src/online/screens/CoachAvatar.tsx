import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardModalFrame from "../../components/dashboard/DashboardModalFrame";
import { Button, PlayerAvatar } from "../../components/ui";
import { resolveBackendError } from "../../utils/backendI18n";
import type { AccountView } from "../api";
import { online } from "../client";
import { tracked } from "../store/onlineStore";
import { shrinkToAvatar } from "./shrinkImage";
import { useActionKey } from "./useActionKey";

/** Portraits offered on one page of the picker. */
const PAGE_SIZE = 12;

/**
 * The parts of his name his account has, trimmed. The generated type says both are always
 * there, but an older server or a bare test account may send neither, and a portrait must
 * still draw.
 */
function nameParts(account: AccountView): string[] {
  return [account.firstName, account.lastName]
    .map((part) => (part ?? "").trim())
    .filter((part) => part !== "");
}

/**
 * The coach's portrait drawn from his account and a seed: the same deterministic face pool a
 * player's portrait comes from. Without a seed it is the face his account gives him.
 */
export function CoachPortrait({
  account,
  seed,
  image,
  className,
}: {
  account: AccountView;
  seed?: string;
  /** His own picture, a data URL, which comes before any face. */
  image?: string;
  className?: string;
}) {
  const parts = nameParts(account);
  const name = parts.join(" ");
  if (image) {
    return (
      <span className={className}>
        <img src={image} alt={name} className="h-full w-full object-cover" />
      </span>
    );
  }
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
      fallback={<span>{parts.map((part) => part.charAt(0)).join("")}</span>}
    />
  );
}

/** A dozen faces to choose from, a page at a time: the choice is a seed the server keeps. */
export function CoachAvatarPicker({
  account,
  image,
  onSaved,
  onClose,
}: {
  account: AccountView;
  /** His own picture now, if he has one. */
  image?: string;
  onSaved: (account: AccountView) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<string | undefined>(account.avatarSeed);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { run } = useActionKey();
  const file = useRef<HTMLInputElement>(null);
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

  const finish = (action: Promise<AccountView>) => {
    setSaving(true);
    setError(null);
    action
      .then((updated) => {
        onSaved(updated);
        onClose();
      })
      .catch(setError)
      .finally(() => setSaving(false));
  };

  /** A face (or the default) is the choice: a picture of his own is put aside first. */
  const save = (seed: string | undefined) =>
    finish(
      (async () => {
        if (account.hasAvatarImage) {
          await run((key) => tracked(() => online.me.removeAvatarImage(key)), "remove-image");
        }
        return run(
          (key) => tracked(() => online.me.update({ avatarSeed: seed ?? "" }, key)),
          seed ?? "",
        );
      })(),
    );

  const upload = (chosen: File) =>
    finish(
      shrinkToAvatar(chosen)
        .catch(() => {
          throw new Error(t("online.profile.avatarUploadFailed"));
        })
        .then((dataUrl) =>
          run((key) => tracked(() => online.me.setAvatarImage(dataUrl, key)), dataUrl),
        ),
    );

  const removeUpload = () =>
    finish(run((key) => tracked(() => online.me.removeAvatarImage(key)), "remove-image"));

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
        <div className="space-y-2 rounded-xl border border-gray-200 p-3 dark:border-navy-600">
          <div className="flex flex-wrap items-center gap-3">
            {image && (
              <CoachPortrait
                account={account}
                image={image}
                className="block h-14 w-14 overflow-hidden rounded-lg"
              />
            )}
            <input
              ref={file}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              aria-label={t("online.profile.avatarUpload")}
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                event.target.value = "";
                if (chosen) upload(chosen);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={() => file.current?.click()}
            >
              {t("online.profile.avatarUpload")}
            </Button>
            {account.hasAvatarImage && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={removeUpload}
              >
                {t("online.profile.avatarRemoveUpload")}
              </Button>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("online.profile.avatarUploadHint")}
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
              disabled={saving || (account.avatarSeed === undefined && !account.hasAvatarImage)}
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
              disabled={
                saving ||
                picked === undefined ||
                (picked === account.avatarSeed && !account.hasAvatarImage)
              }
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
