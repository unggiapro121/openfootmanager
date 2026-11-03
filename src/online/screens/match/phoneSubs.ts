import {
  type RecommendedSubstitution,
  sortByPositionGroup,
} from "../../../components/match/SubPanel.helpers";
import { ratingAt } from "../../../components/match/slotRatings";
import type { EnginePlayerData, MatchSnapshot, PositionFit } from "../../../components/match/types";
import type { SentCommand } from "../../api";
import type { Side } from "../../api/engine";

/** A change of players: who comes off, who goes on. */
export interface PlayerChange {
  offId: string;
  onId: string;
}

/**
 * The substitutions sent to the match and not yet decided in one of its gaps: until then both
 * players are spoken for, and each counts against the side's substitutions.
 */
export function substitutionsInFlight(
  sent: readonly SentCommand[],
  outcomes: Readonly<Record<string, string>>,
): PlayerChange[] {
  return sent.flatMap((line) =>
    line.status === "pending" && !outcomes[line.commandId] && "Substitute" in line.command
      ? [
          {
            offId: line.command.Substitute.player_off_id,
            onId: line.command.Substitute.player_on_id,
          },
        ]
      : [],
  );
}

/** A bench player as the replacement for one slot: how familiar it is to him, his rating there. */
export interface SlotCandidate {
  player: EnginePlayerData;
  /** Null when the match did not rate him there (the backend sends no rating). */
  fit: PositionFit | null;
  ovr: number;
}

const FIT_ORDER: Record<PositionFit, number> = { Natural: 0, Adapted: 1, Unfamiliar: 2 };
const fitOrder = (fit: PositionFit | null) => (fit ? FIT_ORDER[fit] : 3);
/** The design's order within one familiarity: rating first, then fresh legs. */
const strength = (candidate: SlotCandidate) =>
  candidate.ovr * 0.6 + candidate.player.condition * 0.4;

/**
 * The bench as replacements for `slot`: the players at home there first, then the adapted, then
 * the rest, each group strongest and freshest first. The ratings are the backend's (`ratingAt`).
 */
export function benchForSlot(bench: readonly EnginePlayerData[], slot: string): SlotCandidate[] {
  return bench
    .map((player) => {
      const rating = ratingAt(player, slot);
      return { player, fit: rating?.fit ?? null, ovr: rating?.ovr ?? player.ovr };
    })
    .sort((a, b) => fitOrder(a.fit) - fitOrder(b.fit) || strength(b) - strength(a));
}

/**
 * The coach's side as the substitutions screen reads it, with `changes` (sent or queued) taken
 * into account: the bench still to use, who is set to replace whom, the substitutions left.
 */
export function sideNow(snapshot: MatchSnapshot, side: Side, changes: readonly PlayerChange[]) {
  const home = side === "Home";
  const team = home ? snapshot.home_team : snapshot.away_team;
  const subsMade = home ? snapshot.home_subs_made : snapshot.away_subs_made;
  const used = new Set(
    snapshot.substitutions
      .filter((change) => change.side === side)
      .flatMap((change) => [change.player_on_id, change.player_off_id]),
  );
  const bench = sortByPositionGroup(
    (home ? snapshot.home_bench : snapshot.away_bench).filter((player) => !used.has(player.id)),
  );
  return {
    team,
    subsMade,
    bench,
    /** Off → on. */
    replacing: new Map(changes.map((change) => [change.offId, change.onId])),
    /** On → off. */
    comingOn: new Map(changes.map((change) => [change.onId, change.offId])),
    left: snapshot.max_subs - subsMade - changes.length,
    byId: new Map([...team.players, ...bench].map((player) => [player.id, player])),
  };
}

/**
 * The game's suggestions the coach can still take: those queued as suggested (shown as added),
 * and those whose two players are free, on a bench player still to use. A suggestion that
 * clashes with a change already chosen or sent is dropped.
 */
export function suggestionsStillOpen(
  suggestions: readonly RecommendedSubstitution[],
  queue: readonly PlayerChange[],
  changes: readonly PlayerChange[],
  bench: readonly EnginePlayerData[],
): RecommendedSubstitution[] {
  const same = (rec: RecommendedSubstitution) => (change: PlayerChange) =>
    change.offId === rec.offId && change.onId === rec.onId;
  return suggestions.filter((rec) => {
    if (!bench.some((player) => player.id === rec.onId)) return false;
    if (queue.some(same(rec))) return true;
    return !changes.some((change) => change.offId === rec.offId || change.onId === rec.onId);
  });
}
