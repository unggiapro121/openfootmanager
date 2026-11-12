import { create } from "zustand";
import type {
  AcademyView,
  CoinView,
  EventsView,
  FacilitiesView,
  FinanceView,
  FriendlyMineView,
  InventoryView,
  LeagueView,
  MyClubView,
  MyMarketView,
  SeasonNowView,
} from "../api";
import { online } from "../client";
import { type OnlineApiError, toOnlineApiError } from "../errors";

/**
 * The online mode's own state (phase 3 C-2, C2-3), apart from the offline `gameStore`: the
 * revision gate, whether the server answers, and the views every online screen shares. A view
 * is `undefined` until it is read, and `null` when the server says there is none (no club, no
 * league this season, no season).
 */
export type OnlineGate = "open" | "clientOutdated" | "serverOutdated";

/**
 * One notice in the corner of the screen (C-5 C5-14, C-7 C7-4): whose news it is, what happened,
 * where choosing it goes, and the sentence's parameters.
 */
export interface OnlineNotice {
  id: number;
  /**
   * `market` (an auction, C-5), `items` (an item given or a purchase refunded, C-7b), `academy`
   * (a scouting trip back, C-7c), `event` (a mission finished, C-7d) or `opponentReport` (a
   * scouting report on the next opponent back, C-24b).
   */
  kind: "market" | "items" | "academy" | "event" | "opponentReport";
  /** The ring's event; one this build does not know is said as a change. */
  event: string;
  /** A path in the app (`/online/auctions/{id}`, `/online/inventory`). */
  link?: string;
  /**
   * The sentence's parameters: for the market `player` and `price`, for items `item`, for an
   * event the mission's `kind` and `target`.
   */
  params: Record<string, string | number>;
}

/** Notices shown at once; a new one pushes the oldest out. */
const NOTICES_SHOWN = 3;
let nextNoticeId = 1;

interface OnlineState {
  gate: OnlineGate;
  /** `offline` after a request the server never answered, until one is answered again. */
  network: "ok" | "offline";
  season: SeasonNowView | null | undefined;
  club: MyClubView | null | undefined;
  league: LeagueView | null | undefined;
  /** The coach's friendly (S-12): read when the shell opens and whenever their account rings. */
  friendly: FriendlyMineView | undefined;
  /** The signed-in coach's account, once read: what their account channel is named by. */
  accountId: string | undefined;
  /**
   * The coach's coins (C-7a1): the header's chip and the wallet. `null` when this server has no
   * coins yet (an older server answers 404).
   */
  coins: CoinView | null | undefined;
  /** The club's money (C-5): the header's cash and the finance page. */
  finance: FinanceView | undefined;
  /** The club on the market (C-5): `null` while the season's market is closed. */
  market: MyMarketView | null | undefined;
  /** Market rings not yet seen: the dot on the sidebar's market entry. */
  marketUnseen: number;
  /**
   * The coach's items (C-7b): the inventory page, the shop's lock reason and the rename cards.
   * `null` when this server has no items yet (an older server answers 404).
   */
  items: InventoryView | null | undefined;
  /**
   * The club's academy (C-7c): the academy page, and whether the shop sells its items this season.
   * `null` when there is none to read (no club, or an older server answers 404).
   */
  academy: AcademyView | null | undefined;
  /**
   * The server's clock less this machine's when the academy was read, in milliseconds: the
   * academy's countdowns run on the server's time (C-7 C7-40).
   */
  academyOffsetMs: number;
  /** A report back and not yet looked at: the dot on the sidebar's academy entry. */
  academyUnseen: boolean;
  /**
   * The club's facilities (C-27c): the facilities page, whether the season builds them over time
   * (the navigation's entry), its build and its last completion (the entry's dot). `null` when
   * there is none to read (no club).
   */
  facilities: FacilitiesView | null | undefined;
  /** The server's clock less this machine's when the facilities were read, in milliseconds. */
  facilitiesOffsetMs: number;
  /** Bumped when the coach sees a completed build, so the dot reads its mark again. */
  facilitiesSeen: number;
  /**
   * The coach's events (C-7d): the events page and the dot on its sidebar entry. `null` when this
   * server has no events yet (an older server answers 404).
   */
  events: EventsView | null | undefined;
  /**
   * Rings of the club's scouting reports (C-24b) heard so far: a page showing a report reads it
   * again when this moves.
   */
  opponentReportRings: number;
  /** The notices in the corner, oldest first. */
  notices: OnlineNotice[];
  pushNotice: (notice: Omit<OnlineNotice, "id">) => void;
  dismissNotice: (id: number) => void;
  setFriendly: (friendly: FriendlyMineView) => void;
  setClub: (club: MyClubView | null) => void;
  /** The pictures the coach sent for his players, by player id (data URLs), read as they are needed. */
  playerPictures: Record<string, string>;
  setPlayerPictures: (pictures: Record<string, string>) => void;
  noteAnswered: () => void;
  noteFailure: (error: OnlineApiError) => void;
  reset: () => void;
}

const INITIAL = {
  gate: "open" as OnlineGate,
  network: "ok" as const,
  season: undefined,
  club: undefined,
  league: undefined,
  friendly: undefined,
  accountId: undefined,
  coins: undefined,
  items: undefined,
  academy: undefined,
  academyOffsetMs: 0,
  academyUnseen: false,
  facilities: undefined,
  facilitiesOffsetMs: 0,
  facilitiesSeen: 0,
  events: undefined,
  finance: undefined,
  market: undefined,
  marketUnseen: 0,
  opponentReportRings: 0,
  notices: [] as OnlineNotice[],
  playerPictures: {} as Record<string, string>,
};

const CLIENT_OUTDATED = "be.error.online.clientOutdated";
const SERVER_OUTDATED = "be.error.online.serverOutdated";
const UNREACHABLE = "be.error.online.unreachable";

export const useOnlineStore = create<OnlineState>((set) => ({
  ...INITIAL,
  setClub: (club) => set({ club }),
  setPlayerPictures: (playerPictures) => set({ playerPictures }),
  setFriendly: (friendly) => set({ friendly }),
  pushNotice: (notice) =>
    set((state) => ({
      notices: [...state.notices, { ...notice, id: nextNoticeId++ }].slice(-NOTICES_SHOWN),
    })),
  dismissNotice: (id) =>
    set((state) => ({ notices: state.notices.filter((notice) => notice.id !== id) })),
  noteAnswered: () => set({ network: "ok" }),
  noteFailure: (error) => {
    if (error.code === CLIENT_OUTDATED) set({ gate: "clientOutdated" });
    else if (error.code === SERVER_OUTDATED) set({ gate: "serverOutdated" });
    else if (error.code === UNREACHABLE) set({ network: "offline" });
    // Any other failure is an answer from the server: it is reachable.
    else if (error.status !== 0) set({ network: "ok" });
  },
  reset: () => set(INITIAL),
}));

/**
 * Run an online request and note what it says about the connection and the revision gate. A
 * failure is rethrown as an `OnlineApiError`.
 */
export async function tracked<T>(request: () => Promise<T>): Promise<T> {
  try {
    const value = await request();
    useOnlineStore.getState().noteAnswered();
    return value;
  } catch (rejection) {
    const error = toOnlineApiError(rejection);
    useOnlineStore.getState().noteFailure(error);
    throw error;
  }
}

/** A 404 means "there is none" for the shared views: no season, no club, no league. */
async function orNone<T>(request: () => Promise<T>): Promise<T | null> {
  try {
    return await tracked(request);
  } catch (error) {
    if ((error as OnlineApiError).status === 404) return null;
    throw error;
  }
}

export async function refreshSeason(): Promise<void> {
  const season = await orNone(() => online.season.now());
  useOnlineStore.setState({ season });
}

export async function refreshClub(): Promise<void> {
  const club = await orNone(() => online.clubs.mine());
  useOnlineStore.setState({ club });
}

export async function refreshLeague(): Promise<void> {
  const league = await orNone(() => online.leagues.mine());
  useOnlineStore.setState({ league });
}

export async function refreshFriendly(): Promise<void> {
  const friendly = await tracked(() => online.friendlies.mine());
  useOnlineStore.setState({ friendly });
}

export async function refreshFinance(): Promise<void> {
  const finance = await tracked(() => online.finance.mine());
  useOnlineStore.setState({ finance });
}

/** The coach's coins; a server without coins answers 404, which is `null` (C-7 C7-2). */
export async function refreshCoins(): Promise<void> {
  const coins = await orNone(() => online.coins.mine());
  useOnlineStore.setState({ coins });
}

/** The coach's items; a server without items answers 404, which is `null` (C-7 C7-2). */
export async function refreshItems(): Promise<void> {
  const items = await orNone(() => online.items.mine());
  useOnlineStore.setState({ items });
}

/** The coach's events; a server without events answers 404, which is `null` (C-7 C7-2). */
export async function refreshEvents(): Promise<EventsView | null> {
  const events = await orNone(() => online.events.mine());
  useOnlineStore.setState({ events });
  return events;
}

/**
 * The missions finished and waiting for their claim, in events still taking claims: the dot on
 * the sidebar's events entry (C-7 C7-57). Counted from the view, so it goes out when they are
 * claimed, and season-end missions, which never ring, count too.
 */
export function claimsWaiting(events: EventsView | null | undefined): number {
  if (!events) return 0;
  return events.events
    .filter((event) => event.state === "running" || event.state === "ended")
    .reduce(
      (waiting, event) =>
        waiting + event.missions.filter((mission) => mission.status === "completed").length,
      0,
    );
}

/**
 * Whether a step of the daily gift chain waits to be claimed, for the inventory's badge (C-19
 * C19-3): 1 while one is ready, or once the moment a step waits for has passed on this machine's
 * clock, so the badge lights up without a new read; else 0. The server still decides the claim.
 */
export function giftWaiting(items: InventoryView | null | undefined, now: number): number {
  const gift = items?.dailyGift;
  if (!gift) return 0;
  if (gift.available) return 1;
  const opens = gift.steps.find((step) => step.state === "waiting")?.opensAt;
  return opens !== undefined && Date.parse(opens) <= now ? 1 : 0;
}

/**
 * The club's academy, and how far the server's clock is from this one; no club (or a server
 * without the academy) answers 404, which is `null`.
 */
export async function refreshAcademy(): Promise<void> {
  const academy = await orNone(() => online.academy.view());
  useOnlineStore.setState(academyState(academy));
}

/** The store's academy and its clock offset, from an academy just read. */
export function academyState(academy: AcademyView | null): {
  academy: AcademyView | null;
  academyOffsetMs: number;
} {
  if (!academy) return { academy, academyOffsetMs: 0 };
  const server = Date.parse(academy.serverNow);
  return {
    academy,
    academyOffsetMs: Number.isNaN(server) ? 0 : server - Date.now(),
  };
}

/** The club's facilities, and how far the server's clock is; no club answers 404, `null`. */
export async function refreshFacilities(): Promise<void> {
  setFacilities(await orNone(() => online.finance.facilities()));
}

/** The store's facilities from a view just read or answered by a write, with its clock offset. */
export function setFacilities(facilities: FacilitiesView | null): void {
  const server = facilities?.serverNow ? Date.parse(facilities.serverNow) : Number.NaN;
  useOnlineStore.setState({
    facilities,
    facilitiesOffsetMs: Number.isNaN(server) ? 0 : server - Date.now(),
  });
}

/** The club on the market; a closed market is no failure, it is `null`. */
export async function refreshMarket(): Promise<void> {
  try {
    const market = await tracked(() => online.market.mine());
    useOnlineStore.setState({ market });
  } catch (error) {
    if ((error as OnlineApiError).code === "be.error.auction.marketClosed") {
      useOnlineStore.setState({ market: null });
      return;
    }
    throw error;
  }
}
