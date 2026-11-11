import { type FocusEvent, type FormHTMLAttributes, type KeyboardEvent, useMemo } from "react";

import { usePhoneLayout } from "./usePhoneLayout";

/**
 * Marks a field that Enter walks through on a phone. Opt-in, so a field that is not one of the
 * form's own (the search box inside a picker) keeps what the browser does with Enter.
 */
export const PHONE_FIELD = { "data-phone-field": "" } as const;

/** Long enough for the keyboard to finish rising and the webview to shrink under it. */
const KEYBOARD_SETTLE_MS = 300;

function isTyped(target: EventTarget): target is HTMLInputElement | HTMLTextAreaElement {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

function centre(field: Element) {
  // jsdom and old webviews may lack it; the field is then left where the browser put it.
  if (typeof field.scrollIntoView === "function") field.scrollIntoView({ block: "center" });
}

/** Enter in a field that is not the last one moves to the next, instead of sending the form. */
function enterToNextField(event: KeyboardEvent<HTMLFormElement>) {
  if (event.key !== "Enter" || event.defaultPrevented || event.nativeEvent.isComposing) return;
  const field = event.target;
  if (!(field instanceof HTMLInputElement) || !field.hasAttribute("data-phone-field")) return;
  const fields = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>("[data-phone-field]:not([disabled])"),
  );
  const next = fields[fields.indexOf(field) + 1];
  if (!next) return;
  event.preventDefault();
  next.focus();
}

/**
 * The field being typed in, in the middle of what the keyboard leaves of the screen: once now,
 * and again when the keyboard has risen (iOS does not shrink the webview, M1 Android does).
 */
function centreFocusedField(event: FocusEvent<HTMLFormElement>) {
  const field = event.target;
  if (!isTyped(field)) return;
  centre(field);
  window.setTimeout(() => {
    if (document.activeElement === field) centre(field);
  }, KEYBOARD_SETTLE_MS);
}

/**
 * The props a form spreads to behave like a phone form (m2-tech-spec §3.2, M2a-2): Enter walks the
 * `PHONE_FIELD` fields and sends from the last, and a focused field stays above the keyboard.
 * Nothing on the desktop window (DM-5).
 */
export function usePhoneForm(): Pick<FormHTMLAttributes<HTMLFormElement>, "onKeyDown" | "onFocus"> {
  const phone = usePhoneLayout();
  return useMemo(
    () => (phone ? { onKeyDown: enterToNextField, onFocus: centreFocusedField } : {}),
    [phone],
  );
}
