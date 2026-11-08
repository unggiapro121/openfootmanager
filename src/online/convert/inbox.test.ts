import { createInstance, type TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import en from "../../i18n/locales/en.json";
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

  // Given the mails of a title and of a player's award (S-42),
  // when they are worded,
  // then the title names the season, level and league and opens the trophy room; the award names
  // the player, the award in words and its value as the award counts it; an unknown award is
  // worded as a plain award.
  it("words a title and a player's award", () => {
    const title = toMessageData(
      mail("season.champion", { season: 3, level: 2, leagueName: "Level 2 · League 1" }),
      t,
      "A",
    );
    const scorer = toMessageData(
      mail("season.award", { season: 3, award: "topScorer", playerName: "Văn Hùng", value: 21 }),
      t,
      "A",
    );
    const rated = toMessageData(
      mail("season.award", { season: 3, award: "playerOfSeason", playerName: "B", value: 7.456 }),
      t,
      "A",
    );
    const odd = toMessageData(
      mail("season.award", { season: 3, award: "mystery", playerName: "C", value: 1 }),
      t,
      "A",
    );

    expect(title.category).toBe("LeagueInfo");
    expect(title.subject).toContain("online.inbox.kinds.season.champion.subject");
    expect(title.body).toContain('"season":3,"level":2,"league":"Level 2 · League 1"');
    expect(title.actions).toEqual([
      expect.objectContaining({
        label: "online.honours.open",
        action_type: { NavigateTo: { route: "/online/honours" } },
      }),
    ]);
    expect(scorer.category).toBe("LeagueInfo");
    expect(scorer.body).toContain('"player":"Văn Hùng"');
    expect(scorer.body).toContain('"award":"online.honours.awards.topScorer"');
    expect(scorer.body).toContain("online.honours.value.topScorer");
    expect(scorer.body).toContain('\\"value\\":21');
    expect(rated.body).toContain('\\"value\\":\\"7.46\\"');
    expect(odd.body).toContain('"award":"online.honours.awards.other"');
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

  // Given the club's day messages,
  // when they are worded,
  // then each takes its offline category and the parameters its sentence needs.
  it("words the club's day", () => {
    const preview = toMessageData(
      mail("match.preview", {
        fixtureId: "f",
        opponent: "B",
        home: 0,
        round: 4,
        kickoffAt: "2026-10-27T12:00:00Z",
      }),
      t,
      "A",
    );
    expect(preview.category).toBe("MatchPreview");
    expect(preview.body).toMatch(/match\.preview\.away\|/);
    expect(preview.subject).toContain('"home":"B","away":"A"');
    expect(preview.context.fixture_id).toBe("f");

    const injury = toMessageData(
      mail("squad.injury", { playerName: "X", injury: "Hamstring", days: 12 }),
      t,
      "A",
    );
    expect(injury.category).toBe("Injury");
    expect(injury.body).toContain('"days":12');

    const tired = toMessageData(
      mail("squad.exhausted", { count: 3, critical: 1, names: "X, Y, Z" }),
      t,
      "A",
    );
    expect(tired.category).toBe("Training");
    expect(tired.body).toContain('"names":"X, Y, Z"');

    for (const kind of ["squad.unhappy", "squad.bench", "squad.happy"]) {
      expect(toMessageData(mail(kind, { count: 1, names: "X" }), t, "A").category).toBe(
        "PlayerMorale",
      );
    }
    expect(toMessageData(mail("season.promoted", { season: 1, level: 3 }), t, "A").body).toContain(
      '"level":3',
    );
    expect(toMessageData(mail("season.reward", { rank: 2, amount: 5000 }), t, "A").category).toBe(
      "Finance",
    );
    // The season's contracts (S-36, C-14): last season's sponsorship only after a level up.
    const sponsor = toMessageData(
      mail("season.sponsor", { season: 4, level: 7, sponsorSeason: 1560000, tvPerMatch: 40000 }),
      t,
      "A",
    );
    expect(sponsor.category).toBe("Finance");
    expect(sponsor.body).toContain("online.inbox.kinds.season.sponsor.body");
    expect(sponsor.body).not.toContain("previous");
    const promoted = toMessageData(
      mail("season.sponsor", {
        season: 4,
        level: 7,
        sponsorSeason: 1560000,
        tvPerMatch: 40000,
        previousSponsorSeason: 1080000,
      }),
      t,
      "A",
    );
    expect(promoted.body).toContain("online.inbox.kinds.season.sponsor.previous");
  });

  // Given the item audit's two account messages (S-17, C-7b),
  // when they are worded,
  // then each has its own words under the board's category, not the plain notice.
  it("words the lock and the unlock of the coach's items", () => {
    const locked = toMessageData(mail("account.itemsLocked", {}), t, "A");
    const unlocked = toMessageData(mail("account.itemsUnlocked", {}), t, "A");

    expect(locked.category).toBe("BoardDirective");
    expect(locked.subject).toMatch(/^online\.inbox\.kinds\.account\.itemsLocked\.subject/);
    expect(unlocked.subject).toMatch(/^online\.inbox\.kinds\.account\.itemsUnlocked\.subject/);
  });

  // Given a SuperAdmin who gave 3 drinks until a date, took 2 back and refunded a purchase, each
  // with a reason (S-17d, C-7b2),
  // when they are worded,
  // then each says the item and how many, the gift its end date, the refund its coins, each ends
  // with the reason on its own line, and opens the inventory, or the wallet for the refund.
  it("words what a SuperAdmin gave, took back or refunded, with the reason", () => {
    const given = toMessageData(
      mail("account.itemsGranted", {
        itemCode: "energyDrinkSmall",
        quantity: 3,
        expiresAt: "2026-11-05T12:00:00Z",
        reason: "Match server outage",
      }),
      t,
      "A",
    );
    const taken = toMessageData(
      mail("account.itemsRevoked", {
        itemCode: "energyDrinkSmall",
        quantity: 2,
        reason: "Given twice",
      }),
      t,
      "A",
    );
    const refunded = toMessageData(
      mail("account.purchaseRefunded", {
        itemCode: "timeSkip",
        quantity: 1,
        coins: 10,
        reason: "Bought by mistake",
        purchaseTxnId: "x",
      }),
      t,
      "A",
    );

    expect(given.subject).toMatch(/^online\.inbox\.kinds\.account\.itemsGranted\.subject\|/);
    expect(given.subject).toContain('"item":"online.items.energyDrinkSmall.name|');
    expect(given.subject).toContain('"count":3');
    expect(given.body).toContain("online.inbox.kinds.account.itemsGranted.expires");
    expect(given.body.split("\n")).toEqual([
      expect.stringMatching(/^online\.inbox\.kinds\.account\.itemsGranted\.body\|/),
      'online.inbox.reasonLine|{"reason":"Match server outage"}',
    ]);
    expect(given.category).toBe("BoardDirective");
    expect(given.actions[0].action_type).toEqual({ NavigateTo: { route: "/online/inventory" } });

    expect(taken.subject).toContain('"count":2');
    expect(taken.body).not.toContain("expires");
    expect(taken.body).toMatch(/\nonline\.inbox\.reasonLine\|\{"reason":"Given twice"\}$/);
    expect(taken.actions[0].action_type).toEqual({ NavigateTo: { route: "/online/inventory" } });

    expect(refunded.body).toContain('"coins":10');
    expect(refunded.body).toMatch(/reasonLine\|\{"reason":"Bought by mistake"\}$/);
    expect(refunded.category).toBe("Finance");
    expect(refunded.actions[0].action_type).toEqual({ NavigateTo: { route: "/online/coins" } });
  });

  // Given a gift with no end date and no reason (a server that sends none),
  // when it is worded,
  // then it says neither an end date nor a reason line.
  it("leaves out the end date and the reason a mail does not have", () => {
    const given = toMessageData(
      mail("account.itemsGranted", { itemCode: "medkitBandage", quantity: 1, reason: "  " }),
      t,
      "A",
    );

    expect(given.body).not.toContain("expires");
    expect(given.body).not.toContain("reasonLine");
    expect(given.body).not.toContain("\n");
  });

  // Given a reason a SuperAdmin typed with markup, a link, a placeholder and two lines,
  // when the mail is worded in English,
  // then the reason is kept as the very text typed (Qs17d-1): nothing is read as a placeholder,
  // and its own line break stays, for the inbox to show each line as plain text.
  it("keeps the reason as the plain text the SuperAdmin typed", async () => {
    const i18n = createInstance();
    await i18n.init({
      lng: "en",
      resources: { en: { translation: en } },
      interpolation: { escapeValue: false },
    });
    const reason = "<b>Duplicate</b> {{item}} $t(online.shop.full) see https://x.test\nTicket 42";
    const taken = toMessageData(
      mail("account.itemsRevoked", { itemCode: "energyDrinkSmall", quantity: 2, reason }),
      i18n.t,
      "A",
    );

    expect(taken.subject).toBe("Energy drink ×2 taken back");
    expect(taken.body.split("\n")).toEqual([
      "Energy drink ×2 was taken back from your inventory.",
      "Reason: <b>Duplicate</b> {{item}} $t(online.shop.full) see https://x.test",
      "Ticket 42",
    ]);
  });

  // Given the academy's three mails (S-18, C-7c): a report back, a graduation into a squad over
  // its size with the fee waived, and a graduation that waited for its fee,
  // when they are worded,
  // then each is under the scouting category, the graduation adds both sentences, and the
  // waiting one is named from the academy, or as "a youngster" when the academy does not know him.
  it("words the academy's mails", () => {
    const back = toMessageData(mail("academy.scoutDone", { tripId: "t" }), t, "A");
    const graduated = toMessageData(
      mail("academy.graduated", {
        playerId: "p",
        playerName: "Kid",
        overSquadMax: 1,
        feeWaived: 1,
      }),
      t,
      "A",
    );
    const known = toMessageData(
      mail("academy.graduationDeferred", { playerId: "p", fee: 200000 }),
      t,
      "A",
      (id) => (id === "p" ? "Kid" : undefined),
    );
    const unknown = toMessageData(
      mail("academy.graduationDeferred", { playerId: "q", fee: 200000 }),
      t,
      "A",
      (id) => (id === "p" ? "Kid" : undefined),
    );

    expect([back, graduated, known].map((message) => message.category)).toEqual([
      "ScoutReport",
      "ScoutReport",
      "ScoutReport",
    ]);
    expect(back.subject).toMatch(/^online\.inbox\.kinds\.academy\.scoutDone\.subject/);
    expect(graduated.body).toContain('"player":"Kid"');
    expect(graduated.body).toContain("online.inbox.kinds.academy.graduated.overSquadMax");
    expect(graduated.body).toContain("online.inbox.kinds.academy.graduated.feeWaived");
    expect(known.body).toContain('"player":"Kid"');
    expect(unknown.body).toContain('"player":"online.academy.aYoungster"');
  });

  // Given auctions cancelled for the level caps (the club left out, the seller with the player up
  // again in a-9, the seller still waiting), for the player gone, and withdrawn,
  // when they are worded,
  // then each has its own sentence, the relisted one a way to the new auction, the last the
  // plain one.
  it("words an auction cancelled for the level caps", () => {
    const cancelled = (params: Record<string, string | number>) =>
      toMessageData(mail("market.cancelled", { playerName: "Bình", ...params }), t, "A");
    const club = cancelled({ reason: "buyCapExceeded", requiredLevel: 3 });
    const relisted = cancelled({ reason: "buyCapExceeded", relistedAuctionId: "a-9" });
    const waiting = cancelled({ reason: "buyCapExceeded" });
    const gone = cancelled({ reason: "playerGone" });
    const withdrawn = cancelled({ reason: "withdrawn" });

    expect(club.body).toMatch(/^online\.inbox\.kinds\.market\.cancelled\.capClub\|/);
    expect(club.body).toContain('"level":3');
    expect(relisted.body).toMatch(/^online\.inbox\.kinds\.market\.cancelled\.capRelisted\|/);
    expect(relisted.actions).toEqual([
      expect.objectContaining({
        label: "online.inbox.viewNewAuction",
        action_type: { NavigateTo: { route: "/online/auctions/a-9" } },
      }),
    ]);
    expect(waiting.body).toMatch(/^online\.inbox\.kinds\.market\.cancelled\.capSeller\|/);
    expect(waiting.actions).toEqual([]);
    expect(gone.body).toMatch(/^online\.inbox\.kinds\.market\.cancelled\.playerGone\|/);
    expect(withdrawn.body).toMatch(/^online\.inbox\.kinds\.market\.cancelled\.body\|/);
  });

  // Given a coach forced up two levels to level 5 with a full squad, one forced with 16 players
  // and a mail from a server before R16-9 (no `shortSquad`),
  // when they are worded,
  // then each says the levels and the level, only the short squad adds why with its size, and
  // each opens the level caps on the profile.
  it("words a forced promotion, and why for a short squad", () => {
    const full = toMessageData(
      mail("season.forcedPromotion", {
        season: 4,
        levels: 2,
        level: 5,
        shortSquad: 0,
        squadSize: 18,
      }),
      t,
      "A",
    );
    const short = toMessageData(
      mail("season.forcedPromotion", {
        season: 4,
        levels: 1,
        level: 4,
        shortSquad: 1,
        squadSize: 16,
      }),
      t,
      "A",
    );
    const old = toMessageData(
      mail("season.forcedPromotion", { season: 4, levels: 1, level: 4 }),
      t,
      "A",
    );

    expect(full.category).toBe("LeagueInfo");
    expect(full.body).toContain('"season":4,"levels":2,"level":5,"extra":""');
    expect(short.body).toContain("online.inbox.kinds.season.forcedPromotion.shortSquad");
    expect(short.body).toContain('\\"squadSize\\":16');
    expect(old.body).toContain('"extra":""');
    expect(full.actions).toEqual([
      expect.objectContaining({
        label: "online.inbox.viewCaps",
        action_type: { NavigateTo: { route: "/online/profile" } },
      }),
    ]);
  });
});

describe("an event mail", () => {
  // Given the four event mails with the mission named in their parameters,
  // when they are worded,
  // then each is a system mail naming the mission, its event, the reason or the deadline.
  it("names the mission from the mail's parameters", () => {
    const mission = {
      eventId: "e",
      missionCode: "w1",
      theme: "weekly",
      kind: "leagueWinsDirected",
      target: 3,
    };
    const completed = toMessageData(mail("event.completed", mission), t, "A");
    const claimed = toMessageData(mail("event.claimed", mission), t, "A");
    const lapsed = toMessageData(mail("event.lapsed", { ...mission, reason: "stackFull" }), t, "A");
    const reminder = toMessageData(
      mail("event.claimReminder", {
        eventId: "e",
        theme: "weekly",
        claimUntil: "2026-11-12T02:35:00Z",
      }),
      t,
      "A",
    );

    expect([completed, claimed, lapsed, reminder].map((message) => message.category)).toEqual([
      "System",
      "System",
      "System",
      "System",
    ]);
    expect(completed.subject).toMatch(/^online\.inbox\.kinds\.event\.completed\.subject/);
    expect(completed.body).toMatch(/^online\.inbox\.kinds\.event\.completed\.body\|/);
    expect(completed.body).toContain(
      '"mission":"online.events.mission.leagueWinsDirected|{\\"target\\":3}"',
    );
    expect(completed.body).toContain('"theme":"online.events.theme.weekly"');
    expect(claimed.body).toMatch(/^online\.inbox\.kinds\.event\.claimed\.body\|/);
    expect(lapsed.body).toContain('"reason":"online.events.reason.stackFull"');
    expect(reminder.body).toMatch(/^online\.inbox\.kinds\.event\.claimReminder\.body\|/);
    expect(reminder.body).not.toContain('"until":""');
  });

  // Given event mails carrying only their codes, one whose mission the store holds and one it
  // does not, and a lapsed one with a reason this build does not know,
  // when they are worded,
  // then the first is named from the store, the second says "a mission", and the reason reads as
  // the server's "could not give it".
  it("names the mission from the store, or says a mission", () => {
    const fromStore = (eventId: string, code: string) =>
      eventId === "e" && code === "w1"
        ? { kind: "seasonFinishTop", target: 1, theme: "seasonFinale" }
        : undefined;
    const known = toMessageData(
      mail("event.completed", { eventId: "e", missionCode: "w1" }),
      t,
      "A",
      undefined,
      fromStore,
    );
    const unknown = toMessageData(
      mail("event.lapsed", { eventId: "e", missionCode: "w9", reason: "meteor" }),
      t,
      "A",
      undefined,
      fromStore,
    );

    expect(known.body).toContain('"mission":"online.events.mission.seasonChampion"');
    expect(known.body).toContain('"theme":"online.events.theme.seasonFinale"');
    expect(unknown.body).toMatch(/^online\.inbox\.kinds\.event\.lapsed\.bodyUnnamed\|/);
    expect(unknown.body).toContain('"reason":"online.events.reason.unavailable"');
  });
});
