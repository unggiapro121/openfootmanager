import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { runSimBatch, type SimBatchConfig } from "./simLabService";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

const config: SimBatchConfig = {
  games: 500,
  seed: 42,
  home_style: "attacking",
  away_style: "counter",
  home_formation: "4-3-3",
  away_formation: "5-3-2",
  home_rating: 75,
  away_rating: 68,
  home_advantage: null,
  shot_accuracy_base: null,
  goal_conversion_base: null,
  foul_probability: null,
  yellow_card_probability: null,
  red_card_probability: null,
  penalty_probability: null,
  injury_probability: null,
};

describe("simLabService", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  // Given a batch config, when the batch runs, then the backend gets the config
  // and its results are handed back unchanged.
  it("runs a sim batch with its config", async () => {
    const results = { games: 500, goals_per_game: 2.7 };
    mockedInvoke.mockResolvedValueOnce(results);

    await expect(runSimBatch(config)).resolves.toBe(results);
    expect(mockedInvoke).toHaveBeenCalledWith("run_sim_batch", { config });
  });

  // Given a config the engine refuses, when the batch runs, then the error reaches the caller.
  it("passes a refused batch's error through", async () => {
    mockedInvoke.mockRejectedValueOnce("games must be positive");

    await expect(runSimBatch({ ...config, games: 0 })).rejects.toBe("games must be positive");
  });
});
