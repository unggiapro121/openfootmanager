import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { calcAge } from "../../lib/helpers";
import { createPlayer } from "../../test-utils/factories";
import type { StaffData } from "../../store/gameStore";
import FinancesPayrollTable from "./FinancesPayrollTable";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === "finances.until") return `Until ${params?.year}`;
      if (key === "finances.payrollPlayers") return `Players (${params?.count})`;
      if (key === "finances.payrollStaff") return `Staff (${params?.count})`;
      if (key === "finances.academyWage")
        return `${params?.paid} (first team: ${params?.contract})`;
      return key;
    },
    i18n: { language: "en" },
  }),
}));

const roster = [
  createPlayer({ id: "player-1", full_name: "John Smith", wage: 520_000 }),
  createPlayer({ id: "player-2", full_name: "Ana Ruiz", wage: 310_000 }),
];

function createStaff(overrides: Partial<StaffData> = {}): StaffData {
  return {
    id: "staff-1",
    first_name: "Alex",
    last_name: "Coach",
    date_of_birth: "1980-01-01",
    nationality: "GB",
    role: "Coach",
    attributes: { coaching: 70, judgingAbility: 50, judgingPotential: 50, physiotherapy: 30 },
    team_id: "team-1",
    specialization: null,
    wage: 12_000,
    contract_end: "2028-08-01",
    ...overrides,
  };
}

describe("FinancesPayrollTable", () => {
  it("selects a player when a row is clicked", () => {
    const onSelectPlayer = vi.fn();
    render(<FinancesPayrollTable roster={roster} staff={[]} onSelectPlayer={onSelectPlayer} />);

    fireEvent.click(screen.getByRole("button", { name: /John Smith/ }));

    expect(onSelectPlayer).toHaveBeenCalledWith("player-1");
  });

  it("selects a player from the keyboard with Enter and Space", () => {
    const onSelectPlayer = vi.fn();
    render(<FinancesPayrollTable roster={roster} staff={[]} onSelectPlayer={onSelectPlayer} />);

    const row = screen.getByRole("button", { name: /Ana Ruiz/ });
    expect(row).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });

    expect(onSelectPlayer).toHaveBeenCalledTimes(2);
    expect(onSelectPlayer).toHaveBeenNthCalledWith(1, "player-2");
    expect(onSelectPlayer).toHaveBeenNthCalledWith(2, "player-2");
  });

  it("shows each player's age and OVR beside his wage", () => {
    const veteran = createPlayer({
      id: "player-3",
      full_name: "Leo Varga",
      wage: 900_000,
      date_of_birth: "1994-03-10",
      ovr: 81,
    });
    render(<FinancesPayrollTable roster={[veteran]} staff={[]} />);

    expect(screen.getByRole("columnheader", { name: "common.age" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "common.ovr" })).toBeInTheDocument();
    const cells = screen.getAllByRole("cell").map((cell) => cell.textContent);
    expect(cells).toContain(String(calcAge("1994-03-10")));
    expect(cells).toContain("81");
  });

  it("leaves rows out of the tab order when selection is unavailable", () => {
    render(<FinancesPayrollTable roster={roster} staff={[]} />);

    expect(screen.queryByRole("button", { name: /John Smith/ })).toBeNull();
  });

  it("opens on the players and counts both groups on their tabs", () => {
    render(<FinancesPayrollTable roster={roster} staff={[createStaff()]} />);

    expect(screen.getByRole("tab", { name: "Players (2)" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Staff (1)" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByRole("tabpanel")).toHaveTextContent("John Smith");
  });

  it("lists the staff by wage with their role and contract on the staff tab", () => {
    const staff = [
      createStaff({
        id: "s-1",
        first_name: "Pat",
        last_name: "Physio",
        role: "Physio",
        wage: 3_000,
      }),
      createStaff({
        id: "s-2",
        first_name: "Ash",
        last_name: "Assistant",
        role: "AssistantManager",
        wage: 40_000,
        contract_end: "2029-06-30",
      }),
    ];
    render(<FinancesPayrollTable roster={roster} staff={staff} />);

    fireEvent.click(screen.getByRole("tab", { name: "Staff (2)" }));

    const panel = screen.getByRole("tabpanel");
    expect(panel).not.toHaveTextContent("John Smith");
    expect(
      within(panel).getByRole("columnheader", { name: "finances.staffRole" }),
    ).toBeInTheDocument();
    const rows = within(panel).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Ash Assistant");
    expect(rows[0]).toHaveTextContent("staff.roles.AssistantManager");
    expect(rows[0]).toHaveTextContent("Until 2029");
    expect(rows[1]).toHaveTextContent("Pat Physio");
  });

  it("says so when the club employs no staff", () => {
    render(<FinancesPayrollTable roster={roster} staff={[]} />);

    fireEvent.click(screen.getByRole("tab", { name: "Staff (0)" }));

    expect(screen.getByRole("tabpanel")).toHaveTextContent("finances.payrollNoStaff");
  });

  it("shows an academy player's paid wage beside his first-team contract", () => {
    const academy = createPlayer({
      id: "player-9",
      full_name: "Kid Prospect",
      wage: 12_000,
      squad_role: "Youth",
    });
    render(<FinancesPayrollTable roster={[academy]} staff={[]} />);

    const row = screen.getByRole("row", { name: /Kid Prospect/ });
    expect(row).toHaveTextContent(/6,000 \(first team: .*12,000\)/);
  });
});
