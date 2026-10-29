import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { EventView } from "../../api";
import { useOnlineNow } from "../../clock";
import { countdownTo, formatMoment } from "../../format";
import { refreshEvents } from "../../store/onlineStore";
import { LABEL } from "../overview/OverviewCard";
import { eventGroup } from "./missionState";

const ignore = () => undefined;

/** The moment an event counts down to, by its state; none once it is closed. */
function deadlineOf(event: EventView): string | undefined {
  const group = eventGroup(event.state);
  if (group === "running") return event.endsAt;
  if (group === "ended") return event.claimUntil;
  if (group === "scheduled") return event.startsAt;
  return undefined;
}

const ZERO = { days: 0, clock: "00:00:00" };

/**
 * When the event ends, its claims close or it starts (design su-kien.html: days, hours, minutes
 * and seconds in boxes), on this machine's clock (C-7 C7-51: events last days, so a few seconds
 * off does not show). At zero the server's state has changed, so the events are read again, once.
 */
export default function EventTimer({ event }: { event: EventView }) {
  const { t, i18n } = useTranslation();
  const now = useOnlineNow();
  const deadline = deadlineOf(event);
  const left = deadline ? countdownTo(deadline, now) : null;
  const asked = useRef(false);
  const runOut = deadline !== undefined && left === null;
  useEffect(() => {
    if (runOut && !asked.current) {
      asked.current = true;
      void refreshEvents().catch(ignore);
    }
  }, [runOut]);

  const group = eventGroup(event.state);
  if (!deadline || group === "closed") {
    return <p className={LABEL}>{t("online.events.time.closed")}</p>;
  }

  const parts = left ?? ZERO;
  const [hours, minutes, seconds] = parts.clock.split(":");
  const countdown =
    parts.days > 0
      ? t("online.countdown.withDays", { days: parts.days, clock: parts.clock })
      : parts.clock;
  const moment = formatMoment(deadline, i18n.language);
  const spoken =
    group === "ended"
      ? t("online.events.time.ended", { moment, countdown })
      : t(`online.events.time.${group}`, { countdown });
  const boxes = [
    { value: String(parts.days), unit: t("online.events.unit.days") },
    { value: hours, unit: t("online.events.unit.hours") },
    { value: minutes, unit: t("online.events.unit.minutes") },
    { value: seconds, unit: t("online.events.unit.seconds"), gold: true },
  ];
  return (
    <div
      role="timer"
      aria-label={spoken}
      title={moment}
      className="flex flex-col items-start gap-1.5 @2xl:items-end"
    >
      <span className={LABEL}>{t(`online.events.timer.${group}`)}</span>
      <div aria-hidden="true" className="flex gap-1.5">
        {boxes.map((box) => (
          <span
            key={box.unit}
            className="flex min-w-13 flex-col items-center rounded-lg border border-gray-200 bg-gray-50 py-1.5 dark:border-navy-600 dark:bg-navy-900"
          >
            <span
              className={`font-heading text-2xl font-bold leading-none tabular-nums ${
                box.gold ? "text-accent-700 dark:text-accent-400" : "text-gray-900 dark:text-white"
              }`}
            >
              {box.value}
            </span>
            <span className="text-[10px] text-gray-500 dark:text-gray-400">{box.unit}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
