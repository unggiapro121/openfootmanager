import { fireEvent, render, screen } from "@testing-library/react";
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
});
