import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { countryName } from "../../lib/countries";
import { resetCountryResourcesCache } from "./CreateManagerNationalityField";
import CoachLogin from "./CoachLogin";

const showErrorMock = vi.fn();
let latestDatePickerOnChange: ((date: string) => void) | null = null;
const translationState = { language: "en" };

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../../lib/errorDialog", () => ({
  showError: (title: string, detail: string) => showErrorMock(title, detail),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && typeof options.name === "string" ? `${key}:${options.name}` : key,
    i18n: { language: translationState.language },
  }),
}));

vi.mock("../ui", () => ({
  Button: ({
    children,
    icon: _icon,
    iconRight: _iconRight,
    ...props
  }: ComponentPropsWithoutRef<"button"> & { icon?: unknown; iconRight?: unknown }) => (
    <button {...props}>{children}</button>
  ),
  DatePicker: ({ value, onChange }: { value: string; onChange: (date: string) => void }) => {
    latestDatePickerOnChange = onChange;
    return (
      <input
        aria-label="coach-date-of-birth"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  },
  CountryFlag: ({ code }: { code: string }) => (
    <span data-testid={`country-flag-${code.toLowerCase()}`} />
  ),
  Select: ({
    id,
    value,
    onChange,
    children,
  }: {
    id?: string;
    value?: string;
    onChange?: (event: { target: { value: string } }) => void;
    children?: ReactNode;
  }) => (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange?.({ target: { value: event.target.value } })}
    >
      {children}
    </select>
  ),
}));

const mockedInvoke = vi.mocked(invoke);

const existingAccount = {
  id: "a-1",
  first_name: "Dung",
  last_name: "Ung",
  date_of_birth: "1990-05-01",
  nationality: "VN",
  region: "AsiaSoutheast",
  created_at: "2026-09-01T00:00:00Z",
  last_login_at: null,
};

function mockAccounts(accounts: unknown[]) {
  mockedInvoke.mockImplementation(async (command: string, args?: unknown) => {
    if (command === "get_coach_account_mode") return "local";
    if (command === "list_coach_accounts") return accounts;
    if (command === "create_coach_account") {
      const { identity } = args as { identity: Record<string, string> };
      return { ...identity, id: "new-1", created_at: "now", last_login_at: null };
    }
    if (command === "login_coach_account") {
      return { ...existingAccount, id: (args as { id: string }).id };
    }
    if (command === "delete_coach_account") return true;
    return null;
  });
}

async function getNationalityTrigger(): Promise<HTMLButtonElement> {
  let trigger: HTMLButtonElement | null = null;
  await waitFor(() => {
    const field = document.getElementById("create-manager-field-nationality");
    const candidate = field?.querySelector("div.relative > button:not([disabled])");
    trigger = candidate instanceof HTMLButtonElement ? candidate : null;
    expect(trigger).toBeInstanceOf(HTMLButtonElement);
  });
  if (!trigger) throw new Error("Nationality trigger button not found");
  return trigger;
}

async function selectNationality(language: string, code: string): Promise<void> {
  fireEvent.mouseDown(await getNationalityTrigger());
  fireEvent.mouseDown(await screen.findByText(countryName(code, language)));
}

async function fillIdentity(dob = "1980-01-01"): Promise<void> {
  fireEvent.change(await screen.findByPlaceholderText("createManager.placeholderFirst"), {
    target: { value: "Ada" },
  });
  fireEvent.change(screen.getByPlaceholderText("createManager.placeholderLast"), {
    target: { value: "Lovelace" },
  });
  fireEvent.change(screen.getByLabelText("coach-date-of-birth"), { target: { value: dob } });
}

describe("CoachLogin", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    showErrorMock.mockReset();
    latestDatePickerOnChange = null;
    translationState.language = "en";
  });

  afterEach(() => {
    resetCountryResourcesCache();
  });

  // Given accounts on the server and a deletion just asked (M3c1),
  // when the login opens,
  // then the server login shows the notice the menu handed over.
  it("hands the menu's notice to the server login", async () => {
    mockedInvoke.mockImplementation(async (command: string) =>
      command === "get_coach_account_mode" ? "server" : null,
    );

    render(<CoachLogin onLoggedIn={vi.fn()} notice="deletion asked" />);

    expect(await screen.findByText("deletion asked")).toBeInTheDocument();
  });

  // Given accounts on this machine, when the player picks one, then he is logged in as it.
  it("logs in as a listed account", async () => {
    mockAccounts([existingAccount]);
    const onLoggedIn = vi.fn();
    render(<CoachLogin onLoggedIn={onLoggedIn} />);

    fireEvent.click(await screen.findByRole("button", { name: "coach.logInAs:Dung Ung" }));

    await waitFor(() =>
      expect(onLoggedIn).toHaveBeenCalledWith(expect.objectContaining({ id: "a-1" })),
    );
    expect(mockedInvoke).toHaveBeenCalledWith("login_coach_account", { id: "a-1" });
  });

  // Given an account, when the player deletes it after confirming, then it leaves the list.
  it("deletes an account after confirming", async () => {
    mockAccounts([existingAccount, { ...existingAccount, id: "a-2", first_name: "Pep" }]);
    render(<CoachLogin onLoggedIn={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "coach.deleteAccount:Dung Ung" }));
    expect(mockedInvoke).not.toHaveBeenCalledWith("delete_coach_account", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "menu.delete" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "coach.logInAs:Dung Ung" }),
      ).not.toBeInTheDocument();
    });
    expect(mockedInvoke).toHaveBeenCalledWith("delete_coach_account", { id: "a-1" });
  });

  // Given no account yet, when the screen opens, then the new-account form is shown with no way back.
  it("opens the new-account form when there is no account", async () => {
    mockAccounts([]);
    render(<CoachLogin onLoggedIn={vi.fn()} />);

    expect(await screen.findByText("coach.newAccountTitle")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "common.close" })).not.toBeInTheDocument();
  });

  // Given an incomplete form, when it is sent, then nothing is created and the fields say why.
  it("does not create an account from an incomplete form", async () => {
    mockAccounts([]);
    render(<CoachLogin onLoggedIn={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "coach.createAccount" }));

    expect(screen.getAllByText("validation.required").length).toBeGreaterThan(0);
    expect(mockedInvoke).not.toHaveBeenCalledWith("create_coach_account", expect.anything());
  });

  // Given a coach under thirty, when the form is sent, then the birth date is refused.
  it("refuses a coach under thirty", async () => {
    mockAccounts([]);
    render(<CoachLogin onLoggedIn={vi.fn()} />);

    await fillIdentity("2015-06-15");
    await selectNationality("en", "ES");
    fireEvent.click(screen.getByRole("button", { name: "coach.createAccount" }));

    expect(await screen.findByText("validation.minAge")).toBeInTheDocument();
    expect(mockedInvoke).not.toHaveBeenCalledWith("create_coach_account", expect.anything());
  });

  it.each(["es", "de", "fr", "it", "pt", "pt-BR"])(
    "creates an account with the nationality as an ISO code and logs in, in %s",
    async (language: string) => {
      translationState.language = language;
      mockAccounts([]);
      const onLoggedIn = vi.fn();
      render(<CoachLogin onLoggedIn={onLoggedIn} />);

      await fillIdentity();
      await selectNationality(language, "ES");
      fireEvent.change(document.querySelector("select") as HTMLSelectElement, {
        target: { value: "Europe" },
      });
      fireEvent.click(screen.getByRole("button", { name: "coach.createAccount" }));

      await waitFor(() => expect(onLoggedIn).toHaveBeenCalled());
      expect(mockedInvoke).toHaveBeenCalledWith("create_coach_account", {
        identity: {
          first_name: "Ada",
          last_name: "Lovelace",
          date_of_birth: "1980-01-01",
          nationality: "ES",
          region: "Europe",
        },
      });
      expect(mockedInvoke).toHaveBeenCalledWith("login_coach_account", { id: "new-1" });
    },
  );

  it("allows changing nationality after the other fields are filled", async () => {
    mockAccounts([]);
    render(<CoachLogin onLoggedIn={vi.fn()} />);

    await fillIdentity();
    await selectNationality("en", "ES");
    expect(screen.getByRole("button", { name: /spain/i })).toBeInTheDocument();
    await selectNationality("en", "DE");

    expect(screen.getByRole("button", { name: /germany/i })).toBeInTheDocument();
  });

  it("allows selecting England instead of legacy GB", async () => {
    mockAccounts([]);
    render(<CoachLogin onLoggedIn={vi.fn()} />);

    await fillIdentity();
    await selectNationality("en", "ENG");

    expect(screen.getByRole("button", { name: /england/i })).toBeInTheDocument();
  });

  it("preserves nationality when a stale date picker callback fires after selection", async () => {
    mockAccounts([]);
    render(<CoachLogin onLoggedIn={vi.fn()} />);

    await fillIdentity();
    const staleDatePickerOnChange = latestDatePickerOnChange;
    await selectNationality("en", "DE");
    act(() => {
      staleDatePickerOnChange?.("1980-01-01");
    });

    expect(screen.getByRole("button", { name: /germany/i })).toBeInTheDocument();
  });

  it("allows searching localized countries without accents before selecting them", async () => {
    translationState.language = "pt";
    mockAccounts([]);
    render(<CoachLogin onLoggedIn={vi.fn()} />);

    await fillIdentity();
    fireEvent.mouseDown(await getNationalityTrigger());
    fireEvent.change(await screen.findByPlaceholderText("createManager.searchNationalities"), {
      target: { value: "austria" },
    });
    fireEvent.mouseDown(await screen.findByText(countryName("AT", "pt")));

    expect(screen.getByRole("button", { name: /áustria/i })).toBeInTheDocument();
  });
});
