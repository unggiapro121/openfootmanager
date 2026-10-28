import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { createPlayer } from "../../test-utils/factories";
import TacticsPitch from "./TacticsPitch";
import type { TacticsPitchSlot } from "./TacticsTab.helpers";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown> | string) =>
      typeof options === "object" && typeof options.name === "string"
        ? `${key}:${options.name}`
        : key,
    i18n: { language: "en" },
  }),
}));

const striker = createPlayer({
  id: "st",
  full_name: "Thanh Hai",
  match_name: "Thanh Hai",
  position: "Striker",
  natural_position: "Striker",
  condition: 87,
});
const keeper = createPlayer({
  id: "gk",
  full_name: "Van Lam",
  match_name: "Van Lam",
  position: "Goalkeeper",
  natural_position: "Goalkeeper",
  condition: 100,
});

const slots: TacticsPitchSlot[] = [
  { index: 0, player: keeper, position: "Goalkeeper", rowLabel: "GK", x: 50, y: 88 },
  { index: 1, player: striker, position: "Striker", rowLabel: "FWD", x: 50, y: 16 },
];

function renderPitch(overrides: Partial<ComponentProps<typeof TacticsPitch>> = {}) {
  const props: ComponentProps<typeof TacticsPitch> = {
    dragState: null,
    formation: "4-4-2",
    matchRoles: {
      captain: "st",
      vice_captain: null,
      penalty_taker: null,
      free_kick_taker: null,
      corner_taker: null,
    },
    playerRoles: {},
    comparePlayerId: null,
    hoveredSlot: null,
    onClearSelection: vi.fn(),
    onDragStart: vi.fn(),
    onDragEnd: vi.fn(),
    onLineupPlayerClick: vi.fn(),
    onRoleChange: vi.fn(),
    onSlotDragOver: vi.fn(),
    onSlotDragLeave: vi.fn(),
    onSlotDrop: vi.fn(),
    outOfPositionCount: 0,
    pitchSlots: slots,
    selectedPlayer: null,
    selectedPlayerId: null,
    ...overrides,
  };
  render(<TacticsPitch {...props} />);
  return props;
}

describe("TacticsPitch tokens", () => {
  /**
   * Given no starter is selected, when the board shows the XI, then every
   * token stays compact: no role picker on the pitch, each token collapsed.
   */
  it("keeps the role picker closed until a starter is selected", () => {
    renderPitch();

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByTestId("pitch-player-st")).toHaveAttribute("aria-expanded", "false");
  });

  /**
   * Given the captain is selected, when his card opens, then it shows his
   * condition, a role picker for his slot and his duties by code and name.
   */
  it("opens the selected starter's card with condition, role and duties", () => {
    renderPitch({ selectedPlayer: striker, selectedPlayerId: "st" });

    expect(screen.getByTestId("pitch-player-st")).toHaveAttribute("aria-expanded", "true");
    const card = screen.getByTestId("pitch-player-detail-st");
    expect(within(card).getByText("87%")).toBeInTheDocument();
    expect(
      within(card).getByRole("combobox", { name: "tactics.playerRoleLabel" }),
    ).toBeInTheDocument();
    const duty = within(card).getByRole("listitem");
    expect(duty).toHaveTextContent("C");
    expect(duty).toHaveTextContent("tactics.dutyShort.captain");
    expect(screen.queryByTestId("pitch-player-detail-gk")).not.toBeInTheDocument();
  });

  /**
   * Given the keeper with no duty is selected, then his card says so instead
   * of showing an empty duty list.
   */
  it("says when the selected starter carries no duty", () => {
    renderPitch({ selectedPlayer: keeper, selectedPlayerId: "gk" });

    const card = screen.getByTestId("pitch-player-detail-gk");
    expect(within(card).getByText("tactics.noSpecialRoles")).toBeInTheDocument();
    expect(within(card).queryByRole("listitem")).not.toBeInTheDocument();
  });

  /**
   * Given the striker's card is open, when the coach picks a role in it, then
   * the role change is sent and the click does not reach the pitch (which
   * would deselect him).
   */
  it("changes the role from the card without deselecting the starter", () => {
    const props = renderPitch({ selectedPlayer: striker, selectedPlayerId: "st" });

    const card = screen.getByTestId("pitch-player-detail-st");
    fireEvent.click(within(card).getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "tactics.playerRoles.Poacher" }));

    expect(props.onRoleChange).toHaveBeenCalledWith("st", "Poacher");
    expect(props.onLineupPlayerClick).not.toHaveBeenCalled();
  });

  /**
   * Given a card is open, when the coach presses Escape in it, then the
   * selection is cleared.
   */
  it("closes the card on Escape", () => {
    const props = renderPitch({ selectedPlayer: striker, selectedPlayerId: "st" });

    fireEvent.keyDown(screen.getByTestId("pitch-player-detail-st"), { key: "Escape" });

    expect(props.onClearSelection).toHaveBeenCalled();
  });

  /**
   * Given the keeper stands near the bottom edge, when his card opens, then it
   * opens above his token so the pitch does not clip it.
   */
  it("opens a low row's card above the token", () => {
    renderPitch({ selectedPlayer: keeper, selectedPlayerId: "gk" });

    expect(screen.getByTestId("pitch-player-detail-gk")).toHaveClass("bottom-15");
  });

  /**
   * Given a captain on the pitch, then his token is named for screen readers
   * with his slot, rating and duty.
   */
  it("names each token with its slot, rating and duties", () => {
    renderPitch();

    expect(
      screen.getByRole("button", {
        name: "tactics.tokenLabel:Thanh Hai, tactics.dutyShort.captain",
      }),
    ).toBe(screen.getByTestId("pitch-player-st"));
  });
});
