import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SortHeader } from "./SortHeader";

type Column = "pos" | "age";

function renderHeader(sortKey: Column | null, sortDir: "asc" | "desc", onSort = vi.fn()) {
  render(
    <table>
      <thead>
        <tr>
          <SortHeader<Column>
            col="age"
            label="Age"
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
          />
        </tr>
      </thead>
    </table>,
  );
  return onSort;
}

describe("SortHeader", () => {
  it("sorts from a real, focusable button named after its column", () => {
    const onSort = renderHeader("pos", "asc");

    // A native <button> is what puts the control in the tab order and lets Enter and Space
    // activate it. jsdom does not replay a browser's keyboard activation, so this asserts the
    // element that guarantees it rather than simulating a key press.
    const button = screen.getByRole("button", { name: "Age" });
    button.focus();
    expect(button).toHaveFocus();

    fireEvent.click(button);
    expect(onSort).toHaveBeenCalledWith("age");
  });

  it("reports the sort only on the sorted column", () => {
    renderHeader("pos", "asc");
    expect(screen.getByRole("columnheader", { name: "Age" })).not.toHaveAttribute("aria-sort");
  });

  // Given a table kept in its own order, then no column reports a sort.
  it("reports no sort when the table is unsorted", () => {
    renderHeader(null, "desc");
    expect(screen.getByRole("columnheader", { name: "Age" })).not.toHaveAttribute("aria-sort");
  });

  it.each([
    ["asc", "ascending"],
    ["desc", "descending"],
  ] as const)("reports %s as %s", (sortDir, ariaSort) => {
    renderHeader("age", sortDir);
    expect(screen.getByRole("columnheader", { name: "Age" })).toHaveAttribute(
      "aria-sort",
      ariaSort,
    );
  });
});
