import { create } from "zustand";
import type { LeagueView, MyClubView, SeasonNowView } from "../api";
import { online } from "../client";
import { type OnlineApiError, toOnlineApiError } from "../errors";

/**
 * The online mode's own state (phase 3 C-2, C2-3), apart from the offline `gameStore`: the
 * revision gate, whether the server answers, and the views every online screen shares. A view
 * is `undefined` until it is read, and `null` when the server says there is none (no club, no
 * league this season, no season).
 */
export type OnlineGate = "open" | "clientOutdated" | "serverOutdated";

interface OnlineState {
  gate: OnlineGate;
  /** `offline` after a request the server never answered, until one is answered again. */
  network: "ok" | "offline";
  season: SeasonNowView | null | undefined;
  club: MyClubView | null | undefined;
  league: LeagueView | null | undefined;
  setClub: (club: MyClubView | null) => void;
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
};

const CLIENT_OUTDATED = "be.error.online.clientOutdated";
const SERVER_OUTDATED = "be.error.online.serverOutdated";
const UNREACHABLE = "be.error.online.unreachable";

export const useOnlineStore = create<OnlineState>((set) => ({
  ...INITIAL,
  setClub: (club) => set({ club }),
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
