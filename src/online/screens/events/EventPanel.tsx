import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Trophy } from "lucide-react";
import type { EventView, RewardView } from "../../api";
import { CardBadge } from "../overview/OverviewCard";
import EventTimer from "./EventTimer";
import { isDirected, themeName, themeTagline } from "./eventText";
import JourneyTrack from "./JourneyTrack";
import MissionCard, { Heading } from "./MissionCard";
import { type EventGroup, eventGroup, missionsInOrder } from "./missionState";

const STATE_TONE: Record<EventGroup, "green" | "gold" | "plain"> = {
  running: "green",
  ended: "gold",
  scheduled: "plain",
  closed: "plain",
};

function StateBadge({ group }: { group: EventGroup }) {
  const { t } = useTranslation();
  return (
    <span className="self-start">
      <CardBadge tone={STATE_TONE[group]}>
        <span className="inline-flex items-center gap-1.5">
          {group === "running" && (
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full bg-primary-500 dark:bg-primary-400"
            />
          )}
          {t(`online.events.state.${group}`)}
        </span>
      </CardBadge>
    </span>
  );
}

/**
 * One event (design su-kien.html): a gold-topped head with its name, its state and the time left,
 * the journey of its missions once it has started, then its mission cards, the claims waiting
 * first. `level` is its name's heading level: 2 on its own, 3 inside a folded group.
 */
export default function EventPanel({
  event,
  level,
  onClaimed,
}: {
  event: EventView;
  level: 2 | 3;
  onClaimed: (rewards: RewardView[]) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const missionsId = useId();
  const group = eventGroup(event.state);
  const directed = event.missions.some((mission) => isDirected(mission.kind));
  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-4">
      <div className="relative overflow-hidden rounded-2xl border border-t-4 border-gray-200 border-t-accent-400 bg-white shadow-lg dark:border-navy-600 dark:border-t-accent-400 dark:bg-navy-800">
        <Trophy
          aria-hidden="true"
          strokeWidth={0.6}
          className="pointer-events-none absolute -right-8 -top-12 h-85 w-85 text-accent-400 opacity-10"
        />
        <div className="relative flex flex-wrap items-end justify-between gap-6 px-5 pb-6 pt-7 sm:px-8">
          <div className="flex min-w-0 flex-col gap-2">
            <StateBadge group={group} />
            <Heading
              level={level}
              id={titleId}
              className="font-heading text-4xl font-bold uppercase leading-none tracking-wider text-gray-900 sm:text-5xl dark:text-white"
            >
              {themeName(t, event.theme)}
            </Heading>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {themeTagline(t, event.theme)}
            </p>
          </div>
          <EventTimer event={event} />
        </div>
        {group !== "scheduled" && event.missions.length > 0 && <JourneyTrack event={event} />}
      </div>
      {event.missions.length > 0 && (
        <section aria-labelledby={missionsId} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <Heading
              level={level === 2 ? 3 : 4}
              id={missionsId}
              className="font-heading text-lg font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100"
            >
              {t("online.events.missions")}
            </Heading>
            {directed && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {t("online.events.hint.directed")}
              </span>
            )}
          </div>
          <ul className="flex flex-col gap-3">
            {missionsInOrder(event).map((mission) => (
              <MissionCard
                key={mission.code}
                event={event}
                mission={mission}
                level={level === 2 ? 4 : 5}
                onClaimed={onClaimed}
              />
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
