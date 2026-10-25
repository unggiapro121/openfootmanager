import type { AuctionView, FinanceView, MyMarketView } from "../../api";
import type { OnlineRequest } from "../../../services/onlineTransport";
import {
  type Answer,
  fakeServer,
  LEAGUE,
  myClub,
  ok,
  SEASON,
  squadPlayer,
} from "../../../test-utils/onlineTestKit";

/** The server's moment every staged auction is read at. */
export const SERVER_NOW = "2026-10-25T10:00:00.000Z";
export const ACCOUNT = "account-1";
export const MY_CLUB = "club-1";

export function auction(overrides: Partial<AuctionView> = {}): AuctionView {
  return {
    id: "a-1",
    playerId: "p9",
    player: {
      fullName: "Trần Văn Bình",
      position: "Defender",
      naturalPosition: "CenterBack",
      nationality: "VN",
      age: 24,
      ovr: 61,
      potentialStars: 3,
      wage: 3_400,
      positionRatings: [],
      attributes: squadPlayer().attributes,
    },
    sellerClubId: "club-2",
    sellerName: "Sóng Biển Đà Nẵng",
    forced: false,
    status: "active",
    startPrice: 600_000,
    priceCap: 2_500_000,
    marketValue: 1_000_000,
    minNextBid: 600_000,
    capHolders: 0,
    nextSteps: [600_000, 650_000],
    softCloseMillis: 180_000,
    bidsCount: 0,
    endsAt: "2026-10-25T12:00:00.000Z",
    hardEndsAt: "2026-10-25T18:00:00.000Z",
    serverNow: SERVER_NOW,
    ...overrides,
  };
}

export function finance(overrides: Partial<FinanceView> = {}): FinanceView {
  return {
    economy: true,
    cash: 3_000_000,
    held: 0,
    locked: false,
    season: [],
    weeklyWageBill: 49_791,
    arrearsDaysToForcedListing: 3,
    ...overrides,
  };
}

export const EMPTY_MARKET: MyMarketView = { selling: [], holding: [], recent: [] };

/** The online shell's routes plus the market's, as staged; `more` adds or replaces. */
export function serveMarket(
  more: Record<string, Answer | ((request: OnlineRequest) => Answer)> = {},
) {
  return fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub({ players: [squadPlayer()] })),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/me": ok({ id: ACCOUNT }),
    "GET v1/friendlies/mine": ok({}),
    "GET v1/clubs/mine/finance": ok(finance()),
    "GET v1/clubs/mine/market": ok(EMPTY_MARKET),
    "GET v1/auctions": ok({ items: [] }),
    "GET v1/auctions/a-1": ok(auction()),
    ...more,
  });
}

export const sentTo = (
  server: ReturnType<typeof fakeServer>,
  method: string,
  path: string,
): OnlineRequest[] =>
  server.requests.filter(
    (request) => request.method === method && request.segments.join("/") === path,
  );
