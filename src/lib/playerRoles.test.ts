import { describe, expect, it } from "vitest";

import { centreBackPairGap, getRoleOptions, getRolesForPosition } from "./playerRoles";
import type { PlayerRole } from "../store/types";

// Canonical position -> valid-role table. This MUST stay in lock-step with the
// backend validator `role_valid_for_position` in
// src-tauri/src/commands/squad.rs (mirrored there by an equivalent Rust test).
// If you change one side, change the other — otherwise the role dropdown offers
// a role the backend rejects (or hides one it accepts).
const CANONICAL: Record<string, PlayerRole[]> = {
  Goalkeeper: ["Standard", "BallPlayingKeeper", "SweeperKeeper"],
  CenterBack: ["Standard", "Stopper", "CoverCB", "BallPlayingCB"],
  RightBack: ["Standard", "AttackingFB", "DefensiveFB", "InvertedFB", "WingBack"],
  LeftBack: ["Standard", "AttackingFB", "DefensiveFB", "InvertedFB", "WingBack"],
  RightWingBack: ["Standard", "AttackingFB", "DefensiveFB", "InvertedFB", "WingBack"],
  LeftWingBack: ["Standard", "AttackingFB", "DefensiveFB", "InvertedFB", "WingBack"],
  DefensiveMidfielder: ["Standard", "AnchorMan", "BallWinner", "DeepLyingPlaymaker", "HalfBack"],
  CentralMidfielder: ["Standard", "BoxToBox", "Carrilero", "Mezzala"],
  AttackingMidfielder: ["Standard", "AdvancedPlaymaker", "ShadowStriker"],
  RightMidfielder: [
    "Standard",
    "WideForward",
    "InsideForward",
    "InvertedWinger",
    "DefensiveWinger",
  ],
  LeftMidfielder: ["Standard", "WideForward", "InsideForward", "InvertedWinger", "DefensiveWinger"],
  RightWinger: ["Standard", "WideForward", "InsideForward", "InvertedWinger", "DefensiveWinger"],
  LeftWinger: ["Standard", "WideForward", "InsideForward", "InvertedWinger", "DefensiveWinger"],
  Striker: [
    "Standard",
    "Poacher",
    "TargetMan",
    "DeepLyingForward",
    "False9",
    "PressingForward",
    "CompleteForward",
  ],
  // Legacy coarse buckets (canonicalised/legacy positions) — the union of their
  // group's detailed roles, matching the backend's P::Defender/Midfielder/Forward
  // deny-list branches.
  Defender: [
    "Standard",
    "Stopper",
    "CoverCB",
    "BallPlayingCB",
    "AttackingFB",
    "DefensiveFB",
    "InvertedFB",
    "WingBack",
  ],
  Midfielder: [
    "Standard",
    "AnchorMan",
    "BallWinner",
    "DeepLyingPlaymaker",
    "BoxToBox",
    "Carrilero",
    "Mezzala",
    "AdvancedPlaymaker",
    "ShadowStriker",
    "WideForward",
    "InsideForward",
    "InvertedWinger",
    "HalfBack",
    "DefensiveWinger",
  ],
  Forward: [
    "Standard",
    "WideForward",
    "InsideForward",
    "InvertedWinger",
    "DefensiveWinger",
    "Poacher",
    "TargetMan",
    "DeepLyingForward",
    "False9",
    "PressingForward",
    "CompleteForward",
  ],
};

describe("playerRoles position->roles parity", () => {
  it("offers exactly the backend-accepted roles for each granular position", () => {
    for (const [position, expected] of Object.entries(CANONICAL)) {
      expect(getRolesForPosition(position)).toEqual(expected);
    }
  });

  // Regression for the FE/BE drift caught in review: these used to disagree with
  // the validator, so selecting the role silently reverted.
  it("does not offer roles the backend rejects for the position", () => {
    expect(getRolesForPosition("DefensiveMidfielder")).not.toContain("BoxToBox");
    expect(getRolesForPosition("AttackingMidfielder")).not.toContain("Mezzala");
    expect(getRolesForPosition("CentralMidfielder")).not.toContain("AdvancedPlaymaker");
    expect(getRolesForPosition("RightMidfielder")).not.toContain("Carrilero");
  });

  it("offers backend-accepted roles that were previously missing", () => {
    // Wide midfielders can be inverted wingers; wing-backs can be defensive.
    expect(getRolesForPosition("RightMidfielder")).toContain("InvertedWinger");
    expect(getRolesForPosition("RightWingBack")).toContain("DefensiveFB");
  });

  it("keeps a stale assigned role visible via getRoleOptions", () => {
    // A striker function on a player now at right-back: the dropdown still shows
    // it (prepended) so the controlled <select> stays in sync until reassigned.
    const options = getRoleOptions("RightBack", "Poacher");
    expect(options[0]).toBe("Poacher");
    expect(options).toContain("DefensiveFB");
  });
});

describe("centreBackPairGap", () => {
  const backFour = ["LeftBack", "CenterBack", "CenterBack", "RightBack"];
  const slots = (ids: string[]) =>
    backFour.map((position, index) => ({ position, playerId: ids[index] ?? null }));

  // Given two Stoppers, or two Cover CBs, side by side at centre-back, then
  // the pair is named; a Stopper beside a Cover CB, or a role on a full-back,
  // names nothing (the engine's centre-back pair, phase 2 P2.6).
  it("names a pair of one kind at centre-back and nothing else", () => {
    const ids = ["lb", "cb1", "cb2", "rb"];
    expect(centreBackPairGap(slots(ids), { cb1: "Stopper", cb2: "Stopper" })).toBe("stoppers");
    expect(centreBackPairGap(slots(ids), { cb1: "CoverCB", cb2: "CoverCB" })).toBe("covers");
    expect(centreBackPairGap(slots(ids), { cb1: "Stopper", cb2: "CoverCB" })).toBeNull();
    expect(centreBackPairGap(slots(ids), { lb: "Stopper", cb1: "Stopper" })).toBeNull();
    expect(centreBackPairGap(slots(ids), {})).toBeNull();
  });
});
