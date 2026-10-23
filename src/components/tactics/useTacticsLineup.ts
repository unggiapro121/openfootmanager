import type { DragEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { TacticsPhaseSettings, TeamMatchRolesData } from "../../store/types";
import type { TacticsRosterPlayer } from "./tacticsBoardSource";

import {
  applyLineupDrop,
  applyLineupSwap,
  buildAssignBestFitSlot,
  buildActivePositionMap,
  buildDemoteFromStartingXi,
  buildPitchRows,
  buildPitchSlotRows,
  buildPromoteToStartingXi,
  type DragState,
  type PitchSlotRow,
  type SquadSection,
} from "../squad/SquadTab.helpers";
import {
  buildTacticsPitchSlots,
  buildTacticsRoster,
  countOutOfPositionPlayers,
  findTacticsPresetBySetup,
  getSelectedAndComparePlayers,
  resolveStartingXiIds,
} from "./TacticsTab.helpers";
import {
  buildUpdatedMatchRolesForAssignment,
  resolveEffectiveMatchRoles,
} from "./TacticsRoles.helpers";
import type { TacticsBoardSource } from "./tacticsBoardSource";

function isPlayerEligibleForLineup(player: TacticsRosterPlayer | null | undefined): boolean {
  return Boolean(player && !player.injury);
}

/** The board's line-up, selection and drag state over `source`'s club. */
export function useTacticsLineup({ source }: { source: TacticsBoardSource }) {
  const team = source.team;
  const positionRatings = source.positionRatings;
  const initialPreset = team
    ? findTacticsPresetBySetup(team.formation || "4-4-2", team.play_style || "Balanced")
    : null;
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null);
  const [pendingStartingXiIds, setPendingStartingXiIds] = useState<string[] | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [selectedPlayerSection, setSelectedPlayerSection] = useState<SquadSection | null>(null);
  const [comparePlayerId, setComparePlayerId] = useState<string | null>(null);
  const [comparePlayerSection, setComparePlayerSection] = useState<SquadSection | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const hoveredSlotRef = useRef<number | null>(null);
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);

  const roster = team ? buildTacticsRoster(source.roster, team.id) : [];

  const formation = team?.formation || "4-4-2";
  const activePlayStyle = team?.play_style || "Balanced";
  const savedStartingXiKey = (team?.starting_xi_ids || []).join(",");
  const playersById = useMemo(() => new Map(roster.map((player) => [player.id, player])), [roster]);
  const available = roster.filter((player) => !player.injury);
  const pitchRows = useMemo(() => buildPitchRows(formation), [formation]);

  const startingXiIds = useMemo(
    () =>
      resolveStartingXiIds({
        availablePlayers: available,
        formation,
        pendingStartingXiIds,
        playersById,
        savedStartingXiIds: team?.starting_xi_ids || [],
      }),
    [
      available.map((player) => player.id).join(","),
      formation,
      (team?.starting_xi_ids || []).join(","),
      (pendingStartingXiIds || []).join(","),
      roster.map((player) => player.id).join(","),
    ],
  );

  const startingXI = useMemo(
    () =>
      startingXiIds
        .map((id) => playersById.get(id))
        .filter((player): player is TacticsRosterPlayer => player != null),
    [playersById, startingXiIds],
  );

  useEffect(() => {
    if (!pendingStartingXiIds) return;
    if (savedStartingXiKey === pendingStartingXiIds.join(",")) {
      setPendingStartingXiIds(null);
    }
  }, [pendingStartingXiIds, savedStartingXiKey]);

  // The saved XI can still name a player who cannot play (injured since, or no
  // longer in the squad) while the screen shows a fit player filling his slot.
  // The check before advancing reads the saved XI, so it kept naming a player the
  // manager could see on the bench. Save what is shown, once per lineup.
  const savedXiHasUnavailablePlayer =
    roster.length > 0 &&
    (team?.starting_xi_ids || []).some((id) => {
      const player = playersById.get(id);
      return !player || player.injury != null;
    });
  const autoSavedXiKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (pendingStartingXiIds || !savedXiHasUnavailablePlayer || startingXiIds.length !== 11) {
      return;
    }
    const shownXiKey = startingXiIds.join(",");
    if (shownXiKey === savedStartingXiKey || autoSavedXiKeyRef.current === shownXiKey) return;
    autoSavedXiKeyRef.current = shownXiKey;
    void persistStartingXI(startingXiIds);
  }, [pendingStartingXiIds, savedXiHasUnavailablePlayer, savedStartingXiKey, startingXiIds]);

  const pitchSlotRows = useMemo<PitchSlotRow<TacticsRosterPlayer>[]>(
    () => buildPitchSlotRows(pitchRows, startingXiIds, playersById),
    [pitchRows, playersById, startingXiIds],
  );
  const pitchSlots = useMemo(() => buildTacticsPitchSlots(pitchSlotRows), [pitchSlotRows]);
  const xiIds = new Set(startingXiIds);
  const bench = roster.filter((player) => !xiIds.has(player.id));
  const xiActivePosition = useMemo(() => buildActivePositionMap(pitchSlotRows), [pitchSlotRows]);

  const { comparePlayer, selectedPlayer } = getSelectedAndComparePlayers(
    comparePlayerId,
    playersById,
    selectedPlayerId,
  );

  const canConfirmSwap = useMemo(() => {
    if (!selectedPlayerId || !selectedPlayerSection || !comparePlayerId || !comparePlayerSection) {
      return false;
    }

    if (
      (selectedPlayerSection === "bench" &&
        !isPlayerEligibleForLineup(selectedPlayerId ? playersById.get(selectedPlayerId) : null)) ||
      (comparePlayerSection === "bench" &&
        !isPlayerEligibleForLineup(comparePlayerId ? playersById.get(comparePlayerId) : null))
    ) {
      return false;
    }

    const nextXiIds = applyLineupSwap(
      startingXiIds,
      { id: selectedPlayerId, from: selectedPlayerSection },
      comparePlayerId,
      comparePlayerSection,
    );

    return !!nextXiIds && nextXiIds.join(",") !== startingXiIds.join(",");
  }, [
    comparePlayerId,
    comparePlayerSection,
    playersById,
    selectedPlayerId,
    selectedPlayerSection,
    startingXiIds,
  ]);

  const outOfPositionCount = countOutOfPositionPlayers(startingXI, xiActivePosition);
  const effectiveMatchRoles = useMemo(
    () => resolveEffectiveMatchRoles(startingXI, team?.match_roles),
    [team?.match_roles, startingXI],
  );

  async function persistStartingXI(playerIds: string[]): Promise<void> {
    setPendingStartingXiIds(playerIds);
    try {
      await source.setStartingXi(playerIds);
    } catch (error) {
      setPendingStartingXiIds(null);
      console.error("Failed to set starting XI:", error);
    }
  }

  async function handleFormationChange(nextFormation: string): Promise<boolean> {
    try {
      await source.setFormation(nextFormation);
      return true;
    } catch (error) {
      console.error("Failed to set formation:", error);
      return false;
    }
  }

  async function handlePlayStyleChange(playStyle: string): Promise<boolean> {
    try {
      await source.setPlayStyle(playStyle);
      return true;
    } catch (error) {
      console.error("Failed to set play style:", error);
      return false;
    }
  }

  async function handleAssignBestFit(playerId: string): Promise<void> {
    const nextXiIds = buildAssignBestFitSlot(startingXiIds, playersById, formation, playerId);

    if (!nextXiIds || nextXiIds.join(",") === startingXiIds.join(",")) {
      return;
    }

    await persistStartingXI(nextXiIds);
    clearLineupSelection();
  }

  async function handlePromoteBenchPlayer(playerId: string): Promise<void> {
    if (!isPlayerEligibleForLineup(playersById.get(playerId))) {
      return;
    }

    const nextXiIds = buildPromoteToStartingXi(startingXiIds, playersById, formation, playerId);

    if (!nextXiIds || nextXiIds.join(",") === startingXiIds.join(",")) {
      return;
    }

    await persistStartingXI(nextXiIds);
    clearLineupSelection();
  }

  async function handleDemoteStarter(playerId: string): Promise<void> {
    const nextXiIds = buildDemoteFromStartingXi(startingXiIds, available, formation, playerId);

    if (!nextXiIds || nextXiIds.join(",") === startingXiIds.join(",")) {
      return;
    }

    await persistStartingXI(nextXiIds);
    clearLineupSelection();
  }

  function clearLineupSelection(): void {
    setSelectedPlayerId(null);
    setSelectedPlayerSection(null);
    setComparePlayerId(null);
    setComparePlayerSection(null);
  }

  function setHoveredSlotValue(slotIndex: number | null): void {
    if (hoveredSlotRef.current === slotIndex) {
      return;
    }

    hoveredSlotRef.current = slotIndex;
    setHoveredSlot(slotIndex);
  }

  function resetDragState(): void {
    dragStateRef.current = null;
    setDragState(null);
    setHoveredSlotValue(null);
  }

  function applyLightweightDragPreview(event: DragEvent<HTMLElement>): void {
    if (!dragPreviewRef.current) {
      return;
    }

    if (typeof event.dataTransfer.setDragImage !== "function") {
      return;
    }

    event.dataTransfer.setDragImage(dragPreviewRef.current, 16, 16);
  }

  function handleDragStart(
    event: DragEvent<HTMLElement>,
    playerId: string,
    from: SquadSection,
    slotIndex: number | null = null,
  ): void {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", playerId);
    applyLightweightDragPreview(event);
    const nextDragState = { playerId, from, slotIndex };
    dragStateRef.current = nextDragState;
    setDragState(nextDragState);
  }

  function handleSlotDragOver(event: DragEvent<HTMLElement>, slotIndex: number): void {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setHoveredSlotValue(slotIndex);
  }

  function handleSlotDragLeave(slotIndex: number): void {
    if (hoveredSlotRef.current !== slotIndex) {
      return;
    }

    setHoveredSlotValue(null);
  }

  async function handleSlotDrop(event: DragEvent<HTMLElement>, slotIndex: number): Promise<void> {
    event.preventDefault();
    const draggedPlayerId = event.dataTransfer.getData("text/plain");
    const currentDragState = dragStateRef.current ?? dragState;
    const resolvedDragState =
      currentDragState ??
      (draggedPlayerId
        ? {
            playerId: draggedPlayerId,
            from: xiIds.has(draggedPlayerId) ? "xi" : "bench",
            slotIndex: xiIds.has(draggedPlayerId) ? startingXiIds.indexOf(draggedPlayerId) : null,
          }
        : null);

    if (!resolvedDragState) return;

    if (
      resolvedDragState.from === "bench" &&
      !isPlayerEligibleForLineup(playersById.get(resolvedDragState.playerId))
    ) {
      resetDragState();
      return;
    }

    const nextXiIds = applyLineupDrop(startingXiIds, resolvedDragState, slotIndex);
    if (nextXiIds.join(",") === startingXiIds.join(",")) {
      resetDragState();
      return;
    }

    await persistStartingXI(nextXiIds);
    clearLineupSelection();
    resetDragState();
  }

  async function handleLineupPlayerClick(playerId: string, section: SquadSection): Promise<void> {
    if (!selectedPlayerId || !selectedPlayerSection) {
      setSelectedPlayerId(playerId);
      setSelectedPlayerSection(section);
      return;
    }

    if (selectedPlayerId === playerId && selectedPlayerSection === section) {
      if (comparePlayerId && comparePlayerSection) {
        setSelectedPlayerId(comparePlayerId);
        setSelectedPlayerSection(comparePlayerSection);
        setComparePlayerId(null);
        setComparePlayerSection(null);
        return;
      }

      clearLineupSelection();
      return;
    }

    if (comparePlayerId === playerId && comparePlayerSection === section) {
      setComparePlayerId(null);
      setComparePlayerSection(null);
      return;
    }

    setComparePlayerId(playerId);
    setComparePlayerSection(section);
  }

  async function handleConfirmSwap(): Promise<void> {
    if (!selectedPlayerId || !selectedPlayerSection || !comparePlayerId || !comparePlayerSection) {
      return;
    }

    if (
      (selectedPlayerSection === "bench" &&
        !isPlayerEligibleForLineup(selectedPlayerId ? playersById.get(selectedPlayerId) : null)) ||
      (comparePlayerSection === "bench" &&
        !isPlayerEligibleForLineup(comparePlayerId ? playersById.get(comparePlayerId) : null))
    ) {
      return;
    }

    const nextXiIds = applyLineupSwap(
      startingXiIds,
      { id: selectedPlayerId, from: selectedPlayerSection },
      comparePlayerId,
      comparePlayerSection,
    );

    if (!nextXiIds || nextXiIds.join(",") === startingXiIds.join(",")) {
      return;
    }

    await persistStartingXI(nextXiIds);
    clearLineupSelection();
  }

  async function persistMatchRoles(nextRoles: TeamMatchRolesData): Promise<void> {
    try {
      await source.setMatchRoles(nextRoles);
    } catch (error) {
      console.error("Failed to set team match roles:", error);
    }
  }

  async function handleAssignMatchRole(
    role: keyof TeamMatchRolesData,
    playerId: string,
  ): Promise<void> {
    await persistMatchRoles(
      buildUpdatedMatchRolesForAssignment(effectiveMatchRoles, startingXI, role, playerId),
    );
  }

  async function handleTacticsPhaseChange(patch: Partial<TacticsPhaseSettings>): Promise<void> {
    try {
      await source.setTacticsPhase(patch);
    } catch (error) {
      console.error("Failed to set tactics phase:", error);
    }
  }

  return {
    team,
    positionRatings,
    formation,
    activePlayStyle,
    initialPreset,
    roster,
    startingXI,
    bench,
    xiActivePosition,
    pitchSlots,
    outOfPositionCount,
    effectiveMatchRoles,
    selectedPlayer,
    comparePlayer,
    selectedPlayerId,
    comparePlayerId,
    canConfirmSwap,
    dragState,
    hoveredSlot,
    dragPreviewRef,
    handleFormationChange,
    handlePlayStyleChange,
    handleAssignBestFit,
    handlePromoteBenchPlayer,
    handleDemoteStarter,
    clearLineupSelection,
    handleDragStart,
    handleSlotDragOver,
    handleSlotDragLeave,
    handleSlotDrop,
    handleLineupPlayerClick,
    handleConfirmSwap,
    resetDragState,
    handleAssignMatchRole,
    handleTacticsPhaseChange,
  };
}
