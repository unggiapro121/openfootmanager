import {
  type OnlineRequest,
  type OnlineResponse,
  onlineRequest,
} from "../services/onlineTransport";
import type {
  AcademyPlayerView,
  AcademyView,
  AccountView,
  AuctionPage,
  AuctionView,
  AvatarImageRequest,
  AvatarImageView,
  CareerView,
  ChampionsView,
  ClaimView,
  ClubCrest,
  ClubFixturesView,
  ClubHonoursView,
  CoachHonoursView,
  CoinExchangeRequest,
  CoinExchangeView,
  CoinLinesPage,
  CoinView,
  CommandAccepted,
  DailyGiftClaimView,
  EventsView,
  ExtraDrinksRequest,
  ExtraDrinksView,
  ExtraSessionRequest,
  ExtraSessionView,
  FacilitiesView,
  FacilityUpgradeView,
  FinanceView,
  FixtureDetailView,
  FixtureProgressView,
  FramesPage,
  FriendlyMineView,
  InboxPage,
  InventoryView,
  ItemEntriesPage,
  ItemPreviewView,
  ItemTarget,
  ItemUseView,
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
  OpponentReportListQuery,
  OpponentReportListView,
  OpponentReportQuoteView,
  OpponentReportRequest,
  OpponentReportView,
  OpponentView,
  PlayerAvatarRequest,
  PlayerHonoursView,
  PlayerNationalityRequest,
  PlayerPerformanceView,
  PlayerTrainingFocusRequest,
  PublicClubView,
  PublicPlayerPageView,
  PurchaseRequest,
  PurchaseView,
  PushDeviceRequest,
  PushPermissionReport,
  PushSettingsView,
  RecruitRequest,
  ReleaseQuoteView,
  RenamePlayerRequest,
  RoundView,
  ScoutQuoteView,
  ScoutRequest,
  ScoutTripView,
  SeasonNowView,
  ShirtRequest,
  ShopView,
  StadiumRequest,
  TakeoverView,
  TrainingPlan,
  UpdateAccount,
  UseItemRequest,
  YoungsterFocusRequest,
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

/**
 * An item's target as the preview's query names it (S-17 §3.7): `player:<id>`, `club`,
 * `style:<style>` or `account`. The use sends the same target in its body.
 */
export function targetQuery(target: ItemTarget): string {
  switch (target.kind) {
    case "player":
      return `player:${target.playerId}`;
    case "style":
      return `style:${target.style}`;
    default:
      return target.kind;
  }
}

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
    /** The titles and promotions won under the coach, at any club (S-42). */
    honours: () => call<CoachHonoursView>(read(["v1", "me", "honours"])),
  },
  /**
   * Push on the phone (M3b1, m3-tech-spec.md §4.2). Every call sets a value, so sending it again
   * gives the same result: the server takes no idempotency key on these. Forgetting the
   * installation at logout is `forgetPushDevice` (services), which the shared menu can call.
   */
  push: {
    /** The app's installation registers its token, language and clock. */
    registerDevice: (installationId: string, device: PushDeviceRequest) =>
      call<null>({
        method: "PUT",
        segments: ["v1", "me", "push-devices", installationId],
        body: device,
      }),
    settings: () => call<PushSettingsView>(read(["v1", "me", "push-settings"])),
    /** Every kind at once: a kind left out is on, so all five are always sent. */
    setSettings: (settings: PushSettingsView) =>
      call<PushSettingsView>({
        method: "PUT",
        segments: ["v1", "me", "push-settings"],
        body: settings,
      }),
    /** A push the coach opened, by its data's `outboxId`. */
    opened: (outboxId: string) =>
      call<null>({ method: "POST", segments: ["v1", "me", "push-opened", outboxId] }),
    /** Whether the coach let the app notify him; the server only counts it. */
    reportPermission: (granted: boolean) =>
      call<null>({
        method: "POST",
        segments: ["v1", "me", "push-permission"],
        body: { granted } satisfies PushPermissionReport,
      }),
  },
  clubs: {
    takeover: (idempotencyKey = newKey()) =>
      call<TakeoverView>(write("POST", ["v1", "clubs", "takeover"], idempotencyKey)),
    mine: () => call<MyClubView>(read(["v1", "clubs", "mine"])),
    /** The caller's club's season, every fixture by round (C-2s). */
    mineFixtures: () => call<ClubFixturesView>(read(["v1", "clubs", "mine", "fixtures"])),
    /** `version` is the club's version as read: a stale one is refused (`versionStale`). */
    /**
     * The whole setup, and the XI assistant's switch (S-27 S27-6, C-10 C10-2): sent with every
     * save, so the server never has to read it from the eleven.
     */
    setSetup: (
      setup: ClubSetup,
      version: number,
      idempotencyKey = newKey(),
      xiAssistant?: boolean,
    ) =>
      call<MyClubView>({
        ...write(
          "PUT",
          ["v1", "clubs", "mine", "setup"],
          idempotencyKey,
          xiAssistant === undefined ? setup : { ...setup, xiAssistant },
        ),
        ifMatch: String(version),
      }),
    setTraining: (plan: TrainingPlan, idempotencyKey = newKey()) =>
      call<TrainingPlan>(write("PUT", ["v1", "clubs", "mine", "training"], idempotencyKey, plan)),
    /**
     * Extra sessions on top of the day's (S-28 S28-2): `request.sessions` of them at once for the
     * players chosen, at `request.intensity`. Refused (409) while the season does not rest clubs
     * by blocks, today has no session, the line-up is locked, or no one chosen can take part.
     */
    extraSessions: (request: ExtraSessionRequest, idempotencyKey = newKey()) =>
      call<ExtraSessionView>(
        write("POST", ["v1", "clubs", "mine", "training", "extra"], idempotencyKey, request),
      ),
    /**
     * Energy drinks for the players of an extra-session choice (S-39 S39-1): the server picks
     * them so those players can train in the sessions asked, cheapest first and within each
     * one's daily cap. `preview` writes nothing and answers what `use` would do now.
     */
    extraDrinks: {
      preview: (request: ExtraDrinksRequest) =>
        call<ExtraDrinksView>({
          method: "POST",
          segments: ["v1", "clubs", "mine", "training", "extra", "drinks", "preview"],
          body: request,
        }),
      use: (request: ExtraDrinksRequest, idempotencyKey = newKey()) =>
        call<ExtraDrinksView>(
          write(
            "POST",
            ["v1", "clubs", "mine", "training", "extra", "drinks"],
            idempotencyKey,
            request,
          ),
        ),
    },
    rename: (name: string, idempotencyKey = newKey()) =>
      call<MyClubView>(write("PATCH", ["v1", "clubs", "mine"], idempotencyKey, { name })),
    renameStadium: (name: string, idempotencyKey = newKey()) =>
      call<MyClubView>(
        write("PATCH", ["v1", "clubs", "mine", "stadium"], idempotencyKey, {
          name,
        } satisfies StadiumRequest),
      ),
    /** The club's crest as its coach drew it: free, as often as he likes. */
    setCrest: (crest: ClubCrest, idempotencyKey = newKey()) =>
      call<MyClubView>(write("PATCH", ["v1", "clubs", "mine", "crest"], idempotencyKey, crest)),
    byId: (clubId: string) => call<PublicClubView>(read(["v1", "clubs", clubId])),
    /** A club's trophy room: trophies, awards, seasons and records (S-42). */
    honours: (clubId: string) => call<ClubHonoursView>(read(["v1", "clubs", clubId, "honours"])),
    /** Any club's season: its fixtures and results (S-46a). */
    fixtures: (clubId: string) => call<ClubFixturesView>(read(["v1", "clubs", clubId, "fixtures"])),
    /**
     * What a coach may know of a club before playing it (S-46a): form, record, head to head, last
     * eleven, notable players and absences. `fixtureId`, the match it is opened for, only tells
     * the server which match it was read before; the profile is the same without it.
     */
    opponent: (clubId: string, fixtureId?: string) =>
      call<OpponentView>(
        read(
          ["v1", "clubs", clubId, "opponent"],
          fixtureId === undefined ? undefined : [["fixture", fixtureId]],
        ),
      ),
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
    /** The champions of the league's level, every closed season, newest first (S-42). */
    champions: (leagueId: string) =>
      call<ChampionsView>(read(["v1", "leagues", leagueId, "champions"])),
    round: (leagueId: string, round: number) =>
      call<RoundView>(read(["v1", "leagues", leagueId, "fixtures"], [["round", String(round)]])),
  },
  fixtures: {
    byId: (fixtureId: string) => call<FixtureDetailView>(read(["v1", "fixtures", fixtureId])),
    /** What a league match did to the coach's players: the "Tiến bộ" page (S-45b, C-22b). */
    progress: (fixtureId: string) =>
      call<FixtureProgressView>(read(["v1", "fixtures", fixtureId, "progress"])),
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
  /** The coach's inbox: what happened to his club; each write answers with the first page. */
  inbox: {
    /** Newest first; `before` is the `nextBefore` of the page before. */
    list: (before?: string, limit?: number) =>
      call<InboxPage>(
        read(
          ["v1", "inbox"],
          [
            ...(before === undefined ? [] : [["before", before] as [string, string]]),
            ...(limit === undefined ? [] : [["limit", String(limit)] as [string, string]]),
          ],
        ),
      ),
    read: (id: string, idempotencyKey = newKey()) =>
      call<InboxPage>({ method: "POST", segments: ["v1", "inbox", id, "read"], idempotencyKey }),
    readAll: (idempotencyKey = newKey()) =>
      call<InboxPage>({ method: "POST", segments: ["v1", "inbox", "read"], idempotencyKey }),
    remove: (id: string, idempotencyKey = newKey()) =>
      call<InboxPage>({ method: "DELETE", segments: ["v1", "inbox", id], idempotencyKey }),
    removeRead: (idempotencyKey = newKey()) =>
      call<InboxPage>({ method: "DELETE", segments: ["v1", "inbox"], idempotencyKey }),
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
  /**
   * The coach's OFM Coins (S-15, C-7a1): they belong to the person, not the club. An exchange
   * carries the price list the screen showed; the server refuses it when another is in force.
   */
  coins: {
    mine: () => call<CoinView>(read(["v1", "me", "coins"])),
    /** The lines newest first; `cursor` is the `nextCursor` of the page before. */
    ledger: (cursor?: number, limit?: number) =>
      call<CoinLinesPage>(
        read(
          ["v1", "me", "coins", "ledger"],
          [
            ...(cursor === undefined ? [] : [["cursor", String(cursor)] as [string, string]]),
            ...(limit === undefined ? [] : [["limit", String(limit)] as [string, string]]),
          ],
        ),
      ),
    exchange: (coins: number, priceListVersion: number, idempotencyKey = newKey()) =>
      call<CoinExchangeView>(
        write("POST", ["v1", "me", "coins", "exchange"], idempotencyKey, {
          coins,
          priceListVersion,
        } satisfies CoinExchangeRequest),
      ),
  },
  /**
   * The coach's items (S-17, C-7b): they belong to the person, like coins. A preview runs the
   * use's own checks and writes nothing; its `target` is the same target the use sends.
   */
  items: {
    mine: () => call<InventoryView>(read(["v1", "me", "items"])),
    /** The entries newest first; `cursor` is the `nextCursor` of the page before. */
    entries: (cursor?: string, limit?: number) =>
      call<ItemEntriesPage>(
        read(
          ["v1", "me", "items", "entries"],
          [
            ...(cursor === undefined ? [] : [["cursor", cursor] as [string, string]]),
            ...(limit === undefined ? [] : [["limit", String(limit)] as [string, string]]),
          ],
        ),
      ),
    preview: (itemCode: string, target: ItemTarget) =>
      call<ItemPreviewView>(
        read(["v1", "me", "items", itemCode, "preview"], [["target", targetQuery(target)]]),
      ),
    use: (itemCode: string, target: ItemTarget, idempotencyKey = newKey()) =>
      call<ItemUseView>(
        write("POST", ["v1", "me", "items", itemCode, "use"], idempotencyKey, {
          target,
        } satisfies UseItemRequest),
      ),
    /**
     * Today's gift of drinks (S-28 S28-9), once a football day. Refused (409) when today's was
     * claimed (`dailyGiftTaken`) or no season gives one now (`dailyGiftClosed`).
     */
    claimDailyGift: (idempotencyKey = newKey()) =>
      call<DailyGiftClaimView>(write("POST", ["v1", "me", "daily-gift"], idempotencyKey, {})),
  },
  /**
   * The club's youth academy (S-18, C-7c): its trip and youngsters, a trip's quote, a trip sent,
   * brought back sooner with a `timeSkip` and chosen from, and a youngster's focus or release.
   */
  academy: {
    view: () => call<AcademyView>(read(["v1", "clubs", "mine", "academy"])),
    quote: (line: string) =>
      call<ScoutQuoteView>(
        read(["v1", "clubs", "mine", "academy", "scout-quote"], [["line", line]]),
      ),
    send: (request: ScoutRequest, idempotencyKey = newKey()) =>
      call<ScoutTripView>(
        write(
          "POST",
          ["v1", "clubs", "mine", "academy", "scouts"],
          idempotencyKey,
          request satisfies ScoutRequest,
        ),
      ),
    timeSkip: (tripId: string, idempotencyKey = newKey()) =>
      call<ScoutTripView>(
        write(
          "POST",
          ["v1", "clubs", "mine", "academy", "scouts", tripId, "time-skip"],
          idempotencyKey,
        ),
      ),
    /** The candidates taken into the academy; none closes the report. */
    recruit: (tripId: string, candidateIds: string[], idempotencyKey = newKey()) =>
      call<AcademyView>(
        write(
          "POST",
          ["v1", "clubs", "mine", "academy", "scouts", tripId, "recruit"],
          idempotencyKey,
          { candidateIds } satisfies RecruitRequest,
        ),
      ),
    /** His own focus, or `undefined` to follow the club's. */
    setFocus: (playerId: string, focus: string | undefined, idempotencyKey = newKey()) =>
      call<AcademyPlayerView>(
        write(
          "PUT",
          ["v1", "clubs", "mine", "academy", "players", playerId, "focus"],
          idempotencyKey,
          (focus === undefined ? {} : { focus }) satisfies YoungsterFocusRequest,
        ),
      ),
    release: (playerId: string, idempotencyKey = newKey()) =>
      call<AcademyView>(
        write(
          "POST",
          ["v1", "clubs", "mine", "academy", "players", playerId, "release"],
          idempotencyKey,
        ),
      ),
  },
  /**
   * The coach's events (S-19, C-7d): the events he may read with his progress, and a finished
   * mission's rewards claimed, all of them or none.
   */
  events: {
    mine: () => call<EventsView>(read(["v1", "me", "events"])),
    claim: (eventId: string, missionCode: string, idempotencyKey = newKey()) =>
      call<ClaimView>(
        write(
          "POST",
          ["v1", "me", "events", eventId, "missions", missionCode, "claim"],
          idempotencyKey,
        ),
      ),
  },
  /** The shop (S-17): what the price list in force sells, bought with coins at that list. */
  shop: {
    view: () => call<ShopView>(read(["v1", "shop"])),
    purchase: (
      itemCode: string,
      quantity: number,
      priceListVersion: number,
      idempotencyKey = newKey(),
    ) =>
      call<PurchaseView>(
        write("POST", ["v1", "shop", "purchases"], idempotencyKey, {
          itemCode,
          quantity,
          priceListVersion,
        } satisfies PurchaseRequest),
      ),
  },
  /**
   * The scouting report on the club's next league opponent (S-47a): its price as it would be
   * bought now, or why it cannot be; the purchase for one fixture; the club's reports.
   */
  opponentReports: {
    quote: () =>
      call<OpponentReportQuoteView>(read(["v1", "clubs", "mine", "opponent-reports", "quote"])),
    /** One report of the club with its content once back, and what changed since (S-47b). */
    byId: (reportId: string) =>
      call<OpponentReportView>(read(["v1", "clubs", "mine", "opponent-reports", reportId])),
    /** `fixtureId` is the match the coach saw, so a press as the next match turns over buys none. */
    buy: (fixtureId: string, idempotencyKey = newKey()) =>
      call<OpponentReportView>(
        write("POST", ["v1", "clubs", "mine", "opponent-reports"], idempotencyKey, {
          fixtureId,
        } satisfies OpponentReportRequest),
      ),
    /** Of one fixture, or of one season (the one under way when neither is given). */
    list: (query: OpponentReportListQuery = {}) => {
      const pairs = Object.entries(query).filter(
        (pair): pair is [string, string] => typeof pair[1] === "string",
      );
      return call<OpponentReportListView>(
        read(["v1", "clubs", "mine", "opponent-reports"], pairs.length > 0 ? pairs : undefined),
      );
    },
  },
  /** The coach's players (S-14): a player's two names, the first change of each free. */
  players: {
    /** Any player's public page: no attributes, condition or potential (S-46a). */
    byId: (playerId: string) => call<PublicPlayerPageView>(read(["v1", "players", playerId])),
    /** A player's awards and champion's medals (S-42). */
    honours: (playerId: string) =>
      call<PlayerHonoursView>(read(["v1", "players", playerId, "honours"])),
    /** His figures ranked among the players of his position, and his last matches (S-43). */
    performance: (playerId: string) =>
      call<PlayerPerformanceView>(read(["v1", "players", playerId, "performance"])),
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
    /** The session he trains alone, whatever his group does; `null` takes it away. */
    setTrainingFocus: (playerId: string, focus: string | null, idempotencyKey = newKey()) =>
      call<MyClubView>(
        write("PATCH", ["v1", "players", playerId, "training-focus"], idempotencyKey, {
          focus,
        } satisfies PlayerTrainingFocusRequest),
      ),
    /** What letting him go now would cost, or why it would be refused. */
    releaseQuote: (playerId: string) =>
      call<ReleaseQuoteView>(read(["v1", "clubs", "mine", "players", playerId, "release-quote"])),
    /** Let him go: the severance is paid, he becomes a free agent. Answers the club as it is now. */
    release: (playerId: string, idempotencyKey = newKey()) =>
      call<MyClubView>(
        write("POST", ["v1", "clubs", "mine", "players", playerId, "release"], idempotencyKey),
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
