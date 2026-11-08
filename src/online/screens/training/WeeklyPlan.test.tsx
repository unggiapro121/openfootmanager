import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WeeklyPlan from "./WeeklyPlan";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      options && typeof options === "object"
        ? `${key}:${Object.values(options as Record<string, unknown>).join("|")}`
        : key,
    i18n: { language: "en" },
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}));

describe("the weekly plan tab", () => {
  const PLAN = {
    focus: "Tactical" as const,
    intensity: "High" as const,
    schedule: "Intense" as const,
    groups: [],
    auto: true,
    autoFocus: false,
  };

  // Given a plan on the intense schedule at High,
  // when the coach picks the light schedule and Low,
  // then each choice is passed on, and the current ones are the checked radios.
  it("passes on the schedule and the intensity picked", () => {
    const onSchedule = vi.fn();
    const onIntensity = vi.fn();
    render(
      <WeeklyPlan
        plan={PLAN}
        weekday={4}
        disabled={false}
        onSchedule={onSchedule}
        onFocus={vi.fn()}
        onIntensity={onIntensity}
      />,
    );
    expect(
      screen.getByRole("radio", { name: /training\.schedules\.Intense\.label/ }),
    ).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: /training\.schedules\.Light\.label/ }));
    expect(onSchedule).toHaveBeenCalledWith("Light");
    fireEvent.click(screen.getByRole("radio", { name: /training\.intensities\.Low\.label/ }));
    expect(onIntensity).toHaveBeenCalledWith("Low");
    expect(screen.getByText("online.training.plan.summary")).toBeInTheDocument();
  });

  // Given the plan saving,
  // when the tab shows,
  // then every choice is off.
  it("turns every choice off while saving", () => {
    render(
      <WeeklyPlan
        plan={PLAN}
        weekday={null}
        disabled
        onSchedule={vi.fn()}
        onFocus={vi.fn()}
        onIntensity={vi.fn()}
      />,
    );
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
  });

  // T-C1 (C-13b C13b-1): "Auto" as the seventh card of the club's focus.
  const focusCards = () =>
    within(screen.getByRole("radiogroup", { name: "training.trainingFocus" })).getAllByRole(
      "radio",
    );
  const checked = () => focusCards().filter((card) => card.getAttribute("aria-checked") === "true");

  // Given a season that does not open "Auto",
  // when the tab shows,
  // then the club's focus offers the six focuses, the plan's one checked.
  it("offers six focuses while the season keeps Auto closed", () => {
    render(
      <WeeklyPlan
        plan={PLAN}
        weekday={null}
        disabled={false}
        onSchedule={vi.fn()}
        onFocus={vi.fn()}
        onIntensity={vi.fn()}
      />,
    );
    expect(focusCards()).toHaveLength(6);
    expect(screen.queryByRole("radio", { name: /online\.training\.focus\.auto/ })).toBeNull();
    expect(checked()).toHaveLength(1);
  });

  // Given a season open to "Auto" and a club on Tactical,
  // when the coach picks "Auto",
  // then seven cards show, "Auto" first, only Tactical checked, and "Auto" is passed on.
  it("offers Auto first among seven cards and passes it on", () => {
    const onFocus = vi.fn();
    render(
      <WeeklyPlan
        plan={PLAN}
        weekday={null}
        autoOpen
        disabled={false}
        onSchedule={vi.fn()}
        onFocus={onFocus}
        onIntensity={vi.fn()}
      />,
    );
    expect(focusCards()).toHaveLength(7);
    expect(focusCards()[0]).toHaveAccessibleName(/online\.training\.focus\.auto/);
    expect(checked()).toEqual([
      screen.getByRole("radio", { name: /training\.focuses\.Tactical\.label/ }),
    ]);
    fireEvent.click(focusCards()[0]);
    expect(onFocus).toHaveBeenCalledWith("Auto");
  });

  // Given a club on "Auto" whose saved focus is Tactical,
  // when the tab shows,
  // then only "Auto" is checked, the line under the cards says how "Auto" picks and how to keep
  // match fitness, and the summary is Auto's.
  it("checks Auto alone and says how it picks", () => {
    render(
      <WeeklyPlan
        plan={{ ...PLAN, autoFocus: true }}
        weekday={null}
        autoOpen
        disabled={false}
        onSchedule={vi.fn()}
        onFocus={vi.fn()}
        onIntensity={vi.fn()}
      />,
    );
    expect(checked()).toEqual([
      screen.getByRole("radio", { name: /online\.training\.focus\.auto/ }),
    ]);
    expect(screen.getByText("online.training.focus.autoDesc")).toBeInTheDocument();
    expect(screen.getByText("online.training.focus.autoFitness")).toBeInTheDocument();
    expect(screen.queryByText("training.focuses.Tactical.desc")).toBeNull();
    expect(screen.getByText("online.training.plan.summaryAuto")).toBeInTheDocument();
  });
});
