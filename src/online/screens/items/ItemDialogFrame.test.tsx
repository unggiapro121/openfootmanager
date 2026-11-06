import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PHONE_QUERY } from "../../../hooks/usePhoneLayout";
import { runBackAction } from "../../../lib/backActions";
import ItemDialogFrame, { FRAME_ACTION, FrameButtons, FrameCancel } from "./ItemDialogFrame";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function windowOf(phone: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: phone && query === PHONE_QUERY,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

function frame({
  busy = false,
  keep = false,
  onClose = vi.fn(),
}: {
  busy?: boolean;
  keep?: boolean;
  onClose?: () => void;
}) {
  render(
    <ItemDialogFrame
      code="energyDrinkSmall"
      title="Drink"
      busy={busy}
      onClose={onClose}
      footer={
        <FrameButtons>
          <FrameCancel onClick={onClose} keepOnPhone={keep}>
            cancel
          </FrameCancel>
          <button type="button" className={FRAME_ACTION}>
            go
          </button>
        </FrameButtons>
      }
    >
      <p>body</p>
    </ItemDialogFrame>,
  );
  return onClose;
}

afterEach(() => {
  // An unmounted sheet lets go of Back.
  cleanup();
  expect(runBackAction()).toBe(false);
  vi.unstubAllGlobals();
});

describe("the item dialog frame on a phone", () => {
  // Given a phone,
  // when the frame opens,
  // then it is a sheet from the bottom: its body and footer apart, a close-only button gone,
  // the main button kept.
  it("is a bottom sheet with a footer and no close-only button", () => {
    windowOf(true);
    frame({});

    const dialog = screen.getByRole("dialog", { name: "Drink" });
    expect(dialog.dataset.layout).toBe("sheet");
    expect(screen.getByRole("contentinfo").textContent).toContain("go");
    expect(screen.queryByRole("button", { name: "cancel" })).toBeNull();
  });

  // Given a phone and a secondary button that does a job of its own,
  // when the frame opens,
  // then that button stays.
  it("keeps a secondary button asked to stay", () => {
    windowOf(true);
    frame({ keep: true });
    expect(screen.getByRole("button", { name: "cancel" })).toBeTruthy();
  });

  // Given a phone,
  // when the coach taps the dimmed page, or presses Back,
  // then the sheet closes, and Back is held by the sheet (the page is not left).
  it("closes on a tap outside and on Back", () => {
    windowOf(true);
    const onClose = frame({});

    fireEvent.click(screen.getByTestId("sheet-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(runBackAction()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  // Given a phone and a request on its way,
  // when the coach presses Back or taps outside,
  // then the sheet stays open and Back is still held, so the page is not left mid-purchase.
  it("holds Back without closing while busy", () => {
    windowOf(true);
    const onClose = frame({ busy: true });

    fireEvent.click(screen.getByTestId("sheet-backdrop"));
    expect(runBackAction()).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("the item dialog frame on a desktop", () => {
  // Given a desktop window,
  // when the frame opens,
  // then it stays the centred modal with its cancel button, and Back is not held.
  it("stays a modal with its cancel button", () => {
    windowOf(false);
    frame({});

    expect(screen.getByRole("dialog", { name: "Drink" }).dataset.layout).toBe("modal");
    expect(screen.getByRole("button", { name: "cancel" })).toBeTruthy();
    expect(screen.queryByTestId("sheet-backdrop")).toBeNull();
    expect(runBackAction()).toBe(false);
  });
});
