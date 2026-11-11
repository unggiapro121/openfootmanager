import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { onTablistKeyDown, tabIndexOf } from "./tablistKeys";

function Tabs({ disabled = "" }: { disabled?: string }) {
  const [tab, setTab] = useState("a");
  return (
    <div role="tablist" aria-label="tabs" onKeyDown={onTablistKeyDown}>
      {["a", "b", "c"].map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          tabIndex={tabIndexOf(tab === id)}
          disabled={id === disabled}
          onClick={() => setTab(id)}
        >
          {id}
        </button>
      ))}
    </div>
  );
}

const tab = (name: string) => screen.getByRole("tab", { name });
function press(key: string) {
  fireEvent.keyDown(document.activeElement ?? document.body, { key });
}

describe("arrow keys on a tablist (P5-5)", () => {
  // Given three tabs with the first chosen,
  // when the arrow keys, Home and End are pressed,
  // then focus and the choice move together, wrapping at either end.
  it("moves and chooses the tab, wrapping at the ends", () => {
    render(<Tabs />);
    tab("a").focus();
    press("ArrowRight");
    expect(tab("b")).toHaveFocus();
    expect(tab("b")).toHaveAttribute("aria-selected", "true");
    press("ArrowRight");
    press("ArrowRight");
    expect(tab("a")).toHaveFocus();
    press("ArrowLeft");
    expect(tab("c")).toHaveFocus();
    expect(tab("c")).toHaveAttribute("aria-selected", "true");
    press("Home");
    expect(tab("a")).toHaveFocus();
    press("End");
    expect(tab("c")).toHaveFocus();
  });

  // Given three tabs,
  // when one is chosen,
  // then only it is in the Tab order.
  it("keeps only the chosen tab in the Tab order", () => {
    render(<Tabs />);
    expect(tab("a")).toHaveAttribute("tabindex", "0");
    expect(tab("b")).toHaveAttribute("tabindex", "-1");
    tab("a").focus();
    press("End");
    expect(tab("c")).toHaveAttribute("tabindex", "0");
    expect(tab("a")).toHaveAttribute("tabindex", "-1");
  });

  // Given a disabled middle tab,
  // when the right arrow is pressed from the first,
  // then it is skipped.
  it("skips a disabled tab", () => {
    render(<Tabs disabled="b" />);
    tab("a").focus();
    press("ArrowRight");
    expect(tab("c")).toHaveFocus();
  });

  // Given focus on a tab,
  // when another key is pressed,
  // then nothing moves.
  it("leaves other keys alone", () => {
    render(<Tabs />);
    tab("a").focus();
    press("ArrowDown");
    press("Enter");
    expect(tab("a")).toHaveFocus();
    expect(tab("a")).toHaveAttribute("aria-selected", "true");
  });
});
