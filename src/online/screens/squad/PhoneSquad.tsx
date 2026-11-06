import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MyClubView } from "../../api";
import ItemShortcuts from "../items/ItemShortcuts";
import { AssistantLink, LensBar, LineChips, RotateHint, SquadAppBarParts } from "./PhoneSquadBars";
import { LENSES, type Lens, PlayerRow, PlayerSheet } from "./PhoneSquadParts";
import {
  inOwnOrder,
  nextSort,
  PHONE_DEFAULT_SORT,
  phoneSections,
  scopeCounts,
} from "./phoneSquadList";
import { fitRank, type PlayerFit, squadFits } from "./squadFit";
import {
  matchesFilter,
  NO_FILTER,
  type SquadFilter,
  type SquadSort,
  type SquadSortKey,
  sortedBy,
} from "./squadList";

const KEY = "online.squad.phone";

/**
 * The squad on a phone (design m-doi-hinh, upright): the status tabs and a search in the app bar,
 * the lines as chips, then the players as rows, the eleven apart from the bench, with two columns
 * of one lens (form, fit, growth, stats). Tapping a column heading sorts the list by it, as on the
 * desktop table. A row opens the player's sheet.
 */
export default function PhoneSquad({ club }: { club: MyClubView }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<SquadFilter>(NO_FILTER);
  const [sort, setSort] = useState<SquadSort>(PHONE_DEFAULT_SORT);
  const [lens, setLens] = useState<Lens>("form");
  const [openId, setOpenId] = useState<string | null>(null);
  const players = club.players;
  const eleven = useMemo(() => new Set(club.setup.startingXiIds), [club.setup]);
  const fits = useMemo(() => squadFits(club), [club]);
  const shown = useMemo(
    () =>
      sortedBy(players, sort, {
        fit: (player) => fitRank(fits.get(player.id), "fit"),
        style: (player) => fitRank(fits.get(player.id), "style"),
      }).filter((player) => matchesFilter(player, filter, eleven)),
    [players, sort, filter, eleven, fits],
  );
  const counts = scopeCounts(players, filter, eleven);
  const sections = phoneSections(shown, eleven, filter.scope === "all" && inOwnOrder(sort));
  const opened = players.find((player) => player.id === openId);
  // A lens that hides the column sorted by takes the list back to its own order.
  const changeLens = (next: Lens) => {
    setLens(next);
    const kept: SquadSortKey[] = [
      "pos",
      "ovr",
      ...(LENSES.find((one) => one.id === next)?.sorts ?? []),
    ];
    if (sort.key !== null && !kept.includes(sort.key)) setSort(PHONE_DEFAULT_SORT);
  };

  return (
    <div className="-mx-3 -mt-3 flex flex-col">
      <SquadAppBarParts filter={filter} onFilter={setFilter} counts={counts} />
      {club.xiAssistant && <AssistantLink />}
      <div className="mx-4 mt-3 empty:hidden">
        <ItemShortcuts codes={["teamRecoveryPack"]} target={{ kind: "club" }} />
      </div>
      <LineChips filter={filter} onFilter={setFilter} />
      <RotateHint />
      <LensBar
        lens={lens}
        onLens={changeLens}
        sort={sort}
        onSort={(key) => setSort((current) => nextSort(current, key))}
      />

      <main className="px-4 pb-4">
        {shown.length === 0 && (
          <p className="my-6 text-center text-[13px] text-gray-500 dark:text-gray-400">
            {t("online.squad.noMatch")}
          </p>
        )}
        <ul aria-label={t(`${KEY}.list`)} className="flex flex-col gap-0.5">
          {sections.map((section) => (
            <SectionRows
              key={section.id}
              id={section.id}
              players={section.players}
              eleven={eleven}
              fits={fits}
              lens={lens}
              onOpen={setOpenId}
            />
          ))}
        </ul>
      </main>

      {opened && (
        <PlayerSheet
          player={opened}
          starter={eleven.has(opened.id)}
          fit={fits.get(opened.id)}
          formation={club.setup.formation}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

/** One part of the list: its heading (none for a sorted list), then its players. */
function SectionRows({
  id,
  players,
  eleven,
  fits,
  lens,
  onOpen,
}: {
  id: "xi" | "bench" | "all";
  players: MyClubView["players"];
  eleven: ReadonlySet<string>;
  fits: ReadonlyMap<string, PlayerFit>;
  lens: Lens;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {id !== "all" && (
        <li
          className={`flex items-center gap-2 px-1 pb-1.5 pt-3 font-heading text-sm font-bold uppercase tracking-widest ${id === "xi" ? "text-primary-700 dark:text-primary-400" : "text-gray-500 dark:text-gray-400"}`}
        >
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-[2px] ${id === "xi" ? "bg-primary-500" : "bg-gray-400"}`}
          />
          {t(id === "xi" ? `${KEY}.sectionXi` : `${KEY}.sectionBench`, { count: players.length })}
        </li>
      )}
      {players.map((player) => (
        <li key={player.id}>
          <PlayerRow
            player={player}
            starter={eleven.has(player.id)}
            fit={fits.get(player.id)}
            lens={lens}
            onOpen={() => onOpen(player.id)}
          />
        </li>
      ))}
    </>
  );
}
