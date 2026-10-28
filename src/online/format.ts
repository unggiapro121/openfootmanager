import type { CoachRegion } from "./api/domain";

/**
 * A number of OFM Coins (C-7 C7-5): whole, grouped the way the player's language groups digits,
 * with its sign when below zero, and no currency mark. Never euros' `formatVal`.
 */
export function formatCoins(coins: number, language: string): string {
  return new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(coins);
}

/** What is left until a moment: whole days, and the rest as `HH:MM:SS`. */
export interface Countdown {
  days: number;
  clock: string;
}

const pad = (value: number): string => String(value).padStart(2, "0");

/** The time from `nowMs` until `targetIso`; `null` once it has passed or when it is unreadable. */
export function countdownTo(targetIso: string, nowMs: number): Countdown | null {
  const target = Date.parse(targetIso);
  if (Number.isNaN(target) || target <= nowMs) return null;
  const totalSeconds = Math.ceil((target - nowMs) / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const rest = totalSeconds % 86_400;
  const clock = `${pad(Math.floor(rest / 3600))}:${pad(Math.floor((rest % 3600) / 60))}:${pad(rest % 60)}`;
  return { days, clock };
}

/** Seconds from `nowMs` until `targetMs`, never below zero. */
export function secondsUntil(targetMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
}

/** A moment of the online calendar on this machine's clock, in the player's language. */
export function formatMoment(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(language, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * A kick-off in a short list, on this machine's clock: its time alone when it is today, its
 * weekday and time on a later day.
 */
export function formatKickoffClock(iso: string, nowMs: number, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const sameDay = date.toDateString() === new Date(nowMs).toDateString();
  return new Intl.DateTimeFormat(language, {
    ...(sameDay ? {} : { weekday: "short" }),
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * Each region's fixed offset from UTC, in minutes, as the server counts it
 * (`ofm_rules::coach_progress`, no daylight saving), and a time zone that keeps that offset all
 * year, to write a clock of the region.
 */
const REGIONS: Record<CoachRegion, { offsetMinutes: number; zone: string }> = {
  AsiaSoutheast: { offsetMinutes: 7 * 60, zone: "Asia/Bangkok" },
  AsiaEast: { offsetMinutes: 8 * 60, zone: "Asia/Shanghai" },
  Europe: { offsetMinutes: 60, zone: "Africa/Lagos" },
  Americas: { offsetMinutes: -5 * 60, zone: "America/Panama" },
};

/** The regions a coach can play in, in the order the account form lists them. */
export const ONLINE_REGIONS = Object.keys(REGIONS) as CoachRegion[];

/** Whether this machine's clock, at `iso`, is on another offset than `region` (C-2 Qc2-4). */
export function deviceDiffersFromRegion(region: string, iso: string): boolean {
  const known = REGIONS[region as CoachRegion];
  if (!known) return false;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  return -date.getTimezoneOffset() !== known.offsetMinutes;
}

/** The time of day at `iso` on a clock of `region`; this machine's when the region is unknown. */
export function formatRegionClock(iso: string, region: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const known = REGIONS[region as CoachRegion];
  return new Intl.DateTimeFormat(language, {
    hour: "2-digit",
    minute: "2-digit",
    ...(known ? { timeZone: known.zone } : {}),
  }).format(date);
}
