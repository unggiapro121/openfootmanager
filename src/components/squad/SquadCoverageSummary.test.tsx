import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import SquadCoverageSummary from "./SquadCoverageSummary";
import type { SquadRoleCoverage } from "./SquadTab.helpers";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === "squad.coverageTitle") return "Role coverage";
      if (key === "squad.coverageStable") return "Coverage is stable";
      if (key === "squad.coverageNeedsAttention") return `${params?.count} roles need cover`;
      if (key === "squad.coverageBadge") {
        return `starters ${params?.starters}/${params?.required} · bench ${params?.bench}`;
      }
      return key;
    },
  }),
}));

function coverage(role: string, overrides: Partial<SquadRoleCoverage> = {}): SquadRoleCoverage {
  return {
    role,
    requiredSlots: 1,
    naturalStarters: 1,
    benchOptions: 2,
    status: "covered",
    ...overrides,
  };
}

describe("SquadCoverageSummary", () => {
  // Given every role covered, then one line shows the verdict and the
  // per-role badges stay folded away.
  it("shows one line with the verdict and keeps the roles folded", () => {
    render(<SquadCoverageSummary roleCoverage={[coverage("CB"), coverage("ST")]} />);

    const toggle = screen.getByRole("button", { name: /Role coverage/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Coverage is stable")).toBeInTheDocument();
    expect(screen.queryByText(/starters 1\/1/)).not.toBeInTheDocument();
  });

  // Given the folded summary, when it is clicked, then each role's starters and
  // bench are listed, and a second click folds them again.
  it("unfolds each role's detail on click and folds it again", () => {
    render(<SquadCoverageSummary roleCoverage={[coverage("CB"), coverage("ST")]} />);
    const toggle = screen.getByRole("button", { name: /Role coverage/ });

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByText(/starters 1\/1 · bench 2/)).toHaveLength(2);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/starters 1\/1/)).not.toBeInTheDocument();
  });

  // Given roles short of cover, then the one line says how many, so the
  // problem shows without unfolding.
  it("counts the roles short of cover on the folded line", () => {
    render(
      <SquadCoverageSummary
        roleCoverage={[
          coverage("CB", { status: "thin", benchOptions: 0 }),
          coverage("ST", { status: "uncovered", naturalStarters: 0 }),
          coverage("GK"),
        ]}
      />,
    );

    expect(screen.getByText("2 roles need cover")).toBeInTheDocument();
  });
});
