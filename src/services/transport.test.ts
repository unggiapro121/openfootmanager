import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type GameTransport, invoke, setGameTransport } from "./transport";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedTauriInvoke = vi.mocked(tauriInvoke);

describe("transport", () => {
  beforeEach(() => {
    mockedTauriInvoke.mockReset();
  });

  // Given no transport has been set,
  // when a service sends a command with arguments,
  // then it reaches Tauri IPC unchanged.
  it("sends commands over Tauri IPC by default", async () => {
    mockedTauriInvoke.mockResolvedValueOnce("pong");

    await expect(invoke<string>("ping", { at: 1 })).resolves.toBe("pong");
    expect(mockedTauriInvoke).toHaveBeenCalledWith("ping", { at: 1 });
  });

  // Given no transport has been set,
  // when a command is sent without arguments,
  // then Tauri receives a one-argument call, exactly as before the layer existed.
  it("forwards a command without arguments as a one-argument call", async () => {
    mockedTauriInvoke.mockResolvedValueOnce(undefined);

    await invoke("get_settings");
    expect(mockedTauriInvoke.mock.calls[0]).toEqual(["get_settings"]);
  });

  describe("with another transport set", () => {
    const sent: Array<[string, unknown]> = [];
    const fake: GameTransport = {
      invoke: <T>(command: string, args?: unknown) => {
        sent.push([command, args]);
        return Promise.resolve("from fake" as T);
      },
    };
    let restore: () => void = () => {};

    beforeEach(() => {
      sent.length = 0;
      restore = setGameTransport(fake);
    });

    afterEach(() => {
      restore();
    });

    // Given another transport is active,
    // when a service sends a command,
    // then that transport answers and Tauri is never called.
    it("routes every call through the active transport", async () => {
      await expect(invoke<string>("get_team", { id: "t1" })).resolves.toBe("from fake");
      expect(sent).toEqual([["get_team", { id: "t1" }]]);
      expect(mockedTauriInvoke).not.toHaveBeenCalled();
    });

    // Given another transport was set,
    // when the restore function runs,
    // then calls go back over Tauri IPC.
    it("restores the previous transport", async () => {
      restore();
      mockedTauriInvoke.mockResolvedValueOnce("ipc");

      await expect(invoke<string>("ping")).resolves.toBe("ipc");
      expect(sent).toEqual([]);
    });
  });
});
