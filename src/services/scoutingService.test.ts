import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import {
  assignWatchlistScout,
  cancelYouthScouting,
  getClubPotentialAssessments,
  getPlayerProjection,
  quoteYouthSearch,
  reassignYouthScouting,
  sendScout,
  signWatchedProspect,
  startYouthScouting,
  unwatchProspect,
} from "./scoutingService";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("scoutingService", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("asks for a player's projection and passes the backend's refusal on", async () => {
    const projection = { player_id: "player-1", wonderkid: false };
    mockedInvoke.mockResolvedValueOnce(projection);

    await expect(getPlayerProjection("player-1")).resolves.toBe(projection);
    expect(mockedInvoke).toHaveBeenCalledWith("get_player_projection", { playerId: "player-1" });

    mockedInvoke.mockRejectedValueOnce("be.error.projection.noAssessor");
    await expect(getPlayerProjection("player-1")).rejects.toBe("be.error.projection.noAssessor");
  });

  it("asks for the club's potential assessments", async () => {
    const assessments = { assessor: null, players: [] };
    mockedInvoke.mockResolvedValueOnce(assessments);

    await expect(getClubPotentialAssessments()).resolves.toBe(assessments);
    expect(mockedInvoke).toHaveBeenCalledWith("get_club_potential_assessments");
  });

  it("calls the send scout backend command", async () => {
    const response = { manager: { id: "manager-1" } };
    mockedInvoke.mockResolvedValueOnce(response);

    await expect(sendScout("staff-1", "player-1")).resolves.toBe(response);
    expect(mockedInvoke).toHaveBeenCalledWith("send_scout", {
      scoutId: "staff-1",
      playerId: "player-1",
    });
  });

  it("calls the youth scouting backend command", async () => {
    const response = { manager: { id: "manager-1" } };
    mockedInvoke.mockResolvedValueOnce(response);

    await expect(
      startYouthScouting({
        scoutId: "staff-1",
        region: "Domestic",
        objective: "Balanced",
        targetPosition: "Defender",
      }),
    ).resolves.toBe(response);
    expect(mockedInvoke).toHaveBeenCalledWith("start_youth_scouting", {
      scoutId: "staff-1",
      region: "Domestic",
      objective: "Balanced",
      targetPosition: "Defender",
    });
  });

  it("calls the cancel youth scouting backend command", async () => {
    const response = { manager: { id: "manager-1" } };
    mockedInvoke.mockResolvedValueOnce(response);

    await expect(cancelYouthScouting("ysa-1")).resolves.toBe(response);
    expect(mockedInvoke).toHaveBeenCalledWith("cancel_youth_scouting", {
      assignmentId: "ysa-1",
    });
  });

  it("calls the reassign youth scouting backend command", async () => {
    const response = { manager: { id: "manager-1" } };
    mockedInvoke.mockResolvedValueOnce(response);

    await expect(reassignYouthScouting("ysa-1", "staff-2")).resolves.toBe(response);
    expect(mockedInvoke).toHaveBeenCalledWith("reassign_youth_scouting", {
      assignmentId: "ysa-1",
      scoutId: "staff-2",
    });
  });

  it("quotes a youth search without changing anything", async () => {
    const quote = { fee: 15_000, days: 5, rest_days_left: 0 };
    mockedInvoke.mockResolvedValueOnce(quote);

    await expect(quoteYouthSearch("scout-1", "Domestic", "Balanced")).resolves.toEqual(quote);
    expect(mockedInvoke).toHaveBeenCalledWith("quote_youth_search", {
      scoutId: "scout-1",
      region: "Domestic",
      objective: "Balanced",
    });
  });

  it("sends the watchlist commands", async () => {
    mockedInvoke.mockResolvedValue({});

    await assignWatchlistScout("kid-1", "scout-1");
    await assignWatchlistScout("kid-1", null);
    await signWatchedProspect("kid-1");
    await unwatchProspect("kid-1");

    expect(mockedInvoke).toHaveBeenNthCalledWith(1, "assign_watchlist_scout", {
      prospectId: "kid-1",
      scoutId: "scout-1",
    });
    expect(mockedInvoke).toHaveBeenNthCalledWith(2, "assign_watchlist_scout", {
      prospectId: "kid-1",
      scoutId: null,
    });
    expect(mockedInvoke).toHaveBeenNthCalledWith(3, "sign_watched_prospect", {
      prospectId: "kid-1",
    });
    expect(mockedInvoke).toHaveBeenNthCalledWith(4, "unwatch_prospect", { prospectId: "kid-1" });
  });
});
