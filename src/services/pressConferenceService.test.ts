import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";

import { submitPressConference } from "./pressConferenceService";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("submitPressConference", () => {
  // Given the manager's answers, when the press conference ends, then they are
  // sent as `answers` and the updated game comes back.
  it("sends the answers and returns the updated game", async () => {
    const outcome = { game: { id: "g" }, morale_delta: 2 };
    vi.mocked(invoke).mockResolvedValue(outcome);
    const answers = [
      {
        question_id: "q1",
        response_id: "r1",
        response_tone: "confident",
        response_text: "We were the better side.",
        response_text_key: "press.r1",
        question_text: "How do you rate the performance?",
        player_id: "",
      },
    ];

    const result = await submitPressConference(answers);

    expect(invoke).toHaveBeenCalledWith("submit_press_conference", { answers });
    expect(result).toBe(outcome);
  });
});
