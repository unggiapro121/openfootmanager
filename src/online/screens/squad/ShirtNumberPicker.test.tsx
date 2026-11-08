import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fail,
  fakeServer,
  myClub,
  ok,
  resetOnline,
  squadPlayer,
  withoutHonours,
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

const STRIKER = squadPlayer({ id: "st", matchName: "Đạo", shirtNumber: 9 });
const KEEPER = squadPlayer({ id: "gk", matchName: "Thủ", shirtNumber: 1 });

function renderPlayer() {
  return render(
    <MemoryRouter initialEntries={["/online/squad/st"]}>
      <Routes>
        <Route path="/online/squad/:playerId" element={<OnlinePlayer />} />
      </Routes>
    </MemoryRouter>,
  );
}

function openPicker() {
  fireEvent.click(screen.getByRole("button", { name: "squad.jerseyPickerAction" }));
  return screen.getByRole("dialog");
}

describe("changing a player's shirt number online", () => {
  // Given a squad where 1 is worn and 10 is free,
  // when the coach picks 10,
  // then it goes to the server with no swap, the dialog closes and the squad is the answer.
  it("takes a free number at once", async () => {
    useOnlineStore.getState().setClub(myClub({ players: [STRIKER, KEEPER] }));
    server = fakeServer({
      "PATCH v1/players/st/shirt": ok(
        myClub({ players: [{ ...STRIKER, shirtNumber: 10 }, KEEPER] }),
      ),
    });
    renderPlayer();

    fireEvent.click(within(openPicker()).getByRole("button", { name: "#10" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(withoutHonours(server.requests)[0]?.body).toEqual({ number: 10, swap: false });
    expect(useOnlineStore.getState().club?.players[0]?.shirtNumber).toBe(10);
  });

  // Given a number another player wears,
  // when the coach picks it and confirms,
  // then nothing is sent before the question, and the swap is sent once he confirms.
  it("asks before swapping with the player who wears the number", async () => {
    useOnlineStore.getState().setClub(myClub({ players: [STRIKER, KEEPER] }));
    server = fakeServer({
      "PATCH v1/players/st/shirt": ok(
        myClub({
          players: [
            { ...STRIKER, shirtNumber: 1 },
            { ...KEEPER, shirtNumber: 9 },
          ],
        }),
      ),
    });
    renderPlayer();

    fireEvent.click(
      within(openPicker()).getByRole("button", { name: "squad.jerseyPickerTakenBy:1|Thủ" }),
    );
    expect(withoutHonours(server.requests)).toHaveLength(0);
    expect(screen.getByText("squad.jerseyPickerSwapPrompt:1|Thủ")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "squad.jerseyPickerSwapConfirm" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(withoutHonours(server.requests)[0]?.body).toEqual({ number: 1, swap: true });
    expect(useOnlineStore.getState().club?.players[1]?.shirtNumber).toBe(9);
  });

  // Given the server refuses a number,
  // when the coach picks it,
  // then the reason shows in the dialog and the dialog stays open.
  it("shows the server's reason and stays open", async () => {
    useOnlineStore.getState().setClub(myClub({ players: [STRIKER, KEEPER] }));
    server = fakeServer({
      "PATCH v1/players/st/shirt": fail(409, "be.error.player.shirtTaken"),
    });
    renderPlayer();

    fireEvent.click(within(openPicker()).getByRole("button", { name: "#10" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("resolved:");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
