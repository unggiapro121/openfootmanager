import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { describe, expect, it, vi } from "vitest";

import GenerationStep from "./WorldSelect";
import type { PackageInfo } from "./WorldSelect";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { year?: number; count?: number }) => {
      if (key === "worldSelect.summary.midSeason.generated") {
        return `worldSelect.summary.midSeason.generated:${options?.year ?? "missing"}:${options?.count ?? "missing"}`;
      }

      if (key === "worldSelect.historyDepth.applied") {
        return `worldSelect.historyDepth.applied:${options?.count ?? "missing"}`;
      }

      if (key === "worldSelect.historyDepth.option") {
        return `worldSelect.historyDepth.option:${options?.count ?? "missing"}`;
      }

      return key;
    },
    i18n: { language: "en" },
  }),
}));

vi.mock("../ui", () => ({
  Button: ({
    children,
    iconRight: _iconRight,
    ...props
  }: ComponentPropsWithoutRef<"button"> & { iconRight?: unknown }) => (
    <button {...props}>{children}</button>
  ),
  Select: ({
    children,
    selectSize: _selectSize,
    ...props
  }: ComponentPropsWithoutRef<"select"> & { selectSize?: unknown }) => (
    <select {...props}>{children}</select>
  ),
}));

vi.mock("../../utils/backendI18n", () => ({
  resolveBackendText: (value: string) => value,
}));

const baseProps = {
  isStarting: false,
  startYear: 2032,
  startPhase: "midSeason" as const,
  historyDepthYears: 24,
  onChangeHistoryDepthYears: vi.fn(),
  developmentSpeedPercent: 100,
  onChangeDevelopmentSpeedPercent: vi.fn(),
  onStart: vi.fn(),
  onBack: vi.fn(),
  onClose: vi.fn(),
};

const dbPackage: PackageInfo = {
  id: "pkg-db",
  name: "Premier League",
  version: "1.0.0",
  author: "Test",
  description: "",
  license: "MIT",
  gameMinVersion: "1.0.0",
  packageType: "database",
  teamCount: 20,
  playerCount: 480,
  competitionCount: 1,
  namePoolCount: 0,
  countryCount: 0,
  confederationCount: 0,
  installedPath: "/path/to/pkg",
};

describe("GenerationStep (WorldSelect)", () => {
  it("shows history depth selector and summary when no database packages are active", () => {
    const onChangeHistoryDepthYears = vi.fn();

    render(
      <GenerationStep
        {...baseProps}
        onChangeHistoryDepthYears={onChangeHistoryDepthYears}
        activePackages={[]}
      />,
    );

    expect(screen.getByText("worldSelect.summary.midSeason.generated:2032:24")).toBeInTheDocument();
    expect(screen.getByText("worldSelect.historyDepth.applied:24")).toBeInTheDocument();
    expect(screen.getByText("worldSelect.summary.startYear")).toBeInTheDocument();

    fireEvent.click(screen.getByText("worldSelect.historyDepth.option:6"));

    expect(onChangeHistoryDepthYears).toHaveBeenCalledWith(6);
  });

  it("hides history depth selector and shows coverage section when database packages are active", () => {
    render(<GenerationStep {...baseProps} startPhase="seasonStart" activePackages={[dbPackage]} />);

    expect(screen.getByText("generation.coverage")).toBeInTheDocument();
    expect(screen.queryByText("worldSelect.historyDepth.label")).not.toBeInTheDocument();
  });

  /**
   * Given a career about to be created, when a faster development speed is
   * picked, then the choice is reported as a percentage of the realistic pace.
   */
  it("lets the development speed be chosen before the world exists", () => {
    const onChangeDevelopmentSpeedPercent = vi.fn();
    render(
      <GenerationStep
        {...baseProps}
        onChangeDevelopmentSpeedPercent={onChangeDevelopmentSpeedPercent}
        activePackages={[]}
      />,
    );

    const speed = screen.getByRole("combobox", { name: "settings.developmentSpeed" });
    expect(speed).toHaveValue("100");
    expect(
      screen.getByRole("option", { name: "×1 (settings.developmentSpeedRealistic)" }),
    ).toBeInTheDocument();

    fireEvent.change(speed, { target: { value: "250" } });

    expect(onChangeDevelopmentSpeedPercent).toHaveBeenCalledWith(250);
  });

  /** Given a packaged world, then the speed is still offered: it applies to every world. */
  it("offers the development speed for packaged worlds too", () => {
    render(<GenerationStep {...baseProps} activePackages={[dbPackage]} />);

    expect(screen.getByRole("combobox", { name: "settings.developmentSpeed" })).toBeInTheDocument();
  });
});
