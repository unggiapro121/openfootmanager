import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { TrainingGroupData } from "../../store/types";
import TrainingGroupsCard from "./TrainingGroupsCard";
import type { TrainingRosterPlayer } from "./trainingGroupsModel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, _params?: Record<string, string | number>, fallback?: string) => {
      if (key === "training.groups.trainingGroups") return "Training Groups";
      if (key === "training.groups.noGroups") return "No groups";
      if (key === "training.groups.addGroup") return "Add Group";
      if (key === "training.groups.trainingGroupsDesc") return "Groups description";
      if (key === "training.groups.teamDefault") return "Team Default";
      if (key === "training.groups.group") return "Group";
      if (key === "training.effectiveFocus") return "Effective Focus";
      if (key === "training.groups.removeGroup") return "Remove Group";
      if (key.startsWith("training.groups.defaultGroupNames.")) return fallback ?? "Group";
      if (key.startsWith("training.focuses.")) return key.replace("training.focuses.", "");
      if (key === "common.player") return "Player";
      if (key === "common.position") return "Position";
      return fallback ?? key;
    },
  }),
}));

const FOCUS_IDS = ["Physical", "Technical", "Recovery"];

function player(overrides: Partial<TrainingRosterPlayer> = {}): TrainingRosterPlayer {
  return {
    id: "player-1",
    match_name: "J. Smith",
    position: "Forward",
    natural_position: "Forward",
    condition: 80,
    training_focus: null,
    ...overrides,
  };
}

const GROUP: TrainingGroupData = {
  id: "grp-1",
  name: "Youngsters",
  focus: "Technical",
  player_ids: [],
};

function renderCard(props: Partial<React.ComponentProps<typeof TrainingGroupsCard>> = {}) {
  const onSaveGroups = vi.fn();
  const onSetPlayerFocus = vi.fn();
  render(
    <TrainingGroupsCard
      groups={[]}
      teamFocus="Physical"
      roster={[player()]}
      isSaving={false}
      onSaveGroups={onSaveGroups}
      onSetPlayerFocus={onSetPlayerFocus}
      trainingFocusIds={FOCUS_IDS}
      trainingFocusIcons={{}}
      {...props}
    />,
  );
  return { onSaveGroups, onSetPlayerFocus };
}

describe("TrainingGroupsCard", () => {
  // Given a club with no training groups,
  // when the card is shown,
  // then it says there are none.
  it("renders the empty groups state", () => {
    renderCard();

    expect(screen.getByText("Training Groups")).toBeInTheDocument();
    expect(screen.getByText("No groups")).toBeInTheDocument();
  });

  // Given a club with no groups,
  // when the coach adds one,
  // then the new group, with the default session, is handed over to be saved.
  it("adds a training group and hands it over", () => {
    const { onSaveGroups } = renderCard();

    fireEvent.click(screen.getByRole("button", { name: /Add Group/i }));

    expect(onSaveGroups).toHaveBeenCalledTimes(1);
    const [groups] = onSaveGroups.mock.calls[0] as [TrainingGroupData[]];
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ focus: "Physical", player_ids: [] });
  });

  // Given a club with five groups,
  // when the card is shown,
  // then no group can be added.
  it("offers no sixth group", () => {
    const five = Array.from({ length: 5 }, (_, index) => ({ ...GROUP, id: `grp-${index}` }));
    renderCard({ groups: five });

    expect(screen.queryByRole("button", { name: /Add Group/i })).not.toBeInTheDocument();
  });

  // Given a group and a player in none,
  // when the coach puts the player in the group, and then picks a session for him alone,
  // then the group is handed over with him in it, and his own session is handed over.
  it("moves a player into a group and sets his own session", () => {
    const { onSaveGroups, onSetPlayerFocus } = renderCard({ groups: [GROUP] });

    const [groupSelect, focusSelect] = screen
      .getAllByRole("combobox")
      .filter((select) => select.closest("td"));
    fireEvent.click(groupSelect);
    fireEvent.click(screen.getByRole("option", { name: "Youngsters" }));
    expect(onSaveGroups).toHaveBeenCalledWith([{ ...GROUP, player_ids: ["player-1"] }]);

    fireEvent.click(focusSelect);
    fireEvent.click(screen.getByRole("option", { name: /Recovery/ }));
    expect(onSetPlayerFocus).toHaveBeenCalledWith("player-1", "Recovery");

    fireEvent.click(focusSelect);
    fireEvent.click(screen.getByRole("option", { name: /↩/ }));
    expect(onSetPlayerFocus).toHaveBeenLastCalledWith("player-1", null);
  });

  // Given a group,
  // when the coach types a new name and leaves the field,
  // then the group is handed over once, with the new name; typing alone hands over nothing.
  it("renames a group when the field is left", () => {
    const { onSaveGroups } = renderCard({ groups: [GROUP] });

    const name = screen.getByDisplayValue("Youngsters");
    fireEvent.change(name, { target: { value: "Under 21" } });
    expect(onSaveGroups).not.toHaveBeenCalled();

    fireEvent.blur(name);
    expect(onSaveGroups).toHaveBeenCalledTimes(1);
    expect(onSaveGroups).toHaveBeenCalledWith([{ ...GROUP, name: "Under 21" }]);
  });

  // Given a group,
  // when the coach empties its name and leaves the field,
  // then nothing is handed over and the old name comes back.
  it("keeps the old name when the new one is empty", () => {
    const { onSaveGroups } = renderCard({ groups: [GROUP] });

    const name = screen.getByDisplayValue("Youngsters");
    fireEvent.change(name, { target: { value: "  " } });
    fireEvent.blur(name);

    expect(onSaveGroups).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Youngsters")).toBeInTheDocument();
  });
});
