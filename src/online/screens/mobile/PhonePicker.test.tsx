import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { runBackAction } from "../../../lib/backActions";
import { PhonePicker, type PickerOption } from "./PhonePicker";
import { PhoneSheet } from "./PhoneSheet";

const FOCUSES: PickerOption[] = [
  { value: "Physical", label: "Physical", detail: "Strength and stamina" },
  { value: "Technical", label: "Technical", detail: "Ball skills" },
  { value: "Recovery", label: "Recovery", disabled: true },
];

function trigger(name: RegExp | string = /Focus/) {
  return screen.getByRole("button", { name });
}

describe("PhonePicker", () => {
  it("shows its name and the chosen value on a closed field", () => {
    // Given a picker on Technical
    render(<PhonePicker label="Focus" value="Technical" options={FOCUSES} onChange={() => {}} />);
    // Then the field reads its name and value, and says it opens a sheet, closed
    expect(trigger()).toHaveAccessibleName("Focus Technical");
    expect(trigger()).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens a sheet listing the options, the chosen one marked", () => {
    // Given a closed picker
    render(<PhonePicker label="Focus" value="Technical" options={FOCUSES} onChange={() => {}} />);
    // When the field is tapped
    fireEvent.click(trigger());
    // Then a sheet titled by the field lists every option with its detail, the chosen one selected
    const sheet = screen.getByRole("dialog", { name: "Focus" });
    const list = within(sheet).getByRole("listbox", { name: "Focus" });
    expect(within(list).getAllByRole("option")).toHaveLength(3);
    expect(within(list).getByRole("option", { name: /Technical/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(list).getByRole("option", { name: /Physical/ })).toHaveTextContent(
      "Strength and stamina",
    );
    expect(within(list).getByRole("option", { name: /Recovery/ })).toBeDisabled();
    // Read aloud, the label and its detail stay two phrases.
    expect(within(list).getByRole("option", { name: /Physical/ })).toHaveAccessibleName(
      "Physical Strength and stamina",
    );
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
  });

  it("reports a new choice, closes and hands focus back to the field", () => {
    // Given an open picker
    const onChange = vi.fn();
    render(<PhonePicker label="Focus" value="Technical" options={FOCUSES} onChange={onChange} />);
    fireEvent.click(trigger());
    // When another option is tapped
    fireEvent.click(screen.getByRole("option", { name: /Physical/ }));
    // Then the choice is reported, the sheet goes and the field has focus again
    expect(onChange).toHaveBeenCalledWith("Physical");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it("closes without reporting when the chosen option is tapped again", () => {
    // Given an open picker
    const onChange = vi.fn();
    render(<PhonePicker label="Focus" value="Technical" options={FOCUSES} onChange={onChange} />);
    fireEvent.click(trigger());
    // When the option already chosen is tapped
    fireEvent.click(screen.getByRole("option", { name: /Technical/ }));
    // Then nothing is reported and the sheet goes
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lays short options out as tiles", () => {
    // Given a picker of shapes as tiles
    render(
      <PhonePicker
        label="Shape"
        layout="tiles"
        value="4-4-2"
        options={["4-4-2", "4-3-3", "3-5-2"].map((shape) => ({ value: shape, label: shape }))}
        onChange={() => {}}
      />,
    );
    // When it is opened
    fireEvent.click(trigger(/Shape/));
    // Then each option is a radio in a group, the chosen one checked
    const group = screen.getByRole("radiogroup", { name: "Shape" });
    expect(within(group).getAllByRole("radio")).toHaveLength(3);
    expect(within(group).getByRole("radio", { name: "4-4-2" })).toBeChecked();
  });

  it("does not open while disabled", () => {
    // Given a disabled picker
    render(
      <PhonePicker
        label="Focus"
        value="Technical"
        options={FOCUSES}
        onChange={() => {}}
        disabled
      />,
    );
    // When the field is tapped
    fireEvent.click(trigger());
    // Then no sheet opens
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opened from a sheet, closes alone on Escape and on Back", () => {
    // Given a picker inside an open sheet
    const closeOuter = vi.fn();
    render(
      <PhoneSheet title="Roles" onClose={closeOuter}>
        <PhonePicker label="Focus" value="Technical" options={FOCUSES} onChange={() => {}} />
      </PhoneSheet>,
    );
    // When the picker is opened and Escape pressed in it
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Focus" }), { key: "Escape" });
    // Then only the picker closes
    expect(screen.queryByRole("dialog", { name: "Focus" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Roles" })).toBeInTheDocument();
    expect(closeOuter).not.toHaveBeenCalled();
    // When it is opened again and Back pressed
    fireEvent.click(trigger());
    act(() => {
      runBackAction();
    });
    // Then again only the picker closes
    expect(screen.queryByRole("dialog", { name: "Focus" })).toBeNull();
    expect(closeOuter).not.toHaveBeenCalled();
  });

  it("titles its sheet apart from the field's name when asked", () => {
    // Given a picker whose sheet asks a fuller question
    render(
      <PhonePicker
        label="Focus"
        title="Focus of V. An"
        value="Technical"
        options={FOCUSES}
        onChange={() => {}}
      />,
    );
    // When it is opened
    fireEvent.click(trigger());
    // Then the sheet carries that title
    expect(screen.getByRole("dialog", { name: "Focus of V. An" })).toBeInTheDocument();
  });
});
