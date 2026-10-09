import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { StaffData, WatchedProspect } from "../../store/types";
import { createPlayer, createTeam } from "../../test-utils/factories";
import ScoutingWatchlistCard from "./ScoutingWatchlistCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === "inbox.youthProspectRange") return `${params?.low}–${params?.high}`;
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
    report: {
      player_id: id,
      player_name: `Kid ${id}`,
      position: "Midfielder",
      nationality: "GB",
      dob: "2009-01-01",
      team_name: null,
      pace: 64,
      shooting: null,
      passing: null,
      dribbling: null,
      defending: null,
      physical: null,
      condition: null,
      morale: null,
      avg_rating: 59,
      rating_key: "common.scoutRatings.average",
      potential_key: "common.scoutPotential.strong",
      confidence_key: "common.scoutConfidence.moderate",
      height_cm: 178,
      weight_kg: 69,
      footedness: "Left",
      weak_foot: 3,
      attribute_reads: [{ key: "passing", low: 62, high: 66, band: 2 }],
    },
  };
}

function renderCard(overrides: Partial<React.ComponentProps<typeof ScoutingWatchlistCard>> = {}) {
  const props: React.ComponentProps<typeof ScoutingWatchlistCard> = {
    watchlist: [watched("p1")],
    scouts: [scout("s1", "Ana"), scout("s2", "Ben")],
    busy: false,
    onAssignScout: vi.fn(),
    onSign: vi.fn(),
    onUnwatch: vi.fn(),
    players: [],
    teams: [],
    onMakeOffer: vi.fn(),
    ...overrides,
  };
  render(<ScoutingWatchlistCard {...props} />);
  return props;
}

describe("ScoutingWatchlistCard", () => {
  it("lists each watched prospect as his scouts read him now", () => {
    renderCard();

    const row = screen.getByRole("row", { name: /Kid p1/ });
    expect(row).toHaveTextContent("~59");
    // The column is already headed Potential, so the cell says only how much.
    expect(row).toHaveTextContent("common.scoutPotentialShort.strong");
    expect(row).not.toHaveTextContent("55–63");
  });

  it("opens a prospect's detail form, ?? for what is not read yet", () => {
    const props = renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Kid p1" }));

    const dialog = screen.getByRole("dialog", { name: "Kid p1" });
    expect(dialog).toHaveTextContent("178");
    expect(dialog).toHaveTextContent("69");
    expect(dialog).toHaveTextContent("common.footedness.Left");
    const passing = within(dialog).getByTestId("prospect-attr-passing");
    expect(passing).toHaveTextContent("64");
    const vision = within(dialog).getByTestId("prospect-attr-vision");
    expect(vision).toHaveTextContent("??");
    expect(dialog).toHaveTextContent("~59");
    fireEvent.click(within(dialog).getByRole("button", { name: "scouting.watchlistSign" }));
    expect(props.onSign).toHaveBeenCalledWith("p1");

    fireEvent.click(within(dialog).getByRole("button", { name: "common.close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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

  it("shows each prospect's status, and offers to buy one another club signed", () => {
    const signedKid = createPlayer({ id: "p2", full_name: "Kid p2", team_id: "rival" });
    const props = renderCard({
      watchlist: [
        watched("p1"),
        { ...watched("p2"), signed_by: "Rival FC", signed_by_team_id: "rival" },
      ],
      players: [signedKid],
    });

    const free = screen.getByRole("row", { name: /Kid p1/ });
    expect(free).toHaveTextContent("scouting.watchlistStatusFree");
    expect(within(free).getByRole("button", { name: "scouting.watchlistSign" })).toBeEnabled();
    const signed = screen.getByRole("row", { name: /Kid p2/ });
    expect(signed).toHaveTextContent("Rival FC");
    expect(within(signed).queryByRole("button", { name: "scouting.watchlistSign" })).toBeNull();
    fireEvent.click(within(signed).getByRole("button", { name: "scouting.watchlistMakeOffer" }));
    expect(props.onMakeOffer).toHaveBeenCalledWith(signedKid);
    expect(
      within(signed).getByRole("combobox", { name: "scouting.watchlistScoutFor" }),
    ).toBeDisabled();
    expect(within(signed).getByRole("button", { name: "scouting.watchlistUnwatch" })).toBeEnabled();
  });

  it("offers to buy, not sign, in the detail form of a prospect another club signed", () => {
    const signedKid = createPlayer({ id: "p2", full_name: "Kid p2", team_id: "rival" });
    const props = renderCard({
      watchlist: [{ ...watched("p2"), signed_by: "Rival FC", signed_by_team_id: "rival" }],
      players: [signedKid],
    });

    fireEvent.click(screen.getByRole("button", { name: "Kid p2" }));

    const dialog = screen.getByRole("dialog", { name: "Kid p2" });
    expect(dialog).toHaveTextContent("Rival FC");
    expect(within(dialog).queryByRole("button", { name: "scouting.watchlistSign" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "scouting.watchlistMakeOffer" }));
    expect(props.onMakeOffer).toHaveBeenCalledWith(signedKid);
  });

  it("shows a watched player's club and offers to buy him instead of signing", () => {
    const pro = createPlayer({ id: "pro", full_name: "Kid pro", team_id: "team-9" });
    const props = renderCard({
      watchlist: [{ ...watched("pro"), kind: "Player", prospect: pro }],
      players: [pro],
      teams: [createTeam({ id: "team-9", name: "Nine FC" })],
    });

    const row = screen.getByRole("row", { name: /Kid pro/ });
    expect(row).toHaveTextContent("Nine FC");
    expect(within(row).queryByRole("button", { name: "scouting.watchlistSign" })).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "scouting.watchlistMakeOffer" }));
    expect(props.onMakeOffer).toHaveBeenCalledWith(pro);
    expect(within(row).getByRole("combobox", { name: "scouting.watchlistScoutFor" })).toBeEnabled();
  });

  it("shows a watched free agent as free", () => {
    const pro = createPlayer({ id: "pro", full_name: "Kid pro", team_id: null });
    renderCard({
      watchlist: [{ ...watched("pro"), kind: "Player", prospect: pro }],
      players: [pro],
    });

    expect(screen.getByRole("row", { name: /Kid pro/ })).toHaveTextContent(
      "scouting.watchlistStatusFree",
    );
  });
});
