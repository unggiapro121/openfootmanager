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

describe("PitchToken stacked layout", () => {
  const captainAndPenalties = pitchRoleMarkers({ captain: "a", penalty_taker: "a" }, "a");

  // Given the tactics board's compact token, then the slot and the rating sit
  // together in one pill under the face, followed by the name.
  it("puts the slot and the rating in one pill under the avatar", () => {
    render(
      <PitchToken
        layout="stacked"
        name="CUTRONE"
        positionAbbr="ST"
        position="Striker"
        ovr={76}
        condition={90}
        fitTone="exact"
      />,
    );

    const pill = screen.getByText("ST").parentElement;
    expect(pill).toHaveTextContent("ST76");
    expect(screen.getByText("CUTRONE")).toBeInTheDocument();
  });

  // Given a captain who also takes penalties, then the corner badge shows
  // only the captaincy: other duties live in the detail card, and the badge
  // is kept for the captain.
  it("shows only the captaincy on the corner badge", () => {
    render(
      <PitchToken
        layout="stacked"
        name="X"
        positionAbbr="CM"
        ovr={60}
        condition={80}
        markers={captainAndPenalties}
      />,
    );

    expect(screen.getByTestId("pitch-token-role-dot")).toHaveTextContent(/^C$/);
    expect(screen.queryByText("PK")).not.toBeInTheDocument();
  });

  // Given a player who takes penalties, free kicks and corners but is not
  // captain, then no badge is drawn on his token.
  it("draws no badge for duties other than the captaincy", () => {
    const takerOnly = pitchRoleMarkers(
      { vice_captain: "a", penalty_taker: "a", free_kick_taker: "a", corner_taker: "a" },
      "a",
    );
    render(
      <PitchToken
        layout="stacked"
        name="X"
        positionAbbr="CM"
        ovr={60}
        condition={80}
        markers={takerOnly}
      />,
    );

    expect(screen.queryByTestId("pitch-token-role-dot")).not.toBeInTheDocument();
  });

  // Given a player with no duty, then no dot is drawn.
  it("draws no dot for a player without duties", () => {
    render(<PitchToken layout="stacked" name="X" positionAbbr="CM" ovr={60} condition={80} />);

    expect(screen.queryByTestId("pitch-token-role-dot")).not.toBeInTheDocument();
  });

  // Given the selected starter, then his ring turns white whatever his fit.
  it("rings the selected player in white", () => {
    render(
      <PitchToken
        layout="stacked"
        selected
        name="X"
        positionAbbr="ST"
        ovr={52}
        condition={90}
        fitTone="out"
      />,
    );

    const avatar = screen.getByTestId("pitch-token-avatar");
    expect(avatar).toHaveClass("ring-white");
    expect(avatar).not.toHaveClass("ring-red-400");
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
