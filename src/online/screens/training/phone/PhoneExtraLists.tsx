import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { translatePositionAbbreviation } from "../../../../components/squad/SquadTab.helpers";
import { condBgColor, condColor } from "../../../../lib/playerConditionDisplay";
import { getPositionColor } from "../../../../lib/positionColors";
import type { SquadPlayerView } from "../../../api";
import { FOCUS } from "../../mobile/PhoneSheet";

const LIST =
  "overflow-hidden rounded-[14px] border border-gray-200 bg-white dark:border-navy-600 dark:bg-navy-700";
const ROW = `grid min-h-13 w-full grid-cols-[20px_34px_minmax(0,1fr)_56px] items-center gap-2.5 px-3 py-1.5 text-left disabled:opacity-50 ${FOCUS}`;

/** A player the server or the condition to keep rests today, and why. */
export interface RestingPlayer {
  player: SquadPlayerView;
  /** The server's sit-out reason, or `keepAbove` when only the condition to keep stops him. */
  reason: string;
  /** The reason as the row reads it. */
  text: string;
}

export function PositionBadge({ player, faded }: { player: SquadPlayerView; faded?: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      className={`justify-self-start rounded-md px-1.5 font-heading text-xs font-bold leading-[18px] tracking-wide text-white ${getPositionColor(player.naturalPosition)} ${faded ? "opacity-50" : ""}`}
    >
      {translatePositionAbbreviation(t, player.naturalPosition)}
    </span>
  );
}

function ConditionCell({ value, faded }: { value: number; faded?: boolean }) {
  const condition = Math.round(value);
  return (
    <span className={`flex flex-col items-end gap-1 ${faded ? "opacity-50" : ""}`}>
      <span className={`text-[13px] font-bold tabular-nums ${condColor(condition)}`}>
        {condition}%
      </span>
      <span
        aria-hidden="true"
        className="h-1 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-navy-600"
      >
        <span
          className={`block h-full ${condBgColor(condition)}`}
          style={{ width: `${Math.min(100, Math.max(0, condition))}%` }}
        />
      </span>
    </span>
  );
}

/** Nothing to list: why, in a dashed box. */
export function EmptyList({ text }: { text: string }) {
  return (
    <p className="rounded-[14px] border border-dashed border-gray-300 px-5 py-7 text-center text-[13px] leading-normal text-gray-500 dark:border-navy-600 dark:text-gray-400">
      {text}
    </p>
  );
}

/** Those who can train: a tap chooses one. */
export function ReadyList({
  players,
  chosen,
  disabled,
  onToggle,
}: {
  players: SquadPlayerView[];
  chosen: Set<string>;
  disabled: boolean;
  onToggle: (playerId: string) => void;
}) {
  return (
    <ul className={LIST}>
      {players.map((player) => {
        const on = chosen.has(player.id);
        return (
          <li
            key={player.id}
            className="border-t border-gray-100 first:border-t-0 dark:border-navy-600"
          >
            <button
              type="button"
              role="checkbox"
              aria-checked={on}
              aria-label={player.matchName}
              disabled={disabled}
              onClick={() => onToggle(player.id)}
              className={`${ROW} ${on ? "bg-primary-50 dark:bg-primary-900/20" : ""}`}
            >
              <span
                aria-hidden="true"
                className={`flex h-5 w-5 items-center justify-center rounded-md border-2 ${on ? "border-primary-500 bg-primary-500 text-white dark:text-navy-900" : "border-gray-400 dark:border-gray-500"}`}
              >
                {on && <Check className="h-3 w-3" strokeWidth={3} />}
              </span>
              <PositionBadge player={player} />
              <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                {player.matchName}
              </span>
              <ConditionCell value={player.condition} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Those who rest this session, faded, each with why; a tap tells it in full. */
export function RestList({
  players,
  onWhy,
}: {
  players: RestingPlayer[];
  onWhy: (resting: RestingPlayer) => void;
}) {
  return (
    <ul className={LIST}>
      {players.map((resting) => (
        <li
          key={resting.player.id}
          className="border-t border-gray-100 first:border-t-0 dark:border-navy-600"
        >
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => onWhy(resting)}
            className={ROW}
          >
            <span
              aria-hidden="true"
              className="flex h-5 w-5 items-center justify-center rounded-md border-2 border-gray-300 text-xs font-extrabold text-gray-400 dark:border-gray-600 dark:text-gray-500"
            >
              –
            </span>
            <PositionBadge player={resting.player} faded />
            <span className="flex min-w-0 flex-col gap-px">
              <span className="truncate text-sm font-semibold text-gray-500 dark:text-gray-400">
                {resting.player.matchName}
              </span>
              <span
                className={`truncate text-[11px] ${resting.reason === "peaked" ? "text-gray-500 dark:text-gray-400" : "text-red-600 dark:text-red-300"}`}
              >
                {resting.text}
              </span>
            </span>
            <ConditionCell value={resting.player.condition} faded />
          </button>
        </li>
      ))}
    </ul>
  );
}
