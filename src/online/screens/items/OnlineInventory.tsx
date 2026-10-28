import type { TFunction } from "i18next";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowRight, History as HistoryIcon, Lock } from "lucide-react";
import { Button } from "../../../components/ui";
import { formatDate } from "../../../lib/dateFormatting";
import type { InventoryLineView, InventoryView, ItemEntryView, ItemTarget } from "../../api";
import { online } from "../../client";
import { tracked, refreshItems, useOnlineStore } from "../../store/onlineStore";
import { useOnlineResource } from "../../useOnlineResource";
import ResourceState from "../ResourceState";
import ItemDetailDialog from "./ItemDetailDialog";
import { ItemIcon, lookOf } from "./itemLook";
import ItemsToast from "./ItemsToast";
import { groupOf, ITEM_GROUPS, itemName, itemsErrorText, sourceText } from "./itemText";
import UseItemDialog from "./UseItemDialog";

/** Entries read a page at a time. */
const ENTRIES_PAGE = 30;
const MASTERY_WORDS = ["low", "mid", "high"] as const;

/**
 * The coach's items (C-7b, C7-13, C7-31, C7-32; design kho-do.html): what he holds by group as
 * tiles, each opening its detail and its use, and the history of every entry. Items belong to the
 * person, so the page opens without a club; only an item used on a player or the club needs one.
 */
export default function OnlineInventory() {
  const { t } = useTranslation();
  const items = useOnlineStore((state) => state.items);
  const [tab, setTab] = useState<"held" | "history">("held");
  const [loadError, setLoadError] = useState<unknown>(null);

  const load = useCallback(() => {
    setLoadError(null);
    refreshItems().catch(setLoadError);
  }, []);
  useEffect(load, [load]);

  if (items === undefined) {
    return (
      <ResourceState
        resource={loadError ? { status: "failed", error: loadError } : { status: "loading" }}
        reload={load}
      >
        {() => null}
      </ResourceState>
    );
  }
  if (items === null) {
    return (
      <p className="text-sm text-gray-600 dark:text-gray-300">
        {t("online.inventory.notOnServer")}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {items.locked && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200"
        >
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t("online.inventory.locked")}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label={t("online.nav.inventory")}
          className="inline-flex gap-1 rounded-lg border border-gray-200 bg-white p-1 dark:border-navy-600 dark:bg-navy-800"
        >
          <SegmentTab selected={tab === "held"} onClick={() => setTab("held")}>
            {t("online.inventory.tabHeldCount", { count: items.lines.length })}
          </SegmentTab>
          <SegmentTab selected={tab === "history"} onClick={() => setTab("history")}>
            {t("online.inventory.tabHistory")}
          </SegmentTab>
        </div>
        <Link
          to="/online/shop"
          className="inline-flex items-center gap-1.5 rounded text-sm font-semibold text-primary-700 hover:text-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-primary-400 dark:hover:text-primary-300"
        >
          {t("online.inventory.toShopMore")}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
      {tab === "held" ? <Held items={items} /> : <History />}
    </div>
  );
}

function SegmentTab({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={`h-9 rounded-md px-3.5 font-heading text-sm font-semibold uppercase tracking-wider transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 ${
        selected
          ? "bg-primary-700 text-white dark:bg-primary-700 dark:text-white"
          : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-navy-700"
      }`}
    >
      {children}
    </button>
  );
}

/** What the tile says under the name: the club's uses today, a note's band, or the target. */
function tileLine(
  t: TFunction,
  code: string,
  items: InventoryView,
): { text: string; warn: boolean } | null {
  const recovery = items.limits?.teamRecovery;
  if (code === "teamRecoveryPack" && recovery) {
    return {
      text: t("online.inventory.usedToday", { used: recovery.usedToday, perDay: recovery.perDay }),
      warn: recovery.usedToday >= recovery.perDay,
    };
  }
  const look = lookOf(code);
  if (look.masteryTier !== undefined) {
    return { text: t(`online.shop.mastery.${MASTERY_WORDS[look.masteryTier - 1]}`), warn: false };
  }
  if (look.scope) return { text: t(`online.shop.scope.${look.scope}`), warn: false };
  return null;
}

function Held({ items }: { items: InventoryView }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);
  const [using, setUsing] = useState<{ code: string; target?: ItemTarget } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (items.lines.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white px-6 py-10 text-center text-sm text-gray-600 shadow-sm dark:border-navy-600 dark:bg-navy-700 dark:text-gray-300">
        {t("online.inventory.empty")}{" "}
        <Link
          to="/online/shop"
          className="rounded font-semibold text-primary-700 underline focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-primary-400"
        >
          {t("online.inventory.toShop")}
        </Link>
      </div>
    );
  }
  const opened = items.lines.find((line) => line.itemCode === open);
  return (
    <>
      <div className="flex flex-col gap-7">
        {ITEM_GROUPS.map((group) => {
          const lines = items.lines.filter((line) => groupOf(line.itemCode) === group);
          if (lines.length === 0) return null;
          return (
            <section key={group} aria-labelledby={`items-${group}`} className="flex flex-col gap-3">
              <h2
                id={`items-${group}`}
                className="flex items-baseline gap-2 font-heading text-base font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100"
              >
                {t(`online.inventory.group.${group}`)}
                <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">
                  ({lines.length})
                </span>
              </h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
                {lines.map((line) => (
                  <ItemTile
                    key={line.itemCode}
                    line={line}
                    items={items}
                    onOpen={() => {
                      setDone(null);
                      setOpen(line.itemCode);
                    }}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {opened && (
        <ItemDetailDialog
          line={opened}
          items={items}
          onClose={() => setOpen(null)}
          onUse={(target) => {
            setOpen(null);
            setUsing({ code: opened.itemCode, target });
          }}
        />
      )}
      {using && (
        <UseItemDialog
          code={using.code}
          initialTarget={using.target}
          onClose={() => setUsing(null)}
          onDone={(text) => {
            setUsing(null);
            setDone(text);
          }}
        />
      )}
      {done && <ItemsToast text={done} onClose={() => setDone(null)} />}
    </>
  );
}

function ItemTile({
  line,
  items,
  onOpen,
}: {
  line: InventoryLineView;
  items: InventoryView;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const name = itemName(t, line.itemCode);
  const below = tileLine(t, line.itemCode, items);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t("online.inventory.tileAria", { item: name, count: line.total })}
      className="flex min-h-18 items-center gap-3 rounded-xl border border-gray-200 bg-white py-3 pl-3 pr-4 text-left shadow-sm transition-colors hover:border-primary-500 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:border-navy-600 dark:bg-navy-700 dark:hover:border-primary-500 dark:hover:bg-navy-600 dark:focus:ring-offset-navy-800"
    >
      <ItemIcon code={line.itemCode} size="md" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-heading text-base font-bold uppercase leading-tight tracking-wider text-gray-900 dark:text-gray-100">
          {name}
        </span>
        {below && (
          <span
            className={`truncate text-xs ${
              below.warn
                ? "text-accent-700 dark:text-accent-300"
                : "text-gray-500 dark:text-gray-400"
            }`}
          >
            {below.text}
          </span>
        )}
      </span>
      <span className="shrink-0 font-heading text-xl font-bold tabular-nums text-gray-900 dark:text-white">
        <span className="text-sm text-gray-500 dark:text-gray-400">×</span>
        {line.total}
      </span>
    </button>
  );
}

/** What an entry was used on, when it says (C-7 §17.5): a player of the club by name. */
function targetText(
  t: TFunction,
  entry: ItemEntryView,
  players: { id: string; fullName: string }[],
): string | null {
  switch (entry.targetKind) {
    case "player":
      return (
        players.find((player) => player.id === entry.targetId)?.fullName ??
        t("online.inventory.target.player")
      );
    case "style":
      return entry.targetId ? t(`common.playStyles.${entry.targetId}`, entry.targetId) : null;
    case "club":
    case "account":
    case "scoutTrip":
      return t(`online.inventory.target.${entry.targetKind}`);
    default:
      return null;
  }
}

function signedClass(delta: number): string {
  return delta < 0 ? "text-red-600 dark:text-red-400" : "text-primary-700 dark:text-primary-400";
}

function History() {
  const { t, i18n } = useTranslation();
  const players = useOnlineStore((state) => state.club?.players ?? []);
  const [entries, setEntries] = useState<ItemEntryView[]>([]);
  const [next, setNext] = useState<string | undefined>(undefined);
  const [moreError, setMoreError] = useState<unknown>(null);
  const { resource, reload } = useOnlineResource(
    () => tracked(() => online.items.entries(undefined, ENTRIES_PAGE)),
    [],
  );

  useEffect(() => {
    if (resource.status !== "ready") return;
    setEntries(resource.data.items);
    setNext(resource.data.nextCursor);
  }, [resource]);

  const more = () => {
    if (next === undefined) return;
    setMoreError(null);
    tracked(() => online.items.entries(next, ENTRIES_PAGE))
      .then((page) => {
        setEntries((shown) => [...shown, ...page.items]);
        setNext(page.nextCursor);
      })
      .catch(setMoreError);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-navy-600 dark:bg-navy-700 dark:shadow-md">
      <ResourceState resource={resource} reload={reload}>
        {() =>
          entries.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <HistoryIcon
                className="h-7 w-7 text-gray-400 dark:text-gray-500"
                aria-hidden="true"
              />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t("online.inventory.historyEmpty")}
              </p>
            </div>
          ) : (
            <ol
              aria-label={t("online.inventory.tabHistory")}
              className="flex flex-col divide-y divide-gray-100 dark:divide-navy-600"
            >
              {entries.map((entry) => {
                const on = targetText(t, entry, players);
                return (
                  <li key={entry.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                    <span className="w-28 shrink-0 text-xs tabular-nums text-gray-500 dark:text-gray-400">
                      {formatDate(entry.at, i18n.language, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-semibold text-gray-900 dark:text-gray-100">
                        {itemName(t, entry.itemCode)}
                      </span>
                      <span className="truncate text-xs text-gray-500 dark:text-gray-400">
                        {sourceText(t, entry.source)}
                        {on && <> · {on}</>}
                      </span>
                    </span>
                    <span
                      className={`font-heading text-lg font-bold tabular-nums ${signedClass(entry.delta)}`}
                    >
                      {entry.delta > 0 ? "+" : ""}
                      {entry.delta}
                    </span>
                  </li>
                );
              })}
            </ol>
          )
        }
      </ResourceState>
      <p className="border-t border-gray-100 px-5 py-2.5 text-xs text-gray-500 dark:border-navy-600 dark:text-gray-400">
        {t("online.inventory.expiredNotShown")}
      </p>
      {next !== undefined && (
        <div className="border-t border-gray-100 px-5 py-3 dark:border-navy-600">
          <Button size="sm" variant="outline" onClick={more}>
            {t("online.coins.more")}
          </Button>
        </div>
      )}
      {moreError !== null && (
        <p role="alert" className="px-5 pb-3 text-sm text-red-600 dark:text-red-400">
          {itemsErrorText(t, i18n.language, moreError)}
        </p>
      )}
    </div>
  );
}
