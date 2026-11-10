import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { ComponentPropsWithoutRef } from "react";

import CoachLogin from "./CoachLogin";

/**
 * The phone app built without a server address (M2b4, P5-23): it has no offline game (DM-1), so
 * instead of the accounts kept on this machine it says the install cannot reach a server and logs
 * why. The desktop app keeps its local accounts.
 */
const platformState = { mobile: false };
const logged: string[] = [];

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../lib/platform", () => ({ isMobileBuild: () => platformState.mobile }));
vi.mock("../../lib/logger", () => ({
  logError: (message: string) => logged.push(message),
  logInfo: () => {},
}));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("./CreateManagerNationalityField", () => ({ default: () => null }));
vi.mock("../ui", () => ({
  Button: ({
    children,
    icon: _icon,
    iconRight: _iconRight,
    ...props
  }: ComponentPropsWithoutRef<"button"> & { icon?: unknown; iconRight?: unknown }) => (
    <button {...props}>{children}</button>
  ),
  DatePicker: () => null,
  Select: () => null,
}));

const mockedInvoke = vi.mocked(invoke);

function answer(mode: "local" | "server") {
  mockedInvoke.mockImplementation(async (command: string) => {
    if (command === "get_coach_account_mode") return mode;
    if (command === "list_coach_accounts") return [];
    return null;
  });
}

function asked(command: string): boolean {
  return mockedInvoke.mock.calls.some(([name]) => name === command);
}

beforeEach(() => {
  mockedInvoke.mockReset();
  platformState.mobile = false;
  logged.length = 0;
});

describe("the phone app without a server (M2b4)", () => {
  // Given the phone app built without a server address,
  // when the login gate opens,
  // then it says to reinstall from the store, offers no form and no local account, and logs
  // the reason as an error.
  it("blocks with the reinstall notice", async () => {
    platformState.mobile = true;
    answer("local");
    render(<CoachLogin onLoggedIn={vi.fn()} />);

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("coach.noServer");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(asked("list_coach_accounts")).toBe(false);
    expect(logged).toHaveLength(1);
  });

  // Given the phone app with a server address,
  // when the login gate opens,
  // then it is the server's login, without the notice.
  it("leaves the server login alone", async () => {
    platformState.mobile = true;
    answer("server");
    render(<CoachLogin onLoggedIn={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "coachServer.loginTitle" })).toBeVisible();
    expect(screen.queryByText("coach.noServer")).toBeNull();
    expect(logged).toEqual([]);
  });

  // Given the desktop app without a server address,
  // when the login gate opens,
  // then it keeps the accounts on this machine, as before.
  it("keeps the local accounts on the desktop", async () => {
    answer("local");
    render(<CoachLogin onLoggedIn={vi.fn()} />);

    await waitFor(() => expect(asked("list_coach_accounts")).toBe(true));
    expect(screen.queryByText("coach.noServer")).toBeNull();
    expect(logged).toEqual([]);
  });
});
