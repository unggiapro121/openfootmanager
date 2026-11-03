import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, X } from "lucide-react";
import { layoutFormationSlots } from "../../../components/match/FormationPitch";
import { buildRecommendedSubstitutions } from "../../../components/match/SubPanel.helpers";
import type { RadarRoster } from "../../../components/match/radar/radarMatch";
import type { EnginePlayerData, MatchSnapshot } from "../../../components/match/types";
import type { PlayerRole } from "../../../store/types";
import type { LicenceControls } from "../../api/rules";
import type { MatchCommand, PlayStyle, Side } from "../../api/engine";
import { BenchList, PhonePitch, PlanCard, PlayerSheet, QueuedChanges } from "./PhoneSubParts";
import {
  type PlaceSwap,
  type PlayerChange,
  sideNow,
  suggestionsStillOpen,
  withSwaps,
} from "./phoneSubs";

const FOCUS =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-navy-800";

/** What the coach has picked: a player on the pitch (his sheet open) or one on the bench. */
type Picked = { on: "pitch"; id: string } | { on: "bench"; id: string } | null;

/** A note that rises over the footer for a moment: what was just done. */
interface Toast {
  text: string;
  tone: "done" | "warn";
}

const TOAST_MS = 2400;

export interface PhoneSubPanelProps {
  snapshot: MatchSnapshot;
  roster: RadarRoster;
  side: Side;
  /** Players with a yellow card this match. */
  booked: readonly string[];
  /** Substitutions sent and not yet decided by the match. */
  inFlight: readonly PlayerChange[];
  /** Swaps of places sent and not yet decided: the pitch shows them made. */
  swapsInFlight: readonly PlaceSwap[];
  /** The shapes, styles and roles the side may pick (its licence), the current ones among them. */
  formations: readonly string[];
  playStyles: readonly PlayStyle[];
  licence: LicenceControls | undefined;
  /** Sends an order; false when the match refused it (the panel above shows why). */
  send: (command: MatchCommand) => Promise<boolean>;
  /** A hurt player to have chosen already: his sheet opens. */
  initialOff?: string;
  onClose: () => void;
}

/**
 * The substitutions of a live online match on a phone (design m-thay-nguoi.html): the pitch with
 * the eleven, the bench, and a sheet per player. Changes of players wait in a queue until the
 * coach confirms them, then go to the match one by one; a swap of places, a role, the shape and
 * the style go at once. Each is decided in the match's next gap, as on the desktop panel.
 */
export function PhoneSubPanel(props: PhoneSubPanelProps) {
  const { snapshot, side, inFlight, send, onClose } = props;
  const { t } = useTranslation();
  const titleId = useId();
  const [picked, setPicked] = useState<Picked>(
    props.initialOff ? { on: "pitch", id: props.initialOff } : null,
  );
  const [swapping, setSwapping] = useState(false);
  const [queue, setQueue] = useState<PlayerChange[]>([]);
  const [sending, setSending] = useState(false);
  const { toast, flash } = useToast();

  const changes = [...inFlight, ...queue];
  const { team, bench, replacing, comingOn, left, byId } = sideNow(snapshot, side, changes);
  const nameOf = (id: string) => byId.get(id)?.name ?? "";
  const slots = layoutFormationSlots(
    team.formation,
    withSwaps(team.players, props.swapsInFlight),
    snapshot.sent_off,
  );
  const swapWaiting = new Set(props.swapsInFlight.flat());

  const clearPick = () => {
    setPicked(null);
    setSwapping(false);
  };
  const enqueue = (change: PlayerChange) => {
    if (left <= 0) {
      flash(t("match.allSubsUsed"), "warn");
      return;
    }
    if (replacing.has(change.offId) || comingOn.has(change.onId)) return;
    setQueue((current) => [...current, change]);
    clearPick();
  };

  /** Two of the eleven trade places: sent at once, it costs no substitution. */
  const swapPlaces = async (a: string, b: string) => {
    clearPick();
    const swapped = await send({ SwapPositions: { side, player_a_id: a, player_b_id: b } });
    if (swapped) flash(t("online.match.phoneSubs.swapped", { a: nameOf(a), b: nameOf(b) }));
  };
  const tapPitch = (id: string) => {
    if (swapping && picked?.on === "pitch" && picked.id !== id) void swapPlaces(picked.id, id);
    else if (picked?.on === "bench" && !replacing.has(id)) {
      enqueue({ offId: id, onId: picked.id });
    } else {
      setSwapping(false);
      setPicked(picked?.on === "pitch" && picked.id === id ? null : { on: "pitch", id });
    }
  };
  const tapBench = (id: string) => {
    if (picked?.on === "pitch" && !replacing.has(picked.id)) {
      enqueue({ offId: picked.id, onId: id });
    } else {
      setPicked(picked?.on === "bench" && picked.id === id ? null : { on: "bench", id });
    }
  };
  const changeRole = async (player: EnginePlayerData, role: PlayerRole) => {
    if (!(await send({ ChangePlayerRole: { side, player_id: player.id, role } }))) return;
    const roleName = t(`tactics.playerRoles.${role}`);
    flash(t("online.match.phoneSubs.roleSet", { name: player.name, role: roleName }));
  };

  /** Sends the queue in order, each change off the queue as it goes; stops at a refusal. */
  const confirm = async () => {
    const count = queue.length;
    setSending(true);
    for (const change of queue) {
      const order = {
        Substitute: { side, player_off_id: change.offId, player_on_id: change.onId },
      };
      if (!(await send(order))) {
        setSending(false);
        return;
      }
      setQueue((current) => current.filter((queued) => queued !== change));
    }
    setSending(false);
    clearPick();
    flash(t("online.match.phoneSubs.sent", { count, left }));
  };

  const sheetPlayer = picked?.on === "pitch" && !swapping ? byId.get(picked.id) : undefined;
  const recommendations = suggestionsStillOpen(
    buildRecommendedSubstitutions(snapshot, side),
    queue,
    changes,
    bench,
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-gray-50 text-gray-900 dark:bg-navy-900 dark:text-gray-100"
    >
      <PanelHeader
        titleId={titleId}
        snapshot={snapshot}
        side={side}
        queued={changes.length}
        team={team}
        formations={props.formations}
        playStyles={props.playStyles}
        onFormation={(formation) => void send({ ChangeFormation: { side, formation } })}
        onPlayStyle={(style) => void send({ ChangePlayStyle: { side, play_style: style } })}
        onClose={onClose}
      />
      <main className="flex flex-1 flex-col gap-3 px-4 pb-4 pt-3">
        <PlanCard
          snapshot={snapshot}
          side={side}
          recommendations={recommendations}
          queue={queue}
          left={left}
          nameOf={nameOf}
          onAdd={enqueue}
          onAddAll={(more) => {
            setQueue((current) => [...current, ...more]);
            clearPick();
          }}
          replacing={replacing}
          comingOn={comingOn}
        />
        <Hint
          picked={picked}
          swapping={swapping}
          replacing={replacing}
          left={left}
          injured={(snapshot.injured ?? []).filter(
            (id) => team.players.some((player) => player.id === id) && !replacing.has(id),
          )}
          nameOf={nameOf}
          onCancelSwap={clearPick}
        />
        <PhonePitch
          slots={slots}
          roster={props.roster}
          sentOff={snapshot.sent_off}
          booked={props.booked}
          injured={snapshot.injured ?? []}
          replacing={replacing}
          picked={picked?.on === "pitch" ? picked.id : null}
          swapping={swapping}
          targetFromBench={picked?.on === "bench"}
          swapWaiting={swapWaiting}
          nameOf={nameOf}
          onTap={tapPitch}
          onDragSwap={(a, b) => void swapPlaces(a, b)}
        />
        {queue.length > 0 && (
          <QueuedChanges
            queue={queue}
            nameOf={nameOf}
            onRemove={(change) =>
              setQueue((current) => current.filter((queued) => queued !== change))
            }
          />
        )}
        <BenchList
          bench={bench}
          roster={props.roster}
          comingOn={comingOn}
          picked={picked?.on === "bench" ? picked.id : null}
          left={left}
          nameOf={nameOf}
          onTap={tapBench}
        />
      </main>
      <PanelFooter
        queued={queue.length}
        sending={sending}
        onDrop={() => {
          setQueue([]);
          clearPick();
        }}
        onConfirm={() => void confirm()}
        onClose={onClose}
      />
      {sheetPlayer && (
        <PlayerSheet
          player={sheetPlayer}
          slot={
            slots.find((slot) => slot.player.id === sheetPlayer.id)?.slotPosition ??
            sheetPlayer.position
          }
          booked={props.booked.includes(sheetPlayer.id)}
          replacedBy={replacing.get(sheetPlayer.id)}
          bench={bench}
          roster={props.roster}
          comingOn={comingOn}
          left={left}
          licence={props.licence}
          nameOf={nameOf}
          onPick={(onId) => enqueue({ offId: sheetPlayer.id, onId })}
          onSwap={() => setSwapping(true)}
          onRole={(role) => void changeRole(sheetPlayer, role)}
          onClose={clearPick}
        />
      )}
      {toast && <ToastNote toast={toast} />}
    </div>
  );
}

/** A note shown for a moment; a newer one replaces it. */
function useToast() {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = (text: string, tone: Toast["tone"] = "done") => {
    clearTimeout(timer.current);
    setToast({ text, tone });
    timer.current = setTimeout(() => setToast(null), TOAST_MS);
  };
  return { toast, flash };
}

function ToastNote({ toast }: { toast: Toast }) {
  return (
    <p
      role="status"
      className={`fixed inset-x-4 bottom-[calc(5rem+var(--safe-bottom))] z-[65] rounded-xl border border-l-4 border-gray-200 bg-white px-3.5 py-3 text-sm text-gray-900 shadow-xl dark:border-navy-600 dark:bg-navy-800 dark:text-white ${
        toast.tone === "done" ? "border-l-primary-500" : "border-l-red-500"
      }`}
    >
      {toast.text}
    </p>
  );
}

/** Drop the queue, or confirm it; with nothing queued, the one button closes the screen. */
function PanelFooter({
  queued,
  sending,
  onDrop,
  onConfirm,
  onClose,
}: {
  queued: number;
  sending: boolean;
  onDrop: () => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <footer className="sticky bottom-0 z-30 flex gap-2.5 border-t border-gray-200 bg-white/95 px-4 pb-[calc(0.625rem+var(--safe-bottom))] pt-2.5 backdrop-blur dark:border-navy-700 dark:bg-navy-800/95">
      {queued > 0 && (
        <button
          type="button"
          onClick={onDrop}
          disabled={sending}
          className={`h-12 rounded-lg border border-gray-300 px-4 text-sm font-semibold text-gray-700 disabled:opacity-50 dark:border-navy-600 dark:text-gray-200 ${FOCUS}`}
        >
          {t("common.cancel")}
        </button>
      )}
      <button
        type="button"
        onClick={queued > 0 ? onConfirm : onClose}
        disabled={sending}
        className={`h-12 flex-1 rounded-lg bg-primary-700 font-heading text-lg font-bold uppercase tracking-wider text-white hover:bg-primary-600 disabled:opacity-50 ${FOCUS}`}
      >
        {queued > 0 ? t("online.match.phoneSubs.confirm", { count: queued }) : t("common.done")}
      </button>
    </footer>
  );
}

const SELECT =
  "h-11 w-full appearance-none rounded-lg border border-gray-300 bg-white pl-2.5 pr-7 pt-3.5 text-sm font-semibold text-gray-900 dark:border-navy-600 dark:bg-navy-900 dark:text-white";

/** The minute and the score, the substitutions used and queued, the shape and the style. */
function PanelHeader({
  titleId,
  snapshot,
  side,
  queued,
  team,
  formations,
  playStyles,
  onFormation,
  onPlayStyle,
  onClose,
}: {
  titleId: string;
  snapshot: MatchSnapshot;
  side: Side;
  queued: number;
  team: MatchSnapshot["home_team"];
  formations: readonly string[];
  playStyles: readonly PlayStyle[];
  onFormation: (formation: string) => void;
  onPlayStyle: (style: PlayStyle) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // The shape and style asked for, shown until the match has made them (its next gap).
  const [askedFormation, setAskedFormation] = useState<string | null>(null);
  const [askedStyle, setAskedStyle] = useState<string | null>(null);
  const max = snapshot.max_subs;
  const subsMade = side === "Home" ? snapshot.home_subs_made : snapshot.away_subs_made;
  return (
    <header className="sticky top-0 z-30 flex flex-col gap-2 border-b border-gray-200 bg-white/95 pb-2.5 pl-4 pr-2 pt-[calc(0.5rem+var(--safe-top))] backdrop-blur dark:border-navy-700 dark:bg-navy-800/95">
      <div className="flex items-center gap-2.5">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2
            id={titleId}
            className="font-heading text-[1.375rem] font-bold uppercase leading-tight tracking-wider text-gray-900 dark:text-white"
          >
            {t("match.substitutionsTitle")}
          </h2>
          <p className="truncate text-xs text-gray-600 dark:text-gray-400">
            <strong className="tabular-nums text-accent-700 dark:text-accent-400">
              {snapshot.current_minute}'
            </strong>{" "}
            · {snapshot.home_team.name}{" "}
            <strong className="text-gray-900 dark:text-white">
              {snapshot.home_score} – {snapshot.away_score}
            </strong>{" "}
            {snapshot.away_team.name}
          </p>
        </div>
        <span
          role="img"
          aria-label={t("online.match.phoneSubs.usedAria", { used: subsMade, max, queued })}
          className="flex flex-col items-end gap-1"
        >
          <span className="flex gap-0.5" aria-hidden="true">
            {Array.from({ length: max }, (_, index) => (
              <span
                key={index}
                className={`h-3 w-3 rounded-[3px] border-[1.5px] ${
                  index < subsMade
                    ? "border-primary-500 bg-primary-500"
                    : index < subsMade + queued
                      ? "border-primary-500 dark:border-primary-400"
                      : "border-gray-300 dark:border-navy-600"
                }`}
              />
            ))}
          </span>
          <span
            className="text-[11px] tabular-nums text-gray-600 dark:text-gray-400"
            aria-hidden="true"
          >
            {t("match.subsUsed", { used: subsMade, max })}
            {queued > 0 && ` · ${t("online.match.phoneSubs.queuedShort", { count: queued })}`}
          </span>
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-navy-700 ${FOCUS}`}
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 pr-2">
        <label className="relative block">
          <span className="pointer-events-none absolute left-2.5 top-1 text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {t("match.formation")}
          </span>
          <select
            className={`${SELECT} ${FOCUS}`}
            value={askedFormation ?? team.formation}
            onChange={(event) => {
              setAskedFormation(event.target.value);
              onFormation(event.target.value);
            }}
          >
            {formations.map((formation) => (
              <option key={formation} value={formation}>
                {formation}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500 dark:text-gray-400"
            aria-hidden="true"
          />
        </label>
        <label className="relative block">
          <span className="pointer-events-none absolute left-2.5 top-1 text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {t("match.playStyle")}
          </span>
          <select
            className={`${SELECT} ${FOCUS}`}
            value={askedStyle ?? team.play_style}
            onChange={(event) => {
              setAskedStyle(event.target.value);
              onPlayStyle(event.target.value as PlayStyle);
            }}
          >
            {playStyles.map((style) => (
              <option key={style} value={style}>
                {t(`common.playStyles.${style}`)}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500 dark:text-gray-400"
            aria-hidden="true"
          />
        </label>
      </div>
    </header>
  );
}

/** What to tap next, read from what is picked; a hurt player's call to be replaced first. */
function Hint({
  picked,
  swapping,
  replacing,
  left,
  injured,
  nameOf,
  onCancelSwap,
}: {
  picked: Picked;
  swapping: boolean;
  replacing: ReadonlyMap<string, string>;
  left: number;
  injured: readonly string[];
  nameOf: (id: string) => string;
  onCancelSwap: () => void;
}) {
  const { t } = useTranslation();
  const key = "online.match.phoneSubs";
  let text = t(`${key}.hintIdle`);
  let tone = "text-gray-600 dark:text-gray-400";
  if (swapping && picked?.on === "pitch") {
    text = t(`${key}.hintSwap`, { name: nameOf(picked.id) });
    tone = "text-sky-700 dark:text-sky-300";
  } else if (picked?.on === "pitch" && replacing.has(picked.id)) {
    text = t(`${key}.hintQueued`, { name: nameOf(picked.id) });
    tone = "text-amber-700 dark:text-amber-300";
  } else if (picked?.on === "pitch") {
    text = t(`${key}.hintPickBench`, { name: nameOf(picked.id) });
    tone = "text-red-700 dark:text-red-300";
  } else if (picked?.on === "bench") {
    text = t(`${key}.hintPickField`, { name: nameOf(picked.id) });
    tone = "text-primary-700 dark:text-primary-300";
  } else if (left <= 0) {
    text = t("match.allSubsUsed");
    tone = "text-amber-700 dark:text-amber-300";
  }
  return (
    <div className="flex flex-col gap-1">
      {injured.length > 0 && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {t("match.injuredPrompt", { name: injured.map(nameOf).join(", ") })}
        </p>
      )}
      <div role="status" className={`flex min-h-9 items-center gap-2 px-0.5 text-sm ${tone}`}>
        <span className="flex-1">{text}</span>
        {swapping && (
          <button
            type="button"
            onClick={onCancelSwap}
            className={`h-8 rounded-lg border border-sky-500 px-2.5 text-xs font-semibold text-sky-700 dark:border-sky-400 dark:text-sky-300 ${FOCUS}`}
          >
            {t(`${key}.cancelSwap`)}
          </button>
        )}
      </div>
    </div>
  );
}
