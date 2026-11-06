import { useEffect, useRef } from "react";
import type { EventView } from "../../api";
import { useOnlineNow } from "../../clock";
import { type Countdown, countdownTo } from "../../format";
import { refreshEvents } from "../../store/onlineStore";
import { type EventGroup, eventGroup } from "./missionState";

const ignore = () => undefined;

/** The moment an event counts down to, by its state; none once it is closed. */
export function deadlineOf(event: EventView): string | undefined {
  const group = eventGroup(event.state);
  if (group === "running") return event.endsAt;
  if (group === "ended") return event.claimUntil;
  if (group === "scheduled") return event.startsAt;
  return undefined;
}

export interface EventCountdown {
  group: EventGroup;
  deadline: string | undefined;
  /** What is left; none once the deadline has passed, or for a closed event. */
  left: Countdown | null;
}

/**
 * The time left of an event, by its state, on this machine's clock (C-7 C7-51: events last days,
 * so a few seconds off does not show). At zero the server's state has changed, so the events are
 * read again, once.
 */
export function useEventCountdown(event: EventView): EventCountdown {
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
  return { group: eventGroup(event.state), deadline, left };
}
