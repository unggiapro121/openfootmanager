import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type OnlineRequest,
  type OnlineResponse,
  setOnlineTransport,
} from "../../services/onlineTransport";
import { CONTRACT_REVISION } from "../api/contract";
import { reopenOnlineGate } from "../client";
import { OnlineApiError } from "../errors";
import { refreshClub, refreshLeague, refreshSeason, tracked, useOnlineStore } from "./onlineStore";

type Answer = { body: unknown } | { failure: Record<string, unknown> };

/** A transport that answers each route (`GET v1/clubs/mine`) as staged. */
function stage(answers: Record<string, Answer>): () => void {
  return setOnlineTransport({
    request: <T>(request: OnlineRequest): Promise<OnlineResponse<T>> => {
      const answer = answers[`${request.method} ${request.segments.join("/")}`];
      if (!answer) return Promise.reject({ status: 0, code: "be.error.online.routeNotAllowed" });
      // A server's refusal carries its revision; the proxy's own (status 0) carries none.
      if ("failure" in answer) {
        const served = answer.failure.status === 0 ? {} : { contractRevision: CONTRACT_REVISION };
        return Promise.reject({ ...answer.failure, ...served });
      }
      return Promise.resolve({
        status: 200,
        body: answer.body as T,
        contractRevision: CONTRACT_REVISION,
      });
    },
  });
}

let restore: () => void = () => {};

beforeEach(() => {
  reopenOnlineGate();
  useOnlineStore.getState().reset();
});

afterEach(() => restore());

describe("noteFailure", () => {
  // Given a request the server never answered,
  // when it fails,
  // then the online mode is offline, and the next answer brings it back.
  it("goes offline when the server cannot be reached, and back on the next answer", async () => {
    await expect(
      tracked(() => Promise.reject({ status: 0, code: "be.error.online.unreachable" })),
    ).rejects.toBeInstanceOf(OnlineApiError);
    expect(useOnlineStore.getState().network).toBe("offline");

    await tracked(() => Promise.resolve(1));
    expect(useOnlineStore.getState().network).toBe("ok");
  });

  // Given a refusal the server did send (a 409),
  // when it fails,
  // then the server is reachable: the mode is not offline.
  it("counts a server's refusal as an answer", () => {
    useOnlineStore.setState({ network: "offline" });
    useOnlineStore
      .getState()
      .noteFailure(new OnlineApiError({ status: 409, code: "be.error.club.alreadyOwned" }));
    expect(useOnlineStore.getState().network).toBe("ok");
  });

  // Given a server on another contract revision,
  // when a request fails because of it,
  // then the gate closes the online mode in the right direction.
  it("closes the gate when the revisions differ", async () => {
    restore = setOnlineTransport({
      request: <T>(): Promise<OnlineResponse<T>> =>
        Promise.resolve({ status: 200, body: {} as T, contractRevision: CONTRACT_REVISION + 1 }),
    });
    await expect(refreshSeason()).rejects.toBeInstanceOf(OnlineApiError);
    expect(useOnlineStore.getState().gate).toBe("clientOutdated");
  });
});

describe("refresh", () => {
  // Given a coach with no club, no league and no season under way,
  // when the shared views are read,
  // then each is null (there is none), not undefined (not read yet).
  it("reads a 404 as none", async () => {
    const notFound = { failure: { status: 404, code: "be.error.notFound" } };
    restore = stage({
      "GET v1/season": notFound,
      "GET v1/clubs/mine": { failure: { status: 404, code: "be.error.club.none" } },
      "GET v1/leagues/mine": notFound,
    });
    await refreshSeason();
    await refreshClub();
    await refreshLeague();
    const state = useOnlineStore.getState();
    expect([state.season, state.club, state.league]).toEqual([null, null, null]);
  });

  // Given a server error that is not a 404,
  // when the club is read,
  // then it is reported, and the club is left as it was.
  it("rethrows any other failure", async () => {
    restore = stage({
      "GET v1/clubs/mine": { failure: { status: 500, code: "be.error.internal" } },
    });
    await expect(refreshClub()).rejects.toMatchObject({ code: "be.error.internal" });
    expect(useOnlineStore.getState().club).toBeUndefined();
  });
});
