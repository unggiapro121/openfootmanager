import { describe, expect, it } from "vitest";
import { backendParam, isBackendError } from "./serverAuth.helpers";

describe("a backend error and its parameters", () => {
  // Given a login refused with the day the account is to be deleted (M3c1),
  // when the screen asks which refusal it is and for its day,
  // then the code matches without its parameters, and the day comes back decoded.
  it("reads a refusal's code and parameter", () => {
    const refusal = "be.error.auth.deletionPending?deleteAt=2026-11-19T10%3A00%3A00Z";

    expect(isBackendError(refusal, "be.error.auth.deletionPending")).toBe(true);
    expect(backendParam(refusal, "be.error.auth.deletionPending", "deleteAt")).toBe(
      "2026-11-19T10:00:00Z",
    );
  });

  // Given another refusal, or one without the parameter,
  // when the screen asks for the day,
  // then there is none.
  it("finds no parameter on another refusal", () => {
    expect(
      backendParam("be.error.auth.invalidCredentials", "be.error.auth.deletionPending", "deleteAt"),
    ).toBeNull();
    expect(
      backendParam("be.error.auth.deletionPending", "be.error.auth.deletionPending", "deleteAt"),
    ).toBeNull();
    expect(
      isBackendError(new Error("be.error.auth.emailNotVerified"), "be.error.auth.emailNotVerified"),
    ).toBe(true);
    expect(
      isBackendError("be.error.auth.emailNotVerifiedX", "be.error.auth.emailNotVerified"),
    ).toBe(false);
  });
});
