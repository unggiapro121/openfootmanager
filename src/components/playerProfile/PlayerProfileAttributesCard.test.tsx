import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { squadPlayer } from "../../test-utils/onlineTestKit";
import PlayerProfileAttributesCard from "./PlayerProfileAttributesCard";

function renderCard() {
  render(
    <PlayerProfileAttributesCard
      attrGroups={[
        { label: "Physical", attrs: [{ key: "pace", name: "Pace", value: 70 }], average: 70 },
      ]}
      player={{ attributes: squadPlayer().attributes }}
      isOwnClub
      title="Attributes"
      ovr={70}
      ovrLabel="OVR"
      averageLabel="Average"
      hiddenTitle="Hidden"
      hiddenBody="Scout him"
      listLabel="List"
      radarLabel="Radar"
    />,
  );
}

describe("the attributes card", () => {
  // Given an own-club player's attributes,
  // when the card first shows,
  // then it opens on the radar, and the list is one tap away.
  it("opens on the radar", () => {
    renderCard();

    expect(screen.getByRole("button", { name: "Radar" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(screen.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Pace")).toBeInTheDocument();
  });
});
