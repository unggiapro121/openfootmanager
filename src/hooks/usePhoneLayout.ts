import { useEffect, useState } from "react";

/**
 * Below Tailwind's `md` breakpoint (768 px), the width every phone has upright. The desktop
 * window never gets there: its `minWidth` is 960 (tauri.conf.json). Phase 5, DM-5 in
 * analysis-mobile.md.
 */
export const PHONE_QUERY = "(max-width: 767.98px)";

function phoneQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(PHONE_QUERY);
}

/** Whether the window is phone-narrow right now; the desktop layout when the browser cannot say. */
export function isPhoneLayout(): boolean {
  return phoneQuery()?.matches ?? false;
}

/** `isPhoneLayout`, kept current as the window crosses the breakpoint. */
export function usePhoneLayout(): boolean {
  const [phone, setPhone] = useState(isPhoneLayout);
  useEffect(() => {
    const query = phoneQuery();
    if (!query) return;
    const update = () => setPhone(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return phone;
}
