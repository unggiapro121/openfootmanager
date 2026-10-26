import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

vi.mock("../shrinkImage", () => ({
  AVATAR_SIDE: 256,
  shrinkToAvatar: async () => "data:image/jpeg;base64,/9j/AAAA",
}));

// The real picker reads the game's nation catalogue over IPC; a plain select stands in for it.
vi.mock("../../../components/ui/CountryCombobox", () => ({
  CountryCombobox: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (code: string) => void;
  }) => (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="VN">VN</option>
      <option value="TH">TH</option>
    </select>
  ),
}));

let server: ReturnType<typeof fakeServer>;

beforeEach(() => resetOnline());
afterEach(() => server?.restore());

const STRIKER = squadPlayer({ id: "st", matchName: "Đạo", nationality: "VN" });

function renderPlayer() {
  return render(
    <MemoryRouter initialEntries={["/online/squad/st"]}>
      <Routes>
        <Route path="/online/squad/:playerId" element={<OnlinePlayer />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("how a player looks and where he is from", () => {
  // Given a player of the coach's club,
  // when the coach picks the seventh face of the pool and saves,
  // then the seed goes to the server and the squad is its answer.
  it("picks a face from the pool", async () => {
    useOnlineStore.getState().setClub(myClub({ players: [STRIKER] }));
    server = fakeServer({
      "PATCH v1/players/st/avatar": ok(myClub({ players: [{ ...STRIKER, avatarSeed: "7" }] })),
    });
    renderPlayer();

    fireEvent.click(screen.getByRole("button", { name: "online.player.avatarChange" }));
    fireEvent.click(screen.getByRole("button", { name: "online.profile.avatarOption:7" }));
    fireEvent.click(screen.getByRole("button", { name: "online.profile.avatarSave" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(server.requests[0]?.body).toEqual({ seed: "7" });
    expect(useOnlineStore.getState().club?.players[0]?.avatarSeed).toBe("7");
  });

  // Given a player of the coach's club,
  // when the coach sends a picture from his computer,
  // then it goes to the server as a data URL, and the game keeps it to show as his face.
  it("sends a picture from the computer", async () => {
    useOnlineStore.getState().setClub(myClub({ players: [STRIKER] }));
    server = fakeServer({
      "PUT v1/players/st/avatar-image": ok(
        myClub({ players: [{ ...STRIKER, hasAvatarImage: true }] }),
      ),
    });
    renderPlayer();

    fireEvent.click(screen.getByRole("button", { name: "online.player.avatarChange" }));
    const picture = new File([new Uint8Array([1, 2, 3])], "me.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("online.profile.avatarUpload", { selector: "input" }), {
      target: { files: [picture] },
    });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(server.requests[0]?.body).toEqual({ dataUrl: "data:image/jpeg;base64,/9j/AAAA" });
    expect(useOnlineStore.getState().playerPictures.st).toBe("data:image/jpeg;base64,/9j/AAAA");
  });

  // Given a player of Vietnam,
  // when the coach changes his nationality to Thailand,
  // then the code goes to the server, and the squad shows it.
  it("changes the nationality", async () => {
    useOnlineStore.getState().setClub(myClub({ players: [STRIKER] }));
    server = fakeServer({
      "PATCH v1/players/st/nationality": ok(
        myClub({ players: [{ ...STRIKER, nationality: "TH" }] }),
      ),
    });
    renderPlayer();

    fireEvent.click(screen.getByRole("button", { name: "online.player.nationalityChange" }));
    expect(screen.getByRole("button", { name: "online.player.nationalitySave" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("common.nationality"), { target: { value: "TH" } });
    fireEvent.click(screen.getByRole("button", { name: "online.player.nationalitySave" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(server.requests[0]?.body).toEqual({ nationality: "TH" });
    expect(useOnlineStore.getState().club?.players[0]?.nationality).toBe("TH");
  });
});
