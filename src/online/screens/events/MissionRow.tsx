import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Circle, Coins, Hourglass, XCircle } from "lucide-react";
import { Button, ProgressBar } from "../../../components/ui";
import type { EventView, MissionView, RewardView } from "../../api";
import { online } from "../../client";
import { OnlineApiError } from "../../errors";
import { refreshCoins, refreshEvents, refreshItems, tracked } from "../../store/onlineStore";
import { lookOf } from "../items/itemLook";
import { useActionKey } from "../useActionKey";
import {
  claimErrorText,
  isCounted,
  isSeasonEnd,
  lapsedReasonText,
  levelsText,
  missionHint,
  missionText,
  rewardText,
} from "./eventText";

/** How long "Claimed: …" stays under a mission (C-7 C7-54). */
export const CLAIMED_MILLIS = 8000;

const ALREADY_CLAIMED = "be.error.events.alreadyClaimed";
/** Codes after which the mission may have moved on the server: the events are read again. */
const READ_AGAIN = new Set([
  "be.error.events.notCompleted",
  "be.error.events.notFound",
  "be.error.events.disabled",
  "be.error.events.closed",
]);

const ignore = () => undefined;

/** Under a mission: what a claim just gave, or why it did not. */
type Said = { tone: "claimed" | "error"; text: string };

/**
 * One mission of an event (C-7 C7-52…C7-54): its sentence and what counts, the coach's progress,
 * its rewards, and by its status the claim, the tick, or why the reward lapsed.
 */
export default function MissionRow({ event, mission }: { event: EventView; mission: MissionView }) {
  const { t } = useTranslation();
  const hint = missionHint(t, mission.kind);
  const levels = levelsText(t, mission.levels);
  const [said, setSaid] = useState<Said | null>(null);
  useEffect(() => {
    if (said?.tone !== "claimed") return undefined;
    const timer = window.setTimeout(() => setSaid(null), CLAIMED_MILLIS);
    return () => window.clearTimeout(timer);
  }, [said]);

  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-900 dark:text-white">{missionText(t, mission)}</p>
          {hint && <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
          {levels && <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{levels}</p>}
        </div>
        <Status event={event} mission={mission} onSaid={setSaid} />
      </div>
      {event.state !== "scheduled" && <Progress mission={mission} />}
      <Rewards rewards={mission.rewards} />
      {said && (
        <p
          role={said.tone === "error" ? "alert" : "status"}
          className={`text-sm ${
            said.tone === "error"
              ? "text-red-600 dark:text-red-400"
              : "text-primary-700 dark:text-primary-400"
          }`}
        >
          {said.text}
        </p>
      )}
    </li>
  );
}

/**
 * The counted missions' bar of progress over target; the season-end ones met or not, read from
 * the status alone: `seasonFinishTop`'s target is a rank, not a count (C-7 C7-53).
 */
function Progress({ mission }: { mission: MissionView }) {
  const { t } = useTranslation();
  if (isSeasonEnd(mission.kind)) {
    const met = ["completed", "claimed", "lapsed"].includes(mission.status);
    return (
      <p className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-200">
        {met ? (
          <CheckCircle2 className="h-4 w-4 text-primary-600 dark:text-primary-400" aria-hidden />
        ) : (
          <Circle className="h-4 w-4 text-gray-400 dark:text-gray-500" aria-hidden />
        )}
        {t(met ? "online.events.met" : "online.events.notMet")}
      </p>
    );
  }
  if (!isCounted(mission.kind) || mission.target <= 0) return null;
  const done = Math.min(mission.progress, mission.target);
  return (
    <div className="flex items-center gap-3">
      <ProgressBar
        value={(done / mission.target) * 100}
        variant="primary"
        size="md"
        className="flex-1"
      />
      <span className="text-sm font-semibold tabular-nums text-gray-700 dark:text-gray-200">
        {done}/{mission.target}
      </span>
    </div>
  );
}

function Rewards({ rewards }: { rewards: RewardView[] }) {
  const { t, i18n } = useTranslation();
  if (rewards.length === 0) return null;
  return (
    <ul aria-label={t("online.events.rewards")} className="flex flex-wrap gap-2">
      {rewards.map((reward, index) => {
        const Icon = reward.coin !== undefined ? Coins : lookOf(reward.item ?? "").icon;
        return (
          // A mission's rewards have no id and may repeat an item: their place keeps them apart.
          <li
            key={`${reward.item ?? "coin"}-${index}`}
            className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-800 dark:bg-navy-600 dark:text-gray-100"
          >
            <Icon
              className={`h-3.5 w-3.5 ${
                reward.coin !== undefined
                  ? "text-accent-600 dark:text-accent-400"
                  : "text-primary-600 dark:text-primary-400"
              }`}
              aria-hidden
            />
            {rewardText(t, i18n.language, reward)}
            {reward.expiresInDays !== undefined && (
              <span className="font-normal text-gray-500 dark:text-gray-400">
                · {t("online.events.expires", { days: reward.expiresInDays })}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The mission's status, as its own control or mark (C-7 C7-53). */
function Status({
  event,
  mission,
  onSaid,
}: {
  event: EventView;
  mission: MissionView;
  onSaid: (said: Said | null) => void;
}) {
  const { t } = useTranslation();
  if (mission.status === "completed") {
    if (event.state === "running" || event.state === "ended") {
      return <ClaimButton event={event} mission={mission} onSaid={onSaid} />;
    }
    if (event.state === "closed") {
      return (
        <Mark icon={<Hourglass className="h-4 w-4" aria-hidden />}>
          {t("online.events.autoClaiming")}
        </Mark>
      );
    }
    return null;
  }
  if (mission.status === "claimed") {
    return (
      <Mark
        icon={
          <CheckCircle2 className="h-4 w-4 text-primary-600 dark:text-primary-400" aria-hidden />
        }
      >
        {t("online.events.claimed")}
      </Mark>
    );
  }
  if (mission.status === "lapsed") {
    return (
      <Mark icon={<XCircle className="h-4 w-4 text-red-600 dark:text-red-400" aria-hidden />}>
        {mission.lapsedReason
          ? t("online.events.lapsed", { reason: lapsedReasonText(t, mission.lapsedReason) })
          : t("online.events.lapsedUnknown")}
      </Mark>
    );
  }
  return null;
}

function Mark({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="flex max-w-xs items-start gap-1.5 text-sm text-gray-700 dark:text-gray-200">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{children}</span>
    </p>
  );
}

/**
 * The claim (C-7 C7-54): no confirmation, as it spends nothing; one key a mission, kept over a
 * request that got no answer. After it the events are read again, and the items and coins it gave,
 * since giving an item rings nothing (C-7 §19.1).
 */
function ClaimButton({
  event,
  mission,
  onSaid,
}: {
  event: EventView;
  mission: MissionView;
  onSaid: (said: Said | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const { run } = useActionKey();
  const [busy, setBusy] = useState(false);
  const label = missionText(t, mission);

  const claim = async () => {
    setBusy(true);
    onSaid(null);
    try {
      const given = await run((key) =>
        tracked(() => online.events.claim(event.id, mission.code, key)),
      );
      const rewards = given.rewards.map((reward) => rewardText(t, i18n.language, reward));
      onSaid({
        tone: "claimed",
        text: t("online.events.justClaimed", { rewards: rewards.join(", ") }),
      });
      if (given.rewards.some((reward) => reward.item !== undefined)) {
        void refreshItems().catch(ignore);
      }
      if (given.rewards.some((reward) => reward.coin !== undefined)) {
        void refreshCoins().catch(ignore);
      }
      void refreshEvents().catch(ignore);
    } catch (error) {
      const code = error instanceof OnlineApiError ? error.code : "";
      // Another device claimed it: the page catches up, with nothing to say.
      if (code !== ALREADY_CLAIMED)
        onSaid({ tone: "error", text: claimErrorText(t, i18n.language, error) });
      if (code === ALREADY_CLAIMED || READ_AGAIN.has(code)) void refreshEvents().catch(ignore);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      size="sm"
      onClick={() => void claim()}
      disabled={busy}
      aria-label={t("online.events.claimAria", { mission: label })}
    >
      {t(busy ? "online.events.claiming" : "online.events.claim")}
    </Button>
  );
}
