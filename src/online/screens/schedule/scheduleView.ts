import type { FixtureView } from "../../api";

/** Which of the club's fixtures the phone schedule shows (design m-lich-thi-dau.html). */
export type Venue = "all" | "home" | "away";

/** The club's fixtures at the venue picked, in their order. */
export function ofVenue(fixtures: FixtureView[], clubId: string, venue: Venue): FixtureView[] {
  if (venue === "all") return fixtures;
  return fixtures.filter((fixture) => (fixture.home.id === clubId) === (venue === "home"));
}

/** How many fixtures each venue filter keeps, for its label. */
export function countByVenue(fixtures: FixtureView[], clubId: string): Record<Venue, number> {
  const home = fixtures.filter((fixture) => fixture.home.id === clubId).length;
  return { all: fixtures.length, home, away: fixtures.length - home };
}

export interface ScheduleDay {
  key: string;
  /** The day's first kick-off, to name the day by. */
  date: Date;
  fixtures: FixtureView[];
}

/** The fixtures by the day of this machine's calendar they kick off on, days in order. */
export function byDay(fixtures: FixtureView[]): ScheduleDay[] {
  const days: ScheduleDay[] = [];
  for (const fixture of fixtures) {
    const date = new Date(fixture.kickoffAt);
    const key = date.toDateString();
    const last = days[days.length - 1];
    if (last && last.key === key) last.fixtures.push(fixture);
    else days.push({ key, date, fixtures: [fixture] });
  }
  return days;
}
