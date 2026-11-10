import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../i18n/locales/en.json";
import vi_ from "../../../i18n/locales/vi.json";
import {
  fail,
  fakeServer,
  LEAGUE,
  myClub,
  ok,
  renderOnline,
  resetOnline,
  SEASON,
} from "../../../test-utils/onlineTestKit";
import type { FixtureProgressView } from "../../api";
import { progressLine, progressView } from "./progressTestData";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      options && typeof options === "object"
        ? `${key}:${Object.values(options as Record<string, unknown>).join("|")}`
        : key,
    i18n: { language: "en" },
  }),
}));

const KEY = "online.progress";
const PAGE = "/online/fixtures/fixture-1/progress";

let server: ReturnType<typeof fakeServer>;
beforeEach(() => {
  resetOnline();
  window.sessionStorage.clear();
});
afterEach(() => server?.restore());

function open(progress: ReturnType<typeof ok> | ReturnType<typeof fail>) {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub()),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/fixtures/fixture-1/progress": progress,
  });
  renderOnline(PAGE);
}

/** A settled match: a riser with the bar's point, a trainer, a full bar, and two on the bench. */
function aMatch(): FixtureProgressView {
  return progressView([
    progressLine("trainer", "Bình", {
      rating: 7.1,
      trainedSince: [{ attribute: "passing", points: 2 }],
      xp: { before: 30, gained: 25, after: 55, ready: false },
      formBefore: 61,
      formAfter: 64,
      moraleBefore: 70,
      moraleAfter: 66,
    }),
    progressLine("riser", "An", {
      rating: 6.2,
      ovrBefore: 64,
      ovrAfter: 65,
      xp: { before: 90, gained: 30, after: 20, attributeUp: "pace", ready: false },
    }),
    progressLine("full", "Cường", {
      rating: 6.0,
      xp: { before: 100, gained: 0, after: 100, ready: true },
    }),
    progressLine("bench-a", "Dũng", {
      minutes: 0,
      rating: 0,
      trainedSince: [{ attribute: "tackling", points: 1 }],
      xp: { before: 10, gained: 0, after: 10, ready: false },
    }),
    progressLine("bench-b", "Em", { minutes: 0, rating: 0 }),
  ]);
}

describe("the progress page of a league match (C-22b)", () => {
  // Given a settled league match of the coach's club with match growth on,
  // when he opens its progress page,
  // then the first card sums the squad up and explains the bar; the players who played follow,
  // the OVR riser first, each with his points, bar, form and morale; the bench is folded.
  it("shows the squad's progress through the match", async () => {
    open(ok(aMatch()));

    expect(await screen.findByText(`${KEY}.summary:3|4|1`)).toBeVisible();
    expect(screen.getByText(`${KEY}.explain`)).toBeVisible();

    const played = screen
      .getAllByRole("link")
      .map((link) => link.textContent)
      .filter((name) => ["An", "Bình", "Cường"].includes(name ?? ""));
    expect(played).toEqual(["An", "Bình", "Cường"]);

    const riser = screen.getByText("An").closest("li") as HTMLElement;
    expect(within(riser).getByText(`${KEY}.ovr:64|65`)).toBeVisible();
    expect(within(riser).getByText(`${KEY}.up:common.attributes.pace`)).toBeVisible();
    expect(within(riser).getByText(`${KEY}.xpGained:30`)).toBeVisible();
    expect(within(riser).getByRole("meter", { name: "online.squad.experience" })).toHaveAttribute(
      "aria-valuenow",
      "20",
    );

    const trainer = screen.getByText("Bình").closest("li") as HTMLElement;
    expect(within(trainer).getByText(`${KEY}.trained:2|common.attributes.passing`)).toBeVisible();
    expect(within(trainer).getByText("6.1 → 6.4")).toBeVisible();
    expect(within(trainer).getByText("70 → 66")).toBeVisible();

    const full = screen.getByText("Cường").closest("li") as HTMLElement;
    expect(within(full).getByText(`${KEY}.ready`)).toBeVisible();
    expect(within(full).queryByText(new RegExp(`${KEY}.xpGained`))).toBeNull();

    const bench = screen.getByText(`${KEY}.notPlayed:2`).closest("details") as HTMLElement;
    expect(bench).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText(`${KEY}.notPlayed:2`));
    expect(within(bench).getByText(`${KEY}.trained:1|common.attributes.tackling`)).toBeVisible();
    expect(within(bench).queryByRole("meter")).toBeNull();
  });

  // Given a season without match growth (no bar on any line),
  // when the page opens,
  // then no Experience bar and no explanation of it show.
  it("leaves the bar out in a season without match growth", async () => {
    open(
      ok(
        progressView([
          progressLine("p1", "An", { trainedSince: [{ attribute: "pace", points: 1 }] }),
        ]),
      ),
    );
    expect(await screen.findByText(`${KEY}.summary:1|1|0`)).toBeVisible();
    expect(screen.queryByText(`${KEY}.explain`)).toBeNull();
    expect(screen.queryByRole("meter")).toBeNull();
  });

  // Given a match the server has not settled yet,
  // when the page opens,
  // then it says the numbers come once the match is settled, not that there are none (P6).
  it("says a match not yet settled has its numbers to come", async () => {
    open(ok(progressView([], false)));
    expect(await screen.findByText(`${KEY}.pending`)).toBeVisible();
    expect(screen.queryByText(`${KEY}.empty`)).toBeNull();
  });

  // Given a settled match with no line (the club was a bot's when it was settled, Qs45-1),
  // when the page opens,
  // then it says the match has no progress figures.
  it("says a settled match without lines has no figures", async () => {
    open(ok(progressView([])));
    expect(await screen.findByText(`${KEY}.empty`)).toBeVisible();
    expect(screen.queryByText(`${KEY}.pending`)).toBeNull();
  });

  // Given a fixture of two other clubs,
  // when the coach opens its progress page,
  // then the server's refusal is shown with no retry, since retrying cannot change it.
  it("refuses a match of other clubs without a retry", async () => {
    open(fail(403, "be.error.fixture.notYourClub"));
    const refusal = await screen.findByText(/fixture\.notYourClub|your club/);
    expect(refusal).toHaveAttribute("role", "status");
    expect(screen.queryByRole("button", { name: "online.retry" })).toBeNull();
  });

  // Given the page opened once in this tab,
  // when it is read,
  // then the fixture is marked seen, so the bars run only the first time.
  it("marks the fixture seen on the first open", async () => {
    open(ok(aMatch()));
    await screen.findByText(`${KEY}.summary:3|4|1`);
    expect(window.sessionStorage.getItem("progress-seen:fixture-1")).toBe("1");
  });
});

describe("the progress page's words", () => {
  // Given the page's text in English and Vietnamese,
  // when it is read,
  // then it never says "XP": the bar is "Experience" / "Kinh nghiệm" (PO P5).
  it("never calls the bar XP", () => {
    for (const locale of [en, vi_]) {
      const words = [...Object.values(locale.online.progress), locale.online.squad.experience].join(
        " ",
      );
      expect(words).not.toMatch(/\bXP\b/);
    }
  });
});
