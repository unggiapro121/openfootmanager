import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import InboxDeleteConfirmModal from "../../components/inbox/InboxDeleteConfirmModal";
import InboxMessageDetailPane from "../../components/inbox/InboxMessageDetailPane";
import InboxMessageListPane from "../../components/inbox/InboxMessageListPane";
import InboxToolbar from "../../components/inbox/InboxToolbar";
import {
  type DeleteModalState,
  getFilteredMessages,
  isNavigateAction,
  type MessageSortOrder,
  sortInboxMessages,
} from "../../components/inbox/inboxHelpers";
import { resolveBackendError } from "../../utils/backendI18n";
import type { InboxMessageView, InboxPage } from "../api";
import { online } from "../client";
import { toMessageData } from "../convert/inbox";
import { findMission } from "./events/eventText";
import { tracked, useOnlineStore } from "../store/onlineStore";
import { useActionKey } from "./useActionKey";

/** Pages read to fill the screen: an inbox keeps 200 messages, 100 a page. */
const PAGE = 100;
const MOST_PAGES = 2;

/** Every message the inbox keeps, newest first. */
async function readAll(): Promise<{ messages: InboxMessageView[]; unread: number }> {
  const messages: InboxMessageView[] = [];
  let before: string | undefined;
  let unread = 0;
  for (let page = 0; page < MOST_PAGES; page += 1) {
    const next: InboxPage = await tracked(() => online.inbox.list(before, PAGE));
    messages.push(...next.messages);
    unread = next.unread;
    before = next.nextBefore;
    if (before === undefined) break;
  }
  return { messages, unread };
}

/**
 * The coach's inbox: what happened to his club (an auction's end, a match, a season's end). The
 * offline inbox's list, detail and toolbar, over the server's messages; the words are written here
 * from each message's kind. A write answers with the first page, so the screen reads the rest again.
 */
export default function OnlineInbox() {
  const { t, i18n } = useTranslation();
  const club = useOnlineStore((state) => state.club);
  const unreadMail = club?.unreadMail ?? 0;
  const key = useActionKey();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<InboxMessageView[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<MessageSortOrder>("newest");
  const [bulk, setBulk] = useState(false);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [deleteState, setDeleteState] = useState<DeleteModalState>(null);
  const [deleting, setDeleting] = useState(false);

  /** Take the server's inbox as the screen's, and tell the sidebar how many are unread. */
  const take = useCallback((next: { messages: InboxMessageView[]; unread: number }) => {
    setMessages(next.messages);
    const current = useOnlineStore.getState().club;
    if (current && current.unreadMail !== next.unread) {
      useOnlineStore.getState().setClub({ ...current, unreadMail: next.unread });
    }
  }, []);

  // Read when the screen opens and whenever the club says its unread count moved.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `unreadMail` is the trigger
  useEffect(() => {
    let live = true;
    readAll()
      .then((next) => {
        if (live) take(next);
      })
      .catch((failure) => {
        if (live) setError(failure);
      });
    return () => {
      live = false;
    };
  }, [take, unreadMail]);

  const write = async (run: (idempotencyKey: string) => Promise<InboxPage>, id: string) => {
    setError(null);
    try {
      await key.run((idempotencyKey) => tracked(() => run(idempotencyKey)), id);
      take(await readAll());
    } catch (failure) {
      setError(failure);
      throw failure;
    }
  };

  const clubName = club?.club.name ?? "";
  const youngsters = useOnlineStore((state) => state.academy?.players);
  const events = useOnlineStore((state) => state.events);
  const all = useMemo(() => {
    const youngsterName = (id: string) => youngsters?.find((player) => player.id === id)?.name;
    const eventMission = (eventId: string, code: string) => findMission(events, eventId, code);
    return messages.map((message) =>
      toMessageData(message, t, clubName, youngsterName, eventMission),
    );
  }, [messages, t, clubName, youngsters, events]);
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const message of all)
      counts.set(message.category, (counts.get(message.category) ?? 0) + 1);
    return counts;
  }, [all]);
  const shown = useMemo(
    () => sortInboxMessages(getFilteredMessages(all, categoryFilter), sortOrder),
    [all, categoryFilter, sortOrder],
  );
  const selected = all.find((message) => message.id === selectedId) ?? null;
  const unread = all.filter((message) => !message.read).length;

  const select = (id: string) => {
    setSelectedId(id);
    const message = all.find((one) => one.id === id);
    if (message && !message.read) {
      void write((k) => online.inbox.read(id, k), `read:${id}`).catch(() => undefined);
    }
  };

  const confirmDelete = async () => {
    if (!deleteState) return;
    setDeleting(true);
    const ids = deleteState.mode === "single" ? [deleteState.messageId] : deleteState.messageIds;
    try {
      for (const id of ids) {
        await write((k) => online.inbox.remove(id, k), `delete:${id}`);
      }
      setCheckedIds((current) => current.filter((id) => !ids.includes(id)));
      if (selectedId && ids.includes(selectedId)) setSelectedId(null);
      if (deleteState.mode === "bulk") setBulk(false);
      setDeleteState(null);
    } catch {
      // The error is shown above the list; the dialog stays for another try.
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {error !== null && (
        <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">
          {resolveBackendError(error)}
        </p>
      )}
      <InboxToolbar
        allMessagesCount={all.length}
        bulkSelectionEnabled={bulk}
        categories={Array.from(categoryCounts.keys())}
        categoryCounts={categoryCounts}
        categoryFilter={categoryFilter}
        selectedMessageCount={checkedIds.length}
        sortOrder={sortOrder}
        unreadCount={unread}
        onClearOld={() => {
          setSelectedId(null);
          void write((k) => online.inbox.removeRead(k), "delete-read").catch(() => undefined);
        }}
        onDeleteSelected={() => {
          if (checkedIds.length > 0) setDeleteState({ mode: "bulk", messageIds: checkedIds });
        }}
        onMarkAllRead={() => {
          void write((k) => online.inbox.readAll(k), "read-all").catch(() => undefined);
        }}
        onShowAll={() => setCategoryFilter(null)}
        onShowUnread={() => setCategoryFilter("__unread")}
        onSortOrderChange={setSortOrder}
        onToggleBulkSelectionMode={() => {
          if (bulk) setCheckedIds([]);
          setBulk(!bulk);
        }}
        onToggleCategory={(category) =>
          setCategoryFilter((current) => (current === category ? null : category))
        }
      />
      <div className="flex min-h-0 flex-1 gap-0 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-navy-600 dark:bg-navy-800">
        <InboxMessageListPane
          bulkSelectionEnabled={bulk}
          filteredMessages={shown}
          hasSelectedMessage={selected !== null}
          language={i18n.language}
          selectedMessageId={selectedId}
          selectedMessageIds={checkedIds}
          onRequestDeleteMessage={(message) =>
            setDeleteState({ mode: "single", messageId: message.id, subject: message.subject })
          }
          onRequestMarkMessageRead={select}
          onSelectMessage={select}
          onToggleMessageSelection={(id) =>
            setCheckedIds((current) =>
              current.includes(id) ? current.filter((one) => one !== id) : [...current, id],
            )
          }
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <InboxMessageDetailPane
            effectFeedback={null}
            currentTeamId={club?.club.id ?? null}
            currentTeamName={club?.club.name ?? null}
            language={i18n.language}
            selectedMessage={selected}
            onAction={(messageId, actionId) => {
              // The only actions an online message has open a page it points to.
              const action = all
                .find((one) => one.id === messageId)
                ?.actions.find((one) => one.id === actionId);
              if (action && isNavigateAction(action.action_type)) {
                navigate(action.action_type.NavigateTo.route);
              }
            }}
            onCloseSelectedMessage={() => setSelectedId(null)}
            onRequestDelete={() => {
              if (selected) {
                setDeleteState({
                  mode: "single",
                  messageId: selected.id,
                  subject: selected.subject,
                });
              }
            }}
            onScoutPlayerClick={() => undefined}
          />
        </div>
      </div>
      <InboxDeleteConfirmModal
        deleteModalState={deleteState}
        isDeleting={deleting}
        onCancel={() => {
          if (!deleting) setDeleteState(null);
        }}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
