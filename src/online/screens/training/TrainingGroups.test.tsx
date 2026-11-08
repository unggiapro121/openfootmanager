import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TrainingRosterPlayer } from "../../../components/training/trainingGroupsModel";
import type { TrainingGroupData } from "../../../store/types";
import { PhoneGroups } from "./phone/PhoneGroups";
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

  // Given the server's fits: the keeper's group focus lifts nothing, the centre-back's own focus
  // is his best, and the striker's fit was read for a focus he no longer trains,
  // when the table shows,
  // then the keeper's row says to switch, the centre-back's that it is his best, and the
  // striker's nothing.
  it("shows how each player's focus suits him", () => {
    groups({
      focusFits: {
        gk: { current: "Defending", best: "Tactical", verdict: "nothing" },
        cb: { current: "Tactical", best: "Tactical", verdict: "best" },
        st: { current: "Technical", best: "Attacking", verdict: "poor" },
      },
    });
    expect(
      within(rowOf("Thủ Môn")).getByText(
        "online.training.focusHint.nothing:training.focuses.Defending.label|training.focuses.Tactical.label",
      ),
    ).toBeInTheDocument();
    expect(
      within(rowOf("Trung Vệ")).getByText("online.training.focusHint.best"),
    ).toBeInTheDocument();
    expect(within(rowOf("Tiền Đạo")).queryByText(/online\.training\.focusHint/)).toBeNull();
  });

  // Given a season whose keepers train their own drill,
  // when the groups tab shows the squad,
  // then the keeper's row carries the drill's badge and no other row does; a season without
  // the drill shows none.
  it("marks the keeper who trains the keepers' drill", () => {
    const view = render(
      <TrainingGroups
        groups={GROUPS}
        teamFocus="Physical"
        roster={ROSTER}
        keeperDrill
        disabled={false}
        onSaveGroups={vi.fn()}
        onSetPlayerFocus={vi.fn()}
      />,
    );
    expect(within(rowOf("Thủ Môn")).getByText("online.training.keeperBadge")).toBeInTheDocument();
    expect(screen.getAllByText("online.training.keeperBadge")).toHaveLength(1);
    view.unmount();

    groups();
    expect(screen.queryByText("online.training.keeperBadge")).toBeNull();
  });

  // Given the same season on a phone,
  // when the groups tab lists the squad,
  // then only the keeper's line carries the badge.
  it("marks the keeper on a phone too", () => {
    render(
      <PhoneGroups
        groups={GROUPS}
        teamFocus="Physical"
        roster={ROSTER}
        keeperDrill
        disabled={false}
        onSaveGroups={vi.fn()}
        onSetPlayerFocus={vi.fn()}
      />,
    );
    const badges = screen.getAllByText("online.training.keeperBadge");
    expect(badges).toHaveLength(1);
    expect(badges[0].closest("li")).toHaveTextContent("Thủ Môn");
  });

  // T-C3 (C-13b C13b-3): a club on "Auto".
  // Given a club on Auto, a forward in no group with no focus of his own whom Auto puts on
  // Defending today, and a keeper in a group whose focus lifts nothing,
  // when the table shows,
  // then the forward reads "Auto · Defending" with no hint under it, and the keeper his group's
  // focus with its hint, as before.
  it("names the focus Auto picks for a player who follows the club", () => {
    groups({
      teamAuto: true,
      focusFits: {
        gk: { current: "Defending", best: "Tactical", verdict: "nothing" },
        st: { current: "Defending", best: "Defending", verdict: "best" },
      },
    });
    expect(
      within(rowOf("Tiền Đạo")).getByText(
        "online.training.groups.inherited:online.training.focus.autoPick:training.focuses.Defending.label",
      ),
    ).toBeInTheDocument();
    expect(within(rowOf("Tiền Đạo")).queryByText(/online\.training\.focusHint/)).toBeNull();
    expect(
      within(rowOf("Thủ Môn")).getByText(
        "online.training.groups.inherited:training.focuses.Defending.label",
      ),
    ).toBeInTheDocument();
    expect(
      within(rowOf("Thủ Môn")).getByText(
        "online.training.focusHint.nothing:training.focuses.Defending.label|training.focuses.Tactical.label",
      ),
    ).toBeInTheDocument();
  });

  // Given a club on Auto and a forward the server gives no fit (injured, or at his peak),
  // when the table shows,
  // then he reads "Auto" alone.
  it("reads only Auto for a player the server gives no fit", () => {
    groups({ teamAuto: true });
    expect(
      within(rowOf("Tiền Đạo")).getByText(
        "online.training.groups.inherited:online.training.focus.auto",
      ),
    ).toBeInTheDocument();
  });
});
