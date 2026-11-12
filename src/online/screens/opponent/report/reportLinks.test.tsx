import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpponentReportSummary } from "../../../api";
import { formatMoment } from "../../../format";
import { fakeRealtime } from "../../../../test-utils/onlineMatchKit";
import {
  fakeServer,
  LEAGUE,
  myClub,
  ok,
  renderOnline,
  resetOnline,
  SEASON,
} from "../../../../test-utils/onlineTestKit";
import { opponentView, THEM } from "../opponentTestData";
import { reportView, SNAPSHOT_AT } from "./reportTestData";

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

const ACCOUNT = "account-1";
const REPORTS = "v1/clubs/mine/opponent-reports";
const READY_AT = "2099-01-01T08:00:00Z";

let server: ReturnType<typeof fakeServer>;
let realtime: ReturnType<typeof fakeRealtime>;
beforeEach(() => {
  resetOnline();
  realtime = fakeRealtime();
});
afterEach(() => {
  server?.restore();
  realtime.restore();
});

function summary(extra: Partial<OpponentReportSummary> = {}): OpponentReportSummary {
  const { content: _content, live: _live, ...head } = reportView();
  return { ...head, ...extra };
}

function stage(routes: Parameters<typeof fakeServer>[0] = {}) {
  server = fakeServer({
    "GET v1/me": ok({ id: ACCOUNT, email: "coach@example.test" }),
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub()),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/clubs/club-2/opponent": ok(opponentView()),
    [`GET ${REPORTS}/quote`]: ok({
      fixtureId: "fixture-9",
      opponent: THEM,
      kickoffAt: "2099-01-01T11:00:00Z",
      refused: "alreadyBought",
      reportId: "report-1",
    }),
    [`GET ${REPORTS}`]: ok({ reports: [summary()] }),
    [`GET ${REPORTS}/report-1`]: ok(reportView()),
    ...routes,
  });
}

/** The report lines' requests: each a list of the club's reports of one fixture. */
const listed = () =>
  server.requests.filter((r) => r.method === "GET" && r.segments.join("/") === REPORTS);

describe("the next match card's report line (Qc24-1)", () => {
  // Given a scout out on the next match,
  // when the overview opens,
  // then the next match card says when he is back, linking to the opponent's profile.
  it("says when the scout is back", async () => {
    stage({
      [`GET ${REPORTS}`]: ok({ reports: [summary({ status: "pending", readyAt: READY_AT })] }),
    });
    renderOnline("/online");
    const line = await screen.findByRole("link", {
      name: `online.opponentReport.nextPending:${formatMoment(READY_AT, "en")}`,
    });
    expect(line).toHaveAttribute("href", "/online/clubs/club-2/opponent?fixture=fixture-9");
    expect(listed()[0]).toMatchObject({ query: [["fixtureId", "fixture-9"]] });
  });

  // Given the report on the next match back,
  // when the overview opens,
  // then the card says it is in, linking to the report; there is no purchase button here.
  it("says the report is in", async () => {
    stage();
    renderOnline("/online");
    const line = await screen.findByRole("link", { name: "online.opponentReport.nextReady" });
    expect(line).toHaveAttribute("href", "/online/opponent-reports/report-1");
    expect(screen.queryByRole("button", { name: /online\.opponentReport\.buy/ })).toBeNull();
  });

  // Given no report on the next match, or one paid back,
  // when the overview opens,
  // then the card has no report line.
  it.each([[[]], [[summary({ status: "refunded", refundReason: "late" })]]])(
    "has no line without a report to show (%#)",
    async (reports) => {
      stage({ [`GET ${REPORTS}`]: ok({ reports }) });
      renderOnline("/online");
      await waitFor(() => expect(listed().length).toBeGreaterThan(0));
      await screen.findByRole("link", { name: "online.opponent.open" });
      expect(screen.queryByRole("link", { name: /online\.opponentReport\.next/ })).toBeNull();
    },
  );
});

describe("a played match's report link", () => {
  const PLAYED = {
    fixture: {
      id: "fixture-9",
      leagueId: "league-1",
      round: 3,
      kickoffAt: "2099-01-01T11:00:00Z",
      status: "settled",
      home: { id: "club-1", name: "Cầu Vồng Nghệ An" },
      away: THEM,
      homeGoals: 1,
      awayGoals: 0,
    },
    players: [],
  };

  // Given a played match the club had a report on,
  // when its page opens,
  // then a link names when the report was taken and opens it.
  it("links the report taken before it", async () => {
    stage({ "GET v1/fixtures/fixture-9": ok(PLAYED) });
    renderOnline("/online/fixtures/fixture-9");
    const link = await screen.findByRole("link", {
      name: `online.opponentReport.fixtureLink:${formatMoment(SNAPSHOT_AT, "en")}`,
    });
    expect(link).toHaveAttribute("href", "/online/opponent-reports/report-1");
  });

  // Given a played match the club had no report on, or one paid back before it came,
  // when its page opens,
  // then there is no report link.
  it.each([[[]], [[summary({ status: "refunded", snapshotAt: undefined })]]])(
    "has no link without a report taken (%#)",
    async (reports) => {
      stage({ "GET v1/fixtures/fixture-9": ok(PLAYED), [`GET ${REPORTS}`]: ok({ reports }) });
      renderOnline("/online/fixtures/fixture-9");
      await waitFor(() => expect(listed().length).toBeGreaterThan(0));
      expect(
        screen.queryByRole("link", { name: /online\.opponentReport\.fixtureLink/ }),
      ).toBeNull();
    },
  );

  // Given a match between two other clubs,
  // when its page opens,
  // then no report is asked for.
  it("asks nothing for another clubs' match", async () => {
    stage({
      "GET v1/fixtures/fixture-9": ok({
        ...PLAYED,
        fixture: { ...PLAYED.fixture, home: { id: "club-5", name: "Đồi Thông" } },
      }),
    });
    renderOnline("/online/fixtures/fixture-9");
    await screen.findByRole("heading", { name: "1 – 0" });
    expect(listed()).toHaveLength(0);
  });
});

describe("the report's ring", () => {
  // Given the opponent's profile open with the scout out,
  // when the account rings that the report is back,
  // then the block reads the report again and shows it, and a notice links to its page.
  it("shows the report back and tells of it", async () => {
    let back = false;
    stage({
      [`GET ${REPORTS}`]: () =>
        ok({ reports: [back ? summary() : summary({ status: "pending", snapshotAt: undefined })] }),
    });
    renderOnline("/online/clubs/club-2/opponent?fixture=fixture-9");
    const block = within(
      await screen.findByRole("region", { name: "online.opponentReport.title" }),
    );
    expect(await block.findByText(/online\.opponentReport\.pending/)).toBeVisible();
    await waitFor(() =>
      expect(realtime.watches.some((watch) => watch.channel === `account:${ACCOUNT}`)).toBe(true),
    );
    const watch = realtime.watches.find((one) => one.channel === `account:${ACCOUNT}`);

    back = true;
    act(() =>
      watch?.speak({
        kind: "notice",
        channel: `account:${ACCOUNT}`,
        data: { kind: "opponentReport", event: "ready", reportId: "report-1" },
      }),
    );
    expect(await block.findByRole("list", { name: "online.opponentReport.eleven" })).toBeVisible();
    const region = screen.getByRole("region", { name: "online.market.notice.region" });
    const notice = await within(region).findByRole("link");
    expect(notice.textContent).toContain("online.opponentReport.notice.ready");
    expect(notice.getAttribute("href")).toBe("/online/opponent-reports/report-1");
  });
});
