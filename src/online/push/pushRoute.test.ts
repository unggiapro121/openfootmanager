import { describe, expect, it } from "vitest";

import { pushRoute } from "./pushRoute";

const FIXTURE = "01a16f79-3126-72e0-b2d1-325f38ddce11";
const AUCTION = "01a16f79-3126-72e0-b2d1-325f38ddce22";

describe("pushRoute", () => {
  // Given a match-soon push, which tells the coach his line-up is about to lock,
  // when the coach opens it,
  // then the app goes to the line-up screen (P5-45), whatever fixture id or route it carries.
  it("opens the line-up for a match that is about to start", () => {
    expect(pushRoute({ kind: "matchSoon", fixtureId: FIXTURE })).toBe("/online/tactics");
    expect(pushRoute({ kind: "matchSoon", route: "/online/tactics" })).toBe("/online/tactics");
    expect(pushRoute({ kind: "matchSoon", route: `/online/matches/${FIXTURE}` })).toBe(
      "/online/tactics",
    );
    expect(pushRoute({ kind: "matchSoon" })).toBe("/online/tactics");
  });

  // Given a match-soon push whose id or route is not to be trusted,
  // when the coach opens it,
  // then it still leads to the line-up only: nothing in it is followed.
  it("never follows a match-soon push's own route", () => {
    expect(pushRoute({ kind: "matchSoon", fixtureId: "../settings" })).toBe("/online/tactics");
    expect(pushRoute({ kind: "matchSoon", route: "https://example.test/x" })).toBe(
      "/online/tactics",
    );
  });

  // Given each of the three auction pushes carrying the auction's id,
  // when the coach opens it,
  // then the app goes to that auction's page.
  it("opens the auction for each auction kind", () => {
    for (const kind of ["outbid", "auctionEnding", "auctionResult"]) {
      expect(pushRoute({ kind, auctionId: AUCTION })).toBe(`/online/auctions/${AUCTION}`);
    }
  });

  // Given a daily-gift push,
  // when the coach opens it,
  // then the app goes to the inventory, where the gift is taken.
  it("opens the inventory for the daily gift", () => {
    expect(pushRoute({ kind: "dailyGift", route: "/online/gifts" })).toBe("/online/inventory");
  });

  // Given an M3b1 auction push with no id field, only its server route (`/online/market/<id>`),
  // when the coach opens it,
  // then the id is read from the route's last part and the app's own path is built from it.
  it("reads the id from the route when the data has no id field", () => {
    expect(pushRoute({ kind: "outbid", route: `/online/market/${AUCTION}` })).toBe(
      `/online/auctions/${AUCTION}`,
    );
  });

  // Given a push whose id field and route disagree,
  // when the coach opens it,
  // then the id field wins.
  it("prefers the data's id field over the route", () => {
    expect(
      pushRoute({ kind: "outbid", auctionId: AUCTION, route: `/online/market/${FIXTURE}` }),
    ).toBe(`/online/auctions/${AUCTION}`);
  });

  // Given pushes the app cannot trust: an unknown kind, an id that is not a UUID, a route that
  // tries to lead elsewhere, or nothing at all,
  // when the coach opens one,
  // then the app goes to the overview and never follows the route string.
  it("falls back to the overview for anything outside the whitelist", () => {
    expect(pushRoute({ kind: "coins", route: "/online/coins" })).toBe("/online");
    expect(pushRoute({ kind: "auctionEnding", auctionId: "../settings" })).toBe("/online");
    expect(pushRoute({ kind: "auctionResult", route: "/online/market/not-an-id" })).toBe("/online");
    expect(pushRoute({ kind: "outbid", route: "https://example.test/x" })).toBe("/online");
    expect(pushRoute({ kind: "outbid", route: `/settings?next=${AUCTION}` })).toBe("/online");
    expect(pushRoute({ kind: "outbid" })).toBe("/online");
    expect(pushRoute({})).toBe("/online");
  });
});
