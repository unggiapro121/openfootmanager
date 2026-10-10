import type { GameStateData } from "../../store/gameStore";
import type { TacticsPhaseSettings } from "../../store/types";
import type { TacticsLibraryEntry } from "./TacticsCommandBar";

const TACTICS_STORAGE_KEY_PREFIX = "ofm:tactics:custom";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function getDefaultStorage(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const PHASE_FIELDS: readonly (keyof TacticsPhaseSettings)[] = [
  "build_up_style",
  "width",
  "tempo",
  "defensive_line",
  "pressing_intensity",
  "defensive_shape",
  "marking_style",
  "counter_press_duration",
  "break_speed",
];

/** Whether two phase blueprints set every phase the same way. */
export function isSamePhaseBlueprint(
  left: TacticsPhaseSettings,
  right: TacticsPhaseSettings,
): boolean {
  return PHASE_FIELDS.every((field) => left[field] === right[field]);
}

/**
 * The saved custom tactic the team is playing right now, if any: same
 * formation, play style and phase blueprint. A tactic saved before blueprints
 * were kept matches on its shape alone. The active tactic is not persisted, so
 * this is how the library finds it again when the tactics screen reopens.
 */
export function findCustomTacticForSetup(
  customTactics: readonly TacticsLibraryEntry[],
  formation: string,
  playStyle: string,
  phase: TacticsPhaseSettings | undefined,
): TacticsLibraryEntry | null {
  const sameShape = customTactics.filter(
    (entry) => entry.formation === formation && entry.playStyle === playStyle,
  );
  return (
    sameShape.find((entry) => entry.phase && phase && isSamePhaseBlueprint(entry.phase, phase)) ??
    sameShape.find((entry) => !entry.phase) ??
    null
  );
}

export function buildCustomTacticsStorageKey(gameState: GameStateData): string {
  return [
    TACTICS_STORAGE_KEY_PREFIX,
    gameState.manager.id,
    gameState.clock.start_date,
    gameState.manager.team_id ?? "no-team",
  ].join(":");
}

function isCustomTacticEntry(value: unknown): value is TacticsLibraryEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<TacticsLibraryEntry>;

  return (
    candidate.type === "custom" &&
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.description === "string" &&
    typeof candidate.formation === "string" &&
    typeof candidate.playStyle === "string"
  );
}

export function loadCustomTactics(
  gameState: GameStateData,
  storage: StorageLike | null = getDefaultStorage(),
): TacticsLibraryEntry[] {
  if (!storage) {
    return [];
  }

  try {
    const storedValue = storage.getItem(buildCustomTacticsStorageKey(gameState));

    if (!storedValue) {
      return [];
    }

    const parsedValue: unknown = JSON.parse(storedValue);

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue.filter(isCustomTacticEntry);
  } catch {
    return [];
  }
}

export function saveCustomTactics(
  gameState: GameStateData,
  customTactics: readonly TacticsLibraryEntry[],
  storage: StorageLike | null = getDefaultStorage(),
): void {
  if (!storage) {
    return;
  }

  const persistedTactics = customTactics.filter(
    (entry): entry is TacticsLibraryEntry => entry.type === "custom",
  );

  try {
    storage.setItem(buildCustomTacticsStorageKey(gameState), JSON.stringify(persistedTactics));
  } catch {
    // Storage quota exceeded or access denied — skip persist
  }
}
