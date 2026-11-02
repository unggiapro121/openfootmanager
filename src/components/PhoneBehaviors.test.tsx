import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { phone } = vi.hoisted(() => ({
  phone: {
    mobile: true,
    back: null as null | (() => void),
    stops: 0,
    listens: 0,
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../lib/platform", () => ({ isMobileBuild: () => phone.mobile }));
vi.mock("../services/platformService", () => ({
  onPhoneBackButton: async (handler: () => void) => {
    phone.listens += 1;
    phone.back = handler;
    return () => {
      phone.stops += 1;
      phone.back = null;
    };
  },
}));

import { pushBackAction } from "../lib/backActions";
import PhoneBehaviors from "./PhoneBehaviors";

function Where() {
  return <output aria-label="location">{useLocation().pathname}</output>;
}

function renderAt(...entries: string[]) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <PhoneBehaviors />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const where = () => screen.getByLabelText("location").textContent;
async function pressBack() {
  await act(async () => {
    phone.back?.();
  });
}
async function settle() {
  await act(async () => {});
}

beforeEach(() => {
  phone.mobile = true;
  phone.back = null;
  phone.stops = 0;
  phone.listens = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the phone's Back button", () => {
  // Given a page of the online mode opened from the overview,
  // when Back is pressed,
  // then the app goes back to the overview instead of closing (M1 rebuild finding 2).
  it("goes back a page", async () => {
    renderAt("/online", "/online/shop");
    await settle();

    await pressBack();
    expect(where()).toBe("/online");
  });

  // Given a screen holding Back (a sheet open, the register form a step in),
  // when Back is pressed,
  // then that screen's action runs and the page stays.
  it("lets an open sheet or form step back first", async () => {
    const closeSheet = vi.fn();
    const release = pushBackAction(closeSheet);
    renderAt("/online", "/online/shop");
    await settle();

    await pressBack();
    expect(closeSheet).toHaveBeenCalledTimes(1);
    expect(where()).toBe("/online/shop");
    release();
  });

  // Given the online overview, the app's first page,
  // when Back is pressed once,
  // then a note asks for Back again, and for two seconds the app stops holding Back so the next
  // press closes it; after that it holds Back again.
  it("asks for a second Back before the app closes", async () => {
    vi.useFakeTimers();
    renderAt("/online");
    await settle();
    expect(phone.listens).toBe(1);

    await pressBack();
    expect(screen.getByText("mobile.pressBackAgain")).toHaveAttribute("role", "status");
    expect(phone.stops).toBe(1);

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByText("mobile.pressBackAgain")).toBeNull();
    expect(phone.listens).toBe(2);
  });

  // Given the desktop app,
  // when it starts,
  // then nothing listens to a phone's Back.
  it("stays out of the desktop app", async () => {
    phone.mobile = false;
    renderAt("/");
    await settle();
    expect(phone.listens).toBe(0);
  });
});

describe("the phone's keyboard", () => {
  // Given a form near the bottom of the screen,
  // when the coach taps a field and the keyboard rises,
  // then the field is scrolled into view (M1 rebuild finding 5).
  it("scrolls a focused field into view", async () => {
    vi.useFakeTimers();
    renderAt("/");
    const field = document.createElement("input");
    field.scrollIntoView = vi.fn();
    document.body.appendChild(field);

    act(() => field.focus());
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(field.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "center" }));
    field.remove();
  });
});
