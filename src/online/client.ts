import {
  type OnlineRequest,
  type OnlineResponse,
  onlineRequest,
} from "../services/onlineTransport";
import type {
  AccountView,
  AvatarImageRequest,
  AvatarImageView,
  AuctionPage,
  AuctionView,
  CareerView,
  ClubFixturesView,
  CommandAccepted,
  FacilitiesView,
  FacilityUpgradeView,
  FinanceView,
  FixtureDetailView,
  FramesPage,
  FriendlyMineView,
  LeadersView,
  LeagueView,
  LedgerPage,
  LicenceTableView,
  ListingQuoteView,
  MarketQuery,
  MatchView,
  MineView,
  MyClubView,
  MyMarketView,
  PublicClubView,
  RoundView,
  SeasonNowView,
  TakeoverView,
  TrainingPlan,
  UpdateAccount,
  RenamePlayerRequest,
  ShirtRequest,
  PlayerAvatarRequest,
  PlayerNationalityRequest,
  StadiumRequest,
} from "./api";
import { CONTRACT_REVISION } from "./api/contract";
import type { MatchCommand } from "./api/engine";
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
    /** His own picture, a data URL (404 when he has none), sent shrunk, and taken away. */
    avatarImage: () => call<AvatarImageView>(read(["v1", "me", "avatar-image"])),
    setAvatarImage: (dataUrl: string, idempotencyKey = newKey()) =>
      call<AccountView>(
        write("PUT", ["v1", "me", "avatar-image"], idempotencyKey, {
          dataUrl,
        } satisfies AvatarImageRequest),
      ),
    removeAvatarImage: (idempotencyKey = newKey()) =>
      call<AccountView>({
        method: "DELETE",
        segments: ["v1", "me", "avatar-image"],
        idempotencyKey,
      }),
    /** The coach's online level, seasons and promotions, and the road ahead (his profile). */
    career: () => call<CareerView>(read(["v1", "me", "career"])),
  },
  clubs: {
    takeover: (idempotencyKey = newKey()) =>
      call<TakeoverView>(write("POST", ["v1", "clubs", "takeover"], idempotencyKey)),
    mine: () => call<MyClubView>(read(["v1", "clubs", "mine"])),
    /** The caller's club's season, every fixture by round (C-2s). */
    mineFixtures: () => call<ClubFixturesView>(read(["v1", "clubs", "mine", "fixtures"])),
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
    renameStadium: (name: string, idempotencyKey = newKey()) =>
      call<MyClubView>(
        write("PATCH", ["v1", "clubs", "mine", "stadium"], idempotencyKey, {
          name,
        } satisfies StadiumRequest),
      ),
    byId: (clubId: string) => call<PublicClubView>(read(["v1", "clubs", clubId])),
    /** Dismiss what the server says it fitted to the coach's licence (S-9 S9-20). */
    dismissLicenceNotice: (idempotencyKey = newKey()) =>
      call<MyClubView>({
        method: "DELETE",
        segments: ["v1", "clubs", "mine", "licence-notice"],
        idempotencyKey,
      }),
  },
  /** The four licences and the coach levels they start at (S-9 S9-15). */
  licences: {
    table: () => call<LicenceTableView>(read(["v1", "licences"])),
  },
  leagues: {
    mine: () => call<LeagueView>(read(["v1", "leagues", "mine"])),
    byId: (leagueId: string) => call<LeagueView>(read(["v1", "leagues", leagueId])),
    /** Who leads the league's season: scorers, assists, clean sheets and cards. */
    leaders: (leagueId: string) => call<LeadersView>(read(["v1", "leagues", leagueId, "leaders"])),
    round: (leagueId: string, round: number) =>
      call<RoundView>(read(["v1", "leagues", leagueId, "fixtures"], [["round", String(round)]])),
  },
  fixtures: {
    byId: (fixtureId: string) => call<FixtureDetailView>(read(["v1", "fixtures", fixtureId])),
  },
  /** A live match (S-8): follow it with `watchMatch` from the view's `lastSeq` (`./live`). */
  matches: {
    /** The match as it stands, or after step `atSeq` (0: as it kicked off), for a replay. */
    byId: (matchId: string, atSeq?: number) =>
      call<MatchView>(
        read(
          ["v1", "matches", matchId],
          atSeq === undefined ? undefined : [["atSeq", String(atSeq)]],
        ),
      ),
    /** The caller's own side: its dials, roles, takers, and the orders they sent. */
    mine: (matchId: string) => call<MineView>(read(["v1", "matches", matchId, "mine"])),
    /** Frames after step `afterSeq`, up to `limit` (120 at most). */
    frames: (matchId: string, afterSeq: number, limit?: number) =>
      call<FramesPage>(
        read(
          ["v1", "matches", matchId, "frames"],
          limit === undefined
            ? [["afterSeq", String(afterSeq)]]
            : [
                ["afterSeq", String(afterSeq)],
                ["limit", String(limit)],
              ],
        ),
      ),
    /** An order for the caller's side, applied in the next gap; its outcome comes in a frame. */
    command: (matchId: string, command: MatchCommand, idempotencyKey = newKey()) =>
      call<CommandAccepted>(
        write("POST", ["v1", "matches", matchId, "commands"], idempotencyKey, { command }),
      ),
  },
  /** The club's money (S-10, C-5): balances and the season, the ledger, the facilities. */
  finance: {
    mine: () => call<FinanceView>(read(["v1", "clubs", "mine", "finance"])),
    /** The ledger newest first; `cursor` is the `nextCursor` of the page before. */
    ledger: (cursor?: number, limit?: number) =>
      call<LedgerPage>(
        read(
          ["v1", "clubs", "mine", "ledger"],
          [
            ...(cursor === undefined ? [] : [["cursor", String(cursor)] as [string, string]]),
            ...(limit === undefined ? [] : [["limit", String(limit)] as [string, string]]),
          ],
        ),
      ),
    /** Each facility's level, next cost and effects now and after: the upgrade dialog's preview. */
    facilities: () => call<FacilitiesView>(read(["v1", "clubs", "mine", "facilities"])),
    upgradeFacility: (facility: string, idempotencyKey = newKey()) =>
      call<FacilityUpgradeView>(
        write("POST", ["v1", "clubs", "mine", "facilities", facility, "upgrade"], idempotencyKey),
      ),
  },
  /** The coach's players (S-14): a player's two names, the first change of each free. */
  players: {
    rename: (playerId: string, fullName: string, matchName: string, idempotencyKey = newKey()) =>
      call<MyClubView>(
        write("PATCH", ["v1", "players", playerId, "name"], idempotencyKey, {
          fullName,
          matchName,
        } satisfies RenamePlayerRequest),
      ),
    /** The face drawn for him from his nationality's pool: a seed; empty takes it away. */
    setAvatar: (playerId: string, seed: string, idempotencyKey = newKey()) =>
      call<MyClubView>(
        write("PATCH", ["v1", "players", playerId, "avatar"], idempotencyKey, {
          seed,
        } satisfies PlayerAvatarRequest),
      ),
    /** His own picture, a data URL (404 when he has none): his coach's alone. */
    avatarImage: (playerId: string) =>
      call<AvatarImageView>(read(["v1", "players", playerId, "avatar-image"])),
    setAvatarImage: (playerId: string, dataUrl: string, idempotencyKey = newKey()) =>
      call<MyClubView>(
        write("PUT", ["v1", "players", playerId, "avatar-image"], idempotencyKey, {
          dataUrl,
        } satisfies AvatarImageRequest),
      ),
    removeAvatarImage: (playerId: string, idempotencyKey = newKey()) =>
      call<MyClubView>({
        method: "DELETE",
        segments: ["v1", "players", playerId, "avatar-image"],
        idempotencyKey,
      }),
    setNationality: (playerId: string, nationality: string, idempotencyKey = newKey()) =>
      call<MyClubView>(
        write("PATCH", ["v1", "players", playerId, "nationality"], idempotencyKey, {
          nationality,
        } satisfies PlayerNationalityRequest),
      ),
    /** His shirt number: `null` takes it away; `swap` trades with the player who wears `number`. */
    shirt: (playerId: string, number: number | null, swap: boolean, idempotencyKey = newKey()) =>
      call<MyClubView>(
        write("PATCH", ["v1", "players", playerId, "shirt"], idempotencyKey, {
          number,
          swap,
        } satisfies ShirtRequest),
      ),
  },
  /**
   * The auction market (S-11, C-5): open auctions, one auction, a bid, the caller's listings.
   * Follow an auction with `watchAuction` (`./live`) and read it again when it rings.
   */
  market: {
    auctions: (query: MarketQuery = {}) =>
      call<AuctionPage>(
        read(
          ["v1", "auctions"],
          Object.entries(query)
            .filter(([, value]) => value !== undefined && value !== null && value !== "")
            .map(([name, value]) => [name, String(value)] as [string, string]),
        ),
      ),
    byId: (auctionId: string) => call<AuctionView>(read(["v1", "auctions", auctionId])),
    bid: (auctionId: string, amount: number, idempotencyKey = newKey()) =>
      call<AuctionView>(
        write("POST", ["v1", "auctions", auctionId, "bids"], idempotencyKey, { amount }),
      ),
    /** Withdraw one of the caller's listings while nobody has bid. */
    withdraw: (auctionId: string, idempotencyKey = newKey()) =>
      call<AuctionView>({
        method: "DELETE",
        segments: ["v1", "auctions", auctionId],
        idempotencyKey,
      }),
    mine: () => call<MyMarketView>(read(["v1", "clubs", "mine", "market"])),
    /** What listing `playerId` now would be, or why it would be refused. */
    quote: (playerId: string) =>
      call<ListingQuoteView>(read(["v1", "clubs", "mine", "players", playerId, "listing-quote"])),
    list: (playerId: string, startPrice: number, idempotencyKey = newKey()) =>
      call<AuctionView>(
        write("POST", ["v1", "clubs", "mine", "listings"], idempotencyKey, {
          playerId,
          startPrice,
        }),
      ),
  },
  /**
   * Friendlies (S-12): every write answers the caller's friendly as it stands after it. Follow
   * `watchAccount` (`./live`) and read `mine` again when it rings.
   */
  friendlies: {
    mine: () => call<FriendlyMineView>(read(["v1", "friendlies", "mine"])),
    createRoom: (idempotencyKey = newKey()) =>
      call<FriendlyMineView>(write("POST", ["v1", "friendlies", "rooms"], idempotencyKey)),
    /** `code` as the coach typed it: the server reads it with or without its dash, in any case. */
    join: (code: string, idempotencyKey = newKey()) =>
      call<FriendlyMineView>(
        write("POST", ["v1", "friendlies", "rooms", "join"], idempotencyKey, { code }),
      ),
    ready: (ready: boolean, idempotencyKey = newKey()) =>
      call<FriendlyMineView>(
        write("POST", ["v1", "friendlies", "rooms", "mine", "ready"], idempotencyKey, { ready }),
      ),
    leave: (idempotencyKey = newKey()) =>
      call<FriendlyMineView>(
        write("POST", ["v1", "friendlies", "rooms", "mine", "leave"], idempotencyKey),
      ),
    rematch: (idempotencyKey = newKey()) =>
      call<FriendlyMineView>(
        write("POST", ["v1", "friendlies", "rooms", "mine", "rematch"], idempotencyKey),
      ),
    queue: (idempotencyKey = newKey()) =>
      call<FriendlyMineView>(write("POST", ["v1", "friendlies", "queue"], idempotencyKey)),
    /** Leave the queue; nothing when not in it. A DELETE needs no key: twice is once. */
    leaveQueue: () => call<null>({ method: "DELETE", segments: ["v1", "friendlies", "queue"] }),
  },
};
