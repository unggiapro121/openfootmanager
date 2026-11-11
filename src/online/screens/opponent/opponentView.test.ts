import { describe, expect, it } from "vitest";
import { formatGap, formatTenth, lineStrength, perMatch, playerHref, totals } from "./opponentView";

describe("lineStrength", () => {
  // Given four defenders of 70, 72, 68 and 71 (C-23a §6.4's example),
  // when their line's strength is taken,
  // then it is their mean rounded to a tenth: 70.25 → 70.3.
  it("averages a line and rounds to a tenth", () => {
    const players = [70, 72, 68, 71].map((ovr) => ({ position: "Defender", ovr }));
    expect(lineStrength(players)).toEqual({ Defender: 70.3 });
  });

  // Given a side of granular and coarse positions with no forward,
  // when the lines are taken,
  // then each player counts in his broad line, and the empty line is left out.
  it("groups granular positions by line and leaves an empty line out", () => {
    const players = [
      { position: "Goalkeeper", ovr: 64 },
      { position: "CenterBack", ovr: 70 },
      { position: "LeftBack", ovr: 66 },
      { position: "DefensiveMidfielder", ovr: 71 },
      { position: "Midfielder", ovr: 68 },
    ];
    expect(lineStrength(players)).toEqual({ Goalkeeper: 64, Defender: 68, Midfielder: 69.5 });
  });
});

describe("playerHref", () => {
  const myClub = { players: [{ id: "mine-1" }, { id: "mine-2" }] };

  // Given the coach's own squad,
  // when a player of his is linked,
  // then the link opens the squad page, where he can act on him.
  it("sends the coach's own player to his squad page", () => {
    expect(playerHref("mine-2", myClub)).toBe("/online/squad/mine-2");
  });

  // Given another club's player, or a coach with no club,
  // when the player is linked,
  // then the link opens the read-only public page.
  it("sends anyone else's player to the public page", () => {
    expect(playerHref("theirs-1", myClub)).toBe("/online/players/theirs-1");
    expect(playerHref("theirs-1", null)).toBe("/online/players/theirs-1");
  });
});

describe("the profile's figures", () => {
  // Given means and gaps between two lines,
  // when they are written,
  // then a whole number keeps no decimals, others one, and a gap carries its sign (a true minus).
  it("writes a figure to a tenth and a gap with its sign", () => {
    expect(formatTenth(70.25, "en")).toBe("70.3");
    expect(formatTenth(72, "en")).toBe("72");
    expect(formatTenth(70.3, "vi")).toBe("70,3");
    expect(formatGap(1.7, "en")).toBe("+1.7");
    expect(formatGap(-4, "en")).toBe("\u22124");
    expect(formatGap(0, "en")).toBe("0");
  });

  // Given three matches won 2–1, drawn 0–0 and lost 1–3,
  // when they are summed up,
  // then they are one of each, scoring 1 and conceding 1.3 a match; no match gives nothing.
  it("totals results and goals a match", () => {
    const matches = [
      { outcome: "W", goalsFor: 2, goalsAgainst: 1 },
      { outcome: "D", goalsFor: 0, goalsAgainst: 0 },
      { outcome: "L", goalsFor: 1, goalsAgainst: 3 },
    ];
    expect(totals(matches)).toEqual({ won: 1, drawn: 1, lost: 1 });
    expect(perMatch(matches)).toEqual({ scored: 1, conceded: 4 / 3 });
    expect(perMatch([])).toBeNull();
  });
});
