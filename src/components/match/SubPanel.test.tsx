import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SubPanel } from "./SubPanel";
import type { EnginePlayerData, EngineTeamData, MatchSnapshot } from "./types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, arg?: unknown) => {
      if (typeof arg === "string") {
        return arg;
      }

      if (typeof arg === "object" && arg !== null && "used" in arg && "max" in arg) {
        return `${key}:${String((arg as { used: number }).used)}/${String((arg as { max: number }).max)}`;
      }

      if (key === "common.cancel") {
        return "Cancel";
      }

      if (key === "match.selectToTakeOff") {
        return "Select to take off";
      }

      if (key === "match.clearReplacementSelection") {
        return "Clear replacement";
      }

      if (key === "match.selectReplacementMenu") {
        return "Select replacement";
      }

      if (key === "match.selectPlayerToTakeOffFirst") {
        return "Select player to take off first";
      }

      if (key === "match.confirmSubstitution") {
        return "Confirm substitution";
      }

      return key;
    },
  }),
}));

const makePlayer = (overrides: Partial<EnginePlayerData> = {}): EnginePlayerData => {
  const { ovr = 70, ...rest } = overrides;

  return {
    id: "player-1",
    name: "Player One",
    position: "Midfielder",
    ovr,
    condition: 78,
    pace: 70,
    stamina: 70,
    strength: 70,
    agility: 70,
    passing: 70,
    shooting: 70,
    tackling: 70,
    dribbling: 70,
    defending: 70,
    positioning: 70,
    vision: 70,
    decisions: 70,
    composure: 70,
    aggression: 60,
    teamwork: 70,
    leadership: 60,
    handling: 20,
    reflexes: 20,
    aerial: 60,
    traits: [],
    role: "Standard",
    ...rest,
  };
};

const makeTeam = (overrides: Partial<EngineTeamData> = {}): EngineTeamData => ({
  id: "team-1",
  name: "Alpha FC",
  formation: "4-4-2",
  play_style: "Balanced",
  players: [
    makePlayer({ id: "starter-1", name: "Starter One", position: "Midfielder" }),
    makePlayer({ id: "starter-2", name: "Starter Two", position: "Forward", shooting: 80 }),
  ],
  ...overrides,
});

function createSnapshot(): MatchSnapshot {
  return {
    phase: "first_half",
    current_minute: 32,
    home_score: 1,
    away_score: 0,
    possession: "Home",
    ball_zone: "MiddleThird",
    home_team: makeTeam(),
    away_team: makeTeam({
      id: "team-2",
      name: "Beta FC",
      players: [makePlayer({ id: "opp-1", name: "Opponent One" })],
    }),
    home_bench: [
      makePlayer({ id: "bench-1", name: "Bench One", position: "Midfielder", condition: 92 }),
      makePlayer({ id: "bench-2", name: "Bench Two", position: "Forward", shooting: 76 }),
    ],
    away_bench: [makePlayer({ id: "opp-bench-1", name: "Opponent Bench" })],
    home_possession_pct: 56,
    away_possession_pct: 44,
    events: [],
    home_subs_made: 0,
    away_subs_made: 0,
    max_subs: 5,
    home_set_pieces: {
      free_kick_taker: null,
      corner_taker: null,
      penalty_taker: null,
      captain: null,
    },
    away_set_pieces: {
      free_kick_taker: null,
      corner_taker: null,
      penalty_taker: null,
      captain: null,
    },
    substitutions: [],
    allows_extra_time: false,
    home_yellows: {},
    away_yellows: {},
    sent_off: [],
  };
}

describe("SubPanel", () => {
  const createProps = () => ({
    snapshot: createSnapshot(),
    side: "Home" as const,
    onSubstitute: vi.fn(),
    onSwapPositions: vi.fn(),
    onRoleChange: vi.fn(),
    onFormationChange: vi.fn(),
    onPlayStyleChange: vi.fn(),
    onClose: vi.fn(),
  });

  it("shows a disabled bench context menu action until a player is selected to come off", () => {
    const props = createProps();

    render(<SubPanel {...props} />);

    fireEvent.contextMenu(screen.getByTestId("sub-panel-bench-bench-1"));

    expect(
      screen.getByRole("menuitem", { name: "Select player to take off first" }),
    ).toBeDisabled();
  });

  it("supports the substitution selection flow through context menus", () => {
    const props = createProps();

    render(<SubPanel {...props} />);

    fireEvent.contextMenu(screen.getByTestId("sub-panel-off-starter-1"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Select to take off" }));

    fireEvent.contextMenu(screen.getByTestId("sub-panel-bench-bench-1"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Select replacement" }));

    fireEvent.click(screen.getByRole("button", { name: "Confirm substitution" }));

    expect(props.onSubstitute).toHaveBeenCalledWith("starter-1", "bench-1");
  });

  it("allows clearing the selected off-player through the context menu", () => {
    const props = createProps();

    render(<SubPanel {...props} />);

    fireEvent.contextMenu(screen.getByTestId("sub-panel-off-starter-1"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Select to take off" }));

    expect(screen.getByText("match.selectBenchToCompare")).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByTestId("sub-panel-off-starter-1"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Cancel" }));

    expect(screen.queryByText("match.selectBenchToCompare")).not.toBeInTheDocument();
  });

  it("surfaces recommendations and applies the recommended play style", () => {
    const props = createProps();

    render(<SubPanel {...props} />);

    expect(screen.getByTestId("recommended-sub-starter-1-bench-1")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("recommended-plan-cta"));

    expect(props.onPlayStyleChange).toHaveBeenCalledWith("Balanced");
  });

  it("applies formation from quick tactical tweaks", () => {
    const props = createProps();

    render(<SubPanel {...props} />);

    fireEvent.click(screen.getByRole("combobox", { name: "tactics.formation" }));
    fireEvent.click(screen.getByRole("option", { name: "4-3-3" }));

    expect(props.onFormationChange).toHaveBeenCalledWith("4-3-3");
  });

  it("lets a recommendation prefill the swap flow", () => {
    const props = createProps();

    render(<SubPanel {...props} />);

    fireEvent.click(screen.getByTestId("recommended-sub-starter-1-bench-1"));

    expect(screen.getAllByText("Starter One").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bench One").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Confirm substitution" })).toBeInTheDocument();
  });
});

describe("SubPanel position swaps", () => {
  const XI_POSITIONS = [
    "Goalkeeper",
    "Defender",
    "Defender",
    "Defender",
    "Defender",
    "Midfielder",
    "Midfielder",
    "Midfielder",
    "Midfielder",
    "Forward",
    "Forward",
  ];

  function elevenASide(overrides: Partial<MatchSnapshot> = {}): MatchSnapshot {
    const snapshot = createSnapshot();
    snapshot.home_team = makeTeam({
      players: XI_POSITIONS.map((position, index) =>
        makePlayer({ id: `p${index}`, name: `Player ${index}`, position }),
      ),
    });
    return { ...snapshot, ...overrides };
  }

  function drag(fromId: string, toId: string) {
    const dataTransfer = {
      setData: vi.fn(),
      getData: () => fromId,
      effectAllowed: "",
      dropEffect: "",
    };
    fireEvent.dragStart(screen.getByTestId(`pitch-token-${fromId}`), { dataTransfer });
    fireEvent.dragOver(screen.getByTestId(`pitch-token-${toId}`), { dataTransfer });
    fireEvent.drop(screen.getByTestId(`pitch-token-${toId}`), { dataTransfer });
  }

  const props = (snapshot: MatchSnapshot) => ({
    snapshot,
    side: "Home" as const,
    onSubstitute: vi.fn(),
    onSwapPositions: vi.fn(),
    onRoleChange: vi.fn(),
    onFormationChange: vi.fn(),
    onPlayStyleChange: vi.fn(),
    onClose: vi.fn(),
  });

  // Given a defender sent off, when a forward is dragged onto his slot on the
  // pitch, then the panel asks for the two to trade positions.
  it("swaps a player into a sent-off player's slot by dragging", () => {
    const p = props(elevenASide({ sent_off: ["p2"] }));
    render(<SubPanel {...p} />);

    drag("p9", "p2");

    expect(p.onSwapPositions).toHaveBeenCalledWith("p9", "p2");
  });

  // Given every substitution used, then the pitch is still there: changing
  // positions costs no substitution.
  it("keeps the pitch for position swaps once every substitution is used", () => {
    const p = props(elevenASide({ home_subs_made: 5 }));
    render(<SubPanel {...p} />);

    expect(screen.getByText("match.allSubsUsed")).toBeInTheDocument();
    drag("p1", "p10");

    expect(p.onSwapPositions).toHaveBeenCalledWith("p1", "p10");
  });

  // Given a player sent off, then he is still listed among the players on the
  // pitch, but cannot be picked to come off.
  it("lists the sent-off player without letting him be taken off", () => {
    const p = props(elevenASide({ sent_off: ["p2"] }));
    render(<SubPanel {...p} />);

    const row = screen.getByTestId("sub-panel-off-p2");
    expect(row).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(row);

    expect(screen.queryByText("match.takingOff")).not.toBeInTheDocument();
  });

  // Given a defender standing in the striker's slot, then the on-field list
  // names the slot (ST, not DEF) and shows his rating there, in red.
  it("shows each player's slot position and his rating there", () => {
    const snapshot = elevenASide();
    snapshot.home_team.players[9] = makePlayer({
      id: "p9",
      name: "Player 9",
      position: "Forward",
      position_ratings: [
        { position: "CenterBack", ovr: 80, fit: "Natural" },
        { position: "Striker", ovr: 52, fit: "Unfamiliar" },
      ],
    });
    render(<SubPanel {...props(snapshot)} />);

    const row = screen.getByTestId("sub-panel-off-p9");
    expect(within(row).getByText("common.posAbbr.Striker")).toBeInTheDocument();
    expect(within(row).getByText("52")).toHaveClass("text-red-600");
  });

  // Given a player picked to come off from the striker's slot, then each bench
  // player shows his natural position and his rating in that slot.
  it("rates the bench for the slot being vacated", () => {
    const snapshot = elevenASide({
      home_bench: [
        makePlayer({
          id: "bench-cb",
          name: "Bench CB",
          position: "Defender",
          position_ratings: [
            { position: "CenterBack", ovr: 75, fit: "Natural" },
            { position: "Striker", ovr: 48, fit: "Unfamiliar" },
          ],
        }),
      ],
    });
    render(<SubPanel {...props(snapshot)} />);

    fireEvent.click(screen.getByTestId("sub-panel-off-p9"));

    const row = screen.getByTestId("sub-panel-bench-bench-cb");
    expect(within(row).getByText(/common\.posAbbr\.CenterBack/)).toBeInTheDocument();
    expect(within(row).getByText("48")).toHaveClass("text-red-600");
  });

  // Given a player on the pitch, when his role is changed in the on-field list,
  // then the panel asks for the change with the role the slot admits.
  it("changes a player's role during the match", () => {
    const p = props(elevenASide());
    render(<SubPanel {...p} />);

    const row = screen.getByTestId("sub-panel-off-p9");
    fireEvent.click(within(row).getByRole("combobox", { name: "tactics.playerRoleLabel" }));
    fireEvent.click(screen.getByRole("option", { name: "Poacher" }));

    expect(p.onRoleChange).toHaveBeenCalledWith("p9", "Poacher");
  });

  // Given the substitution panel, then its pitch uses the compact token so the
  // whole shape fits the dialog.
  it("draws the pitch with compact tokens", () => {
    render(<SubPanel {...props(elevenASide())} />);

    const token = screen.getByTestId("pitch-token-p9");
    expect(within(token).getByTestId("pitch-token-avatar")).toHaveClass("h-8");
  });
});
