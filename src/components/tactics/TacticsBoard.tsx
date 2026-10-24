import type { JSX } from "react";
import type { GameStateData } from "../../store/gameStore";
import type { ManagerData } from "../../store/types";
import { useTranslation } from "react-i18next";

import TacticsPitch from "./TacticsPitch";
import TacticsPlayerList from "./TacticsPlayerList";
import TacticsRightPanel from "./TacticsRightPanel";
import TacticsCommandBar from "./TacticsCommandBar";
import TacticsPlayerFocusPanel from "./TacticsPlayerFocusPanel";
import { useTacticsLibrary } from "./useTacticsLibrary";
import { useTacticsFilters } from "./useTacticsFilters";
import { useTacticsLineup } from "./useTacticsLineup";
import type { TacticsBoardSource } from "./tacticsBoardSource";

interface TacticsBoardProps {
  source: TacticsBoardSource;
  /** Keys the saved custom tactics; without a game there are only the presets. */
  libraryGame: GameStateData | null;
  /** The manager whose play-style mastery the command bar shows, if any. */
  coach: ManagerData | null;
  /** Absent where there is no player profile to open, as in the world editor. */
  onOpenPlayerProfile?: (playerId: string) => void;
  scoutedWonderkids?: ReadonlySet<string>;
}

/**
 * The tactics board: command bar, player list, pitch, roles and phase panel,
 * over whichever club `source` reads and writes. The game's Tactics tab and the
 * world editor's club tactics are both this board.
 */
export default function TacticsBoard({
  source,
  libraryGame,
  coach,
  onOpenPlayerProfile,
  scoutedWonderkids = new Set<string>(),
}: TacticsBoardProps): JSX.Element {
  const { t } = useTranslation();

  const {
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
  } = useTacticsLineup({ source });

  const {
    playerSearch,
    setPlayerSearch,
    positionFilter,
    setPositionFilter,
    filteredStartingXI,
    filteredBench,
    handleClearFilters,
  } = useTacticsFilters({ startingXI, bench, xiActivePosition });

  const {
    activeTactic,
    tacticLibrary,
    isCommandBarDirty,
    draftTacticName,
    setDraftTacticName,
    applyTacticSelection,
    handleCreateCustomTactic,
    handleDuplicateTactic,
    handleSaveTactic,
    handleDeleteTactic,
  } = useTacticsLibrary({
    gameState: libraryGame,
    formation,
    activePlayStyle,
    initialPreset,
    onFormationChange: handleFormationChange,
    onPlayStyleChange: handlePlayStyleChange,
    tacticsPhase: team?.tactics_phase,
    onTacticsPhaseChange: handleTacticsPhaseChange,
  });

  if (!team) {
    return <p className="text-gray-500 dark:text-gray-400">{t("common.noTeam")}</p>;
  }

  return (
    <div className="flex w-full flex-col gap-5">
      <div
        ref={dragPreviewRef}
        aria-hidden="true"
        className="pointer-events-none fixed -left-20 top-0 h-8 w-8 rounded-full border border-white/15 bg-navy-900/90 shadow-lg"
      />
      <TacticsCommandBar
        activeTactic={activeTactic}
        activePlayStyle={activePlayStyle}
        formation={formation}
        isDirty={isCommandBarDirty}
        onCreateNew={handleCreateCustomTactic}
        onDuplicate={handleDuplicateTactic}
        onDelete={handleDeleteTactic}
        onFormationChange={(nextFormation) => {
          void handleFormationChange(nextFormation);
        }}
        onPlayStyleChange={(playStyle) => {
          void handlePlayStyleChange(playStyle);
        }}
        onSave={handleSaveTactic}
        onTacticNameChange={setDraftTacticName}
        tacticName={draftTacticName}
        onSelectTactic={(id) => {
          const nextTactic = tacticLibrary.find((entry) => entry.id === id);
          if (!nextTactic) {
            return;
          }

          void applyTacticSelection(nextTactic);
        }}
        tacticLibrary={tacticLibrary}
        coach={coach}
        limits={source.limits}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[260px_1fr_270px] xl:items-start">
        {/* Left: player list */}
        <TacticsPlayerList
          positionRatings={positionRatings}
          bench={filteredBench}
          comparePlayerId={comparePlayerId}
          dragState={dragState}
          matchRoles={effectiveMatchRoles}
          onAssignMatchRole={(role, playerId) => {
            void handleAssignMatchRole(role, playerId);
          }}
          onClearFilters={handleClearFilters}
          onDemoteStarter={(playerId) => {
            void handleDemoteStarter(playerId);
          }}
          onDragEnd={resetDragState}
          onDragStart={handleDragStart}
          onOpenPlayerProfile={onOpenPlayerProfile}
          onPlayerSearchChange={setPlayerSearch}
          onPositionFilterChange={setPositionFilter}
          onPromoteBench={(playerId) => {
            void handlePromoteBenchPlayer(playerId);
          }}
          onTacticalSelect={(playerId, section) => {
            void handleLineupPlayerClick(playerId, section);
          }}
          playerSearch={playerSearch}
          positionFilter={positionFilter}
          selectedPlayerId={selectedPlayerId}
          starters={filteredStartingXI}
          xiActivePosition={xiActivePosition}
        />

        {/* Center: pitch */}
        <TacticsPitch
          positionRatings={positionRatings}
          dragState={dragState}
          formation={formation}
          comparePlayerId={comparePlayerId}
          hoveredSlot={hoveredSlot}
          matchRoles={effectiveMatchRoles}
          onRoleChange={(playerId, role) => {
            void source.setPlayerRole(playerId, role).catch((error: unknown) => {
              console.error("Failed to set player role:", error);
            });
          }}
          playerRoles={team?.player_roles}
          limits={source.limits}
          tacticsPhase={team?.tactics_phase}
          onAssignBestFit={(playerId) => {
            void handleAssignBestFit(playerId);
          }}
          onAssignMatchRole={(role, playerId) => {
            void handleAssignMatchRole(role, playerId);
          }}
          onClearSelection={clearLineupSelection}
          onDemoteStarter={(playerId) => {
            void handleDemoteStarter(playerId);
          }}
          onDragEnd={resetDragState}
          onDragStart={handleDragStart}
          onLineupPlayerClick={(playerId, section) => {
            void handleLineupPlayerClick(playerId, section);
          }}
          onOpenPlayerProfile={onOpenPlayerProfile}
          onPromoteBench={(playerId) => {
            void handlePromoteBenchPlayer(playerId);
          }}
          onSlotDragLeave={handleSlotDragLeave}
          onSlotDragOver={handleSlotDragOver}
          onSlotDrop={(event, slotIndex) => {
            void handleSlotDrop(event, slotIndex);
          }}
          outOfPositionCount={outOfPositionCount}
          pitchSlots={pitchSlots}
          selectedPlayer={selectedPlayer}
          selectedPlayerId={selectedPlayerId}
        />

        {/* Right: roles + phase blueprint */}
        <TacticsRightPanel
          allSquad={roster}
          matchRoles={team.match_roles}
          onMatchRolesChange={source.setMatchRoles}
          onTacticsPhaseChange={(patch) => {
            void handleTacticsPhaseChange(patch);
          }}
          startingPlayers={startingXI}
          tacticsPhase={team?.tactics_phase}
          limits={source.limits}
        />
      </div>

      {/* Inspector modal — only when both players are selected for comparison */}
      {selectedPlayer && comparePlayer && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={clearLineupSelection}
          />
          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="pointer-events-auto w-full max-w-lg max-h-[85vh] overflow-y-auto">
              <TacticsPlayerFocusPanel
                canConfirmSwap={canConfirmSwap}
                comparePlayer={comparePlayer}
                onClose={clearLineupSelection}
                onConfirmSwap={() => {
                  void handleConfirmSwap();
                }}
                selectedPlayer={selectedPlayer}
                scoutedWonderkids={scoutedWonderkids}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
