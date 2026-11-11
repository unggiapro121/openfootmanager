import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import CoachServerLogin from "./CoachServerLogin";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const markReady = vi.fn();
vi.mock("../../../lib/readyMarker", () => ({ markReady: (stage: string) => markReady(stage) }));

vi.mock("../../../utils/backendI18n", () => ({
  resolveBackendError: (error: unknown) => `resolved:${String(error)}`,
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && typeof options.email === "string" ? `${key}:${options.email}` : key,
    i18n: { language: "en" },
  }),
}));

vi.mock("../CreateManagerNationalityField", () => ({
  default: ({ onChange }: { onChange: (code: string) => void }) => (
    <button type="button" onClick={() => onChange("VN")}>
      pick-vietnam
    </button>
  ),
}));

vi.mock("../../ui", () => ({
  Button: ({
    children,
    icon: _icon,
    iconRight: _iconRight,
    ...props
  }: ComponentPropsWithoutRef<"button"> & { icon?: unknown; iconRight?: unknown }) => (
    <button {...props}>{children}</button>
  ),
  DatePicker: ({ value, onChange }: { value: string; onChange: (date: string) => void }) => (
    <input
      aria-label="coach-date-of-birth"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
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

const account = {
  id: "0192f0c4-0000-7000-8000-000000000001",
  first_name: "Dung",
  last_name: "Ung",
  date_of_birth: "1990-05-01",
  nationality: "VN",
  region: "AsiaSoutheast",
  created_at: "",
  last_login_at: "2026-10-22T09:00:00Z",
};

type Answers = Record<string, (args?: Record<string, unknown>) => unknown>;

/** The backend: `resume_coach_session` finds no session unless told otherwise. */
function backend(answers: Answers) {
  mockedInvoke.mockImplementation(async (command: string, args?: unknown) => {
    const answer = answers[command];
    if (answer) return answer(args as Record<string, unknown> | undefined);
    if (command === "resume_coach_session") return null;
    return undefined;
  });
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

function calls(command: string) {
  return mockedInvoke.mock.calls.filter(([name]) => name === command);
}

async function renderAtLogin(onLoggedIn = vi.fn()) {
  render(<CoachServerLogin onLoggedIn={onLoggedIn} />);
  await screen.findByRole("heading", { name: "coachServer.loginTitle" });
  return onLoggedIn;
}

describe("CoachServerLogin", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    markReady.mockClear();
  });

  // Given no kept session, when the login form shows, then it marks the login screen ready for
  // the cold-start measurement (phase 5 M2b-11).
  it("marks the login screen ready once the form shows", async () => {
    backend({});
    await renderAtLogin();

    // The mark is set in an effect, which may run just after the form is on the page: waited for,
    // since a loaded machine showed the form before the effect had run.
    await waitFor(() => expect(markReady).toHaveBeenCalledWith("login"));
  });

  // Given a kept session, when the gate resumes it, then no login screen was ever usable.
  it("does not mark the login screen ready when a session resumes", async () => {
    backend({ resume_coach_session: () => account });
    const onLoggedIn = vi.fn();
    render(<CoachServerLogin onLoggedIn={onLoggedIn} />);

    await waitFor(() => expect(onLoggedIn).toHaveBeenCalled());
    expect(markReady).not.toHaveBeenCalled();
  });

  // Given a session kept from the last run, when the gate opens, then the coach plays without a form.
  it("resumes a kept session", async () => {
    backend({ resume_coach_session: () => account });
    const onLoggedIn = vi.fn();

    render(<CoachServerLogin onLoggedIn={onLoggedIn} />);

    await waitFor(() => expect(onLoggedIn).toHaveBeenCalledWith(account));
    expect(screen.queryByLabelText("coachServer.password")).toBeNull();
  });

  // Given the server out of reach at start, when the gate opens, then the login form shows why.
  it("opens the login form with the error when the session cannot be resumed", async () => {
    backend({
      resume_coach_session: () => {
        throw "be.error.coach.offline";
      },
    });

    await renderAtLogin();

    expect(screen.getByRole("alert").textContent).toBe("resolved:be.error.coach.offline");
  });

  // Given the login form, when it is sent empty, then both fields say so and nothing is sent.
  it("asks for the email and password before logging in", async () => {
    backend({});
    await renderAtLogin();

    click("coachServer.logIn");

    expect(await screen.findAllByText("validation.required")).toHaveLength(2);
    expect(calls("login_coach_with_email")).toHaveLength(0);
  });

  // Given a known account, when the player logs in, then the backend gets the credentials and the coach plays.
  it("logs in with email and password", async () => {
    backend({ login_coach_with_email: () => account });
    const onLoggedIn = await renderAtLogin();

    type("coachServer.email", "coach@example.test");
    type("coachServer.password", "mot mat khau dai");
    click("coachServer.logIn");

    await waitFor(() => expect(onLoggedIn).toHaveBeenCalledWith(account));
    expect(calls("login_coach_with_email")[0][1]).toEqual({
      email: "coach@example.test",
      password: "mot mat khau dai",
    });
  });

  // Given a wrong password, when the player logs in, then the server's message shows and nobody plays.
  it("shows the server's refusal", async () => {
    backend({
      login_coach_with_email: () => {
        throw "be.error.auth.invalidCredentials";
      },
    });
    const onLoggedIn = await renderAtLogin();

    type("coachServer.email", "coach@example.test");
    type("coachServer.password", "wrong password");
    click("coachServer.logIn");

    expect((await screen.findByRole("alert")).textContent).toBe(
      "resolved:be.error.auth.invalidCredentials",
    );
    expect(onLoggedIn).not.toHaveBeenCalled();
  });

  // Given an unverified email, when the player logs in, then the code form opens, and a right code
  // brings them back to log in.
  it("sends an unverified account to the code form and back", async () => {
    backend({
      login_coach_with_email: () => {
        throw "be.error.auth.emailNotVerified";
      },
    });
    await renderAtLogin();
    type("coachServer.email", "coach@example.test");
    type("coachServer.password", "mot mat khau dai");
    click("coachServer.logIn");

    expect((await screen.findByRole("status")).textContent).toBe("coachServer.verifyFirst");
    expect((screen.getByLabelText("coachServer.email") as HTMLInputElement).value).toBe(
      "coach@example.test",
    );
    type("coachServer.code", "ABC123");
    click("coachServer.verify");

    expect(await screen.findByText("coachServer.verified")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "coachServer.loginTitle" })).toBeTruthy();
    expect(calls("verify_coach_email")[0][1]).toEqual({ code: "ABC123" });
  });

  // Given the code form, when a new code is asked for, then it goes to the email typed and the player is told.
  it("sends a new verification code", async () => {
    backend({});
    await renderAtLogin();
    click("coachServer.haveCode");
    type("coachServer.email", "coach@example.test");

    click("coachServer.resendCode");

    expect((await screen.findByRole("status")).textContent).toBe(
      "coachServer.codeSent:coach@example.test",
    );
    expect(calls("resend_coach_verification")[0][1]).toEqual({ email: "coach@example.test" });
  });

  // Given the registration form, when the passwords differ, then it says so; once they match, the
  // account is registered and the code form opens.
  it("registers an account and asks for its code", async () => {
    backend({});
    await renderAtLogin();
    click("coach.createAccount");
    await screen.findByRole("heading", { name: "coachServer.registerTitle" });

    type("coachServer.email", "coach@example.test");
    type("coachServer.password", "mot mat khau dai");
    type("coachServer.confirmPassword", "another password");
    type("createManager.firstName", "Dung");
    type("createManager.lastName", "Ung");
    type("coach-date-of-birth", "1990-05-01");
    fireEvent.click(await screen.findByRole("button", { name: "pick-vietnam" }));
    click("coach.createAccount");

    expect(await screen.findByText("coachServer.passwordMismatch")).toBeTruthy();
    expect(calls("register_coach_account")).toHaveLength(0);

    type("coachServer.confirmPassword", "mot mat khau dai");
    click("coach.createAccount");

    expect((await screen.findByRole("status")).textContent).toBe(
      "coachServer.codeSent:coach@example.test",
    );
    expect(calls("register_coach_account")[0][1]).toEqual({
      registration: {
        email: "coach@example.test",
        password: "mot mat khau dai",
        identity: {
          first_name: "Dung",
          last_name: "Ung",
          date_of_birth: "1990-05-01",
          nationality: "VN",
          region: "AsiaSoutheast",
        },
      },
    });
  });

  // Given a forgotten password, when the player asks for a code and enters it with a new password,
  // then both reach the backend and the login form says the password changed.
  it("resets a forgotten password with the emailed code", async () => {
    backend({});
    await renderAtLogin();
    click("coachServer.forgotPassword");
    type("coachServer.email", "coach@example.test");
    click("coachServer.sendResetCode");

    expect((await screen.findByRole("status")).textContent).toBe(
      "coachServer.resetCodeSent:coach@example.test",
    );
    type("coachServer.code", "XYZ789");
    type("coachServer.newPassword", "short");
    type("coachServer.confirmPassword", "short");
    click("coachServer.resetPassword");
    expect(await screen.findByText("coachServer.passwordLength")).toBeTruthy();

    type("coachServer.newPassword", "mot mat khau moi dai");
    type("coachServer.confirmPassword", "mot mat khau moi dai");
    click("coachServer.resetPassword");

    expect(await screen.findByText("coachServer.passwordChanged")).toBeTruthy();
    expect(calls("request_coach_password_reset")[0][1]).toEqual({ email: "coach@example.test" });
    expect(calls("reset_coach_password")[0][1]).toEqual({
      code: "XYZ789",
      newPassword: "mot mat khau moi dai",
    });
  });
});
