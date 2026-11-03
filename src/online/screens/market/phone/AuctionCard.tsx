import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { Clock, Lock } from "lucide-react";
import { translatePositionAbbreviation } from "../../../../components/squad/SquadTab.helpers";
import { CountryFlag, PlayerAvatar } from "../../../../components/ui";
import { positionBadgeVariant } from "../../../../lib/playerRating";
import { formatVal } from "../../../../lib/valueFormatting";
import type { AuctionView } from "../../../api";
import { useOnlineStore } from "../../../store/onlineStore";
import { FOCUS } from "../../mobile/PhoneSheet";
import PotentialStars from "../../PotentialStars";
import { avatarOf } from "../../squad/playerLook";
import { fromMarket } from "../marketReturn";
import { useServerCountdown } from "../useServerCountdown";

export const KEY = "online.market.phone";
/** Under two minutes left the clock turns red; under ten, amber. */
const URGENT_MILLIS = 120_000;
const SOON_MILLIS = 600_000;

const POSITION_TONE = {
  accent: "bg-accent-100 text-accent-800 dark:bg-accent-900/60 dark:text-accent-300",
  primary: "bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300",
  success: "bg-primary-100 text-primary-800 dark:bg-primary-900/60 dark:text-primary-300",
  danger: "bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-300",
};

/** An auction's countdown on the server's clock, its colour by how near the end is. */
export function TimerChip({
  endsAt,
  offset,
  active,
}: {
  endsAt: string;
  offset: number;
  active: boolean;
}) {
  const { t } = useTranslation();
  const { text, millisLeft } = useServerCountdown(endsAt, offset);
  const tone = !active
    ? "bg-gray-100 text-gray-500 dark:bg-navy-700 dark:text-gray-400"
    : millisLeft < URGENT_MILLIS
      ? "bg-red-100 text-red-700 motion-safe:animate-pulse dark:bg-red-900/50 dark:text-red-300"
      : millisLeft < SOON_MILLIS
        ? "bg-accent-100 text-accent-800 dark:bg-accent-900/40 dark:text-accent-300"
        : "bg-gray-100 text-gray-700 dark:bg-navy-900 dark:text-gray-200";
  return (
    <span
      role="timer"
      aria-live="off"
      className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[13px] font-bold tabular-nums ${tone}`}
    >
      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
      {active ? (text ?? t("online.market.ending")) : t(`${KEY}.ended`)}
    </span>
  );
}

export type StandingTone = "good" | "bad" | "neutral";
export interface Standing {
  label: string;
  tone: StandingTone;
}

const STANDING_CHIP: Record<StandingTone, string> = {
  good: "bg-primary-100 text-primary-800 dark:bg-primary-900/50 dark:text-primary-300",
  bad: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300",
  neutral: "bg-gray-100 text-gray-700 dark:bg-navy-700 dark:text-gray-200",
};
const STANDING_BORDER: Record<StandingTone, string> = {
  good: "border-primary-300 dark:border-primary-800",
  bad: "border-red-300 dark:border-red-900",
  neutral: "border-gray-200 dark:border-navy-700",
};

/** Where the coach's club stands in an auction of the open market, if it stands anywhere. */
function ownStanding(auction: AuctionView, clubId: string | undefined): Standing | null {
  if (!clubId) return null;
  if (auction.sellerClubId === clubId) return { label: "online.market.yourClub", tone: "neutral" };
  if (auction.leaderClubId === clubId) return { label: "online.market.youLead", tone: "good" };
  if (auction.mine !== undefined) return { label: `${KEY}.outbid`, tone: "bad" };
  return null;
}

/**
 * One auction as a card (design m-cho): the player's face and position, name and flag, age and
 * potential, overall; then the price, the bids, where the club stands, and the time left. The
 * card opens the auction. `standing` overrides the club's place (the coach's own lists).
 */
export function AuctionCard({
  auction,
  offset,
  standing,
}: {
  auction: AuctionView;
  offset: number;
  standing?: Standing;
}) {
  const { t } = useTranslation();
  const { search } = useLocation();
  const clubId = useOnlineStore((state) => state.club?.club.id);
  const player = auction.player;
  const own = standing ?? ownStanding(auction, clubId);
  const price = auction.currentPrice ?? auction.startPrice;
  const name = player?.fullName ?? t("online.market.retiredPlayer");
  const ovr = player?.ovr ?? 0;
  const border = STANDING_BORDER[own?.tone ?? "neutral"];
  return (
    <Link
      to={`/online/auctions/${auction.id}`}
      state={fromMarket(search)}
      className={`flex flex-col gap-2.5 rounded-[14px] border bg-white px-3 py-2.5 dark:bg-navy-800 ${border} ${FOCUS}`}
    >
      <span className="flex items-center gap-2.5">
        <span className="relative shrink-0">
          {player && (
            <PlayerAvatar
              player={avatarOf({
                id: auction.playerId,
                fullName: player.fullName,
                matchName: player.fullName,
                nationality: player.nationality,
                avatarSeed: player.avatarSeed,
              })}
              className="flex h-[46px] w-[46px] items-center justify-center overflow-hidden rounded-xl bg-gray-200 font-heading font-bold text-gray-700 dark:bg-navy-700 dark:text-white"
            />
          )}
          {player && (
            <span
              className={`absolute -bottom-1 left-1/2 -translate-x-1/2 rounded px-1 font-heading text-[10px] font-bold leading-[14px] ${POSITION_TONE[positionBadgeVariant(player.naturalPosition)]}`}
            >
              {translatePositionAbbreviation(t, player.naturalPosition)}
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[15px] font-bold text-gray-900 dark:text-white">
              {name}
            </span>
            {player && (
              <CountryFlag code={player.nationality} className="shrink-0 text-sm leading-none" />
            )}
          </span>
          {player && (
            <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              {t(`${KEY}.age`, { age: player.age })}
              <PotentialStars stars={player.potentialStars} />
            </span>
          )}
        </span>
        <span className="flex shrink-0 flex-col items-center rounded-lg bg-gray-100 px-2 py-0.5 dark:bg-navy-900">
          <span className="text-[9px] tracking-widest text-gray-500 dark:text-gray-400">
            {t("common.ovr")}
          </span>
          <span
            className={`font-heading text-[22px] font-bold leading-none ${ovr >= 75 ? "text-primary-600 dark:text-primary-400" : ovr >= 58 ? "text-accent-700 dark:text-accent-400" : "text-gray-500 dark:text-gray-400"}`}
          >
            {player?.ovr ?? "–"}
          </span>
        </span>
      </span>
      <span className="flex items-center gap-2 border-t border-gray-200 pt-2 dark:border-navy-700">
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {t(auction.currentPrice === undefined ? `${KEY}.startPrice` : `${KEY}.currentPrice`)}
          </span>
          <span className="font-heading text-lg font-bold tabular-nums text-gray-900 dark:text-white">
            {formatVal(price)}{" "}
            <span className="font-sans text-[11px] font-medium text-gray-500 dark:text-gray-400">
              · {t(`${KEY}.bidCount`, { count: auction.bidsCount })}
            </span>
          </span>
        </span>
        {auction.canBid === false && (
          <Lock
            className="h-4 w-4 shrink-0 text-accent-600 dark:text-accent-400"
            aria-label={t("online.market.levelLock.badge", { level: auction.requiredLevel ?? "" })}
          />
        )}
        {own && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${STANDING_CHIP[own.tone]}`}
          >
            {t(own.label)}
          </span>
        )}
        <TimerChip endsAt={auction.endsAt} offset={offset} active={auction.status === "active"} />
      </span>
    </Link>
  );
}
