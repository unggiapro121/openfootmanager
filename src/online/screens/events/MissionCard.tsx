import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowRight, Check, CheckCircle2, Circle, Gift, Hourglass, XCircle } from "lucide-react";
import type { EventView, MissionView, RewardView } from "../../api";
import { online } from "../../client";
import { OnlineApiError } from "../../errors";
import {
  refreshCoins,
  refreshEvents,
  refreshItems,
  tracked,
  useOnlineStore,
} from "../../store/onlineStore";
import { CardBadge } from "../overview/OverviewCard";
import { useActionKey } from "../useActionKey";
import {
  claimErrorText,
  isCounted,
  isDirected,
  isSeasonEnd,
  lapsedReasonText,
  levelsText,
  missionHint,
  missionText,
  rewardText,
} from "./eventText";
import { isMet, type MissionPhase, missionLeft, missionPhase } from "./missionState";
import { rewardIcon } from "./RewardIcon";

const ALREADY_CLAIMED = "be.error.events.alreadyClaimed";
/** Codes after which the mission may have moved on the server: the events are read again. */
const READ_AGAIN = new Set([
  "be.error.events.notCompleted",
  "be.error.events.notFound",
  "be.error.events.disabled",
  "be.error.events.closed",
]);

const ignore = () => undefined;

export type HeadingLevel = 2 | 3 | 4 | 5;

/** A heading at the level its place on the page gives it. */
export function Heading({
  level,
  id,
  className,
  children,
}: {
  level: HeadingLevel;
  id?: string;
  className: string;
  children: ReactNode;
}) {
  const Tag = `h${level}` as const;
  return (
    <Tag id={id} className={className}>
      {children}
    </Tag>
  );
}

const DONE: MissionPhase[] = ["claimed", "lapsed", "missed"];

const BADGE: Record<MissionPhase, { tone: "green" | "gold" | "red" | "plain"; key: string }> = {
  ready: { tone: "gold", key: "online.events.status.ready" },
  autoClaiming: { tone: "gold", key: "online.events.status.ready" },
  active: { tone: "green", key: "online.events.status.active" },
  upcoming: { tone: "plain", key: "online.events.status.upcoming" },
  claimed: { tone: "plain", key: "online.events.claimed" },
  lapsed: { tone: "red", key: "online.events.status.lapsed" },
  missed: { tone: "plain", key: "online.events.status.missed" },
};

function cardTone(phase: MissionPhase): string {
  if (phase === "ready") {
    return "border-accent-500 bg-accent-50 shadow-lg ring-1 ring-accent-400/30 dark:border-accent-400 dark:bg-navy-700";
  }
  const faded = DONE.includes(phase) ? "opacity-70" : "shadow-md";
  return `border-gray-200 bg-white dark:border-navy-600 dark:bg-navy-700 ${faded}`;
}

function tileTone(phase: MissionPhase): string {
  if (phase === "ready") {
    return "border-accent-500 bg-accent-100 text-accent-800 dark:border-accent-400 dark:bg-accent-900/40 dark:text-accent-300";
  }
  if (phase === "claimed") {
    return "border-gray-200 bg-gray-50 text-gray-500 dark:border-navy-600 dark:bg-navy-800 dark:text-gray-400";
  }
  return "border-gray-200 bg-gray-50 text-accent-700 dark:border-navy-600 dark:bg-navy-900 dark:text-accent-300";
}

/** The bar's fill by phase: green under way, gold once met, dim once over (design su-kien.html). */
function barFill(phase: MissionPhase): string {
  if (phase === "ready" || phase === "autoClaiming") return "bg-accent-400";
  return DONE.includes(phase) ? "bg-gray-400 dark:bg-gray-600" : "bg-primary-500";
}

/** The square on the card's left: the first reward, and how many more come with it. */
function RewardTile({ mission, phase }: { mission: MissionView; phase: MissionPhase }) {
  const { t, i18n } = useTranslation();
  const [first, ...more] = mission.rewards;
  const Icon = rewardIcon(first);
  return (
    <span
      className={`relative flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border @lg:h-24 @lg:w-24 ${tileTone(phase)}`}
    >
      <Icon className="h-7 w-7 @lg:h-8.5 @lg:w-8.5" aria-hidden="true" />
      {first && (
        <span className="px-1.5 text-center font-heading text-sm font-bold leading-tight tracking-wide">
          {rewardText(t, i18n.language, first)}
          {more.length > 0 && ` +${more.length}`}
        </span>
      )}
      {phase === "claimed" && (
        <span
          aria-hidden="true"
          className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-success-400 text-navy-900 dark:border-navy-800"
        >
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
      )}
    </span>
  );
}

/**
 * The counted missions' bar of progress over target; the season-end ones met or not, read from
 * the status alone: `seasonFinishTop`'s target is a rank, not a count (C-7 C7-53).
 */
function Progress({ mission, phase }: { mission: MissionView; phase: MissionPhase }) {
  const { t } = useTranslation();
  if (phase === "upcoming") return null;
  if (isSeasonEnd(mission.kind)) {
    const met = isMet(mission);
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
      <div
        role="progressbar"
        aria-label={t("online.events.progress")}
        aria-valuemin={0}
        aria-valuemax={mission.target}
        aria-valuenow={done}
        className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-navy-600"
      >
        <div
          className={`h-full rounded-full ${barFill(phase)}`}
          style={{ width: `${(done / mission.target) * 100}%` }}
        />
      </div>
      <span className="font-heading text-lg font-bold tabular-nums text-gray-900 dark:text-white">
        {done}
        <span className="text-gray-500 dark:text-gray-400">/{mission.target}</span>
      </span>
    </div>
  );
}

/** The rewards in words, their expiry, the levels counted and, for the long ones, the conditions. */
function RewardsLine({ mission, phase }: { mission: MissionView; phase: MissionPhase }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const expires = mission.rewards.find((reward) => reward.expiresInDays !== undefined);
  const levels = levelsText(t, mission.levels);
  // The directed missions' condition is the section's, said once above the cards.
  const detail = isDirected(mission.kind) ? undefined : missionHint(t, mission.kind);
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
        {mission.rewards.length > 0 && (
          <span>
            {t("online.events.rewardsLabel")}{" "}
            <strong
              className={
                phase === "claimed"
                  ? "text-gray-600 dark:text-gray-400"
                  : "text-accent-800 dark:text-accent-300"
              }
            >
              {mission.rewards.map((reward) => rewardText(t, i18n.language, reward)).join(", ")}
            </strong>
          </span>
        )}
        {expires?.expiresInDays !== undefined && (
          <span>· {t("online.events.expires", { days: expires.expiresInDays })}</span>
        )}
        {levels && <span>· {levels}</span>}
        {detail && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={() => setOpen((was) => !was)}
            className="rounded font-semibold text-primary-700 hover:text-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-primary-400 dark:hover:text-primary-300 dark:focus:ring-offset-navy-800"
          >
            {t(open ? "online.events.detail.hide" : "online.events.detail.show")}
          </button>
        )}
      </div>
      {detail && open && (
        <p
          id={detailId}
          className="rounded-lg bg-gray-50 px-3 py-2.5 text-sm leading-relaxed text-gray-700 dark:bg-navy-900 dark:text-gray-300"
        >
          {detail}
        </p>
      )}
    </>
  );
}

function Mark({ icon, tone, children }: { icon: ReactNode; tone: string; children: ReactNode }) {
  return (
    <p className={`flex max-w-xs items-start gap-1.5 text-sm font-semibold ${tone}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{children}</span>
    </p>
  );
}

const GO_LINK =
  "inline-flex h-11 items-center gap-2 rounded-lg border border-gray-300 px-4 font-heading text-base font-bold uppercase tracking-wider text-gray-800 hover:border-primary-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:border-navy-600 dark:text-gray-100 dark:hover:border-primary-500 dark:hover:bg-navy-600 dark:focus:ring-offset-navy-800";

/** The card's right column, by the mission's phase: the claim, the way to progress, or a mark. */
function Action({
  event,
  mission,
  phase,
  onClaimed,
  onError,
}: {
  event: EventView;
  mission: MissionView;
  phase: MissionPhase;
  onClaimed: (rewards: RewardView[]) => void;
  onError: (text: string | null) => void;
}) {
  const { t } = useTranslation();
  const hasClub = useOnlineStore((state) => Boolean(state.club));
  if (phase === "ready") {
    return <ClaimButton event={event} mission={mission} onClaimed={onClaimed} onError={onError} />;
  }
  if (phase === "active") {
    const left = missionLeft(mission);
    return (
      <>
        {isDirected(mission.kind) && hasClub && (
          <Link to="/online/schedule" className={GO_LINK}>
            {t("online.events.goSchedule")}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        )}
        {left !== undefined && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t(`online.events.left.${mission.kind}`, { left })}
          </span>
        )}
      </>
    );
  }
  if (phase === "claimed") {
    return (
      <Mark
        tone="text-primary-700 dark:text-success-400"
        icon={<CheckCircle2 className="h-4.5 w-4.5" aria-hidden />}
      >
        {t("online.events.claimed")}
      </Mark>
    );
  }
  if (phase === "autoClaiming") {
    return (
      <Mark
        tone="text-gray-700 dark:text-gray-200"
        icon={<Hourglass className="h-4 w-4" aria-hidden />}
      >
        {t("online.events.autoClaiming")}
      </Mark>
    );
  }
  if (phase === "lapsed") {
    return (
      <Mark
        tone="text-red-700 dark:text-red-400"
        icon={<XCircle className="h-4 w-4" aria-hidden />}
      >
        {mission.lapsedReason
          ? t("online.events.lapsed", { reason: lapsedReasonText(t, mission.lapsedReason) })
          : t("online.events.lapsedUnknown")}
      </Mark>
    );
  }
  return null;
}

/**
 * The claim (C-7 C7-54): no confirmation, as it spends nothing; one key a mission, kept over a
 * request that got no answer. After it the events are read again, and the items and coins it gave,
 * since giving an item rings nothing (C-7 §19.1).
 */
function ClaimButton({
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
  const { t, i18n } = useTranslation();
  const { run } = useActionKey();
  const [busy, setBusy] = useState(false);

  const claim = async () => {
    setBusy(true);
    onError(null);
    try {
      const given = await run((key) =>
        tracked(() => online.events.claim(event.id, mission.code, key)),
      );
      onClaimed(given.rewards);
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
      if (code !== ALREADY_CLAIMED) onError(claimErrorText(t, i18n.language, error));
      if (code === ALREADY_CLAIMED || READ_AGAIN.has(code)) void refreshEvents().catch(ignore);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void claim()}
      disabled={busy}
      aria-label={t("online.events.claimAria", { mission: missionText(t, mission) })}
      className="inline-flex h-12 items-center gap-2 rounded-lg bg-accent-400 px-5.5 font-heading text-lg font-bold uppercase tracking-wider text-navy-900 hover:bg-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-safe:animate-claim-pulse dark:focus:ring-offset-navy-800"
    >
      <Gift className="h-4.5 w-4.5" aria-hidden />
      {t(busy ? "online.events.claiming" : "online.events.claim")}
    </button>
  );
}

/**
 * One mission of an event (design su-kien.html; C-7 C7-52…C7-54): its first reward as a tile, its
 * sentence and phase, the coach's progress and its rewards, and on the right the claim, the way
 * to progress, or how it ended.
 */
export default function MissionCard({
  event,
  mission,
  level,
  onClaimed,
}: {
  event: EventView;
  mission: MissionView;
  level: HeadingLevel;
  onClaimed: (rewards: RewardView[]) => void;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const phase = missionPhase(event, mission);
  const badge = BADGE[phase];
  return (
    <li
      className={`grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 rounded-xl border px-4 py-4 @lg:gap-x-5 @lg:px-5 @lg:py-4.5 @2xl:grid-cols-[auto_minmax(0,1fr)_auto] ${cardTone(phase)}`}
    >
      <RewardTile mission={mission} phase={phase} />
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Heading
            level={level}
            className="font-sans text-base font-bold text-gray-900 normal-case dark:text-white"
          >
            {missionText(t, mission)}
          </Heading>
          <CardBadge tone={badge.tone}>{t(badge.key)}</CardBadge>
        </div>
        <Progress mission={mission} phase={phase} />
        <RewardsLine mission={mission} phase={phase} />
      </div>
      <div className="col-span-2 flex flex-col items-start gap-1.5 @2xl:col-span-1 @2xl:min-w-35 @2xl:items-end">
        <Action
          event={event}
          mission={mission}
          phase={phase}
          onClaimed={onClaimed}
          onError={setError}
        />
      </div>
      {error && (
        <p role="alert" className="col-span-full text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </li>
  );
}
