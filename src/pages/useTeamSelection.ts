import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";

import type { GameStateData, LeagueData, PlayerData, TeamData } from "../store/gameStore";
import { getActiveCompetitions } from "../lib/helpers";
import { inferRegionId } from "../lib/teamRegions";
import { competitionDisplayName } from "../lib/competitionName";
import { resolveBackendError } from "../utils/backendI18n";
import { prewarmManagerSquadPortraits } from "../services/portraitService";
import { showError } from "../lib/errorDialog";
import { likelyXi, likelyXiAverageOvr } from "../lib/playerOvr";
import { buildFallbackRegions, sortCompetitions, teamCompetitions } from "./TeamSelection.helpers";

interface UseTeamSelectionArgs {
  gameState: GameStateData | null;
  setGameState: (game: GameStateData) => void;
  setGameActive: (active: boolean, managerName: string) => void;
  navigate: (path: string) => void;
}

export function useTeamSelection({
  gameState,
  setGameState,
  setGameActive,
  navigate,
}: UseTeamSelectionArgs) {
  const { t } = useTranslation();
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [clubSearch, setClubSearch] = useState("");
  const [selectedHomeRegionId, setSelectedHomeRegionId] = useState<string | null>(null);
  const [selectedCountryCode, setSelectedCountryCode] = useState<string | null>(null);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  const competitions = useMemo(
    () => (gameState ? sortCompetitions(getActiveCompetitions(gameState)) : []),
    [gameState],
  );

  const regions = useMemo(
    () =>
      gameState
        ? gameState.regions && gameState.regions.length > 0
          ? gameState.regions
          : buildFallbackRegions(t, gameState, competitions)
        : [],
    [competitions, gameState, t],
  );

  useEffect(() => {
    if (regions.length === 0) {
      if (selectedHomeRegionId !== null) {
        setSelectedHomeRegionId(null);
      }
      return;
    }

    const hasCurrentSelection = regions.some((region) => region.id === selectedHomeRegionId);
    if (!hasCurrentSelection) {
      setSelectedHomeRegionId(regions[0].id);
    }
  }, [regions, selectedHomeRegionId]);

  const regionCountries = useMemo(() => {
    const region = regions.find((candidate) => candidate.id === selectedHomeRegionId);
    return region?.country_codes ?? [];
  }, [regions, selectedHomeRegionId]);

  useEffect(() => {
    if (regionCountries.length === 0) {
      if (selectedCountryCode !== null) {
        setSelectedCountryCode(null);
      }
      return;
    }

    if (!selectedCountryCode || !regionCountries.includes(selectedCountryCode)) {
      setSelectedCountryCode(regionCountries[0]);
    }
  }, [regionCountries, selectedCountryCode]);

  // Each club's domestic league (its first, i.e. strongest, domestic league).
  const leagueByTeam = useMemo(() => {
    const byTeam = new Map<string, LeagueData>();
    for (const competition of competitions) {
      if (competition.kind !== "League" || competition.scope !== "Domestic") {
        continue;
      }
      for (const teamId of competition.participant_ids ?? []) {
        if (!byTeam.has(teamId)) {
          byTeam.set(teamId, competition);
        }
      }
    }
    return byTeam;
  }, [competitions]);

  const countryTeams = (gameState?.teams ?? []).filter((team) => {
    if (selectedCountryCode) {
      return team.country === selectedCountryCode;
    }
    if (selectedHomeRegionId) {
      return inferRegionId(team.country) === selectedHomeRegionId;
    }
    return true;
  });

  // Domestic leagues that hold at least one club of the selected country/region.
  const leagueOptions = competitions.filter((competition) =>
    countryTeams.some((team) => leagueByTeam.get(team.id)?.id === competition.id),
  );

  // A league picked for another country no longer applies once the country changes.
  const activeLeagueId = leagueOptions.some((league) => league.id === selectedLeagueId)
    ? selectedLeagueId
    : null;

  const teams = activeLeagueId
    ? countryTeams.filter((team) => leagueByTeam.get(team.id)?.id === activeLeagueId)
    : countryTeams;

  // Free-text search over the country/league-filtered clubs (name or city).
  const clubSearchQuery = clubSearch.trim().toLowerCase();
  const filteredTeams = clubSearchQuery
    ? teams.filter(
        (team) =>
          team.name.toLowerCase().includes(clubSearchQuery) ||
          team.city.toLowerCase().includes(clubSearchQuery),
      )
    : teams;

  // Group the visible clubs by their domestic league/division (strongest first),
  // with any club not in a league falling into an "other" bucket.
  const teamGroups = useMemo(() => {
    const groups = new Map<
      string,
      { id: string; name: string; order: number; teams: TeamData[] }
    >();
    const ungrouped: TeamData[] = [];
    for (const team of filteredTeams) {
      const league = leagueByTeam.get(team.id);
      if (!league) {
        ungrouped.push(team);
        continue;
      }
      const group = groups.get(league.id) ?? {
        id: league.id,
        name: competitionDisplayName(league, t),
        order: league.priority ?? 0,
        teams: [],
      };
      group.teams.push(team);
      groups.set(league.id, group);
    }

    const ordered = Array.from(groups.values()).sort(
      (left, right) => left.order - right.order || left.name.localeCompare(right.name),
    );
    for (const group of ordered) {
      group.teams.sort((left, right) => right.reputation - left.reputation);
    }
    if (ungrouped.length > 0) {
      ungrouped.sort((left, right) => right.reputation - left.reputation);
      ordered.push({
        id: "__ungrouped",
        name: t("teamSelect.otherClubs"),
        order: Number.MAX_SAFE_INTEGER,
        teams: ungrouped,
      });
    }
    return ordered;
  }, [filteredTeams, leagueByTeam, t]);

  useEffect(() => {
    if (teams.length === 0) {
      if (selectedTeamId !== null) {
        setSelectedTeamId(null);
      }
      return;
    }

    if (!selectedTeamId || !teams.some((team) => team.id === selectedTeamId)) {
      setSelectedTeamId(teams[0].id);
    }
  }, [selectedTeamId, teams]);

  const getTeamPlayers = (teamId: string): PlayerData[] =>
    (gameState?.players ?? []).filter((player) => player.team_id === teamId);

  const getTeamAvgOvr = (teamId: string): number => {
    return likelyXiAverageOvr(getTeamPlayers(teamId));
  };

  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? teams[0] ?? null;
  const selectedTeamPlayers = selectedTeam ? getTeamPlayers(selectedTeam.id) : [];
  const selectedTeamXi = likelyXi(selectedTeamPlayers);
  const selectedTeamCompetitions = selectedTeam
    ? teamCompetitions(selectedTeam.id, competitions)
    : [];
  const handleConfirm = async () => {
    if (!selectedTeam || isConfirming) return;
    setIsConfirming(true);
    try {
      // Simulate every competition: the backend activates whatever regions
      // those competitions need on top of the club's home region.
      const updatedGame = await invoke<GameStateData>("select_team", {
        teamId: selectedTeam.id,
        activeRegionIds: selectedHomeRegionId ? [selectedHomeRegionId] : [],
        activeCompetitionIds: competitions.map((competition) => competition.id),
      });
      try {
        await prewarmManagerSquadPortraits(updatedGame);
      } catch (portraitError) {
        console.warn("Portrait prewarm failed after team selection:", portraitError);
      }
      setGameState(updatedGame);
      const mgr = updatedGame.manager;
      setGameActive(true, `${mgr.first_name} ${mgr.last_name}`);
      navigate("/dashboard");
    } catch (error) {
      console.error("Failed to select team:", error);
      await showError(
        t("errors.title"),
        t("teamSelect.failedToSelectTeam", { error: resolveBackendError(error) }),
      );
    } finally {
      setIsConfirming(false);
    }
  };

  return {
    clubSearch,
    setClubSearch,
    selectedHomeRegionId,
    setSelectedHomeRegionId,
    selectedCountryCode,
    setSelectedCountryCode,
    selectedLeagueId: activeLeagueId,
    setSelectedLeagueId,
    leagueOptions,
    setSelectedTeamId,
    isConfirming,
    competitions,
    regions,
    regionCountries,
    filteredTeams,
    teamGroups,
    getTeamPlayers,
    getTeamAvgOvr,
    selectedTeam,
    selectedTeamXi,
    selectedTeamCompetitions,
    handleConfirm,
  };
}
