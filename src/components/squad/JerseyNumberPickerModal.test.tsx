import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GameStateData, PlayerData } from "../../store/gameStore";
import { createPlayer } from "../../test-utils/factories";
import JerseyNumberPickerModal from "./JerseyNumberPickerModal";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Echo the key with its interpolation values, so a test can see both.
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
    i18n: { language: "en" },
  }),
}));

const mockedInvoke = vi.mocked(invoke);

function shirt(id: string, matchName: string, jerseyNumber: number | null): PlayerData {
  return createPlayer({ id, match_name: matchName, jersey_number: jerseyNumber });
}

const updatedGame = { players: [] } as unknown as GameStateData;

function renderPicker(player: PlayerData, squad: PlayerData[]) {
  const onClose = vi.fn();
  const onAssigned = vi.fn();
  render(
    <JerseyNumberPickerModal
      player={player}
      squad={squad}
      onClose={onClose}
      onAssigned={onAssigned}
    />,
  );
  return { onClose, onAssigned };
}

describe("JerseyNumberPickerModal", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  /** Given a player in #7, when a free number is picked, then he takes it without a swap. */
  it("assigns a free number straight away", async () => {
    mockedInvoke.mockResolvedValue(updatedGame);
    const player = shirt("p1", "Wilson", 7);
    const { onClose, onAssigned } = renderPicker(player, [player]);

    fireEvent.click(screen.getByRole("button", { name: "#15" }));

    await waitFor(() => expect(onAssigned).toHaveBeenCalledWith(updatedGame));
    expect(mockedInvoke).toHaveBeenCalledWith("assign_jersey_number", {
      playerId: "p1",
      jerseyNumber: 15,
      swapWithHolder: false,
    });
    expect(onClose).toHaveBeenCalled();
  });

  /** Given #10 is worn by a teammate, when it is picked and the swap confirmed, then both trade. */
  it("asks before taking a teammate's number, then swaps", async () => {
    mockedInvoke.mockResolvedValue(updatedGame);
    const player = shirt("p1", "Wilson", 7);
    const holder = shirt("p2", "King", 10);
    const { onAssigned } = renderPicker(player, [player, holder]);

    fireEvent.click(
      screen.getByRole("button", {
        name: 'squad.jerseyPickerTakenBy {"number":10,"name":"King"}',
      }),
    );

    expect(mockedInvoke).not.toHaveBeenCalled();
    expect(
      screen.getByText('squad.jerseyPickerSwapPrompt {"number":10,"holder":"King"}'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('squad.jerseyPickerSwapGetsOld {"holder":"King","number":7}'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "squad.jerseyPickerSwapConfirm" }));

    await waitFor(() => expect(onAssigned).toHaveBeenCalledWith(updatedGame));
    expect(mockedInvoke).toHaveBeenCalledWith("assign_jersey_number", {
      playerId: "p1",
      jerseyNumber: 10,
      swapWithHolder: true,
    });
  });

  /** Given a player with no number, when he takes a teammate's, then the teammate is told he loses his. */
  it("warns that the holder is left without a number when there is none to give back", () => {
    const player = shirt("p1", "Wilson", null);
    const holder = shirt("p2", "King", 10);
    renderPicker(player, [player, holder]);

    fireEvent.click(
      screen.getByRole("button", {
        name: 'squad.jerseyPickerTakenBy {"number":10,"name":"King"}',
      }),
    );

    expect(
      screen.getByText('squad.jerseyPickerSwapGetsNone {"holder":"King"}'),
    ).toBeInTheDocument();
  });

  /** Given the swap question is open, when it is cancelled, then nothing changes. */
  it("backs out of a swap without assigning anything", () => {
    const player = shirt("p1", "Wilson", 7);
    const holder = shirt("p2", "King", 10);
    const { onClose } = renderPicker(player, [player, holder]);

    fireEvent.click(
      screen.getByRole("button", {
        name: 'squad.jerseyPickerTakenBy {"number":10,"name":"King"}',
      }),
    );
    fireEvent.keyDown(window, { key: "Escape" });

    expect(mockedInvoke).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "#15" })).toBeInTheDocument();
  });

  /** Given a player in #7, when "remove number" is pressed, then his shirt is cleared. */
  it("removes the player's number", async () => {
    mockedInvoke.mockResolvedValue(updatedGame);
    const player = shirt("p1", "Wilson", 7);
    const { onAssigned } = renderPicker(player, [player]);

    fireEvent.click(screen.getByRole("button", { name: "squad.jerseyPickerClear" }));

    await waitFor(() => expect(onAssigned).toHaveBeenCalled());
    expect(mockedInvoke).toHaveBeenCalledWith("assign_jersey_number", {
      playerId: "p1",
      jerseyNumber: null,
      swapWithHolder: false,
    });
  });

  /** Given a player with no number, then there is nothing to remove. */
  it("disables removing a number the player does not have", () => {
    const player = shirt("p1", "Wilson", null);
    renderPicker(player, [player]);

    expect(screen.getByRole("button", { name: "squad.jerseyPickerClear" })).toBeDisabled();
  });

  /** Given the backend refuses, then the error is shown and the picker stays open. */
  it("shows a refused assignment and stays open", async () => {
    mockedInvoke.mockRejectedValue("be.error.jerseyNumberTaken");
    const player = shirt("p1", "Wilson", 7);
    const { onClose, onAssigned } = renderPicker(player, [player]);

    fireEvent.click(screen.getByRole("button", { name: "#15" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(onAssigned).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  /** Given a player in #7, then #7 is marked as his and picking it again does nothing. */
  it("marks the current number and ignores picking it again", () => {
    const player = shirt("p1", "Wilson", 7);
    renderPicker(player, [player]);

    const current = screen.getByRole("button", { name: "#7" });
    expect(current).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(current);

    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});
