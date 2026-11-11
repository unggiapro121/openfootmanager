import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { ComponentPropsWithoutRef } from "react";

import { PHONE_QUERY } from "../../../hooks/usePhoneLayout";
import CoachServerLogin from "./CoachServerLogin";

/**
 * The account forms on a phone keyboard (m2-tech-spec §3.2, M2a-2): each field says what it holds
 * so the keyboard, autofill and password managers fit it; Enter walks to the next field and sends
 * from the last.
 */
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../../utils/backendI18n", () => ({
  resolveBackendError: (error: unknown) => String(error),
}));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("../CreateManagerNationalityField", () => ({ default: () => null }));
vi.mock("../../ui", () => ({
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

beforeEach(() => {
  mockedInvoke.mockReset();
  mockedInvoke.mockImplementation(async (command: string) =>
    command === "get_coach_account_mode" ? "server" : null,
  );
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === PHONE_QUERY,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function openLogin() {
  render(<CoachServerLogin onLoggedIn={vi.fn()} />);
  await screen.findByRole("heading", { name: "coachServer.loginTitle" });
}

function field(label: string): HTMLElement {
  return screen.getByLabelText(label);
}

/** Enter in `from` on a phone, and whether the form was left to send itself. */
function enter(from: HTMLElement): boolean {
  from.focus();
  return fireEvent.keyDown(from, { key: "Enter" });
}

describe("the account forms on a phone (M2a-2)", () => {
  // Given the login form,
  // when the keyboard opens on its fields,
  // then the email is the account's user name, typed as is, and the password the current one,
  // with Enter going on from the email and logging in from the password.
  it("words the login fields for the keyboard and autofill", async () => {
    await openLogin();
    const email = field("coachServer.email");
    const password = field("coachServer.password");
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "username");
    expect(email).toHaveAttribute("autocapitalize", "none");
    expect(email).toHaveAttribute("enterkeyhint", "next");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(password).toHaveAttribute("enterkeyhint", "go");

    expect(enter(email)).toBe(false);
    expect(password).toHaveFocus();
    expect(enter(password)).toBe(true);
  });

  // Given the code from the email, which is letters and digits with capitals that count,
  // when it is typed or pasted,
  // then the keyboard neither capitalises nor corrects it, and offers the code from the mail.
  it("takes the email code exactly as written", async () => {
    await openLogin();
    fireEvent.click(screen.getByRole("button", { name: "coachServer.haveCode" }));
    const code = field("coachServer.code");
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
    expect(code).toHaveAttribute("autocapitalize", "none");
    expect(code).toHaveAttribute("autocorrect", "off");
    expect(code).toHaveAttribute("spellcheck", "false");
    expect(code).not.toHaveAttribute("inputmode");
    expect(code).toHaveAttribute("enterkeyhint", "send");
  });

  // Given the new password form,
  // when Enter is pressed field after field,
  // then it walks code, new password and confirmation, the passwords marked as new ones.
  it("walks the reset form with Enter", async () => {
    await openLogin();
    fireEvent.click(screen.getByRole("button", { name: "coachServer.forgotPassword" }));
    expect(field("coachServer.email")).toHaveAttribute("enterkeyhint", "send");
    fireEvent.click(screen.getByRole("button", { name: "coachServer.haveCode" }));

    const code = field("coachServer.code");
    const password = field("coachServer.newPassword");
    const confirmation = field("coachServer.confirmPassword");
    expect(password).toHaveAttribute("autocomplete", "new-password");
    expect(confirmation).toHaveAttribute("enterkeyhint", "send");
    expect(enter(code)).toBe(false);
    expect(password).toHaveFocus();
    expect(enter(password)).toBe(false);
    expect(confirmation).toHaveFocus();
  });

  // Given the registration form,
  // when Enter is pressed in the password confirmation,
  // then the first name is next: the coach's own fields are walked like the account's.
  it("walks from the account fields into the coach's name", async () => {
    await openLogin();
    fireEvent.click(screen.getByRole("button", { name: "coach.createAccount" }));
    expect(field("coachServer.email")).toHaveAttribute("autocomplete", "username");
    expect(enter(field("coachServer.confirmPassword"))).toBe(false);
    expect(field("createManager.firstName")).toHaveFocus();
    expect(field("createManager.firstName")).toHaveAttribute("enterkeyhint", "next");
    expect(enter(field("createManager.firstName"))).toBe(false);
    expect(field("createManager.lastName")).toHaveFocus();
  });
});
