import {
  type OnlineRequest,
  type OnlineResponse,
  onlineRequest,
} from "../services/onlineTransport";
import type {
  AccountView,
  FixtureDetailView,
  LeagueView,
  MyClubView,
  PublicClubView,
  RoundView,
  SeasonNowView,
  TakeoverView,
  TrainingPlan,
  UpdateAccount,
} from "./api";
import { CONTRACT_REVISION } from "./api/contract";
import type { ClubSetup } from "./api/rules";
import { OnlineApiError, toOnlineApiError } from "./errors";

/**
 * The online API, one function per route (phase 3 E3-6c, E3-6-tech-spec.md §3.5). The types are
 * the server's own (`./api`, copied by `scripts/sync-online-bindings.sh`).
 *
 * A write takes an idempotency key: one per action of the player, the same key when that action
 * is sent again, so the server answers it once (E6-16). Leave it out for a new action.
 */

/**
 * Whether the online mode may still talk to the server. A server on another contract revision
 * closes it for the session, in either direction (E6-8): a field renamed under the client would
 * otherwise be read as missing.
 */
type Gate = "open" | "clientOutdated" | "serverOutdated";
let gate: Gate = "open";

/** Open the online mode again, as a new session of the app would (and between tests). */
export function reopenOnlineGate(): void {
  gate = "open";
}

function closeOn(revision: number | undefined): void {
  // A server older than the revision header answers without one: it is behind this client.
  const served = revision ?? 0;
  if (served > CONTRACT_REVISION) gate = "clientOutdated";
  else if (served < CONTRACT_REVISION) gate = "serverOutdated";
}

function closed(): OnlineApiError {
  return new OnlineApiError({ status: 0, code: `be.error.online.${gate}` });
}

async function call<T>(request: OnlineRequest): Promise<T> {
  if (gate !== "open") throw closed();
  let response: OnlineResponse<T>;
  try {
    response = await onlineRequest<T>(request);
  } catch (rejection) {
    const error = toOnlineApiError(rejection);
    // Only an answer from the server says which revision it is on; the proxy's own refusals
    // (status 0) say nothing about it.
    if (error.status !== 0) closeOn(error.contractRevision);
    throw gate === "open" ? error : closed();
  }
  closeOn(response.contractRevision);
  if (gate !== "open") throw closed();
  return response.body;
}

const newKey = (): string => crypto.randomUUID();

function read(segments: string[], query?: [string, string][]): OnlineRequest {
  return query ? { method: "GET", segments, query } : { method: "GET", segments };
}

function write(
  method: "POST" | "PUT" | "PATCH",
  segments: string[],
  idempotencyKey: string,
  body?: unknown,
): OnlineRequest {
  return body === undefined
    ? { method, segments, idempotencyKey }
    : { method, segments, idempotencyKey, body };
}

export const online = {
  season: {
    now: () => call<SeasonNowView>(read(["v1", "season"])),
  },
  me: {
    get: () => call<AccountView>(read(["v1", "me"])),
    update: (change: UpdateAccount, idempotencyKey = newKey()) =>
      call<AccountView>(write("PATCH", ["v1", "me"], idempotencyKey, change)),
  },
  clubs: {
    takeover: (idempotencyKey = newKey()) =>
      call<TakeoverView>(write("POST", ["v1", "clubs", "takeover"], idempotencyKey)),
    mine: () => call<MyClubView>(read(["v1", "clubs", "mine"])),
    /** `version` is the club's version as read: a stale one is refused (`versionStale`). */
    setSetup: (setup: ClubSetup, version: number, idempotencyKey = newKey()) =>
      call<MyClubView>({
        ...write("PUT", ["v1", "clubs", "mine", "setup"], idempotencyKey, setup),
        ifMatch: String(version),
      }),
    setTraining: (plan: TrainingPlan, idempotencyKey = newKey()) =>
      call<TrainingPlan>(write("PUT", ["v1", "clubs", "mine", "training"], idempotencyKey, plan)),
    rename: (name: string, idempotencyKey = newKey()) =>
      call<MyClubView>(write("PATCH", ["v1", "clubs", "mine"], idempotencyKey, { name })),
    byId: (clubId: string) => call<PublicClubView>(read(["v1", "clubs", clubId])),
  },
  leagues: {
    mine: () => call<LeagueView>(read(["v1", "leagues", "mine"])),
    byId: (leagueId: string) => call<LeagueView>(read(["v1", "leagues", leagueId])),
    round: (leagueId: string, round: number) =>
      call<RoundView>(read(["v1", "leagues", leagueId, "fixtures"], [["round", String(round)]])),
  },
  fixtures: {
    byId: (fixtureId: string) => call<FixtureDetailView>(read(["v1", "fixtures", fixtureId])),
  },
};
