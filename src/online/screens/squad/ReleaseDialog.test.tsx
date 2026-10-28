import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fakeServer,
  myClub,
  ok,
  resetOnline,
  squadPlayer,
} from "../../../test-utils/onlineTestKit";
import { useOnlineStore } from "../../store/onlineStore";
import OnlinePlayer from "./OnlinePlayer";

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
  resolveBackendError: (error: unknown) => `resolved:${(error as Error).message}`,
}));

let server: ReturnType<typeof fakeServer>;

beforeEach(() => resetOnline());
afterEach(() => server?.restore());

const STRIKER = squadPlayer({ id: "st", matchName: "Đạo" });
const KEEPER = squadPlayer({ id: "gk", matchName: "Thủ" });
const QUOTE = "GET v1/clubs/mine/players/st/release-quote";
const RELEASE = "POST v1/clubs/mine/players/st/release";

function renderPlayer() {
  return render(
    <MemoryRouter initialEntries={["/online/squad/st"]}>
      <Routes>
        <Route path="/online/squad/:playerId" element={<OnlinePlayer />} />
        <Route path="/online/squad" element={<p>the squad list</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function openDialog() {
  fireEvent.click(await screen.findByRole("button", { name: "online.player.release" }));
  return screen.findByRole("dialog");
}

describe("letting a player go online", () => {
  // Given a quote of 13 weeks of his wage,
  // when the coach opens the dialog and confirms,
  // then the quote shows first, the release is sent once, the answer is the club, and the squad
  // list opens.
  it("shows the severance, releases and returns to the squad", async () => {
    useOnlineStore.getState().setClub(myClub({ players: [STRIKER, KEEPER] }));
    server = fakeServer({
      [QUOTE]: ok({
        weeklyWage: 5_000,
        severance: 65_000,
        cash: 3_000_000,
        squadAfter: 17,
        squadMin: 16,
      }),
      [RELEASE]: ok(myClub({ players: [KEEPER] })),
    });
    renderPlayer();

    const dialog = await openDialog();
    await within(dialog).findByText("online.player.releaseSeverance");
    fireEvent.click(within(dialog).getByRole("button", { name: "online.player.releaseConfirm" }));

    await screen.findByText("the squad list");
    expect(server.requests.filter((request) => request.method === "POST")).toHaveLength(1);
    expect(useOnlineStore.getState().club?.players.map((player) => player.id)).toEqual(["gk"]);
  });

  // Given a quote that refuses the release,
  // when the coach opens the dialog,
  // then the reason shows and confirming is off, so nothing is sent.
  it("shows why a release would be refused and keeps confirming off", async () => {
    useOnlineStore.getState().setClub(myClub({ players: [STRIKER, KEEPER] }));
    server = fakeServer({
      [QUOTE]: ok({
        severance: 0,
        squadAfter: 15,
        squadMin: 16,
        refusal: { code: "be.error.player.releaseSquadTooSmall", params: { squadMin: 16 } },
      }),
    });
    renderPlayer();

    const dialog = await openDialog();

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "be.error.player.releaseSquadTooSmall",
    );
    expect(
      within(dialog).getByRole("button", { name: "online.player.releaseConfirm" }),
    ).toBeDisabled();
    await waitFor(() => expect(server.requests).toHaveLength(1));
  });
});
