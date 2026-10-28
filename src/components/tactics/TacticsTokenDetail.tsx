import type { JSX } from "react";
import { useTranslation } from "react-i18next";

import type { PlayerRole } from "../../store/types";
import { getRoleOptions } from "../../lib/playerRoles";
import { Select, type PitchTokenMarker } from "../ui";
import { type TacticsLimits, licenceLock, lockedOption } from "./licenceLimits";

interface TacticsTokenDetailProps {
  id: string;
  playerId: string;
  playerName: string;
  condition: number;
  /** The deployed slot: roles follow it, as the backend validates (#272). */
  slotPosition: string;
  /** Slot coordinates in % of the pitch, to keep the card inside it. */
  slotX: number;
  slotY: number;
  role: PlayerRole;
  markers: PitchTokenMarker[];
  limits?: TacticsLimits;
  onRoleChange?: (playerId: string, role: PlayerRole) => void;
  onClose: () => void;
}

/**
 * Where the card sits around its token: below it, or above it for the lower
 * rows so it stays on the pitch; pinned to a side near the touchlines.
 */
function placementClass(slotX: number, slotY: number): string {
  const vertical = slotY > 55 ? "bottom-15" : "top-15";
  if (slotX < 25) return `${vertical} -left-12`;
  if (slotX > 75) return `${vertical} -right-12`;
  return `${vertical} left-0 -translate-x-1/2`;
}

/**
 * The selected starter's card on the tactics board: condition, the tactical
 * role picker and the duties he carries. The token itself stays compact; this
 * opens only while he is selected.
 */
export default function TacticsTokenDetail({
  id,
  playerId,
  playerName,
  condition,
  slotPosition,
  slotX,
  slotY,
  role,
  markers,
  limits,
  onRoleChange,
  onClose,
}: TacticsTokenDetailProps): JSX.Element {
  const { t } = useTranslation();
  const roleLabelId = `${id}-role`;

  return (
    // Clicks stop here so they never reach the pitch, which would deselect him.
    <fieldset
      id={id}
      aria-label={playerName}
      data-testid={`pitch-player-detail-${playerId}`}
      draggable={false}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") onClose();
      }}
      className={`absolute z-30 flex w-54 cursor-default flex-col gap-2.5 rounded-xl border border-gray-200 bg-white p-3 text-left text-navy-900 shadow-xl dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100 ${placementClass(slotX, slotY)}`}
    >
      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
        {t("common.condition")}
        <strong className="tabular-nums text-navy-900 dark:text-white">
          {Math.round(condition)}%
        </strong>
      </div>

      {onRoleChange ? (
        <div className="flex flex-col gap-1">
          <span id={roleLabelId} className="text-xs text-gray-500 dark:text-gray-400">
            {t("tactics.playerRoleLabel")}
          </span>
          <Select
            selectSize="sm"
            fullWidth
            aria-labelledby={roleLabelId}
            value={role}
            onChange={(event) => onRoleChange(playerId, event.target.value as PlayerRole)}
          >
            {getRoleOptions(slotPosition, role).map((option) => {
              const label = t(`tactics.playerRoles.${option}`, option);
              const lock = licenceLock(limits, { kind: "role", value: option });
              return (
                <option key={option} value={option} disabled={lock !== null}>
                  {lock ? lockedOption(t, label, lock) : label}
                </option>
              );
            })}
          </Select>
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {t("tactics.responsibilities")}
        </span>
        {markers.length > 0 ? (
          <ul className="flex flex-wrap gap-1">
            {markers.map((marker) => (
              <li
                key={marker.key}
                className={`inline-flex h-6 items-center gap-1 rounded-full px-2 font-heading text-xs font-bold tracking-[0.05em] ${marker.fillClassName}`}
              >
                {marker.shortLabel}
                <span className="font-sans text-[11px] font-medium tracking-normal">
                  {t(`tactics.dutyShort.${marker.key}`)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t("tactics.noSpecialRoles")}
          </span>
        )}
      </div>
    </fieldset>
  );
}
