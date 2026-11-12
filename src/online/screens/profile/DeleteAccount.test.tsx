import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import {
  fakeServer,
  LEAGUE,
  myClub,
  ok,
  renderOnline,
  resetOnline,
  SEASON,
} from "../../../test-utils/onlineTestKit";
import { useOnlineStore } from "../../store/onlineStore";
import DeleteAccountCard from "./DeleteAccountCard";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      options && typeof options === "object"
        ? `${key}:${Object.values(options as Record<string, unknown>).join("|")}`
        : key,
    i18n: { language: "en" },
  }),
}));

vi.mock("../../../utils/backendI18n", () => ({
  resolveBackendError: (error: unknown) =>
    `resolved:${error instanceof Error ? error.message : String(error)}`,
}));

const requestAccountDeletion = vi.fn();
vi.mock("../../../services/onlineAccountService", () => ({
  requestAccountDeletion: (password: string, key: string) => requestAccountDeletion(password, key),
}));

configure({ asyncUtilTimeout: 5_000 });

const KEY = "online.profile.deletion";
const DELETE_AT = "2026-11-19T10:00:00Z";

/** Where the dialog sent the coach, and what it left in the router's state. */
function Landed() {
  const location = useLocation();
  return <output aria-label="landed">{JSON.stringify(location.state)}</output>;
}

function renderCard() {
  return render(
    <MemoryRouter initialEntries={["/online/profile"]}>
      <Routes>
        <Route path="/online/profile" element={<DeleteAccountCard />} />
        <Route path="/" element={<Landed />} />
      </Routes>
    </MemoryRouter>,
  );
}

function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: `${KEY}.open` }));
  return screen.getByRole("dialog");
}

function typePassword(value: string) {
  fireEvent.change(screen.getByLabelText(`${KEY}.password`), { target: { value } });
}

function submit(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole("button", { name: `${KEY}.confirm` }));
}

beforeEach(() => {
  resetOnline();
  requestAccountDeletion.mockReset();
});

describe("deleting the account from the profile (M3c1)", () => {
  // Given the coach's profile,
  // when he opens the deletion,
  // then the dialog says what goes (the club to the AI and open to a takeover, no refunds, the
  // career and his name on the honours) and how to change his mind, without promising the club
  // back or a fixed number of days; the red button waits for his password.
  it("says what a deletion takes before asking the password", () => {
    renderCard();
    const dialog = openDialog();

    for (const line of ["lossClub", "lossMoney", "lossCareer", "grace", "forgot"]) {
      expect(within(dialog).getByText(`${KEY}.${line}`)).toBeVisible();
    }
    const confirm = within(dialog).getByRole("button", { name: `${KEY}.confirm` });
    expect(confirm).toBeDisabled();
    typePassword("mot mat khau dai");
    expect(confirm).toBeEnabled();
  });

  // Given the dialog open, when the coach presses Escape, then it closes and nothing is asked.
  it("closes on Escape", () => {
    renderCard();
    openDialog();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(requestAccountDeletion).not.toHaveBeenCalled();
  });

  // Given a phone, where the dialog takes the whole page,
  // when it opens, then a Cancel button sits by the red one and closes it without asking anything.
  it("keeps a Cancel button by the red one on a phone", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === "(max-width: 767.98px)",
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    try {
      renderCard();
      const dialog = openDialog();

      fireEvent.click(within(dialog).getByRole("button", { name: "common.cancel" }));

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(requestAccountDeletion).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // Given the right password,
  // when the coach confirms,
  // then the session gets it with a key; the online state is dropped and he lands on the menu
  // with the day the server gave.
  it("asks the deletion and leaves for the menu with its day", async () => {
    useOnlineStore.getState().setClub(myClub());
    requestAccountDeletion.mockResolvedValue({ deleteAt: DELETE_AT });
    renderCard();
    const dialog = openDialog();

    typePassword("mot mat khau dai");
    submit(dialog);

    expect(await screen.findByLabelText("landed")).toHaveTextContent(
      JSON.stringify({ accountDeletion: DELETE_AT }),
    );
    expect(requestAccountDeletion).toHaveBeenCalledWith(
      "mot mat khau dai",
      expect.stringMatching(/.{16,}/),
    );
    expect(useOnlineStore.getState().club).toBeUndefined();
  });

  // Given a wrong password,
  // when the coach confirms,
  // then the refusal shows at the password, the dialog stays, and he can try again.
  it("shows a wrong password at the field", async () => {
    requestAccountDeletion.mockRejectedValue("be.error.auth.invalidCredentials");
    renderCard();
    const dialog = openDialog();

    typePassword("sai");
    submit(dialog);

    const field = screen.getByLabelText(`${KEY}.password`);
    await waitFor(() => expect(field).toHaveAttribute("aria-invalid", "true"));
    expect(within(dialog).getByText("resolved:be.error.auth.invalidCredentials")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: `${KEY}.confirm` })).toBeEnabled();
  });

  // Given a request that got no answer,
  // when the coach confirms again,
  // then it goes under the same key (the session sends the same token with it); after a refusal
  // with an answer, the next press is a new key.
  it("sends a request with no answer again under the same key", async () => {
    requestAccountDeletion
      .mockRejectedValueOnce("be.error.coach.offline")
      .mockRejectedValueOnce("be.error.auth.invalidCredentials")
      .mockResolvedValueOnce({ deleteAt: DELETE_AT });
    renderCard();
    const dialog = openDialog();
    typePassword("mot mat khau dai");

    submit(dialog);
    expect(await within(dialog).findByText("resolved:be.error.coach.offline")).toBeVisible();
    submit(dialog);
    expect(
      await within(dialog).findByText("resolved:be.error.auth.invalidCredentials"),
    ).toBeVisible();
    submit(dialog);
    await screen.findByLabelText("landed");

    const keys = requestAccountDeletion.mock.calls.map(([, key]) => key);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
  });
});

describe("the profile page's deletion card", () => {
  let server: ReturnType<typeof fakeServer>;
  afterEach(() => server?.restore());

  // Given the coach's profile, when it opens, then its last card is the deletion's.
  it("ends the profile with the deletion", async () => {
    server = fakeServer({
      "GET v1/season": ok(SEASON),
      "GET v1/clubs/mine": ok(myClub()),
      "GET v1/leagues/mine": ok(LEAGUE),
      "GET v1/me": ok({
        id: "a",
        email: "coach@example.test",
        firstName: "Jose",
        lastName: "Mourinho",
        dateOfBirth: "1963-01-26",
        nationality: "PT",
        region: "AsiaSoutheast",
        status: "active",
        capabilities: [],
      }),
      "GET v1/me/career": ok({
        level: 1,
        seasons: 0,
        promotions: 0,
        forcedLevels: 0,
        mastery: [],
      }),
      "GET v1/licences": ok({ tiers: [] }),
    });
    renderOnline("/online/profile");

    const card = await screen.findByRole("region", { name: `${KEY}.title` });
    expect(within(card).getByRole("button", { name: `${KEY}.open` })).toBeVisible();
  });
});
