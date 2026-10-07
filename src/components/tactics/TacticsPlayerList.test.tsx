import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createPlayer } from "../../test-utils/factories";
import TacticsPlayerList from "./TacticsPlayerList";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

function renderList() {
  const starter = createPlayer({ id: "starter", match_name: "Gil", condition: 82 });
  const sub = createPlayer({ id: "sub", match_name: "Lopez", condition: 35 });
  render(
    <TacticsPlayerList
      bench={[sub]}
      comparePlayerId={null}
      dragState={null}
      onClearFilters={vi.fn()}
      onDemoteStarter={vi.fn()}
      onDragEnd={vi.fn()}
      onDragStart={vi.fn()}
      onOpenPlayerProfile={vi.fn()}
      onPlayerSearchChange={vi.fn()}
      onPositionFilterChange={vi.fn()}
      onPromoteBench={vi.fn()}
      onTacticalSelect={vi.fn()}
      playerSearch=""
      positionFilter=""
      selectedPlayerId={null}
      starters={[starter]}
      xiActivePosition={new Map()}
    />,
  );
}

describe("TacticsPlayerList", () => {
  // Given a starter at 82% condition and a substitute at 35%,
  // When the lineup list is shown,
  // Then each row carries a condition bar labelled with that player's condition.
  it("shows each player's condition beside his name", () => {
    renderList();

    expect(screen.getByLabelText("common.condition: 82%")).toBeInTheDocument();
    expect(screen.getByLabelText("common.condition: 35%")).toBeInTheDocument();
  });
});
