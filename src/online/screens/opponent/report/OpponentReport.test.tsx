import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPitchRows } from "../../../../components/squad/SquadTab.helpers";
import { FORMATIONS } from "../../../../components/match/types";
import { PHONE_QUERY } from "../../../../hooks/usePhoneLayout";
import type { OpponentReportQuoteView, OpponentReportSummary } from "../../../api";
import type { PitchPosition } from "../../../api/engine";
import { formatMoment } from "../../../format";
import {
  fail,
  fakeServer,
  LEAGUE,
  myClub,
  ok,
  renderOnline,
  resetOnline,
  SEASON,
} from "../../../../test-utils/onlineTestKit";
import { slotPlaces } from "../LineupPitch";
import { opponentView, THEM } from "../opponentTestData";
import OpponentReportBoard from "./OpponentReportBoard";
import { KICKOFF_AT, reportContent, reportPlayer, reportView, SNAPSHOT_AT } from "./reportTestData";

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

let server: ReturnType<typeof fakeServer>;
beforeEach(() => resetOnline());
afterEach(() => {
  server?.restore();
  vi.unstubAllGlobals();
});

const PROFILE = "/online/clubs/club-2/opponent?fixture=fixture-9";
const PAGE = "/online/opponent-reports/report-1";
const QUOTE = "GET v1/clubs/mine/opponent-reports/quote";
const REPORTS = "v1/clubs/mine/opponent-reports";
const ONE = `GET ${REPORTS}/report-1`;
const TITLE = "online.opponentReport.title";
const LOCKS_AT = "2099-01-01T10:40:00Z";

function quote(extra: Partial<OpponentReportQuoteView> = {}): OpponentReportQuoteView {
  return {
    fixtureId: "fixture-9",
    opponent: THEM,
    kickoffAt: KICKOFF_AT,
    locksAt: LOCKS_AT,
    refused: "alreadyBought",
    reportId: "report-1",
    ...extra,
  };
}

function summary(extra: Partial<OpponentReportSummary> = {}): OpponentReportSummary {
  const { content: _content, live: _live, ...head } = reportView();
  return { ...head, ...extra };
}

function stage(routes: Parameters<typeof fakeServer>[0] = {}) {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub()),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/clubs/club-2/opponent": ok(opponentView()),
    [QUOTE]: ok(quote()),
    [`GET ${REPORTS}`]: ok({ reports: [summary()] }),
    [ONE]: ok(reportView()),
    ...routes,
  });
}

function onPhone() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === PHONE_QUERY,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

const block = () => screen.findByRole("region", { name: TITLE });
const board = (within_: ReturnType<typeof within>) =>
  within_.findByRole("list", { name: "online.opponentReport.eleven" });

describe("a scouting report back (C-24b)", () => {
  // Given the club's report on its next opponent back,
  // when the opponent's profile opens,
  // then the block shows the eleven on the board, the bench, the captain and the takers, when it
  // was taken and that the opponent can still change its team until the lock, 20 minutes before
  // the kick-off; it is called a projection, and the bands say they are for the kick-off.
  it("shows the report in the profile's block", async () => {
    stage();
    renderOnline(PROFILE);
    const here = within(await block());
    const eleven = within(await board(here));
    expect(eleven.getAllByRole("button")).toHaveLength(11);
    expect(
      eleven.getByRole("button", {
        name: /^online\.opponentReport\.token:Cầu Thủ 2\|62\|online\.opponentReport\.bands\.fresh/,
      }),
    ).toBeVisible();
    const bench = within(here.getByRole("list", { name: "online.opponentReport.bench" }));
    expect(bench.getByRole("button", { name: /Dự Bị Một/ })).toBeVisible();
    expect(here.getByText(`online.opponentReport.snapshot:${formatMoment(SNAPSHOT_AT, "en")}`));
    expect(here.getByText("online.opponentReport.snapshotNoteLead:20")).toBeVisible();
    expect(here.getByText("online.opponentReport.projected:4-4-2")).toBeVisible();
    expect(here.getByText("online.opponentReport.bands.title")).toBeVisible();
    const takers = within(here.getByRole("list", { name: "online.opponentReport.setPieces" }));
    for (const [label, name] of [
      ["match.captain", "Cầu Thủ 2"],
      ["match.penaltyTaker", "Cầu Thủ 9"],
      ["match.freeKickTaker", "Cầu Thủ 6"],
      ["match.cornerTaker", "Cầu Thủ 8"],
    ]) {
      expect(takers.getByText(label).nextSibling).toHaveTextContent(name);
    }
    expect(here.queryByRole("button", { name: /online.opponentReport.buy/ })).toBeNull();
  });

  // Given a report without a captain or a penalty taker named,
  // when it is shown,
  // then those lines say no one is set.
  it("says when a duty is not set", async () => {
    stage({ [ONE]: ok(reportView({ content: reportContent({ penaltyTaker: undefined }) })) });
    renderOnline(PROFILE);
    const here = within(await block());
    const takers = within(
      await here.findByRole("list", { name: "online.opponentReport.setPieces" }),
    );
    expect(takers.getByText("match.penaltyTaker").nextSibling).toHaveTextContent(
      "match.notAssigned",
    );
  });

  // Given players of the report gone, injured and banned since it was taken,
  // when it is shown,
  // then each is marked so beside his name, and all eleven still stand where the report put them.
  it("marks who left, who is injured and who is banned since", async () => {
    stage({
      [ONE]: ok(
        reportView({
          live: { left: ["their-3"], injured: ["their-4"], suspended: { "their-5": 2 } },
        }),
      ),
    });
    renderOnline(PROFILE);
    const here = within(await block());
    const eleven = within(await board(here));
    expect(eleven.getAllByRole("button")).toHaveLength(11);
    const token = (n: number) =>
      eleven.getByRole("button", { name: new RegExp(`Cầu Thủ ${n}\\|`) });
    expect(token(3)).toHaveAccessibleName(/online\.opponentReport\.live\.left/);
    expect(token(4)).toHaveAccessibleName(/online\.opponentReport\.live\.injured/);
    expect(token(5)).toHaveAccessibleName(/online\.opponentReport\.live\.suspended:2/);
    expect(token(6)).not.toHaveAccessibleName(/online\.opponentReport\.live/);
    expect(here.getByText("online.opponentReport.live.left")).toBeVisible();
  });

  // Given a report taken after the opponent changed coach, and one short of eleven,
  // when it is shown,
  // then it says the club just changed coach, names no one, and says how many are missing.
  it("says the club changed coach and is short of men", async () => {
    stage({
      [ONE]: ok(
        reportView({
          ownerChanged: true,
          content: reportContent({
            eleven: Array.from({ length: 9 }, (_, slot) => reportPlayer(slot)),
            shortOf: 2,
          }),
        }),
      ),
    });
    renderOnline(PROFILE);
    const here = within(await block());
    expect(await here.findByText("online.opponentReport.ownerChanged")).toBeVisible();
    expect(here.getByText("online.opponentReport.shortOf:2")).toBeVisible();
    expect(here.queryByText(/Trần Lan/)).toBeNull();
  });

  // Given a report delivered and then paid back as its match was called off,
  // when it is shown,
  // then the content stays, with a line saying it was paid back and why.
  it("keeps the content of a report paid back after it came", async () => {
    stage({
      [`GET ${REPORTS}`]: ok({ reports: [summary({ status: "refunded", refundReason: "void" })] }),
      [ONE]: ok(reportView({ status: "refunded", refundReason: "void" })),
    });
    renderOnline(PROFILE);
    const here = within(await block());
    expect(await here.findByText("online.opponentReport.refundedAfter.void")).toBeVisible();
    expect(within(await board(here)).getAllByRole("button")).toHaveLength(11);
  });

  // Given a report paid back before it came,
  // when the profile opens,
  // then the block says so, and no report is asked for.
  it("says a report paid back before it came was paid back", async () => {
    stage({
      [`GET ${REPORTS}`]: ok({
        reports: [summary({ status: "refunded", refundReason: "late", snapshotAt: undefined })],
      }),
    });
    renderOnline(PROFILE);
    const here = within(await block());
    expect(await here.findByText("online.opponentReport.refunded")).toBeVisible();
    expect(server.requests.some((r) => r.segments.join("/") === `${REPORTS}/report-1`)).toBe(false);
  });

  // Given a report back,
  // when the coach picks a player on the board,
  // then a dialog shows his attributes and his OVR by position, his position named as the game
  // names positions, and nothing of potential or traits; Escape closes it.
  it("opens a player's attributes in a dialog", async () => {
    stage();
    renderOnline(PROFILE);
    const here = within(await block());
    fireEvent.click(within(await board(here)).getByRole("button", { name: /Cầu Thủ 2\|/ }));
    const dialog = within(await screen.findByRole("dialog", { name: "Cầu Thủ 2" }));
    expect(dialog.getByText("playerProfile.attributes")).toBeVisible();
    expect(dialog.getByRole("list", { name: "online.market.positionRatings" })).toBeVisible();
    expect(dialog.getAllByText(/common\.posAbbr\.CenterBack/).length).toBeGreaterThan(0);
    expect(dialog.queryByText(/potential/i)).toBeNull();
    expect(dialog.queryByText(/trait/i)).toBeNull();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("the report's own page", () => {
  // Given a report whose match has been played,
  // when its page opens,
  // then it names the opponent and the kick-off, says the match was played, and shows the report
  // without a purchase button.
  it("shows a report of a match played", async () => {
    stage({ [ONE]: ok(reportView({ kickoffAt: "2020-01-01T11:00:00Z" })) });
    renderOnline(PAGE);
    expect(await screen.findByText("online.opponentReport.played")).toBeVisible();
    expect(screen.getByRole("heading", { name: /Sóng Biển Đà Nẵng/ })).toBeVisible();
    expect(screen.getAllByRole("button", { name: /online\.opponentReport\.token/ })).toHaveLength(
      12,
    );
    expect(screen.queryByRole("button", { name: /online.opponentReport.buy/ })).toBeNull();
    expect(screen.getByText("online.opponentReport.snapshotNote")).toBeVisible();
  });

  // Given a report id the server does not know for this club,
  // when its page opens,
  // then the page says the report cannot be read.
  it("tells when the report cannot be read", async () => {
    stage({ [ONE]: fail(404, "be.error.opponentReport.notFound") });
    renderOnline(PAGE);
    expect(await screen.findByRole("alert")).toBeVisible();
  });
});

describe("the phone's scouting report", () => {
  beforeEach(onPhone);

  // Given a phone and a report back,
  // when the coach taps a player,
  // then a page of its own shows his attributes, with a way back to the report.
  it("opens a player on a page of his own", async () => {
    stage();
    renderOnline(PAGE);
    fireEvent.click(await screen.findByRole("button", { name: /Cầu Thủ 2\|/ }));
    expect(await screen.findByRole("heading", { name: "Cầu Thủ 2" })).toBeVisible();
    expect(screen.getByText("playerProfile.attributes")).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("link", { name: "online.opponentReport.backToReport" }),
    ).toHaveAttribute("href", PAGE);
  });
});

/** A side of `formation` by slot, each man standing in his slot's position. */
function sideOf(formation: string) {
  const positions = buildPitchRows(formation).flatMap((row) => row.positions);
  return positions.map((position, slot) =>
    reportPlayer(slot, { slotPosition: position as PitchPosition, slot }),
  );
}

describe("the report's board", () => {
  // Given each formation the game plays, its eleven listed in reverse,
  // when the board draws it,
  // then each man stands where his slot stands on the tactics board, by his slot, not his place
  // in the list.
  it.each(FORMATIONS)("puts each man of a %s in his slot", (formation) => {
    const eleven = sideOf(formation).reverse();
    render(
      <MemoryRouter>
        <OpponentReportBoard
          content={reportContent({ formation, eleven })}
          live={undefined}
          onPick={() => {}}
        />
      </MemoryRouter>,
    );
    const places = slotPlaces(formation);
    const tokens = within(
      screen.getByRole("list", { name: "online.opponentReport.eleven" }),
    ).getAllByRole("listitem");
    expect(tokens).toHaveLength(11);
    for (const player of eleven) {
      const item = screen
        .getByRole("button", { name: new RegExp(`token:${player.fullName}\\|`) })
        .closest("li");
      expect(item?.style.top).toBe(places[player.slot ?? -1].top);
      expect(item?.style.left).toBe(places[player.slot ?? -1].left);
    }
  });

  // Given a man in each band,
  // when the board draws them,
  // then each one's dot names his band.
  it("dots each man by his band", () => {
    const eleven = reportContent().eleven.map((player, slot) => ({
      ...player,
      conditionBand: (["fresh", "ok", "tired"] as const)[slot % 3],
    }));
    render(
      <MemoryRouter>
        <OpponentReportBoard
          content={reportContent({ eleven })}
          live={undefined}
          onPick={() => {}}
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("button", { name: /Cầu Thủ 0\|60\|online\.opponentReport\.bands\.fresh/ }),
    );
    expect(
      screen.getByRole("button", { name: /Cầu Thủ 1\|61\|online\.opponentReport\.bands\.ok/ }),
    );
    expect(
      screen.getByRole("button", { name: /Cầu Thủ 2\|62\|online\.opponentReport\.bands\.tired/ }),
    );
  });
});
