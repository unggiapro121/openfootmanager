import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { StaffData, YouthScoutingAssignment } from "../../store/gameStore";
import ScoutingYouthRecruitmentCard from "./ScoutingYouthRecruitmentCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === "common.positions.Goalkeeper") return "Goalkeeper";
      if (key === "common.positions.Defender") return "Defender";
      if (key === "common.positions.Midfielder") return "Midfielder";
      if (key === "common.positions.Forward") return "Forward";
      if (key === "scouting.youthAnyPosition") return "Any position";
      if (key === "scouting.activeYouthSearches") {
        return `Active: ${params?.count ?? 0}`;
      }
      if (key === "scouting.youthSearchQuote") {
        return `Fee ${params?.fee} · ${params?.days} days`;
      }
      if (key === "scouting.scoutResting") return `Resting ${params?.days} more days`;
      return key;
    },
    i18n: { language: "en" },
  }),
}));

function createScout(overrides: Partial<StaffData> = {}): StaffData {
  return {
    id: "scout-1",
    first_name: "Sam",
    last_name: "Scout",
    date_of_birth: "1985-01-01",
    nationality: "GB",
    role: "Scout",
    attributes: {
      coaching: 20,
      judgingAbility: 65,
      judgingPotential: 70,
      physiotherapy: 10,
    },
    team_id: "team-1",
    specialization: null,
    wage: 0,
    contract_end: null,
    ...overrides,
  };
}

function renderCard(
  overrides: Partial<React.ComponentProps<typeof ScoutingYouthRecruitmentCard>> = {},
) {
  const defaults: React.ComponentProps<typeof ScoutingYouthRecruitmentCard> = {
    youthAssignments: [] as YouthScoutingAssignment[],
    scouts: [createScout()],
    availableScouts: [createScout()],
    isStarting: false,
    selectedScoutId: "scout-1",
    region: "Domestic",
    objective: "Balanced",
    targetPosition: "",
    onScoutChange: () => {},
    onRegionChange: () => {},
    onObjectiveChange: () => {},
    onTargetPositionChange: () => {},
    onStartSearch: () => {},
    onCancelSearch: () => {},
    onReassignSearch: () => {},
  };
  return render(<ScoutingYouthRecruitmentCard {...defaults} {...overrides} />);
}

describe("ScoutingYouthRecruitmentCard target-position dropdown", () => {
  it("offers Goalkeeper as a target position", () => {
    renderCard();

    fireEvent.click(screen.getByRole("combobox", { name: "scouting.youthTargetLabel" }));

    expect(screen.getByRole("option", { name: "Goalkeeper" })).toBeInTheDocument();
  });
});

describe("ScoutingYouthRecruitmentCard quote", () => {
  it("shows what the search will cost and how long it takes", () => {
    renderCard({ quote: { fee: 22_500, days: 6, rest_days_left: 0 } });

    expect(screen.getByText(/^Fee .*22,500 · 6 days$/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "scouting.startYouthSearch" })).toBeEnabled();
  });

  it("will not start a search while the scout is resting", () => {
    renderCard({ quote: { fee: 15_000, days: 5, rest_days_left: 3 } });

    expect(screen.getByText("Resting 3 more days")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "scouting.startYouthSearch" })).toBeDisabled();
  });

  it("announces a refused search", () => {
    renderCard({ errorMessage: "Not enough money" });

    expect(screen.getByRole("alert")).toHaveTextContent("Not enough money");
  });
});
