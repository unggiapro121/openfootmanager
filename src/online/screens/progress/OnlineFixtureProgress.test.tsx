import { act, fireEvent, screen, within } from "@testing-library/react";
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
afterEach(() => {
  server?.restore();
  vi.useRealTimers();
});

type Answer = ReturnType<typeof ok> | ReturnType<typeof fail>;

function open(progress: Answer | (() => Answer)) {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub()),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/fixtures/fixture-1/progress": progress,
  });
  renderOnline(PAGE);
}

/** A settled match: a riser with the bar's point, a trainer, a full bar, and two on the bench. */
/** Matches the innermost element whose whole text is `text`, across nested spans. */
function textOf(text: string) {
  return (_: string, element: Element | null) =>
    element?.textContent === text &&
    Array.from(element.children).every((child) => child.textContent !== text);
}

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
    // The bar filled and gave its point: it reads as filled, then what is left, not as a fall.
    expect(
      await within(riser).findByText(textOf("90 → 100 · 20"), undefined, { timeout: 2000 }),
    ).toBeVisible();
    expect(within(riser).getByRole("meter", { name: "online.squad.experience" })).toHaveAttribute(
      "aria-valuenow",
      "20",
    );

    const trainer = screen.getByText("Bình").closest("li") as HTMLElement;
    expect(within(trainer).getByText(`${KEY}.trained:2|common.attributes.passing`)).toBeVisible();
    expect(within(trainer).getByText("6.1 → 6.4")).toBeVisible();
    // OVR unchanged by the match: one figure, not "60 → 60".
    expect(within(trainer).getByText(`${KEY}.ovrSame:60`)).toBeVisible();
    expect(within(trainer).queryByText(new RegExp(`${KEY}.ovr:`))).toBeNull();
    expect(await within(trainer).findByText(textOf("30 → 55"))).toBeVisible();
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
    // Not marked seen: the bars still run when the coach comes back once it is settled.
    expect(window.sessionStorage.getItem("progress-seen:fixture-1")).toBeNull();
  });

  /** The progress reads the page has sent so far. */
  const reads = () =>
    server.requests.filter(
      (request) => request.segments.join("/") === "v1/fixtures/fixture-1/progress",
    ).length;
  const wait = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  // Given a coach who taps "Progress" at full time, before the server has settled the match,
  // when the server settles it two reads later,
  // then the page asks again every 5 s on its own and shows the squad's progress (P6, K1).
  it("reads an unsettled match again until it is settled", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let answers = 0;
    open(() => {
      answers += 1;
      return ok(answers < 3 ? progressView([], false) : aMatch());
    });
    expect(await screen.findByText(`${KEY}.pending`)).toBeVisible();
    await wait(5000);
    expect(reads()).toBe(2);
    expect(screen.getByText(`${KEY}.pending`)).toBeVisible();
    await wait(5000);
    expect(await screen.findByText(`${KEY}.summary:3|4|1`)).toBeVisible();
    expect(reads()).toBe(3);
    expect(window.sessionStorage.getItem("progress-seen:fixture-1")).toBe("1");
    await wait(15000);
    expect(reads()).toBe(3);
  });

  // Given a match the server still has not settled after six more reads,
  // when the last read comes back,
  // then the page stops asking and offers a reload, which asks once more.
  it("stops after six tries and offers a reload", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    open(ok(progressView([], false)));
    expect(await screen.findByText(`${KEY}.pending`)).toBeVisible();
    expect(screen.queryByRole("button", { name: `${KEY}.reload` })).toBeNull();
    for (let tick = 0; tick < 6; tick += 1) await wait(5000);
    expect(reads()).toBe(7);
    const again = await screen.findByRole("button", { name: `${KEY}.reload` });
    await wait(20000);
    expect(reads()).toBe(7);
    fireEvent.click(again);
    await wait(0);
    expect(reads()).toBe(8);
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

describe("the OVR line since the line before (C-22c)", () => {
  // Given a riser who trained 66 → 67 during the week and stayed 67 through the match,
  // a player whose OVR fell 68 → 66 since his line before (age at the season's turn),
  // one who stayed 70, and one without a line before,
  // when the page is read,
  // then each OVR line runs from the line before, the fall reads neutrally with a down arrow,
  // the summary counts only the riser, and the one without a line before keeps the match's own.
  it("shows the OVR since the line before", async () => {
    open(
      ok(
        progressView([
          progressLine("week", "An", { ovrSince: 66, ovrBefore: 67, ovrAfter: 67 }),
          progressLine("fall", "Bình", { ovrSince: 68, ovrBefore: 66, ovrAfter: 66 }),
          progressLine("same", "Cường", { ovrSince: 70, ovrBefore: 70, ovrAfter: 70 }),
          progressLine("first", "Dũng", { ovrBefore: 61, ovrAfter: 62 }),
        ]),
      ),
    );

    expect(await screen.findByText(`${KEY}.summary:0|0|2`)).toBeVisible();

    const week = screen.getByText("An").closest("li") as HTMLElement;
    expect(within(week).getByText(`${KEY}.ovr:66|67`)).toBeVisible();
    const weekOvr = within(week).getByText(`${KEY}.ovr:66|67`).closest("p") as HTMLElement;
    expect(weekOvr.querySelector("svg")).toBeNull();

    const fall = screen.getByText("Bình").closest("li") as HTMLElement;
    const fallOvr = within(fall).getByText(`${KEY}.ovr:68|66`).closest("p") as HTMLElement;
    expect(fallOvr).toBeVisible();
    const arrow = fallOvr.querySelector("svg.lucide-arrow-down") as SVGElement;
    expect(arrow).toHaveAttribute("aria-hidden", "true");
    expect(arrow.getAttribute("class")).not.toMatch(/red|danger|warning/);

    const same = screen.getByText("Cường").closest("li") as HTMLElement;
    expect(within(same).getByText(`${KEY}.ovrSame:70`)).toBeVisible();

    const first = screen.getByText("Dũng").closest("li") as HTMLElement;
    expect(within(first).getByText(`${KEY}.ovr:61|62`)).toBeVisible();
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
