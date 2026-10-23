import { describe, expect, it } from "vitest";
import { isWholeCode, typedCode, waitedText } from "./friendlyCode";

describe("friendly room codes", () => {
  // Given what a coach types into the code field,
  // when it is tidied,
  // then it is upper case, keeps only the code's characters (no 0, O, 1, I), at most six, with
  // the dash after the third.
  it("tidies a code as it is typed", () => {
    expect(typedCode("k7q")).toBe("K7Q");
    expect(typedCode("k7q2")).toBe("K7Q-2");
    expect(typedCode("k7q-2mx")).toBe("K7Q-2MX");
    expect(typedCode(" k7 q2 mx zz")).toBe("K7Q-2MX");
    expect(typedCode("O0I1ab")).toBe("AB");
    expect(isWholeCode("K7Q-2MX")).toBe(true);
    expect(isWholeCode("K7Q-2M")).toBe(false);
  });

  // Given a coach queued 75 s ago, and a clock a little behind the server's,
  // when the time waited is shown,
  // then it reads 1:15, and never below 0:00.
  it("shows the time waited in the queue", () => {
    const now = Date.parse("2026-10-24T10:01:15Z");
    expect(waitedText("2026-10-24T10:00:00Z", now)).toBe("1:15");
    expect(waitedText("2026-10-24T10:01:20Z", now)).toBe("0:00");
  });
});
