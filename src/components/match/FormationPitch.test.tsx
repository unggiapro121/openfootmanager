import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FormationPitch } from "./FormationPitch";
import type { EnginePlayerData } from "./types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const POSITIONS = [
  "Goalkeeper",
  "Defender",
  "Defender",
  "Defender",
  "Defender",
  "Midfielder",
  "Midfielder",
  "Midfielder",
  "Midfielder",
  "Forward",
  "Forward",
];

function eleven(): EnginePlayerData[] {
  return POSITIONS.map(
    (position, index) =>
      ({
        id: `p${index}`,
        name: `Player ${index}`,
        position,
        ovr: 70,
        condition: 90,
        traits: [],
        role: "Standard",
      }) as unknown as EnginePlayerData,
  );
}

function dataTransfer(draggedId: string) {
  return {
    setData: vi.fn(),
    getData: () => draggedId,
    effectAllowed: "",
    dropEffect: "",
  };
}

function drag(fromId: string, toId: string) {
  const transfer = dataTransfer(fromId);
  fireEvent.dragStart(screen.getByTestId(`pitch-token-${fromId}`), { dataTransfer: transfer });
  fireEvent.dragOver(screen.getByTestId(`pitch-token-${toId}`), { dataTransfer: transfer });
  fireEvent.drop(screen.getByTestId(`pitch-token-${toId}`), { dataTransfer: transfer });
}

describe("FormationPitch with a sent-off player", () => {
  // Given a defender sent off, then his slot stays on the pitch, marked with a
  // red card, instead of leaving a hole with nothing to drop onto.
  it("keeps the sent-off player's slot, marked with a red card", () => {
    render(<FormationPitch formation="4-4-2" players={eleven()} sentOff={["p2"]} />);

    expect(screen.getByTestId("pitch-token-p2")).toHaveAttribute(
      "aria-label",
      "Player 2 — match.eventTypes.RedCard",
    );
  });

  // Given a forward dragged onto the sent-off defender, then the drop reports
  // both, so the caller can move the forward into the gap.
  it("accepts a player dropped onto the sent-off player's slot", () => {
    const onPlayerDrop = vi.fn();
    render(
      <FormationPitch
        formation="4-4-2"
        players={eleven()}
        sentOff={["p2"]}
        onPlayerDrop={onPlayerDrop}
      />,
    );

    drag("p9", "p2");

    expect(onPlayerDrop).toHaveBeenCalledWith("p9", "p2");
  });

  // Given a sent-off player, then he cannot be dragged and clicking him does
  // nothing: he cannot be taken off or moved on his own.
  it("does not let the sent-off player be dragged or picked", () => {
    const onPlayerDrop = vi.fn();
    const onPlayerClick = vi.fn();
    render(
      <FormationPitch
        formation="4-4-2"
        players={eleven()}
        sentOff={["p2"]}
        onPlayerDrop={onPlayerDrop}
        onPlayerClick={onPlayerClick}
      />,
    );

    const sentOff = screen.getByTestId("pitch-token-p2");
    expect(sentOff).not.toHaveAttribute("draggable", "true");
    fireEvent.click(sentOff);
    expect(onPlayerClick).not.toHaveBeenCalled();

    drag("p2", "p3");
    expect(onPlayerDrop).not.toHaveBeenCalled();
  });

  // Given a defender in the striker's slot, then his token — the shared one,
  // with his face — shows the slot, his rating there, and a red ring: he is out
  // of position.
  it("shows each token's slot and rating there", () => {
    const players = eleven();
    players[9] = {
      ...players[9],
      position_ratings: [
        { position: "CenterBack", ovr: 80, fit: "Natural" },
        { position: "Striker", ovr: 52, fit: "Unfamiliar" },
      ],
    };
    render(<FormationPitch formation="4-4-2" players={players} />);

    const token = screen.getByTestId("pitch-token-p9");
    expect(token).toHaveTextContent("52");
    expect(token).toHaveTextContent("common.posAbbr.Striker");
    expect(within(token).getByTestId("pitch-token-avatar")).toHaveClass("ring-red-400");
  });
});
