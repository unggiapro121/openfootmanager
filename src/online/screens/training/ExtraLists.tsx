import { useTranslation } from "react-i18next";
import { Check, Zap } from "lucide-react";
import { translatePositionAbbreviation } from "../../../components/squad/SquadTab.helpers";
import { condBgColor, condColor } from "../../../lib/playerConditionDisplay";
import { getPositionColor } from "../../../lib/positionColors";
import type { SquadPlayerView } from "../../api";
import { FOCUS } from "../mobile/PhoneSheet";

const LIST =
  "overflow-hidden rounded-[14px] border border-gray-200 bg-white dark:border-navy-600 dark:bg-navy-700";
const ROW = `grid min-h-13 w-full grid-cols-[20px_34px_minmax(0,1fr)_56px] items-center gap-2.5 px-3 py-1.5 text-left disabled:opacity-50 ${FOCUS}`;

/**
 * Where a row's ⚡ opens the drinks for its player (C-17 C17-3): beside the row, never inside its
 * checkbox or its "why" button. A player a drink cannot help (injured, already full) has none.
 */
function DrinkCell({
  player,
  onDrink,
}: {
  player: SquadPlayerView;
  onDrink?: (player: SquadPlayerView) => void;
}) {
  const { t } = useTranslation();
  if (!onDrink) return null;
  if (player.injury || player.condition >= 100) return <span aria-hidden="true" />;
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={t("online.training.extra.drink.open", { name: player.matchName })}
      onClick={() => onDrink(player)}
      className={`flex h-11 w-11 items-center justify-center rounded-lg text-cyan-700 hover:bg-cyan-50 dark:text-cyan-300 dark:hover:bg-cyan-900/30 ${FOCUS}`}
    >
      <Zap className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}

/** A row's frame: the row itself, and its ⚡ when drinks can be offered. */
const rowItem = (drinks: boolean) =>
  `border-t border-gray-100 first:border-t-0 dark:border-navy-600 ${drinks ? "grid grid-cols-[minmax(0,1fr)_44px] items-center pr-1" : ""}`;

/** A player the server or the condition to keep rests today, and why. */
export interface RestingPlayer {
  player: SquadPlayerView;
  /** The server's sit-out reason, or `keepAbove` when only the condition to keep stops him. */
  reason: string;
  /** The reason as the row reads it. */
  text: string;
  /** The reason in full, as the "why" sheet or the desktop row tells it. */
  why: string;
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
function EmptyList({ text }: { text: string }) {
  return (
    <p className="rounded-[14px] border border-dashed border-gray-300 px-5 py-7 text-center text-[13px] leading-normal text-gray-500 dark:border-navy-600 dark:text-gray-400">
      {text}
    </p>
  );
}

/** Those who can train: a tap chooses one. */
function ReadyList({
  players,
  chosen,
  disabled,
  onToggle,
  onDrink,
}: {
  players: SquadPlayerView[];
  chosen: Set<string>;
  disabled: boolean;
  onToggle: (playerId: string) => void;
  onDrink?: (player: SquadPlayerView) => void;
}) {
  return (
    <ul className={LIST}>
      {players.map((player) => {
        const on = chosen.has(player.id);
        return (
          <li key={player.id} className={rowItem(onDrink !== undefined)}>
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
            <DrinkCell player={player} onDrink={onDrink} />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Those who rest this session, faded, each with why. With `onWhy` (the phone) a tap tells the
 * reason in full; without it (the desktop panel, which has the room) the row tells it.
 */
function RestList({
  players,
  onWhy,
  onDrink,
}: {
  players: RestingPlayer[];
  onWhy?: (resting: RestingPlayer) => void;
  onDrink?: (player: SquadPlayerView) => void;
}) {
  return (
    <ul className={LIST}>
      {players.map((resting) => {
        const cells = (
          <>
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
                className={`text-[11px] ${onWhy ? "truncate" : "leading-snug"} ${resting.reason === "peaked" ? "text-gray-500 dark:text-gray-400" : "text-red-600 dark:text-red-300"}`}
              >
                {onWhy ? resting.text : resting.why}
              </span>
            </span>
            <ConditionCell value={resting.player.condition} faded />
          </>
        );
        return (
          <li key={resting.player.id} className={rowItem(onDrink !== undefined)}>
            {onWhy ? (
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => onWhy(resting)}
                className={ROW}
              >
                {cells}
              </button>
            ) : (
              <div className={ROW}>{cells}</div>
            )}
            <DrinkCell player={resting.player} onDrink={onDrink} />
          </li>
        );
      })}
    </ul>
  );
}

const pill = (on: boolean) =>
  `h-9 whitespace-nowrap rounded-full border px-3 text-xs font-semibold ${on ? "border-primary-500 bg-primary-50 text-primary-800 dark:bg-primary-900/40 dark:text-primary-300" : "border-gray-200 bg-white text-gray-700 dark:border-navy-600 dark:bg-navy-800 dark:text-gray-300"} ${FOCUS}`;

export type ExtraListName = "ready" | "rest";

/** The two lists' tabs, and "choose all / none" over those who can train beside them. */
export function ExtraListTabs({
  list,
  ready,
  rest,
  allOn,
  disabled,
  onList,
  onBulk,
}: {
  list: ExtraListName;
  ready: number;
  rest: number;
  allOn: boolean;
  disabled: boolean;
  onList: (list: ExtraListName) => void;
  onBulk: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1.5">
      <div
        role="tablist"
        aria-label={t("online.training.extra.playersTitle")}
        className="flex flex-1 gap-1.5"
      >
        <button
          type="button"
          role="tab"
          aria-selected={list === "ready"}
          onClick={() => onList("ready")}
          className={pill(list === "ready")}
        >
          {t("online.training.phone.listReady", { count: ready })}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={list === "rest"}
          onClick={() => onList("rest")}
          className={pill(list === "rest")}
        >
          {t("online.training.phone.listRest", { count: rest })}
        </button>
      </div>
      {list === "ready" && ready > 0 && (
        <button
          type="button"
          disabled={disabled}
          onClick={onBulk}
          className={`h-9 whitespace-nowrap px-1 text-xs font-semibold text-primary-700 disabled:opacity-50 dark:text-primary-400 ${FOCUS}`}
        >
          {t(allOn ? "online.training.extra.selectNone" : "online.training.phone.selectReady")}
        </button>
      )}
    </div>
  );
}

/** The list the tabs show: who can train, or who rests and why; each says so when empty. */
export function ExtraListBody({
  list,
  ready,
  rest,
  chosen,
  keepAbove,
  disabled,
  onToggle,
  onWhy,
  onDrink,
}: {
  list: ExtraListName;
  ready: SquadPlayerView[];
  rest: RestingPlayer[];
  chosen: Set<string>;
  keepAbove: number | null;
  disabled: boolean;
  onToggle: (playerId: string) => void;
  onWhy?: (resting: RestingPlayer) => void;
  /** Set when drinks can be offered: opens a player's drinks (C-17 C17-3). */
  onDrink?: (player: SquadPlayerView) => void;
}) {
  const { t } = useTranslation();
  if (list === "ready") {
    if (ready.length > 0) {
      return (
        <ReadyList
          players={ready}
          chosen={chosen}
          disabled={disabled}
          onToggle={onToggle}
          onDrink={onDrink}
        />
      );
    }
    return (
      <EmptyList
        text={
          keepAbove === null
            ? t("online.training.phone.noneReady")
            : t("online.training.phone.noneReadyKeep", { value: keepAbove })
        }
      />
    );
  }
  if (rest.length === 0) return <EmptyList text={t("online.training.phone.noneResting")} />;
  return (
    <>
      {onWhy && (
        <p className="-mt-1 text-xs text-gray-500 dark:text-gray-400">
          {t("online.training.phone.restNote")}
        </p>
      )}
      <RestList players={rest} onWhy={onWhy} onDrink={onDrink} />
    </>
  );
}
