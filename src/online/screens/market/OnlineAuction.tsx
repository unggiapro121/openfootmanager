import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useParams } from "react-router-dom";
import { AlertTriangle, Lock } from "lucide-react";
import PlayerProfileAttributesCard from "../../../components/playerProfile/PlayerProfileAttributesCard";
import {
  buildPlayerAttributeGroups,
  isGoalkeeper,
} from "../../../components/playerProfile/PlayerProfile.attributes";
import { translatePositionAbbreviation } from "../../../components/squad/SquadTab.helpers";
import { Button, Card, CardBody, CardHeader, CountryFlag } from "../../../components/ui";
import { formatExactMoney, formatVal, formatWeeklyAmount } from "../../../lib/valueFormatting";
import type { AuctionPlayerView, AuctionView } from "../../api";
import { online } from "../../client";
import { refreshMarket, tracked, useOnlineStore } from "../../store/onlineStore";
import ConfirmDialog from "../ConfirmDialog";
import PotentialStars from "../PotentialStars";
import { useActionKey } from "../useActionKey";
import { usePhoneLayout } from "../../../hooks/usePhoneLayout";
import PhoneAuction from "./phone/PhoneAuction";
import { useAuction } from "./useAuction";
import { bidProblem, CONFIRM_SHARE_OF_CASH, useBidSender } from "./useBid";
import { marketBack } from "./marketReturn";
import { marketErrorText, refusalText } from "./marketText";
import MoneyInput from "./MoneyInput";
import { ClubName, OwnLabels, PriceText, SellerName } from "./OnlineMarket";
import { useServerCountdown, useServerOffset } from "./useServerCountdown";

/** Why a cancelled auction closed, as the page names it (S-16 R16-10); any other is "cancelled". */
const CLOSED_REASONS: Record<string, string> = {
  buyCapExceeded: "online.market.result.capExceeded",
  playerGone: "online.market.result.playerGone",
};
/** Ratings by position shown beside the attributes. */
const RATINGS_SHOWN = 5;

/**
 * One auction (C-5 §3.5, C5-7, C5-8): the player, the price and who leads it, a countdown by the
 * server's clock, and the coach's bid or, for the seller, the withdrawal. While it is open the page
 * follows `auction:{id}` and reads the auction again on each newer notice.
 */
export default function OnlineAuction() {
  return usePhoneLayout() ? <PhoneAuction /> : <DesktopAuction />;
}

function DesktopAuction() {
  const { t, i18n } = useTranslation();
  const { auctionId = "" } = useParams();
  const { state } = useLocation();
  const { loaded, setView, load } = useAuction(auctionId);

  if (loaded.status === "loading") {
    return <p className="text-sm text-gray-500 dark:text-gray-400">{t("online.loading")}</p>;
  }
  if (loaded.status === "failed") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {marketErrorText(t, i18n.language, loaded.error)}
        </p>
        <Button variant="outline" size="sm" onClick={load}>
          {t("online.retry")}
        </Button>
      </div>
    );
  }
  const view = loaded.view;
  return (
    <div className="space-y-4">
      <Link
        to={marketBack(state)}
        className="rounded text-sm text-primary-600 hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-primary-400"
      >
        {t("online.market.back")}
      </Link>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        {view.player ? (
          <PlayerColumn player={view.player} />
        ) : (
          <Card>
            <CardBody>{t("online.market.retiredPlayer")}</CardBody>
          </Card>
        )}
        <AuctionColumn view={view} onView={setView} reload={load} />
      </div>
    </div>
  );
}

function PlayerColumn({ player }: { player: AuctionPlayerView }) {
  const { t } = useTranslation();
  const ratings = [...player.positionRatings].sort((a, b) => b.ovr - a.ovr).slice(0, RATINGS_SHOWN);
  return (
    <div className="space-y-4">
      <Card accent="primary">
        <CardHeader>{player.fullName}</CardHeader>
        <CardBody className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
          <p className="flex items-center gap-2">
            <CountryFlag code={player.nationality} />
            {translatePositionAbbreviation(t, player.naturalPosition)} · {t("common.age")}{" "}
            {player.age} · {t("common.ovr")} <strong>{player.ovr}</strong>
          </p>
          <PotentialStars stars={player.potentialStars} />
          <p>
            {t("common.wage")}:{" "}
            {formatWeeklyAmount(formatVal(player.wage), t("finances.perWeekSuffix"))}
          </p>
          {player.injuryDays !== undefined && (
            <p
              role="status"
              className="flex items-center gap-2 rounded bg-red-50 px-3 py-2 text-red-700 dark:bg-red-900/30 dark:text-red-300"
            >
              <AlertTriangle className="h-4 w-4" aria-hidden />
              {t("online.market.injured", { days: player.injuryDays })}
            </p>
          )}
          {ratings.length > 0 && (
            <ul aria-label={t("online.market.positionRatings")} className="flex flex-wrap gap-2">
              {ratings.map((rating) => (
                <li
                  key={rating.position}
                  className="rounded bg-gray-100 px-2 py-1 text-xs dark:bg-navy-700"
                >
                  {translatePositionAbbreviation(t, rating.position)} <strong>{rating.ovr}</strong>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <AuctionPlayerAttributes player={player} />
    </div>
  );
}

/** An auctioned player's attributes, as a list or a radar (the player profile's own card). */
export function AuctionPlayerAttributes({ player }: { player: AuctionPlayerView }) {
  const { t } = useTranslation();
  const profile = {
    attributes: player.attributes,
    natural_position: player.naturalPosition,
    position: player.position,
  };
  return (
    <PlayerProfileAttributesCard
      attrGroups={buildPlayerAttributeGroups(profile, t)}
      player={profile}
      isOwnClub
      isGk={isGoalkeeper(profile)}
      title={t("playerProfile.attributes")}
      ovr={player.ovr}
      ovrLabel={t("common.ovr")}
      averageLabel={t("common.average")}
      hiddenTitle={t("playerProfile.attributesHidden")}
      hiddenBody={t("playerProfile.scoutToView")}
      listLabel={t("common.listView")}
      radarLabel={t("common.radarView")}
    />
  );
}

function AuctionColumn({
  view,
  onView,
  reload,
}: {
  view: AuctionView;
  onView: (view: AuctionView) => void;
  reload: () => void;
}) {
  const { t } = useTranslation();
  const offset = useServerOffset(view.serverNow);
  const { text, millisLeft } = useServerCountdown(view.endsAt, offset);
  const clubId = useOnlineStore((state) => state.club?.club.id);
  const seller = view.sellerClubId === clubId;
  const softCloseSeconds = Math.round(view.softCloseMillis / 1000);

  return (
    <Card>
      <CardHeader>{t("online.market.auction")}</CardHeader>
      <CardBody className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
        <div className="flex flex-wrap items-center gap-2">
          <OwnLabels auction={view} />
          {view.forced && <span className="text-xs">{t("online.market.forced")}</span>}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          <dt>{t("online.market.price")}</dt>
          <dd className="text-right font-heading text-lg font-bold">
            <PriceText auction={view} />
          </dd>
          <dt>{t("online.market.leader")}</dt>
          <dd className="text-right">
            {view.leaderName ? (
              <ClubName name={view.leaderName} isBot={view.leaderIsBot} />
            ) : (
              t("online.market.noLeader")
            )}
          </dd>
          <dt>{t("online.market.bids")}</dt>
          <dd className="text-right">{view.bidsCount}</dd>
          <dt>{t("online.market.value")}</dt>
          <dd className="text-right">{formatExactMoney(view.marketValue)}</dd>
          <dt>{t("online.market.cap")}</dt>
          <dd className="text-right">{formatExactMoney(view.priceCap)}</dd>
          <dt>{t("online.market.seller")}</dt>
          <dd className="text-right">
            <SellerName auction={view} />
          </dd>
          {view.status === "active" && (
            <>
              <dt>{t("online.market.timeLeft")}</dt>
              <dd className="text-right font-semibold tabular-nums">
                {text ?? t("online.market.ending")}
              </dd>
            </>
          )}
        </dl>
        {view.status === "active" && millisLeft < view.softCloseMillis && (
          <p className="text-xs text-accent-700 dark:text-accent-400">
            {t("online.market.softClose", { seconds: softCloseSeconds })}
          </p>
        )}
        {view.mine !== undefined && (
          <p className="font-semibold text-primary-700 dark:text-primary-400">
            {t("online.market.youHold", { amount: formatExactMoney(view.mine) })}
          </p>
        )}
        {view.status === "active" ? (
          seller ? (
            <WithdrawPanel view={view} onView={onView} />
          ) : view.canBid === false ? (
            <LevelLock view={view} />
          ) : (
            <BidPanel view={view} onView={onView} reload={reload} />
          )
        ) : (
          <p role="status" className="font-semibold">
            {view.status === "settled"
              ? t("online.market.result.settled", {
                  club: view.leaderName ?? "",
                  price: formatExactMoney(view.currentPrice ?? view.startPrice),
                })
              : t(closedText(view))}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

/** The sentence of a closed auction that was not sold: unsold, or cancelled and why. */
export function closedText(view: AuctionView): string {
  if (view.status === "unsold") return "online.market.result.unsold";
  return CLOSED_REASONS[view.closedReason ?? ""] ?? "online.market.result.cancelled";
}

/**
 * In place of the bid when a level cap stops the coach (C-7 C7-11): the server's own refusal, the
 * two caps in a line, and the road to the level it needs. Only `canBid === false` locks: any other
 * check of a bid stays with the bid box and the server.
 */
export function LevelLock({ view }: { view: AuctionView }) {
  const { t, i18n } = useTranslation();
  return (
    <div
      role="note"
      className="space-y-2 rounded-lg border border-accent-300 bg-accent-50 p-3 dark:border-accent-500/40 dark:bg-accent-500/10"
    >
      <p className="flex items-start gap-2 font-semibold text-gray-900 dark:text-gray-100">
        <Lock
          className="mt-0.5 h-4 w-4 shrink-0 text-accent-700 dark:text-accent-400"
          aria-hidden
        />
        {view.bidRefusal
          ? refusalText(t, i18n.language, view.bidRefusal)
          : t("online.market.levelLock.badge", { level: view.requiredLevel ?? "" })}
      </p>
      <p className="text-xs">{t("online.market.levelLock.explain")}</p>
      <Link
        to="/online/profile"
        className="inline-block rounded text-xs font-semibold text-primary-600 hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-primary-400 dark:focus:ring-offset-navy-800"
      >
        {t("online.market.levelLock.roadmap")}
      </Link>
    </div>
  );
}

function BidPanel({
  view,
  onView,
  reload,
}: {
  view: AuctionView;
  onView: (view: AuctionView) => void;
  reload: () => void;
}) {
  const { t, i18n } = useTranslation();
  const cash = useOnlineStore((state) => state.finance?.cash);
  const atCap = view.currentPrice === view.priceCap;
  const [amount, setAmount] = useState<number | null>(view.minNextBid);
  const [asking, setAsking] = useState(false);
  const { send: sendBid, busy, error } = useBidSender(view, onView, reload);

  useEffect(() => setAmount(view.minNextBid), [view.minNextBid]);

  const problem = bidProblem(amount, view, cash);
  const needsConfirm =
    amount !== null &&
    (amount === view.priceCap || (cash !== undefined && amount >= cash * CONFIRM_SHARE_OF_CASH));

  const send = () => {
    if (amount === null) return;
    setAsking(false);
    sendBid(amount);
  };

  const quick = [
    { label: t("online.market.quick.least"), value: view.nextSteps[0] ?? view.minNextBid },
    { label: t("online.market.quick.step"), value: view.nextSteps[1] },
    { label: t("online.market.quick.cap"), value: view.priceCap },
  ].filter((choice): choice is { label: string; value: number } => choice.value !== undefined);

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (problem) return;
        if (needsConfirm) setAsking(true);
        else send();
      }}
    >
      {atCap ? (
        <p className="text-xs">{t("online.market.capTieExplain")}</p>
      ) : (
        <>
          <MoneyInput label={t("online.market.yourBid")} value={amount} onChange={setAmount} />
          <div className="flex flex-wrap gap-2">
            {quick.map((choice) => (
              <Button
                key={choice.label}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAmount(choice.value)}
              >
                {choice.label} · {formatVal(choice.value)}
              </Button>
            ))}
          </div>
        </>
      )}
      {problem && amount !== null && (
        <p className="text-xs text-red-600 dark:text-red-400">
          {t(`online.market.problem.${problem}`, {
            minimum: formatExactMoney(view.minNextBid),
            cap: formatExactMoney(view.priceCap),
            cash: formatExactMoney(cash ?? 0),
          })}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {marketErrorText(t, i18n.language, error)}
        </p>
      )}
      <Button type="submit" disabled={busy || problem !== null}>
        {atCap ? t("online.market.bidAtCap") : t("online.market.bid")}
      </Button>
      {asking && amount !== null && (
        <ConfirmDialog
          title={t("online.market.confirmTitle")}
          body={t("online.market.confirmBody", { amount: formatExactMoney(amount) })}
          confirm={t("online.market.confirmBid")}
          onCancel={() => setAsking(false)}
          onConfirm={send}
        />
      )}
    </form>
  );
}

export function WithdrawPanel({
  view,
  onView,
}: {
  view: AuctionView;
  onView: (view: AuctionView) => void;
}) {
  const { t, i18n } = useTranslation();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { run } = useActionKey();
  if (view.bidsCount > 0 || view.forced) {
    return <p className="text-xs">{t("online.market.sellerWaits")}</p>;
  }
  const withdraw = () => {
    setAsking(false);
    setBusy(true);
    setError(null);
    run((key) => tracked(() => online.market.withdraw(view.id, key)))
      .then((next) => {
        onView(next);
        void refreshMarket().catch(() => undefined);
      })
      .catch(setError)
      .finally(() => setBusy(false));
  };
  return (
    <div className="space-y-2">
      {error !== null && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {marketErrorText(t, i18n.language, error)}
        </p>
      )}
      <Button variant="outline" disabled={busy} onClick={() => setAsking(true)}>
        {t("online.market.withdraw")}
      </Button>
      {asking && (
        <ConfirmDialog
          title={t("online.market.withdrawTitle")}
          body={t("online.market.withdrawBody")}
          confirm={t("online.market.withdraw")}
          onCancel={() => setAsking(false)}
          onConfirm={withdraw}
        />
      )}
    </div>
  );
}
