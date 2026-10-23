import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type OnlineTransport, onlineRequest, setOnlineTransport } from "./onlineTransport";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedTauriInvoke = vi.mocked(tauriInvoke);

describe("onlineTransport", () => {
  beforeEach(() => {
    mockedTauriInvoke.mockReset();
  });

  // Given no online transport has been set,
  // when a request is sent,
  // then it goes to the Rust proxy `online_request`, as it was given.
  it("sends requests to the Rust proxy by default", async () => {
    mockedTauriInvoke.mockResolvedValueOnce({ status: 200, body: { ok: true } });
    const request = { method: "GET" as const, segments: ["v1", "season"] };

    await expect(onlineRequest(request)).resolves.toEqual({ status: 200, body: { ok: true } });
    expect(mockedTauriInvoke).toHaveBeenCalledWith("online_request", { request });
  });

  // Given a fake online transport set, then restored,
  // when requests are sent before and after,
  // then the first reaches the fake and the second the proxy again.
  it("routes requests through another transport until restored", async () => {
    const sent: unknown[] = [];
    const fake: OnlineTransport = {
      request: <T>(request: unknown) => {
        sent.push(request);
        return Promise.resolve({ status: 200, body: "fake" as T });
      },
    };
    const restore = setOnlineTransport(fake);
    await onlineRequest({ method: "GET", segments: ["v1", "me"] });
    restore();
    mockedTauriInvoke.mockResolvedValueOnce({ status: 200, body: "real" });
    await expect(onlineRequest({ method: "GET", segments: ["v1", "me"] })).resolves.toEqual({
      status: 200,
      body: "real",
    });
    expect(sent).toEqual([{ method: "GET", segments: ["v1", "me"] }]);
  });
});
