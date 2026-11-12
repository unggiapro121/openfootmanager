import { describe, expect, it } from "vitest";

import { pushRoute } from "./pushRoute";

const FIXTURE = "01a16f79-3126-72e0-b2d1-325f38ddce11";
const AUCTION = "01a16f79-3126-72e0-b2d1-325f38ddce22";

describe("pushRoute", () => {
  // Given a match-soon push carrying its fixture's id in its data (M3b2),
  // when the coach opens it,
  // then the app goes to that fixture's page.
  it("opens the fixture named by the data's fixtureId", () => {
    expect(pushRoute({ kind: "matchSoon", fixtureId: FIXTURE })).toBe(
      `/online/fixtures/${FIXTURE}`,
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

  // Given an M3b1 push with no id field, only its server route (`/online/matches/<id>`,
  // `/online/market/<id>`),
  // when the coach opens it,
  // then the id is read from the route's last part and the app's own path is built from it.
  it("reads the id from the route when the data has no id field", () => {
    expect(pushRoute({ kind: "matchSoon", route: `/online/matches/${FIXTURE}` })).toBe(
      `/online/fixtures/${FIXTURE}`,
    );
    expect(pushRoute({ kind: "outbid", route: `/online/market/${AUCTION}` })).toBe(
      `/online/auctions/${AUCTION}`,
    );
  });

  // Given a push whose id field and route disagree,
  // when the coach opens it,
  // then the id field wins.
  it("prefers the data's id field over the route", () => {
    expect(
      pushRoute({ kind: "matchSoon", fixtureId: FIXTURE, route: `/online/matches/${AUCTION}` }),
    ).toBe(`/online/fixtures/${FIXTURE}`);
  });

  // Given pushes the app cannot trust: an unknown kind, an id that is not a UUID, a route that
  // tries to lead elsewhere, or nothing at all,
  // when the coach opens one,
  // then the app goes to the overview and never follows the route string.
  it("falls back to the overview for anything outside the whitelist", () => {
    expect(pushRoute({ kind: "coins", route: "/online/coins" })).toBe("/online");
    expect(pushRoute({ kind: "matchSoon", fixtureId: "../settings" })).toBe("/online");
    expect(pushRoute({ kind: "matchSoon", route: "/online/matches/not-an-id" })).toBe("/online");
    expect(pushRoute({ kind: "outbid", route: "https://example.test/x" })).toBe("/online");
    expect(pushRoute({ kind: "outbid", route: `/settings?next=${AUCTION}` })).toBe("/online");
    expect(pushRoute({ kind: "matchSoon" })).toBe("/online");
    expect(pushRoute({})).toBe("/online");
  });
});
