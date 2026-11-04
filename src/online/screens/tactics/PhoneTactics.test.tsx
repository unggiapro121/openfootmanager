import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHONE_QUERY } from "../../../hooks/usePhoneLayout";
import type { MyClubView, SquadPlayerView } from "../../api";
import type { ClubSetup } from "../../api/rules";
import {
  fakeServer,
  LEAGUE,
  myClub,
  ok,
  renderOnline,
  resetOnline,
  SEASON,
  squadPlayer,
} from "../../../test-utils/onlineTestKit";

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

const KEY = "online.tactics.phone";

/** A 4-4-2 eleven in its own places, and a centre-back on the bench. */
const PLACES: [string, string][] = [
  ["Goalkeeper", "Goalkeeper"],
  ["Defender", "LeftBack"],
  ["Defender", "CenterBack"],
  ["Defender", "CenterBack"],
  ["Defender", "RightBack"],
  ["Midfielder", "LeftMidfielder"],
  ["Midfielder", "CentralMidfielder"],
  ["Midfielder", "CentralMidfielder"],
  ["Midfielder", "RightMidfielder"],
  ["Forward", "Striker"],
  ["Forward", "Striker"],
  ["Defender", "CenterBack"],
];
const SQUAD: SquadPlayerView[] = PLACES.map(([position, naturalPosition], index) =>
  squadPlayer({
    id: `p${index}`,
    fullName: `Player ${index}`,
    matchName: `P${index}`,
    position,
    naturalPosition,
    shirtNumber: index + 1,
  }),
);
const ELEVEN = SQUAD.slice(0, 11).map((player) => player.id);

function club(overrides: Partial<MyClubView> = {}): MyClubView {
  const base = myClub({ players: SQUAD });
  return { ...base, setup: { ...base.setup, startingXiIds: ELEVEN }, ...overrides };
}

let server: ReturnType<typeof fakeServer>;

/** The club staged, its setup route answering what it was sent. */
function stage(view: MyClubView) {
  let version = view.version;
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(view),
    "GET v1/leagues/mine": ok(LEAGUE),
    "PUT v1/clubs/mine/setup": (request: { body?: unknown }) => {
      version += 1;
      const { xiAssistant, ...setup } = request.body as ClubSetup & { xiAssistant?: boolean };
      return ok({ ...view, version, setup, xiAssistant: xiAssistant ?? view.xiAssistant });
    },
  });
}

const sent = () =>
  server.requests
    .filter((request) => request.method === "PUT")
    .map((request) => request.body as ClubSetup);
const token = (name: string) =>
  within(screen.getByRole("region", { name: new RegExp(`^${KEY}\\.pitch`) })).getByRole("button", {
    name: new RegExp(`^${KEY}\\.token:${name}\\|`),
  });

beforeEach(() => {
  resetOnline();
  window.localStorage.clear();
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
  vi.unstubAllGlobals();
});

async function open(view: MyClubView = club()) {
  stage(view);
  renderOnline("/online/tactics");
  await screen.findByRole("region", { name: new RegExp(`^${KEY}\\.pitch`) });
}

describe("the tactics page on a phone", () => {
  // Given a 4-4-2 in its own places,
  // when the tactics page opens on a phone,
  // then the tactic in use is named, the eleven stand on the pitch, the twelfth on the bench.
  it("shows the tactic, the pitch and the bench", async () => {
    await open();

    expect(
      screen.getByRole("button", { name: /tactics\.presetNames\.balanced-control/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: `${KEY}.tab.lineup` })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const pitch = screen.getByRole("region", { name: new RegExp(`^${KEY}\\.pitch`) });
    expect(within(pitch).getAllByRole("button")).toHaveLength(11);
    const bench = screen.getByRole("list", { name: `${KEY}.bench` });
    expect(within(bench).getByRole("button", { name: /Player 11/ })).toBeInTheDocument();
  });

  // Given the eleven,
  // when the coach taps one player, then another,
  // then the two swap places and the eleven is saved so.
  it("swaps two players on the pitch", async () => {
    await open();
    fireEvent.click(token("Player 9"));
    fireEvent.click(token("Player 10"));

    await waitFor(() => expect(sent()).toHaveLength(1));
    const ids = sent()[0].startingXiIds;
    expect(ids.indexOf("p9")).toBe(ELEVEN.indexOf("p10"));
    expect(ids.indexOf("p10")).toBe(ELEVEN.indexOf("p9"));
  });

  // Given a player picked on the pitch,
  // when the coach taps a bench player,
  // then he takes that place in the eleven.
  it("brings a bench player into the picked place", async () => {
    await open();
    fireEvent.click(token("Player 2"));
    const bench = screen.getByRole("list", { name: `${KEY}.bench` });
    fireEvent.click(within(bench).getByRole("button", { name: /Player 11/ }));

    await waitFor(() => expect(sent()).toHaveLength(1));
    const ids = sent()[0].startingXiIds;
    expect(ids[ELEVEN.indexOf("p2")]).toBe("p11");
    expect(ids).not.toContain("p2");
  });

  // Given the XI assistant on,
  // when the coach taps a player,
  // then the page says to turn the assistant off first, and nothing is saved.
  it("leaves the eleven to the assistant while it is on", async () => {
    await open(club({ xiAssistant: true, xiPick: "assistant" }));
    expect(
      screen.getByRole("switch", { name: "online.tactics.xiAssistant.title" }),
    ).toHaveAttribute("aria-checked", "true");

    fireEvent.click(token("Player 9"));
    expect(screen.getAllByText(`${KEY}.hintAssistant`).length).toBeGreaterThan(0);
    expect(sent()).toHaveLength(0);
  });

  // Given the style tab,
  // when the coach picks 4-3-3, then the counter-attack,
  // then each is saved.
  it("changes the formation and the play style", async () => {
    await open();
    fireEvent.click(screen.getByRole("tab", { name: `${KEY}.tab.style` }));

    fireEvent.click(screen.getByRole("radio", { name: /^4-3-3/ }));
    await waitFor(() => expect(sent()[0]?.formation).toBe("4-3-3"));
    fireEvent.click(screen.getByRole("radio", { name: /common\.playStyles\.Counter/ }));
    await waitFor(() => expect(sent()[1]?.playStyle).toBe("Counter"));
  });

  // Given the roles tab,
  // when the coach opens the captain and picks a player,
  // then he is saved as captain.
  it("picks the captain from a sheet", async () => {
    await open();
    fireEvent.click(screen.getByRole("tab", { name: `${KEY}.tab.roles` }));
    fireEvent.click(screen.getByRole("button", { name: /preMatch\.captain/ }));

    const sheet = screen.getByRole("dialog", { name: /preMatch\.captain/ });
    fireEvent.click(within(sheet).getByRole("button", { name: /Player 6/ }));
    await waitFor(() => expect(sent()[0]?.matchRoles.captain).toBe("p6"));
  });

  // Given the phase tab,
  // when the coach opens the phase without the ball and turns the offside trap on,
  // then that is saved.
  it("sets a phase dial", async () => {
    await open();
    fireEvent.click(screen.getByRole("tab", { name: `${KEY}.tab.phase` }));
    fireEvent.click(screen.getByRole("tab", { name: "tactics.phaseLabels.withoutBall" }));
    fireEvent.click(screen.getByRole("radio", { name: "tactics.phaseSettings.offsideTrap_On" }));

    await waitFor(() => expect(sent()[0]?.tacticsPhase.offside_trap).toBe("On"));
  });

  // Given the tactic sheet,
  // when the coach picks the counter-attack preset,
  // then its shape and style are saved.
  it("puts a preset in force from the tactic sheet", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: /tactics\.presetNames\.balanced-control/ }));
    const sheet = screen.getByRole("dialog", { name: "tactics.chooseTactic" });
    fireEvent.click(
      within(sheet).getByRole("button", { name: /tactics\.presetNames\.counter-attack/ }),
    );

    await waitFor(() => expect(sent().some((body) => body.playStyle === "Counter")).toBe(true));
    expect(sent().some((body) => body.formation === "4-2-3-1")).toBe(true);
  });

  // Given the next match being prepared,
  // when the page opens,
  // then it says the line-up is locked, and a tap changes nothing.
  it("shows a locked line-up without changing it", async () => {
    const base = club();
    await open({
      ...base,
      nextFixture: base.nextFixture ? { ...base.nextFixture, status: "prepared" } : undefined,
    });
    if (!base.nextFixture) return;
    expect(screen.getByText(/online\.tactics\.locked/)).toBeInTheDocument();
    fireEvent.click(token("Player 9"));
    fireEvent.click(token("Player 10"));
    expect(sent()).toHaveLength(0);
  });
});
