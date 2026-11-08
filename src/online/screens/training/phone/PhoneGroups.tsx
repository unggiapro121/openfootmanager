import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Plus, Trash2, Undo2 } from "lucide-react";
import { translatePositionAbbreviation } from "../../../../components/squad/SquadTab.helpers";
import { GroupNameInput } from "../../../../components/training/TrainingGroupsCard";
import {
  MAX_GROUPS,
  newTrainingGroup,
  reassignPlayerTrainingGroup,
  sortTrainingRoster,
  type TrainingRosterPlayer,
} from "../../../../components/training/trainingGroupsModel";
import {
  TRAINING_FOCUS_ICONS,
  TRAINING_FOCUS_IDS,
} from "../../../../components/training/trainingOptions";
import { condBgColor, condColor } from "../../../../lib/playerConditionDisplay";
import { getPositionColor } from "../../../../lib/positionColors";
import type { TrainingGroupData } from "../../../../store/types";
import type { FocusFitView } from "../../../api";
import { teamFocusLabel } from "../autoFocus";
import FocusHint from "../FocusHint";
import { KeeperDrillBadge } from "../KeeperDrillBadge";
import { trainsKeeperDrill } from "../keeperDrill";
import { IconLead, type PickerOption, PhonePicker } from "../../mobile/PhonePicker";
import { FOCUS } from "../../mobile/PhoneSheet";
import { filteredRoster, type GroupFilter, groupOf } from "../trainingView";

const KEY = "online.training.phone";
const CHIP = (on: boolean) =>
  `h-9 shrink-0 rounded-full border px-3 text-[13px] font-semibold ${on ? "border-primary-500 bg-primary-50 text-primary-800 dark:bg-primary-900/40 dark:text-primary-300" : "border-gray-200 bg-white text-gray-700 dark:border-navy-700 dark:bg-navy-800 dark:text-gray-200"} ${FOCUS}`;
const SELECT = `h-11 w-full rounded-[10px] border border-gray-300 bg-white px-3 text-[15px] text-gray-900 dark:border-navy-600 dark:bg-navy-900 dark:text-white ${FOCUS}`;
const LABEL =
  "flex flex-col gap-1 text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400";

type Translate = ReturnType<typeof useTranslation>["t"];

/** The six focuses as a picker's rows: each icon, name and what it trains. */
function focusOptions(t: Translate): PickerOption[] {
  return TRAINING_FOCUS_IDS.map((id) => ({
    value: id,
    label: t(`training.focuses.${id}.label`),
    detail: t(`training.focuses.${id}.desc`),
    lead: <IconLead>{TRAINING_FOCUS_ICONS[id]}</IconLead>,
  }));
}

/**
 * The groups tab on a phone (design m-tap-luyen "Nhóm"): a chip per group that filters the
 * players, the chosen group's name, focus and removal, a way to add one; then the players, each a
 * row that opens to set his group and his own focus. Nothing is saved here: the page passes how.
 */
export function PhoneGroups({
  groups,
  teamFocus,
  teamAuto = false,
  roster,
  focusFits = {},
  keeperDrill = false,
  disabled,
  onSaveGroups,
  onSetPlayerFocus,
}: {
  groups: TrainingGroupData[];
  teamFocus: string;
  /** The club trains on "Auto" (C-13b): a player who follows the club trains Auto's pick. */
  teamAuto?: boolean;
  roster: TrainingRosterPlayer[];
  /** How each player's focus suits him (S-31b), by id; a player without one shows no hint. */
  focusFits?: Record<string, FocusFitView>;
  /** The season's keepers train their own drill (`TrainingDayView.keeperDrill`): badge them. */
  keeperDrill?: boolean;
  disabled: boolean;
  onSaveGroups: (groups: TrainingGroupData[]) => void;
  onSetPlayerFocus: (playerId: string, focus: string | null) => void;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<GroupFilter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const chosen = groups.find((group) => group.id === filter);
  const shown = filteredRoster(sortTrainingRoster(roster), groups, chosen ? filter : "all");
  const setGroupField = (groupId: string, field: Partial<TrainingGroupData>) =>
    onSaveGroups(groups.map((group) => (group.id === groupId ? { ...group, ...field } : group)));

  return (
    <div className="flex flex-col gap-3">
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5">
        <button
          type="button"
          aria-pressed={!chosen}
          onClick={() => setFilter("all")}
          className={CHIP(!chosen)}
        >
          {t("online.training.groups.all", { count: roster.length })}
        </button>
        {groups.map((group) => (
          <button
            key={group.id}
            type="button"
            aria-pressed={group.id === filter}
            onClick={() => setFilter(group.id === filter ? "all" : group.id)}
            className={CHIP(group.id === filter)}
          >
            {`${group.name} (${group.player_ids.length})`}
          </button>
        ))}
        {groups.length < MAX_GROUPS && (
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              onSaveGroups([
                ...groups,
                newTrainingGroup(t(`training.groups.defaultGroupNames.${groups.length}`)),
              ])
            }
            className={`inline-flex h-9 shrink-0 items-center gap-1 rounded-full border border-dashed border-gray-400 px-3 text-[13px] font-semibold text-gray-600 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 ${FOCUS}`}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {t("training.groups.addGroup")}
          </button>
        )}
      </div>

      {chosen && (
        <section
          aria-label={t(`${KEY}.groupOf`, { name: chosen.name })}
          className="flex flex-col gap-2.5 rounded-xl border border-primary-300 bg-white p-3 dark:border-primary-800 dark:bg-navy-800"
        >
          <div className={LABEL}>
            <span aria-hidden="true">{t("training.groups.groupName")}</span>
            <GroupNameInput
              name={chosen.name}
              onCommit={(name) => setGroupField(chosen.id, { name })}
              className={`${SELECT} normal-case tracking-normal`}
            />
          </div>
          <div className={LABEL}>
            <span aria-hidden="true">{t(`${KEY}.groupFocus`)}</span>
            <PhonePicker
              label={t("online.training.groups.focusOf", { name: chosen.name })}
              value={chosen.focus}
              disabled={disabled}
              options={focusOptions(t)}
              onChange={(focus) => setGroupField(chosen.id, { focus })}
              className="normal-case tracking-normal"
            />
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setFilter("all");
              onSaveGroups(groups.filter((group) => group.id !== chosen.id));
            }}
            className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-[10px] text-[13px] font-semibold text-red-600 disabled:opacity-50 dark:text-red-400 ${FOCUS}`}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {t("training.groups.removeGroup")}
          </button>
        </section>
      )}

      {shown.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
          {t("online.training.groups.empty")}
        </p>
      ) : (
        <ul
          aria-label={t(`${KEY}.players`)}
          className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-navy-700 dark:bg-navy-800"
        >
          {shown.map((player) => (
            <PlayerRow
              key={player.id}
              player={player}
              groups={groups}
              teamFocus={teamFocus}
              teamAuto={teamAuto}
              focusFit={focusFits[player.id]}
              keeperDrill={keeperDrill}
              open={open === player.id}
              disabled={disabled}
              onToggle={() => setOpen(open === player.id ? null : player.id)}
              onGroup={(groupId) =>
                onSaveGroups(reassignPlayerTrainingGroup(groups, player.id, groupId))
              }
              onFocus={(focus) => onSetPlayerFocus(player.id, focus || null)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function PlayerRow({
  player,
  groups,
  teamFocus,
  teamAuto,
  focusFit,
  keeperDrill,
  open,
  disabled,
  onToggle,
  onGroup,
  onFocus,
}: {
  player: TrainingRosterPlayer;
  groups: TrainingGroupData[];
  teamFocus: string;
  teamAuto: boolean;
  focusFit?: FocusFitView;
  keeperDrill: boolean;
  open: boolean;
  disabled: boolean;
  onToggle: () => void;
  onGroup: (groupId: string) => void;
  onFocus: (focus: string) => void;
}) {
  const { t } = useTranslation();
  const groupId = groupOf(groups, player.id);
  const group = groups.find((one) => one.id === groupId);
  const own = player.training_focus ?? "";
  const focus = own || group?.focus || teamFocus;
  // On "Auto" his fit is the focus Auto picks, already named in the row: no hint under it.
  const onAuto = teamAuto && !own && !group;
  const followed = group
    ? t(`training.focuses.${group.focus}.label`)
    : teamFocusLabel(t, teamFocus, teamAuto, focusFit);
  const position = player.natural_position || player.position;
  const condition = Math.round(player.condition);
  return (
    <li className="border-t border-gray-100 first:border-t-0 dark:border-navy-700">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={`grid min-h-14 w-full grid-cols-[34px_minmax(0,1fr)_72px_16px] items-center gap-2.5 px-3 py-2 text-left ${open ? "bg-gray-50 dark:bg-navy-900" : ""} ${FOCUS}`}
      >
        <span
          className={`rounded px-1 text-center font-heading text-[11px] font-bold leading-[18px] text-white ${getPositionColor(position)}`}
        >
          {translatePositionAbbreviation(t, position)}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">
              {player.match_name}
              {player.jersey_number != null && (
                <span className="ml-1 font-normal text-gray-500 dark:text-gray-400">
                  #{player.jersey_number}
                </span>
              )}
            </span>
            {trainsKeeperDrill(position, keeperDrill) && <KeeperDrillBadge />}
          </span>
          <span
            className={`truncate text-[11px] ${own ? "text-primary-700 dark:text-primary-400" : "text-gray-500 dark:text-gray-400"}`}
          >
            {group ? group.name : t("training.groups.teamDefault")} ·{" "}
            {own ? t(`training.focuses.${own}.label`) : followed}
          </span>
        </span>
        <span className="flex flex-col items-end gap-1">
          <span className={`text-[13px] font-bold tabular-nums ${condColor(condition)}`}>
            {condition}%
          </span>
          <span
            aria-hidden="true"
            className="h-1 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-navy-700"
          >
            <span
              className={`block h-full ${condBgColor(condition)}`}
              style={{ width: `${Math.min(100, Math.max(0, condition))}%` }}
            />
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 text-gray-400 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="grid grid-cols-2 gap-2 bg-gray-50 px-3 pb-3 dark:bg-navy-900">
          <div className={LABEL}>
            <span aria-hidden="true">{t("training.groups.group")}</span>
            <PhonePicker
              label={t("online.training.groups.groupOf", { name: player.match_name })}
              size="sm"
              value={groupId}
              disabled={disabled}
              options={[
                {
                  value: "",
                  label: t("training.groups.teamDefault"),
                  detail: teamAuto
                    ? t("online.training.focus.auto")
                    : t(`training.focuses.${teamFocus}.label`),
                  muted: true,
                },
                ...groups.map((one) => ({
                  value: one.id,
                  label: one.name,
                  detail: t(`training.focuses.${one.focus}.label`),
                })),
              ]}
              onChange={onGroup}
              className="normal-case tracking-normal"
            />
          </div>
          <div className={LABEL}>
            <span aria-hidden="true">{t("training.effectiveFocus")}</span>
            <PhonePicker
              label={t("online.training.groups.focusOfPlayer", { name: player.match_name })}
              size="sm"
              value={own}
              disabled={disabled}
              options={[
                {
                  value: "",
                  label: t("online.training.groups.inherited", { focus: followed }),
                  lead: (
                    <IconLead soft>
                      <Undo2 />
                    </IconLead>
                  ),
                  muted: true,
                },
                ...focusOptions(t),
              ]}
              onChange={onFocus}
              className="normal-case tracking-normal"
            />
          </div>
          {!onAuto && (
            <span className="col-span-2">
              <FocusHint fit={focusFit} shown={focus} />
            </span>
          )}
        </div>
      )}
    </li>
  );
}
