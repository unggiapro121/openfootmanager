import type { TFunction } from "i18next";
import type { SeasonNowView } from "../api";

/** Days of an online season: 2 of pre-season, 26 league days (ARCHITECTURE §2.2). */
export const SEASON_DAYS = 28;

/** The season and its day, as the header and the sidebar's club card say it. */
export function seasonText(t: TFunction, season: SeasonNowView | null | undefined): string {
  if (!season) return t("online.season.none");
  if (season.day === undefined) return t("online.header.season", { number: season.number });
  return t("online.header.seasonDay", {
    number: season.number,
    day: season.day + 1,
    total: SEASON_DAYS,
  });
}

/** Pages named by their path, then pages named by the start of it. */
const TITLE_BY_PATH: Record<string, string> = {
  "/online": "online.nav.overview",
  "/online/takeover": "online.takeover.title",
  "/online/squad": "online.nav.squad",
  "/online/tactics": "online.nav.tactics",
  "/online/training": "online.nav.training",
  "/online/academy": "online.nav.academy",
  "/online/league": "online.nav.league",
  "/online/schedule": "online.nav.schedule",
  "/online/friendly": "online.nav.friendly",
  "/online/finance": "online.nav.finance",
  "/online/market": "online.nav.market",
  "/online/inbox": "online.nav.inbox",
  "/online/coins": "online.nav.coins",
  "/online/inventory": "online.nav.inventory",
  "/online/shop": "online.nav.shop",
  "/online/events": "online.nav.events",
  "/online/profile": "online.nav.profile",
};
const TITLE_BY_PREFIX: [string, string][] = [
  ["/online/squad/", "online.nav.squad"],
  ["/online/auctions/", "online.nav.market"],
  ["/online/fixtures/", "online.nav.schedule"],
];

/**
 * The header's title for a page (designs vi-coin.html and the others): the page's own name.
 * None for a page that is not one of the coach's sections (another club, a match), which the
 * header names by the coach's club instead.
 */
export function pageTitleKey(pathname: string): string | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  return TITLE_BY_PATH[path] ?? TITLE_BY_PREFIX.find(([prefix]) => path.startsWith(prefix))?.[1];
}

/** Whether a sidebar or header entry stands for the page open now. */
export function isCurrent(entry: string, pathname: string): boolean {
  if (pathname === entry) return true;
  if (entry === "/online") return pathname === "/online/takeover";
  if (entry === "/online/market") return pathname.startsWith("/online/auctions/");
  if (entry === "/online/squad") return pathname.startsWith("/online/squad/");
  return false;
}
