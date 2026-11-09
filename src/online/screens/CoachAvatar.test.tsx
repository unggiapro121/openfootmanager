import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AccountView } from "../api";
import { CoachPortrait } from "./CoachAvatar";

function account(names: { firstName?: string; lastName?: string }): AccountView {
  return {
    id: "account-1",
    email: "coach@example.com",
    firstName: "Văn",
    lastName: "Việt",
    dateOfBirth: "1990-01-01",
    nationality: "VN",
    region: "AsiaSoutheast",
    status: "active",
    capabilities: [],
    hasAvatarImage: false,
    ...names,
  } as AccountView;
}

describe("CoachPortrait", () => {
  // Given a coach with both names,
  // when his portrait has no face to show,
  // then it shows the first letter of each.
  it("shows the coach's initials", () => {
    render(<CoachPortrait account={account({})} />);

    expect(screen.getByText("VV")).toBeInTheDocument();
  });

  // Given an account with an empty first name, and one whose server left both names out (an
  // older server, or a test kit's bare account),
  // when its portrait is drawn,
  // then it draws without breaking, with the initial it has and none it has not.
  it("draws an account without a name", () => {
    render(<CoachPortrait account={account({ firstName: "" })} />);
    expect(screen.getByText("V")).toBeInTheDocument();

    const bare = { id: "account-2" } as unknown as AccountView;
    expect(() => render(<CoachPortrait account={bare} />)).not.toThrow();
  });
});
