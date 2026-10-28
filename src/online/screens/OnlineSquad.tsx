import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, Users } from "lucide-react";
import { TraitList } from "../../components/TraitBadge";
import ShirtNumberPicker from "./squad/ShirtNumberPicker";
import { translatePositionAbbreviation } from "../../components/squad/SquadTab.helpers";
import { PlayerPositionBadges } from "../../components/squad/PlayerPositionBadges";
import {
  Badge,
  Button,
  Card,
  CountryFlag,
  InjuryBadge,
  PlayerAvatar,
  Select,
  SortHeader,
} from "../../components/ui";
import { condColor } from "../../lib/playerConditionDisplay";
import type { SquadPlayerView } from "../api";
import { useOnlineStore } from "../store/onlineStore";
import PotentialStars from "./PotentialStars";
import { avatarOf } from "./squad/playerLook";
import { fitRank, type PlayerFit, squadFits } from "./squad/squadFit";
import {
  byLine,
  matchesFilter,
  NO_FILTER,
  type SquadFilter,
  type SquadGroup,
  type SquadScope,
  type SquadSort,
  type SquadSortKey,
  sortedBy,
} from "./squad/squadList";
import ItemShortcuts from "./items/ItemShortcuts";

/** The squad as the coach reads it: by line, then strongest first (C-2 §3.4). */
export const sortSquad = byLine;

const GROUPS: SquadGroup[] = ["Goalkeeper", "Defender", "Midfielder", "Forward"];
const SCOPES: Array<{ scope: SquadScope; label: string }> = [
  { scope: "all", label: "common.allPlayers" },
  { scope: "xi", label: "preMatch.startingXI" },
  { scope: "bench", label: "preMatch.substitutes" },
  { scope: "injured", label: "common.injured" },
];

const LABEL =
  "mb-2 block font-heading text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400";
const TH =
  "px-4 py-2.5 font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400";

/**
 * The online squad, laid out as the offline one is (C-2 §3.4): a toolbar to search and to filter by
 * line and by status, with the count of each, then the table, each column sortable. A row opens the
 * player's own page.
 */
export default function OnlineSquad() {
  const { t } = useTranslation();
  const club = useOnlineStore((state) => state.club);
  const [filter, setFilter] = useState<SquadFilter>(NO_FILTER);
  const [sort, setSort] = useState<SquadSort>({ key: null, dir: "asc" });
  const players = club?.players;
  const eleven = useMemo(() => new Set(club?.setup.startingXiIds ?? []), [club?.setup]);
  const fits = useMemo(() => (club ? squadFits(club) : new Map<string, PlayerFit>()), [club]);
  const shown = useMemo(
    () =>
      sortedBy(players ?? [], sort, {
        fit: (player) => fitRank(fits.get(player.id), "fit"),
        style: (player) => fitRank(fits.get(player.id), "style"),
      }).filter((player) => matchesFilter(player, filter, eleven)),
    [players, sort, filter, eleven, fits],
  );

  if (!club || (players?.length ?? 0) === 0) {
    return <p className="text-sm text-gray-600 dark:text-gray-300">{t("online.squad.empty")}</p>;
  }
  const all = players ?? [];
  const starters = all.filter((player) => eleven.has(player.id)).length;
  const hurt = all.filter((player) => player.injury !== undefined).length;
  const filtered = filter.search !== "" || filter.group !== "All" || filter.scope !== "all";
  const toggleSort = (key: SquadSortKey) =>
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" || key === "jersey" || key === "pos" ? "asc" : "desc" },
    );
  const header = (key: SquadSortKey, label: string, ariaLabel?: string) => (
    <SortHeader
      col={key}
      label={label}
      ariaLabel={ariaLabel}
      sortKey={sort.key}
      sortDir={sort.dir}
      onSort={toggleSort}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <ItemShortcuts codes={["teamRecoveryPack"]} target={{ kind: "club" }} />
      <Card>
        <div className="grid grid-cols-1 items-end gap-3 p-4 lg:grid-cols-[minmax(0,1.3fr)_220px_220px_auto]">
          <div>
            <label htmlFor="online-squad-search" className={LABEL}>
              {t("common.search")}
            </label>
            <input
              id="online-squad-search"
              type="text"
              value={filter.search}
              onChange={(event) => setFilter({ ...filter, search: event.target.value })}
              placeholder={t("squad.filterPlayers")}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 dark:border-navy-600 dark:bg-navy-800 dark:text-gray-200 dark:placeholder:text-gray-500"
            />
          </div>
          <div>
            <label htmlFor="online-squad-group" className={LABEL}>
              {t("squad.pos")}
            </label>
            <Select
              id="online-squad-group"
              fullWidth
              value={filter.group}
              onChange={(event) =>
                setFilter({
                  ...filter,
                  group: GROUPS.find((group) => group === event.target.value) ?? "All",
                })
              }
            >
              <option value="All">{t("common.all")}</option>
              {GROUPS.map((group) => (
                <option key={group} value={group}>
                  {t(`online.market.group.${group}`)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="online-squad-scope" className={LABEL}>
              {t("common.status")}
            </label>
            <Select
              id="online-squad-scope"
              fullWidth
              value={filter.scope}
              onChange={(event) =>
                setFilter({
                  ...filter,
                  scope: SCOPES.find((one) => one.scope === event.target.value)?.scope ?? "all",
                })
              }
            >
              {SCOPES.map((one) => (
                <option key={one.scope} value={one.scope}>
                  {t(one.label)}
                </option>
              ))}
            </Select>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={!filtered}
            onClick={() => setFilter(NO_FILTER)}
          >
            {t("common.clear")}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 px-4 pb-4">
          <Badge variant="primary" size="sm">
            {starters} {t("squad.starter")}
          </Badge>
          <Badge variant="neutral" size="sm">
            {all.length - starters} {t("squad.benchOption")}
          </Badge>
          <Badge variant={hurt > 0 ? "danger" : "neutral"} size="sm">
            {hurt} {t("common.injured")}
          </Badge>
          <Badge variant="primary" size="sm">
            {shown.length} {t("squad.playersLabel")}
          </Badge>
        </div>
      </Card>

      <Card>
        <div className="rounded-t-xl border-b border-gray-100 bg-linear-to-r from-navy-700 to-navy-800 p-4 dark:border-navy-600">
          <h3 className="flex items-center gap-2 font-heading text-sm font-bold uppercase tracking-wide text-white">
            <Users className="h-4 w-4 text-accent-400" aria-hidden />
            {t("squad.title", { team: club.club.name })}
          </h3>
          <p className="mt-0.5 text-xs text-gray-400">
            {shown.length} / {all.length} {t("squad.playersLabel")}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {t("squad.currentPlan")}: {club.setup.formation} /{" "}
            {t(`common.playStyles.${club.setup.playStyle}`)}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-xs dark:border-navy-600 dark:bg-navy-800">
                {header("jersey", t("squad.jerseyNumber"), t("squad.jerseyNumberFull"))}
                {header("name", t("common.name"))}
                {header("pos", t("squad.pos"))}
                {header("fit", t("squad.formationFit"))}
                {header("style", t("squad.styleFit"))}
                {header("potential", t("online.squad.potential"))}
                <th scope="col" className={TH}>
                  {t("squad.traits")}
                </th>
                {header("age", t("common.age"))}
                {header("condition", t("common.condition"))}
                {header("morale", t("common.morale"))}
                {header("ovr", t("common.ovr"))}
                {header("apps", t("online.squad.apps"))}
                {header("goals", t("online.squad.goals"))}
                <th scope="col" className={TH}>
                  {t("common.status")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-navy-600">
              {shown.map((player) => (
                <SquadRow
                  key={player.id}
                  player={player}
                  starter={eleven.has(player.id)}
                  fit={fits.get(player.id)}
                />
              ))}
            </tbody>
          </table>
          {shown.length === 0 && (
            <p className="p-8 text-center font-heading text-sm uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {t("online.squad.noMatch")}
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}

function ovrColour(ovr: number): string {
  if (ovr >= 80) return "text-primary-500";
  if (ovr >= 55) return "text-accent-600 dark:text-accent-400";
  return "text-gray-500 dark:text-gray-400";
}

function SquadRow({
  player,
  starter,
  fit,
}: {
  player: SquadPlayerView;
  starter: boolean;
  fit: PlayerFit | undefined;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const selling = useOnlineStore((state) =>
    state.market?.selling.some((auction) => auction.playerId === player.id),
  );
  const pictures = useOnlineStore((state) => state.playerPictures);
  const [pickingShirt, setPickingShirt] = useState(false);
  const open = () => navigate(`/online/squad/${player.id}`);
  const border = starter
    ? "border-l-4 border-l-primary-500"
    : player.injury
      ? "border-l-2 border-l-amber-400"
      : "";
  return (
    <tr
      onClick={open}
      title={starter ? t("squad.startingXi") : undefined}
      className={`group cursor-pointer transition-colors hover:bg-primary-500/5 dark:hover:bg-navy-700 ${border}`}
    >
      <td className="px-4 py-2.5 text-sm font-medium tabular-nums text-gray-600 dark:text-gray-400">
        <button
          type="button"
          title={t("squad.jerseyPickerAction")}
          aria-label={`${t("squad.jerseyPickerAction")}: ${player.matchName}`}
          onClick={(event) => {
            event.stopPropagation();
            setPickingShirt(true);
          }}
          className="rounded px-1.5 py-0.5 tabular-nums hover:bg-primary-500/10 hover:text-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:hover:text-primary-400"
        >
          {player.shirtNumber ?? "—"}
        </button>
        {pickingShirt && (
          // A portal's clicks bubble through the row, which would open the player's page.
          // biome-ignore lint/a11y/noStaticElementInteractions: only stops the click, no action
          // biome-ignore lint/a11y/useKeyWithClickEvents: only stops the click, no action
          <span onClick={(event) => event.stopPropagation()}>
            <ShirtNumberPicker player={player} onClose={() => setPickingShirt(false)} />
          </span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-3">
          <PlayerAvatar player={avatarOf(player, pictures)} />
          <div className="flex min-w-0 items-center gap-1.5">
            <Link
              to={`/online/squad/${player.id}`}
              onClick={(event) => event.stopPropagation()}
              className="truncate rounded text-sm font-semibold text-gray-900 transition-colors hover:text-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-100 dark:hover:text-primary-400"
            >
              {player.matchName}
            </Link>
            <CountryFlag code={player.nationality} className="shrink-0 text-sm leading-none" />
          </div>
        </div>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1">
          <PlayerPositionBadges
            primaryPosition={player.naturalPosition}
            alternatePositions={player.alternatePositions}
          />
        </div>
      </td>
      <td className="px-4 py-2.5">
        {fit && (
          <div className="flex items-center gap-1.5">
            <Badge
              variant={
                !fit.starter
                  ? "neutral"
                  : fit.tactical === "natural"
                    ? "success"
                    : fit.tactical === "adapted"
                      ? "accent"
                      : "danger"
              }
              size="sm"
            >
              {translatePositionAbbreviation(t, fit.starter ? fit.slot : fit.bestRole)}
            </Badge>
            {fit.outOfPosition && (
              <span className="text-amber-500" title={t("squad.outOfPositionTooltip")}>
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            )}
          </div>
        )}
      </td>
      <td className="px-4 py-2.5">
        {fit && (
          <Badge
            variant={
              fit.style === "strong" ? "success" : fit.style === "good" ? "accent" : "danger"
            }
            size="sm"
            className="whitespace-nowrap"
            title={fit.keeper ? t("squad.styleFitKeeperHint", fit.keeper) : undefined}
          >
            {t(`squad.styleFitValues.${fit.style}`)}
          </Badge>
        )}
      </td>
      <td className="px-4 py-2.5">
        <PotentialStars stars={player.potentialStars} />
      </td>
      <td className="px-4 py-2.5">
        <div className="min-w-20">
          <TraitList traits={player.traits} size="xs" iconOnly />
        </div>
      </td>
      <td className="px-4 py-2.5 text-sm tabular-nums text-gray-600 dark:text-gray-400">
        {player.age}
      </td>
      <td className={`px-4 py-2.5 text-sm font-medium tabular-nums ${condColor(player.condition)}`}>
        {player.condition}%
      </td>
      <td className="px-4 py-2.5 text-sm tabular-nums text-gray-500 dark:text-gray-400">
        {player.morale}
      </td>
      <td className="px-4 py-2.5">
        <span className={`font-heading text-sm font-bold ${ovrColour(player.ovr)}`}>
          {player.ovr}
        </span>
      </td>
      <td className="px-4 py-2.5 text-sm tabular-nums text-gray-600 dark:text-gray-400">
        {player.season.appearances}
      </td>
      <td className="px-4 py-2.5 text-sm tabular-nums text-gray-600 dark:text-gray-400">
        {player.season.goals}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex flex-wrap gap-1">
          {selling && (
            <Badge variant="accent" size="sm">
              {t("online.market.selling")}
            </Badge>
          )}
          {player.injury && (
            <InjuryBadge
              injury={{ name: player.injury.name, days_remaining: player.injury.daysRemaining }}
            />
          )}
          {player.suspendedMatches !== undefined && (
            <Badge variant="danger" size="sm">
              {t("online.squad.suspended", { count: player.suspendedMatches })}
            </Badge>
          )}
        </div>
      </td>
    </tr>
  );
}
