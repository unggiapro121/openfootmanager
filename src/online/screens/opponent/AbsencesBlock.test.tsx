import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import i18n, { i18nReady } from "../../../i18n";
import type { AbsenceView } from "../../api";
import { AbsencesBlock } from "./OpponentBlocks";

function banned(playerId: string, matchesLeft: number): AbsenceView {
  return { playerId, name: playerId, naturalPosition: "Striker", kind: "suspended", matchesLeft };
}

describe("AbsencesBlock", () => {
  beforeAll(async () => {
    await i18nReady;
    await i18n.changeLanguage("en");
  });

  // Given two banned men, one with a match still to miss and one with two,
  // when the absences are shown in English,
  // then each line names its own number, with no "1 matches" and no raw placeholder
  // (PO P5-48).
  it("names how many matches each banned man still misses", () => {
    render(<AbsencesBlock absences={[banned("a", 1), banned("b", 2)]} named={false} />);

    expect(screen.getByText("Suspended, 1 match(es) left")).toBeInTheDocument();
    expect(screen.getByText("Suspended, 2 match(es) left")).toBeInTheDocument();
  });
});
