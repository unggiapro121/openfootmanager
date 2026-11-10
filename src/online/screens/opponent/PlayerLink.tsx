import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { MyClubView } from "../../api";
import { useOnlineStore } from "../../store/onlineStore";
import { playerHref } from "./opponentView";

export const LINK =
  "rounded font-semibold text-primary-700 hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-primary-400 dark:focus:ring-offset-navy-800";

/** The coach's club, for the links to his own players and his side of the comparison. */
export function useMyClub(): MyClubView | null {
  return useOnlineStore((state) => state.club) ?? null;
}

/** A player's name as a link: the coach's own to his squad page, anyone else's to the public one. */
export function PlayerLink({
  id,
  className = LINK,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  const myClub = useMyClub();
  return (
    <Link to={playerHref(id, myClub)} className={className}>
      {children}
    </Link>
  );
}
