import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, Users } from "lucide-react";

import type { TrainingGroupData } from "../../store/types";
import { translatePositionAbbreviation } from "../squad/SquadTab.helpers";
import { condColor } from "../../lib/playerConditionDisplay";
import { Card, CardBody, CardHeader, Select } from "../ui";
import {
  buildPlayerGroupMap,
  reassignPlayerTrainingGroup,
  sortTrainingRoster,
  type TrainingRosterPlayer,
} from "./trainingGroupsModel";

type TrainingGroup = TrainingGroupData;

/** The most groups a club keeps. */
const MAX_GROUPS = 5;

/**
 * The training groups and each player's own session, as both modes show them. The card writes
 * nothing itself: the offline tab and the online screen each pass how a change is saved.
 */
interface TrainingGroupsCardProps {
  groups: TrainingGroup[];
  /** The club's standing session, what a player with no group and no session of his own trains. */
  teamFocus: string;
  roster: TrainingRosterPlayer[];
  isSaving: boolean;
  /** Every group of the club, as it should be after the change. */
  onSaveGroups: (groups: TrainingGroup[]) => void;
  /** A player's own session; `null` takes it away. */
  onSetPlayerFocus: (playerId: string, focus: string | null) => void;
  trainingFocusIds: readonly string[];
  trainingFocusIcons: Record<string, React.ReactNode>;
}

/** A group's name: edited freely, kept when the field is left or Enter is pressed. */
function GroupNameInput({ name, onCommit }: { name: string; onCommit: (name: string) => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(name);
  const [seen, setSeen] = useState(name);
  if (seen !== name) {
    setSeen(name);
    setDraft(name);
  }
  const commit = () => {
    const next = draft.trim();
    if (next && next !== name) {
      onCommit(next);
    } else {
      setDraft(name);
    }
  };

  return (
    <input
      type="text"
      value={draft}
      aria-label={t("training.groups.group")}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className="bg-transparent text-xs font-heading font-bold uppercase tracking-wider text-gray-800 dark:text-gray-200 border-none outline-none w-20"
    />
  );
}

export default function TrainingGroupsCard({
  groups,
  teamFocus,
  roster,
  isSaving,
  onSaveGroups,
  onSetPlayerFocus,
  trainingFocusIds,
  trainingFocusIcons,
}: TrainingGroupsCardProps) {
  const { t } = useTranslation();

  const addGroup = () => {
    if (groups.length >= MAX_GROUPS) {
      return;
    }

    const index = groups.length;
    const defaultName = t(`training.groups.defaultGroupNames.${index}`);

    onSaveGroups([
      ...groups,
      {
        id: `grp_${Date.now()}`,
        name: defaultName,
        focus: "Physical",
        player_ids: [],
      },
    ]);
  };

  const removeGroup = (groupId: string) => {
    onSaveGroups(groups.filter((group) => group.id !== groupId));
  };

  const updateGroupFocus = (groupId: string, focus: string) => {
    onSaveGroups(groups.map((group) => (group.id === groupId ? { ...group, focus } : group)));
  };

  const updateGroupName = (groupId: string, name: string) => {
    onSaveGroups(groups.map((group) => (group.id === groupId ? { ...group, name } : group)));
  };

  const setPlayerFocus = (playerId: string, focus: string) => {
    onSetPlayerFocus(playerId, focus || null);
  };

  const setPlayerGroup = (playerId: string, groupId: string) => {
    onSaveGroups(reassignPlayerTrainingGroup(groups, playerId, groupId));
  };

  const playerGroupMap = buildPlayerGroupMap(groups);
  const sortedRoster = sortTrainingRoster(roster);

  return (
    <Card>
      <CardHeader
        action={
          groups.length < MAX_GROUPS ? (
            <button
              type="button"
              onClick={addGroup}
              disabled={isSaving}
              className="flex items-center gap-1.5 text-xs font-heading font-bold uppercase tracking-wider text-primary-500 hover:text-primary-400 transition-colors disabled:opacity-50"
            >
              <Plus className="w-4 h-4" /> {t("training.groups.addGroup")}
            </button>
          ) : null
        }
      >
        {t("training.groups.trainingGroups")}
      </CardHeader>
      <CardBody>
        {groups.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {groups.map((group) => {
              const count = group.player_ids.length;

              return (
                <div
                  key={group.id}
                  className="flex items-center gap-2 bg-gray-50 dark:bg-navy-700/50 border border-gray-200 dark:border-navy-600 rounded-lg px-3 py-1.5"
                >
                  <div className="text-gray-400 dark:text-gray-500">
                    {trainingFocusIcons[group.focus] ? (
                      <span className="[&>svg]:w-4 [&>svg]:h-4">
                        {trainingFocusIcons[group.focus]}
                      </span>
                    ) : (
                      <Users className="w-4 h-4" />
                    )}
                  </div>
                  <GroupNameInput
                    name={group.name}
                    onCommit={(name) => updateGroupName(group.id, name)}
                  />
                  <Select
                    value={group.focus}
                    onChange={(event) => updateGroupFocus(group.id, event.target.value)}
                    disabled={isSaving}
                    variant="muted"
                    selectSize="xs"
                    className="w-28"
                  >
                    {trainingFocusIds.map((focusId) => (
                      <option key={focusId} value={focusId}>
                        {t(`training.focuses.${focusId}.label`)}
                      </option>
                    ))}
                  </Select>
                  <span className="text-[10px] text-gray-400 tabular-nums">{count}</span>
                  <button
                    type="button"
                    onClick={() => removeGroup(group.id)}
                    disabled={isSaving}
                    className="text-red-400 hover:text-red-500 transition-colors disabled:opacity-50"
                    title={t("training.groups.removeGroup")}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {groups.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
            {t("training.groups.noGroups")}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-navy-600">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-navy-700/50">
                  <th className="py-2 px-3 text-[10px] font-heading font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                    {t("common.player")}
                  </th>
                  <th className="py-2 px-3 text-[10px] font-heading font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                    {t("common.position")}
                  </th>
                  <th className="py-2 px-3 text-[10px] font-heading font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                    {t("common.condition")}
                  </th>
                  <th className="py-2 px-3 text-[10px] font-heading font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                    {t("training.groups.group")}
                  </th>
                  <th className="py-2 px-3 text-[10px] font-heading font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                    {t("training.effectiveFocus")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-navy-600">
                {sortedRoster.map((player) => {
                  const playerGroup = playerGroupMap.get(player.id);
                  const hasIndividualFocus = !!player.training_focus;
                  const fallbackFocus = playerGroup ? playerGroup.focus : teamFocus;

                  return (
                    <tr
                      key={player.id}
                      className="hover:bg-gray-50 dark:hover:bg-navy-700/30 transition-colors"
                    >
                      <td className="py-1.5 px-3 text-sm font-medium text-gray-800 dark:text-gray-200 truncate max-w-[160px]">
                        {player.match_name}
                        {player.jersey_number != null ? ` (#${player.jersey_number})` : ""}
                      </td>
                      <td className="py-1.5 px-3 text-xs text-gray-500 dark:text-gray-400">
                        {translatePositionAbbreviation(
                          t,
                          player.natural_position || player.position,
                        )}
                      </td>
                      <td
                        className={`py-1.5 px-3 text-xs font-heading font-bold tabular-nums ${condColor(player.condition)}`}
                      >
                        {Math.round(player.condition)}%
                      </td>
                      <td className="py-1.5 px-3">
                        <Select
                          value={playerGroup?.id || ""}
                          onChange={(event) => setPlayerGroup(player.id, event.target.value)}
                          disabled={isSaving}
                          variant="muted"
                          selectSize="xs"
                          fullWidth
                          wrapperClassName="w-full max-w-[120px]"
                        >
                          <option value="">{t("training.groups.teamDefault")}</option>
                          {groups.map((group) => (
                            <option key={group.id} value={group.id}>
                              {group.name}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="py-1.5 px-3">
                        <Select
                          value={player.training_focus || ""}
                          onChange={(event) => setPlayerFocus(player.id, event.target.value)}
                          disabled={isSaving}
                          variant={hasIndividualFocus ? "highlighted" : "placeholder"}
                          selectSize="xs"
                          fullWidth
                          wrapperClassName="w-full max-w-[110px]"
                        >
                          <option value="">{t(`training.focuses.${fallbackFocus}.label`)} ↩</option>
                          {trainingFocusIds.map((focusId) => (
                            <option key={focusId} value={focusId}>
                              {t(`training.focuses.${focusId}.label`)}
                            </option>
                          ))}
                        </Select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
          {t("training.groups.trainingGroupsDesc")}
        </p>
      </CardBody>
    </Card>
  );
}
