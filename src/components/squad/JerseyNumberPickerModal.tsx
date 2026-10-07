import { useEffect, useMemo, useState, type JSX } from "react";
import { useTranslation } from "react-i18next";

import DashboardModalFrame from "../dashboard/DashboardModalFrame";
import { Button } from "../ui";
import type { GameStateData, PlayerData } from "../../store/gameStore";
import { assignJerseyNumber } from "../../services/squadService";
import { resolveTranslatedErrorMessage } from "../../utils/errorMessage";

const SHIRT_NUMBERS = Array.from({ length: 99 }, (_, i) => i + 1);

interface JerseyNumberPickerModalProps {
  player: PlayerData;
  /** Everyone at the club, so the grid can show who wears each number. */
  squad: PlayerData[];
  onClose: () => void;
  onAssigned: (game: GameStateData) => void;
}

/**
 * Pick a shirt number from 1–99. A free number is taken straight away; a
 * number someone else wears asks first, then the two players trade shirts.
 */
export default function JerseyNumberPickerModal({
  player,
  squad,
  onClose,
  onAssigned,
}: JerseyNumberPickerModalProps): JSX.Element {
  const { t } = useTranslation();
  const [pendingSwap, setPendingSwap] = useState<{ number: number; holder: PlayerData } | null>(
    null,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const holderByNumber = useMemo(() => {
    const holders = new Map<number, PlayerData>();
    for (const other of squad) {
      if (other.id !== player.id && other.jersey_number != null) {
        holders.set(other.jersey_number, other);
      }
    }
    return holders;
  }, [squad, player.id]);

  // Escape backs out one step: out of the swap question first, then the picker.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isSaving) return;
      if (pendingSwap) setPendingSwap(null);
      else onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pendingSwap, isSaving, onClose]);

  const assign = async (jerseyNumber: number | null, swapWithHolder: boolean) => {
    setIsSaving(true);
    setError(null);
    try {
      const updated = await assignJerseyNumber(player.id, jerseyNumber, swapWithHolder);
      onAssigned(updated);
      onClose();
    } catch (err) {
      setError(resolveTranslatedErrorMessage(err, t));
      setPendingSwap(null);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePick = (shirt: number) => {
    if (shirt === player.jersey_number) return;
    const holder = holderByNumber.get(shirt);
    if (holder) {
      setPendingSwap({ number: shirt, holder });
      return;
    }
    void assign(shirt, false);
  };

  return (
    <DashboardModalFrame maxWidthClassName="max-w-xl">
      <div
        className="space-y-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="jersey-picker-title"
        data-testid="jersey-number-picker"
      >
        <div>
          <h3
            id="jersey-picker-title"
            className="text-lg font-heading font-bold text-gray-900 dark:text-gray-100"
          >
            {t("squad.jerseyPickerTitle", { name: player.match_name })}
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
                holder: pendingSwap.holder.match_name,
              })}
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {player.jersey_number != null
                ? t("squad.jerseyPickerSwapGetsOld", {
                    holder: pendingSwap.holder.match_name,
                    number: player.jersey_number,
                  })
                : t("squad.jerseyPickerSwapGetsNone", { holder: pendingSwap.holder.match_name })}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isSaving}
                onClick={() => setPendingSwap(null)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={isSaving}
                onClick={() => void assign(pendingSwap.number, true)}
              >
                {t("squad.jerseyPickerSwapConfirm")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-10 gap-1">
            {SHIRT_NUMBERS.map((shirt) => {
              const holder = holderByNumber.get(shirt);
              const isCurrent = shirt === player.jersey_number;
              const tone = isCurrent
                ? "bg-primary-500 text-white ring-2 ring-primary-300"
                : holder
                  ? "bg-gray-100 text-gray-400 hover:bg-amber-100 hover:text-amber-700 dark:bg-navy-900 dark:text-gray-500 dark:hover:bg-amber-500/15 dark:hover:text-amber-300"
                  : "bg-white text-gray-800 hover:bg-primary-50 hover:text-primary-700 dark:bg-navy-700 dark:text-gray-100 dark:hover:bg-primary-500/20";
              return (
                <button
                  key={shirt}
                  type="button"
                  disabled={isSaving}
                  aria-pressed={isCurrent}
                  aria-label={
                    holder
                      ? t("squad.jerseyPickerTakenBy", { number: shirt, name: holder.match_name })
                      : `#${shirt}`
                  }
                  title={holder ? holder.match_name : undefined}
                  onClick={() => handlePick(shirt)}
                  className={`flex h-11 flex-col items-center justify-center rounded-md border border-gray-200 px-0.5 font-heading tabular-nums transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 dark:border-navy-600 dark:focus:ring-offset-navy-800 ${tone}`}
                >
                  <span className="text-sm font-bold leading-none">{shirt}</span>
                  {holder && (
                    <span className="mt-0.5 w-full truncate text-center text-[9px] leading-none">
                      {holder.match_name}
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
            disabled={isSaving || player.jersey_number == null}
            onClick={() => void assign(null, false)}
          >
            {t("squad.jerseyPickerClear")}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={isSaving} onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    </DashboardModalFrame>
  );
}
