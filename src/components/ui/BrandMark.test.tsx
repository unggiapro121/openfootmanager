import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BrandLockup, BrandSymbol, BrandWordmark } from "./BrandMark";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({ "app.name": "Eleven Saga", "app.tagline": "Write your club's story" })[key] ?? key,
  }),
}));

describe("the brand mark", () => {
  // Given the app's name "Eleven Saga",
  // when the name is shown stacked (the sidebars) and on one line,
  // then both read as the two words, "Saga" in gold.
  it("writes the name with its last word in gold", () => {
    const { container, unmount } = render(<BrandWordmark stacked onDark />);
    expect(container).toHaveTextContent("Eleven Saga");
    expect(screen.getByText("Saga")).toHaveClass("text-accent-400");
    unmount();
    render(<BrandWordmark />);
    expect(screen.getByText("Saga")).toHaveClass("text-accent-700", "dark:text-accent-400");
  });

  // Given the symbol alone, with a name and without,
  // when it shows,
  // then it is an image named for the app only when named, and hidden from readers otherwise.
  it("names the symbol only when it stands for the app", () => {
    const { unmount } = render(<BrandSymbol label="Eleven Saga" />);
    expect(screen.getByRole("img", { name: "Eleven Saga" })).toBeInTheDocument();
    unmount();
    const { container } = render(<BrandSymbol />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("img")).toBeNull();
  });

  // Given the stacked lockup with its tagline (the main menu),
  // when it shows,
  // then the name and the tagline are there.
  it("shows the tagline under the name when asked", () => {
    render(
      <BrandLockup layout="vertical" tagline symbolClassName="h-10 w-10" nameClassName="text-xl" />,
    );
    expect(screen.getByText("Eleven")).toBeInTheDocument();
    expect(screen.getByText("Write your club's story")).toBeInTheDocument();
  });
});
