import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { StaffData, WatchedProspect } from "../../store/types";
import { createPlayer } from "../../test-utils/factories";
import ScoutingWatchlistCard from "./ScoutingWatchlistCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === "inbox.youthProspectRange") return `${params?.low}–${params?.high}`;
      if (key === "scouting.watchlistWeeksLeft") return `${params?.weeks} wk left`;
      if (key === "scouting.watchlistScoutLoad") return `${params?.name} (${params?.count}/3)`;
      return key;
    },
    i18n: { language: "en" },
  }),
}));

function scout(id: string, name: string): StaffData {
  return {
    id,
    first_name: name,
    last_name: "Scout",
    date_of_birth: "1985-01-01",
    nationality: "GB",
    role: "Scout",
    attributes: { coaching: 20, judgingAbility: 70, judgingPotential: 70, physiotherapy: 10 },
    team_id: "team-1",
    specialization: null,
    wage: 0,
    contract_end: null,
  };
}

function watched(id: string, scoutId: string | null = null): WatchedProspect {
  return {
    prospect: createPlayer({ id, full_name: `Kid ${id}`, position: "Midfielder" }),
    estimate: {
      prospect_id: id,
      ovr_low: 55,
      ovr_high: 63,
      ovr_band: 5,
      potential_low: 70,
      potential_high: 86,
      potential_band: 8,
    },
    scout_id: scoutId,
    added_on: "2026-08-03",
    expires_on: "2026-10-26",
  };
}

function renderCard(overrides: Partial<React.ComponentProps<typeof ScoutingWatchlistCard>> = {}) {
  const props: React.ComponentProps<typeof ScoutingWatchlistCard> = {
    watchlist: [watched("p1")],
    scouts: [scout("s1", "Ana"), scout("s2", "Ben")],
    currentDate: "2026-08-10T12:00:00Z",
    busy: false,
    onAssignScout: vi.fn(),
    onSign: vi.fn(),
    onUnwatch: vi.fn(),
    ...overrides,
  };
  render(<ScoutingWatchlistCard {...props} />);
  return props;
}

describe("ScoutingWatchlistCard", () => {
  it("lists each watched prospect with his ranges and weeks left", () => {
    renderCard();

    const row = screen.getByRole("row", { name: /Kid p1/ });
    expect(row).toHaveTextContent("55–63");
    expect(row).toHaveTextContent("70–86");
    expect(row).toHaveTextContent("11 wk left");
  });

  it("says so when nobody is being watched", () => {
    renderCard({ watchlist: [] });

    expect(screen.getByText("scouting.watchlistEmpty")).toBeInTheDocument();
  });

  it("assigns a scout, and takes him off again", () => {
    const props = renderCard();
    const picker = screen.getByRole("combobox", { name: "scouting.watchlistScoutFor" });

    fireEvent.click(picker);
    fireEvent.click(screen.getByRole("option", { name: "Ana (0/3)" }));
    expect(props.onAssignScout).toHaveBeenCalledWith("p1", "s1");

    fireEvent.click(picker);
    fireEvent.click(screen.getByRole("option", { name: "scouting.watchlistNoScout" }));
    expect(props.onAssignScout).toHaveBeenCalledWith("p1", null);
  });

  it("does not offer a scout who already follows three others", () => {
    renderCard({
      watchlist: [watched("p1"), watched("a", "s1"), watched("b", "s1"), watched("c", "s1")],
    });
    const row = screen.getByRole("row", { name: /Kid p1/ });

    fireEvent.click(within(row).getByRole("combobox", { name: "scouting.watchlistScoutFor" }));

    expect(screen.queryByRole("option", { name: "Ana (3/3)" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Ben (0/3)" })).toBeInTheDocument();
  });

  it("signs or lets go of a prospect", () => {
    const props = renderCard();
    const row = screen.getByRole("row", { name: /Kid p1/ });

    fireEvent.click(within(row).getByRole("button", { name: "scouting.watchlistSign" }));
    fireEvent.click(within(row).getByRole("button", { name: "scouting.watchlistUnwatch" }));

    expect(props.onSign).toHaveBeenCalledWith("p1");
    expect(props.onUnwatch).toHaveBeenCalledWith("p1");
  });
});
