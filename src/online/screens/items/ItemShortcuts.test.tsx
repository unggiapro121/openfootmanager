import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetOnline } from "../../../test-utils/onlineTestKit";
import type { InventoryView } from "../../api";
import { useOnlineStore } from "../../store/onlineStore";
import ItemShortcuts from "./ItemShortcuts";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      options && typeof options === "object"
        ? `${key}:${Object.values(options as Record<string, unknown>).join("|")}`
        : key,
    i18n: { language: "en" },
  }),
}));

function withPack(perDay: number): InventoryView {
  return {
    lines: [{ itemCode: "teamRecoveryPack", powerClass: "c", total: 1, stacks: [{ quantity: 1 }] }],
    locked: false,
    limits: {
      teamRecovery: { usedToday: 0, perDay, nextAt: "2099-01-02T00:00:00Z" },
      notes: [],
      xpX2: { remaining: 0, max: 10 },
    },
  };
}

afterEach(() => resetOnline());

describe("the team pack's shortcut on the squad", () => {
  // Given a team recovery pack held in a season that allows one use a day,
  // when the squad's shortcuts show,
  // then the pack is offered.
  it("offers the pack held", () => {
    useOnlineStore.setState({ items: withPack(1) });
    render(<ItemShortcuts codes={["teamRecoveryPack"]} target={{ kind: "club" }} />);

    expect(
      screen.getByRole("button", {
        name: /^online\.items\.shortcut:online\.items\.teamRecoveryPack/,
      }),
    ).toBeInTheDocument();
  });

  // Given a team recovery pack held in a season whose ruleset allows no use a day,
  // when the squad's shortcuts show,
  // then the pack is not offered: it cannot be used all season.
  it("hides the pack in a season that allows none", () => {
    useOnlineStore.setState({ items: withPack(0) });
    render(<ItemShortcuts codes={["teamRecoveryPack"]} target={{ kind: "club" }} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
