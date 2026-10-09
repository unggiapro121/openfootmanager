import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";

import { formatVal } from "../../lib/helpers";
import type { GameStateData } from "../../store/gameStore";
import {
  fetchTeamsDirectory,
  type TeamCard,
  type TeamsDirectory,
} from "../../services/teamsService";
import { getErrorMessage, resolveTranslatedErrorMessage } from "../../utils/errorMessage";
import { Badge, Card, Select, TeamLogo } from "../ui";
import {
  buildDirectoryTree,
  type DirectorySelection,
  locateTeam,
  resolveSelection,
} from "./TeamsListTab.helpers";

interface TeamsListTabProps {
  gameState: GameStateData;
  onSelectTeam: (id: string) => void;
}

/** A club in the table, with the league it plays in for a search across leagues. */
interface TeamRow {
  card: TeamCard;
  leagueName: string;
}

/**
 * Every club in the world, one league at a time: region, country and league are
 * picked from three filters, and the league's clubs are listed as rows. A search
 * looks across every league instead.
 */
export default function TeamsListTab({ gameState, onSelectTeam }: TeamsListTabProps) {
  const { t } = useTranslation();
  const userTeamId = gameState.manager.team_id;

  const [search, setSearch] = useState("");
  const [directory, setDirectory] = useState<TeamsDirectory | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [wanted, setWanted] = useState<Partial<DirectorySelection> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTeamsDirectory({ search: search.trim() || null })
      .then((result) => {
        if (cancelled) return;
        setDirectory(result);
        setFetchError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setFetchError(resolveTranslatedErrorMessage(getErrorMessage(error), t));
      });
    return () => {
      cancelled = true;
    };
  }, [search, t]);

  const tree = useMemo(() => (directory ? buildDirectoryTree(directory, t) : []), [directory, t]);
  const isSearching = search.trim().length > 0;
  // Until the player picks something, the screen stands on their own league.
  const selection = resolveSelection(tree, wanted ?? locateTeam(tree, userTeamId));
  const region = tree.find((candidate) => candidate.id === selection?.regionId);
  const country = region?.countries.find((candidate) => candidate.id === selection?.countryId);
  const league = country?.leagues.find((candidate) => candidate.id === selection?.leagueId);

  const rows: TeamRow[] = isSearching
    ? tree.flatMap((each) =>
        each.countries.flatMap((eachCountry) =>
          eachCountry.leagues.flatMap((eachLeague) =>
            eachLeague.teams.map((card) => ({ card, leagueName: eachLeague.name })),
          ),
        ),
      )
    : (league?.teams.map((card) => ({ card, leagueName: league.name })) ?? []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("teams.searchPlaceholder")}
            aria-label={t("teams.searchPlaceholder")}
            className="w-full rounded-lg border border-gray-200 dark:border-navy-600 bg-white dark:bg-navy-800 py-2.5 pl-10 pr-4 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
          />
        </div>
        {!isSearching && selection ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:w-[36rem]">
            <Select
              aria-label={t("teams.region")}
              value={selection.regionId}
              onChange={(event) => setWanted({ regionId: event.target.value })}
              fullWidth
            >
              {tree.map((each) => (
                <option key={each.id} value={each.id}>
                  {each.name}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t("teams.country")}
              value={selection.countryId}
              onChange={(event) =>
                setWanted({ regionId: selection.regionId, countryId: event.target.value })
              }
              fullWidth
            >
              {region?.countries.map((each) => (
                <option key={each.id} value={each.id}>
                  {each.name}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t("teams.league")}
              value={selection.leagueId}
              onChange={(event) => setWanted({ ...selection, leagueId: event.target.value })}
              fullWidth
            >
              {country?.leagues.map((each) => (
                <option key={each.id} value={each.id}>
                  {each.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>

      {fetchError ? (
        <p role="alert" className="text-sm text-red-500">
          {fetchError}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
          {t("teams.noResults")}
        </p>
      ) : (
        <TeamsTable
          rows={rows}
          showLeague={isSearching}
          userTeamId={userTeamId}
          onSelectTeam={onSelectTeam}
        />
      )}
    </div>
  );
}

function TeamsTable({
  rows,
  showLeague,
  userTeamId,
  onSelectTeam,
}: {
  rows: TeamRow[];
  showLeague: boolean;
  userTeamId: string | null;
  onSelectTeam: (id: string) => void;
}) {
  const { t } = useTranslation();
  const header = "px-3 py-2 font-heading font-bold uppercase tracking-wider text-xs";
  const number = "px-3 py-2 text-right font-heading font-bold tabular-nums";

  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm text-gray-700 dark:text-gray-200">
        <thead className="bg-gray-50 text-gray-500 dark:bg-navy-900/40 dark:text-gray-400">
          <tr>
            <th scope="col" className={`${header} w-10 text-right`}>
              #
            </th>
            <th scope="col" className={`${header} text-left`}>
              {t("teams.club")}
            </th>
            <th scope="col" className={`${header} hidden text-left md:table-cell`}>
              {t("teams.playStyle")}
            </th>
            <th scope="col" className={`${header} text-right`}>
              {t("teams.squad")}
            </th>
            <th scope="col" className={`${header} text-right`}>
              {t("teams.avgOvr")}
            </th>
            <th scope="col" className={`${header} hidden text-right sm:table-cell`}>
              {t("teams.rep")}
            </th>
            <th scope="col" className={`${header} hidden text-right md:table-cell`}>
              {t("common.value")}
            </th>
            <th scope="col" className={`${header} text-right`}>
              {t("common.pts")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ card, leagueName }) => {
            const { team } = card;
            const isUser = team.id === userTeamId;
            return (
              <tr
                key={team.id}
                className={`border-t border-gray-100 dark:border-navy-700 ${
                  isUser ? "bg-primary-50/60 dark:bg-primary-500/10" : ""
                }`}
              >
                <td className={`${number} text-gray-500 dark:text-gray-400`}>
                  {card.league_pos > 0 ? card.league_pos : "—"}
                </td>
                <td className="px-3 py-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <TeamLogo
                      team={team}
                      className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md font-heading text-xs font-bold text-white"
                      imageClassName="h-7 w-7 object-contain"
                      style={{ backgroundColor: team.colors.primary }}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onSelectTeam(team.id)}
                          className="truncate rounded text-left font-heading font-bold uppercase tracking-wide text-gray-900 hover:text-primary-600 hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-white dark:hover:text-primary-400 dark:focus:ring-offset-navy-800"
                        >
                          {team.name}
                        </button>
                        {isUser ? (
                          <Badge variant="accent" size="sm">
                            {t("teams.yourTeam")}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                        {showLeague ? leagueName : team.city}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="hidden px-3 py-2 text-xs text-gray-500 dark:text-gray-400 md:table-cell">
                  {t(`common.playStyles.${team.play_style}`, team.play_style)}
                </td>
                <td className={number}>{card.roster_size}</td>
                <td className={number}>{card.avg_ovr}</td>
                <td className={`${number} hidden sm:table-cell`}>{team.reputation}</td>
                <td className={`${number} hidden md:table-cell`}>{formatVal(card.total_value)}</td>
                <td className={number}>{card.standing ? card.standing.points : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
