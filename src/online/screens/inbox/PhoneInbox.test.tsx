import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHONE_QUERY } from "../../../hooks/usePhoneLayout";
import type { OnlineRequest } from "../../../services/onlineTransport";
import { fakeRealtime } from "../../../test-utils/onlineMatchKit";
import {
  fail,
  fakeServer,
  LEAGUE,
  myClub,
  ok,
  renderOnline,
  resetOnline,
  SEASON,
} from "../../../test-utils/onlineTestKit";
import type { InboxMessageView, InboxPage } from "../../api";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      options && typeof options === "object"
        ? `${key}:${Object.values(options as Record<string, unknown>).join("|")}`
        : key,
    i18n: { language: "en" },
  }),
}));

vi.mock("../../../utils/backendI18n", () => ({
  resolveBackendError: (error: unknown) =>
    `resolved:${error instanceof Error ? error.message : String(error)}`,
}));

const KEY = "online.inbox.phone";

const message = (overrides: Partial<InboxMessageView> & Pick<InboxMessageView, "id" | "kind">) =>
  ({
    params: {},
    createdAt: "2026-10-27T10:00:00Z",
    read: false,
    ...overrides,
  }) as InboxMessageView;

/** An auction won, a match played (read), and a player hurt the day before. */
const WON = message({
  id: "m1",
  kind: "market.won",
  params: { auctionId: "a1", playerName: "Nguyễn Văn A", price: 1_200_000 },
});
const RESULT = message({
  id: "m2",
  kind: "match.result",
  createdAt: "2026-10-27T09:00:00Z",
  read: true,
  params: { fixtureId: "f1", opponent: "Hà Nội FC", home: 1, scored: 2, conceded: 1, round: 5 },
});
const HURT = message({
  id: "m3",
  kind: "squad.injury",
  createdAt: "2026-10-26T08:00:00Z",
  params: { playerName: "Trần B", injury: "Hamstring", days: 4 },
});

let server: ReturnType<typeof fakeServer>;
let realtime: ReturnType<typeof fakeRealtime>;

function stage(initial: InboxMessageView[] = [WON, RESULT, HURT]) {
  let kept = initial;
  const page = (): InboxPage => ({
    messages: kept,
    unread: kept.filter((one) => !one.read).length,
  });
  const readOne = (request: OnlineRequest) => {
    const id = request.segments[2];
    kept = kept.map((one) => (one.id === id ? { ...one, read: true } : one));
    return ok(page());
  };
  const removeOne = (request: OnlineRequest) => {
    kept = kept.filter((one) => one.id !== request.segments[2]);
    return ok(page());
  };
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub({ unreadMail: initial.filter((m) => !m.read).length })),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/friendlies/mine": ok({}),
    "GET v1/clubs/mine/market": ok({ selling: [], holding: [], recent: [] }),
    "GET v1/me/coins": fail(404, "be.error.notFound"),
    "GET v1/inbox": () => ok(page()),
    "POST v1/inbox/m1/read": readOne,
    "POST v1/inbox/m2/read": readOne,
    "POST v1/inbox/m3/read": readOne,
    "POST v1/inbox/read": () => {
      kept = kept.map((one) => ({ ...one, read: true }));
      return ok(page());
    },
    "DELETE v1/inbox/m1": removeOne,
    "DELETE v1/inbox/m2": removeOne,
    "DELETE v1/inbox/m3": removeOne,
    "DELETE v1/inbox": () => {
      kept = kept.filter((one) => !one.read);
      return ok(page());
    },
  });
}

beforeEach(() => {
  resetOnline();
  realtime = fakeRealtime();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === PHONE_QUERY,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
});
afterEach(() => {
  server?.restore();
  realtime.restore();
  vi.unstubAllGlobals();
});

const requests = (method: string, path: string) =>
  server.requests.filter(
    (request) => request.method === method && request.segments.join("/") === path,
  );
const list = () => screen.getByRole("list", { name: `${KEY}.list` });
const row = (subject: RegExp) => within(list()).getByRole("button", { name: subject });
const rowsShown = () => within(list()).queryAllByRole("button").length;

async function open() {
  renderOnline("/online/inbox");
  return screen.findByRole("list", { name: `${KEY}.list` });
}

describe("the inbox on a phone", () => {
  // Given three messages over two days, two of them unread,
  // when the inbox opens on a phone,
  // then they are listed by day, newest first, with how many are unread, and none of the desktop
  // inbox's panes.
  it("lists the messages by day with the unread count", async () => {
    stage();
    await open();

    expect(screen.getByText(`${KEY}.counts:2|3`)).toBeInTheDocument();
    expect(within(list()).getAllByRole("heading")).toHaveLength(2);
    expect(rowsShown()).toBe(3);
    expect(row(/market\.won\.subject/)).toHaveAccessibleName(new RegExp(`^${KEY}\\.unreadRow`));
    expect(row(/match\.result\.subject/)).not.toHaveAccessibleName(
      new RegExp(`^${KEY}\\.unreadRow`),
    );
  });

  // Given the inbox,
  // when the coach keeps the unread only, then picks the injuries,
  // then the list narrows each time.
  it("filters with the quick chips", async () => {
    stage();
    await open();
    fireEvent.click(screen.getByRole("button", { name: /online\.inbox\.phone\.unreadChip/ }));
    expect(rowsShown()).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: /inbox\.categories\.Injury/ }));
    expect(rowsShown()).toBe(1);
    expect(row(/squad\.injury\.subject/)).toBeInTheDocument();
  });

  // Given an unread message,
  // when the coach opens it,
  // then it shows whole, the server is told it is read, and the next one is a step away.
  it("opens a message, marks it read and steps to the next", async () => {
    stage();
    await open();
    fireEvent.click(row(/market\.won\.subject/));

    const article = await screen.findByRole("article");
    expect(
      within(article).getByRole("heading", { name: /market\.won\.subject/ }),
    ).toBeInTheDocument();
    await waitFor(() => expect(requests("POST", "v1/inbox/m1/read")).toHaveLength(1));
    expect(screen.getByText(`${KEY}.position:1|3`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: `${KEY}.older` }));
    expect(
      within(screen.getByRole("article")).getByRole("heading", { name: /match\.result\.subject/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "inbox.title" }));
    expect(await screen.findByRole("list", { name: `${KEY}.list` })).toBeInTheDocument();
  });

  // Given a message deleted from its page,
  // when the coach undoes it,
  // then it is back and the server was never asked to delete it.
  it("takes back a delete", async () => {
    stage();
    await open();
    fireEvent.click(row(/match\.result\.subject/));
    fireEvent.click(await screen.findByRole("button", { name: `${KEY}.delete` }));

    expect(await screen.findByText(`${KEY}.deleted:1`)).toBeInTheDocument();
    expect(rowsShown()).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: `${KEY}.undo` }));
    expect(rowsShown()).toBe(3);
    expect(requests("DELETE", "v1/inbox/m2")).toHaveLength(0);
  });

  // Given a message deleted,
  // when the coach deletes another before the first can be taken back,
  // then the first is deleted on the server.
  it("deletes on the server once the undo has passed", async () => {
    stage();
    await open();
    fireEvent.click(row(/match\.result\.subject/));
    fireEvent.click(await screen.findByRole("button", { name: `${KEY}.delete` }));
    fireEvent.click(row(/squad\.injury\.subject/));
    fireEvent.click(await screen.findByRole("button", { name: `${KEY}.delete` }));

    await waitFor(() => expect(requests("DELETE", "v1/inbox/m2")).toHaveLength(1));
    expect(requests("DELETE", "v1/inbox/m3")).toHaveLength(0);
  });

  // Given the actions menu,
  // when the coach marks all read,
  // then the server is asked once, and no row is unread any more.
  it("marks every message read from the menu", async () => {
    stage();
    await open();
    fireEvent.click(screen.getByRole("button", { name: `${KEY}.actions` }));
    fireEvent.click(screen.getByRole("button", { name: /online\.inbox\.phone\.readAll/ }));

    await waitFor(() => expect(requests("POST", "v1/inbox/read")).toHaveLength(1));
    await waitFor(() =>
      expect(row(/market\.won\.subject/)).not.toHaveAccessibleName(
        new RegExp(`^${KEY}\\.unreadRow`),
      ),
    );
  });

  // Given the inbox,
  // when the coach chooses several messages and deletes them,
  // then they go from the list at once.
  it("deletes several chosen messages", async () => {
    stage();
    await open();
    fireEvent.click(screen.getByRole("button", { name: `${KEY}.actions` }));
    fireEvent.click(screen.getByRole("button", { name: /online\.inbox\.phone\.selectMany/ }));
    fireEvent.click(row(/market\.won\.subject/));
    fireEvent.click(row(/squad\.injury\.subject/));
    expect(screen.getByText(`${KEY}.selected:2`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: `${KEY}.deleteSelected` }));
    expect(rowsShown()).toBe(1);
    expect(await screen.findByText(`${KEY}.deleted:2`)).toBeInTheDocument();
  });

  // Given the filter sheet,
  // when the coach keeps the unread results and injuries, oldest first,
  // then the list shows those, and the filters can be cleared at once.
  it("filters from the sheet and clears", async () => {
    stage();
    await open();
    fireEvent.click(screen.getByRole("button", { name: `${KEY}.filters` }));
    const sheet = screen.getByRole("dialog", { name: `${KEY}.filterTitle` });
    fireEvent.click(within(sheet).getByRole("radio", { name: `${KEY}.unreadOnly` }));
    fireEvent.click(within(sheet).getByRole("checkbox", { name: /inbox\.categories\.Injury/ }));
    fireEvent.click(within(sheet).getByRole("button", { name: `${KEY}.showCount:1` }));

    expect(rowsShown()).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: `${KEY}.clearFilters` }));
    expect(rowsShown()).toBe(3);
  });
});
