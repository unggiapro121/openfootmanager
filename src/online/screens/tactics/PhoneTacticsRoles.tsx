import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, Sparkles } from "lucide-react";
import { getSetPieceStats } from "../../../components/match/SetPieceSelector";
import { translatePositionAbbreviation } from "../../../components/squad/SquadTab.helpers";
import type { TacticsPitchSlot } from "../../../components/tactics/TacticsTab.helpers";
import { getRoleOptions } from "../../../lib/playerRoles";
import {
  licenceLock,
  lockHint,
  type TacticsChoice,
  type TacticsLimits,
} from "../../../components/tactics/licenceLimits";
import { PHASE_SECTIONS } from "../../../components/tactics/PhaseBlueprintPanel";
import {
  EMPTY_MATCH_ROLES,
  resolveEffectiveMatchRoles,
} from "../../../components/tactics/TacticsRoles.helpers";
import type { TacticsRosterPlayer } from "../../../components/tactics/tacticsBoardSource";
import type { PlayerRole, TacticsPhaseSettings, TeamMatchRolesData } from "../../../store/types";
import { FOCUS, PhoneSheet } from "../mobile/PhoneSheet";
import { KEY } from "./PhoneTacticsLineup";

type RoleKey = keyof TeamMatchRolesData;

/** Each duty: its label, the badge it carries, and the score it is picked by. */
const ROLES: { key: RoleKey; label: string; badge: string; score: string }[] = [
  { key: "captain", label: "preMatch.captain", badge: "C", score: "captain" },
  { key: "vice_captain", label: "tactics.viceCaptain", badge: "VC", score: "vicecaptain" },
  { key: "penalty_taker", label: "preMatch.penaltyTaker", badge: "PK", score: "penalty" },
  { key: "free_kick_taker", label: "preMatch.freeKickTaker", badge: "FK", score: "freekick" },
  { key: "corner_taker", label: "preMatch.cornerTaker", badge: "CK", score: "corner" },
];

/** A keeper leads and wears the armband, but takes no set piece. */
function candidates(starters: TacticsRosterPlayer[], role: (typeof ROLES)[number]) {
  const open = role.key === "captain" || role.key === "vice_captain";
  return starters
    .filter((player) => open || player.position !== "Goalkeeper")
    .map((player) => ({ player, score: getSetPieceStats(role.score, player).score }))
    .sort((a, b) => b.score - a.score);
}

/**
 * The roles tab (design m-chien-thuat): the captain, his vice and the three set-piece takers, each
 * a row that opens a sheet of the starters ranked by what the duty needs, and a button that picks
 * them all by those scores.
 */
export function PhoneTacticsRoles({
  starters,
  roles,
  locked,
  onAssign,
  onRoles,
}: {
  starters: TacticsRosterPlayer[];
  roles: TeamMatchRolesData;
  locked: boolean;
  onAssign: (role: RoleKey, playerId: string) => void;
  onRoles: (roles: TeamMatchRolesData) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<(typeof ROLES)[number] | null>(null);
  const byId = new Map(starters.map((player) => [player.id, player]));
  return (
    <div className="flex flex-col gap-2">
      <ul className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-navy-700 dark:bg-navy-800">
        {ROLES.map((role) => {
          const player = roles[role.key] ? byId.get(roles[role.key] as string) : undefined;
          return (
            <li
              key={role.key}
              className="border-t border-gray-200 first:border-t-0 dark:border-navy-700"
            >
              <button
                type="button"
                aria-haspopup="dialog"
                disabled={locked}
                onClick={() => setOpen(role)}
                className={`flex min-h-[60px] w-full items-center gap-3 px-3 py-2 text-left disabled:opacity-60 ${FOCUS}`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] font-heading text-sm font-bold ${role.key === "captain" ? "bg-accent-100 text-accent-800 dark:bg-accent-900/50 dark:text-accent-300" : "bg-gray-100 text-gray-600 dark:bg-navy-700 dark:text-gray-300"}`}
                >
                  {role.badge}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {t(role.label)}
                  </span>
                  <span className="truncate text-[15px] font-semibold text-gray-900 dark:text-white">
                    {player ? player.full_name : t(`${KEY}.noneChosen`)}
                  </span>
                </span>
                {player && (
                  <span className="whitespace-nowrap text-[11px] text-gray-500 dark:text-gray-400">
                    {t(`${KEY}.score.${role.score}`, {
                      value: getSetPieceStats(role.score, player).score,
                    })}
                  </span>
                )}
                <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        disabled={locked || starters.length === 0}
        onClick={() => onRoles(resolveEffectiveMatchRoles(starters, EMPTY_MATCH_ROLES))}
        className={`inline-flex h-11 items-center justify-center gap-1.5 rounded-[10px] border border-primary-300 text-[13px] font-semibold text-primary-700 disabled:opacity-50 dark:border-primary-800 dark:text-primary-300 ${FOCUS}`}
      >
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        {t("tactics.autoSelectAssignments")}
      </button>
      <p className="text-xs text-gray-500 dark:text-gray-400">{t(`${KEY}.rolesNote`)}</p>
      {open && (
        <PhoneSheet
          title={t(open.label)}
          aside={t(`${KEY}.rankedBy.${open.score}`)}
          onClose={() => setOpen(null)}
        >
          <ul className="flex flex-col gap-1">
            {candidates(starters, open).map(({ player, score }) => {
              const on = roles[open.key] === player.id;
              return (
                <li key={player.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      onAssign(open.key, player.id);
                      setOpen(null);
                    }}
                    className={`grid min-h-[52px] w-full grid-cols-[36px_minmax(0,1fr)_44px_22px] items-center gap-2.5 rounded-[10px] border px-2.5 py-1.5 text-left ${on ? "border-primary-500 bg-primary-50 dark:bg-primary-900/35" : "border-transparent"} ${FOCUS}`}
                  >
                    <span className="rounded-md bg-gray-100 text-center font-heading text-xs font-bold text-gray-600 dark:bg-navy-700 dark:text-gray-300">
                      {translatePositionAbbreviation(t, player.natural_position || player.position)}
                    </span>
                    <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                      {player.full_name}
                    </span>
                    <span className="text-right font-bold tabular-nums text-accent-700 dark:text-accent-400">
                      {score}
                    </span>
                    {on ? (
                      <Check
                        className="h-4 w-4 text-primary-600 dark:text-primary-400"
                        aria-hidden="true"
                      />
                    ) : (
                      <span />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </PhoneSheet>
      )}
    </div>
  );
}

/**
 * Each starter's tactical role, as the desktop's token card sets it: a row per place of the shape,
 * opening a sheet of the roles that place allows (the backend checks a role against the deployed
 * slot, #272). A role the licence keeps closed shows what opens it.
 */
export function PhonePlayerRoles({
  slots,
  playerRoles,
  limits,
  locked,
  onRole,
}: {
  slots: TacticsPitchSlot[];
  playerRoles?: Partial<Record<string, PlayerRole>>;
  limits?: TacticsLimits;
  locked: boolean;
  onRole: (playerId: string, role: PlayerRole) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<TacticsPitchSlot | null>(null);
  const roleOf = (playerId: string): PlayerRole => playerRoles?.[playerId] ?? "Standard";
  const label = t("tactics.playerRoleLabel");
  return (
    <>
      <ul
        aria-label={label}
        className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-navy-700 dark:bg-navy-800"
      >
        {slots.map((slot) => {
          const player = slot.player;
          if (!player) return null;
          return (
            <li
              key={slot.index}
              className="border-t border-gray-200 first:border-t-0 dark:border-navy-700"
            >
              <button
                type="button"
                aria-haspopup="dialog"
                disabled={locked}
                onClick={() => setOpen(slot)}
                className={`grid min-h-12 w-full grid-cols-[40px_minmax(0,1fr)_auto_16px] items-center gap-2.5 px-3 py-1.5 text-left disabled:opacity-60 ${FOCUS}`}
              >
                <span className="rounded-md bg-gray-100 text-center font-heading text-xs font-bold text-gray-600 dark:bg-navy-700 dark:text-gray-300">
                  {translatePositionAbbreviation(t, slot.position)}
                </span>
                <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                  {player.full_name}
                </span>
                <span className="max-w-[45vw] truncate text-xs font-semibold text-primary-700 dark:text-primary-400">
                  {t(`tactics.playerRoles.${roleOf(player.id)}`)}
                </span>
                <ChevronRight className="h-4 w-4 text-gray-400" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      {open?.player && (
        <PhoneSheet
          title={open.player.full_name}
          kicker={label}
          aside={translatePositionAbbreviation(t, open.position)}
          onClose={() => setOpen(null)}
        >
          <div role="radiogroup" aria-label={label} className="flex flex-col gap-1">
            {getRoleOptions(open.position, roleOf(open.player.id)).map((option) => {
              const playerId = open.player?.id ?? "";
              const on = roleOf(playerId) === option;
              const lock = licenceLock(limits, { kind: "role", value: option });
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={lock !== null}
                  onClick={() => {
                    if (!on) onRole(playerId, option);
                    setOpen(null);
                  }}
                  className={`flex min-h-[52px] w-full items-center gap-2.5 rounded-[10px] border px-3 py-1.5 text-left disabled:opacity-60 ${on ? "border-primary-500 bg-primary-50 dark:bg-primary-900/35" : "border-transparent"} ${FOCUS}`}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">
                      {t(`tactics.playerRoles.${option}`)}
                    </span>
                    {lock && (
                      <span className="text-[11px] font-semibold text-accent-700 dark:text-accent-400">
                        {lockHint(t, lock)}
                      </span>
                    )}
                  </span>
                  {on && (
                    <Check
                      className="h-4 w-4 shrink-0 text-primary-600 dark:text-primary-400"
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </PhoneSheet>
      )}
    </>
  );
}

type PhaseKey = (typeof PHASE_SECTIONS)[number][0];

/**
 * The phase tab (design m-chien-thuat): the three phases as tabs, each dial of the open one as a
 * row of choices. A dial the licence keeps closed stays as it is and says what opens it.
 */
export function PhoneTacticsPhase({
  phase,
  limits,
  locked,
  onChange,
}: {
  phase?: TacticsPhaseSettings;
  limits?: TacticsLimits;
  locked: boolean;
  onChange: (patch: Partial<TacticsPhaseSettings>) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<PhaseKey>("withBall");
  const fields = PHASE_SECTIONS.find(([key]) => key === open)?.[1] ?? [];
  return (
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        aria-label={t("tactics.phaseBlueprint")}
        className="grid grid-cols-3 rounded-[10px] border border-gray-200 bg-gray-50 p-[3px] dark:border-navy-700 dark:bg-navy-900"
      >
        {PHASE_SECTIONS.map(([key]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={open === key}
            onClick={() => setOpen(key)}
            className={`h-[38px] rounded-lg px-1 text-xs font-semibold ${open === key ? "bg-white text-gray-900 shadow-sm dark:bg-navy-700 dark:text-white" : "text-gray-500 dark:text-gray-400"} ${FOCUS}`}
          >
            {t(`tactics.phaseLabels.${key}`)}
          </button>
        ))}
      </div>
      <ul className="flex flex-col gap-3.5">
        {fields.map(([field, labelKey, options]) => {
          const value = (phase?.[field] ?? options[0]) as string;
          const lock = licenceLock(limits, {
            kind: "dial",
            value: field as Extract<TacticsChoice, { kind: "dial" }>["value"],
          });
          const label = t(`tactics.phaseSettings.${labelKey}`);
          return (
            <li key={field} className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold text-gray-900 dark:text-white">{label}</span>
              <div
                role="radiogroup"
                aria-label={label}
                className="grid gap-1 rounded-[10px] border border-gray-200 bg-gray-50 p-[3px] dark:border-navy-700 dark:bg-navy-900"
                style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
              >
                {options.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={value === option}
                    disabled={locked || lock !== null}
                    onClick={() => onChange({ [field]: option })}
                    className={`min-h-[38px] rounded-lg px-1 text-[13px] font-semibold leading-tight disabled:opacity-60 ${value === option ? "bg-white text-gray-900 shadow-sm dark:bg-navy-700 dark:text-white" : "text-gray-500 dark:text-gray-400"} ${FOCUS}`}
                  >
                    {t(`tactics.phaseSettings.${labelKey}_${option}`)}
                  </button>
                ))}
              </div>
              {lock && (
                <span className="text-[11px] font-semibold text-accent-700 dark:text-accent-400">
                  {lockHint(t, lock)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
