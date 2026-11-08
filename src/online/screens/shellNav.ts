import type { TFunction } from "i18next";
import {
  Award,
  Backpack,
  BadgeCheck,
  Calendar,
  Coins,
  Crosshair,
  Dumbbell,
  Gavel,
  Gift,
  GraduationCap,
  Handshake,
  LogOut,
  type LucideIcon,
  Store,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";
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
  "/online/honours": "online.nav.honours",
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

/** One page in the navigation: where it is, its name's key, its icon. */
export interface NavEntry {
  path: string;
  label: string;
  icon: LucideIcon;
}

/** The sections a phone's tab bar opens as sheets; the sidebar shows the first three. */
export type NavGroupId = "team" | "matches" | "club" | "more";

export interface NavGroup {
  id: NavGroupId;
  label: string;
  entries: NavEntry[];
}

/**
 * The club's pages by group (design vi-coin.html), shown once the coach runs a club. The sidebar
 * lists them; a phone opens each group from its tab bar (design m-tong-quan.html).
 */
export const CLUB_GROUPS: NavGroup[] = [
  {
    id: "team",
    label: "online.nav.groupTeam",
    entries: [
      { path: "/online/squad", label: "online.nav.squad", icon: Users },
      { path: "/online/tactics", label: "online.nav.tactics", icon: Crosshair },
      { path: "/online/training", label: "online.nav.training", icon: Dumbbell },
      { path: "/online/academy", label: "online.nav.academy", icon: GraduationCap },
    ],
  },
  {
    id: "matches",
    label: "online.nav.groupMatches",
    entries: [
      { path: "/online/schedule", label: "online.nav.schedule", icon: Calendar },
      { path: "/online/league", label: "online.nav.league", icon: Trophy },
      { path: "/online/friendly", label: "online.nav.friendly", icon: Handshake },
    ],
  },
  {
    id: "club",
    label: "online.nav.groupClub",
    entries: [
      { path: "/online/finance", label: "online.nav.finance", icon: Wallet },
      { path: "/online/market", label: "online.nav.market", icon: Gavel },
      { path: "/online/honours", label: "online.nav.honours", icon: Award },
    ],
  },
];

/**
 * The person's own pages, which the desktop keeps in the header and a phone under More (design
 * m-tong-quan.html), open with or without a club; then the way out to the main menu, which the
 * desktop's account menu holds.
 */
export const MORE_GROUP: NavGroup = {
  id: "more",
  label: "online.nav.groupMore",
  entries: [
    { path: "/online/events", label: "online.nav.events", icon: Gift },
    { path: "/online/shop", label: "online.nav.shop", icon: Store },
    { path: "/online/inventory", label: "online.nav.inventory", icon: Backpack },
    { path: "/online/coins", label: "online.nav.coins", icon: Coins },
    { path: "/online/profile", label: "online.nav.profile", icon: BadgeCheck },
    { path: "/", label: "online.nav.mainMenu", icon: LogOut },
  ],
};

/** Pages reached from a group's page, counted as that group's (a player, an auction, a match). */
const GROUP_BY_PREFIX: [string, NavGroupId][] = [
  ["/online/squad/", "team"],
  ["/online/fixtures/", "matches"],
  ["/online/match/", "matches"],
  ["/online/auctions/", "club"],
  ["/online/inbox", "more"],
];

/**
 * The phone tab that stands for the page open now: Overview for the overview (and taking a
 * club), the group holding the page otherwise, none for another club's page.
 */
export function navGroupOf(pathname: string): NavGroupId | "overview" | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  if (path === "/online" || path === "/online/takeover") return "overview";
  for (const group of [...CLUB_GROUPS, MORE_GROUP]) {
    if (group.entries.some((entry) => entry.path === path)) return group.id;
  }
  return GROUP_BY_PREFIX.find(([prefix]) => path.startsWith(prefix))?.[1];
}

/**
 * The coins the header shows: once coins are open to anyone (a price list) or the coach holds
 * some (C-7 Qc7-2); none otherwise.
 */
export function visibleCoinBalance(
  coins: { priceListVersion?: number; balance: number } | null | undefined,
): number | undefined {
  return coins && (coins.priceListVersion !== undefined || coins.balance !== 0)
    ? coins.balance
    : undefined;
}
