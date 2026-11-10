import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Settings from "./Settings";

/**
 * The Help section's one entry files a bug: it saves a zip through a desktop file picker, then
 * opens an issue form on the original project's tracker. The phone app has neither the picker
 * nor a support channel of its own yet, so it shows no Help section (phase 5 M2b, K5 of
 * m2-tech-spec). Desktop keeps it.
 */
const platformState = { mobile: false };

vi.mock("../lib/platform", () => ({ isMobileBuild: () => platformState.mobile }));
vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null }),
}));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("../services/settingsService", () => ({
  clearAllSaves: vi.fn(),
  exportWorldDatabase: vi.fn(),
}));
vi.mock("../components/diagnostics/ReportBugModal", () => ({ ReportBugModal: () => null }));
vi.mock("./Settings.developmentSpeed", () => ({ default: () => null }));
vi.mock("../context/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: vi.fn() }),
}));

beforeEach(() => {
  platformState.mobile = false;
});

describe("Settings", () => {
  // Given the desktop app, when Settings opens, then the Help section offers the bug report.
  it("keeps the Help section on desktop", () => {
    render(<Settings />);
    expect(screen.getByText("settings.help")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /settings.report$/ })).toBeInTheDocument();
  });

  // Given the phone app, when Settings opens, then there is no Help section and no bug report.
  it("has no Help section on the phone app", () => {
    platformState.mobile = true;
    render(<Settings />);
    expect(screen.queryByText("settings.help")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /settings.report$/ })).not.toBeInTheDocument();
    expect(screen.getByText("settings.about")).toBeInTheDocument();
  });
});
