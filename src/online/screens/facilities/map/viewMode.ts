import { useState } from "react";
import { usePhoneLayout } from "../../../../hooks/usePhoneLayout";

/** The facilities screen's two views (c-27 §6.3, C27-18): the campus map or the list of cards. */
export type FacilitiesViewMode = "map" | "list";

/** Where this device remembers the coach's view. */
export const VIEW_MODE_KEY = "ofm.online.facilities.view";
const HINT_KEY = "ofm.online.facilities.mapHintSeen";

/**
 * The view to open on: the one chosen on this device, else the map on a desktop and the list on a
 * phone (Qc27-1). Storage that cannot be read gives the default.
 */
export function readViewMode(phone: boolean): FacilitiesViewMode {
  try {
    const kept = window.localStorage.getItem(VIEW_MODE_KEY);
    if (kept === "map" || kept === "list") return kept;
  } catch {
    // Storage blocked (private window, cleared site data): the device's default.
  }
  return phone ? "list" : "map";
}

export function writeViewMode(mode: FacilitiesViewMode): void {
  try {
    window.localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    // Storage blocked: the choice holds until the screen closes.
  }
}

/** The view shown, and the choice of the other, remembered on this device. */
export function useFacilitiesViewMode(): [FacilitiesViewMode, (mode: FacilitiesViewMode) => void] {
  const phone = usePhoneLayout();
  const [mode, setMode] = useState(() => readViewMode(phone));
  const choose = (next: FacilitiesViewMode) => {
    writeViewMode(next);
    setMode(next);
  };
  return [mode, choose];
}

/** Whether the map's drag hint was dismissed in this session (c-27 §6.2). */
export function hintSeen(): boolean {
  try {
    return window.sessionStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function markHintSeen(): void {
  try {
    window.sessionStorage.setItem(HINT_KEY, "1");
  } catch {
    // Storage blocked: the hint comes back with the next screen.
  }
}
