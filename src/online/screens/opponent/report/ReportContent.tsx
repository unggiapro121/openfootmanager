import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Camera, X } from "lucide-react";
import DashboardModalFrame from "../../../../components/dashboard/DashboardModalFrame";
import { usePhoneLayout } from "../../../../hooks/usePhoneLayout";
import type {
  OpponentReportContent,
  OpponentReportLive,
  OpponentReportView,
  ReportPlayer,
} from "../../../api";
import { formatMoment } from "../../../format";
import OpponentReportBoard from "./OpponentReportBoard";
import ReportPlayerCard from "./ReportPlayerCard";
import {
  BAND_DOT,
  bandKey,
  leadMinutes,
  liveMarks,
  playersOf,
  reportPlayerHref,
} from "./reportParts";

const NOTE = "text-xs text-gray-500 dark:text-gray-400";
const BANDS = ["fresh", "ok", "tired"] as const;

/**
 * A report back (C-24 C24-2…C24-5): when it was taken and that it is only a snapshot, the side on
 * the board with its bench, the captain and the set-piece takers, and what changed since. A man
 * picked opens his attributes, in a dialog on a desktop and on a page of his own on a phone.
 * `locksAt`, when known, names how long before the kick-off the opponent's team locks.
 */
export default function ReportContent({
  report,
  content,
  locksAt,
}: {
  report: OpponentReportView;
  content: OpponentReportContent;
  locksAt?: string;
}) {
  const { t, i18n } = useTranslation();
  const phone = usePhoneLayout();
  const navigate = useNavigate();
  const [picked, setPicked] = useState<ReportPlayer | null>(null);
  const minutes = leadMinutes(report.kickoffAt, locksAt);
  const pick = (player: ReportPlayer) =>
    phone ? navigate(reportPlayerHref(report.id, player.id)) : setPicked(player);

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1">
        {report.snapshotAt && (
          <p className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
            <Camera
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-primary-600 dark:text-primary-400"
            />
            {t("online.opponentReport.snapshot", {
              time: formatMoment(report.snapshotAt, i18n.language),
            })}
          </p>
        )}
        <p className={NOTE}>
          {minutes === undefined
            ? t("online.opponentReport.snapshotNote")
            : t("online.opponentReport.snapshotNoteLead", { minutes })}
        </p>
        {report.ownerChanged && (
          <p className="text-sm font-semibold text-accent-700 dark:text-accent-400">
            {t("online.opponentReport.ownerChanged")}
          </p>
        )}
        {content.shortOf !== undefined && content.shortOf > 0 && (
          <p className="text-sm font-semibold text-red-600 dark:text-red-400">
            {t("online.opponentReport.shortOf", { n: content.shortOf })}
          </p>
        )}
        {report.status === "refunded" && (
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            {t(`online.opponentReport.refundedAfter.${report.refundReason ?? "other"}`)}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-heading text-sm font-bold uppercase tracking-wider text-gray-800 dark:text-gray-100">
          {t("online.opponentReport.projected", { formation: content.formation })}
        </h4>
        <BandLegend />
      </div>
      <OpponentReportBoard content={content} live={report.live} onPick={pick} />
      <SetPieces content={content} />
      <Changes content={content} live={report.live} />
      {picked && <PlayerDialog player={picked} onClose={() => setPicked(null)} />}
    </div>
  );
}

/** What the dots mean: each man's freshness at the kick-off, by band only. */
function BandLegend() {
  const { t } = useTranslation();
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${NOTE}`}>
      <span>{t("online.opponentReport.bands.title")}</span>
      {BANDS.map((band) => (
        <span key={band} className="flex items-center gap-1">
          <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${BAND_DOT[band]}`} />
          {t(bandKey(band))}
        </span>
      ))}
    </div>
  );
}

/** The captain and the three takers (C24-3), or that no one is set. */
function SetPieces({ content }: { content: OpponentReportContent }) {
  const { t } = useTranslation();
  const names = new Map(playersOf(content).map((player) => [player.id, player.fullName]));
  const rows: [string, string | undefined][] = [
    ["match.captain", content.captain],
    ["match.penaltyTaker", content.penaltyTaker],
    ["match.freeKickTaker", content.freeKickTaker],
    ["match.cornerTaker", content.cornerTaker],
  ];
  return (
    <ul
      aria-label={t("online.opponentReport.setPieces")}
      className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2"
    >
      {rows.map(([label, id]) => (
        <li
          key={label}
          className="flex justify-between gap-3 border-b border-gray-100 py-1 dark:border-navy-600"
        >
          <span className="text-gray-500 dark:text-gray-400">{t(label)}</span>
          <span className="truncate font-semibold text-gray-900 dark:text-gray-100">
            {(id && names.get(id)) || t("match.notAssigned")}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Who has left, is injured or is banned since the report was taken (BR-20): marks only. */
function Changes({
  content,
  live,
}: {
  content: OpponentReportContent;
  live: OpponentReportLive | undefined;
}) {
  const { t } = useTranslation();
  const changed = playersOf(content)
    .map((player) => ({ player, marks: liveMarks(t, live, player.id) }))
    .filter((entry) => entry.marks.length > 0);
  if (changed.length === 0) return null;
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 dark:border-red-500/30 dark:bg-red-900/20">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">
        {t("online.opponentReport.live.title")}
      </p>
      <ul className="space-y-0.5 text-sm text-gray-800 dark:text-gray-100">
        {changed.flatMap(({ player, marks }) =>
          marks.map((mark) => (
            <li key={`${player.id}-${mark}`} className="flex gap-2">
              <span className="font-semibold">{player.fullName}</span>
              <span>{mark}</span>
            </li>
          )),
        )}
      </ul>
    </div>
  );
}

/** One man of the report over the page on a desktop; Escape or the close button leaves it. */
function PlayerDialog({ player, onClose }: { player: ReportPlayer; onClose: () => void }) {
  const { t } = useTranslation();
  const titleId = useId();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") onClose();
  };
  return (
    <DashboardModalFrame maxWidthClassName="max-w-3xl">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="max-h-[80vh] space-y-4 overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-3">
          <h3
            id={titleId}
            className="font-heading text-lg font-bold text-gray-900 dark:text-gray-100"
          >
            {player.fullName}
          </h3>
          <button
            ref={close}
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-gray-400 dark:hover:bg-navy-700 dark:focus:ring-offset-navy-800"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        <ReportPlayerCard player={player} />
      </div>
    </DashboardModalFrame>
  );
}
