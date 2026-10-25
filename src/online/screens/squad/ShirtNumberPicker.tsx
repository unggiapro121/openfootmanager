import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardModalFrame from "../../../components/dashboard/DashboardModalFrame";
import { Button } from "../../../components/ui";
import { resolveBackendError } from "../../../utils/backendI18n";
import type { SquadPlayerView } from "../../api";
import { online } from "../../client";
import { tracked, useOnlineStore } from "../../store/onlineStore";
import { useActionKey } from "../useActionKey";

const SHIRT_NUMBERS = Array.from({ length: 99 }, (_, index) => index + 1);

/**
 * Pick a shirt number from 1 to 99 for one of the coach's players, as the offline squad's picker
 * does: a free number is taken at once; a number another player wears asks first, then the two
 * trade shirts. The server decides (`PATCH /v1/players/{id}/shirt`); the squad is the answer.
 */
export default function ShirtNumberPicker({
  player,
  onClose,
}: {
  player: SquadPlayerView;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const squad = useOnlineStore((state) => state.club?.players);
  const offline = useOnlineStore((state) => state.network === "offline");
  const [pendingSwap, setPendingSwap] = useState<{
    number: number;
    holder: SquadPlayerView;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { run } = useActionKey();

  const holderByNumber = useMemo(() => {
    const holders = new Map<number, SquadPlayerView>();
    for (const other of squad ?? []) {
      if (other.id !== player.id && other.shirtNumber !== undefined) {
        holders.set(other.shirtNumber, other);
      }
    }
    return holders;
  }, [squad, player.id]);

  // Escape backs out one step: out of the swap question first, then the picker.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || saving) return;
      if (pendingSwap) setPendingSwap(null);
      else onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pendingSwap, saving, onClose]);

  const assign = (number: number | null, swap: boolean) => {
    setSaving(true);
    setError(null);
    run(
      (key) => tracked(() => online.players.shirt(player.id, number, swap, key)),
      `${number}|${swap}`,
    )
      .then((club) => {
        useOnlineStore.getState().setClub(club);
        onClose();
      })
      .catch((failure) => {
        setError(resolveBackendError(failure));
        setPendingSwap(null);
      })
      .finally(() => setSaving(false));
  };

  const pick = (shirt: number) => {
    if (shirt === player.shirtNumber) return;
    const holder = holderByNumber.get(shirt);
    if (holder) setPendingSwap({ number: shirt, holder });
    else assign(shirt, false);
  };

  return (
    <DashboardModalFrame maxWidthClassName="max-w-xl">
      <div
        className="space-y-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shirt-picker-title"
      >
        <div>
          <h3
            id="shirt-picker-title"
            className="font-heading text-lg font-bold text-gray-900 dark:text-gray-100"
          >
            {t("squad.jerseyPickerTitle", { name: player.matchName })}
          </h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            {t("squad.jerseyPickerHint")}
          </p>
        </div>

        {pendingSwap ? (
          <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-500/10">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {t("squad.jerseyPickerSwapPrompt", {
                number: pendingSwap.number,
                holder: pendingSwap.holder.matchName,
              })}
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {player.shirtNumber !== undefined
                ? t("squad.jerseyPickerSwapGetsOld", {
                    holder: pendingSwap.holder.matchName,
                    number: player.shirtNumber,
                  })
                : t("squad.jerseyPickerSwapGetsNone", { holder: pendingSwap.holder.matchName })}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => setPendingSwap(null)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={saving || offline}
                onClick={() => assign(pendingSwap.number, true)}
              >
                {t("squad.jerseyPickerSwapConfirm")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-10 gap-1">
            {SHIRT_NUMBERS.map((shirt) => {
              const holder = holderByNumber.get(shirt);
              const isCurrent = shirt === player.shirtNumber;
              const tone = isCurrent
                ? "bg-primary-500 text-white ring-2 ring-primary-300"
                : holder
                  ? "bg-gray-100 text-gray-400 hover:bg-amber-100 hover:text-amber-700 dark:bg-navy-900 dark:text-gray-500 dark:hover:bg-amber-500/15 dark:hover:text-amber-300"
                  : "bg-white text-gray-800 hover:bg-primary-50 hover:text-primary-700 dark:bg-navy-700 dark:text-gray-100 dark:hover:bg-primary-500/20";
              return (
                <button
                  key={shirt}
                  type="button"
                  disabled={saving || offline}
                  aria-pressed={isCurrent}
                  aria-label={
                    holder
                      ? t("squad.jerseyPickerTakenBy", { number: shirt, name: holder.matchName })
                      : `#${shirt}`
                  }
                  title={holder ? holder.matchName : undefined}
                  onClick={() => pick(shirt)}
                  className={`flex h-11 flex-col items-center justify-center rounded-md border border-gray-200 px-0.5 font-heading tabular-nums transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 dark:border-navy-600 dark:focus:ring-offset-navy-800 ${tone}`}
                >
                  <span className="text-sm font-bold leading-none">{shirt}</span>
                  {holder && (
                    <span className="mt-0.5 w-full truncate text-center text-[9px] leading-none">
                      {holder.matchName}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={saving || offline || player.shirtNumber === undefined}
            onClick={() => assign(null, false)}
          >
            {t("squad.jerseyPickerClear")}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={saving} onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    </DashboardModalFrame>
  );
}
