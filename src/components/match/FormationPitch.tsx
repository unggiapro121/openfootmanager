import { useMemo, useState, type DragEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useGameStore } from "../../store/gameStore";
import type { TeamMatchRolesData } from "../../store/types";
import { buildPitchRows, translatePositionAbbreviation } from "../squad/SquadTab.helpers";
import { getSlotXCoordinates } from "../tactics/TacticsTab.helpers";
import { PitchSurface, PitchToken, pitchRoleMarkers, type PitchFitTone } from "../ui";
import { ratingAt } from "./slotRatings";
import type { EnginePlayerData, PositionFit } from "./types";

/** The backend's familiarity, as the token's fit ring draws it. */
const FIT_TONE: Record<PositionFit, PitchFitTone> = {
  Natural: "exact",
  Adapted: "adapted",
  Unfamiliar: "out",
};

interface FormationSlot {
  player: EnginePlayerData;
  x: number;
  y: number;
  /** Granular formation slot (e.g. "CenterBack") — only in slot-aligned mode. */
  slotPosition?: string;
  /** He has been sent off: his slot is still his, but he plays no part. */
  isSentOff?: boolean;
}

/**
 * Slot-aligned layout: the engine XI is ordered so entry i plays formation
 * slot i (team_builder keeps this invariant, including through swaps and
 * substitutions), which lets us place each player at their actual granular
 * slot instead of re-bucketing by coarse position group. Returns null when
 * the invariant can't hold (player count ≠ slot count), so the caller can
 * fall back to the grouped layout.
 */
function buildSlotAlignedSlots(
  formation: string,
  players: EnginePlayerData[],
  sentOff: string[],
): FormationSlot[] | null {
  const rows = buildPitchRows(formation);
  const slotCount = rows.reduce((sum, row) => sum + row.positions.length, 0);
  if (slotCount !== players.length) {
    return null;
  }

  const slots: FormationSlot[] = [];
  let slotIndex = 0;
  for (const row of rows) {
    const y = Number.parseFloat(row.y);
    const xs = getSlotXCoordinates(row.positions.length);
    row.positions.forEach((slotPosition, colIdx) => {
      const player = players[slotIndex];
      slotIndex += 1;
      // A sent-off player keeps his slot on the teamsheet. Drawing it, rather
      // than leaving a hole, gives the manager something to drop a player onto
      // when he wants to fill the gap.
      slots.push({
        player,
        x: xs[colIdx] ?? 50,
        y: Number.isFinite(y) ? y : 50,
        slotPosition,
        isSentOff: sentOff.includes(player.id),
      });
    });
  }
  return slots;
}

export function buildFormationSlots(
  formation: string,
  players: EnginePlayerData[],
  sentOff: string[] = [],
): FormationSlot[] {
  const active = players.filter((p) => !sentOff.includes(p.id));
  const nums = formation.split("-").map(Number);
  // A valid formation has at least three lines (def-mid-fwd). Anything shorter
  // or non-numeric ("442", "5-5", "abc") can't be laid out by the row logic
  // below without dropping the midfield/forward rows, so fall back to an even
  // single-row spread that still renders every player.
  if (nums.length < 3 || nums.some((n) => Number.isNaN(n))) {
    return active.map((p, i) => ({
      player: p,
      x: Math.round((100 * (i + 1)) / (active.length + 1)),
      y: 50,
    }));
  }

  const gks = active.filter((p) => p.position === "Goalkeeper");
  const defs = active.filter((p) => p.position === "Defender");
  const mids = active.filter((p) => p.position === "Midfielder");
  const fwds = active.filter((p) => p.position === "Forward");

  const rows: EnginePlayerData[][] = [gks];
  const n = nums.length;
  let midCursor = 0;
  for (let i = 0; i < n; i++) {
    const count = nums[i];
    // Never drop a player: put every defender in the back line, every forward up
    // top, and let the last midfield row absorb any remaining midfielders. A
    // lopsided XI (e.g. an AI side that ended up a defender short) then still
    // renders all 11 rather than silently hiding the overflow.
    if (i === 0) rows.push(defs);
    else if (i === n - 1) rows.push(fwds);
    else if (i === n - 2) rows.push(mids.slice(midCursor));
    else {
      rows.push(mids.slice(midCursor, midCursor + count));
      midCursor += count;
    }
  }

  const bottom = 85;
  const top = 15;
  const step = rows.length > 1 ? (bottom - top) / (rows.length - 1) : 0;
  return rows.flatMap((rowPlayers, rowIdx) => {
    const y = Math.round(bottom - rowIdx * step);
    return rowPlayers.map((p, colIdx) => ({
      player: p,
      x: rowPlayers.length === 1 ? 50 : Math.round((100 * (colIdx + 1)) / (rowPlayers.length + 1)),
      y,
    }));
  });
}

interface FormationPitchProps {
  formation: string;
  players: EnginePlayerData[];
  sentOff?: string[];
  selectedId?: string | null;
  subbedOnIds?: Set<string>;
  onPlayerClick?: (id: string) => void;
  /**
   * Makes the tokens draggable: dropping one player on another calls this with
   * both ids, and the caller decides what the drop means (e.g. trading slots).
   */
  onPlayerDrop?: (draggedId: string, targetId: string) => void;
  /** Sizes the pitch; its height follows the tactics board's 8:10 shape. */
  className?: string;
  /** Duties drawn as markers on the tokens: C, PK, FK, CK. */
  roles?: Partial<TeamMatchRolesData>;
  /** A control under a token's name, e.g. the pre-match role picker. */
  renderTokenExtra?: (player: EnginePlayerData, slotPosition?: string) => ReactNode;
}

/**
 * A side's XI on the shared pitch, with the shared token — the same look as the
 * tactics board — for the pre-match screen, the substitution panel and the
 * half-time break. Each token shows the player's face, his slot, his rating
 * there and how familiar it is to him (from the backend's slot ratings).
 */
export function FormationPitch({
  formation,
  players,
  sentOff = [],
  selectedId,
  subbedOnIds,
  onPlayerClick,
  onPlayerDrop,
  className = "",
  roles,
  renderTokenExtra,
}: FormationPitchProps) {
  const { t } = useTranslation();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  // Faces and match names live on the full player, not the match snapshot.
  const squad = useGameStore((state) => state.gameState?.players);
  const squadById = useMemo(() => new Map((squad ?? []).map((p) => [p.id, p])), [squad]);
  const slots =
    buildSlotAlignedSlots(formation, players, sentOff) ??
    buildFormationSlots(formation, players, sentOff);

  return (
    <PitchSurface className={className}>
      <div className="aspect-[8/10] w-full">
        {slots.map(({ player: p, x, y, slotPosition, isSentOff }) => {
          const isSelected = selectedId === p.id;
          const isSubOn = subbedOnIds?.has(p.id) ?? false;
          const isDragged = draggedId === p.id;
          const isDropTarget = dropTargetId === p.id && !isDragged;
          const full = squadById.get(p.id);
          const position = slotPosition ?? p.position;
          // His rating in the slot he stands in, which the engine plays him at.
          const slotRating = slotPosition ? ratingAt(p, slotPosition) : undefined;
          const token = (
            <PitchToken
              name={(full?.match_name || p.name).toUpperCase()}
              positionAbbr={translatePositionAbbreviation(t, position)}
              position={position}
              ovr={slotRating?.ovr ?? p.ovr}
              condition={p.condition}
              fitTone={slotRating ? FIT_TONE[slotRating.fit] : "empty"}
              avatar={full ?? { full_name: p.name, match_name: p.name }}
              markers={pitchRoleMarkers(roles, p.id)}
            >
              {!isSentOff && renderTokenExtra?.(p, slotPosition)}
            </PitchToken>
          );
          const wrapperClass = `absolute z-20 flex w-[6rem] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5 rounded-2xl px-1 py-1 text-center transition-all ${
            isSelected ? "bg-accent-500/15 shadow-lg ring-2 ring-accent-300/60" : ""
          } ${isDragged ? "opacity-60" : ""} ${isDropTarget ? "bg-primary-500/10 shadow-lg ring-2 ring-white/80" : ""}`;
          const style = { left: `${x}%`, top: `${y}%` };

          const dropHandlers = onPlayerDrop
            ? {
                onDragOver: (e: DragEvent<HTMLDivElement>) => {
                  if (!draggedId || draggedId === p.id) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDropTargetId(p.id);
                },
                onDragLeave: () => {
                  setDropTargetId((current) => (current === p.id ? null : current));
                },
                onDrop: (e: DragEvent<HTMLDivElement>) => {
                  e.preventDefault();
                  const fromId = draggedId ?? e.dataTransfer.getData("text/plain");
                  setDraggedId(null);
                  setDropTargetId(null);
                  // A sent-off player is never a drag source, whatever the event claims.
                  if (fromId && fromId !== p.id && !sentOff.includes(fromId)) {
                    onPlayerDrop(fromId, p.id);
                  }
                },
              }
            : {};

          if (isSentOff) {
            // Still a drop target, so a player can be moved into the gap; never a
            // drag source or a click target: he cannot move or come off himself.
            return (
              <div
                key={p.id}
                data-testid={`pitch-token-${p.id}`}
                role="img"
                aria-label={`${p.name} — ${t("match.eventTypes.RedCard")}`}
                className={wrapperClass}
                style={style}
                {...dropHandlers}
              >
                <div className="flex w-full flex-col items-center gap-0.5 opacity-40 grayscale">
                  {token}
                </div>
                <span
                  aria-hidden="true"
                  className="absolute left-1/2 top-3 h-5 w-3.5 -translate-x-1/2 rounded-sm bg-red-600 shadow-md ring-1 ring-white/60"
                />
              </div>
            );
          }

          const dragHandlers = onPlayerDrop
            ? {
                draggable: true,
                onDragStart: (e: DragEvent<HTMLDivElement>) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", p.id);
                  setDraggedId(p.id);
                },
                onDragEnd: () => {
                  setDraggedId(null);
                  setDropTargetId(null);
                },
                ...dropHandlers,
              }
            : {};

          const content = (
            <>
              {isSubOn && (
                <span className="absolute -left-1 top-8 z-30 font-heading text-[10px] font-bold text-success-400 drop-shadow">
                  ▲
                </span>
              )}
              {token}
            </>
          );

          if (onPlayerClick) {
            // div-with-button-role rather than <button>: the token can embed a
            // control (the role picker), which HTML forbids inside a <button>.
            return (
              <div
                key={p.id}
                data-testid={`pitch-token-${p.id}`}
                role="button"
                tabIndex={0}
                aria-label={p.name}
                className={`${wrapperClass} cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-300/70`}
                style={style}
                {...dragHandlers}
                onClick={() => onPlayerClick(p.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onPlayerClick(p.id);
                  }
                }}
              >
                {content}
              </div>
            );
          }
          return (
            <div
              key={p.id}
              data-testid={`pitch-token-${p.id}`}
              className={wrapperClass}
              style={style}
              {...dragHandlers}
            >
              {content}
            </div>
          );
        })}
      </div>
    </PitchSurface>
  );
}
