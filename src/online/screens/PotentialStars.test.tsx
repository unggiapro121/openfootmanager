import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PotentialStars from "./PotentialStars";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${Object.values(options).join("|")}` : key,
  }),
}));

const kinds = () =>
  Array.from(screen.getByRole("img").querySelectorAll("[data-star]")).map((star) =>
    star.getAttribute("data-star"),
  );

describe("PotentialStars", () => {
  // Given a youngster known to have 2 to 4 stars (C-7c),
  // when his stars are drawn,
  // then two are filled, two outlined and one faint, and the range is said.
  it("draws a range of stars", () => {
    render(<PotentialStars range={[2, 4]} />);
    expect(kinds()).toEqual(["sure", "sure", "maybe", "maybe", "none"]);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "online.squad.potentialStarsRange:2|4",
    );
  });

  // Given a range whose two ends meet, and a plain number of stars,
  // when they are drawn,
  // then both read as that many stars.
  it("draws a closed range as plain stars", () => {
    const { unmount } = render(<PotentialStars range={[3, 3]} />);
    expect(kinds()).toEqual(["sure", "sure", "sure", "none", "none"]);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "online.squad.potentialStars:3",
    );
    unmount();
    render(<PotentialStars stars={3} />);
    expect(kinds()).toEqual(["sure", "sure", "sure", "none", "none"]);
  });
});
