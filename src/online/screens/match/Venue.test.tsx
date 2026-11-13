import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { VenueView } from "../../api";
import { VenueBlock, VenueLine } from "./Venue";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      options && typeof options === "object"
        ? `${key}:${Object.values(options as Record<string, unknown>).join("|")}`
        : key,
    i18n: { language: "en" },
  }),
}));

const VENUE: VenueView = {
  stadiumName: "Sân Vinh",
  attendance: 8_000,
  capacity: 9_000,
  soldOut: false,
  lockedOut: 0,
};

describe("the crowd of a league match (c-27 §7.2)", () => {
  // Given a friendly, which has no venue, then a league match,
  // when the kick-off line is drawn,
  // then the friendly has none and the league match names its ground and crowd.
  it("names the ground and crowd of a league match only", () => {
    const { container, rerender } = render(<VenueLine venue={null} />);
    expect(container.textContent).toBe("");

    rerender(<VenueLine venue={VENUE} />);
    expect(screen.getByText("online.match.attendance.line:Sân Vinh|8,000")).toBeTruthy();
  });

  // Given a match whose season shows the atmosphere,
  // when its crowd is drawn,
  // then the word is there, and the word's own block holds no figure.
  it("says the atmosphere as a word with no figure", () => {
    render(<VenueBlock venue={VENUE} atmosphere="electric" />);

    const label = screen.getByTestId("atmosphere");
    expect(label.textContent).toBe("online.match.attendance.atmosphere.electric");
    expect(label.textContent).not.toMatch(/\d/);
    expect(screen.queryByText(/online\.match\.attendance\.fill:/)).toBeNull();
    expect(screen.getByText("online.match.attendance.count:8,000|9,000|Sân Vinh")).toBeTruthy();
  });

  // Given a season that shows no atmosphere,
  // when the crowd is drawn,
  // then the fill takes the word's place.
  it("says the fill where the season shows no atmosphere", () => {
    render(<VenueBlock venue={VENUE} />);

    expect(screen.queryByTestId("atmosphere")).toBeNull();
    expect(screen.getAllByText("online.match.attendance.fill:89%").length).toBeGreaterThan(0);
  });

  // Given a sold-out match,
  // when its crowd is drawn,
  // then it says sold out and the fans the server counted outside.
  it("says a sold-out ground and the fans left outside", () => {
    render(
      <VenueBlock
        venue={{ ...VENUE, attendance: 9_000, soldOut: true, lockedOut: 1_300 }}
        atmosphere="lively"
      />,
    );

    expect(screen.getByText("online.match.attendance.soldOut")).toBeTruthy();
    expect(screen.getByText("online.match.attendance.lockedOut:1,300")).toBeTruthy();
  });

  // Given a friendly,
  // when the full-time crowd is drawn,
  // then there is none.
  it("draws no crowd for a friendly", () => {
    const { container } = render(<VenueBlock venue={null} />);
    expect(container.textContent).toBe("");
  });
});
