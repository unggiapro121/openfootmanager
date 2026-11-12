import type { TFunction } from "i18next";
import type { TeamMatchRolesData } from "../../../../store/types";
import type {
  ConditionBand,
  OpponentReportContent,
  OpponentReportLive,
  ReportPlayer,
} from "../../../api";

const MINUTE_MS = 60_000;

/** The page of one scouting report (C-24b): the profile's block, a mail, a played match lead here. */
export const reportHref = (reportId: string) => `/online/opponent-reports/${reportId}`;

/** A phone's page of one man of a report (C24-4, analysis §4.7). */
export const reportPlayerHref = (reportId: string, playerId: string) =>
  `${reportHref(reportId)}/players/${playerId}`;

/** The dot of each band: green, gold, red, as the tactics board colours condition. */
export const BAND_DOT: Record<ConditionBand, string> = {
  fresh: "bg-primary-500 dark:bg-primary-400",
  ok: "bg-accent-400 dark:bg-accent-400",
  tired: "bg-red-500 dark:bg-red-400",
};

/** What a band is called (S-47 §5.3): how fresh a man would be at the kick-off, never a figure. */
export const bandKey = (band: ConditionBand) => `online.opponentReport.bands.${band}`;

/** The minutes between the lock and the kick-off, or none when either is not known. */
export function leadMinutes(kickoffAt: string, locksAt: string | undefined): number | undefined {
  if (!locksAt) return undefined;
  const minutes = Math.round((Date.parse(kickoffAt) - Date.parse(locksAt)) / MINUTE_MS);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : undefined;
}

/** Everyone the report names: the eleven by slot, then the bench. */
export const playersOf = (content: OpponentReportContent): ReportPlayer[] => [
  ...content.eleven,
  ...content.bench,
];

/**
 * The report's captain and takers as the tactics board's markers read duties, so a token
 * carries the same C, PK, FK and CK chips as everywhere else in the game.
 */
export function dutiesOf(content: OpponentReportContent): Partial<TeamMatchRolesData> {
  return {
    captain: content.captain ?? null,
    penalty_taker: content.penaltyTaker ?? null,
    free_kick_taker: content.freeKickTaker ?? null,
    corner_taker: content.cornerTaker ?? null,
  };
}

/**
 * What changed for one man since the report was taken (S-47 §5.4, BR-20), from what anyone may
 * see now: gone, injured, banned for so many matches. Marks only: the report itself never changes.
 */
export function liveMarks(
  t: TFunction,
  live: OpponentReportLive | undefined,
  playerId: string,
): string[] {
  if (!live) return [];
  const marks: string[] = [];
  if (live.left.includes(playerId)) marks.push(t("online.opponentReport.live.left"));
  if (live.injured.includes(playerId)) marks.push(t("online.opponentReport.live.injured"));
  const banned = live.suspended[playerId];
  if (banned !== undefined) {
    marks.push(t("online.opponentReport.live.suspended", { matches: banned }));
  }
  return marks;
}

/** A man's OVR in his own position: the board's figure for the bench, the card's headline. */
export function naturalOvr(player: ReportPlayer): number {
  const own = player.positionRatings.find((rating) => rating.position === player.naturalPosition);
  return own?.ovr ?? Math.max(0, ...player.positionRatings.map((rating) => rating.ovr));
}

/** The OVR his token shows: in his slot for the eleven (PS2-1), in his own position on the bench. */
export const tokenOvr = (player: ReportPlayer): number => player.slotOvr ?? naturalOvr(player);

/**
 * A man's name for a screen reader: who he is, his OVR in the slot, his band, and what changed
 * since; the board shows the same on his token.
 */
export function tokenName(
  t: TFunction,
  player: ReportPlayer,
  live: OpponentReportLive | undefined,
): string {
  const ovr = tokenOvr(player);
  return [
    t("online.opponentReport.token", {
      name: player.fullName,
      ovr,
      band: t(bandKey(player.conditionBand)),
    }),
    ...liveMarks(t, live, player.id),
  ].join(", ");
}
