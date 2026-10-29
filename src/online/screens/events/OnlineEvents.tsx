import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Info } from "lucide-react";
import { Card, CardBody } from "../../../components/ui";
import type { EventView, EventsView } from "../../api";
import { formatMoment } from "../../format";
import { refreshEvents, useOnlineStore } from "../../store/onlineStore";
import ResourceState from "../ResourceState";
import { useCountdownText } from "../useCountdownText";
import { themeName } from "./eventText";
import MissionRow from "./MissionRow";

/** The page's groups, in the order shown (C-7 C7-51); a state this build does not know is `closed`. */
const GROUPS = ["running", "ended", "scheduled", "closed"] as const;
type Group = (typeof GROUPS)[number];

/** Groups open when the page opens: the ones a coach acts in. */
const OPEN_AT_FIRST: Record<Group, boolean> = {
  running: true,
  ended: true,
  scheduled: false,
  closed: false,
};

function groupOf(state: string): Group {
  return state === "running" || state === "ended" || state === "scheduled" ? state : "closed";
}

const at = (iso: string): number => Date.parse(iso) || 0;

/** Each group's order: what ends or starts soonest first; the closed ones, the latest first. */
function sorted(group: Group, events: EventView[]): EventView[] {
  const copy = [...events];
  if (group === "running") return copy.sort((a, b) => at(a.endsAt) - at(b.endsAt));
  if (group === "ended") return copy.sort((a, b) => at(a.claimUntil) - at(b.claimUntil));
  if (group === "scheduled") return copy.sort((a, b) => at(a.startsAt) - at(b.startsAt));
  return copy.sort((a, b) => at(b.claimUntil) - at(a.claimUntil));
}

const ignore = () => undefined;

/**
 * The coach's events (C-7d, C7-51): what runs, what still takes claims, what starts within a week
 * and what closed lately, each mission with his progress and its claim. Events belong to the
 * person, so the page opens without a club. Every state and number is the server's (C-7 C7-7).
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
  return <Groups events={events} />;
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

function Groups({ events }: { events: EventsView }) {
  return (
    <div className="flex flex-col gap-6">
      {GROUPS.map((group) => {
        const inGroup = events.events.filter((event) => groupOf(event.state) === group);
        if (inGroup.length === 0) return null;
        return <EventGroup key={group} group={group} events={sorted(group, inGroup)} />;
      })}
    </div>
  );
}

function EventGroup({ group, events }: { group: Group; events: EventView[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(OPEN_AT_FIRST[group]);
  const heading = `online-events-${group}`;
  return (
    <section aria-labelledby={heading}>
      <h2 id={heading}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
          className="flex items-center gap-2 rounded font-heading text-sm font-semibold uppercase tracking-wider text-gray-700 hover:text-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-gray-200 dark:hover:text-primary-400 dark:focus:ring-offset-navy-800"
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
        <div className="mt-3 flex flex-col gap-4">
          {events.map((event) => (
            // A new state is a new card: its countdown may ask the server again, once.
            <EventCard key={`${event.id}:${event.state}`} event={event} />
          ))}
        </div>
      )}
    </section>
  );
}

/** The moment an event's line counts down to, by its state; none once it is closed. */
function deadlineOf(event: EventView): string | undefined {
  if (event.state === "running") return event.endsAt;
  if (event.state === "ended") return event.claimUntil;
  if (event.state === "scheduled") return event.startsAt;
  return undefined;
}

function EventCard({ event }: { event: EventView }) {
  const { t } = useTranslation();
  const name = themeName(t, event.theme);
  return (
    <article aria-label={name}>
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-heading text-lg font-bold uppercase tracking-wider text-gray-900 dark:text-white">
              {name}
            </h3>
            <TimeLine event={event} />
          </div>
          <ul className="mt-3 flex flex-col divide-y divide-gray-100 dark:divide-navy-600">
            {event.missions.map((mission) => (
              <MissionRow key={mission.code} event={event} mission={mission} />
            ))}
          </ul>
        </CardBody>
      </Card>
    </article>
  );
}

/**
 * When the event ends, its claims close or it starts, on this machine's clock (C-7 C7-51: events
 * last days, so a few seconds off does not show). At zero the server's state has changed, so the
 * events are read again, once.
 */
function TimeLine({ event }: { event: EventView }) {
  const { t, i18n } = useTranslation();
  const deadline = deadlineOf(event);
  const left = useCountdownText(deadline);
  const asked = useRef(false);
  useEffect(() => {
    if (deadline && left === null && !asked.current) {
      asked.current = true;
      void refreshEvents().catch(ignore);
    }
  }, [deadline, left]);

  const countdown = left ?? "0";
  const text =
    event.state === "running"
      ? t("online.events.time.running", { countdown })
      : event.state === "ended"
        ? t("online.events.time.ended", {
            moment: formatMoment(event.claimUntil, i18n.language),
            countdown,
          })
        : event.state === "scheduled"
          ? t("online.events.time.scheduled", { countdown })
          : t("online.events.time.closed");
  return (
    <p
      className="text-sm tabular-nums text-gray-600 dark:text-gray-300"
      title={deadline ? formatMoment(deadline, i18n.language) : undefined}
    >
      {text}
    </p>
  );
}
