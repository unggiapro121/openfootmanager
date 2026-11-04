import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { translatePositionAbbreviation } from "../../../components/squad/SquadTab.helpers";
import { GroupNameInput } from "../../../components/training/TrainingGroupsCard";
import {
  MAX_GROUPS,
  newTrainingGroup,
  reassignPlayerTrainingGroup,
  sortTrainingRoster,
  type TrainingRosterPlayer,
} from "../../../components/training/trainingGroupsModel";
import { TRAINING_FOCUS_IDS } from "../../../components/training/trainingOptions";
import { Badge, Select } from "../../../components/ui";
import { condBgColor, condColor } from "../../../lib/playerConditionDisplay";
import { positionBadgeVariant } from "../../../lib/playerRating";
import type { TrainingGroupData } from "../../../store/types";
import type { FocusFitView } from "../../api";
import FocusHint from "./FocusHint";
import { KeeperDrillBadge } from "./KeeperDrillBadge";
import { trainsKeeperDrill } from "./keeperDrill";
import { filteredRoster, type GroupFilter, groupOf } from "./trainingView";

const CHIP =
  "h-9 rounded-lg border px-3 text-[13px] font-semibold focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800";
const CHIP_ON =
  "border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300";
const CHIP_OFF =
  "border-gray-200 bg-gray-50 text-gray-700 hover:border-primary-400 dark:border-navy-600 dark:bg-navy-800 dark:text-gray-200";
const HEAD =
  "border-b border-gray-200 px-2 py-2.5 text-left font-heading text-xs font-semibold uppercase tracking-wider text-gray-500 dark:border-navy-600 dark:text-gray-400";
const CELL = "border-b border-gray-200 px-2 py-2 dark:border-navy-600";

/**
 * The training groups tab (design tap-luyen.html): a chip per group that filters the table and
 * sets the group's focus, a way to add one, and the squad with each player's group and own focus.
 * The chosen group can be renamed or removed. Nothing is saved here: the page passes how.
 */
export default function TrainingGroups({
  groups,
  teamFocus,
  roster,
  focusFits = {},
  keeperDrill = false,
  disabled,
  onSaveGroups,
  onSetPlayerFocus,
}: {
  groups: TrainingGroupData[];
  /** What a player with no group and no focus of his own trains. */
  teamFocus: string;
  roster: TrainingRosterPlayer[];
  /** How each player's focus suits him (S-31b), by id; a player without one shows no hint. */
  focusFits?: Record<string, FocusFitView>;
  /** The season's keepers train their own drill (`TrainingDayView.keeperDrill`): badge them. */
  keeperDrill?: boolean;
  disabled: boolean;
  /** Every group of the club, as it should be after the change. */
  onSaveGroups: (groups: TrainingGroupData[]) => void;
  /** A player's own focus; `null` takes it away. */
  onSetPlayerFocus: (playerId: string, focus: string | null) => void;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<GroupFilter>("all");
  const chosen = groups.find((group) => group.id === filter);
  const shown = filteredRoster(sortTrainingRoster(roster), groups, chosen ? filter : "all");

  const setGroupField = (groupId: string, field: Partial<TrainingGroupData>) =>
    onSaveGroups(groups.map((group) => (group.id === groupId ? { ...group, ...field } : group)));
  const addGroup = () =>
    onSaveGroups([
      ...groups,
      newTrainingGroup(t(`training.groups.defaultGroupNames.${groups.length}`)),
    ]);
  const removeGroup = (groupId: string) => {
    setFilter("all");
    onSaveGroups(groups.filter((group) => group.id !== groupId));
  };

  return (
    <section
      aria-label={t("training.groups.trainingGroups")}
      className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-navy-600 dark:bg-navy-700"
    >
      <div className="flex flex-wrap gap-2 border-b border-gray-200 px-5 py-4 dark:border-navy-600">
        <button
          type="button"
          aria-pressed={!chosen}
          onClick={() => setFilter("all")}
          className={`${CHIP} ${chosen ? CHIP_OFF : CHIP_ON}`}
        >
          {t("online.training.groups.all", { count: roster.length })}
        </button>
        {groups.map((group) => {
          const on = group.id === filter;
          return (
            <span
              key={group.id}
              className={`inline-flex items-center overflow-hidden rounded-lg border ${on ? CHIP_ON : CHIP_OFF}`}
            >
              <button
                type="button"
                aria-pressed={on}
                onClick={() => setFilter(on ? "all" : group.id)}
                className="h-8.5 px-2.5 text-[13px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
              >
                {`${group.name} (${group.player_ids.length})`}
              </button>
              <Select
                value={group.focus}
                onChange={(event) => setGroupField(group.id, { focus: event.target.value })}
                disabled={disabled}
                variant="highlighted"
                selectSize="xs"
                aria-label={t("online.training.groups.focusOf", { name: group.name })}
                wrapperClassName="border-l border-gray-200 dark:border-navy-600"
              >
                {TRAINING_FOCUS_IDS.map((id) => (
                  <option key={id} value={id}>
                    {t(`training.focuses.${id}.label`)}
                  </option>
                ))}
              </Select>
            </span>
          );
        })}
        {groups.length < MAX_GROUPS && (
          <button
            type="button"
            onClick={addGroup}
            disabled={disabled}
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-dashed border-gray-400 px-3 text-[13px] font-semibold text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-navy-600"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {t("training.groups.addGroup")}
          </button>
        )}
      </div>
      {chosen && (
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-gray-50 px-5 py-3 dark:border-navy-600 dark:bg-navy-800">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t("training.groups.groupName")}
          </span>
          <GroupNameInput
            name={chosen.name}
            onCommit={(name) => setGroupField(chosen.id, { name })}
            className="h-8 w-48 rounded-md border border-gray-300 bg-white px-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-navy-600 dark:bg-navy-900 dark:text-white"
          />
          <button
            type="button"
            onClick={() => removeGroup(chosen.id)}
            disabled={disabled}
            className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-semibold text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-500/10"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            {t("training.groups.removeGroup")}
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-190 border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" className={`${HEAD} pl-5`}>
                {t("common.player")}
              </th>
              <th scope="col" className={`${HEAD} w-16`}>
                {t("common.position")}
              </th>
              <th scope="col" className={`${HEAD} w-40`}>
                {t("common.condition")}
              </th>
              <th scope="col" className={`${HEAD} w-44`}>
                {t("training.groups.group")}
              </th>
              <th scope="col" className={`${HEAD} w-72 pr-5`}>
                {t("training.effectiveFocus")}
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((player) => (
              <GroupRow
                key={player.id}
                player={player}
                groups={groups}
                teamFocus={teamFocus}
                focusFit={focusFits[player.id]}
                keeperDrill={keeperDrill}
                disabled={disabled}
                onGroup={(groupId) =>
                  onSaveGroups(reassignPlayerTrainingGroup(groups, player.id, groupId))
                }
                onFocus={(focus) => onSetPlayerFocus(player.id, focus || null)}
              />
            ))}
          </tbody>
        </table>
        {shown.length === 0 && (
          <p className="px-5 py-4 text-sm text-gray-500 dark:text-gray-400">
            {t("online.training.groups.empty")}
          </p>
        )}
      </div>
    </section>
  );
}

/** One player: name and shirt, position, condition, his group and his focus. */
function GroupRow({
  player,
  groups,
  teamFocus,
  focusFit,
  keeperDrill,
  disabled,
  onGroup,
  onFocus,
}: {
  player: TrainingRosterPlayer;
  groups: TrainingGroupData[];
  teamFocus: string;
  focusFit?: FocusFitView;
  keeperDrill: boolean;
  disabled: boolean;
  onGroup: (groupId: string) => void;
  onFocus: (focus: string) => void;
}) {
  const { t } = useTranslation();
  const groupId = groupOf(groups, player.id);
  const inherited = groups.find((group) => group.id === groupId)?.focus ?? teamFocus;
  const own = player.training_focus ?? "";
  const position = player.natural_position || player.position;
  const condition = Math.round(player.condition);
  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-navy-600/40">
      <td className={`${CELL} pl-5 font-semibold text-gray-900 dark:text-white`}>
        {player.match_name}
        {player.jersey_number != null && (
          <span className="ml-1 font-normal text-gray-500 dark:text-gray-400">
            #{player.jersey_number}
          </span>
        )}
        {trainsKeeperDrill(position, keeperDrill) && (
          <span className="ml-2 align-middle">
            <KeeperDrillBadge />
          </span>
        )}
      </td>
      <td className={CELL}>
        <Badge variant={positionBadgeVariant(position)}>
          {translatePositionAbbreviation(t, position)}
        </Badge>
      </td>
      <td className={CELL}>
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-navy-600"
          >
            <span
              className={`block h-full ${condBgColor(condition)}`}
              style={{ width: `${Math.min(100, Math.max(0, condition))}%` }}
            />
          </span>
          <span
            className={`w-10 text-right text-[13px] font-bold tabular-nums ${condColor(condition)}`}
          >
            {condition}%
          </span>
        </span>
      </td>
      <td className={CELL}>
        <Select
          value={groupId}
          onChange={(event) => onGroup(event.target.value)}
          disabled={disabled}
          variant="muted"
          selectSize="xs"
          fullWidth
          aria-label={t("online.training.groups.groupOf", { name: player.match_name })}
        >
          <option value="">{t("training.groups.teamDefault")}</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </Select>
      </td>
      <td className={`${CELL} pr-5`}>
        <span className="flex items-center gap-1.5">
          <Select
            value={own}
            onChange={(event) => onFocus(event.target.value)}
            disabled={disabled}
            variant={own ? "highlighted" : "muted"}
            selectSize="xs"
            fullWidth
            wrapperClassName="min-w-0 flex-1"
            aria-label={t("online.training.groups.focusOfPlayer", { name: player.match_name })}
          >
            <option value="">
              {t("online.training.groups.inherited", {
                focus: t(`training.focuses.${inherited}.label`),
              })}
            </option>
            {TRAINING_FOCUS_IDS.map((id) => (
              <option key={id} value={id}>
                {t(`training.focuses.${id}.label`)}
              </option>
            ))}
          </Select>
          {!own && (
            <span className="shrink-0 rounded-md bg-gray-100 px-1.5 text-[11px] text-gray-500 dark:bg-navy-600 dark:text-gray-400">
              {t("online.training.groups.inheritedTag")}
            </span>
          )}
        </span>
        <span className="mt-1 block">
          <FocusHint fit={focusFit} shown={own || inherited} />
        </span>
      </td>
    </tr>
  );
}
