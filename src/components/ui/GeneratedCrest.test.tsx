import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CREST_PATTERNS, GeneratedCrest, crestPatternOf } from "./GeneratedCrest";

describe("GeneratedCrest", () => {
  it("renders the label inside an svg crest", () => {
    const { container } = render(<GeneratedCrest name="Media FC" label="MFC" />);

    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(screen.getByText("MFC")).toBeInTheDocument();
    // It is decorative — the accessible name comes from the surrounding label.
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("paints the club's primary colour when provided", () => {
    const { container } = render(
      <GeneratedCrest
        name="Media FC"
        label="MFC"
        colors={{ primary: "#ff0000", secondary: "#0000ff" }}
      />,
    );

    const fills = Array.from(container.querySelectorAll("[fill]")).map((node) =>
      node.getAttribute("fill"),
    );
    expect(fills).toContain("#ff0000");
    expect(fills).toContain("#0000ff");
  });

  it("is deterministic: the same name yields the same crest markup", () => {
    const first = render(<GeneratedCrest name="Alpha United" label="ALP" />);
    const firstHtml = first.container.innerHTML.replace(/id="[^"]*"|url\(#[^)]*\)/g, "");
    first.unmount();

    const second = render(<GeneratedCrest name="Alpha United" label="ALP" />);
    const secondHtml = second.container.innerHTML.replace(/id="[^"]*"|url\(#[^)]*\)/g, "");

    expect(secondHtml).toBe(firstHtml);
  });

  // Given a crest drawn with each pattern a coach may pick,
  // when it is rendered,
  // then it carries that pattern's shape: a half, a band, a sash or a diamond.
  it("draws the pattern it is given", () => {
    const shapes = {
      split: 'rect[x="32"]',
      band: 'rect[y="40"]',
      sash: 'polygon[points="0,0 30,0 0,64"]',
      diamond: 'polygon[points="32,2 62,32 32,62 2,32"]',
    } as const;
    for (const pattern of CREST_PATTERNS) {
      const { container, unmount } = render(
        <GeneratedCrest name="Alpha United" label="ALP" pattern={pattern} />,
      );
      expect(container.querySelector(shapes[pattern])).not.toBeNull();
      unmount();
    }
  });

  // Given a club with no pattern of its own,
  // when its crest is drawn,
  // then it takes the pattern its name gives, the one a crest editor starts from.
  it("draws the name's own pattern when given none", () => {
    const own = render(<GeneratedCrest name="Alpha United" label="ALP" />);
    const ownHtml = own.container.innerHTML.replace(/id="[^"]*"|url\(#[^)]*\)/g, "");
    own.unmount();
    const named = render(
      <GeneratedCrest name="Alpha United" label="ALP" pattern={crestPatternOf("Alpha United")} />,
    );
    expect(named.container.innerHTML.replace(/id="[^"]*"|url\(#[^)]*\)/g, "")).toBe(ownHtml);
  });
});
