import { fireEvent, render, screen, within } from "@testing-library/react";
import type { TFunction } from "i18next";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { TeamCard } from "../../services/teamsService";
import { buildDirectoryTree } from "../teams/TeamsListTab.helpers";
import TransferMarketFilterPanel from "./TransferMarketFilterPanel";
import {
  DEFAULT_TRANSFER_MARKET_FILTERS,
  type TransferMarketFilters,
} from "./TransfersTab.filters";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === "transfers.filters.buttonActive") return `Filters (${params?.count} on)`;
      if (key.startsWith("common.posAbbr.")) return key.replace("common.posAbbr.", "");
      return key;
    },
  }),
}));

const tKey = ((key: string, options?: Record<string, unknown>) =>
  String(options?.defaultValue ?? key)) as unknown as TFunction;
const card = (id: string) => ({ team: { id, name: id } }) as unknown as TeamCard;
const tree = buildDirectoryTree(
  {
    regions: [
      {
        id: "europe",
        team_count: 2,
        leagues: [
          { id: "eng-1", name: "Premier", country_id: "ENG", teams: [card("ars")] },
          { id: "esp-1", name: "La Liga", country_id: "ESP", teams: [card("rma")] },
        ],
      },
    ],
  },
  tKey,
);

function Host({ onFilters }: { onFilters?: (filters: TransferMarketFilters) => void }) {
  const [filters, setFilters] = useState(DEFAULT_TRANSFER_MARKET_FILTERS);
  return (
    <TransferMarketFilterPanel
      filters={filters}
      directoryTree={tree}
      onChange={(patch) =>
        setFilters((previous) => {
          const next = { ...previous, ...patch };
          onFilters?.(next);
          return next;
        })
      }
    />
  );
}

function pick(name: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name }));
  fireEvent.click(screen.getByRole("option", { name: option }));
}

describe("TransferMarketFilterPanel", () => {
  // Given the market, then filtering is one button that opens a panel, and
  // Escape closes it again.
  it("opens and closes the filter panel from one button", () => {
    render(<Host />);
    const button = screen.getByRole("button", { name: "transfers.filters.button" });

    fireEvent.click(button);
    expect(screen.getByRole("dialog", { name: "transfers.filters.title" })).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // Given Defender chosen in the first position dropdown, then the second
  // offers exactly the defensive positions.
  it("offers the group's positions once a position group is chosen", () => {
    const onFilters = vi.fn();
    render(<Host onFilters={onFilters} />);
    fireEvent.click(screen.getByRole("button", { name: "transfers.filters.button" }));
    expect(
      screen.getByRole("combobox", { name: "transfers.filters.specificPosition" }),
    ).toBeDisabled();

    pick("transfers.filters.positionGroup", "common.positionGroups.Defender");
    fireEvent.click(screen.getByRole("combobox", { name: "transfers.filters.specificPosition" }));
    const options = within(screen.getByRole("listbox"))
      .getAllByRole("option")
      .map((option) => option.textContent?.split(" ")[0]);
    expect(options).toEqual([
      "transfers.filters.anyPosition",
      "CenterBack",
      "LeftBack",
      "RightBack",
      "LeftWingBack",
      "RightWingBack",
    ]);
    fireEvent.click(screen.getByRole("option", { name: /^LeftBack/ }));
    expect(onFilters).toHaveBeenLastCalledWith(
      expect.objectContaining({ positionGroup: "Defender", position: "LeftBack" }),
    );
  });

  // Given a region, then a country of it, then a league of that country, then
  // each picker narrows the next; changing the region clears what was below it.
  it("narrows the competition from region to country to league", () => {
    const onFilters = vi.fn();
    render(<Host onFilters={onFilters} />);
    fireEvent.click(screen.getByRole("button", { name: "transfers.filters.button" }));
    expect(screen.getByRole("combobox", { name: "transfers.filters.country" })).toBeDisabled();

    pick("transfers.filters.region", "Europe");
    pick("transfers.filters.country", "ESP");
    pick("transfers.filters.league", "La Liga");

    expect(onFilters).toHaveBeenLastCalledWith(
      expect.objectContaining({ regionId: "europe", countryId: "ESP", leagueId: "esp-1" }),
    );
    pick("transfers.filters.region", "transfers.filters.anyRegion");
    expect(onFilters).toHaveBeenLastCalledWith(
      expect.objectContaining({ regionId: null, countryId: null, leagueId: null }),
    );
  });

  // Given an age and an OVR range typed in, then the button counts two filters
  // on, and Clear turns them all off.
  it("counts the filters on and clears them", () => {
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "transfers.filters.button" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "common.age transfers.filters.min" }), {
      target: { value: "18" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "common.ovr transfers.filters.max" }), {
      target: { value: "80" },
    });

    expect(screen.getByRole("button", { name: "Filters (2 on)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "transfers.filters.clear" }));
    expect(screen.getByRole("button", { name: "transfers.filters.button" })).toBeInTheDocument();
    expect(
      screen.getByRole("spinbutton", { name: "common.age transfers.filters.min" }),
    ).toHaveValue(null);
  });
});
