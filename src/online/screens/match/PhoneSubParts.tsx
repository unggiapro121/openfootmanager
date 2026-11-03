import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeftRight,
  ArrowRight,
  Check,
  ChevronDown,
  Cross,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import type { FormationSlot } from "../../../components/match/FormationPitch";
import {
  getMatchScenario,
  type RecommendedSubstitution,
} from "../../../components/match/SubPanel.helpers";
import type { RadarRoster } from "../../../components/match/radar/radarMatch";
import { ratingAt } from "../../../components/match/slotRatings";
import type { EnginePlayerData, MatchSnapshot } from "../../../components/match/types";
import { translatePositionAbbreviation } from "../../../components/squad/SquadTab.helpers";
import { PitchSurface, PlayerAvatar } from "../../../components/ui";
import { condBgColor, condColor } from "../../../lib/playerConditionDisplay";
import { getRoleOptions } from "../../../lib/playerRoles";
import { getPositionColor } from "../../../lib/positionColors";
import type { PlayerRole, PositionFit } from "../../../store/types";
import type { LicenceControls } from "../../api/rules";
import type { Side } from "../../api/engine";
import { openInMatch } from "../../convert/licence";
import { withCurrent } from "./matchOptions";
import { benchForSlot, type PlayerChange, type SlotCandidate } from "./phoneSubs";

const KEY = "online.match.phoneSubs";
const FOCUS =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-navy-800";
const SECTION_TITLE =
  "font-heading text-sm font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400";

type Changes = ReadonlyMap<string, string>;

/** A player's face, or his initials, as the roster has him. */
function Face({
  player,
  roster,
  className,
}: {
  player: EnginePlayerData;
  roster: RadarRoster;
  className: string;
}) {
  const full = roster.get(player.id);
  return (
    <PlayerAvatar
      player={full ?? { full_name: player.name, match_name: player.name }}
      className={`flex items-center justify-center overflow-hidden rounded-full bg-gray-200 font-heading text-sm font-bold text-gray-700 dark:bg-navy-700 dark:text-white ${className}`}
    />
  );
}

/** The avatar's edge on the pitch: what tapping the player would do now. */
function tokenEdge(state: {
  swapSource: boolean;
  picked: boolean;
  replaced: boolean;
  target: boolean;
  tired: boolean;
}): string {
  if (state.swapSource) return "border-solid border-sky-400";
  if (state.picked) return "border-solid border-red-400 motion-safe:animate-claim-pulse";
  if (state.replaced) return "border-dashed border-primary-400";
  if (state.target) return "border-dashed border-accent-400";
  if (state.tired) return "border-solid border-red-400/70";
  return "border-solid border-white/40";
}

/** Where the phone pitch's first and last rows of players stand, in % of its height. */
const ROW_TOP = 10;
const ROW_BOTTOM = 89;

/**
 * The eleven on the pitch as tokens to tap: the slot, the rating there, a booking or a knock, the
 * condition, and who is coming on for him once a change is queued or sent.
 */
export function PhonePitch({
  slots,
  roster,
  sentOff,
  booked,
  injured,
  replacing,
  picked,
  swapping,
  targetFromBench,
  nameOf,
  onTap,
}: {
  slots: FormationSlot[];
  roster: RadarRoster;
  sentOff: readonly string[];
  booked: readonly string[];
  injured: readonly string[];
  replacing: Changes;
  picked: string | null;
  swapping: boolean;
  /** A bench player is picked: the players free to come off show as targets. */
  targetFromBench: boolean;
  nameOf: (id: string) => string;
  onTap: (id: string) => void;
}) {
  const { t } = useTranslation();
  // The shape's own rows bunch up the midfield, which a phone's tokens (name and condition under
  // the face) cannot share: the rows are spread evenly down the pitch instead, in the same order.
  const rows = [...new Set(slots.map((slot) => slot.y))].sort((a, b) => a - b);
  const rowY = (y: number) =>
    rows.length < 2 ? y : ROW_TOP + (rows.indexOf(y) * (ROW_BOTTOM - ROW_TOP)) / (rows.length - 1);
  return (
    <PitchSurface className="w-full">
      <section aria-label={t(`${KEY}.pitch`)} className="relative aspect-[5/6] w-full">
        {slots.map(({ player, x, y: shapeY, slotPosition }) => {
          const y = rowY(shapeY);
          const slot = slotPosition ?? player.position;
          const slotLabel = translatePositionAbbreviation(t, slot);
          const ovr = ratingAt(player, slot)?.ovr ?? player.ovr;
          const condition = Math.round(player.condition);
          const incoming = replacing.get(player.id);
          const isSentOff = sentOff.includes(player.id);
          const isPicked = picked === player.id;
          const label = isSentOff
            ? t(`${KEY}.tokenSentOff`, { name: player.name, slot: slotLabel })
            : incoming
              ? t(`${KEY}.tokenReplaced`, {
                  name: player.name,
                  slot: slotLabel,
                  ovr,
                  condition,
                  on: nameOf(incoming),
                })
              : t(`${KEY}.token`, { name: player.name, slot: slotLabel, ovr, condition });
          return (
            <button
              key={player.id}
              type="button"
              aria-label={label}
              aria-pressed={isPicked}
              // A sent-off player's slot can still take a player swapped into it.
              disabled={isSentOff && !swapping}
              onClick={() => onTap(player.id)}
              style={{ left: `${x}%`, top: `${y}%` }}
              className={`absolute flex w-[4.75rem] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-[3px] rounded-xl ${isPicked ? "z-20" : "z-10"} ${FOCUS}`}
            >
              <span
                className={`relative ${isSentOff ? "opacity-40 grayscale" : incoming ? "opacity-75" : ""}`}
              >
                <Face
                  player={player}
                  roster={roster}
                  className={`h-11 w-11 border-[2.5px] ${tokenEdge({
                    swapSource: isPicked && swapping,
                    picked: isPicked && !swapping,
                    replaced: incoming !== undefined,
                    target: targetFromBench && !incoming && !isSentOff,
                    tired: condition < 45,
                  })}`}
                />
                <span
                  className={`absolute -left-2.5 -top-1.5 rounded px-1 font-heading text-[10px] font-bold leading-[15px] text-white ${getPositionColor(slot)}`}
                >
                  {slotLabel}
                </span>
                <span className="absolute -bottom-1 -right-2.5 flex h-[18px] min-w-[22px] items-center justify-center rounded-full border border-navy-700 bg-navy-900 px-0.5 text-[11px] font-bold text-white">
                  {ovr}
                </span>
                {booked.includes(player.id) && (
                  <span
                    title={t("match.eventTypes.YellowCard")}
                    className="absolute -right-1 -top-1 h-3 w-[9px] rounded-[2px] bg-yellow-400 ring-[1.5px] ring-navy-900"
                  />
                )}
                {injured.includes(player.id) && (
                  <Cross
                    className="absolute -left-1 bottom-0 h-3.5 w-3.5 rounded-full bg-white text-red-600"
                    aria-hidden="true"
                  />
                )}
                {isSentOff && (
                  <span className="absolute left-1/2 top-2 h-5 w-3.5 -translate-x-1/2 rounded-sm bg-red-600 ring-1 ring-white/60" />
                )}
              </span>
              <span
                className={`max-w-full truncate rounded px-1.5 py-px text-[11px] font-bold ${
                  incoming ? "bg-primary-400 text-navy-900" : "bg-navy-900/80 text-white"
                }`}
              >
                {incoming ? `↑ ${nameOf(incoming)}` : player.name}
              </span>
              <span
                className="h-1 w-10 overflow-hidden rounded-full bg-navy-900/70"
                aria-hidden="true"
              >
                <span
                  className={`block h-full ${condBgColor(condition)}`}
                  style={{ width: `${condition}%` }}
                />
              </span>
            </button>
          );
        })}
      </section>
    </PitchSurface>
  );
}

/**
 * The suggested changes for how the match stands (the game's own recommendations, as on the
 * desktop panel), folded under its scenario: each added on its own or all at once. Nothing when
 * the game has none to suggest.
 */
export function PlanCard({
  snapshot,
  side,
  recommendations,
  queue,
  left,
  replacing,
  comingOn,
  nameOf,
  onAdd,
  onAddAll,
}: {
  snapshot: MatchSnapshot;
  side: Side;
  recommendations: RecommendedSubstitution[];
  queue: readonly PlayerChange[];
  left: number;
  replacing: Changes;
  comingOn: Changes;
  nameOf: (id: string) => string;
  onAdd: (change: PlayerChange) => void;
  onAddAll: (changes: PlayerChange[]) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (recommendations.length === 0) return null;
  const scenario = getMatchScenario(snapshot, side);
  const isQueued = (rec: RecommendedSubstitution) =>
    queue.some((change) => change.offId === rec.offId && change.onId === rec.onId);
  const waiting = recommendations.filter((rec) => !isQueued(rec));
  const addAll = () => {
    const taken = new Set([...replacing.keys(), ...comingOn.keys()]);
    const more: PlayerChange[] = [];
    for (const rec of waiting) {
      if (more.length >= left || taken.has(rec.offId) || taken.has(rec.onId)) continue;
      more.push({ offId: rec.offId, onId: rec.onId });
      taken.add(rec.offId).add(rec.onId);
    }
    onAddAll(more);
  };
  return (
    <section className="overflow-hidden rounded-xl border border-primary-300 bg-primary-50 dark:border-primary-800 dark:bg-primary-900/20">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={`flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left ${FOCUS}`}
      >
        <Sparkles
          className="h-4.5 w-4.5 shrink-0 text-primary-600 dark:text-primary-400"
          aria-hidden="true"
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-bold text-primary-800 dark:text-primary-300">
            {t(`${KEY}.planTitle`, { scenario: t(`match.subScenario.${scenario.id}.title`) })}
          </span>
          <span className="text-[11px] text-gray-600 dark:text-gray-400">
            {t(`${KEY}.planSub`, {
              style: t(`common.playStyles.${scenario.recommendedPlayStyle}`),
              count: waiting.length,
            })}
          </span>
        </span>
        <ChevronDown
          className={`h-4.5 w-4.5 shrink-0 text-gray-500 transition-transform dark:text-gray-400 ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-3 pb-3">
          <ul className="flex flex-col gap-1.5">
            {recommendations.map((rec) => {
              const done = isQueued(rec);
              const names = { off: nameOf(rec.offId), on: nameOf(rec.onId) };
              return (
                <li
                  key={`${rec.offId}-${rec.onId}`}
                  className="flex items-center gap-2 rounded-lg bg-white/70 px-2 py-1.5 text-sm dark:bg-navy-900/55"
                >
                  <ChangeNames off={names.off} on={names.on} />
                  <span className="whitespace-nowrap text-[11px] text-gray-500 dark:text-gray-400">
                    {t(`match.subRecommendationReasons.${rec.reasons[0]}`)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onAdd({ offId: rec.offId, onId: rec.onId })}
                    disabled={done}
                    aria-label={t(done ? `${KEY}.planAdded` : `${KEY}.planAdd`, names)}
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary-500 text-primary-700 disabled:border-primary-300 disabled:opacity-70 dark:text-primary-300 dark:disabled:border-primary-800 ${FOCUS}`}
                  >
                    {done ? (
                      <Check className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Plus className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={addAll}
            disabled={waiting.length === 0}
            className={`h-10 rounded-lg bg-primary-700 font-heading text-[15px] font-bold uppercase tracking-wider text-white disabled:bg-gray-200 disabled:text-gray-500 dark:disabled:bg-navy-700 dark:disabled:text-gray-400 ${FOCUS}`}
          >
            {waiting.length === 0
              ? t(`${KEY}.planAllAdded`)
              : t(`${KEY}.planApply`, { count: waiting.length })}
          </button>
        </div>
      )}
    </section>
  );
}

/** "Off → on", the one going off in red and the one coming on in green. */
function ChangeNames({ off, on }: { off: string; on: string }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap">
      <span className="truncate font-semibold text-red-600 dark:text-red-400">{off}</span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
      <span className="truncate font-semibold text-primary-700 dark:text-primary-400">{on}</span>
    </span>
  );
}

/** The changes waiting for the coach to confirm them, each one to take back. */
export function QueuedChanges({
  queue,
  nameOf,
  onRemove,
}: {
  queue: readonly PlayerChange[];
  nameOf: (id: string) => string;
  onRemove: (change: PlayerChange) => void;
}) {
  const { t } = useTranslation();
  const title = t(`${KEY}.queuedTitle`, { count: queue.length });
  return (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <span className={SECTION_TITLE}>{title}</span>
      <ul className="flex flex-wrap gap-1.5">
        {queue.map((change) => {
          const names = { off: nameOf(change.offId), on: nameOf(change.onId) };
          return (
            <li
              key={`${change.offId}-${change.onId}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-gray-200 bg-white pl-2.5 pr-1 text-sm dark:border-navy-700 dark:bg-navy-800"
            >
              <span className="font-semibold text-red-600 dark:text-red-400">{names.off}</span>
              <ArrowRight className="h-3 w-3 text-gray-400" aria-hidden="true" />
              <span className="font-semibold text-primary-700 dark:text-primary-400">
                {names.on}
              </span>
              <button
                type="button"
                onClick={() => onRemove(change)}
                aria-label={t(`${KEY}.queuedRemove`, names)}
                className={`flex h-7 w-7 items-center justify-center rounded-full bg-gray-200 text-gray-700 dark:bg-navy-700 dark:text-white ${FOCUS}`}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const FIT_KEY: Record<PositionFit, string> = {
  Natural: "fitNatural",
  Adapted: "fitAdapted",
  Unfamiliar: "fitUnfamiliar",
};
const FIT_TONE: Record<PositionFit, string> = {
  Natural: "text-primary-700 dark:text-primary-400",
  Adapted: "text-accent-700 dark:text-accent-400",
  Unfamiliar: "text-red-600 dark:text-red-400",
};

/** One bench player as a row to tap: his face, name and position, rating and condition. */
function BenchRow({
  candidate,
  roster,
  picked,
  disabled,
  comingOnFor,
  nameOf,
  onTap,
}: {
  candidate: SlotCandidate;
  roster: RadarRoster;
  picked: boolean;
  disabled: boolean;
  /** The player he is already set to replace. */
  comingOnFor: string | undefined;
  nameOf: (id: string) => string;
  onTap: () => void;
}) {
  const { t } = useTranslation();
  const { player, fit, ovr } = candidate;
  const condition = Math.round(player.condition);
  const position =
    player.position_ratings?.find((rating) => rating.fit === "Natural")?.position ??
    player.position;
  const positionLabel = translatePositionAbbreviation(t, position);
  const noteId = useId();
  return (
    <li className="border-t border-gray-200 dark:border-navy-700">
      <button
        type="button"
        onClick={onTap}
        aria-label={t(`${KEY}.benchRow`, {
          name: player.name,
          position: positionLabel,
          ovr,
          condition,
        })}
        aria-describedby={comingOnFor || fit ? noteId : undefined}
        aria-pressed={picked}
        disabled={disabled}
        className={`grid min-h-14 w-full grid-cols-[2.25rem_minmax(0,1fr)_1.875rem_4rem] items-center gap-2.5 px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-45 ${
          picked ? "bg-primary-100 dark:bg-primary-900/35" : ""
        } ${FOCUS}`}
      >
        <Face
          player={player}
          roster={roster}
          className={`h-9 w-9 border-2 ${picked ? "border-primary-500" : "border-gray-200 dark:border-navy-700"}`}
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">
              {player.name}
            </span>
            <span
              className={`shrink-0 rounded px-1 text-[10px] font-bold leading-[15px] text-white ${getPositionColor(position)}`}
            >
              {positionLabel}
            </span>
          </span>
          {comingOnFor ? (
            <span id={noteId} className="text-[11px] text-gray-500 dark:text-gray-400">
              {t(`${KEY}.comesOnFor`, { name: nameOf(comingOnFor) })}
            </span>
          ) : (
            fit && (
              <span id={noteId} className={`text-[11px] font-semibold ${FIT_TONE[fit]}`}>
                {t(`${KEY}.${FIT_KEY[fit]}`)}
              </span>
            )
          )}
        </span>
        <span className="text-right font-heading text-lg font-bold tabular-nums text-gray-900 dark:text-white">
          {ovr}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="h-[5px] flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-navy-700"
            aria-hidden="true"
          >
            <span
              className={`block h-full ${condBgColor(condition)}`}
              style={{ width: `${condition}%` }}
            />
          </span>
          <span
            className={`w-[22px] text-right text-xs font-bold tabular-nums ${condColor(condition)}`}
          >
            {condition}
          </span>
        </span>
      </button>
    </li>
  );
}

/** The bench, to pick a player to bring on before the one to take off. */
export function BenchList({
  bench,
  roster,
  comingOn,
  picked,
  left,
  nameOf,
  onTap,
}: {
  bench: readonly EnginePlayerData[];
  roster: RadarRoster;
  comingOn: Changes;
  picked: string | null;
  left: number;
  nameOf: (id: string) => string;
  onTap: (id: string) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-navy-700 dark:bg-navy-800"
    >
      <div className="flex items-baseline justify-between gap-2 px-3 pb-2 pt-3">
        <h3
          id={titleId}
          className="font-heading text-base font-bold uppercase tracking-wider text-primary-700 dark:text-primary-400"
        >
          {t(`${KEY}.bench`, { count: bench.length })}
        </h3>
        <span className="text-[11px] text-gray-500 dark:text-gray-400">{t(`${KEY}.benchSub`)}</span>
      </div>
      {bench.length === 0 ? (
        <p className="px-3 pb-3 text-sm text-gray-500 dark:text-gray-400">
          {t("match.noBenchAvailable")}
        </p>
      ) : (
        <ul>
          {bench.map((player) => {
            const comingOnFor = comingOn.get(player.id);
            return (
              <BenchRow
                key={player.id}
                candidate={{ player, fit: null, ovr: player.ovr }}
                roster={roster}
                picked={picked === player.id}
                disabled={comingOnFor !== undefined || (left <= 0 && picked !== player.id)}
                comingOnFor={comingOnFor}
                nameOf={nameOf}
                onTap={() => onTap(player.id)}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * One player of the eleven, risen from the bottom: swap his place, change his role, or pick who
 * comes on for him, the bench ordered by how well each fits his slot.
 */
export function PlayerSheet({
  player,
  slot,
  booked,
  replacedBy,
  bench,
  roster,
  comingOn,
  left,
  licence,
  nameOf,
  onPick,
  onSwap,
  onRole,
  onClose,
}: {
  player: EnginePlayerData;
  slot: string;
  booked: boolean;
  replacedBy: string | undefined;
  bench: readonly EnginePlayerData[];
  roster: RadarRoster;
  comingOn: Changes;
  left: number;
  licence: LicenceControls | undefined;
  nameOf: (id: string) => string;
  onPick: (onId: string) => void;
  onSwap: () => void;
  onRole: (role: PlayerRole) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    sheet.current?.focus();
  }, [player.id]);
  const role = player.role || "Standard";
  const roles = withCurrent(openInMatch(licence, "role", getRoleOptions(slot, role)), role);
  const condition = Math.round(player.condition);
  const slotLabel = translatePositionAbbreviation(t, slot);
  const ovr = ratingAt(player, slot)?.ovr ?? player.ovr;
  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className="absolute inset-0 bg-navy-900/60"
        onClick={onClose}
      />
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        className="relative flex max-h-[78vh] flex-col rounded-t-2xl border-t border-gray-200 bg-white pb-[var(--safe-bottom)] shadow-2xl focus:outline-none motion-safe:animate-sheet-up dark:border-navy-600 dark:bg-navy-800"
      >
        <span
          className="mx-auto mb-1 mt-2 block h-1 w-10 shrink-0 rounded-full bg-gray-300 dark:bg-navy-600"
          aria-hidden="true"
        />
        <div className="flex shrink-0 flex-col gap-2.5 border-b border-gray-200 px-4 pb-3 pt-1.5 dark:border-navy-700">
          <div className="flex items-center gap-2.5">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="font-heading text-xl font-bold uppercase tracking-wider text-gray-900 dark:text-white">
                <span id={titleId}>{player.name}</span>{" "}
                <span className="font-sans text-[13px] font-medium normal-case tracking-normal text-gray-500 dark:text-gray-400">
                  {slotLabel} · OVR {ovr}
                </span>
              </span>
              <span className={`text-xs ${condColor(condition)}`}>
                {t(`${KEY}.sheetCondition`, { condition })}
                {booked && ` · ${t(`${KEY}.sheetBooked`)}`}
              </span>
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.close")}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-700 dark:bg-navy-700 dark:text-white ${FOCUS}`}
            >
              <X className="h-4.5 w-4.5" aria-hidden="true" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onSwap}
              className={`flex h-11 items-center justify-center gap-1.5 rounded-lg border border-gray-300 text-[13px] font-semibold text-gray-700 dark:border-navy-600 dark:text-gray-200 ${FOCUS}`}
            >
              <ArrowLeftRight
                className="h-4 w-4 text-sky-600 dark:text-sky-400"
                aria-hidden="true"
              />
              {t(`${KEY}.swap`)}
            </button>
            <div className="relative">
              <select
                aria-label={t("tactics.playerRoleLabel")}
                value={role}
                onChange={(event) => onRole(event.target.value as PlayerRole)}
                className={`h-11 w-full appearance-none rounded-lg border border-gray-300 bg-white pl-2.5 pr-7 text-[13px] font-semibold text-gray-700 dark:border-navy-600 dark:bg-navy-900 dark:text-gray-200 ${FOCUS}`}
              >
                {roles.map((option) => (
                  <option key={option} value={option}>
                    {t(`tactics.playerRoles.${option}`)}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500 dark:text-gray-400"
                aria-hidden="true"
              />
            </div>
          </div>
          {replacedBy && (
            <p className="text-xs text-amber-700 dark:text-amber-300">{t(`${KEY}.sheetQueued`)}</p>
          )}
        </div>
        <div className="flex shrink-0 items-baseline justify-between gap-2 px-4 pb-1.5 pt-2.5">
          <span className="font-heading text-base font-bold uppercase tracking-wider text-primary-700 dark:text-primary-400">
            {t(`${KEY}.comesOnFor`, { name: player.name })}
          </span>
          <span className="text-[11px] text-gray-500 dark:text-gray-400">
            {t(`${KEY}.sheetBenchSub`)}
          </span>
        </div>
        <ul className="flex-1 overflow-y-auto">
          {benchForSlot(bench, slot).map((candidate) => {
            const comingOnFor = comingOn.get(candidate.player.id);
            return (
              <BenchRow
                key={candidate.player.id}
                candidate={candidate}
                roster={roster}
                picked={false}
                disabled={comingOnFor !== undefined || replacedBy !== undefined || left <= 0}
                comingOnFor={comingOnFor}
                nameOf={nameOf}
                onTap={() => onPick(candidate.player.id)}
              />
            );
          })}
        </ul>
      </div>
    </div>
  );
}
