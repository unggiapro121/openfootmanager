import { beforeEach, describe, expect, it } from "vitest";
import { readLoginEmails, rememberLoginEmail } from "./loginHistory";

describe("login email history", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps the latest login first and each email once, whatever its case", () => {
    rememberLoginEmail("a@x.com");
    rememberLoginEmail("b@x.com");
    rememberLoginEmail("A@x.com");
    expect(readLoginEmails()).toEqual(["A@x.com", "b@x.com"]);
  });

  it("keeps the eight latest", () => {
    for (let i = 0; i < 10; i += 1) rememberLoginEmail(`u${i}@x.com`);
    const emails = readLoginEmails();
    expect(emails).toHaveLength(8);
    expect(emails[0]).toBe("u9@x.com");
  });

  it("reads nothing from a damaged entry", () => {
    window.localStorage.setItem("ofm.online.loginEmails", "{not json");
    expect(readLoginEmails()).toEqual([]);
  });
});
