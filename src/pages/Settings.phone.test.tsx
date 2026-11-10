import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FORK_SOURCE_URL } from "../lib/communityLinks";
import Settings from "./Settings";

/**
 * On the phone app (online only, DM-1) Settings keeps what means something there: Display, less
 * the window's fullscreen switch, and About with the licence, the fork's source and the build
 * (m2-tech-spec §3.4, M2a-4, K5, N1). Desktop keeps every section as it was (DM-5).
 */
const platformState = { mobile: false };
const opened: string[] = [];

vi.mock("../lib/platform", () => ({ isMobileBuild: () => platformState.mobile }));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (url: string) => {
    opened.push(url);
    return Promise.resolve();
  },
}));
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

const OFFLINE_ONLY = ["settings.gameplay", "settings.gameEngine", "settings.savesData"];

beforeEach(() => {
  platformState.mobile = false;
  opened.length = 0;
});

describe("Settings on the phone app (M2a1)", () => {
  // Given the phone app,
  // when Settings opens,
  // then Gameplay, Engine and Saves & data are gone, and so are the fullscreen switch and the UI
  // scale (the phone's own text size rules there); the theme and language stay.
  it("keeps only what the phone app uses", () => {
    platformState.mobile = true;
    render(<Settings />);
    for (const section of OFFLINE_ONLY) {
      expect(screen.queryByText(section)).not.toBeInTheDocument();
    }
    expect(screen.queryByText("settings.fullscreen")).not.toBeInTheDocument();
    expect(screen.queryByText("settings.uiScale")).not.toBeInTheDocument();
    expect(screen.getByText("settings.display")).toBeInTheDocument();
    expect(screen.getByText("settings.theme")).toBeInTheDocument();
    expect(screen.getByText("settings.language")).toBeInTheDocument();
  });

  // Given the phone app,
  // when the coach reads About,
  // then it names the GPLv3 licence and shows the fork's public source, which opens on a tap.
  it("names the licence and opens the fork's source", () => {
    platformState.mobile = true;
    render(<Settings />);
    expect(screen.getByText("settings.licence")).toBeInTheDocument();
    expect(screen.getByText(FORK_SOURCE_URL)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /settings.openSource/ }));
    expect(opened).toEqual([FORK_SOURCE_URL]);
  });

  // Given the desktop app,
  // when Settings opens,
  // then every section and the fullscreen switch are there, and About is as before.
  it("leaves desktop as it was", () => {
    render(<Settings />);
    for (const section of OFFLINE_ONLY) {
      expect(screen.getByText(section)).toBeInTheDocument();
    }
    expect(screen.getByText("settings.fullscreen")).toBeInTheDocument();
    expect(screen.getByText("settings.uiScale")).toBeInTheDocument();
    expect(screen.queryByText("settings.licence")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /settings.openSource/ })).not.toBeInTheDocument();
  });
});
