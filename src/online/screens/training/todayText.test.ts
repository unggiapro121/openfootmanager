import { beforeAll, describe, expect, it } from "vitest";
import i18n, { i18nReady } from "../../../i18n";
import { myClub } from "../../../test-utils/onlineTestKit";
import type { TrainingDayView } from "../../api";
import {
  displayDay,
  matchTodayKickoff,
  recentDays,
  refusalText,
  viewRefusalParams,
} from "./todayText";

const t = i18n.t.bind(i18n);
const NOW = Date.parse("2099-01-01T05:00:00Z");

function trainingDay(overrides: Partial<TrainingDayView> = {}): TrainingDayView {
  return {
    day: 3,
    recent: [],
    canTrain: true,
    sessionsLast7: 2,
    sessionsCap: 6,
    nextRecoveryAt: "2099-01-01T08:00:00Z",
    recovery: { perDay: 6, hours: 8 },
    autoOff: false,
    keeperDrill: false,
    ...overrides,
  };
}

beforeAll(async () => {
  await i18nReady;
  await i18n.changeLanguage("vi");
});

describe("the day a player reads", () => {
  // Given the server's days, counted from 0,
  // when they are shown,
  // then the first day of the season is day 1 and the last is day 28.
  it("counts the season's days from one", () => {
    expect(displayDay(0)).toBe(1);
    expect(displayDay(27)).toBe(28);
  });
});

describe("why a session cannot be held", () => {
  // Given the six-in-seven cap, with the next allowed day 6 from the view and from a 409,
  // when the reason is written,
  // then both say day 7, the day the player reads, not the server's 6.
  it("names the next allowed day from one, from the view and from a 409", () => {
    const club = myClub();
    const view = trainingDay({
      canTrain: false,
      refusal: "be.error.training.sessionCap",
      nextAllowedDay: 6,
    });
    const fromView = refusalText(
      t,
      "vi",
      "be.error.training.sessionCap",
      viewRefusalParams(view, club),
      NOW,
    );
    const from409 = refusalText(
      t,
      "vi",
      "be.error.training.sessionCap",
      { nextAllowedDay: 6 },
      NOW,
    );
    expect(fromView).toContain("ngày 7");
    expect(from409).toBe(fromView);
  });

  // Given the lineup lock, from the view (the club's next kick-off) and from a 409 (its own),
  // when the reason is written,
  // then it is the card's own sentence about training, with the kick-off's time.
  it("reads the lineup lock as a lock on training, with its kick-off", () => {
    const club = myClub({
      nextFixture: { ...myClub().nextFixture!, kickoffAt: "2099-01-01T05:30:00Z" },
    });
    const expected = t("online.training.today.lineupLocked", {
      time: new Intl.DateTimeFormat("vi", { hour: "2-digit", minute: "2-digit" }).format(
        new Date("2099-01-01T05:30:00Z"),
      ),
    });
    const fromView = refusalText(
      t,
      "vi",
      "be.error.club.lineupLocked",
      viewRefusalParams(trainingDay(), club),
      NOW,
    );
    const from409 = refusalText(
      t,
      "vi",
      "be.error.club.lineupLocked",
      { kickoffAt: "2099-01-01T05:30:00Z" },
      NOW,
    );
    expect(fromView).toBe(expected);
    expect(from409).toBe(expected);
    expect(fromView).not.toBe(t("be.error.club.lineupLocked", { kickoffAt: "x" }));
  });

  // Given each training code without parameters,
  // when the reason is written,
  // then it is the code's own sentence.
  it.each([
    "be.error.training.manualOff",
    "be.error.training.noDay",
    "be.error.training.dayPending",
    "be.error.training.sessionToday",
    "be.error.training.sessionCapSeason",
  ])("writes %s as its own sentence", (code) => {
    const text = refusalText(t, "vi", code, {}, NOW);
    expect(text).toBe(t(code));
    expect(text).not.toBe(code);
  });

  // Given a code this build does not know (a newer server),
  // when the reason is written,
  // then it is the plain "not now" sentence, not the code.
  it("writes an unknown code as the plain sentence", () => {
    expect(refusalText(t, "vi", "be.error.training.somethingNew", {}, NOW)).toBe(
      t("online.training.today.unknownRefusal"),
    );
  });
});

describe("the card's moments", () => {
  const club = (kickoffAt: string) =>
    myClub({ nextFixture: { ...myClub().nextFixture!, kickoffAt } });

  // Given a match tonight at 20:00 and the day turning tomorrow morning,
  // when the card asks whether there is a match today,
  // then there is until kick-off, and not for a match tomorrow or one under way.
  it("finds a match today that has not kicked off", () => {
    const nextDayAt = "2099-01-02T00:00:00Z";
    expect(matchTodayKickoff(club("2099-01-01T13:00:00Z"), nextDayAt, NOW)).toBe(
      "2099-01-01T13:00:00Z",
    );
    expect(matchTodayKickoff(club("2099-01-02T13:00:00Z"), nextDayAt, NOW)).toBeNull();
    expect(matchTodayKickoff(club("2099-01-01T04:00:00Z"), nextDayAt, NOW)).toBeNull();
    expect(matchTodayKickoff(club("2099-01-01T13:00:00Z"), undefined, NOW)).toBeNull();
  });
});

describe("the seven days before today", () => {
  // Given day 3 with rows for days 0 (bot) and 2 (manual),
  // when the strip is drawn,
  // then it holds days 0 to 2, with day 1 empty rather than a rest.
  it("leaves a day with no row empty", () => {
    const view = trainingDay({
      day: 3,
      recent: [
        { day: 0, kind: "bot" },
        { day: 2, kind: "manual" },
      ],
    });
    expect(recentDays(view)).toEqual([
      { day: 0, kind: "bot" },
      { day: 1, kind: null },
      { day: 2, kind: "manual" },
    ]);
  });

  // Given day 10 and no day of the season,
  // when the strip is drawn,
  // then the first holds seven days (3 to 9) and the second none.
  it("holds seven days, or none without a day", () => {
    expect(recentDays(trainingDay({ day: 10 })).map((cell) => cell.day)).toEqual([
      3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(recentDays(trainingDay({ day: undefined }))).toEqual([]);
  });
});
