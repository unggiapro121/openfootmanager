import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { prefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { runBackAction } from "../lib/backActions";
import { isMobileBuild } from "../lib/platform";
import { onPhoneBackButton } from "../services/platformService";

/** The app's first pages on a phone: Back there asks to close the app instead of going back. */
const FIRST_PAGES = new Set(["/", "/online", "/online/takeover"]);
/** How long the second Back that closes the app may wait. */
const LEAVE_WINDOW_MS = 2000;
/** The keyboard's rise, before the field is scrolled to where it can be seen. */
const KEYBOARD_RISE_MS = 300;

/** Where Back goes when the router has no page to go back to. */
function parentOf(pathname: string): string {
  return pathname.startsWith("/online/") ? "/online" : "/";
}

/** Whether the browser history holds a page of this app before the current one. */
function canGoBack(): boolean {
  const state = window.history.state as { idx?: number } | null;
  return (state?.idx ?? 0) > 0;
}

/**
 * The phone app's own handling of the platform (phase 5, M1 rebuild findings 2 and 5): Back
 * steps back inside the page, then a page, and on a first page closes the app only when pressed
 * twice; a focused field is scrolled into view above the keyboard; the status bar keeps a navy
 * band under it. Nothing on the desktop.
 */
export default function PhoneBehaviors() {
  return isMobileBuild() ? <OnPhone /> : null;
}

function OnPhone() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const path = useRef(pathname);
  path.current = pathname;
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let alive = true;
    let stop: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const listen = () => {
      void onPhoneBackButton(onBack).then((unlisten) => {
        if (alive) stop = unlisten;
        else unlisten();
      });
    };
    const onBack = () => {
      if (runBackAction()) return;
      const here = path.current;
      if (!FIRST_PAGES.has(here)) {
        if (canGoBack()) navigate(-1);
        else navigate(parentOf(here));
        return;
      }
      // Let the platform's own Back, which closes the app, take the next press for a moment.
      setLeaving(true);
      stop?.();
      stop = null;
      timer = setTimeout(() => {
        setLeaving(false);
        if (alive) listen();
      }, LEAVE_WINDOW_MS);
    };

    listen();
    return () => {
      alive = false;
      stop?.();
      clearTimeout(timer);
    };
  }, [navigate]);

  useEffect(() => {
    const onFocus = (event: FocusEvent) => {
      const field = event.target;
      if (!(field instanceof HTMLElement) || !field.matches("input, textarea, select")) return;
      setTimeout(() => {
        field.scrollIntoView({
          block: "center",
          behavior: prefersReducedMotion() ? "auto" : "smooth",
        });
      }, KEYBOARD_RISE_MS);
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, []);

  return (
    <>
      <StatusBarScrim />
      {leaving && (
        <p
          role="status"
          className="fixed inset-x-0 bottom-[calc(6rem+var(--safe-bottom))] z-50 mx-auto w-fit rounded-full bg-navy-800 px-4 py-2 text-sm font-semibold text-white shadow-lg dark:bg-gray-100 dark:text-navy-900"
        >
          {t("mobile.pressBackAgain")}
        </p>
      )}
    </>
  );
}

/**
 * Navy under the status bar, over every page. The page runs under a transparent status bar
 * (Android draws edge to edge, enforced from API 35, and iOS always does), so a scrolled page's
 * text ran under the clock. One band here, instead of a top inset on each page's scroller; the
 * native side draws light status-bar icons to match (MainActivity, Info.plist). It sits above the
 * app's overlays (z-50 to z-80), so a sheet's backdrop does not hide it.
 */
function StatusBarScrim() {
  return (
    <div
      aria-hidden="true"
      data-status-bar-scrim=""
      className="pointer-events-none fixed inset-x-0 top-0 z-[90] h-[var(--safe-top)] bg-navy-900"
    />
  );
}
