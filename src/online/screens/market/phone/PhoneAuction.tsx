import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useParams } from "react-router-dom";
import { AlertTriangle, ChevronLeft, Lock } from "lucide-react";
import { translatePositionAbbreviation } from "../../../../components/squad/SquadTab.helpers";
import { CountryFlag, PlayerAvatar } from "../../../../components/ui";
import { countryName } from "../../../../lib/countries";
import { formatExactMoney, formatVal, formatWeeklyAmount } from "../../../../lib/valueFormatting";
import type { AuctionPlayerView, AuctionView } from "../../../api";
import { useOnlineStore } from "../../../store/onlineStore";
import { PhoneHeaderPart } from "../../mobile/PhoneHeaderSlots";
import { FOCUS } from "../../mobile/PhoneSheet";
import PotentialStars from "../../PotentialStars";
import { avatarOf } from "../../squad/playerLook";
import { marketBack } from "../marketReturn";
import { marketErrorText } from "../marketText";
import { AuctionPlayerAttributes, closedText, LevelLock, WithdrawPanel } from "../OnlineAuction";
import { ClubName, SellerName } from "../OnlineMarket";
import { useAuction } from "../useAuction";
import { useServerCountdown, useServerOffset } from "../useServerCountdown";
import { KEY, TimerChip } from "./AuctionCard";
import { PhoneBidSheet } from "./PhoneBidSheet";
import { onTablistKeyDown, tabIndexOf } from "../../mobile/tablistKeys";

/** Ratings by position shown under the player. */
const RATINGS_SHOWN = 5;
type DetailTab = "auction" | "stats";

/**
 * One auction on a phone (design m-cho-chi-tiet): the player on top, then the auction or his
 * attributes on two tabs, and a bar over the tab bar with the least bid and the button that opens
 * the bid sheet. The seller gets the withdrawal in place of the bar.
 */
export default function PhoneAuction() {
  const { t, i18n } = useTranslation();
  const { auctionId = "" } = useParams();
  const { state } = useLocation();
  const { loaded, setView, load } = useAuction(auctionId);

  return (
    <div className="-mx-3 -mt-3">
      <PhoneHeaderPart place="below">
        <div className="flex items-center border-t border-gray-200 pl-1 pr-2 dark:border-navy-700">
          <Link
            to={marketBack(state)}
            className={`flex h-11 items-center gap-0.5 rounded-full pl-1 pr-2.5 text-sm font-semibold text-gray-700 dark:text-gray-200 ${FOCUS}`}
          >
            <ChevronLeft className="h-5.5 w-5.5" aria-hidden="true" />
            {t("online.nav.market")}
          </Link>
        </div>
      </PhoneHeaderPart>
      {loaded.status === "loading" && (
        <p className="px-4 pt-4 text-sm text-gray-500 dark:text-gray-400">{t("online.loading")}</p>
      )}
      {loaded.status === "failed" && (
        <div className="flex flex-col items-start gap-3 px-4 pt-4">
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {marketErrorText(t, i18n.language, loaded.error)}
          </p>
          <button
            type="button"
            onClick={load}
            className={`rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-800 dark:border-navy-700 dark:bg-navy-800 dark:text-gray-200 ${FOCUS}`}
          >
            {t("online.retry")}
          </button>
        </div>
      )}
      {loaded.status === "ready" && (
        <AuctionPage view={loaded.view} onView={setView} reload={load} />
      )}
    </div>
  );
}

function AuctionPage({
  view,
  onView,
  reload,
}: {
  view: AuctionView;
  onView: (view: AuctionView) => void;
  reload: () => void;
}) {
  const { t } = useTranslation();
  const clubId = useOnlineStore((state) => state.club?.club.id);
  const offset = useServerOffset(view.serverNow);
  const [tab, setTab] = useState<DetailTab>("auction");
  const [bidding, setBidding] = useState(false);
  const seller = view.sellerClubId === clubId;
  const withBar = view.status === "active" && !seller;

  return (
    <div className={withBar ? "pb-24" : "pb-6"}>
      {view.player ? (
        <PlayerHero player={view.player} playerId={view.playerId} auction={view} />
      ) : (
        <h2 className="px-4 pt-4 font-heading text-xl font-bold text-gray-900 dark:text-white">
          {t("online.market.retiredPlayer")}
        </h2>
      )}
      <div
        role="tablist"
        onKeyDown={onTablistKeyDown}
        aria-label={t(`${KEY}.detailTabs`)}
        className="grid grid-cols-2 border-b border-gray-200 px-4 dark:border-navy-700"
      >
        {(["auction", "stats"] as const).map((id) => {
          const on = id === tab;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={on}
              tabIndex={tabIndexOf(on)}
              onClick={() => setTab(id)}
              className={`-mb-px h-11 border-b-2 font-heading text-[15px] font-bold uppercase tracking-wider ${on ? "border-primary-500 text-gray-900 dark:text-white" : "border-transparent text-gray-500 dark:text-gray-400"} ${FOCUS}`}
            >
              {t(id === "auction" ? `${KEY}.tabAuction` : `${KEY}.tabStats`)}
            </button>
          );
        })}
      </div>
      <div className="px-4 pt-3">
        {tab === "auction" ? (
          <AuctionPanel
            view={view}
            offset={offset}
            seller={seller}
            clubId={clubId}
            onView={onView}
          />
        ) : view.player ? (
          <AuctionPlayerAttributes player={view.player} />
        ) : null}
      </div>
      {withBar && <BidBar view={view} clubId={clubId} onBid={() => setBidding(true)} />}
      {bidding && withBar && view.canBid !== false && (
        <PhoneBidSheet
          view={view}
          offset={offset}
          onView={onView}
          reload={reload}
          onClose={() => setBidding(false)}
        />
      )}
    </div>
  );
}

/** The player as the design's head card: face, name, nation and age, potential, overall. */
function PlayerHero({
  player,
  playerId,
  auction,
}: {
  player: AuctionPlayerView;
  playerId: string;
  auction: AuctionView;
}) {
  const { t, i18n } = useTranslation();
  const ratings = [...player.positionRatings].sort((a, b) => b.ovr - a.ovr).slice(0, RATINGS_SHOWN);
  return (
    <div className="flex flex-col gap-3 px-4 pb-3 pt-4">
      <div className="flex items-center gap-3">
        <PlayerAvatar
          player={avatarOf({
            id: playerId,
            fullName: player.fullName,
            matchName: player.fullName,
            nationality: player.nationality,
            avatarSeed: player.avatarSeed,
          })}
          className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gray-200 font-heading text-xl font-bold text-gray-700 dark:bg-navy-700 dark:text-white"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="truncate font-heading text-[22px] font-bold leading-tight text-gray-900 dark:text-white">
            {player.fullName}
          </h2>
          <p className="flex items-center gap-1.5 text-[13px] text-gray-600 dark:text-gray-300">
            <CountryFlag
              code={player.nationality}
              locale={i18n.language}
              className="text-sm leading-none"
            />
            <span className="truncate">
              {countryName(player.nationality, i18n.language)} ·{" "}
              {t(`${KEY}.age`, { age: player.age })}
            </span>
          </p>
          <p className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <PotentialStars stars={player.potentialStars} />
            {t("online.squad.potential")}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-center rounded-xl border border-gray-200 bg-white px-3 py-1 dark:border-navy-700 dark:bg-navy-800">
          <span className="text-[10px] tracking-widest text-gray-500 dark:text-gray-400">
            {t("common.ovr")}
          </span>
          <span className="font-heading text-[30px] font-bold leading-none text-primary-600 dark:text-primary-400">
            {player.ovr}
          </span>
        </div>
      </div>
      {ratings.length > 0 && (
        <ul aria-label={t("online.market.positionRatings")} className="flex flex-wrap gap-1.5">
          {ratings.map((rating, index) => (
            <li
              key={rating.position}
              className={`rounded-lg border px-2 py-1 text-xs text-gray-700 dark:text-gray-200 ${index === 0 ? "border-primary-300 bg-primary-50 dark:border-primary-800 dark:bg-primary-900/40" : "border-gray-200 bg-white dark:border-navy-700 dark:bg-navy-800"}`}
            >
              {translatePositionAbbreviation(t, rating.position)}{" "}
              <strong className="font-heading">{rating.ovr}</strong>
            </li>
          ))}
        </ul>
      )}
      <p className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[13px] text-gray-600 dark:text-gray-300">
        <span>
          {t("common.wage")}{" "}
          <strong className="text-gray-900 dark:text-white">
            {formatWeeklyAmount(formatVal(player.wage), t("finances.perWeekSuffix"))}
          </strong>
        </span>
        <span className="truncate">
          {t("online.market.seller")}: <SellerName auction={auction} />
        </span>
      </p>
      {player.injuryDays !== undefined && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300"
        >
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          {t("online.market.injured", { days: player.injuryDays })}
        </p>
      )}
    </div>
  );
}

/** Where the start, the valuation and the price stand between the start and the cap. */
function share(value: number, view: AuctionView): string {
  const span = view.priceCap - view.startPrice;
  const at = span > 0 ? ((value - view.startPrice) / span) * 100 : 100;
  return `${Math.max(0, Math.min(100, at)).toFixed(1)}%`;
}

/** The lead line of the auction card: who stands where, from the coach's side. */
function leadOf(view: AuctionView, clubId: string | undefined): { label: string; tone: string } {
  const good = "bg-primary-100 text-primary-800 dark:bg-primary-900/50 dark:text-primary-300";
  if (view.status === "settled") {
    return view.winnerClubId === clubId
      ? { label: "online.market.standing.bought", tone: good }
      : {
          label: "online.market.standing.lost",
          tone: "bg-gray-100 text-gray-700 dark:bg-navy-700 dark:text-gray-200",
        };
  }
  if (view.leaderClubId === clubId && clubId) return { label: "online.market.youLead", tone: good };
  if (view.mine !== undefined)
    return {
      label: `${KEY}.outbid`,
      tone: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300",
    };
  if (view.bidsCount > 0)
    return {
      label: `${KEY}.someoneBid`,
      tone: "bg-accent-100 text-accent-800 dark:bg-accent-900/40 dark:text-accent-300",
    };
  return {
    label: "online.market.noLeader",
    tone: "bg-gray-100 text-gray-600 dark:bg-navy-700 dark:text-gray-300",
  };
}

function AuctionPanel({
  view,
  offset,
  seller,
  clubId,
  onView,
}: {
  view: AuctionView;
  offset: number;
  seller: boolean;
  clubId: string | undefined;
  onView: (view: AuctionView) => void;
}) {
  const { t } = useTranslation();
  const { millisLeft } = useServerCountdown(view.endsAt, offset);
  const price = view.currentPrice ?? view.startPrice;
  const lead = leadOf(view, clubId);
  const active = view.status === "active";
  const [least, next] = view.nextSteps;
  const step = least !== undefined && next !== undefined ? next - least : undefined;

  return (
    <section
      aria-label={t("online.market.auction")}
      className="flex flex-col gap-3 rounded-[14px] border border-gray-200 bg-white p-3.5 dark:border-navy-700 dark:bg-navy-800"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-heading text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {t("online.market.auction")}
        </h3>
        <TimerChip endsAt={view.endsAt} offset={offset} active={active} />
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {t(view.currentPrice === undefined ? `${KEY}.startPrice` : `${KEY}.currentPrice`)}
          </span>
          <span className="font-heading text-[28px] font-bold leading-none tabular-nums text-gray-900 dark:text-white">
            {formatExactMoney(price)}
          </span>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${lead.tone}`}>
          {t(lead.label)}
        </span>
      </div>
      <div
        role="img"
        aria-label={t(`${KEY}.range`, {
          price: formatVal(price),
          start: formatVal(view.startPrice),
          cap: formatVal(view.priceCap),
          value: formatVal(view.marketValue),
        })}
        className="flex flex-col gap-1"
      >
        <div className="relative h-2 rounded-full bg-gray-200 dark:bg-navy-900">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-primary-500"
            style={{ width: share(price, view) }}
          />
          <div
            className="absolute -top-1 h-4 w-0.5 bg-accent-500"
            style={{ left: share(view.marketValue, view) }}
          />
        </div>
        <div
          className="flex justify-between text-[11px] text-gray-500 dark:text-gray-400"
          aria-hidden="true"
        >
          <span>{t(`${KEY}.start`, { price: formatVal(view.startPrice) })}</span>
          <span className="text-accent-700 dark:text-accent-400">
            {t(`${KEY}.valuation`, { price: formatVal(view.marketValue) })}
          </span>
          <span>{t(`${KEY}.cap`, { price: formatVal(view.priceCap) })}</span>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-lg bg-gray-50 px-1 py-1.5 dark:bg-navy-900">
          <dt className="text-[11px] text-gray-500 dark:text-gray-400">
            {t("online.market.bids")}
          </dt>
          <dd className="font-heading text-base font-bold text-gray-900 dark:text-white">
            {view.bidsCount}
          </dd>
        </div>
        <div className="rounded-lg bg-gray-50 px-1 py-1.5 dark:bg-navy-900">
          <dt className="text-[11px] text-gray-500 dark:text-gray-400">{t(`${KEY}.step`)}</dt>
          <dd className="font-heading text-base font-bold text-gray-900 dark:text-white">
            {step === undefined ? "–" : formatVal(step)}
          </dd>
        </div>
        <div className="col-span-2 min-w-0 rounded-lg bg-gray-50 px-2 py-1.5 dark:bg-navy-900">
          <dt className="text-[11px] text-gray-500 dark:text-gray-400">
            {t("online.market.leader")}
          </dt>
          <dd className="truncate text-sm font-semibold text-gray-900 dark:text-white">
            {view.leaderName ? <ClubName name={view.leaderName} isBot={view.leaderIsBot} /> : "–"}
          </dd>
        </div>
      </dl>
      {active && millisLeft < view.softCloseMillis && (
        <p className="text-xs text-accent-800 dark:text-accent-300">
          {t("online.market.softClose", { seconds: Math.round(view.softCloseMillis / 1000) })}
        </p>
      )}
      {view.forced && (
        <p className="text-xs text-gray-600 dark:text-gray-300">{t("online.market.forced")}</p>
      )}
      {view.mine !== undefined && (
        <p className="text-sm font-semibold text-primary-700 dark:text-primary-400">
          {t("online.market.youHold", { amount: formatExactMoney(view.mine) })}
        </p>
      )}
      {!active && (
        <p role="status" className="text-sm font-semibold text-gray-900 dark:text-white">
          {view.status === "settled"
            ? t("online.market.result.settled", {
                club: view.leaderName ?? "",
                price: formatExactMoney(price),
              })
            : t(closedText(view))}
        </p>
      )}
      {active && seller && <WithdrawPanel view={view} onView={onView} />}
      {active && !seller && view.canBid === false && <LevelLock view={view} />}
    </section>
  );
}

/** The bar over the tab bar: the least the coach may bid now, and the button to bid. */
function BidBar({
  view,
  clubId,
  onBid,
}: {
  view: AuctionView;
  clubId: string | undefined;
  onBid: () => void;
}) {
  const { t } = useTranslation();
  const leading = view.leaderClubId === clubId && clubId !== undefined;
  const locked = view.canBid === false;
  return (
    <section
      aria-label={t(`${KEY}.bidBar`)}
      className="fixed inset-x-0 bottom-[calc(3.5rem+1px+var(--safe-bottom))] z-30 flex items-center gap-3 border-t border-gray-200 bg-white/95 px-4 py-2.5 backdrop-blur dark:border-navy-700 dark:bg-navy-800/95"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[11px] text-gray-500 dark:text-gray-400">
          {t(leading ? `${KEY}.nextWhileLeading` : `${KEY}.leastBid`)}
        </span>
        <span className="font-heading text-lg font-bold tabular-nums text-gray-900 dark:text-white">
          {formatExactMoney(view.minNextBid)}
        </span>
      </div>
      {locked ? (
        <button
          type="button"
          disabled
          className="flex h-12 shrink-0 items-center gap-1.5 rounded-xl bg-gray-200 px-5 font-heading text-base font-bold uppercase tracking-wider text-gray-500 disabled:cursor-not-allowed dark:bg-navy-700 dark:text-gray-400"
        >
          <Lock className="h-4 w-4" aria-hidden="true" />
          {t(`${KEY}.locked`)}
        </button>
      ) : (
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={onBid}
          className={`h-12 shrink-0 rounded-xl bg-primary-700 px-6 font-heading text-base font-bold uppercase tracking-wider text-white dark:bg-primary-600 ${FOCUS}`}
        >
          {t(leading ? `${KEY}.raise` : "online.market.bid")}
        </button>
      )}
    </section>
  );
}
