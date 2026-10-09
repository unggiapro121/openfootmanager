import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { GeneratedAvatar } from "../../ui/GeneratedAvatar";
import { useAssetDataUrl } from "../../../hooks/useAssetDataUrl";
import { POSITION_COLOR, entityRowKey } from "./helpers";
import { EntityListFooter, EntityListShell, EntityRow, ExportCsvButton } from "./shared";
import { ENTITY_LIST_PAGE_SIZE, buildTeamNameMap, capRows } from "./entityList.helpers";
import { useKeepRevealed } from "./entityList.reveal";
import {
  FREE_AGENTS_FILTER,
  competitionClubIds,
  filterPlayerRows,
  leagueCompetitions,
  positionFilterGroups,
  type ClubFilter,
  type PositionFilter,
} from "./PlayersTab.helpers";
import { Select } from "../../ui/Select";
import type { CompetitionDef, PlayerDef, Position, TeamDef } from "./types";

interface PlayerAvatarCellProps {
  player: PlayerDef;
  posAbbr: string;
  projectDir?: string;
}

function PlayerAvatarCell({ player, posAbbr, projectDir }: PlayerAvatarCellProps) {
  const photoUrl = useAssetDataUrl(player.photo, projectDir);

  const name = player.name || `${player.firstName} ${player.lastName}`.trim() || player.id;
  const posColor = POSITION_COLOR[player.position] ?? "bg-gray-500";

  return (
    <div className="relative flex-shrink-0">
      {photoUrl ? (
        <img
          src={photoUrl}
          alt=""
          className="w-9 h-9 rounded-full object-cover border border-gray-200 dark:border-navy-600"
        />
      ) : (
        <GeneratedAvatar
          name={name}
          initials={name.slice(0, 2).toUpperCase()}
          className="w-9 h-9"
        />
      )}
      <span
        className={`absolute -bottom-0.5 -right-0.5 text-[7px] font-bold text-white px-0.5 rounded leading-tight ${posColor}`}
      >
        {posAbbr}
      </span>
    </div>
  );
}

interface FilterSelectProps {
  caption: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}

/**
 * A list-column dropdown. The column has no room for a visible caption, but
 * the control still needs a name it can be announced with — named after the
 * caption *and* itself, the way CountryCombobox does it, so it reads
 * "<field>, <current value>": a bare aria-label would replace the button's
 * contents, which is where the chosen value is.
 */
function FilterSelect({ caption, value, onChange, children }: FilterSelectProps) {
  const selectId = useId();
  const captionId = useId();
  return (
    <div className="min-w-0">
      <span id={captionId} className="sr-only">
        {caption}
      </span>
      <Select
        selectSize="sm"
        fullWidth
        id={selectId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-labelledby={`${captionId} ${selectId}`}
      >
        {children}
      </Select>
    </div>
  );
}

interface PlayersTabProps {
  players: PlayerDef[];
  teams?: TeamDef[];
  /** Offers a league filter when the package defines leagues. */
  competitions?: CompetitionDef[];
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onDuplicate?: (index: number) => void;
  onExportCsv?: () => void;
  selectedIndex?: number | null;
  onSelect?: (index: number) => void;
  projectDir?: string;
  youthOnly?: boolean;
}

export function PlayersTab({
  players,
  teams,
  competitions,
  onAdd,
  onEdit,
  onDelete,
  onDuplicate,
  onExportCsv,
  selectedIndex,
  onSelect,
  projectDir,
  youthOnly,
}: PlayersTabProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");

  const [positionFilter, setPositionFilter] = useState<PositionFilter>("All");
  const [leagueFilter, setLeagueFilter] = useState("All");
  const [clubFilter, setClubFilter] = useState<ClubFilter>("All");
  const [visibleCount, setVisibleCount] = useState(ENTITY_LIST_PAGE_SIZE);

  const teamNames = useMemo(() => buildTeamNameMap(teams), [teams]);
  const leagues = useMemo(() => leagueCompetitions(competitions), [competitions]);
  const leagueClubs = useMemo(() => {
    const league = leagues.find((c) => c.id === leagueFilter);
    return league ? competitionClubIds(league, teams) : null;
  }, [leagues, leagueFilter, teams]);
  // The club dropdown follows the league one, so picking a league leaves a
  // short list rather than every club in the world.
  const clubOptions = useMemo(
    () =>
      [...teamNames]
        .filter(([id]) => !leagueClubs || leagueClubs.has(id))
        .map(([id, name]) => [id, name || id] as const)
        .sort(([, a], [, b]) => a.localeCompare(b)),
    [teamNames, leagueClubs],
  );
  const { scoped, filtered } = useMemo(
    () =>
      filterPlayerRows({
        players,
        youthOnly,
        positionFilter,
        query,
        teamNames,
        leagueClubs,
        clubFilter,
      }),
    [players, youthOnly, positionFilter, query, teamNames, leagueClubs, clubFilter],
  );
  const { visible } = capRows(
    filtered,
    visibleCount,
    ENTITY_LIST_PAGE_SIZE,
    ({ i }) => i === selectedIndex,
  );
  useKeepRevealed(visible.length, visibleCount, setVisibleCount);

  // Reset here rather than in an effect: an effect would let the old, longer
  // list render once before shrinking it, which is the cost being avoided.
  function handleQueryChange(next: string) {
    setQuery(next);
    setVisibleCount(ENTITY_LIST_PAGE_SIZE);
  }

  function handlePositionFilterChange(next: string) {
    setPositionFilter(next as PositionFilter);
    setVisibleCount(ENTITY_LIST_PAGE_SIZE);
  }

  function handleLeagueFilterChange(next: string) {
    setLeagueFilter(next);
    // A club outside the new league would leave the list silently empty.
    const league = leagues.find((c) => c.id === next);
    if (
      league &&
      clubFilter !== "All" &&
      clubFilter !== FREE_AGENTS_FILTER &&
      !competitionClubIds(league, teams).has(clubFilter)
    ) {
      setClubFilter("All");
    }
    setVisibleCount(ENTITY_LIST_PAGE_SIZE);
  }

  function handleClubFilterChange(next: string) {
    setClubFilter(next);
    setVisibleCount(ENTITY_LIST_PAGE_SIZE);
  }

  return (
    <EntityListShell
      addLabel={youthOnly ? t("worldEditor.addYouthPlayer") : t("worldEditor.addPlayer")}
      onAdd={onAdd}
      emptyLabel={youthOnly ? t("worldEditor.noYouthPlayers") : t("worldEditor.noPlayers")}
      isEmpty={scoped.length === 0}
      searchSlot={
        (scoped.length > 0 || onExportCsv) && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              {scoped.length > 0 && (
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-gray-500 pointer-events-none" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => handleQueryChange(e.target.value)}
                    aria-label={t("worldEditor.searchPlayers")}
                    placeholder={t("worldEditor.searchPlayers")}
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-navy-600 bg-white dark:bg-navy-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-400 transition"
                  />
                </div>
              )}
              {onExportCsv && <ExportCsvButton onClick={onExportCsv} />}
            </div>
            {scoped.length > 0 && (
              <>
                <FilterSelect
                  caption={t("worldEditor.filterByPosition")}
                  value={positionFilter}
                  onChange={handlePositionFilterChange}
                >
                  {/*
                  Flat children, never a fragment: Select reads its options out
                  of `children` and does not descend into one.
                */}
                  <option value="All">{t("worldEditor.allPositions")}</option>
                  {positionFilterGroups().map((group) => (
                    <optgroup key={group.labelKey} label={t(group.labelKey)}>
                      {group.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {t(option.labelKey)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </FilterSelect>
                {(leagues.length > 0 || clubOptions.length > 0) && (
                  <div className={`grid gap-2 ${leagues.length > 0 ? "grid-cols-2" : ""}`}>
                    {leagues.length > 0 && (
                      <FilterSelect
                        caption={t("worldEditor.filterByLeague")}
                        value={leagueFilter}
                        onChange={handleLeagueFilterChange}
                      >
                        <option value="All">{t("worldEditor.allLeagues")}</option>
                        {leagues.map((league) => (
                          <option key={league.id} value={league.id}>
                            {league.name || league.id}
                          </option>
                        ))}
                      </FilterSelect>
                    )}
                    <FilterSelect
                      caption={t("worldEditor.filterByClub")}
                      value={clubFilter}
                      onChange={handleClubFilterChange}
                    >
                      <option value="All">{t("worldEditor.allClubs")}</option>
                      <option value={FREE_AGENTS_FILTER}>{t("worldEditor.freeAgents")}</option>
                      {clubOptions.map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </FilterSelect>
                  </div>
                )}
              </>
            )}
          </div>
        )
      }
      footerSlot={
        <EntityListFooter
          shown={visible.length}
          matches={filtered.length}
          hasRecords={scoped.length > 0}
          onLoadMore={() => setVisibleCount((n) => n + ENTITY_LIST_PAGE_SIZE)}
        />
      }
    >
      {visible.map(({ player, i }) => (
        <EntityRow
          key={entityRowKey(player.id, i)}
          title={player.name || `${player.firstName} ${player.lastName}`.trim() || player.id}
          subtitle={[
            t(`common.positions.${player.position}`),
            player.club ? (teamNames.get(player.club) ?? player.club) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          badge={
            <PlayerAvatarCell
              player={player}
              posAbbr={t(`common.posAbbr.${player.position as Position}`, {
                defaultValue: player.position.slice(0, 2).toUpperCase(),
              })}
              projectDir={projectDir}
            />
          }
          onEdit={() => onEdit(i)}
          onDelete={() => onDelete(i)}
          onDuplicate={onDuplicate ? () => onDuplicate(i) : undefined}
          duplicateLabel={t("worldEditor.duplicateEntity")}
          editLabel={t("worldEditor.editPlayer")}
          deleteLabel={t("worldEditor.deletePlayer")}
          isSelected={selectedIndex === i}
          onClick={onSelect ? () => onSelect(i) : undefined}
        />
      ))}
    </EntityListShell>
  );
}
