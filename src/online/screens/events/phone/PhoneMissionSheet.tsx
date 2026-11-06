import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { EventView, MissionView, RewardView } from "../../../api";
import { useBackAction } from "../../../../hooks/useBackAction";
import { useOnlineStore } from "../../../store/onlineStore";
import { itemDescription } from "../../items/itemText";
import { FOCUS, PhoneSheet } from "../../mobile/PhoneSheet";
import {
  isCounted,
  isDirected,
  isSeasonEnd,
  lapsedReasonText,
  levelsText,
  missionHint,
  missionText,
  rewardText,
  themeName,
} from "../eventText";
import { eventGroup, isMet, type MissionPhase, missionLeft, missionPhase } from "../missionState";
import { rewardIcon } from "../RewardIcon";
import { useMissionClaim } from "../useMissionClaim";
import PhoneChip, { type ChipTone } from "./PhoneChip";
import { percentOf } from "./phoneEventState";

const PHASE_CHIP: Record<MissionPhase, { tone: ChipTone; key: string }> = {
  ready: { tone: "gold", key: "online.events.status.ready" },
  autoClaiming: { tone: "gold", key: "online.events.autoClaiming" },
  active: { tone: "green", key: "online.events.status.active" },
  upcoming: { tone: "blue", key: "online.events.status.upcoming" },
  claimed: { tone: "plain", key: "online.events.claimed" },
  lapsed: { tone: "red", key: "online.events.status.lapsed" },
  missed: { tone: "red", key: "online.events.status.missed" },
};

const SECTION =
  "text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-gray-400";

const BIG_BUTTON =
  "flex h-12.5 shrink-0 items-center justify-center rounded-xl font-heading text-lg font-bold uppercase tracking-wider active:scale-97";

/** The words beside the count: what is left, that it may be claimed now, or that it was. */
function leftText(t: TFunction, mission: MissionView, phase: MissionPhase): string {
  if (phase === "ready") return t("online.events.phone.readyNow");
  if (phase === "claimed") return t("online.events.phone.claimedNote");
  if (phase === "autoClaiming") return t("online.events.autoClaiming");
  const left = missionLeft(mission);
  return left === undefined ? "" : t(`online.events.left.${mission.kind}`, { left });
}

/** The count over the target with its unit and a bar; a season-end mission, met or not. */
function SheetProgress({ mission, phase }: { mission: MissionView; phase: MissionPhase }) {
  const { t } = useTranslation();
  if (phase === "missed" || phase === "lapsed") return null;
  if (isSeasonEnd(mission.kind)) {
    return (
      <span className="font-heading text-2xl font-bold text-gray-900 dark:text-white">
        {t(isMet(mission) ? "online.events.met" : "online.events.notMet")}
      </span>
    );
  }
  if (!isCounted(mission.kind) || mission.target <= 0) return null;
  const done = Math.min(mission.progress, mission.target);
  const fill =
    phase === "ready"
      ? "bg-accent-400"
      : phase === "claimed"
        ? "bg-gray-400 dark:bg-gray-600"
        : "bg-primary-500";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-heading text-[26px] font-bold tabular-nums text-gray-900 dark:text-white">
          {done}/{mission.target}{" "}
          <span className="font-sans text-sm font-medium text-gray-500 dark:text-gray-400">
            {t(`online.events.phone.unit.${mission.kind}`)}
          </span>
        </span>
        <span
          className={`text-right text-[13px] font-semibold ${
            phase === "ready"
              ? "text-accent-800 dark:text-accent-300"
              : "text-gray-600 dark:text-gray-400"
          }`}
        >
          {leftText(t, mission, phase)}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={t("online.events.progress")}
        aria-valuemin={0}
        aria-valuemax={mission.target}
        aria-valuenow={done}
        className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-navy-600"
      >
        <div className={`h-full ${fill}`} style={{ width: `${percentOf(mission)}%` }} />
      </div>
    </div>
  );
}

/** Why a mission ended without its reward: the server's reason, or that time ran out. */
function failNote(t: TFunction, mission: MissionView, phase: MissionPhase): string | undefined {
  if (phase === "lapsed") {
    return mission.lapsedReason
      ? t("online.events.lapsed", { reason: lapsedReasonText(t, mission.lapsedReason) })
      : t("online.events.lapsedUnknown");
  }
  if (phase !== "missed") return undefined;
  return isCounted(mission.kind) && mission.target > 0
    ? t("online.events.phone.missedCounted", {
        progress: Math.min(mission.progress, mission.target),
        target: mission.target,
      })
    : t("online.events.phone.missedPlain");
}

function RewardLine({ reward }: { reward: RewardView }) {
  const { t, i18n } = useTranslation();
  const Icon = rewardIcon(reward);
  const note = [
    reward.item ? itemDescription(t, reward.item) : "",
    reward.expiresInDays !== undefined
      ? t("online.events.reward.expires", { days: reward.expiresInDays })
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <li className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-navy-600 dark:bg-navy-900">
      <span
        aria-hidden="true"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-accent-300 bg-accent-100 text-accent-800 dark:border-accent-900 dark:bg-accent-900/40 dark:text-accent-300"
      >
        <Icon className="h-5.5 w-5.5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold text-gray-900 dark:text-white">
          {rewardText(t, i18n.language, reward)}
        </span>
        {note && <span className="text-xs text-gray-600 dark:text-gray-400">{note}</span>}
      </span>
    </li>
  );
}

/** Where to go to move the mission on: the fixtures for a directed one, the table for a season-end one. */
function goTo(mission: MissionView): { to: string; key: string } | undefined {
  if (isDirected(mission.kind)) return { to: "/online/schedule", key: "online.events.goSchedule" };
  if (isSeasonEnd(mission.kind)) return { to: "/online/league", key: "online.events.goLeague" };
  return undefined;
}

/**
 * A mission's detail on a phone (design m-su-kien.html): its event and state, the progress, why
 * it failed, every reward with what it does and when it expires, what counts, and the claim or
 * the way to move it on. Back closes it, as the tap outside and Escape do.
 */
export default function PhoneMissionSheet({
  event,
  mission,
  onClose,
  onClaimed,
}: {
  event: EventView;
  mission: MissionView;
  onClose: () => void;
  onClaimed: (rewards: RewardView[]) => void;
}) {
  const { t } = useTranslation();
  useBackAction(true, onClose);
  const hasClub = useOnlineStore((state) => Boolean(state.club));
  const [error, setError] = useState<string | null>(null);
  const { claim, busy } = useMissionClaim({ event, mission, onClaimed, onError: setError });
  const phase = missionPhase(event, mission);
  const chip = PHASE_CHIP[phase];
  const failed = failNote(t, mission, phase);
  const go = phase === "active" && hasClub ? goTo(mission) : undefined;
  const conditions = [
    eventGroup(event.state) === "scheduled" ? t("online.events.phone.opensLater") : "",
    missionHint(t, mission.kind) ?? t("online.events.phone.conditionDefault"),
    levelsText(t, mission.levels) ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <PhoneSheet
      title={missionText(t, mission)}
      kicker={
        <>
          <span>{themeName(t, event.theme)}</span>
          <PhoneChip tone={chip.tone}>{t(chip.key)}</PhoneChip>
        </>
      }
      onClose={onClose}
    >
      <SheetProgress mission={mission} phase={phase} />
      {failed && (
        <p className="rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] leading-relaxed text-red-700 dark:border-red-900 dark:bg-red-900/35 dark:text-red-300">
          {failed}
        </p>
      )}
      {mission.rewards.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className={SECTION}>{t("online.events.phone.rewards")}</span>
          <ul className="flex flex-col gap-2">
            {mission.rewards.map((reward) => (
              <RewardLine key={`${reward.item ?? "coin"}:${reward.quantity}`} reward={reward} />
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <span className={SECTION}>{t("online.events.phone.conditions")}</span>
        <p className="text-[13px] leading-normal text-gray-700 dark:text-gray-300">{conditions}</p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {phase === "ready" && (
        <button
          type="button"
          onClick={() => void claim()}
          disabled={busy}
          className={`${BIG_BUTTON} bg-accent-400 text-navy-900 hover:bg-accent-500 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`}
        >
          {t(busy ? "online.events.claiming" : "online.events.claim")}
        </button>
      )}
      {go && (
        <Link
          to={go.to}
          className={`${BIG_BUTTON} bg-primary-700 text-white hover:bg-primary-800 ${FOCUS}`}
        >
          {t(go.key)}
        </Link>
      )}
      <button
        type="button"
        onClick={onClose}
        className={`h-11.5 shrink-0 rounded-xl bg-gray-100 text-sm font-semibold text-gray-900 hover:bg-gray-200 active:scale-97 dark:bg-navy-600 dark:text-white dark:hover:bg-navy-700 ${FOCUS}`}
      >
        {t("common.close")}
      </button>
    </PhoneSheet>
  );
}
