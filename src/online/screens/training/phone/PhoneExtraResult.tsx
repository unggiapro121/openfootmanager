import { useTranslation } from "react-i18next";
import type { ExtraSessionView, MyClubView } from "../../../api";
import type { PlayerAttributes } from "../../../api/domain/PlayerAttributes";
import { FOCUS, PhoneSheet } from "../../mobile/PhoneSheet";
import { stopReasonKey } from "../extraText";
import { namedGains, pressTotals, unimproved } from "./extraResult";
import { PositionBadge } from "./PhoneExtraLists";

const KEY = "online.training.phone";
const TILE = "rounded-[10px] bg-gray-50 px-1 py-2.5 text-center dark:bg-navy-900";
const TILE_VALUE = "font-heading text-2xl font-bold leading-tight";
const TILE_LABEL = "text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400";

/** A press's result as the phone keeps it: the server's answer and the attributes before it. */
export interface ExtraOutcome {
  result: ExtraSessionView;
  before: Map<string, PlayerAttributes>;
}

/**
 * The answer to a press on a phone (design MTapThem "Kết quả tập thêm"): attributes risen, the
 * players who rose of those chosen, and the sessions held; then each who rose with what rose,
 * and the others grouped by what happened to them.
 */
export function PhoneExtraResult({
  club,
  outcome,
  floor,
  onClose,
}: {
  club: MyClubView;
  outcome: ExtraOutcome;
  floor: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { result, before } = outcome;
  const byId = new Map(club.players.map((player) => [player.id, player]));
  const nameOf = (playerId: string) => byId.get(playerId)?.matchName ?? playerId;
  const totals = pressTotals(result.players);
  const risen = result.players
    .filter((line) => line.gains > 0)
    .sort((left, right) => right.gains - left.gains);
  const groupLabel = (kind: string) =>
    kind === "trained" ? t(`${KEY}.notYet`) : t(stopReasonKey(kind), { floor });

  return (
    <PhoneSheet
      kicker={`${t("online.training.extra.title")} · ${t(`training.intensities.${result.intensity}.label`)}`}
      title={t(`${KEY}.resultTitle`)}
      onClose={onClose}
    >
      <div role="status" className="grid grid-cols-3 gap-2">
        <div className={TILE}>
          <div className={`${TILE_VALUE} text-primary-600 dark:text-primary-400`}>
            +{totals.gains}
          </div>
          <div className={TILE_LABEL}>{t(`${KEY}.tileGains`)}</div>
        </div>
        <div className={TILE}>
          <div className={`${TILE_VALUE} text-gray-900 dark:text-white`}>
            {totals.improved}
            <span className="text-base text-gray-500 dark:text-gray-400">/{totals.players}</span>
          </div>
          <div className={TILE_LABEL}>{t(`${KEY}.tileImproved`)}</div>
        </div>
        <div className={TILE}>
          <div className={`${TILE_VALUE} text-gray-900 dark:text-white`}>{result.held}</div>
          <div className={TILE_LABEL}>{t(`${KEY}.tileSessions`)}</div>
        </div>
      </div>

      {risen.length > 0 ? (
        <ul
          aria-label={t(`${KEY}.risenList`)}
          className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-navy-700 dark:bg-navy-900"
        >
          {risen.map((line) => {
            const player = byId.get(line.playerId);
            const named = namedGains(before.get(line.playerId), player?.attributes, line.gains);
            return (
              <li
                key={line.playerId}
                className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-gray-200 px-3 py-2.5 first:border-t-0 dark:border-navy-700"
              >
                {player ? <PositionBadge player={player} /> : <span />}
                <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                  {nameOf(line.playerId)}
                </span>
                <span className="flex max-w-[190px] flex-wrap justify-end gap-1.5">
                  {named ? (
                    named.map((gain) => (
                      <GainChip key={gain.attribute}>
                        {t(`common.attributes.${gain.attribute}`)}{" "}
                        <strong className="text-primary-600 dark:text-primary-400">
                          +{gain.by}
                        </strong>
                      </GainChip>
                    ))
                  ) : (
                    <GainChip>
                      {t("online.training.extra.gainsCount", { gains: line.gains })}
                    </GainChip>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-gray-300 px-3 py-3.5 text-center text-[13px] text-gray-500 dark:border-navy-700 dark:text-gray-400">
          {t(`${KEY}.noGainYet`)}
        </p>
      )}

      {unimproved(result.players).map((group) => (
        <p key={group.kind} className="text-xs leading-normal text-gray-500 dark:text-gray-400">
          <strong className="font-semibold text-gray-600 dark:text-gray-300">
            {groupLabel(group.kind)} ({group.playerIds.length}):
          </strong>{" "}
          {group.playerIds.map(nameOf).join(", ")}
        </p>
      ))}

      <button
        type="button"
        onClick={onClose}
        className={`h-12 shrink-0 rounded-[10px] bg-gray-100 text-sm font-semibold text-gray-900 dark:bg-navy-700 dark:text-white ${FOCUS}`}
      >
        {t("common.close")}
      </button>
    </PhoneSheet>
  );
}

function GainChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-6.5 items-center gap-1 whitespace-nowrap rounded-full border border-primary-200 bg-primary-50 px-2 text-xs font-semibold text-primary-800 dark:border-primary-800 dark:bg-primary-900/40 dark:text-primary-300">
      {children}
    </span>
  );
}
