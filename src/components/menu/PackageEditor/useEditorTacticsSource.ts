import { useEffect, useRef, useState } from "react";

import { type PackageClubPreview, previewPackageClub } from "../../../services/worldEditorService";
import type { TacticsPhaseSettings } from "../../../store/types";
import type { TacticsBoardSource } from "../../tactics/tacticsBoardSource";
import { boardTeam, compactTactics } from "./teamTactics.helpers";
import type { PlayerDef, TeamDef, TeamTacticsDef } from "./types";

interface EditorTacticsSourceArgs {
  team: TeamDef;
  /** The authored players whose `club` is this team. */
  clubPlayers: PlayerDef[];
  baseYear: number | null;
  onTacticsChange: (tactics: TeamTacticsDef | null) => void;
  onPlayStyleChange: (playStyle: string) => void;
  onError: (err: unknown) => void;
}

/**
 * A package club on the tactics board: shown as the world would open it, with
 * its `tactics` laid over; every change on the board is written to `tactics`.
 * Null until the backend has built the club's preview.
 */
export function useEditorTacticsSource({
  team,
  clubPlayers,
  baseYear,
  onTacticsChange,
  onPlayStyleChange,
  onError,
}: EditorTacticsSourceArgs): TacticsBoardSource | null {
  const [preview, setPreview] = useState<PackageClubPreview | null>(null);
  // The preview depends on the club, its style, its players and the year —
  // not on its tactics, which the board lays over it. The latest values are
  // read through a ref so the request is keyed on exactly those.
  const request = useRef({ team, clubPlayers, baseYear, onError });
  request.current = { team, clubPlayers, baseYear, onError };
  const previewKey = JSON.stringify([team.id, team.playStyle, baseYear, clubPlayers]);

  useEffect(() => {
    let cancelled = false;
    const { team: club, clubPlayers: players, baseYear: year, onError: report } = request.current;
    previewPackageClub(club, players, year)
      .then((built) => {
        if (!cancelled) setPreview(built);
      })
      .catch((err: unknown) => {
        if (!cancelled) report(err);
      });
    return () => {
      cancelled = true;
    };
  }, [previewKey]);

  if (!preview) return null;

  const tactics = team.tactics ?? {};
  const shown = boardTeam(preview.team, team.playStyle, tactics);
  const write = async (next: TeamTacticsDef) => {
    onTacticsChange(compactTactics(next) ?? null);
  };

  return {
    team: shown,
    roster: preview.players,
    positionRatings: preview.position_ratings,
    // A side is slot-aligned with the shape it was picked in, so it pins it.
    setStartingXi: (playerIds) =>
      write({ ...tactics, formation: shown.formation, startingXi: playerIds }),
    setFormation: (formation) => write({ ...tactics, formation }),
    setPlayStyle: async (playStyle) => onPlayStyleChange(playStyle),
    setMatchRoles: (matchRoles) => write({ ...tactics, matchRoles }),
    // The preview always carries the club's full settings (`build_team`), so a
    // patch over them is a full set.
    setTacticsPhase: (patch) =>
      write({ ...tactics, phase: { ...shown.tactics_phase, ...patch } as TacticsPhaseSettings }),
    setPlayerRole: (playerId, role) =>
      write({ ...tactics, playerRoles: { ...tactics.playerRoles, [playerId]: role } }),
  };
}
