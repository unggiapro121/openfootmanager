import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, Hourglass, X } from "lucide-react";
import type { EventView, MissionView, RewardView } from "../../../api";
import { FOCUS } from "../../mobile/PhoneSheet";
import { missionText } from "../eventText";
import type { MissionPhase } from "../missionState";
import { rewardIcon } from "../RewardIcon";
import { useMissionClaim } from "../useMissionClaim";
import { firstRewardText, isDone, percentOf, progressText, showsBar } from "./phoneEventState";

function tileTone(phase: MissionPhase): string {
  if (phase === "ready") {
    return "border-accent-500 bg-accent-100 text-accent-800 dark:border-accent-400 dark:bg-accent-900/40 dark:text-accent-300";
  }
  if (isDone(phase)) {
    return "border-gray-200 bg-gray-50 text-gray-500 dark:border-navy-600 dark:bg-navy-900 dark:text-gray-400";
  }
  return "border-gray-200 bg-white text-accent-700 dark:border-navy-600 dark:bg-navy-900 dark:text-accent-300";
}

function progressTone(phase: MissionPhase): string {
  if (phase === "ready") return "text-accent-800 dark:text-accent-300";
  if (phase === "missed" || phase === "lapsed") return "text-red-600 dark:text-red-400";
  if (phase === "claimed") return "text-primary-700 dark:text-primary-400";
  return "text-gray-700 dark:text-gray-200";
}

function rowFade(phase: MissionPhase): string {
  if (isDone(phase)) return "opacity-65";
  return phase === "upcoming" ? "opacity-80" : "";
}

/** The row's right end: a way into the detail while under way, how it ended once over. */
function Trailing({ phase }: { phase: MissionPhase }) {
  if (phase === "ready") return null;
  if (!isDone(phase)) {
    return (
      <ChevronRight className="h-4.5 w-4.5 shrink-0 text-gray-400 dark:text-gray-600" aria-hidden />
    );
  }
  const [Icon, tone] =
    phase === "claimed"
      ? [Check, "bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-400"]
      : phase === "autoClaiming"
        ? [Hourglass, "bg-accent-100 text-accent-800 dark:bg-accent-900/40 dark:text-accent-300"]
        : [X, "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"];
  return (
    <span
      aria-hidden="true"
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${tone}`}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={3} />
    </span>
  );
}

/** The row's own claim (C-7 C7-54), beside the part that opens the detail. */
function RowClaim({
  event,
  mission,
  onClaimed,
  onError,
}: {
  event: EventView;
  mission: MissionView;
  onClaimed: (rewards: RewardView[]) => void;
  onError: (text: string | null) => void;
}) {
  const { t } = useTranslation();
  const { claim, busy } = useMissionClaim({ event, mission, onClaimed, onError });
  return (
    <button
      type="button"
      onClick={() => void claim()}
      disabled={busy}
      aria-label={t("online.events.claimAria", { mission: missionText(t, mission) })}
      className={`mr-3 ml-1 h-11 min-w-16 shrink-0 rounded-[10px] bg-accent-400 px-3 font-heading text-base font-bold uppercase tracking-wider text-navy-900 hover:bg-accent-500 active:scale-97 disabled:cursor-not-allowed disabled:opacity-50 motion-safe:animate-claim-pulse ${FOCUS}`}
    >
      {t("online.events.phone.claim")}
    </button>
  );
}

/**
 * One mission of a phone's event card (design m-su-kien.html): its first reward's icon, its
 * sentence, a thin bar with the progress and the reward; a tap opens its detail. A mission
 * waiting has its claim beside it, apart from the part that opens the detail.
 */
export default function PhoneMissionRow({
  event,
  mission,
  phase,
  onShow,
  onClaimed,
}: {
  event: EventView;
  mission: MissionView;
  phase: MissionPhase;
  onShow: () => void;
  onClaimed: (rewards: RewardView[]) => void;
}) {
  const { t, i18n } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const Icon = rewardIcon(mission.rewards[0]);
  const sentence = missionText(t, mission);
  const progress = progressText(t, mission, phase);
  const reward = firstRewardText(t, i18n.language, mission);
  const done = isDone(phase);
  return (
    <li className={`border-t border-gray-200 dark:border-navy-600 ${rowFade(phase)}`}>
      <div className="flex items-center">
        <button
          type="button"
          onClick={onShow}
          aria-label={t("online.events.phone.rowAria", {
            mission: sentence,
            state: progress,
            reward,
          })}
          className={`flex min-h-17 min-w-0 flex-1 items-center gap-2.5 py-2.5 pr-1.5 pl-3 text-left ${FOCUS}`}
        >
          <span
            aria-hidden="true"
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border ${tileTone(phase)}`}
          >
            <Icon className="h-5 w-5" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1.25">
            <span
              className={`line-clamp-2 text-sm font-semibold leading-snug ${
                done ? "text-gray-500 dark:text-gray-400" : "text-gray-900 dark:text-white"
              }`}
            >
              {sentence}
            </span>
            <span className="flex min-w-0 items-center gap-2 text-xs">
              {showsBar(mission, phase) && (
                <span
                  aria-hidden="true"
                  className="h-1 w-11 shrink-0 overflow-hidden rounded-full bg-gray-200 dark:bg-navy-600"
                >
                  <span
                    className={`block h-full ${phase === "ready" ? "bg-accent-400" : "bg-primary-500"}`}
                    style={{ width: `${percentOf(mission)}%` }}
                  />
                </span>
              )}
              <span className={`shrink-0 font-semibold tabular-nums ${progressTone(phase)}`}>
                {progress}
              </span>
              {reward && (
                <span
                  className={`min-w-0 truncate ${
                    phase === "ready"
                      ? "text-accent-800 dark:text-accent-300"
                      : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  · {reward}
                </span>
              )}
            </span>
          </span>
          <Trailing phase={phase} />
        </button>
        {phase === "ready" && (
          <RowClaim event={event} mission={mission} onClaimed={onClaimed} onError={setError} />
        )}
      </div>
      {error && (
        <p role="alert" className="px-3 pb-2.5 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </li>
  );
}
