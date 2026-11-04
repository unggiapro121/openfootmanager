import {
  type CSSProperties,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";

/** The two places of a phone's app bar a page may fill (phase 5, design m-doi-hinh). */
export interface PhoneHeaderSlotElements {
  /** Beside the coins and the inbox: a page's own buttons, e.g. a search. */
  actions: HTMLElement | null;
  /** Under the bar, inside the part that stays at the top: a page's tabs or its search field. */
  below: HTMLElement | null;
}

const PhoneHeaderSlots = createContext<PhoneHeaderSlotElements>({ actions: null, below: null });

export const PhoneHeaderSlotsProvider = PhoneHeaderSlots.Provider;

/**
 * Puts `children` into the phone's app bar, where the shell keeps a place for them. Nothing off a
 * phone, where the shell has no such place.
 */
export function PhoneHeaderPart({
  place,
  children,
}: {
  place: keyof PhoneHeaderSlotElements;
  children: ReactNode;
}) {
  const target = useContext(PhoneHeaderSlots)[place];
  return target ? createPortal(children, target) : null;
}

/**
 * The height of the part of the shell that stays at the top, as `--phone-header-h`, so a page's
 * own sticky bar can stand just under it whatever the page put into the bar.
 */
export function useStickyHeaderHeight(header: HTMLElement | null): CSSProperties {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!header || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setHeight(header.offsetHeight));
    observer.observe(header);
    return () => observer.disconnect();
  }, [header]);
  return { "--phone-header-h": `${height}px` } as CSSProperties;
}
