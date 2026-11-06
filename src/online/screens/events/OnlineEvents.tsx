import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Info } from "lucide-react";
import type { EventView, EventsView, RewardView } from "../../api";
import { refreshEvents, useOnlineStore } from "../../store/onlineStore";
import { usePhoneLayout } from "../../../hooks/usePhoneLayout";
import ResourceState from "../ResourceState";
import EventPanel from "./EventPanel";
import { eventsOf } from "./missionState";
import PhoneEvents from "./phone/PhoneEvents";
import RewardDialog from "./RewardDialog";

/**
 * The coach's events (design su-kien.html; C-7d, C7-51): what runs and what still takes claims
 * open in full, each with its head, journey and missions; what starts within a week and what
 * closed lately folded below. Events belong to the person, so the page opens without a club.
 * Every state and number is the server's (C-7 C7-7). A phone folds each event into a card
 * instead (design m-su-kien.html).
 */
export default function OnlineEvents() {
  const { t } = useTranslation();
  const events = useOnlineStore((state) => state.events);
  const [loadError, setLoadError] = useState<unknown>(null);

  const load = useCallback(() => {
    setLoadError(null);
    refreshEvents().catch(setLoadError);
  }, []);
  useEffect(load, [load]);

  if (events === undefined) {
    return (
      <ResourceState
        resource={loadError ? { status: "failed", error: loadError } : { status: "loading" }}
        reload={load}
      >
        {() => null}
      </ResourceState>
    );
  }
  if (events === null) {
    return <Note text={t("online.events.notOnServer")} />;
  }
  if (!events.enabled) {
    return <Note text={t("online.events.disabled")} />;
  }
  if (events.events.length === 0) {
    return <Note text={t("online.events.empty")} />;
  }
  return <Events events={events} />;
}

function Events({ events }: { events: EventsView }) {
  const phone = usePhoneLayout();
  return phone ? <PhoneEvents events={events} /> : <DesktopEvents events={events} />;
}

function Note({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-2 rounded-md border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-200">
      <Info
        className="mt-0.5 h-4 w-4 shrink-0 text-primary-600 dark:text-primary-400"
        aria-hidden
      />
      {text}
    </p>
  );
}

function DesktopEvents({ events }: { events: EventsView }) {
  const [given, setGiven] = useState<RewardView[] | null>(null);
  const close = useCallback(() => setGiven(null), []);
  const open = [...eventsOf("running", events.events), ...eventsOf("ended", events.events)];
  return (
    // A container: the cards lay out by the room the page has beside the sidebar, not the window.
    <div className="@container flex flex-col gap-8">
      {open.map((event) => (
        // A new state is a new panel: its countdown may ask the server again, once.
        <EventPanel
          key={`${event.id}:${event.state}`}
          event={event}
          level={2}
          onClaimed={setGiven}
        />
      ))}
      {(["scheduled", "closed"] as const).map((group) => {
        const inGroup = eventsOf(group, events.events);
        if (inGroup.length === 0) return null;
        return <FoldedGroup key={group} group={group} events={inGroup} onClaimed={setGiven} />;
      })}
      {given && <RewardDialog rewards={given} onClose={close} />}
    </div>
  );
}

/** The events coming up and the closed ones: folded until the coach opens them. */
function FoldedGroup({
  group,
  events,
  onClaimed,
}: {
  group: "scheduled" | "closed";
  events: EventView[];
  onClaimed: (rewards: RewardView[]) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const heading = `online-events-${group}`;
  return (
    <section aria-labelledby={heading}>
      <h2 id={heading}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
          className="flex items-center gap-2 rounded font-heading text-lg font-bold uppercase tracking-wider text-gray-700 hover:text-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-gray-200 dark:hover:text-primary-400 dark:focus:ring-offset-navy-800"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform motion-reduce:transition-none ${open ? "" : "-rotate-90"}`}
            aria-hidden
          />
          {t(`online.events.group.${group}`)}
          <span className="text-gray-500 dark:text-gray-400">({events.length})</span>
        </button>
      </h2>
      {open && (
        <div className="mt-4 flex flex-col gap-8">
          {events.map((event) => (
            <EventPanel
              key={`${event.id}:${event.state}`}
              event={event}
              level={3}
              onClaimed={onClaimed}
            />
          ))}
        </div>
      )}
    </section>
  );
}
