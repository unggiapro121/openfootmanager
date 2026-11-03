import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MessageData } from "../../../store/types";
import type { InboxMessageView, InboxPage } from "../../api";
import { online } from "../../client";
import { toMessageData } from "../../convert/inbox";
import { tracked, useOnlineStore } from "../../store/onlineStore";
import { findMission } from "../events/eventText";
import { useActionKey } from "../useActionKey";

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
 * The coach's inbox as both layouts read it: every message, worded from its kind, newest first,
 * and the server's writes. A write answers with the first page, so the inbox is read again after
 * it; the club's unread count follows.
 */
export function useOnlineInbox() {
  const { t } = useTranslation();
  const club = useOnlineStore((state) => state.club);
  const unreadMail = club?.unreadMail ?? 0;
  const key = useActionKey();
  const [messages, setMessages] = useState<InboxMessageView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<unknown>(null);

  /** Take the server's inbox as the screen's, and tell the shell how many are unread. */
  const take = useCallback((next: { messages: InboxMessageView[]; unread: number }) => {
    setMessages(next.messages);
    setLoaded(true);
    const current = useOnlineStore.getState().club;
    if (current && current.unreadMail !== next.unread) {
      useOnlineStore.getState().setClub({ ...current, unreadMail: next.unread });
    }
  }, []);

  // Read when the screen opens and whenever the club says its unread count moved.
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

  const write = useCallback(
    async (run: (idempotencyKey: string) => Promise<InboxPage>, id: string) => {
      setError(null);
      try {
        await key.run((idempotencyKey) => tracked(() => run(idempotencyKey)), id);
        take(await readAll());
      } catch (failure) {
        setError(failure);
        throw failure;
      }
    },
    [key, take],
  );

  const clubName = club?.club.name ?? "";
  const youngsters = useOnlineStore((state) => state.academy?.players);
  const events = useOnlineStore((state) => state.events);
  const all: MessageData[] = useMemo(() => {
    const youngsterName = (id: string) => youngsters?.find((player) => player.id === id)?.name;
    const eventMission = (eventId: string, code: string) => findMission(events, eventId, code);
    return messages.map((message) =>
      toMessageData(message, t, clubName, youngsterName, eventMission),
    );
  }, [messages, t, clubName, youngsters, events]);

  return {
    all,
    loaded,
    error,
    write,
    markRead: (id: string) => write((k) => online.inbox.read(id, k), `read:${id}`),
    readEvery: () => write((k) => online.inbox.readAll(k), "read-all"),
    remove: (id: string) => write((k) => online.inbox.remove(id, k), `delete:${id}`),
    removeRead: () => write((k) => online.inbox.removeRead(k), "delete-read"),
  };
}
