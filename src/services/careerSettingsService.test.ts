import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { setDevelopmentSpeed } from "./careerSettingsService";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("careerSettingsService", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("sends the chosen development speed as a percentage", async () => {
    const response = { development_speed: 250 };
    mockedInvoke.mockResolvedValueOnce(response);

    await expect(setDevelopmentSpeed(250)).resolves.toBe(response);
    expect(mockedInvoke).toHaveBeenCalledWith("set_development_speed", { percent: 250 });
  });

  it("passes a refusal from the backend through to the caller", async () => {
    mockedInvoke.mockRejectedValueOnce("be.error.invalidDevelopmentSpeed");

    await expect(setDevelopmentSpeed(125)).rejects.toBe("be.error.invalidDevelopmentSpeed");
  });
});
