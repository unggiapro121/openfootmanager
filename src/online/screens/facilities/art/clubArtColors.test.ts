import { describe, expect, it } from "vitest";
import type { ClubProfileView } from "../../../api";
import { crestDraftOf } from "../../ClubCrestMark";
import { clubArtColors } from "./clubArtColors";

function profile(overrides: Partial<ClubProfileView> = {}): ClubProfileView {
  return {
    id: "club-1",
    name: "Cầu Vồng Nghệ An",
    shortName: "CVNA",
    city: "Vinh",
    nation: "VN",
    region: "AsiaSoutheast",
    stadiumName: "Sân Vinh",
    stadiumCapacity: 12000,
    colors: { primary: "#c8102e", secondary: "#ffffff" },
    ...overrides,
  } as ClubProfileView;
}

describe("clubArtColors", () => {
  // Given a club with a crest its coach drew,
  // when the colours of its facilities art are read,
  // then they are the crest's.
  it("takes the crest's colours when the club has one", () => {
    const crest = { primary: "#1d4ed8", secondary: "#fef08a", pattern: "Plain", label: "CV" };
    expect(clubArtColors(profile({ crest }))).toEqual({ c1: "#1d4ed8", c2: "#fef08a" });
  });

  // Given a club without a crest,
  // when the colours are read,
  // then they are the kit's.
  it("takes the kit's colours without a crest", () => {
    expect(clubArtColors(profile())).toEqual({ c1: "#c8102e", c2: "#ffffff" });
  });

  // Given kit colours written short or in capitals,
  // when the colours are read,
  // then they come back as `#rrggbb`.
  it("widens short and upper-case colours", () => {
    const colors = { primary: "#FFF", secondary: "0A0" };
    expect(clubArtColors(profile({ colors }))).toEqual({ c1: "#ffffff", c2: "#00aa00" });
  });

  // Given kit colours a colour input cannot hold,
  // when the colours are read,
  // then they fall back to the crest editor's black on white.
  it("falls back to black on white for colours it cannot read", () => {
    const colors = { primary: "red", secondary: "rgb(0,0,0)" };
    expect(clubArtColors(profile({ colors }))).toEqual({ c1: "#111827", c2: "#ffffff" });
  });

  // Given any club,
  // when the art's colours and the crest editor's draft are compared,
  // then they are the same two colours: the stadium never disagrees with the crest.
  it("agrees with the crest the club shows", () => {
    const clubs = [
      profile(),
      profile({ colors: { primary: "#abc", secondary: "nonsense" } }),
      profile({
        crest: { primary: "#000000", secondary: "#facc15", pattern: "Hoops", label: "X" },
      }),
    ];
    for (const club of clubs) {
      const draft = crestDraftOf(club);
      expect(clubArtColors(club)).toEqual({ c1: draft.primary, c2: draft.secondary });
    }
  });
});
