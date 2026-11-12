/**
 * Where an opened push leads (M3c-7, PO P5-42). The app never follows the push's `route` string:
 * it builds its own path from the kind and an id, by a whitelist, so a push cannot send the coach
 * anywhere the app did not plan. Anything else lands on the overview. A match-soon push says the
 * line-up is about to lock, so it opens the line-up, not the fixture's page (P5-45).
 */

const OVERVIEW = "/online";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The push's data as the phone hands it over: every value a string, any of them missing. */
export type PushData = Partial<Record<string, string>>;

/**
 * The auction the push names: its own field when present (M3b2), else the last part of its route
 * (M3b1 sends only `/online/market/<id>`). Only a UUID is taken.
 */
function auctionIdOf(data: PushData): string | undefined {
  const candidate = data.auctionId ?? data.route?.split("/").pop();
  return candidate !== undefined && UUID.test(candidate) ? candidate : undefined;
}

function withId(prefix: string, id: string | undefined): string {
  return id === undefined ? OVERVIEW : `${prefix}/${id}`;
}

export function pushRoute(data: PushData): string {
  switch (data.kind) {
    case "matchSoon":
      return "/online/tactics";
    case "outbid":
    case "auctionEnding":
    case "auctionResult":
      return withId("/online/auctions", auctionIdOf(data));
    case "dailyGift":
      return "/online/inventory";
    default:
      return OVERVIEW;
  }
}
