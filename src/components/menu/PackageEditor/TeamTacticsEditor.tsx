import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { getRoleOptions } from "../../../lib/playerRoles";
import { fetchTacticsBlueprint } from "../../../services/worldEditorService";
import type { PlayerRole, TacticsPhaseSettings, TeamMatchRolesData } from "../../../store/types";
import { FORMATIONS } from "../../match/types";
import { buildPitchRows, translatePositionAbbreviation } from "../../squad/SquadTab.helpers";
import { PhaseBlueprintPanel } from "../../tactics/PhaseBlueprintPanel";
import { Checkbox, Select } from "../../ui";
import { LabeledSelect, labelClass } from "./primitives";
import {
  MATCH_ROLE_KEYS,
  compactTactics,
  filledStarters,
  slotPositions,
  withFormation,
  withMatchRole,
  withRole,
  withStarter,
} from "./teamTactics.helpers";
import type { PlayerDef, TeamTacticsDef } from "./types";

/** The label each match role already has in the game's own screens. */
const MATCH_ROLE_LABEL_KEYS: Record<keyof TeamMatchRolesData, string> = {
  captain: "preMatch.captain",
  vice_captain: "tactics.viceCaptain",
  penalty_taker: "preMatch.penaltyTaker",
  free_kick_taker: "preMatch.freeKickTaker",
  corner_taker: "preMatch.cornerTaker",
};

interface TeamTacticsEditorProps {
  tactics: TeamTacticsDef | null | undefined;
  /** The authored players whose `club` is this team. */
  clubPlayers: PlayerDef[];
  playStyle: string;
  onChange: (tactics: TeamTacticsDef | null) => void;
  onError: (err: unknown) => void;
}

function playerLabel(player: PlayerDef): string {
  return player.name || [player.firstName, player.lastName].filter(Boolean).join(" ") || player.id;
}

/**
 * The tactics and default line-up a club opens the world with: its shape, the
 * eleven slot by slot with their roles, the set-piece takers, and the phase
 * settings — the same choices as the game's Tactics screen.
 */
export function TeamTacticsEditor({
  tactics,
  clubPlayers,
  playStyle,
  onChange,
  onError,
}: TeamTacticsEditorProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const [loadingPhase, setLoadingPhase] = useState(false);
  const current = tactics ?? {};
  const formation = current.formation ?? null;
  const update = (next: TeamTacticsDef) => onChange(compactTactics(next) ?? null);

  const abbreviation = (position: string) => translatePositionAbbreviation(t, position);
  const players = [...clubPlayers].sort(
    (a, b) =>
      abbreviation(a.position).localeCompare(abbreviation(b.position)) ||
      playerLabel(a).localeCompare(playerLabel(b)),
  );
  // A player named here who has since left the club still shows, flagged, so
  // the author sees what validation will report rather than an empty slot.
  const clubIds = new Set(players.map((player) => player.id));
  const strangers = [
    ...(current.startingXi ?? []),
    ...Object.values(current.matchRoles ?? {}),
  ].filter((id): id is string => Boolean(id) && !clubIds.has(id as string));
  const playerOptions = ["", ...players.map((player) => player.id), ...new Set(strangers)];
  const playerOptionLabels: Record<string, string> = {
    "": t("worldEditor.tactics.nobody"),
    ...Object.fromEntries(
      players.map((player) => [
        player.id,
        `${abbreviation(player.position)} · ${playerLabel(player)}`,
      ]),
    ),
    ...Object.fromEntries(
      strangers.map((id) => [id, t("worldEditor.tactics.notInClub", { player: id })]),
    ),
  };

  const toggleCustomPhase = async (on: boolean) => {
    if (!on) {
      const { phase: _phase, ...rest } = current;
      update(rest);
      return;
    }
    setLoadingPhase(true);
    try {
      update({ ...current, phase: await fetchTacticsBlueprint(playStyle) });
    } catch (err) {
      onError(err);
    } finally {
      setLoadingPhase(false);
    }
  };

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-navy-600 dark:bg-navy-800"
    >
      <div className="flex flex-col gap-1">
        <h3
          id={headingId}
          className="font-heading text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-white"
        >
          {t("worldEditor.tactics.title")}
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">{t("worldEditor.tactics.intro")}</p>
      </div>

      <LabeledSelect
        label={t("tactics.formation")}
        value={formation ?? ""}
        options={["", ...FORMATIONS]}
        optionLabels={{ "": t("worldEditor.tactics.formationAuto") }}
        onChange={(value) => update(withFormation(current, value || null))}
      />

      {formation ? (
        <StartingElevenPitch
          formation={formation}
          tactics={current}
          playerOptions={playerOptions}
          playerOptionLabels={playerOptionLabels}
          hasPlayers={players.length > 0}
          onChange={update}
        />
      ) : (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t("worldEditor.tactics.needFormation")}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <span className={labelClass}>{t("worldEditor.tactics.matchRoles")}</span>
        <div className="grid grid-cols-2 gap-3">
          {MATCH_ROLE_KEYS.map((role) => (
            <LabeledSelect
              key={role}
              label={t(MATCH_ROLE_LABEL_KEYS[role])}
              value={current.matchRoles?.[role] ?? ""}
              options={playerOptions}
              optionLabels={playerOptionLabels}
              onChange={(value) => update(withMatchRole(current, role, value || null))}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <Checkbox
            checked={Boolean(current.phase)}
            disabled={loadingPhase}
            onChange={(event) => {
              void toggleCustomPhase(event.target.checked);
            }}
          />
          {t("worldEditor.tactics.customPhase")}
          {loadingPhase && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
        </label>
        {current.phase ? (
          <div className="rounded-lg border border-gray-100 dark:border-navy-700">
            <PhaseBlueprintPanel
              tacticsPhase={current.phase}
              onTacticsPhaseChange={(patch: Partial<TacticsPhaseSettings>) => {
                if (current.phase) update({ ...current, phase: { ...current.phase, ...patch } });
              }}
            />
          </div>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("worldEditor.tactics.phaseFromStyle")}
          </p>
        )}
      </div>
    </section>
  );
}

function StartingElevenPitch({
  formation,
  tactics,
  playerOptions,
  playerOptionLabels,
  hasPlayers,
  onChange,
}: {
  formation: string;
  tactics: TeamTacticsDef;
  playerOptions: string[];
  playerOptionLabels: Record<string, string>;
  hasPlayers: boolean;
  onChange: (tactics: TeamTacticsDef) => void;
}) {
  const { t } = useTranslation();
  const total = slotPositions(formation).length;
  const filled = filledStarters(tactics);
  // Slot indices run keeper first; the pitch is drawn attack at the top.
  let slot = 0;
  const rows = buildPitchRows(formation).map((row) => ({
    label: row.label,
    slots: row.positions.map((position) => ({ position, index: slot++ })),
  }));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className={labelClass}>{t("worldEditor.tactics.startingXi")}</span>
        <span className="text-xs text-gray-500 dark:text-gray-400" aria-live="polite">
          {t("worldEditor.tactics.elevenProgress", { count: filled, total })}
        </span>
      </div>
      {!hasPlayers && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t("worldEditor.tactics.noPlayers")}
        </p>
      )}
      {hasPlayers && filled > 0 && filled < total && (
        <p className="text-xs text-accent-700 dark:text-accent-400">
          {t("worldEditor.tactics.elevenIncomplete")}
        </p>
      )}
      <div className="flex flex-col gap-2 rounded-lg bg-primary-50 p-3 dark:bg-primary-500/10">
        {[...rows].reverse().map((row) => (
          <div key={row.label} className="flex justify-center gap-2">
            {row.slots.map(({ position, index }) => (
              <SlotPicker
                key={index}
                position={position}
                playerId={tactics.startingXi?.[index] ?? ""}
                role={tactics.playerRoles?.[tactics.startingXi?.[index] ?? ""]}
                playerOptions={playerOptions}
                playerOptionLabels={playerOptionLabels}
                onPlayer={(playerId) => onChange(withStarter(tactics, index, playerId))}
                onRole={(playerId, role) => onChange(withRole(tactics, playerId, role))}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function SlotPicker({
  position,
  playerId,
  role,
  playerOptions,
  playerOptionLabels,
  onPlayer,
  onRole,
}: {
  position: string;
  playerId: string;
  role: PlayerRole | undefined;
  playerOptions: string[];
  playerOptionLabels: Record<string, string>;
  onPlayer: (playerId: string) => void;
  onRole: (playerId: string, role: PlayerRole) => void;
}) {
  const { t } = useTranslation();
  const abbreviation = translatePositionAbbreviation(t, position);
  const currentRole = role ?? "Standard";
  return (
    <div className="flex w-36 min-w-0 flex-col gap-1 rounded-lg border border-gray-200 bg-white p-1.5 dark:border-navy-600 dark:bg-navy-800">
      <span className="text-center font-heading text-[11px] font-bold uppercase tracking-wider text-primary-600 dark:text-primary-400">
        {abbreviation}
      </span>
      <Select
        selectSize="sm"
        fullWidth
        value={playerId}
        aria-label={t("worldEditor.tactics.slotPlayer", { position: abbreviation })}
        onChange={(event) => onPlayer(event.target.value)}
      >
        {playerOptions.map((id) => (
          <option key={id} value={id}>
            {playerOptionLabels[id] ?? id}
          </option>
        ))}
      </Select>
      {playerId && (
        <Select
          selectSize="sm"
          variant="subtle"
          fullWidth
          value={currentRole}
          aria-label={t("worldEditor.tactics.slotRole", { position: abbreviation })}
          onChange={(event) => onRole(playerId, event.target.value as PlayerRole)}
        >
          {getRoleOptions(position, currentRole).map((option) => (
            <option key={option} value={option}>
              {t(`tactics.playerRoles.${option}`, option)}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}
