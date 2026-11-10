import { describe, expect, it } from "vitest";
import { lineStrength, playerHref } from "./opponentView";

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
