import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PHONE_QUERY } from "./usePhoneLayout";
import { PHONE_FIELD, usePhoneForm } from "./usePhoneForm";

/**
 * On a phone a form walks its fields with Enter and keeps the one being typed in above the
 * keyboard (m2-tech-spec §3.2, M2a-2). Desktop keeps the browser's own Enter (DM-5).
 */
function stubLayout(phone: boolean) {
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

const submitted = vi.fn();
const scrolled: Element[] = [];

function Form() {
  const phoneForm = usePhoneForm();
  return (
    <form
      {...phoneForm}
      onSubmit={(event) => {
        event.preventDefault();
        submitted();
      }}
    >
      <input aria-label="email" {...PHONE_FIELD} />
      <input aria-label="search" />
      <input aria-label="password" {...PHONE_FIELD} />
      <button type="submit">send</button>
    </form>
  );
}

beforeEach(() => {
  submitted.mockClear();
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
    scrolled.push(this);
  };
});
afterEach(() => vi.unstubAllGlobals());

describe("a form on a phone (M2a-2)", () => {
  // Given a phone and the first of two fields,
  // when the coach presses Enter in it,
  // then the next field takes the focus and the form is not sent.
  it("moves to the next field on Enter", () => {
    stubLayout(true);
    render(<Form />);
    const email = screen.getByLabelText("email");
    email.focus();
    const stayed = fireEvent.keyDown(email, { key: "Enter" });
    expect(stayed).toBe(false);
    expect(screen.getByLabelText("password")).toHaveFocus();
    expect(submitted).not.toHaveBeenCalled();
  });

  // Given a phone and the last field,
  // when the coach presses Enter in it,
  // then the browser is left to send the form.
  it("leaves Enter in the last field to send the form", () => {
    stubLayout(true);
    render(<Form />);
    const password = screen.getByLabelText("password");
    password.focus();
    expect(fireEvent.keyDown(password, { key: "Enter" })).toBe(true);
  });

  // Given a phone,
  // when a field takes the focus,
  // then it is scrolled to the middle of what the keyboard leaves of the screen.
  it("scrolls the focused field to the middle", () => {
    stubLayout(true);
    render(<Form />);
    const password = screen.getByLabelText("password");
    fireEvent.focus(password);
    expect(scrolled).toEqual([password]);
  });

  // Given the desktop window,
  // when Enter is pressed in the first field or a field takes the focus,
  // then nothing is done here: the browser's own Enter, no scrolling.
  it("leaves the desktop alone", () => {
    stubLayout(false);
    render(<Form />);
    const email = screen.getByLabelText("email");
    email.focus();
    fireEvent.focus(email);
    expect(fireEvent.keyDown(email, { key: "Enter" })).toBe(true);
    expect(email).toHaveFocus();
    expect(scrolled).toEqual([]);
  });
});
