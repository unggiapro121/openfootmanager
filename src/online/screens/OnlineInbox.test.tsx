import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fakeServer,
  LEAGUE,
  myClub,
  ok,
  renderOnline,
  resetOnline,
  SEASON,
} from "../../test-utils/onlineTestKit";
import type { InboxMessageView, InboxPage } from "../api";
import { useOnlineStore } from "../store/onlineStore";

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

let server: ReturnType<typeof fakeServer>;

beforeEach(() => resetOnline());
afterEach(() => server?.restore());

const message = (overrides: Partial<InboxMessageView> & Pick<InboxMessageView, "id" | "kind">) =>
  ({
    params: {},
    createdAt: "2026-10-27T10:00:00Z",
    read: false,
    ...overrides,
  }) as InboxMessageView;

const WON = message({
  id: "m1",
  kind: "market.won",
  params: { auctionId: "a1", playerName: "Nguyễn Văn A", price: 1_200_000 },
});
const RESULT = message({
  id: "m2",
  kind: "match.result",
  createdAt: "2026-10-27T09:00:00Z",
  params: { fixtureId: "f1", opponent: "Hà Nội FC", home: 1, scored: 2, conceded: 1, round: 5 },
});

/** The server's inbox: the messages it keeps, a write changing them as the real one does. */
function stage(initial: InboxMessageView[], unreadMail = initial.filter((m) => !m.read).length) {
  let kept = initial;
  const page = (): InboxPage => ({
    messages: kept,
    unread: kept.filter((one) => !one.read).length,
  });
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub({ unreadMail })),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/inbox": () => ok(page()),
    "POST v1/inbox/m1/read": () => {
      kept = kept.map((one) => (one.id === "m1" ? { ...one, read: true } : one));
      return ok(page());
    },
    "POST v1/inbox/read": () => {
      kept = kept.map((one) => ({ ...one, read: true }));
      return ok(page());
    },
    "DELETE v1/inbox/m2": () => {
      kept = kept.filter((one) => one.id !== "m2");
      return ok(page());
    },
  });
}

describe("the online inbox", () => {
  // Given an inbox with an auction won and a match played,
  // when the page opens,
  // then both messages are listed in the offline inbox's list, worded from their kinds.
  it("lists the messages, worded from their kinds", async () => {
    stage([WON, RESULT]);
    renderOnline("/online/inbox");

    expect(
      await screen.findByText(/online\.inbox\.kinds\.market\.won\.subject:Nguyễn Văn A/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /online\.inbox\.kinds\.match\.result\.subject:5\|Cầu Vồng Nghệ An\|Hà Nội FC\|2\|1/,
      ),
    ).toBeInTheDocument();
  });

  // Given an unread message,
  // when the coach opens it,
  // then the server is told it is read, and the unread count of the club goes down.
  it("marks a message read when it is opened", async () => {
    stage([WON, RESULT]);
    renderOnline("/online/inbox");

    fireEvent.click(await screen.findByText(/online\.inbox\.kinds\.market\.won\.subject/));

    await waitFor(() =>
      expect(server.requests.some((r) => r.segments.join("/") === "v1/inbox/m1/read")).toBe(true),
    );
    await waitFor(() => expect(useOnlineStore.getState().club?.unreadMail).toBe(1));
  });

  // Given the mail that a scouting report on the next opponent is back,
  // when the coach opens it,
  // then it shows its way to the report and no youth target: no youth was searched for.
  it("shows no youth target on the opponent report's mail", async () => {
    stage([
      message({
        id: "m3",
        kind: "opponentReport.ready",
        params: { reportId: "r1", fixtureId: "f1", opponentClubId: "club-2" },
      }),
    ]);
    renderOnline("/online/inbox");

    fireEvent.click(
      await screen.findByText(/online\.inbox\.kinds\.opponentReport\.ready\.subject/),
    );

    expect(
      await screen.findByRole("button", { name: "online.opponentReport.open" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("scouting.youthTargetLabel")).toBeNull();
  });

  // Given two unread messages,
  // when the coach marks all read,
  // then the club has none unread.
  it("marks every message read", async () => {
    stage([WON, RESULT]);
    renderOnline("/online/inbox");

    fireEvent.click(await screen.findByRole("button", { name: /inbox\.markAllRead/ }));

    await waitFor(() => expect(useOnlineStore.getState().club?.unreadMail).toBe(0));
    const write = server.requests.find((r) => r.segments.join("/") === "v1/inbox/read");
    expect(write?.method).toBe("POST");
    expect(write?.idempotencyKey).toEqual(expect.any(String));
  });

  // Given a message,
  // when the coach deletes it and confirms,
  // then it goes to the server's delete route and leaves the list.
  it("deletes a message after confirmation", async () => {
    stage([WON, RESULT]);
    renderOnline("/online/inbox");

    fireEvent.click(await screen.findByText(/online\.inbox\.kinds\.match\.result\.subject/));
    fireEvent.click(await screen.findByTestId("inbox-delete-message"));
    fireEvent.click(await screen.findByTestId("inbox-confirm-delete"));

    await waitFor(() =>
      expect(server.requests.some((r) => r.segments.join("/") === "v1/inbox/m2")).toBe(true),
    );
    await waitFor(() =>
      expect(screen.queryByText(/online\.inbox\.kinds\.match\.result\.subject/)).toBeNull(),
    );
  });

  // Given a mail that the seller's player is up again in a new auction,
  // when the coach opens it and chooses its link,
  // then the new auction opens.
  it("opens the auction a mail points to", async () => {
    stage([
      message({
        id: "m1",
        kind: "market.cancelled",
        params: { playerName: "Bình", reason: "buyCapExceeded", relistedAuctionId: "a-9" },
      }),
    ]);
    renderOnline("/online/inbox");
    fireEvent.click(await screen.findByText(/online\.inbox\.kinds\.market\.cancelled\.subject/));
    fireEvent.click(await screen.findByRole("button", { name: "online.inbox.viewNewAuction" }));
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "location" }).textContent).toBe(
        "/online/auctions/a-9",
      ),
    );
  });
});
