import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";
import TacticsBoard from "../../components/tactics/TacticsBoard";
import { resolveBackendError } from "../../utils/backendI18n";
import type { MyClubView } from "../api";
import { useOnlineNow } from "../clock";
import { formatMoment } from "../format";
import { tracked, useOnlineStore } from "../store/onlineStore";
import { useMemo } from "react";
import { online } from "../client";
import { boardLimits } from "../convert/licence";
import LicenceNotice from "./LicenceNotice";
import StyleEffectChips from "./StyleEffectChips";
import XiAssistantCard from "./XiAssistantCard";
import { useOnlineResource } from "../useOnlineResource";
import {
  KNOWN_SETUP_ISSUES,
  type SetupOutcome,
  type SetupProblem,
  useOnlineTacticsSource,
} from "./useOnlineTacticsSource";

/**
 * Whether the next match's line-up is locked: from the moment the server gives
 * (`lineupLocksAt`), and in any case once the fixture is prepared, which comes after the lock.
 */
export function lockOf(
  club: MyClubView,
  nowMs: number,
): { locked: boolean; kickoffAt: string | null } {
  const fixture = club.nextFixture;
  if (!fixture) return { locked: false, kickoffAt: null };
  const locksAt = fixture.lineupLocksAt ? Date.parse(fixture.lineupLocksAt) : Number.NaN;
  const locked = fixture.status === "prepared" || (!Number.isNaN(locksAt) && nowMs >= locksAt);
  return { locked, kickoffAt: fixture.kickoffAt };
}

/** The online club on the game's own tactics board (C-2 §3.4, C2-6, C2-7). */
export default function OnlineTactics() {
  const club = useOnlineStore((state) => state.club);
  if (!club) return null;
  return <TacticsScreen club={club} />;
}

function TacticsScreen({ club }: { club: MyClubView }) {
  const { t, i18n } = useTranslation();
  const now = useOnlineNow();
  // The licence table is read once a visit: it changes only with the season (S-9).
  const { resource } = useOnlineResource(() => online.licences.table(), []);
  const table = resource.status === "ready" ? resource.data : null;
  const limits = useMemo(() => boardLimits(club, table), [club, table]);
  const { source, outcome, setAssistant, assistantDropped } = useOnlineTacticsSource(club, limits);
  // The coach's mastery is read once a visit too: it moves only when a match he directed settles.
  const { resource: mastery } = useOnlineResource(
    async () => (await tracked(() => online.me.career())).mastery,
    [],
  );
  const styles = mastery.status === "ready" ? mastery.data : null;
  const coach = useMemo(
    () =>
      styles
        ? {
            play_style_mastery: Object.fromEntries(
              styles.map((style) => [style.style, style.level]),
            ),
          }
        : null,
    [styles],
  );
  const known = lockOf(club, now);
  const locked = known.locked || outcome.kind === "locked";
  const kickoffAt =
    outcome.kind === "locked" ? (outcome.kickoffAt ?? known.kickoffAt) : known.kickoffAt;

  return (
    <div className="space-y-4">
      {locked && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg border border-accent-400/50 bg-accent-50 px-4 py-2 text-sm text-gray-800 dark:bg-accent-500/10 dark:text-gray-100"
        >
          <Lock className="h-4 w-4 shrink-0 text-accent-600 dark:text-accent-400" />
          {kickoffAt
            ? t("online.tactics.locked", { time: formatMoment(kickoffAt, i18n.language) })
            : t("online.tactics.lockedNow")}
        </p>
      )}
      <LicenceNotice />
      <XiAssistantCard
        club={club}
        locked={locked}
        dropped={assistantDropped}
        setAssistant={setAssistant}
      />
      <OutcomeNotice outcome={outcome} club={club} />
      {/* A locked line-up is shown, never edited: `inert` takes the whole board out of reach. */}
      <div inert={locked} className={locked ? "opacity-70" : undefined}>
        <TacticsBoard
          source={source}
          libraryGame={null}
          libraryKey={`ofm:tactics:custom:online:${club.club.id}`}
          coach={coach}
          styleEffects={(style) => (
            <StyleEffectChips
              effects={styles?.find((entry) => entry.style === style)?.effects ?? []}
            />
          )}
        />
      </div>
    </div>
  );
}

function OutcomeNotice({ outcome, club }: { outcome: SetupOutcome; club: MyClubView }) {
  const { t } = useTranslation();
  if (outcome.kind === "none" || outcome.kind === "locked") return null;
  if (outcome.kind === "stale") {
    return (
      <p role="alert" className="text-sm text-accent-700 dark:text-accent-400">
        {t("online.tactics.stale")}
      </p>
    );
  }
  if (outcome.kind === "failed") {
    return (
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        {resolveBackendError(outcome.error)}
      </p>
    );
  }
  const names = new Map(club.players.map((player) => [player.id, player.fullName]));
  return (
    <div role="alert" className="text-sm text-red-600 dark:text-red-400">
      <p>{t("online.tactics.invalid")}</p>
      <ul className="list-disc pl-5">
        {outcome.problems.map((problem) => (
          <li key={problemKey(problem)}>{problemText(problem, names, t)}</li>
        ))}
      </ul>
    </div>
  );
}

function problemKey(problem: SetupProblem): string {
  return "playerId" in problem ? `${problem.issue}:${problem.playerId}` : problem.issue;
}

function problemText(
  problem: SetupProblem,
  names: Map<string, string>,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  // A newer server may name an issue this client does not know: say so plainly, never its key.
  if (!KNOWN_SETUP_ISSUES.has(problem.issue)) return t("online.tactics.issue.unknown");
  if (!("playerId" in problem)) return t(`online.tactics.issue.${problem.issue}`);
  const player = names.get(problem.playerId) ?? t("online.tactics.unknownPlayer");
  return t(`online.tactics.issue.${problem.issue}`, { player });
}
