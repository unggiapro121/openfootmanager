import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TrainingRosterPlayer } from "../../../components/training/trainingGroupsModel";
import type { TrainingGroupData } from "../../../store/types";
import TrainingGroups from "./TrainingGroups";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      options && typeof options === "object"
        ? `${key}:${Object.values(options as Record<string, unknown>).join("|")}`
        : key,
    i18n: { language: "en" },
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}));

const ROSTER: TrainingRosterPlayer[] = [
  { id: "gk", match_name: "Thủ Môn", position: "Goalkeeper", condition: 90 },
  {
    id: "cb",
    match_name: "Trung Vệ",
    position: "Defender",
    condition: 60,
    training_focus: "Tactical",
  },
  { id: "st", match_name: "Tiền Đạo", position: "Forward", condition: 40 },
];
const GROUPS: TrainingGroupData[] = [
  { id: "g1", name: "Keepers", focus: "Defending", player_ids: ["gk"] },
];

function groups(overrides: Partial<Parameters<typeof TrainingGroups>[0]> = {}) {
  const props = {
    groups: GROUPS,
    teamFocus: "Physical",
    roster: ROSTER,
    disabled: false,
    onSaveGroups: vi.fn(),
    onSetPlayerFocus: vi.fn(),
    ...overrides,
  };
  render(<TrainingGroups {...props} />);
  return props;
}

const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;

describe("the training groups tab", () => {
  // Given a group of one keeper in a squad of three,
  // when the coach picks the group's chip, then "All",
  // then the table shows the keeper alone, then all three again.
  it("filters the table by a group's chip", () => {
    groups();
    expect(screen.getAllByRole("row")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Keepers (1)" }));
    expect(screen.getByRole("button", { name: "Keepers (1)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getAllByRole("row")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "online.training.groups.all:3" }));
    expect(screen.getAllByRole("row")).toHaveLength(4);
  });

  // Given the keepers' group chosen,
  // when the coach renames it and then removes it,
  // then each change sends the groups as they should be: renamed, then none.
  it("renames and removes the chosen group", () => {
    const props = groups();
    fireEvent.click(screen.getByRole("button", { name: "Keepers (1)" }));
    const name = screen.getByRole("textbox", { name: "training.groups.group" });
    fireEvent.change(name, { target: { value: "Goalies" } });
    fireEvent.blur(name);
    expect(props.onSaveGroups).toHaveBeenLastCalledWith([{ ...GROUPS[0], name: "Goalies" }]);
    fireEvent.click(screen.getByRole("button", { name: "training.groups.removeGroup" }));
    expect(props.onSaveGroups).toHaveBeenLastCalledWith([]);
  });

  // Given five groups, the most a club keeps,
  // when the tab shows,
  // then there is no button to add one.
  it("offers no sixth group", () => {
    const five = [0, 1, 2, 3, 4].map((index) => ({
      id: `g${index}`,
      name: `G${index}`,
      focus: "Physical",
      player_ids: [],
    }));
    groups({ groups: five });
    expect(screen.queryByRole("button", { name: /training\.groups\.addGroup/ })).toBeNull();
  });

  // Given a keeper in a Defending group, a defender with his own Tactical focus and a forward in
  // no group,
  // when the table shows,
  // then the keeper and the forward read the focus they inherit, tagged so; the defender his own.
  it("shows each player's focus, own or inherited", () => {
    groups();
    expect(
      within(rowOf("Thủ Môn")).getByText(
        "online.training.groups.inherited:training.focuses.Defending.label",
      ),
    ).toBeInTheDocument();
    expect(
      within(rowOf("Tiền Đạo")).getByText(
        "online.training.groups.inherited:training.focuses.Physical.label",
      ),
    ).toBeInTheDocument();
    expect(within(rowOf("Trung Vệ")).queryByText("online.training.groups.inheritedTag")).toBeNull();
    expect(
      within(rowOf("Thủ Môn")).getByText("online.training.groups.inheritedTag"),
    ).toBeInTheDocument();
  });
});
