import type { FacilitiesView, FacilityBuildView, FacilityItemView } from "../../api";

/**
 * What stops every write on the screen (c-27 T4): the season played without money, or the
 * club's finances locked for a check. `null` when nothing does.
 */
export type WritesOff = "economy" | "locked" | null;

/**
 * A facility card's state (c-27 §5.4, C27-11), in the design's order of precedence: building it
 * (S6), at the top (S7), every write off (T4), the coach's level short (S4), the builders busy
 * elsewhere (S5), the cash short (S3), not built yet (S2), ready to go up (S1).
 */
export type CardState =
  | { kind: "building"; build: FacilityBuildView }
  | { kind: "top" }
  | { kind: "writesOff"; reason: Exclude<WritesOff, null> }
  | { kind: "coachLocked"; coachLevel: number; current: number }
  | { kind: "builderBusy"; busy: FacilityBuildView }
  | { kind: "short"; cost: number; missing: number }
  | { kind: "unbuilt"; cost: number }
  | { kind: "ready"; cost: number };

/** What a card's state is read from besides its own item: the view, the club's cash and lock. */
export interface CardContext {
  view: Pick<FacilitiesView, "build" | "coachLevel">;
  cash: number;
  writesOff: WritesOff;
}

export function cardState(
  item: FacilityItemView,
  { view, cash, writesOff }: CardContext,
): CardState {
  const build = view.build ?? null;
  if (build?.facility === item.facility) return { kind: "building", build };
  if (item.cost === null) return { kind: "top" };
  if (writesOff) return { kind: "writesOff", reason: writesOff };
  if (item.lock) {
    return { kind: "coachLocked", coachLevel: item.lock.coachLevel, current: view.coachLevel ?? 0 };
  }
  if (build) return { kind: "builderBusy", busy: build };
  if (cash < item.cost) return { kind: "short", cost: item.cost, missing: item.cost - cash };
  if (item.level === 0) return { kind: "unbuilt", cost: item.cost };
  return { kind: "ready", cost: item.cost };
}

/**
 * The card menu's "Downgrade" (c-27 §5.4 S9, R27-2): absent for the academy, which never goes
 * down; off with its reason while every write is off, while the facility itself is building,
 * during a match's lineup lock, or when the server says it cannot go lower.
 */
export type DowngradeState =
  | { kind: "none" }
  | { kind: "open" }
  | { kind: "off"; reason: "writesOff" | "building" | "lineupLocked" | "atBottom" };

export function downgradeState(
  item: FacilityItemView,
  view: Pick<FacilitiesView, "build" | "lineupLocked">,
  writesOff: WritesOff,
): DowngradeState {
  if (item.facility === "academy") return { kind: "none" };
  if (writesOff) return { kind: "off", reason: "writesOff" };
  if (view.build?.facility === item.facility) return { kind: "off", reason: "building" };
  if (view.lineupLocked) return { kind: "off", reason: "lineupLocked" };
  if (!item.canDowngrade) return { kind: "off", reason: "atBottom" };
  return { kind: "open" };
}

/**
 * Where a build stands on this machine's clock, given how far the server's clock was from it
 * when the view was read (c-27 §5.2): seconds left, or, once its end has passed, whether a
 * match's lineup lock holds it (R27-1: it completes after the match) or the server has not
 * answered yet.
 */
export type BuildClock =
  | { kind: "running"; secondsLeft: number; share: number }
  | { kind: "afterMatch" }
  | { kind: "due" };

export function buildClock(
  build: FacilityBuildView,
  lineupLocked: boolean,
  nowMs: number,
  serverOffsetMs: number,
): BuildClock {
  const now = nowMs + serverOffsetMs;
  const start = Date.parse(build.startedAt);
  const end = Date.parse(build.endsAt);
  if (Number.isNaN(end) || end <= now)
    return lineupLocked ? { kind: "afterMatch" } : { kind: "due" };
  const span = Number.isNaN(start) ? 0 : end - start;
  const share = span > 0 ? Math.min(1, Math.max(0, (now - start) / span)) : 0;
  return { kind: "running", secondsLeft: Math.ceil((end - now) / 1000), share };
}

/** How far the server's clock is from this one, from the view's `serverNow`; 0 without one. */
export function serverOffsetOf(view: Pick<FacilitiesView, "serverNow">, readAtMs: number): number {
  const server = view.serverNow ? Date.parse(view.serverNow) : Number.NaN;
  return Number.isNaN(server) ? 0 : server - readAtMs;
}

/** Whether a season builds facilities over time: its view has the stands (c-27 §5.1). */
export function buildsOverTime(view: FacilitiesView | null | undefined): boolean {
  return view?.items?.some((item) => item.facility === "stands") ?? false;
}
