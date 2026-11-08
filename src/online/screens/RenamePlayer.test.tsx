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
} from "../../test-utils/onlineTestKit";
import type { MyMarketView } from "../api";
import { useOnlineStore } from "../store/onlineStore";
import ClubCard from "./overview/ClubCard";
import OnlinePlayer from "./squad/OnlinePlayer";

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

vi.mock("../../utils/backendI18n", () => ({
  resolveBackendError: (error: unknown) => `resolved:${(error as Error).message}`,
}));

let server: ReturnType<typeof fakeServer>;

beforeEach(() => resetOnline());
afterEach(() => server?.restore());

const STRIKER = squadPlayer({
  id: "st",
  fullName: "Tiền Đạo",
  matchName: "Đạo",
  position: "Forward",
  naturalPosition: "LeftWinger",
});

/** The player's own page, where the rename is (the squad list only lists). */
function renderSquad() {
  return render(
    <MemoryRouter initialEntries={["/online/squad/st"]}>
      <Routes>
        <Route path="/online/squad/:playerId" element={<OnlinePlayer />} />
      </Routes>
    </MemoryRouter>,
  );
}

function openRename() {
  fireEvent.click(screen.getByRole("button", { name: "online.rename.open" }));
  return screen.getByRole("dialog");
}

describe("renaming a player online (S-14)", () => {
  // Given a coach's squad,
  // when he opens a player's rename and saves two new names,
  // then the names go to the server in one request, the dialog closes and the squad shows them.
  it("renames a player and shows his new names", async () => {
    useOnlineStore.getState().setClub(myClub({ players: [STRIKER] }));
    const renamed = myClub({
      players: [{ ...STRIKER, fullName: "Lionel Messi", matchName: "Messi" }],
    });
    server = fakeServer({ "PATCH v1/players/st/name": ok(renamed) });
    renderSquad();
    const dialog = openRename();
    const full = within(dialog).getByLabelText("online.rename.fullName");
    const short = within(dialog).getByLabelText("online.rename.matchName");
    expect(full).toHaveValue("Tiền Đạo");
    expect(short).toHaveValue("Đạo");
    fireEvent.change(full, { target: { value: "  Lionel Messi " } });
    fireEvent.change(short, { target: { value: "Messi" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "online.rename.save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(withoutHonours(server.requests)[0]?.body).toEqual({
      fullName: "Lionel Messi",
      matchName: "Messi",
    });
    expect(screen.getAllByText("Lionel Messi").length).toBeGreaterThan(0);
  });

  // Given a player whose free rename is used,
  // when the coach renames him again,
  // then the dialog says a player-rename card is needed, not a raw code, and stays open.
  it("says a card is needed for a second rename", async () => {
    useOnlineStore.getState().setClub(myClub({ players: [STRIKER] }));
    server = fakeServer({
      "PATCH v1/players/st/name": fail(409, "be.error.rename.itemRequired", {
        details: { params: { item: "playerRename" } },
      }),
    });
    renderSquad();
    const dialog = openRename();
    fireEvent.click(within(dialog).getByRole("button", { name: "online.rename.save" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "online.rename.itemRequired.playerRename",
    );
  });

  // Given names too short,
  // when the coach edits them,
  // then saving is not offered, so no request is sent.
  it("does not send names too short", () => {
    useOnlineStore.getState().setClub(myClub({ players: [STRIKER] }));
    server = fakeServer({});
    renderSquad();
    const dialog = openRename();
    fireEvent.change(within(dialog).getByLabelText("online.rename.matchName"), {
      target: { value: "D" },
    });
    expect(within(dialog).getByRole("button", { name: "online.rename.save" })).toBeDisabled();
    expect(withoutHonours(server.requests)).toHaveLength(0);
  });

  // Given a player up for auction,
  // when his card shows,
  // then it offers no rename: a listed player keeps his name until the auction is over.
  it("offers no rename for a listed player", () => {
    useOnlineStore.getState().setClub(myClub({ players: [STRIKER] }));
    useOnlineStore.setState({
      market: { selling: [{ id: "a1", playerId: "st" }], bidding: [] } as unknown as MyMarketView,
    });
    server = fakeServer({});
    renderSquad();
    expect(screen.queryByRole("button", { name: "online.rename.open" })).toBeNull();
  });

  // Given the club card,
  // when the coach renames the club again after his free rename,
  // then it says a club-rename card is needed, and the hint names the free first rename.
  it("says a card is needed for the club's second rename", async () => {
    const club = myClub();
    useOnlineStore.getState().setClub(club);
    server = fakeServer({
      "PATCH v1/clubs/mine": fail(409, "be.error.rename.itemRequired", {
        details: { params: { item: "clubRename" } },
      }),
    });
    render(<ClubCard club={club} />);
    fireEvent.click(screen.getByRole("button", { name: "online.club.rename" }));
    expect(screen.getByText("online.club.renameHint")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("online.club.renameLabel"), {
      target: { value: "Another Name" },
    });
    fireEvent.click(screen.getByRole("button", { name: "online.club.save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "online.rename.itemRequired.clubRename",
    );
  });
});

describe("the rename card's line (C-7b)", () => {
  const USED = { ...STRIKER, renameFree: false };
  const cards = (total: number, locked = false) => ({
    lines:
      total > 0
        ? [{ itemCode: "playerRename", powerClass: "a", total, stacks: [{ quantity: total }] }]
        : [],
    locked,
  });

  // Given a player's first rename,
  // when the dialog opens,
  // then it says the rename is free and reads no inventory.
  it("says a first rename is free", () => {
    useOnlineStore.getState().setClub(myClub({ players: [STRIKER] }));
    server = fakeServer({});
    renderSquad();
    const dialog = openRename();
    expect(within(dialog).getByRole("note")).toHaveTextContent("online.rename.free");
    expect(withoutHonours(server.requests)).toHaveLength(0);
  });

  // Given a used free rename and no card,
  // when the dialog opens,
  // then it says a card is needed with a link to buy it, and saving is off.
  it("holds the save and links to the shop without a card", async () => {
    useOnlineStore.getState().setClub(myClub({ players: [USED] }));
    server = fakeServer({ "GET v1/me/items": ok(cards(0)) });
    renderSquad();
    const dialog = openRename();
    const note = await within(dialog).findByText(/online\.rename\.needCard/);
    expect(within(note).getByRole("link", { name: "online.rename.toShop" })).toHaveAttribute(
      "href",
      "/online/shop?item=playerRename",
    );
    expect(within(dialog).getByRole("button", { name: "online.rename.save" })).toBeDisabled();
  });

  // Given a used free rename and two cards,
  // when the dialog opens,
  // then it says one card will be spent of the two, and saving is on.
  it("says the card a rename spends", async () => {
    useOnlineStore.getState().setClub(myClub({ players: [USED] }));
    server = fakeServer({ "GET v1/me/items": ok(cards(2)) });
    renderSquad();
    const dialog = openRename();
    expect(await within(dialog).findByText(/online\.rename\.willSpend:.*\|2$/)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "online.rename.save" })).toBeEnabled();
  });

  // Given a used free rename and the inventory locked by the audit,
  // when the dialog opens,
  // then it says the items are locked instead of the card, and saving is off.
  it("says the lock rather than the card while items are locked", async () => {
    useOnlineStore.getState().setClub(myClub({ players: [USED] }));
    server = fakeServer({ "GET v1/me/items": ok(cards(2, true)) });
    renderSquad();
    const dialog = openRename();
    expect(await within(dialog).findByText("online.rename.itemsLocked")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "online.rename.save" })).toBeDisabled();
  });
});
