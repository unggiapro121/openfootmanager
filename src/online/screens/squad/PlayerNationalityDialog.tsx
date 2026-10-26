import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardModalFrame from "../../../components/dashboard/DashboardModalFrame";
import { Button } from "../../../components/ui";
import { CountryCombobox } from "../../../components/ui/CountryCombobox";
import { resolveBackendError } from "../../../utils/backendI18n";
import type { SquadPlayerView } from "../../api";
import { online } from "../../client";
import { tracked, useOnlineStore } from "../../store/onlineStore";
import { useActionKey } from "../useActionKey";

/**
 * Change one of the coach's players' nationality, to any nation of the game's catalogue. The
 * faces on offer for him follow it, as they are drawn from his nationality's pool.
 */
export default function PlayerNationalityDialog({
  player,
  onClose,
}: {
  player: SquadPlayerView;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const offline = useOnlineStore((state) => state.network === "offline");
  const [nation, setNation] = useState(player.nationality);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { run } = useActionKey();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saving, onClose]);

  const save = () => {
    setSaving(true);
    setError(null);
    run((key) => tracked(() => online.players.setNationality(player.id, nation, key)), nation)
      .then((club) => {
        useOnlineStore.getState().setClub(club);
        onClose();
      })
      .catch(setError)
      .finally(() => setSaving(false));
  };

  return (
    <DashboardModalFrame maxWidthClassName="max-w-md">
      <div
        className="space-y-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-nationality-title"
      >
        <div>
          <h3
            id="player-nationality-title"
            className="font-heading text-lg font-bold text-gray-900 dark:text-gray-100"
          >
            {t("online.player.nationalityTitle", { name: player.matchName })}
          </h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            {t("online.player.nationalityHint")}
          </p>
        </div>
        <CountryCombobox label={t("common.nationality")} value={nation} onChange={setNation} />
        {error !== null && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {resolveBackendError(error)}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onClose}>
            {t("online.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={saving || offline || nation === player.nationality}
            onClick={save}
          >
            {t("online.player.nationalitySave")}
          </Button>
        </div>
      </div>
    </DashboardModalFrame>
  );
}
