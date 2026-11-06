import type { ExtraDayView, SquadPlayerView } from "../../api";
import { trainsKeeperDrill } from "./keeperDrill";

/** "Until no one can": the most sessions one request may ask for (S-28 S28-2). */
export const ALL_SESSIONS = 30;
/** The session counts the card offers (C-12 C12-4). */
export const SESSION_CHOICES = [1, 3, 5, ALL_SESSIONS] as const;
/** The condition a starter should keep for today's match, and the `keepAbove` suggested then. */
export const MATCH_CONDITION = 75;
/** The names a warning lists before it says "and k more". */
const NAMES_SHOWN = 3;

/** What the card keeps between visits, per club (C12-2, C12-4; Qs28-5). */
export interface ExtraChoice {
  /** The players chosen; `null` for the whole squad (the first visit, or a store that failed). */
  players: string[] | null;
  sessions: number;
  keepAbove: number | null;
}

const DEFAULT_CHOICE: ExtraChoice = { players: null, sessions: 1, keepAbove: null };

function storageKey(clubId: string): string {
  return `ofm.online.extraTraining.${clubId}`;
}

/**
 * The card's saved choice for `clubId`, or the defaults: the whole squad, one session, no
 * condition kept. A store that cannot be read, or holds something else, gives the defaults.
 */
export function loadChoice(clubId: string): ExtraChoice {
  try {
    const raw = window.localStorage.getItem(storageKey(clubId));
    if (!raw) return DEFAULT_CHOICE;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_CHOICE;
    const value = parsed as Record<string, unknown>;
    const players =
      Array.isArray(value.players) && value.players.every((id) => typeof id === "string")
        ? (value.players as string[])
        : null;
    const sessions = SESSION_CHOICES.find((count) => count === value.sessions) ?? 1;
    const keepAbove = typeof value.keepAbove === "number" ? value.keepAbove : null;
    return { players, sessions, keepAbove };
  } catch {
    return DEFAULT_CHOICE;
  }
}

/** Keeps the choice for the next visit; a store that refuses is not the player's problem. */
export function saveChoice(clubId: string, choice: ExtraChoice): void {
  try {
    window.localStorage.setItem(storageKey(clubId), JSON.stringify(choice));
  } catch {
    // Private windows and full stores refuse: the card still works, it just forgets.
  }
}

/**
 * The players to send: the saved ones still in the squad, or the whole squad when none was saved.
 * A player sold or released since is dropped, or the server refuses the press (`notInSquad`).
 */
export function chosenInSquad(saved: string[] | null, squad: SquadPlayerView[]): string[] {
  if (saved === null) return squad.map((player) => player.id);
  const ids = new Set(squad.map((player) => player.id));
  return saved.filter((id) => ids.has(id));
}

/**
 * A player's condition after `sessions` extra sessions of `cost` each, read the way the server
 * stops him (S-28 S28-3): not under the floor before a session, not under `keepAbove` after one.
 * Recovery until kick-off is not guessed (C-8 F10).
 */
export function conditionAfter(
  condition: number,
  sessions: number,
  cost: number,
  floor: number,
  keepAbove: number | null,
): number {
  let after = condition;
  for (let held = 0; held < sessions; held += 1) {
    if (after < floor) break;
    if (keepAbove !== null && after - cost < keepAbove) break;
    after -= cost;
  }
  return after;
}

/**
 * The chosen players of today's eleven who would start the match under `MATCH_CONDITION` after
 * the press (C12-6). Those the server says sit out are left alone: they will not train.
 */
export function startersUnderMatchCondition(input: {
  players: SquadPlayerView[];
  chosen: string[];
  startingXiIds: string[];
  extra: ExtraDayView;
  intensity: string;
  sessions: number;
  keepAbove: number | null;
}): SquadPlayerView[] {
  const cost = input.extra.costs?.[input.intensity];
  if (cost === undefined) return [];
  const chosen = new Set(input.chosen);
  const eleven = new Set(input.startingXiIds);
  const sittingOut = new Set(input.extra.sitOut.map((line) => line.playerId));
  return input.players.filter((player) => {
    if (!chosen.has(player.id) || !eleven.has(player.id) || sittingOut.has(player.id)) {
      return false;
    }
    const after = conditionAfter(
      player.condition,
      input.sessions,
      cost,
      input.extra.floor,
      input.keepAbove,
    );
    return after < player.condition && after < MATCH_CONDITION;
  });
}

/**
 * The chosen players whose focus lifts nothing while another focus would (E5-4 R12-F, now the
 * server's `focusFit`, S-31b): an extra session only costs them condition. The rule is the
 * fork's; the card only reads its verdict.
 */
export function focusLiftsNothing(players: SquadPlayerView[], chosen: string[]): SquadPlayerView[] {
  const ids = new Set(chosen);
  return players.filter((player) => ids.has(player.id) && player.focusFit?.verdict === "nothing");
}

/**
 * The keepers the server says sit an extra session out tired (E5-6d C), in a season whose keepers
 * train their own drill: missing the session, they miss the drill too. The whole squad counts, not
 * only the chosen players, and no other reason does: rest does not mend those.
 */
export function keepersTooTired(
  players: SquadPlayerView[],
  extra: ExtraDayView,
  keeperDrill: boolean | undefined,
): SquadPlayerView[] {
  const tired = new Set(
    extra.sitOut.filter((line) => line.reason === "tired").map((line) => line.playerId),
  );
  return players.filter(
    (player) =>
      tired.has(player.id) &&
      trainsKeeperDrill(player.naturalPosition || player.position, keeperDrill),
  );
}

/** Up to three names, and how many more: what a warning lists. */
export function namesOf(players: SquadPlayerView[]): { names: string; more: number } {
  return {
    names: players
      .slice(0, NAMES_SHOWN)
      .map((player) => player.matchName)
      .join(", "),
    more: Math.max(0, players.length - NAMES_SHOWN),
  };
}

/** The reasons a player sits out or stops (S-28 §6), as the card's text keys know them. */
const STOP_REASONS = new Set(["injured", "tired", "resting", "peaked", "keepAbove", "focusMaxed"]);

/** The text key of a sit-out or stop reason; a reason this build does not know reads plainly. */
export function stopReasonKey(reason: string): string {
  return STOP_REASONS.has(reason)
    ? `online.training.extra.reason.${reason}`
    : "online.training.extra.reason.other";
}
