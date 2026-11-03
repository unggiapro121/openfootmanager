import { useState } from "react";
import { useTranslation } from "react-i18next";
import { UserCheck } from "lucide-react";
import {
  applyLineupDrop,
  isPlayerExactForSlot,
  isPlayerOutOfPosition,
  translatePositionAbbreviation,
} from "../../../components/squad/SquadTab.helpers";
import type { TacticsRosterPlayer } from "../../../components/tactics/tacticsBoardSource";
import type { TacticsPitchSlot } from "../../../components/tactics/TacticsTab.helpers";
import type { useTacticsLineup } from "../../../components/tactics/useTacticsLineup";
import { fitToneOf, PitchSurface, PlayerAvatar } from "../../../components/ui";
import type { PitchFitTone } from "../../../components/ui/PitchToken";
import { ratingAtPosition } from "../../../lib/positionRatings";
import { getPositionColor } from "../../../lib/positionColors";
import type { MyClubView } from "../../api";
import { FOCUS } from "../mobile/PhoneSheet";

export const KEY = "online.tactics.phone";

type Lineup = ReturnType<typeof useTacticsLineup>;
type Fit = Exclude<PitchFitTone, "empty">;
type Group = "all" | "Goalkeeper" | "Defender" | "Midfielder" | "Forward";

const GROUPS: Group[] = ["all", "Goalkeeper", "Defender", "Midfielder", "Forward"];
/** The rows of a shape spread down a phone's pitch, top to bottom, in percent. */
const ROW_TOP = 12;
const ROW_BOTTOM = 85;
const FIT_RING: Record<Fit, string> = {
  exact: "border-primary-500",
  adapted: "border-accent-400",
  out: "border-red-500",
};
const FIT_TEXT: Record<Fit, string> = {
  exact: "text-primary-700 dark:text-primary-400",
  adapted: "text-accent-700 dark:text-accent-400",
  out: "text-red-600 dark:text-red-400",
};
const FIT_RANK: Record<Fit, number> = { exact: 0, adapted: 1, out: 2 };

/** How well `player` fits `position`: the server's rating first, the game's own rule without it. */
export function fitAt(
  player: TacticsRosterPlayer,
  position: string,
  ratings: Lineup["positionRatings"],
): Fit {
  const rating = ratingAtPosition(ratings[player.id], position);
  if (rating) return fitToneOf(rating.fit) as Fit;
  if (isPlayerExactForSlot(player, position)) return "exact";
  return isPlayerOutOfPosition(player, position) ? "out" : "adapted";
}

function conditionTone(condition: number): string {
  if (condition >= 80) return "bg-primary-500";
  if (condition >= 65) return "bg-accent-400";
  return "bg-red-500";
}

/**
 * The line-up tab (design m-chien-thuat): the XI assistant's switch, the fit legend, a line that
 * says what to tap, the pitch and the bench. A tap picks a player on the pitch; a second tap on
 * the pitch swaps the two, one on the bench brings him into the picked place. The assistant and a
 * locked line-up keep the eleven as it is.
 */
export function PhoneTacticsLineup({
  club,
  lineup,
  setStartingXi,
  setAssistant,
  locked,
}: {
  club: MyClubView;
  lineup: Lineup;
  setStartingXi: (playerIds: string[]) => Promise<void>;
  setAssistant: (on: boolean) => Promise<void>;
  locked: boolean;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<number | null>(null);
  const [nudge, setNudge] = useState<string | null>(null);
  const [group, setGroup] = useState<Group>("all");
  const assistant = club.xiAssistant ?? false;
  const canEdit = !locked && !assistant;
  const slots = lineup.pitchSlots;
  const ids = slots.reduce<string[]>((all, slot) => {
    all[slot.index] = slot.player?.id ?? "";
    return all;
  }, []);
  const pickedSlot = slots.find((slot) => slot.index === picked) ?? null;

  const save = (next: string[]) => {
    setPicked(null);
    void setStartingXi(next).catch(() => undefined);
  };
  const tapSlot = (index: number) => {
    setNudge(null);
    if (!canEdit) {
      setNudge(locked ? `${KEY}.hintLocked` : `${KEY}.hintAssistant`);
      return;
    }
    if (picked === null || picked === index) {
      setPicked(picked === index ? null : index);
      return;
    }
    save(applyLineupDrop(ids, { playerId: ids[picked], from: "xi", slotIndex: picked }, index));
  };
  const tapBench = (player: TacticsRosterPlayer) => {
    if (!canEdit) {
      setNudge(locked ? `${KEY}.hintLocked` : `${KEY}.hintAssistant`);
      return;
    }
    if (picked === null) {
      setNudge(`${KEY}.hintPickFirst`);
      return;
    }
    save(applyLineupDrop(ids, { playerId: player.id, from: "bench", slotIndex: null }, picked));
  };

  const hint =
    nudge ??
    (locked
      ? `${KEY}.hintLocked`
      : assistant
        ? `${KEY}.hintAssistant`
        : pickedSlot?.player
          ? `${KEY}.hintPicked`
          : `${KEY}.hintIdle`);

  return (
    <div className="flex flex-col gap-3">
      <AssistantSwitch club={club} locked={locked} setAssistant={setAssistant} />
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-gray-600 dark:text-gray-400">
        {(["exact", "adapted", "out"] as const).map((fit) => (
          <span key={fit} className="inline-flex items-center gap-1.5">
            <span
              className={`h-2.5 w-2.5 rounded-full border-2 ${FIT_RING[fit]}`}
              aria-hidden="true"
            />
            {t(`${KEY}.fit.${fit}`)}
          </span>
        ))}
        <span
          className={`ml-auto rounded-full px-2 py-px font-bold ${lineup.outOfPositionCount > 0 ? "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300" : "bg-primary-100 text-primary-800 dark:bg-primary-900/50 dark:text-primary-300"}`}
        >
          {t(`${KEY}.wrong`, { count: lineup.outOfPositionCount })}
        </span>
      </div>
      <p role="status" className="min-h-[18px] text-xs text-gray-600 dark:text-gray-300">
        {hint === `${KEY}.hintPicked` && pickedSlot?.player
          ? t(hint, {
              name: pickedSlot.player.full_name,
              slot: translatePositionAbbreviation(t, pickedSlot.position),
            })
          : t(hint)}
      </p>
      <Pitch
        slots={slots}
        lineup={lineup}
        formation={lineup.formation}
        picked={picked}
        captainId={lineup.effectiveMatchRoles.captain}
        onTap={tapSlot}
      />
      <Bench
        bench={lineup.bench}
        lineup={lineup}
        pickedSlot={pickedSlot}
        group={group}
        onGroup={setGroup}
        canEdit={canEdit}
        onTap={tapBench}
      />
    </div>
  );
}

/** The XI assistant's switch as the design's one row: what it does, on or off. */
function AssistantSwitch({
  club,
  locked,
  setAssistant,
}: {
  club: MyClubView;
  locked: boolean;
  setAssistant: (on: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const on = club.xiAssistant ?? false;
  const broken = !on && club.xiPick === "savedBroken";
  const turn = () => {
    setBusy(true);
    setAssistant(!on)
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-gray-200 bg-white px-3 py-2.5 dark:border-navy-700 dark:bg-navy-800">
      <UserCheck
        className="h-5 w-5 shrink-0 text-primary-600 dark:text-primary-400"
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-sm font-bold text-gray-900 dark:text-white">
          {t("online.tactics.xiAssistant.title")}
          {(on || broken) && (
            <span className="rounded bg-accent-100 px-1.5 text-[10px] font-bold uppercase text-accent-800 dark:bg-accent-900/40 dark:text-accent-300">
              {t("online.tactics.xiAssistant.expected")}
            </span>
          )}
        </span>
        <span className="text-[11px] leading-snug text-gray-500 dark:text-gray-400">
          {t(on ? "online.tactics.xiAssistant.onHint" : "online.tactics.xiAssistant.offHint")}
        </span>
        {broken && (
          <span className="text-[11px] text-accent-700 dark:text-accent-400">
            {t("online.tactics.xiAssistant.savedBroken")}
          </span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={t("online.tactics.xiAssistant.title")}
        disabled={locked || busy}
        onClick={turn}
        className={`flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 disabled:opacity-50 ${on ? "justify-end bg-primary-600 dark:bg-primary-500" : "justify-start bg-gray-300 dark:bg-navy-600"} ${FOCUS}`}
      >
        <span className="h-6 w-6 rounded-full bg-white shadow" aria-hidden="true" />
      </button>
    </div>
  );
}

function Pitch({
  slots,
  lineup,
  formation,
  picked,
  captainId,
  onTap,
}: {
  slots: TacticsPitchSlot[];
  lineup: Lineup;
  formation: string;
  picked: number | null;
  captainId: string | null;
  onTap: (index: number) => void;
}) {
  const { t } = useTranslation();
  // A shape's rows bunch up in midfield, which a token with its name and condition under it
  // cannot share on a phone: the rows are spread evenly down the pitch, in the same order.
  const rows = [...new Set(slots.map((slot) => slot.y))].sort((a, b) => a - b);
  const rowY = (y: number) =>
    rows.length < 2 ? y : ROW_TOP + (rows.indexOf(y) * (ROW_BOTTOM - ROW_TOP)) / (rows.length - 1);
  return (
    <PitchSurface className="w-full">
      <section aria-label={t(`${KEY}.pitch`, { formation })} className="relative h-[440px] w-full">
        {slots.map((slot) => {
          const player = slot.player;
          if (!player) return null;
          const fit = fitAt(player, slot.position, lineup.positionRatings);
          const slotLabel = translatePositionAbbreviation(t, slot.position);
          const ovr =
            ratingAtPosition(lineup.positionRatings[player.id], slot.position)?.ovr ?? player.ovr;
          const condition = Math.round(player.condition);
          const isPicked = picked === slot.index;
          return (
            <button
              key={slot.index}
              type="button"
              aria-pressed={isPicked}
              aria-label={t(`${KEY}.token`, {
                name: player.full_name,
                slot: slotLabel,
                ovr,
                fit: t(`${KEY}.fit.${fit}`),
                condition,
              })}
              onClick={() => onTap(slot.index)}
              style={{ left: `${slot.x}%`, top: `${rowY(slot.y)}%` }}
              className={`absolute flex w-20 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-[3px] rounded-xl transition-[left,top] motion-reduce:transition-none ${isPicked ? "z-20" : "z-10"} ${FOCUS}`}
            >
              <span className="relative">
                <PlayerAvatar
                  player={player}
                  className={`flex h-[46px] w-[46px] items-center justify-center overflow-hidden rounded-full border-[3px] bg-navy-800 font-heading text-[15px] font-bold text-white ${isPicked ? "border-white motion-safe:animate-pulse" : FIT_RING[fit]}`}
                />
                {captainId === player.id && (
                  <span
                    aria-hidden="true"
                    className="absolute -right-1.5 -top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-primary-700 bg-accent-500 text-[10px] font-extrabold text-navy-900"
                  >
                    C
                  </span>
                )}
              </span>
              <span className="inline-flex overflow-hidden rounded font-heading text-[11px] font-bold leading-[15px] text-white">
                <span className={`px-1 ${getPositionColor(slot.position)}`}>{slotLabel}</span>
                <span className="bg-navy-900 px-1">{ovr}</span>
              </span>
              <span className="max-w-20 truncate rounded bg-navy-900/70 px-1 font-heading text-xs font-bold uppercase tracking-wide text-white">
                {player.match_name || player.full_name}
              </span>
              <span
                className="h-1 w-10 overflow-hidden rounded-full bg-navy-900/70"
                aria-hidden="true"
              >
                <span
                  className={`block h-full ${conditionTone(condition)}`}
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

function Bench({
  bench,
  lineup,
  pickedSlot,
  group,
  onGroup,
  canEdit,
  onTap,
}: {
  bench: TacticsRosterPlayer[];
  lineup: Lineup;
  pickedSlot: TacticsPitchSlot | null;
  group: Group;
  onGroup: (group: Group) => void;
  canEdit: boolean;
  onTap: (player: TacticsRosterPlayer) => void;
}) {
  const { t } = useTranslation();
  const fitOf = (player: TacticsRosterPlayer): Fit | null =>
    pickedSlot ? fitAt(player, pickedSlot.position, lineup.positionRatings) : null;
  const shown = bench
    .filter((player) => group === "all" || player.position === group)
    .map((player) => ({ player, fit: fitOf(player) }))
    .sort((a, b) =>
      a.fit && b.fit
        ? FIT_RANK[a.fit] - FIT_RANK[b.fit] || (b.player.ovr ?? 0) - (a.player.ovr ?? 0)
        : 0,
    );
  return (
    <section
      aria-labelledby="phone-bench-title"
      className={`overflow-hidden rounded-xl border bg-white dark:bg-navy-800 ${pickedSlot ? "border-primary-500" : "border-gray-200 dark:border-navy-700"}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2.5 dark:border-navy-700">
        <h2
          id="phone-bench-title"
          className="font-heading text-[15px] font-bold uppercase tracking-wider text-gray-900 dark:text-white"
        >
          {pickedSlot
            ? t(`${KEY}.benchFor`, { slot: translatePositionAbbreviation(t, pickedSlot.position) })
            : t(`${KEY}.benchTitle`, { count: bench.length })}
        </h2>
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          {t(pickedSlot ? `${KEY}.fitFirst` : `${KEY}.benchSub`)}
        </span>
      </div>
      <div className="flex gap-1.5 overflow-x-auto px-3 pt-2">
        {GROUPS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={group === value}
            onClick={() => onGroup(value)}
            className={`h-[30px] shrink-0 rounded-full border px-2.5 text-xs font-semibold ${group === value ? "border-primary-500 bg-primary-50 text-gray-900 dark:bg-primary-900/40 dark:text-white" : "border-gray-200 text-gray-600 dark:border-navy-700 dark:text-gray-300"} ${FOCUS}`}
          >
            {t(value === "all" ? `${KEY}.all` : `online.market.group.${value}`)}
          </button>
        ))}
      </div>
      <ul aria-label={t(`${KEY}.bench`)} className="py-1.5">
        {shown.map(({ player, fit }) => {
          const position = translatePositionAbbreviation(
            t,
            player.natural_position || player.position,
          );
          const condition = Math.round(player.condition);
          const injured = player.injury != null;
          return (
            <li key={player.id}>
              <button
                type="button"
                disabled={injured}
                onClick={() => onTap(player)}
                aria-label={t(`${KEY}.benchRow`, {
                  name: player.full_name,
                  position,
                  ovr: player.ovr,
                  fit: fit ? t(`${KEY}.fit.${fit}`) : injured ? t(`${KEY}.injured`) : "",
                })}
                className={`grid min-h-12 w-full grid-cols-[36px_26px_minmax(0,1fr)_64px_30px] items-center gap-2 px-3 py-1.5 text-left disabled:opacity-50 ${canEdit ? "" : "opacity-60"} ${FOCUS}`}
              >
                <span className="rounded-md bg-gray-100 text-center font-heading text-xs font-bold text-gray-600 dark:bg-navy-700 dark:text-gray-300">
                  {position}
                </span>
                <span className="text-center text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
                  {player.jersey_number ?? ""}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                    {player.full_name}
                  </span>
                  {fit && (
                    <span className={`text-[11px] font-semibold ${FIT_TEXT[fit]}`}>
                      {t(`${KEY}.fit.${fit}`)}
                    </span>
                  )}
                  {injured && (
                    <span className="text-[11px] font-semibold text-red-600 dark:text-red-400">
                      {t(`${KEY}.injured`)}
                    </span>
                  )}
                </span>
                <span
                  className="h-[5px] overflow-hidden rounded-full bg-gray-200 dark:bg-navy-700"
                  aria-hidden="true"
                >
                  <span
                    className={`block h-full ${conditionTone(condition)}`}
                    style={{ width: `${condition}%` }}
                  />
                </span>
                <span className="flex h-[22px] min-w-7 items-center justify-center justify-self-end rounded-full bg-gray-100 px-1 font-heading text-[13px] font-bold text-gray-900 dark:bg-navy-900 dark:text-white">
                  {player.ovr}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
