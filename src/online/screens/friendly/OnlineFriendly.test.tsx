import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type RealtimeMessage, setOnlineRealtime } from "../../../services/onlineRealtime";
import type { OnlineRequest } from "../../../services/onlineTransport";
import {
  type Answer,
  fail,
  fakeServer,
  LEAGUE,
  myClub,
  ok,
  renderOnline,
  resetOnline,
  SEASON,
} from "../../../test-utils/onlineTestKit";
import { matchView } from "../../../test-utils/onlineMatchKit";
import type { FriendlyMineView, FriendlyRoomView, FriendlySideView } from "../../api";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      options && typeof options === "object"
        ? `${key}:${Object.values(options as Record<string, unknown>).join("|")}`
        : key,
    i18n: { language: "en" },
  }),
}));

vi.mock("../../../utils/backendI18n", () => ({
  resolveBackendError: (error: unknown) => `resolved:${(error as { code?: string }).code}`,
}));

const ACCOUNT = "0192f0c4-0000-7000-8000-0000000000a1";

/** A fake realtime transport: records each watch and lets the test speak on it. */
function fakeRealtime() {
  const watches: Array<{
    channel: string;
    speak: (message: RealtimeMessage) => void;
    stopped: boolean;
  }> = [];
  const restore = setOnlineRealtime({
    watch: (channel, _lastSeq, onMessage) => {
      const watch = { channel, speak: onMessage, stopped: false };
      // The shell's league watcher follows the club's league too; these tests watch the rest.
      if (!channel.startsWith("league:")) watches.push(watch);
      return Promise.resolve(async () => {
        watch.stopped = true;
      });
    },
  });
  return { watches, restore };
}

function side(name: string, ready = false): FriendlySideView {
  return {
    club: { ...myClub().club, name },
    strengthTop18: 71.4,
    coach: { firstName: "An", lastName: "Trần", fullName: `Trần An (${name})` },
    ready,
  };
}

function room(overrides: Partial<FriendlyRoomView> = {}): FriendlyRoomView {
  return {
    id: "room-1",
    kind: "private",
    code: "K7Q-2MX",
    status: "full",
    leg: 1,
    readyDeadline: "2099-01-01T00:00:00Z",
    me: "host",
    host: side("Cầu Vồng Nghệ An"),
    guest: side("Sóng Biển Đà Nẵng"),
    home: "host",
    ...overrides,
  };
}

const inRoom = (overrides: Partial<FriendlyRoomView> = {}): FriendlyMineView => ({
  seat: { state: "room", room: room(overrides) },
});

let server: ReturnType<typeof fakeServer>;
let realtime: ReturnType<typeof fakeRealtime>;

/** The shell's reads, the coach's account, and `friendly` as their friendly. */
function serve(
  friendly: Answer | ((request: OnlineRequest) => Answer),
  more: Record<string, Answer | ((request: OnlineRequest) => Answer)> = {},
) {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub()),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/me": ok({ id: ACCOUNT }),
    "GET v1/friendlies/mine": friendly,
    ...more,
  });
}

const sent = (method: string, path: string) =>
  server.requests.filter(
    (request) => request.method === method && request.segments.join("/") === path,
  );

beforeEach(() => {
  resetOnline();
  realtime = fakeRealtime();
  window.localStorage.clear();
});

afterEach(() => {
  server?.restore();
  realtime.restore();
});

describe("friendlies", () => {
  // Given a coach with no friendly,
  // when they open the friendly page, type a code in lower case without its dash, and join,
  // then the field shows the code as `K7Q-2MX`, the join sends it with a key, and the room the
  // server answers is shown with both clubs.
  it("joins a room by its code", async () => {
    serve(ok({}), { "POST v1/friendlies/rooms/join": ok(inRoom({ me: "guest" })) });
    renderOnline("/online/friendly");

    const field = await screen.findByLabelText("online.friendly.join.label");
    fireEvent.change(field, { target: { value: "k7q2mx" } });
    expect(field).toHaveValue("K7Q-2MX");
    fireEvent.click(screen.getByRole("button", { name: "online.friendly.join.button" }));

    expect(await screen.findByText("Sóng Biển Đà Nẵng")).toBeInTheDocument();
    const [join] = sent("POST", "v1/friendlies/rooms/join");
    expect(join?.body).toEqual({ code: "K7Q-2MX" });
    expect(join?.idempotencyKey).toBeTruthy();
  });

  // Given a code the server cannot join,
  // when the coach joins with it,
  // then the refusal is shown and they stay on the friendly page.
  it("shows why a code could not be joined", async () => {
    serve(ok({}), {
      "POST v1/friendlies/rooms/join": fail(404, "be.error.friendly.roomNotFound"),
    });
    renderOnline("/online/friendly");

    fireEvent.change(await screen.findByLabelText("online.friendly.join.label"), {
      target: { value: "ZZZZZZ" },
    });
    fireEvent.click(screen.getByRole("button", { name: "online.friendly.join.button" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "resolved:be.error.friendly.roomNotFound",
    );
  });

  // Given a coach who joins the queue,
  // when they go to the tactics page while they wait,
  // then their account channel is still followed (they stay present), the header still shows
  // the search, and its link takes them back to the friendly page.
  it("keeps a queued coach present on other online pages", async () => {
    const queued: FriendlyMineView = {
      seat: { state: "queued", queuedAt: new Date().toISOString() },
    };
    let mine: FriendlyMineView = {};
    serve(() => ok(mine), {
      "POST v1/friendlies/queue": () => {
        mine = queued;
        return ok(queued);
      },
      "GET v1/clubs/mine/fixtures": ok({ fixtures: [] }),
    });
    renderOnline("/online/friendly");

    fireEvent.click(await screen.findByRole("button", { name: "online.friendly.queue.button" }));
    expect(
      await screen.findByRole("button", { name: "online.friendly.queued.cancel" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "online.nav.tactics" }));
    await waitFor(() =>
      expect(screen.getByLabelText("location")).toHaveTextContent("/online/tactics"),
    );

    const [watch] = realtime.watches;
    expect(watch?.channel).toBe(`account:${ACCOUNT}`);
    expect(watch?.stopped).toBe(false);
    const chip = screen.getByRole("link", { name: /online\.friendly\.chip\.searching/ });
    fireEvent.click(chip);
    await waitFor(() =>
      expect(screen.getByLabelText("location")).toHaveTextContent("/online/friendly"),
    );
  });

  // Given a full room where the other coach is ready,
  // when this coach gets ready, and the server then rings that the match started,
  // then the ready goes out, and the ring reads the friendly again and takes the coach to the
  // match.
  it("gets ready and is taken to the match when it starts", async () => {
    let mine = inRoom({ guest: side("Sóng Biển Đà Nẵng", true) });
    serve(() => ok(mine), {
      "POST v1/friendlies/rooms/mine/ready": () => {
        mine = inRoom({ status: "starting", host: side("Cầu Vồng Nghệ An", true) });
        return ok(mine);
      },
      "GET v1/matches/match-7": ok(
        matchView({ id: "match-7", kind: "friendly", status: "finished" }),
      ),
    });
    renderOnline("/online/friendly");

    fireEvent.click(await screen.findByRole("button", { name: "online.friendly.room.ready" }));
    expect(await screen.findByText("online.friendly.room.starting")).toBeInTheDocument();
    expect(sent("POST", "v1/friendlies/rooms/mine/ready")[0]?.body).toEqual({ ready: true });

    mine = inRoom({ status: "playing", matchId: "match-7" });
    await waitFor(() => expect(realtime.watches).toHaveLength(1));
    act(() => {
      realtime.watches[0]?.speak({
        kind: "notice",
        channel: `account:${ACCOUNT}`,
        data: { kind: "friendly" },
      });
    });

    await waitFor(() =>
      expect(screen.getByLabelText("location")).toHaveTextContent("/online/match/match-7"),
    );
  });

  // Given a full room (C-23a §6.1, Q-OS2),
  // when the host looks at it,
  // then the other club links its opponent profile, with no fixture, and his own club does not.
  it("links the other club's opponent profile", async () => {
    const guest = side("Sóng Biển Đà Nẵng");
    serve(ok(inRoom({ guest: { ...guest, club: { ...guest.club, id: "club-2" } } })));
    renderOnline("/online/friendly");

    const links = await screen.findAllByRole("link", { name: "online.opponent.open" });
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/online/clubs/club-2/opponent",
    ]);
  });

  // Given a coach whose last room closed because the other coach left,
  // when they open the friendly page, dismiss the notice, and open the page again,
  // then the reason is shown once, and not again after it was dismissed.
  it("tells once why the last room ended", async () => {
    serve(ok({ lastOutcome: { reason: "opponentLeft", at: "2026-10-24T10:00:00Z" } }));
    const first = renderOnline("/online/friendly");

    expect(await screen.findByText("online.friendly.reason.opponentLeft")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "online.friendly.dismiss" }));
    expect(screen.queryByText("online.friendly.reason.opponentLeft")).not.toBeInTheDocument();
    first.unmount();
    renderOnline("/online/friendly");

    expect(
      await screen.findByRole("button", { name: "online.friendly.create.button" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("online.friendly.reason.opponentLeft")).not.toBeInTheDocument();
  });

  // Given a friendly that is over,
  // when its coach opens the match and asks for a rematch,
  // then the rematch goes out and they are taken back to the friendly room.
  it("asks for a rematch from the finished match", async () => {
    serve(ok(inRoom({ status: "finished", matchId: "match-7" })), {
      "GET v1/matches/match-7": ok(
        matchView({ id: "match-7", kind: "friendly", status: "finished", fixtureId: undefined }),
      ),
      "GET v1/matches/match-7/frames": ok({ frames: [] }),
      "GET v1/matches/match-7/mine": fail(404, "be.error.notFound"),
      "POST v1/friendlies/rooms/mine/rematch": ok(inRoom({ status: "full", leg: 2 })),
    });
    renderOnline("/online/match/match-7");

    fireEvent.click(await screen.findByRole("button", { name: "online.friendly.room.rematch" }));

    await waitFor(() =>
      expect(screen.getByLabelText("location")).toHaveTextContent("/online/friendly"),
    );
    expect(sent("POST", "v1/friendlies/rooms/mine/rematch")).toHaveLength(1);
  });

  // Given a friendly old enough to have been deleted (the server answers 404),
  // when a coach opens it,
  // then they are told it is too old to replay, not shown an error.
  it("reads a deleted match as too old to replay", async () => {
    serve(ok({}), { "GET v1/matches/match-old": fail(404, "be.error.notFound") });
    renderOnline("/online/match/match-old");

    expect(await screen.findByText("online.replay.gone")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
