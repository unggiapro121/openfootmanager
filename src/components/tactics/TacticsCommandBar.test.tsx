import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import TacticsCommandBar, { type TacticsLibraryEntry } from "./TacticsCommandBar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) => {
      if (key === "tactics.playStyleWithMastery" && typeof fallback === "object") {
        return `${fallback.style} · ${fallback.value}`;
      }
      return typeof fallback === "string" ? fallback : key;
    },
    i18n: { language: "en" },
  }),
}));

afterEach(() => {
  vi.useRealTimers();
});

const customTactic: TacticsLibraryEntry = {
  description: "A custom tactic",
  formation: "4-4-2",
  id: "custom:1",
  name: "My Tactic",
  playStyle: "Balanced",
  sourcePresetName: null,
  type: "custom",
};

const presetTactic: TacticsLibraryEntry = {
  description: "A preset tactic",
  formation: "4-3-3",
  id: "preset:balanced-control",
  name: "Balanced Control",
  playStyle: "Balanced",
  sourcePresetName: null,
  type: "preset",
};

function buildProps(
  overrides: Partial<React.ComponentProps<typeof TacticsCommandBar>> = {},
): React.ComponentProps<typeof TacticsCommandBar> {
  return {
    activeTactic: customTactic,
    activePlayStyle: "Balanced",
    formation: "4-4-2",
    isDirty: false,
    onCreateNew: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onTacticNameChange: vi.fn(),
    tacticName: customTactic.name,
    onFormationChange: vi.fn(),
    onPlayStyleChange: vi.fn(),
    onSave: vi.fn(),
    onSelectTactic: vi.fn(),
    tacticLibrary: [customTactic, presetTactic],
    ...overrides,
  };
}

function renderCommandBar(overrides: Partial<React.ComponentProps<typeof TacticsCommandBar>> = {}) {
  return render(<TacticsCommandBar {...buildProps(overrides)} />);
}

/** The dialog's confirm button: rendered last of the controls sharing its name. */
function lastButton(name: string): HTMLElement {
  const buttons = screen.getAllByRole("button", { name });
  return buttons[buttons.length - 1];
}

describe("TacticsCommandBar", () => {
  /**
   * Given a saved custom tactic, when the command bar is shown, then the name
   * field stays out of the way until the manager renames it from its row in the
   * list, next to its delete button.
   */
  it("opens the name field from the rename button on a tactic's row", () => {
    renderCommandBar({ activeTactic: customTactic });

    expect(screen.queryByRole("textbox", { name: "tactics.tacticName" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "tactics.chooseTactic" }));
    fireEvent.click(screen.getByRole("button", { name: "tactics.renameTacticNamed" }));

    const nameInput = screen.getByRole("textbox", { name: "tactics.tacticName" });
    expect(nameInput).toHaveFocus();
    expect(nameInput).toHaveValue("My Tactic");
  });

  /**
   * Given a custom tactic that is not the one in use, when its rename button is
   * pressed, then it is selected first so the rename applies to it.
   */
  it("selects another tactic before renaming it", () => {
    const onSelectTactic = vi.fn();
    renderCommandBar({
      activeTactic: presetTactic,
      onSelectTactic,
      tacticName: "Balanced Control",
    });

    fireEvent.click(screen.getByRole("button", { name: "tactics.chooseTactic" }));
    fireEvent.click(screen.getByRole("button", { name: "tactics.renameTacticNamed" }));

    expect(onSelectTactic).toHaveBeenCalledWith("custom:1");
  });

  /**
   * Given the name field open on a renamed draft, when Escape is pressed, then
   * the field closes and the draft goes back to the saved name.
   */
  it("cancels a rename with Escape", () => {
    const onTacticNameChange = vi.fn();
    renderCommandBar({ activeTactic: customTactic, onTacticNameChange, tacticName: "Draft" });

    fireEvent.click(screen.getByRole("button", { name: "tactics.chooseTactic" }));
    fireEvent.click(screen.getByRole("button", { name: "tactics.renameTacticNamed" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "tactics.tacticName" }), {
      key: "Escape",
    });

    expect(onTacticNameChange).toHaveBeenCalledWith("My Tactic");
    expect(screen.queryByRole("textbox", { name: "tactics.tacticName" })).toBeNull();
  });

  /**
   * Given the tactic list, when it is open, then only the manager's own tactics
   * can be renamed: a preset's name is not his to change.
   */
  it("offers rename only on the manager's own tactics", () => {
    renderCommandBar({ activeTactic: presetTactic, tacticName: presetTactic.name });

    fireEvent.click(screen.getByRole("button", { name: "tactics.chooseTactic" }));

    expect(screen.getAllByRole("button", { name: "tactics.renameTacticNamed" })).toHaveLength(1);
  });

  it("disables the save button when the active custom tactic is already synced", () => {
    renderCommandBar({ activeTactic: customTactic, isDirty: false });

    expect(screen.getByRole("button", { name: "tactics.updateTactic" })).toBeDisabled();
  });

  it("enables the save button once the active custom tactic has unsaved changes", () => {
    renderCommandBar({ activeTactic: customTactic, isDirty: true });

    expect(screen.getByRole("button", { name: "tactics.updateTactic" })).toBeEnabled();
  });

  it("keeps the save button enabled for a preset even when nothing changed", () => {
    // Saving a preset always creates a new custom tactic, so it is never a
    // no-op even when isDirty is false.
    renderCommandBar({ activeTactic: presetTactic, isDirty: false });

    expect(screen.getByRole("button", { name: "tactics.saveAsTactic" })).toBeEnabled();
  });

  it("shows a temporary Saved confirmation after a successful save click", () => {
    vi.useFakeTimers();
    const onSave = vi.fn();
    const props = buildProps({ activeTactic: customTactic, isDirty: true, onSave });

    const { rerender } = render(<TacticsCommandBar {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "tactics.updateTactic" }));
    expect(onSave).toHaveBeenCalledTimes(1);

    // A successful save syncs the stored tactic, so the parent re-renders
    // with isDirty flipped back to false.
    rerender(<TacticsCommandBar {...props} isDirty={false} />);

    expect(screen.getByRole("button", { name: "tactics.tacticSaved" })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByRole("button", { name: "tactics.updateTactic" })).toBeInTheDocument();
  });

  it("clears the Saved cue immediately when new edits make the tactic dirty again mid-cue", () => {
    vi.useFakeTimers();
    const onSave = vi.fn();
    const props = buildProps({
      activeTactic: customTactic,
      isDirty: true,
      onSave,
    });

    const { rerender } = render(<TacticsCommandBar {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "tactics.updateTactic" }));

    // The save synced the tactic — parent re-renders with isDirty: false —
    // so the "Saved" cue becomes visible.
    rerender(<TacticsCommandBar {...props} isDirty={false} />);
    expect(screen.getByRole("button", { name: "tactics.tacticSaved" })).toBeInTheDocument();

    // The user edits the tactic again before the 2s cue timeout fires.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    rerender(<TacticsCommandBar {...props} isDirty />);

    const saveButton = screen.getByRole("button", {
      name: "tactics.updateTactic",
    });
    expect(saveButton).toBeInTheDocument();
    expect(saveButton).toBeEnabled();
    expect(screen.queryByRole("button", { name: "tactics.tacticSaved" })).not.toBeInTheDocument();
  });

  /**
   * Given a saved custom tactic selected, when delete is pressed and confirmed,
   * then that tactic is deleted.
   */
  it("deletes the selected custom tactic after confirming", () => {
    const onDelete = vi.fn();
    renderCommandBar({ activeTactic: customTactic, onDelete });

    fireEvent.click(screen.getByRole("button", { name: "tactics.deleteTactic" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    fireEvent.click(lastButton("tactics.deleteTactic"));

    expect(onDelete).toHaveBeenCalledWith("custom:1");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  /** Given the confirmation is open, when it is cancelled, then nothing is deleted. */
  it("keeps the tactic when the confirmation is cancelled", () => {
    const onDelete = vi.fn();
    renderCommandBar({ activeTactic: customTactic, onDelete });

    fireEvent.click(screen.getByRole("button", { name: "tactics.deleteTactic" }));
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  /** Given a preset selected, then there is nothing of the user's to delete. */
  it("offers no delete for a preset", () => {
    renderCommandBar({ activeTactic: presetTactic });

    expect(screen.queryByRole("button", { name: "tactics.deleteTactic" })).not.toBeInTheDocument();
  });

  /** Given the tactic list open, then each saved tactic can be deleted from its row. */
  it("deletes a custom tactic from its row in the list", () => {
    const onDelete = vi.fn();
    const other: TacticsLibraryEntry = { ...customTactic, id: "custom:2", name: "Other" };
    renderCommandBar({
      activeTactic: presetTactic,
      onDelete,
      tacticLibrary: [customTactic, other, presetTactic],
    });

    fireEvent.click(screen.getByRole("button", { name: "tactics.chooseTactic" }));
    // The fake translator drops the name, so pick the second row's control.
    fireEvent.click(screen.getAllByRole("button", { name: "tactics.deleteTacticNamed" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "tactics.deleteTactic" }));

    expect(onDelete).toHaveBeenCalledWith("custom:2");
  });

  /**
   * Given a head coach strong at Counter, when the play style picker shows the
   * active style, then it carries the coach's mastery of it.
   */
  it("shows the head coach's mastery beside the play style", () => {
    renderCommandBar({
      activePlayStyle: "Counter",
      coach: {
        id: "mgr_user",
        first_name: "Jane",
        last_name: "Doe",
        date_of_birth: "1980-01-01",
        nationality: "GB",
        reputation: 500,
        satisfaction: 50,
        fan_approval: 50,
        team_id: "team-1",
        career_stats: {
          matches_managed: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          trophies: 0,
          best_finish: null,
        },
        career_history: [],
        play_style_mastery: { Counter: 72 },
      },
    });

    expect(screen.getByRole("combobox", { name: "tactics.playStyle" })).toHaveTextContent(
      "Counter · 72",
    );
  });

  /** Without a coach, the picker names the styles alone. */
  it("names the play style alone when there is no coach", () => {
    renderCommandBar({ activePlayStyle: "Counter" });

    expect(screen.getByRole("combobox", { name: "tactics.playStyle" })).toHaveTextContent(
      /^Counter$/,
    );
  });
});
