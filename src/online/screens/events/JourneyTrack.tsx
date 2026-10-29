import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { EventView, MissionView } from "../../api";
import { isCounted, isSeasonEnd, rewardText } from "./eventText";
import { isMet, journeyCounts, type MissionPhase, missionPhase } from "./missionState";
import { rewardIcon } from "./RewardIcon";

const NODE: Record<"claimed" | "ready" | "other", string> = {
  claimed:
    "border-primary-500 bg-primary-50 text-primary-700 dark:border-success-400 dark:bg-primary-900/40 dark:text-success-400",
  ready:
    "border-accent-500 bg-accent-100 text-accent-800 motion-safe:animate-claim-pulse dark:border-accent-400 dark:bg-accent-900/40 dark:text-accent-400",
  other:
    "border-gray-300 bg-white text-gray-400 dark:border-navy-600 dark:bg-navy-800 dark:text-gray-500",
};

function nodeTone(phase: MissionPhase): keyof typeof NODE {
  if (phase === "claimed") return "claimed";
  return phase === "ready" ? "ready" : "other";
}

/** Under a node: where its mission stands, in a few words. */
function nodeState(t: TFunction, phase: MissionPhase, mission: MissionView): string {
  if (phase === "claimed") return t("online.events.claimed");
  if (phase === "ready") return t("online.events.journey.ready");
  if (phase === "lapsed") return t("online.events.status.lapsed");
  if (phase === "autoClaiming") return t("online.events.autoClaiming");
  if (phase === "upcoming") return t("online.events.status.upcoming");
  if (isSeasonEnd(mission.kind)) return t("online.events.notMet");
  if (isCounted(mission.kind) && mission.target > 0) {
    return `${Math.min(mission.progress, mission.target)}/${mission.target}`;
  }
  return t(`online.events.status.${phase}`);
}

/**
 * The event's journey (design su-kien.html): one node a mission, in the server's order, each with
 * its first reward, joined by a line that turns green between two met missions.
 */
export default function JourneyTrack({ event }: { event: EventView }) {
  const { t, i18n } = useTranslation();
  const counts = journeyCounts(event);
  return (
    <div className="border-t border-gray-200 bg-gray-50 px-4 py-5 @2xl:px-8 dark:border-navy-600 dark:bg-navy-900/60">
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
        <span className="font-heading text-base font-bold uppercase tracking-wider text-gray-900 dark:text-white">
          {t("online.events.journey.title")}{" "}
          <span className="font-semibold text-gray-500 dark:text-gray-400">
            · {t("online.events.journey.met", { met: counts.met, total: counts.total })}
          </span>
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {t("online.events.journey.counts", { claimed: counts.claimed, ready: counts.ready })}
        </span>
      </div>
      <ol aria-label={t("online.events.journey.title")} className="flex">
        {event.missions.map((mission, index) => {
          const phase = missionPhase(event, mission);
          const Icon = rewardIcon(mission.rewards[0]);
          const joined = index > 0 && isMet(mission) && isMet(event.missions[index - 1]);
          return (
            <li
              key={mission.code}
              className="relative flex min-w-0 flex-1 basis-0 flex-col items-center gap-2 text-center"
            >
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className={`absolute right-1/2 top-6.5 h-1 w-full rounded-full ${
                    joined ? "bg-primary-500" : "bg-gray-200 dark:bg-navy-600"
                  }`}
                />
              )}
              <span
                className={`relative z-10 flex h-14.5 w-14.5 items-center justify-center rounded-full border-3 ${NODE[nodeTone(phase)]}`}
              >
                <Icon className="h-6.5 w-6.5" aria-hidden="true" />
              </span>
              <span
                className={`text-xs font-semibold ${
                  phase === "active" || phase === "upcoming"
                    ? "text-gray-600 dark:text-gray-400"
                    : "text-gray-900 dark:text-white"
                }`}
              >
                {mission.rewards[0] ? rewardText(t, i18n.language, mission.rewards[0]) : ""}
              </span>
              <span className="text-[11px] text-gray-500 dark:text-gray-400">
                {nodeState(t, phase, mission)}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
