import { fireEvent, render, screen, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FacilityUpgradePreviewData } from "../../services/financeService";
import FacilityUpgradeDialog from "./FacilityUpgradeDialog";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    // Echo the key with its interpolation values, so a test can see both.
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
    i18n: { language: "en" },
  }),
}));

const mockedInvoke = vi.mocked(invoke);

const MEDICAL_LEVEL_FOUR: FacilityUpgradePreviewData = {
  facility: "Medical",
  level: 4,
  maxLevel: 10,
  cost: 10_000_000,
  effects: [
    {
      key: "finances.facilityEffects.conditionRecovery",
      format: "multiplier",
      current: [1.3],
      next: [1.4],
    },
    {
      key: "finances.facilityEffects.matchInjurySeverity",
      format: "split",
      current: [64.2, 27.3, 8.5],
      next: [65.6, 26.4, 8],
    },
  ],
};

function renderDialog(
  preview: FacilityUpgradePreviewData,
  { balance = 16_900_000, blockReason = null as string | null } = {},
) {
  mockedInvoke.mockResolvedValueOnce(preview);
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  render(
    <FacilityUpgradeDialog
      facility={preview.facility}
      titleKey="finances.facilityMedical"
      balance={balance}
      blockReason={blockReason}
      isUpgrading={false}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  );
  return { onCancel, onConfirm };
}

describe("FacilityUpgradeDialog", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  /**
   * Given the medical facility at level 4 and €16.9M in the bank,
   * When the dialog opens,
   * Then it shows level 4 → 5 and every effect now and after the upgrade.
   */
  it("shows each effect before and after the upgrade", async () => {
    renderDialog(MEDICAL_LEVEL_FOUR);

    const dialog = await screen.findByRole("dialog");
    expect(mockedInvoke).toHaveBeenCalledWith("get_facility_upgrade_preview", {
      facility: "Medical",
    });
    expect(within(dialog).getByRole("heading")).toHaveTextContent('"from":4,"to":5');
    const recovery = within(dialog).getByRole("row", {
      name: /conditionRecovery/,
    });
    expect(recovery).toHaveTextContent("×1.3");
    expect(recovery).toHaveTextContent("×1.4");
    const severity = within(dialog).getByRole("row", { name: /matchInjurySeverity/ });
    expect(severity).toHaveTextContent("64.2% / 27.3% / 8.5%");
    expect(severity).toHaveTextContent("65.6% / 26.4% / 8%");
  });

  /**
   * Given an open upgrade dialog the club can afford,
   * When the manager cancels or confirms,
   * Then only confirming asks for the upgrade.
   */
  it("upgrades only when confirmed", async () => {
    const { onCancel, onConfirm } = renderDialog(MEDICAL_LEVEL_FOUR);
    const confirm = await screen.findByRole("button", { name: /facilityUpgradeConfirm/ });

    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  /**
   * Given a club with less cash than the upgrade costs,
   * When the dialog opens,
   * Then the confirm button is disabled and says why.
   */
  it("refuses an upgrade the club cannot afford", async () => {
    renderDialog(MEDICAL_LEVEL_FOUR, { balance: 5_000_000 });

    const confirm = await screen.findByRole("button", { name: /facilityUpgradeConfirm/ });
    expect(confirm).toBeDisabled();
    expect(screen.getByText("finances.insufficientFunds")).toBeInTheDocument();
  });

  /**
   * Given a facility already at the top level,
   * When the dialog opens,
   * Then nothing can be bought and it says the top level is reached.
   */
  it("offers nothing past the top level", async () => {
    renderDialog({
      ...MEDICAL_LEVEL_FOUR,
      level: 10,
      cost: null,
      effects: MEDICAL_LEVEL_FOUR.effects.map((effect) => ({ ...effect, next: null })),
    });

    expect(await screen.findByText("finances.facilityMaxLevel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "finances.upgradeFacility" })).toBeDisabled();
  });
});
