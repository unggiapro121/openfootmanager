import { useMemo, useRef, useState } from "react";
import type { TacticsLimits } from "../../components/tactics/licenceLimits";
import type { TacticsBoardSource } from "../../components/tactics/tacticsBoardSource";
import type { MyClubView } from "../api";
import { online } from "../client";
import {
  applySetupChange,
  type SetupChange,
  toBoardTeam,
  toPositionRatings,
  toRosterPlayer,
} from "../convert/tactics";
import type { OnlineApiError } from "../errors";
import { refreshClub, tracked, useOnlineStore } from "../store/onlineStore";
import { useActionKey } from "./useActionKey";

/** One thing wrong with a setup the server refused (`ofm_rules::setup::SetupIssue`). */
export type SetupProblem =
  | { issue: "unknownFormation" }
  | { issue: "startingElevenSize" }
  | { issue: "duplicateStarter"; playerId: string }
  | { issue: "notInSquad"; playerId: string }
  // Closed by the coach's licence (S-9).
  | { issue: "lockedFormation" }
  | { issue: "lockedPlayStyle" }
  | { issue: "lockedRole"; playerId: string }
  | { issue: "lockedTactics" };

/** Every issue the client words; a newer server's other issues read as `unknown`. */
export const KNOWN_SETUP_ISSUES: ReadonlySet<string> = new Set([
  "unknownFormation",
  "startingElevenSize",
  "duplicateStarter",
  "notInSquad",
  "lockedFormation",
  "lockedPlayStyle",
  "lockedRole",
  "lockedTactics",
]);

/** What the last write said, beyond the club the board shows. */
export type SetupOutcome =
  | { kind: "none" }
  | { kind: "stale" }
  | { kind: "invalid"; problems: SetupProblem[] }
  | { kind: "locked"; kickoffAt: string | null }
  | { kind: "failed"; error: OnlineApiError };

function problemsOf(error: OnlineApiError): SetupProblem[] {
  const details = error.details as { issues?: unknown } | undefined;
  return Array.isArray(details?.issues) ? (details.issues as SetupProblem[]) : [];
}

function outcomeOf(error: OnlineApiError): SetupOutcome {
  switch (error.code) {
    case "be.error.club.versionStale":
      return { kind: "stale" };
    case "be.error.club.setupInvalid":
      return { kind: "invalid", problems: problemsOf(error) };
    case "be.error.club.lineupLocked":
      return { kind: "locked", kickoffAt: String(error.params.kickoffAt ?? "") || null };
    default:
      return { kind: "failed", error };
  }
}

/**
 * The coach's online club as the tactics board's source (C-2 C2-6, C2-7). Every change is a
 * whole setup sent with the club's version (`If-Match`); writes go one after another, each
 * built on the club the server last confirmed, so two quick changes never undo each other. The
 * board shows a change once the server confirms it, as with the desktop backend.
 */
export function useOnlineTacticsSource(
  club: MyClubView,
  limits?: TacticsLimits,
): {
  source: TacticsBoardSource;
  outcome: SetupOutcome;
} {
  const [outcome, setOutcome] = useState<SetupOutcome>({ kind: "none" });
  const queue = useRef<Promise<void>>(Promise.resolve());
  const key = useActionKey();

  const write = (change: SetupChange): Promise<void> => {
    const run = queue.current.then(async () => {
      const current = useOnlineStore.getState().club;
      if (!current) throw new Error("no club");
      const setup = applySetupChange(current.setup, change);
      try {
        const updated = await key.run(
          (idempotencyKey) =>
            tracked(() => online.clubs.setSetup(setup, current.version, idempotencyKey)),
          `${current.version}:${JSON.stringify(setup)}`,
        );
        useOnlineStore.getState().setClub(updated);
        setOutcome({ kind: "none" });
      } catch (failure) {
        const error = failure as OnlineApiError;
        const next = outcomeOf(error);
        setOutcome(next);
        // Someone changed the club elsewhere: show theirs, never re-apply ours over it.
        if (next.kind === "stale") await refreshClub().catch(() => undefined);
        throw error;
      }
    });
    queue.current = run.catch(() => undefined);
    return run;
  };

  const source = useMemo<TacticsBoardSource>(
    () => ({
      team: toBoardTeam(club),
      roster: club.players.map((player) => toRosterPlayer(player, club.club.id)),
      positionRatings: toPositionRatings(club.players),
      setStartingXi: (playerIds) => write({ kind: "startingXi", playerIds }),
      setFormation: (formation) => write({ kind: "formation", formation }),
      setPlayStyle: (playStyle) => write({ kind: "playStyle", playStyle }),
      setMatchRoles: (roles) => write({ kind: "matchRoles", roles }),
      setTacticsPhase: (patch) => write({ kind: "tacticsPhase", patch }),
      setPlayerRole: (playerId, role) => write({ kind: "playerRole", playerId, role }),
      limits,
    }),
    // `write` reads the store when it runs, so the source changes only with the club and its
    // licence.
    [club, limits],
  );

  return { source, outcome };
}
