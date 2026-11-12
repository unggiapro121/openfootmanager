import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import MainMenu from "./MainMenu";

const navigateMock = vi.fn();
const setGameActiveMock = vi.fn();
const setGameStateMock = vi.fn();
const showErrorMock = vi.fn();
const translationState = {
  language: "en",
};
const COACH = {
  id: "coach-1",
  first_name: "Ada",
  last_name: "Lovelace",
  date_of_birth: "1980-01-01",
  nationality: "GB",
  region: "Europe",
  created_at: "2026-01-01T00:00:00Z",
  last_login_at: null,
};
/** The account the backend reports as logged in; null shows the login screen. */
const coachState: { account: typeof COACH | null } = { account: COACH };
const platformState = { mobile: false };

vi.mock("../lib/platform", () => ({ isMobileBuild: () => platformState.mobile }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../lib/errorDialog", () => ({
  showError: (title: string, detail: string) => showErrorMock(title, detail),
}));

const openUrlMock = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (...args: unknown[]) => openUrlMock(...args),
}));

// The native file-picker returns whatever the current test stages here.
let dialogOpenResult: string | null = null;
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => dialogOpenResult),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(vi.fn())),
}));

/** What the page that sent the player to the menu left in the router's state. */
const locationState: { state: unknown } = { state: null };
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
  useLocation: () => ({ state: locationState.state }),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: () => {},
  },
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: translationState.language },
  }),
}));

vi.mock("../store/gameStore", () => ({
  useGameStore: (
    selector: (state: {
      setGameActive: typeof setGameActiveMock;
      setGameState: typeof setGameStateMock;
    }) => unknown,
  ) =>
    selector({
      setGameActive: setGameActiveMock,
      setGameState: setGameStateMock,
    }),
}));

vi.mock("../components/ui", () => ({
  Button: ({
    children,
    iconRight: _iconRight,
    iconLeft: _iconLeft,
    ...props
  }: ComponentPropsWithoutRef<"button"> & {
    iconRight?: unknown;
    iconLeft?: unknown;
  }) => <button {...props}>{children}</button>,
  ThemeToggle: () => <div data-testid="theme-toggle" />,
  DatePicker: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (date: string) => void;
    error?: boolean;
  }) => {
    return (
      <input
        aria-label="manager-date-of-birth"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  },
  CountryFlag: ({ code }: { code: string }) => (
    <span data-testid={`country-flag-${code.toLowerCase()}`} />
  ),
  Select: ({
    value,
    onChange,
    children,
    "aria-label": ariaLabel,
  }: {
    value?: string | number | readonly string[];
    onChange?: (event: { target: { value: string } }) => void;
    children?: ReactNode;
    "aria-label"?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange?.({ target: { value: event.target.value } })}
    >
      {children}
    </select>
  ),
}));

vi.mock("../components/ui/ThemeToggle", () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}));

vi.mock("../components/menu/SavesList", () => ({
  default: ({
    saves,
    onLoad,
    onClaim,
  }: {
    saves?: Array<{ id: string; name: string; account_id?: string | null }>;
    onLoad?: (id: string) => void;
    onClaim?: (id: string) => void;
  }) => (
    <div data-testid="saves-list">
      {(saves ?? []).map((save) =>
        save.account_id ? (
          <button key={save.id} type="button" onClick={() => onLoad?.(save.id)}>
            {save.name}
          </button>
        ) : (
          <button key={save.id} type="button" onClick={() => onClaim?.(save.id)}>
            {`claim-${save.name}`}
          </button>
        ),
      )}
    </div>
  ),
}));

vi.mock("../components/menu/CoachLogin", () => ({
  default: ({
    onLoggedIn,
    notice,
  }: {
    onLoggedIn: (account: typeof COACH) => void;
    notice?: string;
  }) => (
    <>
      {notice && <p>notice:{notice}</p>}
      <button type="button" onClick={() => onLoggedIn(COACH)}>
        coach-login
      </button>
    </>
  ),
}));

vi.mock("../components/menu/PackageBuildStep", () => ({
  default: ({
    onNext,
    onTogglePackage,
    onInstallPackage,
    installedPackages,
  }: {
    onNext: () => void;
    onTogglePackage: (id: string) => void;
    onInstallPackage: () => void;
    installedPackages: Array<{ id: string }>;
  }) => (
    <div data-testid="package-build-step">
      {installedPackages.map((pkg) => (
        <button key={pkg.id} type="button" onClick={() => onTogglePackage(pkg.id)}>
          {`toggle-${pkg.id}`}
        </button>
      ))}
      <button type="button" onClick={onInstallPackage}>
        install-package
      </button>
      <button type="button" onClick={onNext}>
        package-next
      </button>
    </div>
  ),
}));

vi.mock("../components/menu/WorldSelect", () => ({
  default: ({
    onStart,
    onChangeHistoryDepthYears,
    historyDepthYears,
    onChangeDevelopmentSpeedPercent,
    developmentSpeedPercent,
  }: {
    onStart: () => void;
    onChangeHistoryDepthYears: (value: number) => void;
    historyDepthYears: number;
    onChangeDevelopmentSpeedPercent: (percent: number) => void;
    developmentSpeedPercent: number;
  }) => (
    <div data-testid="world-select">
      <button type="button" onClick={() => onChangeHistoryDepthYears(24)}>
        {`set-history-depth-24:${historyDepthYears}`}
      </button>
      <button type="button" onClick={() => onChangeDevelopmentSpeedPercent(300)}>
        {`set-development-speed-300:${developmentSpeedPercent}`}
      </button>
      <button type="button" onClick={onStart}>
        start-world
      </button>
    </div>
  ),
}));

const mockedInvoke = vi.mocked(invoke);

/** Answer `commands` as `impl` does, with the logged-in coach the menu asks for first. */
function mockCommands(impl: (command: string, args?: unknown) => Promise<unknown>): void {
  mockedInvoke.mockImplementation(async (command: string, args?: unknown) =>
    command === "get_active_coach_account" ? coachState.account : impl(command, args),
  );
}

// The packages step sits between the create form and the generation/world-select
// step. Its internals (installed-package list, stack validation) are covered by
// their own tests; here we shim it to a simple "advance" control so the manager-
// creation flow tests can drive create -> packages -> generation directly.
async function advanceThroughPackages(): Promise<void> {
  fireEvent.click(await screen.findByText("package-next"));
}

async function openCreateManagerForm(): Promise<void> {
  fireEvent.click(await screen.findByText("menu.newGame"));
  await screen.findByLabelText("createManager.startYear");
}

function fillCareerStartDetails(startYear = "2026", startPhase = "seasonStart"): void {
  fireEvent.change(screen.getByLabelText("createManager.startYear"), {
    target: { value: startYear },
  });
  fireEvent.change(screen.getByLabelText("createManager.startPhase"), {
    target: { value: startPhase },
  });
}

describe("MainMenu", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    setGameActiveMock.mockReset();
    setGameStateMock.mockReset();
    showErrorMock.mockReset();
    openUrlMock.mockReset();
    dialogOpenResult = null;
    localStorage.clear();
    translationState.language = "en";
    coachState.account = COACH;
    platformState.mobile = false;
    locationState.state = null;
    mockedInvoke.mockReset();
    mockCommands(async (command: string) => {
      if (command === "list_installed_packages") {
        return [];
      }

      if (command === "start_new_game") {
        return { id: "game-1" };
      }

      return null;
    });
    // MainMenu defers focus with requestAnimationFrame; defer one microtask so React
    // commits setFormErrors before focus runs (matches real rAF ordering).
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      queueMicrotask(() => cb(0));
      return 0;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // Restore any vi.spyOn (e.g. the console.error spy in the save-load test) so
    // it doesn't silently swallow errors in later cases. Plain vi.fn() mocks are
    // unaffected and are reset in beforeEach.
    vi.restoreAllMocks();
  });

  it("blocks progression when the start year is before the floor and focuses the year field", async () => {
    render(<MainMenu />);

    await openCreateManagerForm();
    fillCareerStartDetails("1899", "seasonStart");

    fireEvent.click(screen.getByText("createManager.chooseWorld"));

    await waitFor(() => {
      expect(screen.getByLabelText("createManager.startYear")).toHaveFocus();
    });
    expect(screen.getByText("validation.minStartYear")).toBeInTheDocument();
    expect(screen.queryByTestId("package-build-step")).not.toBeInTheDocument();
  });

  it("allows a historical start year so era world packages can be played", async () => {
    coachState.account = { ...COACH, date_of_birth: "1920-01-01" };
    render(<MainMenu />);

    await openCreateManagerForm();
    // A manager active in 1962 has to have been born in the era too — the
    // minimum-age rule is measured against the career start, not today.
    fillCareerStartDetails("1962", "seasonStart");

    fireEvent.click(screen.getByText("createManager.chooseWorld"));

    await waitFor(() => {
      expect(screen.getByTestId("package-build-step")).toBeInTheDocument();
    });
    expect(screen.queryByText("validation.minStartYear")).not.toBeInTheDocument();
  });

  it("passes the activated world package ids when starting a new career", async () => {
    mockCommands(async (command: string) => {
      if (command === "list_installed_packages") {
        return [
          {
            id: "premier-league",
            name: "Premier League",
            description: "Imported world",
            packageType: "database",
            teamCount: 20,
            playerCount: 400,
            issues: [],
          },
        ];
      }

      if (command === "start_new_game") {
        return { id: "game-1" };
      }

      return null;
    });

    render(<MainMenu />);

    await openCreateManagerForm();

    fireEvent.click(screen.getByText("createManager.chooseWorld"));

    // The packages step loads installed packages; activate one before advancing.
    fireEvent.click(await screen.findByText("toggle-premier-league"));
    await advanceThroughPackages();

    fireEvent.click(await screen.findByText("start-world"));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith(
        "start_new_game",
        expect.objectContaining({
          packageIds: ["premier-league"],
        }),
      );
    });

    expect(navigateMock).toHaveBeenCalledWith("/select-team");
  });

  function mockRealWorldInstalled() {
    mockCommands(async (command: string) => {
      if (command === "list_installed_packages") {
        return [
          {
            id: "real-world-2024-25",
            name: "Real World 2024/25",
            description: "",
            packageType: "database",
            teamCount: 302,
            playerCount: 8206,
            issues: [],
          },
        ];
      }
      if (command === "start_new_game") {
        return { id: "game-1" };
      }
      return null;
    });
  }

  // Given the real-world package is installed, when a career is started without touching the
  // package list, then it starts from that package — it is the default world.
  it("starts from the real-world package when the player leaves the default selected", async () => {
    mockRealWorldInstalled();
    render(<MainMenu />);

    await openCreateManagerForm();
    fireEvent.click(screen.getByText("createManager.chooseWorld"));
    await screen.findByText("toggle-real-world-2024-25");
    await advanceThroughPackages();
    fireEvent.click(await screen.findByText("start-world"));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith(
        "start_new_game",
        expect.objectContaining({ packageIds: ["real-world-2024-25"] }),
      );
    });
  });

  // Given the default package is pre-selected, when the player unticks it, then the career is
  // generated as a random world: no package ids are sent.
  it("generates a random world once the player unticks the default package", async () => {
    mockRealWorldInstalled();
    render(<MainMenu />);

    await openCreateManagerForm();
    fireEvent.click(screen.getByText("createManager.chooseWorld"));
    fireEvent.click(await screen.findByText("toggle-real-world-2024-25"));
    await advanceThroughPackages();
    fireEvent.click(await screen.findByText("start-world"));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith(
        "start_new_game",
        expect.objectContaining({ packageIds: undefined }),
      );
    });
  });

  it("installs a world package from a picked .ofm file and makes it activatable", async () => {
    dialogOpenResult = "/tmp/custom-world.ofm";
    let installed = false;
    mockCommands(async (command: string) => {
      if (command === "list_installed_packages") {
        return installed
          ? [
              {
                id: "custom-world",
                name: "Custom World",
                description: "",
                packageType: "database",
                teamCount: 8,
                playerCount: 160,
                issues: [],
              },
            ]
          : [];
      }
      if (command === "install_package") {
        installed = true;
        return { id: "custom-world", name: "Custom World", packageType: "database", issues: [] };
      }
      if (command === "start_new_game") {
        return { id: "game-1" };
      }
      return null;
    });

    render(<MainMenu />);

    await openCreateManagerForm();
    fireEvent.click(screen.getByText("createManager.chooseWorld"));

    // No packages installed yet, so the file has to be imported first.
    expect(screen.queryByText("toggle-custom-world")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByText("install-package"));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("install_package", {
        path: "/tmp/custom-world.ofm",
      });
    });

    // After install the list reloads and the imported world can be activated.
    fireEvent.click(await screen.findByText("toggle-custom-world"));
    await advanceThroughPackages();
    fireEvent.click(await screen.findByText("start-world"));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith(
        "start_new_game",
        expect.objectContaining({ packageIds: ["custom-world"] }),
      );
    });
  });

  it("does not install anything when the file picker is cancelled", async () => {
    dialogOpenResult = null; // user dismissed the picker
    render(<MainMenu />);

    await openCreateManagerForm();
    fireEvent.click(screen.getByText("createManager.chooseWorld"));

    fireEvent.click(await screen.findByText("install-package"));

    // Give any (incorrect) install call a chance to fire, then assert none did.
    await waitFor(() => expect(screen.getByTestId("package-build-step")).toBeInTheDocument());
    expect(mockedInvoke).not.toHaveBeenCalledWith("install_package", expect.anything());
  });

  it("surfaces a message when a save fails to load", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    mockCommands(async (command: string) => {
      if (command === "list_installed_packages") {
        return [];
      }
      if (command === "get_saves") {
        return [
          {
            id: "save-1",
            name: "My Save",
            manager_name: "Ada Lovelace",
            account_id: "coach-1",
            db_filename: "save-1.db",
            checksum: "abc",
            created_at: "2026-01-01T00:00:00Z",
            last_played_at: "2026-02-01T00:00:00Z",
          },
        ];
      }
      if (command === "load_game") {
        throw "be.error.saveLoad.incompatibleVersion?saveVersion=99&supported=29";
      }
      return null;
    });

    render(<MainMenu />);

    fireEvent.click(await screen.findByText("menu.loadGame"));

    const saveButton = await screen.findByText("My Save");
    fireEvent.click(saveButton);

    await waitFor(() => {
      // Title and detail are separate arguments now; the fake `t` returns the key it is
      // given, so these are the two keys the page passes.
      expect(showErrorMock).toHaveBeenCalledWith("errors.title", "menu.loadGameFailed");
    });
    expect(navigateMock).not.toHaveBeenCalledWith("/dashboard");
  });

  it("passes the selected generated history depth when starting a new career", async () => {
    render(<MainMenu />);

    await openCreateManagerForm();

    fireEvent.click(screen.getByText("createManager.chooseWorld"));

    await advanceThroughPackages();

    fireEvent.click(screen.getByText("set-history-depth-24:12"));
    fireEvent.click(await screen.findByText("start-world"));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith(
        "start_new_game",
        expect.objectContaining({
          startupOptions: expect.objectContaining({
            historyDepthYears: 24,
          }),
        }),
      );
    });
  });

  /**
   * Given a new career, when ×3 is chosen at the world step, then the career is
   * created at ×3 — the only point at which the speed can be set.
   */
  it("passes the chosen development speed when starting a new career", async () => {
    render(<MainMenu />);

    await openCreateManagerForm();

    fireEvent.click(screen.getByText("createManager.chooseWorld"));

    await advanceThroughPackages();

    fireEvent.click(screen.getByText("set-development-speed-300:100"));
    fireEvent.click(await screen.findByText("start-world"));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith(
        "start_new_game",
        expect.objectContaining({
          startupOptions: expect.objectContaining({
            developmentSpeedPercent: 300,
          }),
        }),
      );
    });
  });

  it("persists generated history depth changes to localStorage", async () => {
    render(<MainMenu />);

    await openCreateManagerForm();

    fireEvent.click(screen.getByText("createManager.chooseWorld"));

    await advanceThroughPackages();

    expect(localStorage.getItem("ofm-generated-history-depth-years")).toBe("12");

    fireEvent.click(screen.getByText("set-history-depth-24:12"));

    expect(localStorage.getItem("ofm-generated-history-depth-years")).toBe("24");
  });

  it("restores the stored generated history depth preference", async () => {
    localStorage.setItem("ofm-generated-history-depth-years", "24");

    render(<MainMenu />);

    await openCreateManagerForm();

    fireEvent.click(screen.getByText("createManager.chooseWorld"));
    await advanceThroughPackages();

    await waitFor(() => {
      expect(screen.getByText("set-history-depth-24:24")).toBeInTheDocument();
    });
  });

  it("falls back to the default generated history depth when storage is invalid", async () => {
    localStorage.setItem("ofm-generated-history-depth-years", "99");

    render(<MainMenu />);

    await openCreateManagerForm();

    fireEvent.click(screen.getByText("createManager.chooseWorld"));
    await advanceThroughPackages();

    await waitFor(() => {
      expect(screen.getByText("set-history-depth-24:12")).toBeInTheDocument();
    });
    expect(localStorage.getItem("ofm-generated-history-depth-years")).toBe("12");
  });

  it("opens the Discord invite in the system browser when the Discord link is clicked", async () => {
    render(<MainMenu />);

    const discordButton = await screen.findByRole("button", { name: "menu.openDiscord" });
    fireEvent.click(discordButton);

    expect(openUrlMock).toHaveBeenCalledTimes(1);
    expect(openUrlMock).toHaveBeenCalledWith("https://discord.gg/2CXaesaukT");
  });

  it("opens the GitHub repository in the system browser when the GitHub link is clicked", async () => {
    render(<MainMenu />);

    const githubButton = await screen.findByRole("button", { name: "menu.openGithub" });
    fireEvent.click(githubButton);

    expect(openUrlMock).toHaveBeenCalledTimes(1);
    expect(openUrlMock).toHaveBeenCalledWith("https://github.com/openfootmanager/openfootmanager");
  });

  // ── Coach account (TK-4) ────────────────────────────────────────────────

  // Given nobody is logged in, when the menu opens, then only the login screen shows.
  it("shows the login screen until a coach logs in", async () => {
    coachState.account = null;
    render(<MainMenu />);

    fireEvent.click(await screen.findByText("coach-login"));

    expect(await screen.findByText("menu.newGame")).toBeInTheDocument();
  });

  // Given a coach who just asked for his account to be deleted in the online game (M3c1),
  // when he lands on the menu,
  // then the login screen says the request was received; once someone logs in and out, it is gone.
  it("says a deletion was asked above the login", async () => {
    coachState.account = null;
    locationState.state = { accountDeletion: "2026-11-19T10:00:00Z" };
    render(<MainMenu />);

    expect(await screen.findByText("notice:coachServer.deletionRequested")).toBeInTheDocument();

    fireEvent.click(screen.getByText("coach-login"));
    fireEvent.click(await screen.findByText("coach.switchAccount"));

    expect(await screen.findByText("coach-login")).toBeInTheDocument();
    expect(screen.queryByText(/^notice:/)).not.toBeInTheDocument();
  });

  // Given a logged-in coach, when he switches account, then he is logged out and back at the login screen.
  it("logs out and returns to the login screen on switching account", async () => {
    render(<MainMenu />);

    fireEvent.click(await screen.findByText("coach.switchAccount"));

    expect(await screen.findByText("coach-login")).toBeInTheDocument();
    expect(mockedInvoke).toHaveBeenCalledWith("logout_coach_account");
    expect(screen.queryByText("menu.newGame")).not.toBeInTheDocument();
  });

  // Given a logged-in coach, when a career starts, then the backend gets no identity: the account is the manager.
  it("starts a new game with only the startup options", async () => {
    render(<MainMenu />);

    await openCreateManagerForm();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    fillCareerStartDetails("2028", "midSeason");
    fireEvent.click(screen.getByText("createManager.chooseWorld"));
    await advanceThroughPackages();
    fireEvent.click(await screen.findByText("start-world"));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("start_new_game", {
        startupOptions: expect.objectContaining({ startYear: 2028, startPhase: "midSeason" }),
        packageIds: undefined,
      });
    });
    expect(navigateMock).toHaveBeenCalledWith("/select-team");
  });

  // Given a coach who turns 30 in August 2038, when a career would start in July 2038,
  // then a later start is asked for, and a mid-season start is accepted.
  it("asks for a later start while the coach would be under thirty", async () => {
    coachState.account = { ...COACH, date_of_birth: "2008-08-01" };
    render(<MainMenu />);

    await openCreateManagerForm();
    fillCareerStartDetails("2038", "seasonStart");
    expect(screen.getByText("coach.tooYoungForStart")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("createManager.startPhase"), {
      target: { value: "midSeason" },
    });

    await waitFor(() => {
      expect(screen.queryByText("coach.tooYoungForStart")).not.toBeInTheDocument();
    });
  });

  // Given a coach too young for the default start, when the form is sent, then it stops on the start year.
  it("blocks a start the coach is too young for and focuses the year", async () => {
    coachState.account = { ...COACH, date_of_birth: "2010-06-15" };
    render(<MainMenu />);

    await openCreateManagerForm();
    fireEvent.click(screen.getByText("createManager.chooseWorld"));

    await waitFor(() => {
      expect(screen.getByLabelText("createManager.startYear")).toHaveFocus();
    });
    expect(screen.queryByTestId("package-build-step")).not.toBeInTheDocument();
  });

  // Given saves of this coach, of another and of none, when the load list opens,
  // then another coach's career is hidden and one with no account is offered to claim.
  it("lists only the coach's careers and those without an account", async () => {
    const entry = (id: string, accountId: string | null) => ({
      id,
      name: `Save ${id}`,
      manager_name: "",
      team_name: "",
      db_filename: `${id}.db`,
      checksum: "",
      created_at: "2026-01-01T00:00:00Z",
      last_played_at: "2026-02-01T00:00:00Z",
      account_id: accountId,
    });
    mockCommands(async (command: string) => {
      if (command === "get_saves") {
        return [entry("own", "coach-1"), entry("other", "coach-2"), entry("old", null)];
      }
      if (command === "load_game") return "Ada Lovelace";
      if (command === "get_active_game") throw new Error("no game");
      return null;
    });
    render(<MainMenu />);

    fireEvent.click(await screen.findByText("menu.loadGame"));

    expect(await screen.findByText("Save own")).toBeInTheDocument();
    expect(screen.queryByText("Save other")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("claim-Save old"));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("claim_save_for_coach", { saveId: "old" });
    });
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("load_game", { saveId: "old" });
    });
  });

  // Given a coach whose account lives on the server,
  // when the main menu shows,
  // then it offers online play, which opens the online mode.
  it("offers online play to a coach with a server account", async () => {
    mockCommands(async (command: string) =>
      command === "get_coach_account_mode" ? "server" : null,
    );
    render(<MainMenu />);

    fireEvent.click(await screen.findByText("online.menuButton"));
    expect(navigateMock).toHaveBeenCalledWith("/online");
  });

  // Given a coach with an account on this machine only,
  // when the main menu shows,
  // then it has no online entry: online play needs the server (C-2 C2-1).
  it("hides online play from a local account", async () => {
    mockCommands(async (command: string) =>
      command === "get_coach_account_mode" ? "local" : null,
    );
    render(<MainMenu />);

    await screen.findByText("menu.newGame");
    await waitFor(() => expect(mockedInvoke).toHaveBeenCalledWith("get_coach_account_mode"));
    expect(screen.queryByText("online.menuButton")).not.toBeInTheDocument();
  });

  // Given the phone app (online only, phase 5 DM-1),
  // when a coach with a server account opens the main menu,
  // then it offers online play and the settings, and none of the offline entries: no new game,
  // no saves, no world editor, and no quit button (Apple's guidelines; M1 rebuild finding 3).
  it("keeps the phone app's menu to online play", async () => {
    platformState.mobile = true;
    mockCommands(async (command: string) =>
      command === "get_coach_account_mode" ? "server" : null,
    );
    render(<MainMenu />);

    expect(await screen.findByText("online.menuButton")).toBeInTheDocument();
    expect(screen.getByText("menu.settings")).toBeInTheDocument();
    for (const offline of ["menu.newGame", "menu.loadGame", "menu.worldEditor", "menu.exitGame"]) {
      expect(screen.queryByText(offline)).not.toBeInTheDocument();
    }
  });

  // Given the phone app, which has no support channel of its own yet (phase 5 M2b, K5),
  // when the main menu opens,
  // then it shows no Discord, GitHub or bug-report button: those lead to the original project.
  it("keeps the phone app's menu free of the original project's community links", async () => {
    platformState.mobile = true;
    mockCommands(async (command: string) =>
      command === "get_coach_account_mode" ? "server" : null,
    );
    render(<MainMenu />);

    expect(await screen.findByText("online.menuButton")).toBeInTheDocument();
    for (const name of ["menu.openDiscord", "menu.openGithub", "menu.reportBug"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });
});
