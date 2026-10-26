import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardModalFrame from "../../../components/dashboard/DashboardModalFrame";
import { Button, PlayerAvatar } from "../../../components/ui";
import { countryName } from "../../../lib/countries";
import { resolveBackendError } from "../../../utils/backendI18n";
import type { MyClubView, SquadPlayerView } from "../../api";
import { online } from "../../client";
import { tracked, useOnlineStore } from "../../store/onlineStore";
import { shrinkToAvatar } from "../shrinkImage";
import { useActionKey } from "../useActionKey";
import { avatarOf } from "./playerLook";

/** Faces offered on one page of the picker. */
const PAGE_SIZE = 12;

/**
 * The picture of one of the coach's players: a face drawn from the pool of his nationality (a seed
 * the server keeps), or a picture of his own from the coach's computer, shrunk to a square before
 * it is sent. A picture of his own comes before any face; choosing a face puts it aside.
 */
export default function PlayerAvatarPicker({
  player,
  onClose,
}: {
  player: SquadPlayerView;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const picture = useOnlineStore((state) => state.playerPictures[player.id]);
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<string | undefined>(player.avatarSeed);
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

  const settle = (action: Promise<MyClubView>, nextPicture?: string | null) => {
    setSaving(true);
    setError(null);
    action
      .then((club) => {
        const store = useOnlineStore.getState();
        store.setClub(club);
        if (nextPicture !== undefined) {
          const rest = { ...store.playerPictures };
          if (nextPicture === null) delete rest[player.id];
          else rest[player.id] = nextPicture;
          store.setPlayerPictures(rest);
        }
        onClose();
      })
      .catch((failure) => setError(failure instanceof Error ? failure : new Error(String(failure))))
      .finally(() => setSaving(false));
  };

  const saveFace = (seed: string) =>
    settle(
      (async () => {
        if (player.hasAvatarImage) {
          await run(
            (key) => tracked(() => online.players.removeAvatarImage(player.id, key)),
            "remove-image",
          );
        }
        return run((key) => tracked(() => online.players.setAvatar(player.id, seed, key)), seed);
      })(),
      null,
    );

  const upload = (chosen: File) =>
    settle(
      shrinkToAvatar(chosen)
        .catch(() => {
          throw new Error(t("online.profile.avatarUploadFailed"));
        })
        .then((dataUrl) =>
          run(
            (key) => tracked(() => online.players.setAvatarImage(player.id, dataUrl, key)),
            dataUrl,
          ).then((club) => {
            const store = useOnlineStore.getState();
            store.setPlayerPictures({ ...store.playerPictures, [player.id]: dataUrl });
            return club;
          }),
        ),
    );

  const removeUpload = () =>
    settle(
      run((key) => tracked(() => online.players.removeAvatarImage(player.id, key)), "remove-image"),
      null,
    );

  return (
    <DashboardModalFrame maxWidthClassName="max-w-2xl">
      <div
        className="space-y-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-avatar-title"
      >
        <div>
          <h3
            id="player-avatar-title"
            className="font-heading text-lg font-bold text-gray-900 dark:text-gray-100"
          >
            {t("online.player.avatarTitle", { name: player.matchName })}
          </h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            {t("online.player.avatarHint", {
              nation: countryName(player.nationality, i18n.language),
            })}
          </p>
        </div>
        <div className="space-y-2 rounded-xl border border-gray-200 p-3 dark:border-navy-600">
          <div className="flex flex-wrap items-center gap-3">
            {picture && (
              <PlayerAvatar
                player={avatarOf(player, { [player.id]: picture })}
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
            {player.hasAvatarImage && (
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
            {t("online.player.avatarUploadHint")}
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
                <PlayerAvatar
                  player={avatarOf({ ...player, avatarSeed: seed })}
                  className="flex aspect-square w-full items-center justify-center overflow-hidden bg-navy-800 font-heading text-2xl font-bold text-primary-400"
                />
              </button>
            </li>
          ))}
        </ul>
        {error !== null && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error instanceof Error && !("code" in error)
              ? error.message
              : resolveBackendError(error)}
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
              disabled={saving || (player.avatarSeed === undefined && !player.hasAvatarImage)}
              onClick={() => saveFace("")}
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
                (picked === player.avatarSeed && !player.hasAvatarImage)
              }
              onClick={() => saveFace(picked ?? "")}
            >
              {t("online.profile.avatarSave")}
            </Button>
          </div>
        </div>
      </div>
    </DashboardModalFrame>
  );
}
