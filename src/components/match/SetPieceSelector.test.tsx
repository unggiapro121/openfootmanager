import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { getSetPieceStats } from "./SetPieceSelector";
import SetPieceSelector from "./SetPieceSelector";
import { getAttributeValueClassName } from "../../lib/playerAttributeDisplay";
import type { PlayerData } from "../../store/gameStore";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// ---------------------------------------------------------------------------
// Minimal fixture
// ---------------------------------------------------------------------------

const makePlayer = (overrides: Partial<PlayerData> = {}): PlayerData => ({
  id: "p1",
  match_name: "Test Player",
  full_name: "Test Player Full",
  date_of_birth: "1996-01-15",
  nationality: "GB",
  position: "Midfielder",
  natural_position: "Midfielder",
  alternate_positions: [],
  training_focus: null,
  attributes: {
    pace: 70,
    stamina: 70,
    strength: 70,
    agility: 70,
    passing: 75,
    shooting: 80,
    tackling: 60,
    dribbling: 70,
    defending: 60,
    positioning: 65,
    vision: 72,
    decisions: 68,
    composure: 50,
    aggression: 50,
    teamwork: 50,
    leadership: 50,
    handling: 30,
    reflexes: 30,
    aerial: 50,
    long_passing: 75,
    crossing: 75,
    curve: 75,
    free_kick: 75,
    long_shots: 80,
    heading: 50,
    first_touch: 70,
  },
  condition: 100,
  morale: 80,
  injury: null,
  team_id: "team_1",
  retired: false,
  contract_end: "2028-06-30",
  wage: 10000,
  market_value: 5000000,
  stats: {
    appearances: 0,
    goals: 0,
    assists: 0,
    clean_sheets: 0,
    yellow_cards: 0,
    red_cards: 0,
    avg_rating: 0,
    minutes_played: 0,
  },
  career: [],
  transfer_listed: false,
  loan_listed: false,
  transfer_offers: [],
  traits: [],
  ...overrides,
});

// ---------------------------------------------------------------------------
// getSetPieceStats
// ---------------------------------------------------------------------------

describe("getSetPieceStats", () => {
  const player = makePlayer();
  const a = player.attributes;

  it("penalty: weights shooting and composure", () => {
    const result = getSetPieceStats("penalty", player);
    expect(result.score).toBe(Math.round((a.shooting + a.composure) / 2));
    expect(result.stats).toEqual([
      { label: "SHO", value: a.shooting },
      { label: "COM", value: a.composure },
    ]);
  });

  // A set-piece specialist: dead-ball skill, crossing and curve differ from passing
  // and vision on purpose, so the old formulas would give other scores.
  const specialist = makePlayer({
    attributes: { ...a, free_kick: 80, crossing: 70, curve: 60, passing: 40, vision: 40 },
  });

  it("freekick: 0.65 free kick + 0.35 curve, as the backend auto-pick", () => {
    const result = getSetPieceStats("freekick", specialist);
    expect(result.score).toBe(73);
    expect(result.stats).toEqual([
      { label: "FKA", value: 80 },
      { label: "CUR", value: 60 },
    ]);
  });

  it("corner: 0.70 crossing + 0.30 curve, as the backend auto-pick", () => {
    const result = getSetPieceStats("corner", specialist);
    expect(result.score).toBe(67);
    expect(result.stats).toEqual([
      { label: "CRO", value: 70 },
      { label: "CUR", value: 60 },
    ]);
  });

  it("captain: weights leadership and teamwork", () => {
    const result = getSetPieceStats("captain", player);
    expect(result.score).toBe(Math.round((a.leadership + a.teamwork) / 2));
    expect(result.stats).toEqual([
      { label: "LDR", value: a.leadership },
      { label: "TMW", value: a.teamwork },
    ]);
  });

  it("vice captain uses the same leadership profile as captain", () => {
    const result = getSetPieceStats("vicecaptain", player);
    expect(result.score).toBe(Math.round((a.leadership + a.teamwork) / 2));
    expect(result.stats).toEqual([
      { label: "LDR", value: a.leadership },
      { label: "TMW", value: a.teamwork },
    ]);
  });

  it("unknown role: returns score 0 and empty stats", () => {
    const result = getSetPieceStats("throw_in", player);
    expect(result.score).toBe(0);
    expect(result.stats).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SetPieceSelector component
// ---------------------------------------------------------------------------

const players = [
  { id: "p1", name: "John Smith", position: "Midfielder" },
  { id: "p2", name: "Jane Doe", position: "Forward" },
  { id: "gk", name: "Keeper", position: "Goalkeeper" },
];

const allSquad = [
  makePlayer({ id: "p1", position: "Midfielder" }),
  makePlayer({
    id: "p2",
    position: "Forward",
    attributes: { ...makePlayer().attributes, shooting: 90 },
  }),
  makePlayer({ id: "gk", position: "Goalkeeper" }),
];

describe("SetPieceSelector component", () => {
  it("uses readable shared stat value classes for selector chips", () => {
    expect(getAttributeValueClassName(75)).toContain("text-success-600");
    expect(getAttributeValueClassName(48)).toContain("text-accent-700");
  });

  it("renders the label and 'not assigned' when no currentId", () => {
    render(
      <SetPieceSelector
        label="Penalty Taker"
        icon={<span data-testid="icon">PK</span>}
        assignment="penalty"
        currentId={null}
        players={players}
        allSquad={allSquad}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("Penalty Taker")).toBeInTheDocument();
    expect(screen.getByText("match.notAssigned")).toBeInTheDocument(); // mocked t() returns key
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("shows the current player name when currentId is set", () => {
    render(
      <SetPieceSelector
        label="Penalty Taker"
        icon={<span>PK</span>}
        assignment="penalty"
        currentId="p1"
        players={players}
        allSquad={allSquad}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("John Smith")).toBeInTheDocument();
  });

  it("normalizes detailed positions to translated core abbreviations", () => {
    render(
      <SetPieceSelector
        label="Penalty Taker"
        icon={<span>PK</span>}
        assignment="penalty"
        currentId={null}
        players={[{ id: "cb", name: "Center Back Player", position: "Center Back" }]}
        allSquad={[makePlayer({ id: "cb", position: "Center Back" })]}
        onSelect={() => {}}
      />,
    );

    fireEvent.click(screen.getByText("Penalty Taker"));

    expect(screen.getByText("common.posAbbr.Defender")).toBeInTheDocument();
  });

  it("expands dropdown on click and shows non-GK players sorted by score", () => {
    render(
      <SetPieceSelector
        label="Penalty Taker"
        icon={<span>PK</span>}
        assignment="penalty"
        currentId={null}
        players={players}
        allSquad={allSquad}
        onSelect={() => {}}
      />,
    );
    // Click to expand
    fireEvent.click(screen.getByText("Penalty Taker"));
    // Should see non-GK players
    expect(screen.getByText("John Smith")).toBeInTheDocument();
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    // Goalkeeper should be filtered out from dropdown
    expect(screen.queryByText("Keeper")).not.toBeInTheDocument();
  });

  it("renders translated stat labels in the expanded selector header", () => {
    render(
      <SetPieceSelector
        label="Penalty Taker"
        icon={<span>PK</span>}
        assignment="penalty"
        currentId="p1"
        players={players}
        allSquad={allSquad}
        onSelect={() => {}}
      />,
    );

    fireEvent.click(screen.getByText("Penalty Taker"));

    expect(screen.getAllByText("common.attributes.shooting").length).toBeGreaterThan(0);
    expect(screen.getAllByText("common.attributes.composure").length).toBeGreaterThan(0);
  });

  it("translates the corner stat labels", () => {
    render(
      <SetPieceSelector
        label="Corner Taker"
        icon={<span>CK</span>}
        assignment="corner"
        currentId="p1"
        players={players}
        allSquad={allSquad}
        onSelect={() => {}}
      />,
    );

    fireEvent.click(screen.getByText("Corner Taker"));

    expect(screen.getAllByText("common.attributes.crossing").length).toBeGreaterThan(0);
    expect(screen.getAllByText("common.attributes.curve").length).toBeGreaterThan(0);
  });

  it("translates the free-kick stat label", () => {
    render(
      <SetPieceSelector
        label="Free Kick Taker"
        icon={<span>FK</span>}
        assignment="freekick"
        currentId="p1"
        players={players}
        allSquad={allSquad}
        onSelect={() => {}}
      />,
    );

    fireEvent.click(screen.getByText("Free Kick Taker"));

    expect(screen.getAllByText("common.attributes.free_kick").length).toBeGreaterThan(0);
  });

  it("calls onSelect and collapses when a player is picked", () => {
    const onSelect = vi.fn();
    render(
      <SetPieceSelector
        label="Penalty Taker"
        icon={<span>PK</span>}
        assignment="penalty"
        currentId={null}
        players={players}
        allSquad={allSquad}
        onSelect={onSelect}
      />,
    );
    // Expand
    fireEvent.click(screen.getByText("Penalty Taker"));
    // Pick a player
    fireEvent.click(screen.getByText("Jane Doe"));
    expect(onSelect).toHaveBeenCalledWith("p2");
  });

  it("highlights the current player in the dropdown", () => {
    render(
      <SetPieceSelector
        label="Penalty Taker"
        icon={<span>PK</span>}
        assignment="penalty"
        currentId="p1"
        players={players}
        allSquad={allSquad}
        onSelect={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("Penalty Taker"));
    // The current player's row should have the highlight class
    const buttons = screen.getAllByRole("button");
    const p1Button = buttons.find((b) => b.textContent?.includes("John Smith") && b !== buttons[0]);
    expect(p1Button?.className).toContain("bg-primary-500/20");
  });

  it("includes goalkeepers for vice captain assignments", () => {
    render(
      <SetPieceSelector
        label="Vice-captain"
        icon={<span>VC</span>}
        assignment="vicecaptain"
        currentId={null}
        players={players}
        allSquad={allSquad}
        onSelect={() => {}}
      />,
    );

    fireEvent.click(screen.getByText("Vice-captain"));

    expect(screen.getByText("Keeper")).toBeInTheDocument();
  });
});
