import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GameStateData } from "../../store/gameStore";
import type { TacticsPhaseSettings } from "../../store/types";
import { useTacticsLibrary } from "./useTacticsLibrary";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, p?: Record<string, unknown> | string) =>
      typeof p === "object" && p && "count" in p ? `${key}#${p.count}` : key,
  }),
}));

const PHASE_A = {
  build_up_style: "Short",
  width: "Wide",
  tempo: "Patient",
  defensive_line: "High",
  pressing_intensity: "High",
  defensive_shape: "Compact",
  marking_style: "Zonal",
  counter_press_duration: "Long",
  break_speed: "Fast",
} as unknown as TacticsPhaseSettings;
const PHASE_B = { ...PHASE_A, build_up_style: "Long", width: "Narrow" } as TacticsPhaseSettings;

// Stands in for the team and the backend: formation, play style and blueprint
// change only through the library's callbacks, and every change is a new game.
function useHarness(initialPhase: TacticsPhaseSettings = PHASE_A) {
  const [setup, setSetup] = useState({
    formation: "4-1-4-1",
    playStyle: "Possession",
    phase: initialPhase,
  });
  const [gameState, setGameState] = useState(
    () =>
      ({
        manager: { id: "m1", team_id: "t1" },
        clock: { start_date: "2025-07-01" },
      }) as unknown as GameStateData,
  );
  const bump = () => setGameState((g) => ({ ...g }));
  const lib = useTacticsLibrary({
    gameState,
    formation: setup.formation,
    activePlayStyle: setup.playStyle,
    initialPreset: null,
    tacticsPhase: setup.phase,
    onFormationChange: async (formation) => {
      await Promise.resolve();
      setSetup((s) => ({ ...s, formation }));
      bump();
      return true;
    },
    onPlayStyleChange: async (playStyle) => {
      await Promise.resolve();
      setSetup((s) => ({ ...s, playStyle }));
      bump();
      return true;
    },
    onTacticsPhaseChange: async (phase) => {
      await Promise.resolve();
      setSetup((s) => ({ ...s, phase }));
      bump();
    },
  });
  return { lib, setup, setSetup };
}

function customNames(lib: ReturnType<typeof useTacticsLibrary>): string[] {
  return lib.tacticLibrary.filter((entry) => entry.type === "custom").map((entry) => entry.name);
}

describe("useTacticsLibrary", () => {
  beforeEach(() => localStorage.clear());

  /**
   * Given two saved tactics with different shapes and blueprints,
   * When the manager switches from one to the other and back,
   * Then each puts back its own setup and neither saved entry changes.
   */
  it("keeps two custom tactics apart when switching between them", async () => {
    const { result } = renderHook(() => useHarness());
    act(() => result.current.lib.handleSaveTactic());
    const aId = result.current.lib.activeTactic.id;
    act(() => result.current.lib.handleCreateCustomTactic());
    const bId = result.current.lib.activeTactic.id;
    act(() =>
      result.current.setSetup({ formation: "3-5-2", playStyle: "Counter", phase: PHASE_B }),
    );
    act(() => result.current.lib.handleSaveTactic());
    const entry = (id: string) => {
      const found = result.current.lib.tacticLibrary.find((candidate) => candidate.id === id);
      if (!found) throw new Error(`tactic ${id} is not in the library`);
      return found;
    };

    await act(async () => {
      await result.current.lib.applyTacticSelection(entry(aId));
    });
    expect(result.current.setup).toEqual({
      formation: "4-1-4-1",
      playStyle: "Possession",
      phase: PHASE_A,
    });

    await act(async () => {
      await result.current.lib.applyTacticSelection(entry(bId));
    });
    expect(result.current.lib.activeTactic.id).toBe(bId);
    expect(result.current.setup).toEqual({
      formation: "3-5-2",
      playStyle: "Counter",
      phase: PHASE_B,
    });
    expect(result.current.lib.isCommandBarDirty).toBe(false);
    expect(entry(aId)).toMatchObject({ formation: "4-1-4-1", phase: PHASE_A });
    expect(entry(bId)).toMatchObject({ formation: "3-5-2", phase: PHASE_B });
  });

  /**
   * Given two saved tactics that share a shape and differ only in blueprint,
   * When the tactics screen reopens while the team plays the second one,
   * Then the second one is shown as active, not a stand-in named like the first.
   */
  it("reopens on the saved tactic the team is playing", () => {
    const first = renderHook(() => useHarness());
    act(() => first.result.current.lib.handleSaveTactic());
    act(() => first.result.current.lib.handleCreateCustomTactic());
    const bId = first.result.current.lib.activeTactic.id;
    act(() => first.result.current.setSetup((setup) => ({ ...setup, phase: PHASE_B })));
    act(() => first.result.current.lib.handleSaveTactic());
    first.unmount();

    const second = renderHook(() => useHarness(PHASE_B));

    expect(second.result.current.lib.activeTactic.id).toBe(bId);
    expect(second.result.current.lib.isCommandBarDirty).toBe(false);
  });

  /**
   * Given the unsaved stand-in for a setup no tactic matches,
   * When it is saved,
   * Then the saved tactic gets a numbered name, not the stand-in's generic one.
   */
  it("never saves the stand-in under the generic name", () => {
    const { result } = renderHook(() => useHarness());
    expect(result.current.lib.activeTactic.id).toBe("current:setup");

    act(() => result.current.lib.handleSaveTactic());

    expect(customNames(result.current.lib)).toEqual(["tactics.customTacticNumber#1"]);
  });

  /**
   * Given tactics 1 and 2 where tactic 1 was deleted,
   * When a new tactic is created,
   * Then it does not take the name tactic 2 already carries.
   */
  it("gives a new tactic a name no saved tactic carries", () => {
    const { result } = renderHook(() => useHarness());
    act(() => result.current.lib.handleCreateCustomTactic());
    const firstId = result.current.lib.activeTactic.id;
    act(() => result.current.lib.handleCreateCustomTactic());
    act(() => result.current.lib.handleDeleteTactic(firstId));
    act(() => result.current.lib.handleCreateCustomTactic());

    const names = customNames(result.current.lib);
    expect(new Set(names).size).toBe(names.length);
  });
});
