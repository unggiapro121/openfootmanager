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
