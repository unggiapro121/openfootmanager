import type { TFunction } from "i18next";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Backpack, Lock } from "lucide-react";
import { Button, Card, CardBody, CardHeader } from "../../../components/ui";
import { formatDate } from "../../../lib/dateFormatting";
import type {
  InventoryLimitsView,
  InventoryLineView,
  InventoryView,
  ItemEntryView,
} from "../../api";
import { online } from "../../client";
import { formatMoment } from "../../format";
import { refreshItems, tracked, useOnlineStore } from "../../store/onlineStore";
import { useOnlineResource } from "../../useOnlineResource";
import ResourceState from "../ResourceState";
import TabButton from "../TabButton";
import {
  groupOf,
  ITEM_GROUPS,
  itemDescription,
  itemName,
  itemsErrorText,
  sourceText,
  targetKindOf,
} from "./itemText";
import UseItemDialog from "./UseItemDialog";

/** Entries read a page at a time. */
const ENTRIES_PAGE = 30;

/**
 * The coach's items (C-7b, C7-13, C7-31, C7-32): what he holds by group, each row by when it
 * expires, the caps the server counts, a use, and the history of every entry. Items belong to the
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
    <div className="flex flex-col gap-5">
      {items.locked && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200"
        >
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t("online.inventory.locked")}
        </p>
      )}
      <div role="tablist" aria-label={t("online.nav.inventory")} className="flex flex-wrap gap-2">
        <TabButton selected={tab === "held"} onClick={() => setTab("held")}>
          {t("online.inventory.tabHeld")}
        </TabButton>
        <TabButton selected={tab === "history"} onClick={() => setTab("history")}>
          {t("online.inventory.tabHistory")}
        </TabButton>
      </div>
      {tab === "held" ? <Held items={items} /> : <History />}
    </div>
  );
}

function Held({ items }: { items: InventoryView }) {
  const { t } = useTranslation();
  const [using, setUsing] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (items.lines.length === 0) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {t("online.inventory.empty")}{" "}
            <Link to="/online/shop" className="font-semibold underline">
              {t("online.inventory.toShop")}
            </Link>
          </p>
        </CardBody>
      </Card>
    );
  }
  return (
    <>
      {done && (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          {done}
        </p>
      )}
      {ITEM_GROUPS.map((group) => {
        const lines = items.lines.filter((line) => groupOf(line.itemCode) === group);
        if (lines.length === 0) return null;
        return (
          <section key={group} aria-labelledby={`items-${group}`} className="space-y-3">
            <h3
              id={`items-${group}`}
              className="font-heading text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400"
            >
              {t(`online.inventory.group.${group}`)}
            </h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {lines.map((line) => (
                <ItemCard
                  key={line.itemCode}
                  line={line}
                  items={items}
                  onUse={() => {
                    setDone(null);
                    setUsing(line.itemCode);
                  }}
                />
              ))}
            </div>
          </section>
        );
      })}
      {using && (
        <UseItemDialog
          code={using}
          onClose={() => setUsing(null)}
          onDone={(text) => {
            setUsing(null);
            setDone(text);
          }}
        />
      )}
    </>
  );
}

/** The caps of the inventory's own (R17-2) that concern this item, as lines. */
function capLines(
  t: TFunction,
  language: string,
  code: string,
  limits: InventoryLimitsView,
): string[] {
  if (code === "teamRecoveryPack" && limits.teamRecovery) {
    return [
      t("online.inventory.teamRecovery", {
        used: limits.teamRecovery.usedToday,
        perDay: limits.teamRecovery.perDay,
        time: formatMoment(limits.teamRecovery.nextAt, language),
      }),
    ];
  }
  if (code.startsWith("tacticalNote")) {
    return limits.notes.map((note) =>
      t("online.inventory.noteXp", {
        style: t(`common.playStyles.${note.style}`, note.style),
        used: note.usedXp,
        limit: note.limit,
      }),
    );
  }
  if (code === "xpBoosterX2") {
    return [t("online.inventory.xpX2", { remaining: limits.xpX2.remaining, max: limits.xpX2.max })];
  }
  return [];
}

/** Why the item cannot be used here now, in the order the coach would fix it; `null` when it can. */
function useBlocker(
  code: string,
  items: InventoryView,
): { text: string; takeOver?: boolean } | null {
  const { t } = useTranslation();
  const hasClub = useOnlineStore((state) => Boolean(state.club));
  const kind = targetKindOf(code);
  if (!kind) return null;
  if (items.locked) return { text: t("online.inventory.lockedShort") };
  if (!items.limits) return { text: t("online.inventory.notThisSeason") };
  if ((kind === "player" || kind === "club") && !hasClub) {
    return { text: t("online.inventory.needClub"), takeOver: true };
  }
  return null;
}

function ItemCard({
  line,
  items,
  onUse,
}: {
  line: InventoryLineView;
  items: InventoryView;
  onUse: () => void;
}) {
  const { t, i18n } = useTranslation();
  const hasClub = useOnlineStore((state) => Boolean(state.club));
  const blocker = useBlocker(line.itemCode, items);
  const kind = targetKindOf(line.itemCode);
  const group = groupOf(line.itemCode);
  const caps = items.limits ? capLines(t, i18n.language, line.itemCode, items.limits) : [];

  return (
    <article aria-label={itemName(t, line.itemCode)}>
      <Card>
        <CardHeader>
          <span className="flex items-center gap-2">
            <Backpack className="h-4 w-4 text-accent-500 dark:text-accent-400" aria-hidden="true" />
            {itemName(t, line.itemCode)}
            <span className="ml-auto tabular-nums text-gray-500 dark:text-gray-400">
              ×{line.total}
            </span>
          </span>
        </CardHeader>
        <CardBody>
          <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
            {itemDescription(t, line.itemCode) && <p>{itemDescription(t, line.itemCode)}</p>}
            <ul
              aria-label={t("online.inventory.stacks")}
              className="text-xs text-gray-500 dark:text-gray-400"
            >
              {line.stacks.map((stack) => (
                <li key={stack.expiresAt ?? "never"}>
                  {stack.expiresAt
                    ? t("online.inventory.expires", {
                        count: stack.quantity,
                        date: formatDate(stack.expiresAt, i18n.language, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        }),
                      })
                    : t("online.inventory.neverExpires", { count: stack.quantity })}
                </li>
              ))}
            </ul>
            {caps.map((cap) => (
              <p key={cap} className="text-xs">
                {cap}
              </p>
            ))}
            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              {kind && (
                <>
                  {blocker && (
                    <span role="note" className="text-xs text-gray-500 dark:text-gray-400">
                      {blocker.text}
                      {blocker.takeOver && (
                        <>
                          {" "}
                          <Link to="/online/takeover" className="font-semibold underline">
                            {t("online.coins.takeOver")}
                          </Link>
                        </>
                      )}
                    </span>
                  )}
                  <Button type="button" size="sm" disabled={Boolean(blocker)} onClick={onUse}>
                    {t("online.inventory.use")}
                  </Button>
                </>
              )}
              {group === "custom" &&
                (hasClub ? (
                  <Link
                    to="/online/squad"
                    className="text-xs font-semibold text-primary-700 underline dark:text-primary-400"
                  >
                    {t("online.inventory.renameAt")}
                  </Link>
                ) : (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {t("online.inventory.renameAt")}
                  </span>
                ))}
              {group === "academy" && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {t("online.inventory.academySoon")}
                </span>
              )}
            </div>
          </div>
        </CardBody>
      </Card>
    </article>
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
  return delta < 0 ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-400";
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
    <Card>
      <CardHeader>{t("online.inventory.tabHistory")}</CardHeader>
      <CardBody className="p-0">
        <ResourceState resource={resource} reload={reload}>
          {() =>
            entries.length === 0 ? (
              <p className="px-5 py-4 text-sm text-gray-500 dark:text-gray-400">
                {t("online.inventory.historyEmpty")}
              </p>
            ) : (
              <ol
                aria-label={t("online.inventory.tabHistory")}
                className="flex flex-col divide-y divide-gray-100 dark:divide-navy-600"
              >
                {entries.map((entry) => {
                  const on = targetText(t, entry, players);
                  return (
                    <li key={entry.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                      <span className="w-32 shrink-0 text-xs text-gray-500 dark:text-gray-400">
                        {formatDate(entry.at, i18n.language, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      <span className="min-w-0 flex-1 text-gray-700 dark:text-gray-200">
                        {itemName(t, entry.itemCode)} · {sourceText(t, entry.source)}
                        {on && <span className="text-gray-500 dark:text-gray-400"> · {on}</span>}
                      </span>
                      <span className={`font-medium tabular-nums ${signedClass(entry.delta)}`}>
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
        <p className="border-t border-gray-100 px-5 py-2 text-xs text-gray-500 dark:border-navy-600 dark:text-gray-400">
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
      </CardBody>
    </Card>
  );
}
