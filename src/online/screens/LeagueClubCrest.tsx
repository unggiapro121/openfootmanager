import { GeneratedCrest } from "../../components/ui/GeneratedCrest";
import type { ClubRef } from "../api";
import { useOnlineStore } from "../store/onlineStore";
import ClubCrestMark from "./ClubCrestMark";
import { crestLabel } from "./crestLabel";

/**
 * A league club's crest on a phone list: the coach's own drawn crest for their club, a crest
 * made from the name for the others (whose crests the league does not send).
 */
export default function LeagueClubCrest({
  club,
  mine,
  className,
}: {
  club: ClubRef;
  mine: boolean;
  className: string;
}) {
  const profile = useOnlineStore((state) => (mine ? state.club?.club : undefined));
  return (
    <span className={`shrink-0 ${className}`} aria-hidden="true">
      {profile ? (
        <ClubCrestMark profile={profile} />
      ) : (
        <GeneratedCrest name={club.name} label={crestLabel(club.name)} className="h-full w-full" />
      )}
    </span>
  );
}
