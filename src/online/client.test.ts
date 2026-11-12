import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import i18n, { i18nReady } from "../i18n";
import {
  type OnlineRequest,
  type OnlineResponse,
  setOnlineTransport,
} from "../services/onlineTransport";
import { resolveBackendError } from "../utils/backendI18n";
import { CONTRACT_REVISION } from "./api/contract";
import type { ClubSetup } from "./api/rules";
import { online, reopenOnlineGate } from "./client";
import { OnlineApiError } from "./errors";

/** A fake transport: records each request, answers with the next queued outcome. */
function fakeServer() {
  const sent: OnlineRequest[] = [];
  const outcomes: Array<() => Promise<OnlineResponse<unknown>>> = [];
  const restore = setOnlineTransport({
    request: <T>(request: OnlineRequest) => {
      sent.push(request);
      const next = outcomes.shift() ?? (() => Promise.resolve(answer({})));
      return next() as Promise<OnlineResponse<T>>;
    },
  });
  return {
    sent,
    restore,
    answers: (...queued: Array<() => Promise<OnlineResponse<unknown>>>) => outcomes.push(...queued),
  };
}

function answer(body: unknown, contractRevision = CONTRACT_REVISION): OnlineResponse<unknown> {
  return { status: 200, body, contractRevision };
}

const ok = (body: unknown, revision?: number) => () => Promise.resolve(answer(body, revision));
const fails = (failure: unknown) => () => Promise.reject(failure);

const LEAGUE = "0192f0c4-0000-7000-8000-0000000000cc";

let server: ReturnType<typeof fakeServer>;

beforeAll(async () => {
  await i18nReady;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  reopenOnlineGate();
  server = fakeServer();
});

afterEach(() => {
  server.restore();
});

describe("online client", () => {
  // Given the online client,
  // when each read is called,
  // then it sends GET with the route's segments (and the round as a query), and returns the body.
  it("reads each route with its segments", async () => {
    server.answers(ok({ number: 1 }));
    await expect(online.season.now()).resolves.toEqual({ number: 1 });
    await online.clubs.mine();
    await online.leagues.round(LEAGUE, 3);
    await online.fixtures.byId(LEAGUE);
    expect(server.sent).toEqual([
      { method: "GET", segments: ["v1", "season"] },
      { method: "GET", segments: ["v1", "clubs", "mine"] },
      { method: "GET", segments: ["v1", "leagues", LEAGUE, "fixtures"], query: [["round", "3"]] },
      { method: "GET", segments: ["v1", "fixtures", LEAGUE] },
    ]);
  });

  // Given a live match (S-8e),
  // when it is read, then read at kick-off for a replay (C-2e), the coach's own side, its frames
  // after step 30 (and by fifty), and an order is sent,
  // then each goes out on the match's route, the step and the frames with their query, the
  // order with a key.
  it("reads a live match and sends an order on its routes", async () => {
    const formation = { ChangeFormation: { side: "Home", formation: "4-3-3" } } as const;
    await online.matches.byId(LEAGUE);
    await online.matches.byId(LEAGUE, 0);
    await online.matches.mine(LEAGUE);
    await online.matches.frames(LEAGUE, 30);
    await online.matches.frames(LEAGUE, 30, 50);
    await online.matches.command(LEAGUE, formation, "order-1");
    expect(server.sent).toEqual([
      { method: "GET", segments: ["v1", "matches", LEAGUE] },
      { method: "GET", segments: ["v1", "matches", LEAGUE], query: [["atSeq", "0"]] },
      { method: "GET", segments: ["v1", "matches", LEAGUE, "mine"] },
      {
        method: "GET",
        segments: ["v1", "matches", LEAGUE, "frames"],
        query: [["afterSeq", "30"]],
      },
      {
        method: "GET",
        segments: ["v1", "matches", LEAGUE, "frames"],
        query: [
          ["afterSeq", "30"],
          ["limit", "50"],
        ],
      },
      {
        method: "POST",
        segments: ["v1", "matches", LEAGUE, "commands"],
        idempotencyKey: "order-1",
        body: { command: formation },
      },
    ]);
  });

  // Given a coach with a licence (S-9),
  // when they read their career, the licence table, and dismiss the notice of what the server
  // fitted,
  // then the career and the table are GETs of their routes and the dismissal a DELETE with a key.
  it("reads the licences and dismisses the licence notice", async () => {
    await online.me.career();
    await online.licences.table();
    await online.clubs.dismissLicenceNotice("seen-1");
    expect(server.sent).toEqual([
      { method: "GET", segments: ["v1", "me", "career"] },
      { method: "GET", segments: ["v1", "licences"] },
      {
        method: "DELETE",
        segments: ["v1", "clubs", "mine", "licence-notice"],
        idempotencyKey: "seen-1",
      },
    ]);
  });

  // Given push on the phone (M3b1, m3-tech-spec.md §4.2),
  // when the app registers its installation, reads and sets the five switches,
  // notes a push opened and reports the permission answer,
  // then each goes to its route with its body and none carries an idempotency key.
  it("sends the five push calls without an idempotency key", async () => {
    const installation = "01a16f79-3126-72e0-b2d1-325f38ddce77";
    const outbox = "01a16f79-3126-72e0-b2d1-325f38ddce88";
    const device = {
      platform: "android",
      token: "token-1",
      locale: "vi",
      utcOffsetMinutes: 420,
    } as const;
    const kinds = {
      matchSoon: true,
      outbid: false,
      auctionEnding: true,
      auctionResult: true,
      dailyGift: true,
    };
    await online.push.registerDevice(installation, device);
    await online.push.settings();
    await online.push.setSettings({ kinds });
    await online.push.opened(outbox);
    await online.push.reportPermission(true);
    expect(server.sent).toEqual([
      {
        method: "PUT",
        segments: ["v1", "me", "push-devices", installation],
        body: device,
      },
      { method: "GET", segments: ["v1", "me", "push-settings"] },
      { method: "PUT", segments: ["v1", "me", "push-settings"], body: { kinds } },
      { method: "POST", segments: ["v1", "me", "push-opened", outbox] },
      { method: "POST", segments: ["v1", "me", "push-permission"], body: { granted: true } },
    ]);
  });

  // Given the trophy room (S-42),
  // when a coach reads a club's honours, a player's, their own and a league's champions,
  // then each is a GET of its route.
  it("reads the trophy room's four routes", async () => {
    await online.clubs.honours("club-1");
    await online.players.honours("player-1");
    await online.me.honours();
    await online.leagues.champions(LEAGUE);
    expect(server.sent).toEqual([
      { method: "GET", segments: ["v1", "clubs", "club-1", "honours"] },
      { method: "GET", segments: ["v1", "players", "player-1", "honours"] },
      { method: "GET", segments: ["v1", "me", "honours"] },
      { method: "GET", segments: ["v1", "leagues", LEAGUE, "champions"] },
    ]);
  });

  // Given the opponent profile (S-46a, C-23a),
  // when a coach reads another club's season, its profile from a fixture and without one, and a
  // player's public page,
  // then each is a GET of its route, the fixture going as the profile's one query key.
  it("reads the opponent profile's three routes", async () => {
    await online.clubs.fixtures("club-1");
    await online.clubs.opponent("club-1", "fixture-1");
    await online.clubs.opponent("club-1");
    await online.players.byId("player-1");
    expect(server.sent).toEqual([
      { method: "GET", segments: ["v1", "clubs", "club-1", "fixtures"] },
      {
        method: "GET",
        segments: ["v1", "clubs", "club-1", "opponent"],
        query: [["fixture", "fixture-1"]],
      },
      { method: "GET", segments: ["v1", "clubs", "club-1", "opponent"] },
      { method: "GET", segments: ["v1", "players", "player-1"] },
    ]);
  });

  // Given the scouting report on the next league opponent (S-47a, C-24a),
  // when a coach reads its price, buys one for a fixture, and lists the club's reports of a
  // fixture, of a season and of the season under way,
  // then the reads are GETs, the purchase a POST naming the fixture with its key.
  it("reads and buys scouting reports", async () => {
    await online.opponentReports.quote();
    await online.opponentReports.buy("fixture-9", "buy-1");
    await online.opponentReports.list({ fixtureId: "fixture-9" });
    await online.opponentReports.list({ seasonId: "season-3" });
    await online.opponentReports.list();
    const reports = ["v1", "clubs", "mine", "opponent-reports"];
    expect(server.sent).toEqual([
      { method: "GET", segments: [...reports, "quote"] },
      {
        method: "POST",
        segments: reports,
        idempotencyKey: "buy-1",
        body: { fixtureId: "fixture-9" },
      },
      { method: "GET", segments: reports, query: [["fixtureId", "fixture-9"]] },
      { method: "GET", segments: reports, query: [["seasonId", "season-3"]] },
      { method: "GET", segments: reports },
    ]);
  });

  // Given a coach's friendly (S-12),
  // when they read it, make a room, join one, get ready, leave, ask for a rematch, queue and leave
  // the queue,
  // then each goes to its own route, every write but leaving the queue with a key, the code and the
  // ready flag in the body, and leaving the queue as a DELETE.
  it("reads and changes a friendly on its routes", async () => {
    await online.friendlies.mine();
    await online.friendlies.createRoom("make-1");
    await online.friendlies.join("K7Q-2MX", "join-1");
    await online.friendlies.ready(true, "ready-1");
    await online.friendlies.leave("leave-1");
    await online.friendlies.rematch("rematch-1");
    await online.friendlies.queue("queue-1");
    await online.friendlies.leaveQueue();
    expect(server.sent).toEqual([
      { method: "GET", segments: ["v1", "friendlies", "mine"] },
      { method: "POST", segments: ["v1", "friendlies", "rooms"], idempotencyKey: "make-1" },
      {
        method: "POST",
        segments: ["v1", "friendlies", "rooms", "join"],
        idempotencyKey: "join-1",
        body: { code: "K7Q-2MX" },
      },
      {
        method: "POST",
        segments: ["v1", "friendlies", "rooms", "mine", "ready"],
        idempotencyKey: "ready-1",
        body: { ready: true },
      },
      {
        method: "POST",
        segments: ["v1", "friendlies", "rooms", "mine", "leave"],
        idempotencyKey: "leave-1",
      },
      {
        method: "POST",
        segments: ["v1", "friendlies", "rooms", "mine", "rematch"],
        idempotencyKey: "rematch-1",
      },
      { method: "POST", segments: ["v1", "friendlies", "queue"], idempotencyKey: "queue-1" },
      { method: "DELETE", segments: ["v1", "friendlies", "queue"] },
    ]);
  });

  // Given a coach who renames one of his players (S-14),
  // when the request goes out,
  // then it is a PATCH of the player's name with both names and a key.
  it("renames a player with both his names", async () => {
    await online.players.rename("p-1", "Lionel Messi", "Messi", "key-1");
    expect(server.sent[0]).toEqual({
      method: "PATCH",
      segments: ["v1", "players", "p-1", "name"],
      idempotencyKey: "key-1",
      body: { fullName: "Lionel Messi", matchName: "Messi" },
    });
  });

  // Given a coach who presses three extra Low sessions for two players (S-28 S28-2),
  // when the request goes out,
  // then it is a POST of the club's extra training with the whole request and a key.
  it("presses extra sessions with the players, intensity and count", async () => {
    const request = { intensity: "Low", players: ["p1", "p2"], sessions: 3, keepAbove: 75 };
    await online.clubs.extraSessions(request, "extra-1");
    expect(server.sent[0]).toEqual({
      method: "POST",
      segments: ["v1", "clubs", "mine", "training", "extra"],
      idempotencyKey: "extra-1",
      body: request,
    });
  });

  // Given a season that builds facilities over time (S-49b, C-27c),
  // when the coach builds the stands, takes the shop down, speeds the build up by two and
  // cancels it,
  // then each is a POST with its own key, and the speed-up carries its count.
  it("sends the four facility works with their keys", async () => {
    const mine = ["v1", "clubs", "mine", "facilities"];
    await online.finance.buildFacility("stands", "build-1");
    await online.finance.downgradeFacility("shop", "down-1");
    await online.finance.speedUpBuild(2, "skip-1");
    await online.finance.cancelBuild("cancel-1");
    expect(server.sent).toEqual([
      { method: "POST", segments: [...mine, "stands", "build"], idempotencyKey: "build-1" },
      { method: "POST", segments: [...mine, "shop", "downgrade"], idempotencyKey: "down-1" },
      {
        method: "POST",
        segments: [...mine, "build", "speed-up"],
        idempotencyKey: "skip-1",
        body: { count: 2 },
      },
      { method: "POST", segments: [...mine, "build", "cancel"], idempotencyKey: "cancel-1" },
    ]);
  });

  // Given a coach who sets his eleven, then sends the same action again with its key,
  // when the requests go out,
  // then the setup carries If-Match and a key, and the retry carries the same key; a new action
  // gets a new key.
  it("sends a write with If-Match and one key per action", async () => {
    const setup = { formation: "4-4-2" } as ClubSetup;
    await online.clubs.setSetup(setup, 7, "action-1");
    await online.clubs.setSetup(setup, 7, "action-1");
    await online.clubs.rename("Saigon Rivers");
    const [first, retry, rename] = server.sent;
    expect(first).toEqual({
      method: "PUT",
      segments: ["v1", "clubs", "mine", "setup"],
      idempotencyKey: "action-1",
      body: setup,
      ifMatch: "7",
    });
    expect(retry?.idempotencyKey).toBe("action-1");
    expect(rename?.body).toEqual({ name: "Saigon Rivers" });
    expect(rename?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(rename?.idempotencyKey).not.toBe("action-1");
  });

  // Given the server refuses a takeover with matchUnderway, its kick-off and a Retry-After,
  // when the client rejects,
  // then the error carries the code and parameters, and the existing translator shows the
  // English sentence with the kick-off filled in.
  it("rejects with an error the backend translator reads, parameters included", async () => {
    server.answers(
      fails({
        status: 409,
        code: "be.error.club.matchUnderway",
        details: { params: { kickoffAt: "18:00" } },
        retryAfterSeconds: 600,
        contractRevision: CONTRACT_REVISION,
      }),
    );
    const error = await online.clubs.takeover().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OnlineApiError);
    const online409 = error as OnlineApiError;
    expect(online409.code).toBe("be.error.club.matchUnderway");
    expect(online409.params).toEqual({ kickoffAt: "18:00", retryAfterSeconds: 600 });
    expect(resolveBackendError(online409)).toBe(
      "That club has a match under way (kick-off 18:00). Try again once it is over.",
    );
  });

  // Given a server on a newer contract revision,
  // when a read answers,
  // then it rejects with clientOutdated, and every later call, read or write, is refused without
  // being sent.
  it("closes the online mode for a server on a newer contract", async () => {
    server.answers(ok({}, CONTRACT_REVISION + 1));
    await expect(online.season.now()).rejects.toMatchObject({
      code: "be.error.online.clientOutdated",
    });
    await expect(online.clubs.mine()).rejects.toMatchObject({
      code: "be.error.online.clientOutdated",
    });
    await expect(online.clubs.rename("Hanoi")).rejects.toMatchObject({
      code: "be.error.online.clientOutdated",
    });
    expect(server.sent).toHaveLength(1);
  });

  // Given a server on an older revision (or one sending none, from before the header),
  // when an error answers,
  // then the online mode closes with serverOutdated.
  it("closes the online mode for a server on an older contract", async () => {
    server.answers(fails({ status: 404, code: "be.error.notFound" }));
    await expect(online.leagues.mine()).rejects.toMatchObject({
      code: "be.error.online.serverOutdated",
    });
    await expect(online.season.now()).rejects.toMatchObject({
      code: "be.error.online.serverOutdated",
    });
  });

  // Given the proxy itself refuses (unreachable: nothing answered),
  // when the client rejects,
  // then the online mode stays open: no answer says nothing about the server's revision.
  it("keeps the online mode open when nothing answered", async () => {
    server.answers(fails({ status: 0, code: "be.error.online.unreachable" }), ok({ number: 2 }));
    await expect(online.season.now()).rejects.toMatchObject({
      code: "be.error.online.unreachable",
    });
    await expect(online.season.now()).resolves.toEqual({ number: 2 });
  });

  // Given a server that answers a read with a field this client does not know,
  // when the client returns it,
  // then the known fields are there and nothing fails (E6-15).
  it("accepts answers with fields it does not know", async () => {
    server.answers(ok({ number: 3, status: "running", addedLater: { x: 1 } }));
    const season = await online.season.now();
    expect(season.number).toBe(3);
  });

  // Given a rejection that is not the proxy's,
  // when the client rejects,
  // then it is the server misbehaving, as the player reads it.
  it("reads a malformed rejection as the server misbehaving", async () => {
    server.answers(fails("boom"));
    await expect(online.season.now()).rejects.toMatchObject({
      code: "be.error.online.serverUnexpected",
    });
  });
});
