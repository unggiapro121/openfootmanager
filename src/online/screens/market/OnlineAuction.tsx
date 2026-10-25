import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import DashboardModalFrame from "../../../components/dashboard/DashboardModalFrame";
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
import { watchAuction } from "../../live";
import { refreshFinance, refreshMarket, tracked, useOnlineStore } from "../../store/onlineStore";
import PotentialStars from "../PotentialStars";
import { useActionKey } from "../useActionKey";
import { marketErrorText } from "./marketText";
import MoneyInput from "./MoneyInput";
import { ClubName, OwnLabels, PriceText, SellerName } from "./OnlineMarket";
import { useServerCountdown, useServerOffset } from "./useServerCountdown";

/** Codes after which the auction is read again: what the coach saw is out of date. */
const STALE_CODES = new Set(["be.error.auction.bidTooLow", "be.error.auction.listingExpired"]);
/** A bid of at least this share of the club's cash asks first (C5-8). */
const CONFIRM_SHARE_OF_CASH = 0.5;
/** Ratings by position shown beside the attributes. */
const RATINGS_SHOWN = 5;

type Loaded =
  | { status: "loading" }
  | { status: "failed"; error: unknown }
  | { status: "ready"; view: AuctionView };

/**
 * One auction (C-5 §3.5, C5-7, C5-8): the player, the price and who leads it, a countdown by the
 * server's clock, and the coach's bid or, for the seller, the withdrawal. While it is open the page
 * follows `auction:{id}` and reads the auction again on each newer notice.
 */
export default function OnlineAuction() {
  const { t, i18n } = useTranslation();
  const { auctionId = "" } = useParams();
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const lastSeq = useRef(0);

  const load = useCallback(() => {
    tracked(() => online.market.byId(auctionId))
      .then((view) => setLoaded({ status: "ready", view }))
      .catch((error: unknown) =>
        setLoaded((current) =>
          current.status === "ready" ? current : { status: "failed", error },
        ),
      );
  }, [auctionId]);

  useEffect(() => {
    setLoaded({ status: "loading" });
    lastSeq.current = 0;
    load();
  }, [load]);

  const active = loaded.status === "ready" && loaded.view.status === "active";
  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    let stop: (() => Promise<void>) | undefined;
    watchAuction(auctionId, (notice) => {
      if (notice.seq <= lastSeq.current) return;
      lastSeq.current = notice.seq;
      load();
    })
      .then((stopWatching) => {
        if (live) stop = stopWatching;
        else void stopWatching();
      })
      .catch(() => undefined);
    return () => {
      live = false;
      void stop?.();
    };
  }, [active, auctionId, load]);

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
        to="/online/market"
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
        <AuctionColumn
          view={view}
          onView={(next) => setLoaded({ status: "ready", view: next })}
          reload={load}
        />
      </div>
    </div>
  );
}

function PlayerColumn({ player }: { player: AuctionPlayerView }) {
  const { t } = useTranslation();
  const profile = {
    attributes: player.attributes,
    natural_position: player.naturalPosition,
    position: player.position,
  };
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
    </div>
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
              : t(`online.market.result.${view.status === "unsold" ? "unsold" : "cancelled"}`)}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

/** Why a bid would be refused before it is sent: the server still decides (C-5 §3.5). */
function bidProblem(amount: number | null, view: AuctionView, cash: number | undefined) {
  if (amount === null || !Number.isInteger(amount)) return "invalid";
  if (amount < view.minNextBid) return "tooLow";
  if (amount > view.priceCap) return "overCap";
  if (cash !== undefined && amount > cash) return "overCash";
  return null;
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { run } = useActionKey();

  useEffect(() => setAmount(view.minNextBid), [view.minNextBid]);

  const problem = bidProblem(amount, view, cash);
  const needsConfirm =
    amount !== null &&
    (amount === view.priceCap || (cash !== undefined && amount >= cash * CONFIRM_SHARE_OF_CASH));

  const send = () => {
    if (amount === null) return;
    setAsking(false);
    setBusy(true);
    setError(null);
    run((key) => tracked(() => online.market.bid(view.id, amount, key)), String(amount))
      .then((next) => {
        onView(next);
        void refreshFinance().catch(() => undefined);
        void refreshMarket().catch(() => undefined);
      })
      .catch((failure: { code?: string }) => {
        setError(failure);
        if (failure.code && STALE_CODES.has(failure.code)) reload();
      })
      .finally(() => setBusy(false));
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

function WithdrawPanel({
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

/** A yes-or-no question over the page, in the dashboard's modal frame. */
function ConfirmDialog({
  title,
  body,
  confirm,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirm: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DashboardModalFrame maxWidthClassName="max-w-md">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="online-confirm-title"
        className="space-y-4"
      >
        <h3
          id="online-confirm-title"
          className="font-heading text-lg font-bold text-gray-900 dark:text-gray-100"
        >
          {title}
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-300">{body}</p>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button type="button" size="sm" onClick={onConfirm}>
            {confirm}
          </Button>
        </div>
      </div>
    </DashboardModalFrame>
  );
}
