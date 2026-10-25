import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import PlayerProfileAttributesCard from "../../components/playerProfile/PlayerProfileAttributesCard";
import {
  buildPlayerAttributeGroups,
  isGoalkeeper,
} from "../../components/playerProfile/PlayerProfile.attributes";
import { translatePositionAbbreviation } from "../../components/squad/SquadTab.helpers";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CountryFlag,
  InjuryBadge,
  ProgressBar,
} from "../../components/ui";
import { positionGroupRank } from "../../lib/positions";
import type { SquadPlayerView } from "../api";
import { useOnlineStore } from "../store/onlineStore";
import ListingDialog from "./market/ListingDialog";
import PotentialStars from "./PotentialStars";

/** The squad as the coach reads it: by line, then strongest first (C-2 §3.4). */
export function sortSquad<P extends Pick<SquadPlayerView, "position" | "ovr" | "fullName">>(
  players: P[],
): P[] {
  return [...players].sort(
    (left, right) =>
      positionGroupRank(left.position) - positionGroupRank(right.position) ||
      right.ovr - left.ovr ||
      left.fullName.localeCompare(right.fullName),
  );
}

/**
 * The online squad (C-2 §3.4): the players of the coach's club and a card for the one picked.
 * There is no contract or value column; a player is put up for auction from his card (C-5 C5-9).
 */
export default function OnlineSquad() {
  const { t } = useTranslation();
  const players = useOnlineStore((state) => state.club?.players);
  const sorted = useMemo(() => sortSquad(players ?? []), [players]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = sorted.find((player) => player.id === selectedId) ?? sorted[0] ?? null;

  if (sorted.length === 0) {
    return <p className="text-sm text-gray-600 dark:text-gray-300">{t("online.squad.empty")}</p>;
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <Card>
        <CardHeader>{t("online.squad.title", { players: sorted.length })}</CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 text-xs uppercase text-gray-500 dark:border-navy-600 dark:text-gray-400">
              <tr>
                <th scope="col" className="px-2 py-2 text-right">
                  {t("squad.jerseyNumber")}
                </th>
                <th scope="col" className="px-4 py-2">
                  {t("common.name")}
                </th>
                <th scope="col" className="px-2 py-2">
                  {t("common.position")}
                </th>
                <th scope="col" className="px-2 py-2 text-right">
                  {t("common.age")}
                </th>
                <th scope="col" className="px-2 py-2 text-right">
                  {t("common.ovr")}
                </th>
                <th scope="col" className="px-2 py-2">
                  {t("online.squad.potential")}
                </th>
                <th scope="col" className="px-2 py-2 text-right">
                  {t("common.condition")}
                </th>
                <th scope="col" className="px-2 py-2 text-right">
                  {t("online.squad.apps")}
                </th>
                <th scope="col" className="px-2 py-2 text-right">
                  {t("online.squad.goals")}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((player) => (
                <SquadRow
                  key={player.id}
                  player={player}
                  selected={player.id === selected?.id}
                  onSelect={() => setSelectedId(player.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {selected && <OnlinePlayerCard player={selected} />}
    </div>
  );
}

function SquadRow({
  player,
  selected,
  onSelect,
}: {
  player: SquadPlayerView;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <tr
      aria-selected={selected}
      className={`border-b border-gray-100 dark:border-navy-600 ${
        selected ? "bg-primary-50 dark:bg-primary-500/10" : ""
      }`}
    >
      <td className="px-2 py-2 text-right tabular-nums text-gray-500 dark:text-gray-400">
        {player.shirtNumber ?? "–"}
      </td>
      <td className="px-4 py-2">
        <button
          type="button"
          onClick={onSelect}
          className="rounded text-left font-semibold text-gray-900 hover:text-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-gray-100 dark:hover:text-primary-400 dark:focus:ring-offset-navy-800"
        >
          {player.fullName}
        </button>
        {player.injury && (
          <span className="ml-2">
            <InjuryBadge
              injury={{ name: player.injury.name, days_remaining: player.injury.daysRemaining }}
              showName={false}
            />
          </span>
        )}
      </td>
      <td className="px-2 py-2">{translatePositionAbbreviation(t, player.naturalPosition)}</td>
      <td className="px-2 py-2 text-right">{player.age}</td>
      <td className="px-2 py-2 text-right font-heading font-bold">{player.ovr}</td>
      <td className="px-2 py-2">
        <PotentialStars stars={player.potentialStars} />
      </td>
      <td className="px-2 py-2 text-right">{player.condition}%</td>
      <td className="px-2 py-2 text-right">{player.season.appearances}</td>
      <td className="px-2 py-2 text-right">{player.season.goals}</td>
    </tr>
  );
}

/** One player of the online squad: who he is, how fit, his season, his attributes. */
function OnlinePlayerCard({ player }: { player: SquadPlayerView }) {
  const { t } = useTranslation();
  const profile = {
    attributes: player.attributes,
    natural_position: player.naturalPosition,
    position: player.position,
  };
  return (
    <div className="space-y-4">
      <Card accent="primary">
        <CardHeader>{player.fullName}</CardHeader>
        <CardBody className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
          <p className="flex items-center gap-2">
            <CountryFlag code={player.nationality} />
            {translatePositionAbbreviation(t, player.naturalPosition)} · {t("common.age")}{" "}
            {player.age}
          </p>
          <PotentialStars stars={player.potentialStars} />
          <Meter label={t("common.condition")} value={player.condition} />
          <Meter label={t("online.squad.fitness")} value={player.fitness} />
          <Meter label={t("common.morale")} value={player.morale} />
          {player.injury && (
            <InjuryBadge
              injury={{ name: player.injury.name, days_remaining: player.injury.daysRemaining }}
            />
          )}
          <ListingAction playerId={player.id} playerName={player.fullName} />
          <p>
            {t("online.squad.seasonLine", {
              apps: player.season.appearances,
              goals: player.season.goals,
              assists: player.season.assists,
              rating: player.season.avgRating.toFixed(1),
            })}
          </p>
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

/** The player's auction, when he is up for one, or the way to put him up (C5-9). */
function ListingAction({ playerId, playerName }: { playerId: string; playerName: string }) {
  const { t } = useTranslation();
  const market = useOnlineStore((state) => state.market);
  const [open, setOpen] = useState(false);
  if (!market) return null;
  const listed = market.selling.find((auction) => auction.playerId === playerId);
  if (listed) {
    return (
      <Link
        to={`/online/auctions/${listed.id}`}
        className="inline-block rounded font-semibold text-primary-600 hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-primary-400"
      >
        {t("online.market.listed")}
      </Link>
    );
  }
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t("online.market.list")}
      </Button>
      {open && (
        <ListingDialog playerId={playerId} playerName={playerName} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span>{label}</span>
        <span className="font-semibold">{value}%</span>
      </div>
      <ProgressBar value={value} variant="auto" size="sm" />
    </div>
  );
}
