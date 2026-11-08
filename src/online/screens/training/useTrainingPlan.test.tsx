import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MyClubView, TrainingPlan } from "../../api";
import { fakeServer, myClub, ok, resetOnline } from "../../../test-utils/onlineTestKit";
import { AUTO_FOCUS } from "./autoFocus";
import { useTrainingPlan } from "./useTrainingPlan";

let server: ReturnType<typeof fakeServer>;

beforeEach(() => resetOnline());
afterEach(() => server?.restore());

const PLAN: TrainingPlan = {
  focus: "Tactical",
  intensity: "Medium",
  schedule: "Balanced",
  groups: [],
  auto: true,
  autoFocus: false,
};

/** A club open to "Auto" on `plan`, its saves answered with what was sent. */
function stage(plan: Partial<TrainingPlan>, own = true): MyClubView {
  const club = myClub({
    trainingPlan: { ...PLAN, ...plan },
    trainingPlanIsOwn: own,
    autoFocusOpen: true,
  });
  server = fakeServer({
    "PUT v1/clubs/mine/training": (request) => ok(request.body),
    "GET v1/clubs/mine": ok(club),
  });
  return club;
}

/** The plans the hook wrote, in order. */
function sent(): TrainingPlan[] {
  return server.requests
    .filter((request) => request.method === "PUT")
    .map((request) => request.body as TrainingPlan);
}

/** Runs one change of the hook and waits for its write. */
async function change(club: MyClubView, act_: (hook: ReturnType<typeof useTrainingPlan>) => void) {
  const { result } = renderHook(() => useTrainingPlan(club));
  const before = sent().length;
  act(() => act_(result.current));
  await waitFor(() => expect(sent().length).toBe(before + 1));
  return sent()[before];
}

// T-C2 (C-13b C13b-2, R31c-C1): what a save of the club's plan sends about "Auto".
describe("saving the plan with Auto (C-13b)", () => {
  // Given a club whose saved focus is Recovery,
  // when the coach picks "Auto",
  // then the plan goes out on Auto with Technical, since the server never pairs Auto with
  // Recovery.
  it("sends Technical when Auto is picked over Recovery", async () => {
    const club = stage({ focus: "Recovery" });
    const plan = await change(club, (hook) => hook.setFocus(AUTO_FOCUS));
    expect(plan).toMatchObject({ autoFocus: true, focus: "Technical" });
  });

  // Given a club whose saved focus is Tactical,
  // when the coach picks "Auto",
  // then the plan goes out on Auto and keeps Tactical as the focus to fall back on.
  it("keeps the saved focus when Auto is picked over another one", async () => {
    const club = stage({ focus: "Tactical" });
    const plan = await change(club, (hook) => hook.setFocus(AUTO_FOCUS));
    expect(plan).toEqual({ ...PLAN, autoFocus: true, focus: "Tactical" });
  });

  // Given a club on Auto,
  // when the coach picks Defending,
  // then Auto is off and the club trains Defending.
  it("turns Auto off when a focus is picked", async () => {
    const club = stage({ autoFocus: true });
    const plan = await change(club, (hook) => hook.setFocus("Defending"));
    expect(plan).toMatchObject({ autoFocus: false, focus: "Defending" });
  });

  // Given a club on Auto,
  // when the coach changes the intensity, then the schedule,
  // then each plan keeps Auto on.
  it("keeps Auto through a change of intensity or schedule", async () => {
    const club = stage({ autoFocus: true });
    expect(await change(club, (hook) => hook.setIntensity("High"))).toMatchObject({
      autoFocus: true,
      intensity: "High",
      focus: "Tactical",
    });
    expect(await change(club, (hook) => hook.setSchedule("Light"))).toMatchObject({
      autoFocus: true,
      schedule: "Light",
    });
  });

  // Given a coach with no plan of his own, whose club the AI left on Recovery, and the server
  // showing that plan on Auto (R31c-C1),
  // when the coach changes the intensity, the schedule or the groups,
  // then each plan goes out on Auto with Technical, never the Recovery the server refuses.
  it("never sends Auto with Recovery, whatever is changed", async () => {
    const club = stage({ focus: "Recovery", autoFocus: true }, false);
    expect(await change(club, (hook) => hook.setIntensity("High"))).toMatchObject({
      autoFocus: true,
      focus: "Technical",
      intensity: "High",
    });
    expect(await change(club, (hook) => hook.setSchedule("Light"))).toMatchObject({
      autoFocus: true,
      focus: "Technical",
    });
    expect(await change(club, (hook) => hook.saveGroups([]))).toMatchObject({
      autoFocus: true,
      focus: "Technical",
    });
  });

  // Given a club not on Auto whose focus is Recovery,
  // when the coach changes the intensity,
  // then Recovery stays: only Auto is kept off it.
  it("keeps Recovery on a plan that is not on Auto", async () => {
    const club = stage({ focus: "Recovery" });
    expect(await change(club, (hook) => hook.setIntensity("Low"))).toMatchObject({
      autoFocus: false,
      focus: "Recovery",
      intensity: "Low",
    });
  });
});
