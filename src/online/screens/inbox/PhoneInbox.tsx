import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { EllipsisVertical, Inbox } from "lucide-react";
import type { MessageData } from "../../../store/types";
import { resolveBackendError } from "../../../utils/backendI18n";
import { FOCUS } from "../mobile/PhoneSheet";
import { PhoneHeaderPart } from "../mobile/PhoneHeaderSlots";
import { byDay, filterInbox, filtersOn, type InboxFilter, NO_FILTER } from "./inboxView";
import {
  ActionsSheet,
  DayHeading,
  FilterSheet,
  MessageDetail,
  MessageRow,
  QuickFilters,
  SelectionBar,
  useClockTime,
} from "./PhoneInboxParts";
import type { useOnlineInbox } from "./useOnlineInbox";

const KEY = "online.inbox.phone";
/** Messages listed at first, and added by each "more". */
const PAGE = 30;
/** How long a delete can be taken back before it goes to the server. */
const UNDO_MS = 4000;

type InboxState = ReturnType<typeof useOnlineInbox>;

/** A delete waiting out its undo: the messages it hides, and what it asks the server. */
interface PendingDelete {
  ids: string[];
  commit: () => Promise<unknown>;
}

/**
 * Deletes that wait a moment before reaching the server, so a toast can take them back. A new
 * delete, the end of the wait, or leaving the page sends the one waiting.
 */
function useUndoableDelete(onFailure: (failure: unknown) => void) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const pending = useRef<{ delete: PendingDelete; timer: ReturnType<typeof setTimeout> } | null>(
    null,
  );
  const failed = useRef(onFailure);
  failed.current = onFailure;

  const send = () => {
    const waiting = pending.current;
    if (!waiting) return;
    clearTimeout(waiting.timer);
    pending.current = null;
    waiting.delete.commit().catch((failure) => {
      setHidden(
        (current) => new Set([...current].filter((id) => !waiting.delete.ids.includes(id))),
      );
      failed.current(failure);
    });
  };
  useEffect(() => () => send(), []);

  return {
    hidden,
    later: (next: PendingDelete, onSent: () => void) => {
      send();
      setHidden((current) => new Set([...current, ...next.ids]));
      pending.current = {
        delete: next,
        timer: setTimeout(() => {
          send();
          onSent();
        }, UNDO_MS),
      };
    },
    undo: () => {
      const waiting = pending.current;
      if (!waiting) return;
      clearTimeout(waiting.timer);
      pending.current = null;
      setHidden(
        (current) => new Set([...current].filter((id) => !waiting.delete.ids.includes(id))),
      );
    },
  };
}

/**
 * The inbox on a phone (design m-hop-thu): the unread count, quick filters and a filter sheet, the
 * messages by day, a message opened whole with its way to the page it is about, choosing several
 * to read or delete, and deletes that can be taken back for a moment.
 */
export default function PhoneInbox({ inbox }: { inbox: InboxState }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<InboxFilter>(NO_FILTER);
  const [shownCount, setShownCount] = useState(PAGE);
  const [openId, setOpenId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"filter" | "menu" | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [toast, setToast] = useState<{ text: string; undo: boolean } | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const deletes = useUndoableDelete(setFailure);

  const live = inbox.all.filter((message) => !deletes.hidden.has(message.id));
  const list = filterInbox(live, filter);
  const shown = list.slice(0, shownCount);
  const unread = live.filter((message) => !message.read).length;
  const opened = openId ? live.find((message) => message.id === openId) : undefined;
  const at = opened ? list.indexOf(opened) : -1;
  const error = failure ?? inbox.error;

  const flash = (text: string, undo = false) => setToast({ text, undo });
  const remove = (ids: string[]) => {
    deletes.later(
      {
        ids,
        commit: async () => {
          for (const id of ids) await inbox.remove(id);
        },
      },
      () => setToast(null),
    );
    setOpenId(null);
    setSelecting(false);
    setChosen([]);
    flash(t(`${KEY}.deleted`, { count: ids.length }), true);
  };
  const open = (id: string) => {
    setOpenId(id);
    const message = live.find((one) => one.id === id);
    if (message && !message.read) void inbox.markRead(id).catch(() => undefined);
  };
  const tap = (id: string) => {
    if (!selecting) return open(id);
    setChosen((current) =>
      current.includes(id) ? current.filter((one) => one !== id) : [...current, id],
    );
  };
  const markChosenRead = () => {
    const ids = chosen.filter((id) => live.find((one) => one.id === id && !one.read));
    void (async () => {
      for (const id of ids) await inbox.markRead(id);
    })().catch(() => undefined);
    setSelecting(false);
    setChosen([]);
    flash(t(`${KEY}.markedRead`, { count: ids.length }));
  };
  const shownIds = shown.map((message) => message.id);
  const allChosen = shownIds.length > 0 && shownIds.every((id) => chosen.includes(id));

  if (opened) {
    return (
      <MessageDetail
        message={opened}
        position={at + 1}
        total={list.length}
        onBack={() => setOpenId(null)}
        onNewer={at > 0 ? () => open(list[at - 1].id) : undefined}
        onOlder={at >= 0 && at < list.length - 1 ? () => open(list[at + 1].id) : undefined}
        onGo={navigate}
        onDelete={() => remove([opened.id])}
      />
    );
  }

  return (
    <div className="-mx-3 -mt-3 flex flex-col">
      <PhoneHeaderPart place="actions">
        <button
          type="button"
          onClick={() => setSheet("menu")}
          aria-label={t(`${KEY}.actions`)}
          aria-haspopup="dialog"
          className={`flex h-11 w-11 items-center justify-center rounded-full text-gray-700 dark:text-gray-200 ${FOCUS}`}
        >
          <EllipsisVertical className="h-5.5 w-5.5" aria-hidden="true" />
        </button>
      </PhoneHeaderPart>
      <PhoneHeaderPart place="below">
        {selecting && (
          <SelectionBar
            count={chosen.length}
            allChosen={allChosen}
            onToggleAll={() => setChosen(allChosen ? [] : shownIds)}
            onRead={markChosenRead}
            onDelete={() => remove(chosen)}
            onExit={() => {
              setSelecting(false);
              setChosen([]);
            }}
          />
        )}
        <QuickFilters
          all={live}
          filter={filter}
          onFilter={(next) => {
            setFilter(next);
            setShownCount(PAGE);
          }}
          onOpenSheet={() => setSheet("filter")}
          activeCount={filtersOn(filter)}
        />
      </PhoneHeaderPart>

      <InboxList
        live={live}
        list={list}
        shownCount={shownCount}
        loaded={inbox.loaded}
        error={error}
        filtered={filtersOn(filter) > 0}
        selecting={selecting}
        chosen={chosen}
        onClear={() => setFilter(NO_FILTER)}
        onTap={tap}
        onMore={() => setShownCount(shownCount + PAGE)}
      />

      {sheet === "filter" && (
        <FilterSheet
          all={live}
          filter={filter}
          onApply={(next) => {
            setFilter(next);
            setShownCount(PAGE);
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "menu" && (
        <ActionsSheet
          unread={unread}
          read={live.length - unread}
          onSelect={() => {
            setSelecting(true);
            setChosen([]);
            setSheet(null);
          }}
          onReadAll={() => {
            void inbox.readEvery().catch(() => undefined);
            setSheet(null);
            flash(t(`${KEY}.markedRead`, { count: unread }));
          }}
          onDeleteRead={() => {
            const ids = live.filter((message) => message.read).map((message) => message.id);
            deletes.later({ ids, commit: inbox.removeRead }, () => setToast(null));
            setSheet(null);
            flash(t(`${KEY}.deleted`, { count: ids.length }), true);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {toast && (
        <div
          role="status"
          className="fixed inset-x-4 bottom-[calc(5.5rem+var(--safe-bottom))] z-50 flex items-center gap-2.5 rounded-xl bg-navy-800 py-2.5 pl-3.5 pr-2 text-[13px] text-white shadow-xl dark:bg-navy-600"
        >
          <span className="flex-1">{toast.text}</span>
          {toast.undo && (
            <button
              type="button"
              onClick={() => {
                deletes.undo();
                setToast(null);
              }}
              className={`h-[34px] rounded-lg px-3 text-[13px] font-bold uppercase tracking-wide text-primary-300 ${FOCUS}`}
            >
              {t(`${KEY}.undo`)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The list itself: the counts, a failure, the filters on, the messages by day, and more of them. */
function InboxList({
  live,
  list,
  shownCount,
  loaded,
  error,
  filtered,
  selecting,
  chosen,
  onClear,
  onTap,
  onMore,
}: {
  live: MessageData[];
  list: MessageData[];
  shownCount: number;
  loaded: boolean;
  error: unknown;
  filtered: boolean;
  selecting: boolean;
  chosen: string[];
  onClear: () => void;
  onTap: (id: string) => void;
  onMore: () => void;
}) {
  const { t, i18n } = useTranslation();
  const timeOf = useClockTime(i18n.language);
  const unread = live.filter((message) => !message.read).length;
  return (
    <>
      <p className="mx-4 mt-3 text-xs text-gray-600 dark:text-gray-400">
        {t(`${KEY}.counts`, { unread, total: live.length })}
      </p>
      {error !== null && (
        <p role="alert" className="mx-4 mt-2 text-sm text-red-600 dark:text-red-400">
          {resolveBackendError(error)}
        </p>
      )}
      {filtered && (
        <div className="mx-4 mt-2 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
          <span className="flex-1">{t(`${KEY}.activeCount`, { count: list.length })}</span>
          <button
            type="button"
            onClick={onClear}
            className={`h-8 rounded-lg bg-white px-2.5 text-xs font-semibold text-primary-700 dark:bg-navy-800 dark:text-primary-400 ${FOCUS}`}
          >
            {t(`${KEY}.clearFilters`)}
          </button>
        </div>
      )}
      <main className="px-4 pb-4 pt-1">
        {loaded && list.length === 0 && (
          <div className="mt-10 flex flex-col items-center gap-2.5 text-center text-[13px] text-gray-500 dark:text-gray-400">
            <Inbox className="h-10 w-10 text-gray-300 dark:text-navy-600" aria-hidden="true" />
            {t(live.length === 0 ? "inbox.noMessages" : "inbox.noMessagesInCategory")}
          </div>
        )}
        <ul aria-label={t(`${KEY}.list`)}>
          {byDay(list.slice(0, shownCount)).map((day) => (
            <li key={day.key}>
              <DayHeading date={day.date} />
              <ul>
                {day.messages.map((message) => (
                  <li key={message.id}>
                    <MessageRow
                      message={message}
                      time={timeOf(message.date)}
                      selecting={selecting}
                      chosen={chosen.includes(message.id)}
                      onTap={() => onTap(message.id)}
                    />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {list.length > shownCount && (
          <button
            type="button"
            onClick={onMore}
            className={`mt-2 h-11 w-full rounded-[10px] border border-gray-200 bg-white text-[13px] font-semibold text-gray-700 dark:border-navy-700 dark:bg-navy-800 dark:text-gray-200 ${FOCUS}`}
          >
            {t(`${KEY}.more`, { count: list.length - shownCount })}
          </button>
        )}
      </main>
    </>
  );
}
