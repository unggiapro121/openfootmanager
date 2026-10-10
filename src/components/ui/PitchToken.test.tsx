import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PitchSurface } from "./PitchSurface";
import { PitchToken, pitchRoleMarkers } from "./PitchToken";

describe("PitchToken", () => {
  // Given a player on a pitch, then the token shows his face in the ring, his
  // slot and rating badges and his name — the same token on every pitch.
  it("shows the avatar, the slot, the rating and the name", () => {
    render(
      <PitchToken
        name="CUTRONE"
        positionAbbr="ST"
        position="Striker"
        ovr={76}
        condition={90}
        fitTone="exact"
        avatar={{ full_name: "Patrick Cutrone", match_name: "Cutrone" }}
      />,
    );

    expect(screen.getByTestId("pitch-token-avatar")).toBeInTheDocument();
    expect(screen.getByText("ST")).toBeInTheDocument();
    expect(screen.getByText("76")).toBeInTheDocument();
    expect(screen.getByText("CUTRONE")).toBeInTheDocument();
  });

  // Given a player out of position, then his ring is red.
  it("rings the avatar by how familiar the slot is", () => {
    render(<PitchToken name="X" positionAbbr="ST" ovr={52} condition={90} fitTone="out" />);

    expect(screen.getByTestId("pitch-token-avatar")).toHaveClass("ring-red-400");
  });
});

describe("pitchRoleMarkers", () => {
  // Given a captain who also takes penalties, then he carries C then PK; a
  // player with no duty carries nothing.
  it("marks a player's duties in a fixed order", () => {
    const roles = { captain: "a", penalty_taker: "a", free_kick_taker: "b", corner_taker: null };

    expect(pitchRoleMarkers(roles, "a").map((marker) => marker.shortLabel)).toEqual(["C", "PK"]);
    expect(pitchRoleMarkers(roles, "c")).toEqual([]);
    expect(pitchRoleMarkers(undefined, "a")).toEqual([]);
  });
});

describe("PitchSurface", () => {
  // Given a pitch, then its markings are decoration, hidden from screen
  // readers, and whatever is laid on it is rendered.
  it("draws the markings and lays the content over them", () => {
    const { container } = render(
      <PitchSurface>
        <span>token</span>
      </PitchSurface>,
    );

    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("token")).toBeInTheDocument();
  });
});
