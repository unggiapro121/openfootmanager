import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlayerPreviewCard } from "./PlayerPreviewCard";
import type { PlayerDef } from "./types";

// Mock react-i18next so translation keys render verbatim; this lets us assert
// that the footedness value goes through t() rather than printing the raw enum.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

function makePlayer(overrides: Partial<PlayerDef>): PlayerDef {
  return {
    id: "p1",
    firstName: "Ada",
    lastName: "Lovelace",
    name: "Ada Lovelace",
    club: "",
    nationality: "GB",
    position: "Midfielder",
    footedness: "Right",
    dateOfBirth: null,
    photo: null,
    overall: 70,
    attributes: null,
    ...overrides,
  } as PlayerDef;
}

describe("PlayerPreviewCard", () => {
  it("renders the footedness through the translation layer, not the raw enum", () => {
    render(<PlayerPreviewCard editing={makePlayer({ footedness: "Left" })} photoDataUrl={null} />);
    expect(screen.getByText("common.footedness.Left")).toBeInTheDocument();
    // The bare enum value must not leak into the rendered output.
    expect(screen.queryByText("Left")).not.toBeInTheDocument();
  });

  it("labels every attribute by its full name, so the two long skills stay apart", () => {
    render(<PlayerPreviewCard editing={makePlayer({ overall: 70 })} photoDataUrl={null} />);
    // A three-letter cut made both of these "LON".
    expect(screen.getByText("common.attributes.long_passing")).toBeInTheDocument();
    expect(screen.getByText("common.attributes.long_shots")).toBeInTheDocument();
  });

  it("estimates the new technical attributes from the overall rating", () => {
    render(
      <PlayerPreviewCard
        editing={makePlayer({ overall: 70, position: "Striker" })}
        photoDataUrl={null}
      />,
    );
    for (const key of ["crossing", "curve", "free_kick", "heading", "first_touch"]) {
      const row = screen.getByText(`common.attributes.${key}`).closest("div");
      expect(row?.textContent).toContain("70");
    }
  });

  it("omits the footedness row for right-footed players (the default)", () => {
    render(<PlayerPreviewCard editing={makePlayer({ footedness: "Right" })} photoDataUrl={null} />);
    // The whole row is gone — assert on the row label, not just the value, so a
    // raw "Right" or other fallback value can't slip through.
    expect(screen.queryByText(/worldEditor\.playerFoot/)).not.toBeInTheDocument();
    expect(screen.queryByText("common.footedness.Right")).not.toBeInTheDocument();
  });
});
