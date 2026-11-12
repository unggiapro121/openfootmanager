// What the scouting report's tests read: a report back on the next opponent, as S-47b sends it.

import type { OpponentReportContent, OpponentReportView, ReportPlayer } from "../../../api";
import type { PitchPosition } from "../../../api/engine";
import { squadPlayer } from "../../../../test-utils/onlineTestKit";
import { THEM } from "../opponentTestData";

/** The slots of a 4-4-2, in order: what `buildPitchRows("4-4-2")` lays out. */
const FOUR_FOUR_TWO: PitchPosition[] = [
  "Goalkeeper",
  "LeftBack",
  "CenterBack",
  "CenterBack",
  "RightBack",
  "LeftMidfielder",
  "CentralMidfielder",
  "CentralMidfielder",
  "RightMidfielder",
  "Striker",
  "Striker",
];

export function reportPlayer(n: number, extra: Partial<ReportPlayer> = {}): ReportPlayer {
  const slotPosition = FOUR_FOUR_TWO[n];
  return {
    id: `their-${n}`,
    fullName: `Cầu Thủ ${n}`,
    shirtNumber: n + 1,
    age: 20 + n,
    nationality: "VN",
    naturalPosition: slotPosition ?? "Striker",
    slot: slotPosition ? n : undefined,
    slotPosition,
    slotOvr: slotPosition ? 60 + n : undefined,
    conditionBand: "fresh",
    attributes: squadPlayer().attributes,
    positionRatings: [
      { position: slotPosition ?? "Striker", ovr: 60 + n, fit: "Natural" },
      { position: "CentralMidfielder", ovr: 50 + n, fit: "Unfamiliar" },
    ],
    ...extra,
  };
}

/** A 4-4-2 eleven by slot and one man on the bench; the captain and the set-piece takers named. */
export function reportContent(extra: Partial<OpponentReportContent> = {}): OpponentReportContent {
  return {
    formation: "4-4-2",
    eleven: Array.from({ length: 11 }, (_, slot) => reportPlayer(slot)),
    bench: [reportPlayer(11, { fullName: "Dự Bị Một" })],
    captain: "their-2",
    penaltyTaker: "their-9",
    freeKickTaker: "their-6",
    cornerTaker: "their-8",
    ...extra,
  };
}

export const KICKOFF_AT = "2099-01-01T11:00:00Z";
export const SNAPSHOT_AT = "2099-01-01T08:00:00Z";

export function reportView(extra: Partial<OpponentReportView> = {}): OpponentReportView {
  return {
    id: "report-1",
    fixtureId: "fixture-9",
    opponent: THEM,
    kickoffAt: KICKOFF_AT,
    status: "ready",
    costEur: 250_000,
    sentAt: "2098-12-31T22:00:00Z",
    readyAt: SNAPSHOT_AT,
    snapshotAt: SNAPSHOT_AT,
    ownerChanged: false,
    content: reportContent(),
    live: { left: [], injured: [], suspended: {} },
    ...extra,
  };
}
