import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { getManagerProgression } from "./managerProgressionService";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("managerProgressionService", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("asks the backend for the user's play style progression", async () => {
    // Given the backend returns the progression view
    const view = { styles: [], xp_for_a_win: 15, xp_for_a_draw: 10, xp_for_a_loss: 7 };
    mockedInvoke.mockResolvedValueOnce(view);

    // When it is requested
    const result = await getManagerProgression();

    // Then the command is called without arguments and its answer comes back as is
    expect(result).toBe(view);
    expect(mockedInvoke).toHaveBeenCalledWith("get_manager_progression");
  });
});
