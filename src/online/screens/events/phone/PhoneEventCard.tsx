import { type ReactElement, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Gift, Info } from "lucide-react";
import type { EventView, MissionView, RewardView } from "../../../api";
import { FOCUS } from "../../mobile/PhoneSheet";
import { isDirected, themeName, themeTagline } from "../eventText";
import {
  type EventGroup,
  journeyCounts,
  type MissionPhase,
  missionPhase,
  missionsInOrder,
} from "../missionState";
import { useEventCountdown } from "../useEventCountdown";
import PhoneChip, { type ChipTone } from "./PhoneChip";
import PhoneMissionRow from "./PhoneMissionRow";
import {
  isDone,
  longCountdown,
  type SegmentTone,
  segmentsOf,
  shortCountdown,
} from "./phoneEventState";

const STATE_TONE: Record<EventGroup, ChipTone> = {
  running: "green",
  ended: "gold",
  scheduled: "blue",
  closed: "plain",
};

const SEGMENT: Record<SegmentTone, string> = {
  claimed: "bg-primary-500",
  ready: "bg-accent-400",
  open: "bg-gray-200 dark:bg-navy-600",
  failed: "bg-red-300 dark:bg-red-900",
};

/** The card's countdown, to the second once open: what is left, until the claims close, or when it starts. */
function TimeLine({ event, open }: { event: EventView; open: boolean }) {
  const { t } = useTranslation();
  const { group, left } = useEventCountdown(event);
  if (group === "closed") {
    return (
      <span className="font-semibold text-gray-600 dark:text-gray-400">
        {t("online.events.phone.over")}
      </span>
    );
  }
  const parts = left ?? { days: 0, clock: "00:00:00" };
  const countdown = open ? longCountdown(t, parts) : shortCountdown(t, parts);
  const key = {
    running: "online.events.phone.leftRunning",
    ended: "online.events.phone.leftEnded",
    scheduled: "online.events.time.scheduled",
  }[group];
  // The last day of a running event is said in red, as the design asks.
  const tone =
    group !== "running"
      ? "text-gray-600 dark:text-gray-400"
      : parts.days === 0
        ? "text-red-600 dark:text-red-400"
        : "text-gray-900 dark:text-white";
  return (
    <span role="timer" className={`font-semibold tabular-nums ${tone}`}>
      {t(key, { countdown })}
    </span>
  );
}

interface Row {
  mission: MissionView;
  phase: MissionPhase;
}

/** The missions with nothing left to do, folded under "Done (N)" at the card's foot. */
function DoneFold({ rows, renderRow }: { rows: Row[]; renderRow: (row: Row) => ReactElement }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-gray-200 bg-gray-50 dark:border-navy-600 dark:bg-navy-700">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className={`flex min-h-11 w-full items-center gap-2 px-3.5 text-left text-[13px] font-semibold text-gray-600 dark:text-gray-400 ${FOCUS}`}
      >
        <Check className="h-4 w-4 text-primary-600 dark:text-primary-400" aria-hidden />
        <span className="flex-1">{t("online.events.phone.done", { n: rows.length })}</span>
        <ChevronDown
          className={`h-5 w-5 text-gray-400 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open && <ul>{rows.map(renderRow)}</ul>}
    </div>
  );
}

/**
 * One event on a phone (design m-su-kien.html): a head that folds it, with its name, its state,
 * one line of time and counts, and a bar of one segment a mission; open, its line, the rule of
 * the directed matches, the missions still to do, and those done folded at its foot.
 */
export default function PhoneEventCard({
  event,
  open,
  onToggle,
  onShow,
  onClaimed,
}: {
  event: EventView;
  open: boolean;
  onToggle: () => void;
  onShow: (code: string) => void;
  onClaimed: (rewards: RewardView[]) => void;
}) {
  const { t } = useTranslation();
  const nameId = useId();
  const bodyId = useId();
  const group = useEventCountdown(event).group;
  const counts = journeyCounts(event);
  const rows = missionsInOrder(event).map((mission) => ({
    mission,
    phase: missionPhase(event, mission),
  }));
  const toDo = rows.filter((row) => !isDone(row.phase));
  const done = rows.filter((row) => isDone(row.phase));
  // The rule most often misread: a match the AI plays for the coach does not count.
  const ruled =
    group !== "closed" &&
    event.missions.some((mission) => isDirected(mission.kind) || mission.kind === "offlineMatches");
  const renderRow = (row: Row) => (
    <PhoneMissionRow
      key={row.mission.code}
      event={event}
      mission={row.mission}
      phase={row.phase}
      onShow={() => onShow(row.mission.code)}
      onClaimed={onClaimed}
    />
  );
  return (
    <section
      aria-labelledby={nameId}
      className={`overflow-hidden rounded-2xl border bg-white dark:bg-navy-800 ${
        counts.ready > 0
          ? "border-accent-400 dark:border-accent-900"
          : "border-gray-200 dark:border-navy-600"
      }`}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={onToggle}
        className={`flex w-full flex-col gap-1.5 px-3.5 py-3 text-left ${FOCUS}`}
      >
        <span className="flex w-full items-center gap-2">
          <span
            id={nameId}
            className="min-w-0 flex-1 truncate font-heading text-xl font-bold uppercase leading-tight tracking-wider text-gray-900 dark:text-white"
          >
            {themeName(t, event.theme)}
          </span>
          <PhoneChip tone={STATE_TONE[group]} dot>
            {t(`online.events.state.${group}`)}
          </PhoneChip>
          <ChevronDown
            className={`h-5 w-5 shrink-0 text-gray-400 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
        </span>
        <span className="flex w-full min-w-0 items-center gap-1.5 whitespace-nowrap text-xs text-gray-600 dark:text-gray-400">
          <TimeLine event={event} open={open} />
          <span aria-hidden="true">·</span>
          <span className="truncate">
            {group === "scheduled"
              ? t("online.events.phone.missionCount", { n: counts.total })
              : t("online.events.journey.met", { met: counts.met, total: counts.total })}
          </span>
          {counts.ready > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <strong className="inline-flex items-center gap-1 text-accent-800 dark:text-accent-300">
                <Gift className="h-3.5 w-3.5" aria-hidden />
                {t("online.events.phone.readyCount", { n: counts.ready })}
              </strong>
            </>
          )}
        </span>
        {counts.total > 0 && (
          <span
            aria-hidden="true"
            className="mt-0.5 grid w-full gap-0.75"
            style={{ gridTemplateColumns: `repeat(${counts.total}, minmax(0, 1fr))` }}
          >
            {segmentsOf(event).map((segment) => (
              <span key={segment.code} className={`h-1.5 rounded-full ${SEGMENT[segment.tone]}`} />
            ))}
          </span>
        )}
      </button>
      {open && (
        <div id={bodyId}>
          <p className="px-3.5 pb-2.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            {themeTagline(t, event.theme)}
          </p>
          {ruled && (
            <p className="mx-3.5 mb-2.5 flex gap-1.5 rounded-lg bg-gray-50 px-2.5 py-2 text-xs leading-snug text-gray-600 dark:bg-navy-900 dark:text-gray-400">
              <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              {t("online.events.hint.directed")}
            </p>
          )}
          {toDo.length > 0 && (
            <ul className="bg-gray-50 dark:bg-navy-700">{toDo.map(renderRow)}</ul>
          )}
          {done.length > 0 && <DoneFold rows={done} renderRow={renderRow} />}
        </div>
      )}
    </section>
  );
}
