import { type ReactElement, useCallback, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Gift } from "lucide-react";
import type { EventView, EventsView, RewardView } from "../../../api";
import { claimsWaiting } from "../../../store/onlineStore";
import { PhoneHeaderPart } from "../../mobile/PhoneHeaderSlots";
import { FOCUS } from "../../mobile/PhoneSheet";
import { eventsOf } from "../missionState";
import RewardDialog from "../RewardDialog";
import { useEventCountdown } from "../useEventCountdown";
import PhoneEventCard from "./PhoneEventCard";
import PhoneMissionSheet from "./PhoneMissionSheet";
import { firstOpen, shortCountdown } from "./phoneEventState";

/** The app bar's line under the page's name: the rewards waiting, else the events running. */
function AppBarLine({ events, running }: { events: EventsView; running: number }) {
  const { t } = useTranslation();
  const claims = claimsWaiting(events);
  if (claims === 0 && running === 0) return null;
  return (
    <PhoneHeaderPart place="sub">
      {claims > 0 ? (
        <span className="inline-flex items-center gap-1 font-semibold text-accent-800 dark:text-accent-300">
          <Gift className="h-3.5 w-3.5" aria-hidden />
          {t("online.events.phone.claimsWaiting", { n: claims })}
        </span>
      ) : (
        t("online.events.phone.running", { n: running })
      )}
    </PhoneHeaderPart>
  );
}

/** When the nearest coming event starts, beside its group's name. */
function NearestStart({ event }: { event: EventView }) {
  const { t } = useTranslation();
  const { left } = useEventCountdown(event);
  if (!left) return null;
  return (
    <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
      {t("online.events.phone.nearest", { countdown: shortCountdown(t, left) })}
    </span>
  );
}

/** The events coming up and the closed ones: folded until the coach opens them, then as cards. */
function FoldedGroup({
  group,
  events,
  card,
}: {
  group: "scheduled" | "closed";
  events: EventView[];
  card: (event: EventView) => ReactElement;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const heading = useId();
  return (
    <section aria-labelledby={heading} className="flex flex-col gap-2.5">
      <h2 id={heading}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
          className={`flex min-h-11 w-full items-center gap-2 rounded px-1 text-left text-gray-600 dark:text-gray-400 ${FOCUS}`}
        >
          <ChevronDown
            className={`h-5 w-5 shrink-0 text-gray-400 transition-transform motion-reduce:transition-none ${open ? "" : "-rotate-90"}`}
            aria-hidden
          />
          <span className="flex-1 font-heading text-base font-bold uppercase tracking-wider">
            {t(`online.events.group.${group}`)} ({events.length})
          </span>
          {group === "scheduled" && <NearestStart event={events[0]} />}
        </button>
      </h2>
      {open && <div className="flex flex-col gap-2.5">{events.map(card)}</div>}
    </section>
  );
}

/**
 * The coach's events on a phone (design m-su-kien.html; analysis-mobile-events.md): one folding
 * card an event, the one with a reward waiting (else the one ending soonest) open on arrival and
 * any number open at once; what starts soon and what closed lately in folded groups below. A
 * mission's detail rises in a sheet; a claim, from its row or its sheet, ends on the reward.
 */
export default function PhoneEvents({ events }: { events: EventsView }) {
  const running = eventsOf("running", events.events);
  const open = [...running, ...eventsOf("ended", events.events)];
  const [opened, setOpened] = useState<Record<string, boolean>>(() => {
    const first = firstOpen(open);
    return first ? { [first]: true } : {};
  });
  const [shown, setShown] = useState<{ eventId: string; code: string } | null>(null);
  const [given, setGiven] = useState<RewardView[] | null>(null);
  const closeReward = useCallback(() => setGiven(null), []);
  const closeSheet = useCallback(() => setShown(null), []);
  const claimedInSheet = useCallback((rewards: RewardView[]) => {
    setShown(null);
    setGiven(rewards);
  }, []);
  // The sheet reads the mission from the events the store holds now, so a claim elsewhere shows.
  const shownEvent = shown ? events.events.find((event) => event.id === shown.eventId) : undefined;
  const shownMission = shownEvent?.missions.find((mission) => mission.code === shown?.code);

  const card = (event: EventView) => (
    // A new state is a new card: its countdown may ask the server again, once.
    <PhoneEventCard
      key={`${event.id}:${event.state}`}
      event={event}
      open={Boolean(opened[event.id])}
      onToggle={() => setOpened((was) => ({ ...was, [event.id]: !was[event.id] }))}
      onShow={(code) => setShown({ eventId: event.id, code })}
      onClaimed={setGiven}
    />
  );
  return (
    <div className="flex flex-col gap-3">
      <AppBarLine events={events} running={running.length} />
      {open.map(card)}
      {(["scheduled", "closed"] as const).map((group) => {
        const inGroup = eventsOf(group, events.events);
        if (inGroup.length === 0) return null;
        return <FoldedGroup key={group} group={group} events={inGroup} card={card} />;
      })}
      {shownEvent && shownMission && (
        <PhoneMissionSheet
          event={shownEvent}
          mission={shownMission}
          onClose={closeSheet}
          onClaimed={claimedInSheet}
        />
      )}
      {given && <RewardDialog rewards={given} onClose={closeReward} />}
    </div>
  );
}
