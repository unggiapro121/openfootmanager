import { create } from "zustand";
import type {
  FinanceView,
  FriendlyMineView,
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

/** One market notice in the corner of the screen (C-5 C5-14): what happened, to which auction. */
export interface MarketNotice {
  id: number;
  /** The ring's event (`outbid`, `won`, `sold`, `unsold`, `cancelled`, `forced`, or one this
   * build does not know). */
  event: string;
  auctionId?: string;
  playerName?: string;
  price?: number;
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
  /** The club's money (C-5): the header's cash and the finance page. */
  finance: FinanceView | undefined;
  /** The club on the market (C-5): `null` while the season's market is closed. */
  market: MyMarketView | null | undefined;
  /** Market rings not yet seen: the dot on the sidebar's market entry. */
  marketUnseen: number;
  /** The market notices in the corner, oldest first. */
  notices: MarketNotice[];
  pushNotice: (notice: Omit<MarketNotice, "id">) => void;
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
  finance: undefined,
  market: undefined,
  marketUnseen: 0,
  notices: [] as MarketNotice[],
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
