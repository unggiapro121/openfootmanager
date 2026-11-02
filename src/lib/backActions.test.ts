import { afterEach, describe, expect, it, vi } from "vitest";
import { pushBackAction, runBackAction } from "./backActions";

const undo: Array<() => void> = [];
afterEach(() => {
  while (undo.length > 0) undo.pop()?.();
});

describe("back actions", () => {
  // Given nothing on screen asks for Back,
  // when the phone's Back is pressed,
  // then no action runs and the caller is told so, to go back a page instead.
  it("reports when no screen holds Back", () => {
    expect(runBackAction()).toBe(false);
  });

  // Given a form inside a page and a sheet over it, both asking for Back,
  // when Back is pressed twice,
  // then the sheet closes first, then the form steps back: the last opened goes first.
  it("runs the newest action first", () => {
    const form = vi.fn();
    const sheet = vi.fn();
    undo.push(pushBackAction(form));
    undo.push(pushBackAction(sheet));

    expect(runBackAction()).toBe(true);
    expect(sheet).toHaveBeenCalledTimes(1);
    expect(form).not.toHaveBeenCalled();
    undo.pop()?.();

    expect(runBackAction()).toBe(true);
    expect(form).toHaveBeenCalledTimes(1);
  });

  // Given a sheet that closed by itself (a tap outside it),
  // when Back is pressed,
  // then its action is gone and the one below runs.
  it("forgets an action once its screen lets go", () => {
    const form = vi.fn();
    const sheet = vi.fn();
    undo.push(pushBackAction(form));
    const release = pushBackAction(sheet);
    release();

    runBackAction();
    expect(sheet).not.toHaveBeenCalled();
    expect(form).toHaveBeenCalledTimes(1);
  });
});
