import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import type { InboxMessageView } from "../api";
import { toMessageData } from "./inbox";

/** `t` that tells the key and the parameters it was given, in the order they were passed. */
const t = ((key: string, options?: Record<string, unknown>) =>
  options ? `${key}|${JSON.stringify(options)}` : key) as unknown as TFunction;

const mail = (kind: string, params: Record<string, string | number>): InboxMessageView => ({
  id: "m",
  kind,
  params,
  createdAt: "2026-10-27T10:00:00Z",
  read: false,
});

describe("an inbox message as the offline inbox reads one", () => {
  // Given a match the coach's club played at home and one away,
  // when they are worded,
  // then the home side is named first in each, with the goals in the same order.
  it("names the home side first", () => {
    const home = toMessageData(
      mail("match.result", { opponent: "B", home: 1, scored: 3, conceded: 1, round: 2 }),
      t,
      "A",
    );
    const away = toMessageData(
      mail("match.result", { opponent: "B", home: 0, scored: 3, conceded: 1, round: 2 }),
      t,
      "A",
    );

    expect(home.subject).toContain('"home":"A","away":"B","homeGoals":3,"awayGoals":1');
    expect(away.subject).toContain('"home":"B","away":"A","homeGoals":1,"awayGoals":3');
    expect(home.category).toBe("MatchResult");
  });

  // Given a won, a drawn and a lost match,
  // when they are worded,
  // then each takes its own sentence.
  it("picks the sentence by the result", () => {
    const body = (scored: number, conceded: number) =>
      toMessageData(
        mail("match.result", { opponent: "B", home: 1, scored, conceded, round: 1 }),
        t,
        "A",
      ).body;

    expect(body(2, 0)).toMatch(/^online\.inbox\.kinds\.match\.result\.won\|/);
    expect(body(1, 1)).toMatch(/^online\.inbox\.kinds\.match\.result\.drawn\|/);
    expect(body(0, 3)).toMatch(/^online\.inbox\.kinds\.match\.result\.lost\|/);
  });

  // Given a season's end with and without a promotion,
  // when it is worded,
  // then the sentence follows the promotion.
  it("says whether the coach was promoted", () => {
    const body = (promoted: number) =>
      toMessageData(mail("season.result", { season: 1, rank: 3, promoted }), t, "A").body;

    expect(body(1)).toMatch(/season\.result\.promoted\|/);
    expect(body(0)).toMatch(/season\.result\.stayed\|/);
  });

  // Given an auction without a player's name, and a kind this build does not know,
  // when they are worded,
  // then the first says "a player" and the second is a plain system notice.
  it("falls back for a missing name and an unknown kind", () => {
    const won = toMessageData(mail("market.won", { auctionId: "a" }), t, "A");
    const odd = toMessageData(mail("something.new", {}), t, "A");

    expect(won.subject).toContain("online.inbox.aPlayer");
    expect(odd.category).toBe("System");
    expect(odd.subject).toMatch(/^online\.inbox\.kinds\.other\.subject/);
  });
});
