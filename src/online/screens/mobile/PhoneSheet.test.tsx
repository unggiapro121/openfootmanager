import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runBackAction } from "../../../lib/backActions";
import { PhoneSheet } from "./PhoneSheet";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Makes `Element.animate` real enough to watch: each call hands back a run the test finishes. */
function mockAnimate() {
  const runs: Array<() => void> = [];
  const animate = vi.fn(() => {
    let finish = () => {};
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    runs.push(finish);
    return { finished, cancel: () => {} } as unknown as Animation;
  });
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    writable: true,
    value: animate,
  });
  return {
    animate,
    finishAll: () => {
      for (const finish of runs) finish();
    },
    restore: () => {
      // jsdom has no `animate`: put it back to that.
      Reflect.deleteProperty(HTMLElement.prototype, "animate");
    },
  };
}

describe("PhoneSheet", () => {
  it("closes on Escape without the key reaching a sheet under it", () => {
    // Given a sheet inside something that also closes on Escape
    const onClose = vi.fn();
    const parentKey = vi.fn();
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: stands in for a parent sheet's panel
      <div onKeyDown={parentKey}>
        <PhoneSheet title="Inner" onClose={onClose}>
          <p>body</p>
        </PhoneSheet>
      </div>,
    );
    // When Escape is pressed in the sheet
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Inner" }), { key: "Escape" });
    // Then only this sheet closes
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(parentKey).not.toHaveBeenCalled();
  });

  it("closes on the phone's Back, newest sheet first", () => {
    // Given a sheet opened over another
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <>
        <PhoneSheet title="Outer" onClose={outer}>
          <p>a</p>
        </PhoneSheet>
        <PhoneSheet title="Inner" onClose={inner} stacked>
          <p>b</p>
        </PhoneSheet>
      </>,
    );
    // When Back is pressed once
    act(() => {
      runBackAction();
    });
    // Then the newest sheet closes and the one under it stays
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it("closes when the dimmed page is tapped", () => {
    // Given an open sheet
    const onClose = vi.fn();
    const { container } = render(
      <PhoneSheet title="Sheet" onClose={onClose}>
        <p>body</p>
      </PhoneSheet>,
    );
    // When the dimmed page behind it is tapped
    const dim = container.querySelector('button[aria-hidden="true"]');
    expect(dim).not.toBeNull();
    fireEvent.click(dim as Element);
    // Then it closes
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("puts a stacked sheet on the page body, above the sheet it opened from", () => {
    // Given a stacked sheet rendered inside a container
    const { container } = render(
      <PhoneSheet title="Picker" onClose={() => {}} stacked>
        <p>rows</p>
      </PhoneSheet>,
    );
    // Then it is not inside that container but on the body, a layer above a plain sheet
    expect(container).not.toContainElement(screen.getByRole("dialog", { name: "Picker" }));
    expect(screen.getByRole("dialog", { name: "Picker" }).parentElement).toHaveClass("z-[80]");
  });

  it("slides away before it reports itself closed when the webview can animate", async () => {
    // Given a webview that animates
    const motion = mockAnimate();
    const onClose = vi.fn();
    render(
      <PhoneSheet title="Sheet" onClose={onClose}>
        <p>body</p>
      </PhoneSheet>,
    );
    // When it is closed with Escape
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Sheet" }), { key: "Escape" });
    // Then the slide runs first and the close waits for it
    expect(motion.animate).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      motion.finishAll();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    motion.restore();
  });

  it("closes once however many ways it is asked while sliding away", async () => {
    // Given a webview that animates and a sheet already sliding away
    const motion = mockAnimate();
    const onClose = vi.fn();
    const { container } = render(
      <PhoneSheet title="Sheet" onClose={onClose}>
        <p>body</p>
      </PhoneSheet>,
    );
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Sheet" }), { key: "Escape" });
    // When the dimmed page is tapped during the slide
    fireEvent.click(container.querySelector('button[aria-hidden="true"]') as Element);
    await act(async () => {
      motion.finishAll();
    });
    // Then it reports itself closed once
    expect(onClose).toHaveBeenCalledTimes(1);
    motion.restore();
  });

  it("closes when dragged down by its top far enough, and stays when dragged a little", () => {
    // Given an open sheet
    const onClose = vi.fn();
    render(
      <PhoneSheet title="Sheet" onClose={onClose}>
        <p>body</p>
      </PhoneSheet>,
    );
    const grip = screen.getByTestId("sheet-grip");
    // When it is dragged down a little and let go
    fireEvent.pointerDown(grip, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientY: 130, pointerId: 1 });
    fireEvent.pointerUp(grip, { clientY: 130, pointerId: 1 });
    // Then it stays
    expect(onClose).not.toHaveBeenCalled();
    // When it is dragged down far and let go
    fireEvent.pointerDown(grip, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientY: 260, pointerId: 1 });
    fireEvent.pointerUp(grip, { clientY: 260, pointerId: 1 });
    // Then it closes
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hands its children the animated close", () => {
    // Given a sheet whose content closes it
    const onClose = vi.fn();
    render(
      <PhoneSheet title="Sheet" onClose={onClose}>
        {(close) => (
          <button type="button" onClick={close}>
            Done
          </button>
        )}
      </PhoneSheet>,
    );
    // When the content's button is pressed
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    // Then the sheet closes
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
