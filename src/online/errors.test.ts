import { describe, expect, it } from "vitest";
import { fromSessionRejection, OnlineApiError } from "./errors";

describe("a refusal from the session's commands", () => {
  // Given a session command that got no answer (M3c1's deletion),
  // when its rejection is read as an online error,
  // then it is "no answer" (status 0), so the action's key is kept for the retry.
  it("reads no answer as status 0", () => {
    const error = fromSessionRejection("be.error.coach.offline");

    expect(error).toBeInstanceOf(OnlineApiError);
    expect(error.status).toBe(0);
    expect(error.code).toBe("be.error.coach.offline");
  });

  // Given a refusal the server answered, with its parameters,
  // when it is read,
  // then its code and parameters are kept, the message is the same `code?name=value` form, and it
  // is not "no answer".
  it("keeps an answered refusal's code and parameters", () => {
    const error = fromSessionRejection(
      "be.error.auth.deletionPending?deleteAt=2026-11-19T10%3A00%3A00Z",
    );

    expect(error.status).not.toBe(0);
    expect(error.code).toBe("be.error.auth.deletionPending");
    expect(error.params).toEqual({ deleteAt: "2026-11-19T10:00:00Z" });
    expect(error.message).toBe("be.error.auth.deletionPending?deleteAt=2026-11-19T10%3A00%3A00Z");
  });

  // Given something that is not a session key, when it is read, then the server misbehaved.
  it("reads anything else as the server misbehaving", () => {
    expect(fromSessionRejection(new Error("boom")).code).toBe("be.error.online.serverUnexpected");
  });
});
