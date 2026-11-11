import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpponentReportQuoteView, OpponentReportSummary } from "../../api";
import { formatMoment } from "../../format";
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
import { formatExactMoney } from "../../../lib/valueFormatting";
import { opponentView, THEM } from "./opponentTestData";

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
  resolveBackendError: (error: unknown) => `resolved:${(error as Error).message}`,
}));

let server: ReturnType<typeof fakeServer>;
beforeEach(() => resetOnline());
afterEach(() => server?.restore());

const PROFILE = "/online/clubs/club-2/opponent?fixture=fixture-9";
const QUOTE = "GET v1/clubs/mine/opponent-reports/quote";
const REPORTS = "v1/clubs/mine/opponent-reports";
const TITLE = "online.opponentReport.title";

const READY_AT = "2099-01-01T08:00:00Z";
const LOCKS_AT = "2099-01-01T10:40:00Z";
const LATEST_AT = "2099-01-01T04:00:00Z";

function quote(extra: Partial<OpponentReportQuoteView> = {}): OpponentReportQuoteView {
  return {
    fixtureId: "fixture-9",
    opponent: THEM,
    kickoffAt: "2099-01-01T11:00:00Z",
    locksAt: LOCKS_AT,
    latestAt: LATEST_AT,
    readyAt: READY_AT,
    costEur: 250_000,
    clubLeft: 2,
    personLeft: 3,
    perSeason: 3,
    ...extra,
  };
}

function report(extra: Partial<OpponentReportSummary> = {}): OpponentReportSummary {
  return {
    id: "report-1",
    fixtureId: "fixture-9",
    opponent: THEM,
    kickoffAt: "2099-01-01T11:00:00Z",
    status: "pending",
    costEur: 250_000,
    sentAt: "2098-12-31T22:00:00Z",
    readyAt: READY_AT,
    ownerChanged: false,
    ...extra,
  };
}

function stage(routes: Parameters<typeof fakeServer>[0] = {}) {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub()),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/clubs/club-2/opponent": ok(opponentView()),
    [QUOTE]: ok(quote()),
    [`GET ${REPORTS}`]: ok({ reports: [report()] }),
    ...routes,
  });
}

const block = () => screen.findByRole("region", { name: TITLE });

describe("the scouting report block (C-24a)", () => {
  // Given reports switched off (the default until S-47b, BR-23),
  // when the next opponent's profile opens,
  // then the block is not there at all.
  it("is hidden while reports are switched off", async () => {
    stage({ [QUOTE]: ok({ refused: "disabled" }) });
    renderOnline(PROFILE);
    await screen.findByRole("region", { name: "online.opponent.form" });
    await waitFor(() =>
      expect(server.requests.some((r) => r.segments.join("/") === `${REPORTS}/quote`)).toBe(true),
    );
    expect(screen.queryByRole("region", { name: TITLE })).toBeNull();
  });

  // Given another club's profile, not the next league opponent's,
  // when it opens,
  // then the block is left out and no price is asked for.
  it("is left out away from the next league opponent", async () => {
    stage({
      "GET v1/clubs/club-7/opponent": ok(
        opponentView({ club: { ...opponentView().club, id: "club-7" } }),
      ),
    });
    renderOnline("/online/clubs/club-7/opponent");
    await screen.findByRole("region", { name: "online.opponent.form" });
    expect(screen.queryByRole("region", { name: TITLE })).toBeNull();
    expect(server.requests.some((r) => r.segments.join("/") === `${REPORTS}/quote`)).toBe(false);
  });

  // Given a report that can be bought,
  // when the block draws,
  // then the button shows its price, the reports left this season, and when it would be back and
  // how long before the lock; nothing leads to buying coins (DM-3).
  it("shows the price, the reports left and when it would be back", async () => {
    stage();
    renderOnline(PROFILE);
    const here = within(await block());
    expect(
      here.getByRole("button", {
        name: `online.opponentReport.buy:${formatExactMoney(250_000)}`,
      }),
    ).toBeEnabled();
    expect(here.getByText("online.opponentReport.left:2|3")).toBeVisible();
    expect(
      here.getByText(`online.opponentReport.back:${formatMoment(READY_AT, "en")}|160`),
    ).toBeVisible();
    expect(
      here.getByText(`online.opponentReport.latest:${formatMoment(LATEST_AT, "en")}`),
    ).toBeVisible();
    expect(
      here.queryAllByRole("link").filter((link) => /coin/.test(link.getAttribute("href") ?? "")),
    ).toHaveLength(0);
  });

  // Given each reason the server gives for not selling a report now,
  // when the block draws,
  // then the button is off and the reason says why.
  it.each([
    "tooLate",
    "limitReached",
    "insufficientFunds",
    "clubLocked",
    "noFixture",
    "notScheduled",
  ] as const)("switches the button off when it is %s", async (refused) => {
    stage({ [QUOTE]: ok(quote({ refused })) });
    renderOnline(PROFILE);
    const here = within(await block());
    expect(here.getByRole("button", { name: /online.opponentReport.buy/ })).toBeDisabled();
    expect(here.getByText(`online.opponentReport.refused.${refused}`)).toBeVisible();
  });

  // Given a report that can be bought,
  // when the coach presses the button and confirms,
  // then the purchase names the fixture with a key, and the block shows the scout out.
  it("buys after asking, then shows the scout out", async () => {
    let bought = false;
    stage({
      [QUOTE]: () =>
        ok(bought ? quote({ refused: "alreadyBought", reportId: "report-1" }) : quote()),
      [`POST ${REPORTS}`]: () => {
        bought = true;
        return ok(report());
      },
      "GET v1/clubs/mine/finance": ok({}),
    });
    renderOnline(PROFILE);
    const here = within(await block());
    fireEvent.click(here.getByRole("button", { name: /online.opponentReport.buy/ }));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(
        `online.opponentReport.confirmBody:${formatExactMoney(250_000)}|${formatMoment(READY_AT, "en")}`,
      ),
    ).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "online.opponentReport.confirm" }));

    expect(await here.findByText(/online.opponentReport.pending/)).toBeVisible();
    const buy = server.requests.find((r) => r.method === "POST");
    expect(buy?.body).toEqual({ fixtureId: "fixture-9" });
    expect(buy?.idempotencyKey).toEqual(expect.any(String));
    expect(here.queryByRole("button", { name: /online.opponentReport.buy/ })).toBeNull();
  });

  // Given a purchase the server answers alreadyBought without the report's id (a club changing
  // hands between two requests, G3),
  // when it comes back,
  // then the block reads the price again for the report and shows no error.
  it("reads the quote again when the report was already bought", async () => {
    let refusedOnce = false;
    stage({
      [QUOTE]: () =>
        ok(refusedOnce ? quote({ refused: "alreadyBought", reportId: "report-1" }) : quote()),
      [`POST ${REPORTS}`]: () => {
        refusedOnce = true;
        return fail(409, "be.error.opponentReport.alreadyBought");
      },
    });
    renderOnline(PROFILE);
    const here = within(await block());
    fireEvent.click(here.getByRole("button", { name: /online.opponentReport.buy/ }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "online.opponentReport.confirm",
      }),
    );
    expect(await here.findByText(/online.opponentReport.pending/)).toBeVisible();
    expect(here.queryByRole("alert")).toBeNull();
  });

  // Given a purchase the server refuses for another reason,
  // when it comes back,
  // then the block says why, in the error's own words.
  it("tells why a purchase was refused", async () => {
    stage({
      [`POST ${REPORTS}`]: fail(409, "be.error.economy.insufficientFunds"),
    });
    renderOnline(PROFILE);
    const here = within(await block());
    fireEvent.click(here.getByRole("button", { name: /online.opponentReport.buy/ }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "online.opponentReport.confirm",
      }),
    );
    expect(await here.findByRole("alert")).toHaveTextContent("be.error.economy.insufficientFunds");
  });

  // Given a report bought earlier, back or paid back,
  // when the block draws,
  // then it says so, without a button.
  it.each([
    ["ready", "online.opponentReport.ready"],
    ["refunded", "online.opponentReport.refunded"],
  ] as const)("shows a report that is %s", async (status, text) => {
    stage({
      [QUOTE]: ok(quote({ refused: "alreadyBought", reportId: "report-1" })),
      [`GET ${REPORTS}`]: ok({ reports: [report({ status })] }),
    });
    renderOnline(PROFILE);
    const here = within(await block());
    expect(await here.findByText(text)).toBeVisible();
    expect(here.queryByRole("button")).toBeNull();
    expect(
      server.requests.find((r) => r.method === "GET" && r.segments.join("/") === REPORTS),
    ).toMatchObject({ query: [["fixtureId", "fixture-9"]] });
  });

  // Given a club that bought its report, the quote now refusing first for a later reason (the
  // server checks tooLate and notScheduled before alreadyBought, PO P1),
  // when the block draws,
  // then the quote's reportId still shows the club's report, not a switched-off button.
  it.each(["tooLate", "notScheduled"] as const)(
    "shows the club's report when the quote is %s",
    async (refused) => {
      stage({ [QUOTE]: ok(quote({ refused, reportId: "report-1" })) });
      renderOnline(PROFILE);
      const here = within(await block());
      expect(await here.findByText(/online.opponentReport.pending/)).toBeVisible();
      expect(here.queryByRole("button")).toBeNull();
      expect(here.queryByText(`online.opponentReport.refused.${refused}`)).toBeNull();
    },
  );

  // Given the quote saying the club has a report but not naming it,
  // when the block draws,
  // then it says the club has one, without a button.
  it("says the club has a report the quote does not name", async () => {
    stage({ [QUOTE]: ok(quote({ refused: "alreadyBought" })) });
    renderOnline(PROFILE);
    const here = within(await block());
    expect(here.getByText("online.opponentReport.bought")).toBeVisible();
    expect(here.queryByRole("button")).toBeNull();
  });

  // Given a next fixture against this club that is a cup match, the next league one being
  // against another club,
  // when the profile opens,
  // then the block is left out: the report is for the league match.
  it("is left out when the next league match is against another club", async () => {
    stage({ [QUOTE]: ok(quote({ opponent: { id: "club-5", name: "Đồi Thông" } })) });
    renderOnline(PROFILE);
    await screen.findByRole("region", { name: "online.opponent.form" });
    await waitFor(() =>
      expect(server.requests.some((r) => r.segments.join("/") === `${REPORTS}/quote`)).toBe(true),
    );
    expect(screen.queryByRole("region", { name: TITLE })).toBeNull();
  });
});

describe("the phone's scouting report block", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === "(max-width: 767.98px)",
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  // Given a phone and a report that can be bought,
  // when the next opponent's profile opens,
  // then the block is an open card with its button.
  it("is an open card", async () => {
    stage();
    renderOnline(PROFILE);
    const here = within(await block());
    expect(here.getByRole("button", { name: TITLE })).toHaveAttribute("aria-expanded", "true");
    expect(here.getByRole("button", { name: /online.opponentReport.buy/ })).toBeEnabled();
  });
});
