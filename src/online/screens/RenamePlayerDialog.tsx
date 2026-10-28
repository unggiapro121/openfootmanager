import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardModalFrame from "../../components/dashboard/DashboardModalFrame";
import { Button } from "../../components/ui";
import type { SquadPlayerView } from "../api";
import { online } from "../client";
import { tracked, useOnlineStore } from "../store/onlineStore";
import RenameCardNote, { useRenameCard } from "./RenameCardNote";
import { renameErrorText } from "./renameText";
import { useActionKey } from "./useActionKey";

/** The lengths the server takes (S-14): checked here only so a hopeless name is not sent. */
const FULL_NAME = { min: 2, max: 40 };
const MATCH_NAME = { min: 2, max: 20 };

function fits(name: string, { min, max }: { min: number; max: number }): boolean {
  const length = [...name.trim()].length;
  return length >= min && length <= max;
}

/**
 * Renaming one of the coach's players (S-14): his full name and the name on the radar, in one
 * request. The first rename of a player is free; a later one needs a player-rename card.
 */
export default function RenamePlayerDialog({
  player,
  onClose,
}: {
  player: SquadPlayerView;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const offline = useOnlineStore((state) => state.network === "offline");
  const [fullName, setFullName] = useState(player.fullName);
  const [matchName, setMatchName] = useState(player.matchName);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const { run } = useActionKey();
  const { blocked: needsCard } = useRenameCard("playerRename", player.renameFree);
  const valid = fits(fullName, FULL_NAME) && fits(matchName, MATCH_NAME) && !needsCard;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const full = fullName.trim();
    const short = matchName.trim();
    setSaving(true);
    setError(null);
    run(
      (key) => tracked(() => online.players.rename(player.id, full, short, key)),
      `${full}\n${short}`,
    )
      .then((club) => {
        useOnlineStore.getState().setClub(club);
        onClose();
      })
      .catch(setError)
      .finally(() => setSaving(false));
  };

  const field =
    "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-navy-600 dark:bg-navy-800 dark:text-gray-100";

  return (
    <DashboardModalFrame maxWidthClassName="max-w-md">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-player-title"
        onSubmit={submit}
        className="space-y-3 text-sm text-gray-700 dark:text-gray-300"
      >
        <h3
          id="rename-player-title"
          className="font-heading text-lg font-bold text-gray-900 dark:text-gray-100"
        >
          {t("online.rename.title", { player: player.fullName })}
        </h3>
        <div className="space-y-1">
          <label htmlFor="rename-full-name" className="block text-xs font-semibold uppercase">
            {t("online.rename.fullName")}
          </label>
          <input
            id="rename-full-name"
            value={fullName}
            maxLength={60}
            onChange={(event) => setFullName(event.target.value)}
            className={field}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="rename-match-name" className="block text-xs font-semibold uppercase">
            {t("online.rename.matchName")}
          </label>
          <input
            id="rename-match-name"
            value={matchName}
            maxLength={40}
            onChange={(event) => setMatchName(event.target.value)}
            aria-describedby="rename-player-hint"
            className={field}
          />
        </div>
        <p id="rename-player-hint" className="text-xs text-gray-500 dark:text-gray-400">
          {t("online.rename.hint", {
            full: `${FULL_NAME.min}–${FULL_NAME.max}`,
            match: `${MATCH_NAME.min}–${MATCH_NAME.max}`,
          })}
        </p>
        <RenameCardNote card="playerRename" free={player.renameFree} />
        {error !== null && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {renameErrorText(t, error)}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {t("online.cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={saving || offline || !valid}>
            {t("online.rename.save")}
          </Button>
        </div>
      </form>
    </DashboardModalFrame>
  );
}
